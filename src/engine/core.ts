// Cœur du moteur : représentation compacte de la position, utilisée à la fois
// par l'interface (via engine.ts) et par l'IA (des milliers de positions par
// seconde). Une seule implémentation des règles pour les deux.
//
// Conventions :
//  - une case est un entier `cell = row * size + col` ;
//  - une pièce est un indice 0..P-1 ; ses attributs sont dans des tableaux typés ;
//  - board[cell] = indice de la pièce posée là, ou −1.
import { PIECES, PIECE_TYPES, RULES, type PieceType, type PlayerId } from './rules';
import { mulberry32 } from './random';
import type { GameResult, GameState } from './types';

export const TYPE_INDEX: Record<PieceType, number> = { explorer: 0, vanguard: 1, sentinel: 2 };
export const TYPE_OF = PIECE_TYPES; // indice → type (même ordre que TYPE_INDEX)
export const SENTINEL = TYPE_INDEX.sentinel;
export const VANGUARD = TYPE_INDEX.vanguard;
export const EXPLORER = TYPE_INDEX.explorer;
export const MOVEMENT = PIECE_TYPES.map((t) => PIECES[t].movement);
export const STRENGTH = PIECE_TYPES.map((t) => PIECES[t].strength);

export const ST_BOARD = 0;
export const ST_EXITED = 1;
export const ST_CAPTURED = 2;

/** Coût d'un pas orthogonal : 1 à hauteur égale, sinon |Δh| + 1 (montée comme descente). */
export function stepCost(hFrom: number, hTo: number): number {
  return hFrom === hTo ? 1 : Math.abs(hTo - hFrom) + 1;
}

/** Rangée d'arrivée d'un joueur : J1 sort par le haut (dernière rangée), J2 par la rangée 0. */
export function exitRow(player: PlayerId, size: number): number {
  return player === 1 ? size - 1 : 0;
}

// -----------------------------------------------------------------------------
// Topologie : tout ce qui ne dépend que du terrain (calculé une fois par plateau)
// -----------------------------------------------------------------------------

export interface Topology {
  size: number;
  n: number;
  heights: Int8Array;
  /** 4 voisins orthogonaux par case (−1 hors plateau), dans l'ordre de RULES.adjacency. */
  neigh: Int16Array;
  /** 4 voisins diagonaux et 4 cases à distance 2 (bond), avec la case intermédiaire du bond. */
  diag: Int16Array;
  leap: Int16Array;
  leapMid: Int16Array;
  /**
   * Coût minimal pour sortir depuis chaque case, par joueur, sans tenir compte
   * des pièces (sert à l'évaluation de la « course »). Coût de sortie inclus.
   */
  exitDist: [Int16Array, Int16Array, Int16Array];
}

const topoCache = new WeakMap<number[][], Topology>();

export function topology(heights2d: number[][]): Topology {
  const cached = topoCache.get(heights2d);
  if (cached) return cached;
  const size = heights2d.length;
  const n = size * size;
  const heights = new Int8Array(n);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) heights[r * size + c] = heights2d[r][c];

  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < size && c < size;
  const neigh = new Int16Array(n * 4).fill(-1);
  const diag = new Int16Array(n * 4).fill(-1);
  const leap = new Int16Array(n * 4).fill(-1);
  const leapMid = new Int16Array(n * 4).fill(-1);
  const DIAG = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      RULES.adjacency.forEach(([dr, dc], k) => {
        if (inside(r + dr, c + dc)) neigh[i * 4 + k] = (r + dr) * size + c + dc;
        if (inside(r + 2 * dr, c + 2 * dc)) {
          leap[i * 4 + k] = (r + 2 * dr) * size + c + 2 * dc;
          leapMid[i * 4 + k] = (r + dr) * size + c + dc;
        }
      });
      DIAG.forEach(([dr, dc], k) => {
        if (inside(r + dr, c + dc)) diag[i * 4 + k] = (r + dr) * size + c + dc;
      });
    }

  const topo: Topology = { size, n, heights, neigh, diag, leap, leapMid, exitDist: [new Int16Array(0), exitField(1), exitField(2)] };
  topoCache.set(heights2d, topo);
  return topo;

  /**
   * Dijkstra « inversé » multi-sources : on part de toutes les cases de la rangée
   * d'arrivée (coût = coût de sortie) et on remonte le terrain. Le coût d'un pas
   * étant symétrique, on obtient pour chaque case le coût minimal pour sortir.
   */
  function exitField(player: PlayerId): Int16Array {
    const dist = new Int16Array(n).fill(9999);
    const row = exitRow(player, size);
    const open: number[] = [];
    for (let c = 0; c < size; c++) {
      dist[row * size + c] = RULES.exitCost;
      open.push(row * size + c);
    }
    // File de priorité naïve : 100 cases, calcul fait une seule fois par plateau.
    const done = new Uint8Array(n);
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (dist[open[k]] < dist[open[bi]]) bi = k;
      const cell = open.splice(bi, 1)[0];
      if (done[cell]) continue;
      done[cell] = 1;
      for (let k = 0; k < 4; k++) {
        const nb = neigh[cell * 4 + k];
        if (nb < 0 || done[nb]) continue;
        const d = dist[cell] + stepCost(heights[cell], heights[nb]);
        if (d < dist[nb]) {
          dist[nb] = d;
          open.push(nb);
        }
      }
    }
    return dist;
  }
}

// -----------------------------------------------------------------------------
// Position
// -----------------------------------------------------------------------------

export interface CoreState {
  topo: Topology;
  board: Int8Array;
  ids: string[];
  ptype: Uint8Array;
  pplayer: Uint8Array;
  ppos: Int16Array;
  pstatus: Uint8Array;
  current: PlayerId;
  turn: number;
  /** score[1], score[2] (indice 0 inutilisé) */
  score: Int16Array;
  /** Nombre de pièces sorties (tous camps) et type de la première sortie (−1 si aucune). */
  exits: number;
  firstExitType: number;
  /** Nombre de pièces sorties par joueur (indice 0 inutilisé). */
  exited: Int8Array;
  result: GameResult | null;
  /** Hachage de Zobrist sur 2 × 32 bits (table de transposition de l'IA). */
  h1: number;
  h2: number;
}

// Tables de Zobrist : un nombre aléatoire par (pièce, emplacement) + un pour le trait.
// Emplacements : n cases + « sortie » + « capturée ». Seed fixe : hachages reproductibles.
const MAX_PIECES = 16;
const MAX_SLOTS = 16 * 16 + 2;
const Z1 = new Int32Array(MAX_PIECES * MAX_SLOTS);
const Z2 = new Int32Array(MAX_PIECES * MAX_SLOTS);
{
  const r = mulberry32(0x5eed);
  for (let i = 0; i < Z1.length; i++) {
    Z1[i] = (r() * 2 ** 32) | 0;
    Z2[i] = (r() * 2 ** 32) | 0;
  }
}
export const Z_SIDE = [0x2545f491, 0x9e3779b9 | 0];

/** Emplacement d'une pièce pour Zobrist : sa case, ou deux valeurs spéciales. */
export function zSlot(s: CoreState, p: number): number {
  const st = s.pstatus[p];
  return st === ST_BOARD ? s.ppos[p] : MAX_SLOTS - st;
}
export const zKey = (p: number, slot: number) => p * MAX_SLOTS + slot;
export function zToggle(s: CoreState, p: number, slot: number) {
  s.h1 ^= Z1[zKey(p, slot)];
  s.h2 ^= Z2[zKey(p, slot)];
}

export function fromGameState(g: GameState): CoreState {
  const topo = topology(g.terrain.heights);
  const P = g.pieces.length;
  const s: CoreState = {
    topo,
    board: new Int8Array(topo.n).fill(-1),
    ids: g.pieces.map((p) => p.id),
    ptype: new Uint8Array(P),
    pplayer: new Uint8Array(P),
    ppos: new Int16Array(P).fill(-1),
    pstatus: new Uint8Array(P),
    current: g.current,
    turn: g.turn,
    score: Int16Array.from([0, g.score[1], g.score[2]]),
    exits: 0,
    firstExitType: -1,
    exited: new Int8Array(3),
    result: g.result ?? null,
    h1: 0,
    h2: 0,
  };
  g.pieces.forEach((p, i) => {
    s.ptype[i] = TYPE_INDEX[p.type];
    s.pplayer[i] = p.player;
    s.pstatus[i] = p.status === 'board' ? ST_BOARD : p.status === 'exited' ? ST_EXITED : ST_CAPTURED;
    if (p.status === 'board') {
      const cell = p.row * topo.size + p.col;
      s.ppos[i] = cell;
      s.board[cell] = i;
    }
    if (p.status === 'exited') {
      s.exits++;
      s.exited[p.player]++;
    }
    zToggle(s, i, zSlot(s, i));
  });
  // Type de la première pièce sortie : retrouvé dans l'historique.
  const firstExit = g.history.find((h) => h.move?.kind === 'exit');
  if (firstExit) s.firstExitType = TYPE_INDEX[g.pieces.find((p) => p.id === firstExit.move!.pieceId)!.type];
  if (s.current === 2) {
    s.h1 ^= Z_SIDE[0];
    s.h2 ^= Z_SIDE[1];
  }
  return s;
}

export function cloneCore(s: CoreState): CoreState {
  return {
    ...s,
    board: s.board.slice(),
    ptype: s.ptype,
    pplayer: s.pplayer,
    ppos: s.ppos.slice(),
    pstatus: s.pstatus.slice(),
    score: s.score.slice(),
    exited: s.exited.slice(),
    result: s.result ? { ...s.result } : null,
  };
}

// -----------------------------------------------------------------------------
// Dijkstra borné
// -----------------------------------------------------------------------------

/** Tampons réutilisés (pas d'allocation pendant la recherche de l'IA). */
export interface ReachBuffers {
  dist: Int8Array;
  prev: Int16Array;
  /** Cases atteintes, dans l'ordre de coût croissant (case de départ comprise). */
  cells: Int16Array;
  count: number;
  buckets: number[][];
}

export function makeReachBuffers(n: number): ReachBuffers {
  return { dist: new Int8Array(n), prev: new Int16Array(n), cells: new Int16Array(n), count: 0, buckets: [] };
}

const INF = 127;

/**
 * Dijkstra depuis `start` avec un budget (le Mouvement de la pièce).
 *
 * Les coûts sont de petits entiers (un pas coûte 1 à 3, le budget vaut au plus 5),
 * on utilise donc une « file à seaux » : buckets[c] contient les cases découvertes
 * au coût c. On vide les seaux par coût croissant ; une case est traitée la
 * première fois qu'on la sort avec son coût définitif (les entrées périmées,
 * dont le coût a été amélioré depuis, sont ignorées). Les cases occupées par une
 * pièce (alliée ou ennemie) ne sont jamais entrées : elles bloquent le passage.
 * prev[] mémorise le prédécesseur sur le chemin de coût minimal.
 */
export function reach(s: CoreState, start: number, budget: number, b: ReachBuffers): void {
  const { neigh, heights } = s.topo;
  const { dist, prev, cells, buckets } = b;
  dist.fill(INF);
  for (let c = 0; c <= budget; c++) {
    if (!buckets[c]) buckets[c] = [];
    buckets[c].length = 0;
  }
  dist[start] = 0;
  prev[start] = -1;
  buckets[0].push(start);
  let count = 0;
  for (let c = 0; c <= budget; c++) {
    const bucket = buckets[c];
    for (let i = 0; i < bucket.length; i++) {
      const cell = bucket[i];
      if (dist[cell] !== c) continue; // entrée périmée
      cells[count++] = cell;
      const h = heights[cell];
      for (let k = 0; k < 4; k++) {
        const nb = neigh[cell * 4 + k];
        if (nb < 0 || s.board[nb] >= 0) continue;
        const nc = c + (h === heights[nb] ? 1 : Math.abs(heights[nb] - h) + 1);
        if (nc <= budget && nc < dist[nb]) {
          dist[nb] = nc;
          prev[nb] = cell;
          buckets[nc].push(nb);
        }
      }
    }
  }
  b.count = count;
}
