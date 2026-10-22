// Génération des coups légaux et application (jouer / annuler) sur la position compacte.
import { RULES, type PlayerId } from './rules';
import { combat } from './combat';
import {
  EXPLORER,
  MOVEMENT,
  SENTINEL,
  ST_BOARD,
  ST_CAPTURED,
  ST_EXITED,
  STRENGTH,
  Z_SIDE,
  exitRow,
  makeReachBuffers,
  reach,
  stepCost,
  zSlot,
  zToggle,
  type CoreState,
  type ReachBuffers,
} from './core';
import type { GameResult } from './types';

export const K_MOVE = 0;
export const K_DIAG = 1;
export const K_LEAP = 2;
export const K_EXIT = 3;
export const K_ATTACK = 4;
export const K_PASS = 5;
export const KIND_NAMES = ['move', 'explorerDiagonal', 'explorerLeap', 'exit', 'attack', 'pass'] as const;

/** Coup compact (sans chemin) : ce que manipule l'IA. */
export interface Action {
  kind: number;
  piece: number;
  /** Case d'arrivée ; pour une sortie, case de la rangée d'arrivée d'où l'on sort ; pour une attaque, case de la cible. */
  dest: number;
  cost: number;
  /** Pièce attaquée (−1 sinon). */
  target: number;
  /** Attaque : case d'appui adjacente à la cible (−1 sinon). */
  via: number;
}

export const PASS: Action = { kind: K_PASS, piece: -1, dest: -1, cost: 0, target: -1, via: -1 };

export interface MovementOptions {
  exitCost: number;
  attackEntryUsesHeight: boolean;
  leapOverPieces: boolean;
  explorerSpecialCanAttackOrExit: boolean;
  exitInSameMove: boolean;
}
export const DEFAULT_MOVEMENT_OPTIONS: MovementOptions = { exitCost: RULES.exitCost, ...RULES.movement };

const buffersBySize = new Map<number, ReachBuffers>();
export function sharedBuffers(n: number): ReachBuffers {
  let b = buffersBySize.get(n);
  if (!b) buffersBySize.set(n, (b = makeReachBuffers(n)));
  return b;
}

/**
 * Coups légaux d'une pièce, ajoutés à `out`.
 * Si `buf` est fourni, il contient après l'appel le Dijkstra de la pièce
 * (utilisé par movement.ts pour reconstruire les chemins).
 */
export function pieceActions(
  s: CoreState,
  p: number,
  out: Action[],
  opts: MovementOptions = DEFAULT_MOVEMENT_OPTIONS,
  buf: ReachBuffers = sharedBuffers(s.topo.n),
  /** Ne générer que les attaques (utilisé par l'évaluation pour repérer les menaces). */
  onlyAttacks = false,
): void {
  if (s.pstatus[p] !== ST_BOARD) return;
  const { size, heights, neigh, diag, leap, leapMid } = s.topo;
  const type = s.ptype[p];
  const player = s.pplayer[p] as PlayerId;
  const budget = MOVEMENT[type];
  const start = s.ppos[p];

  reach(s, start, budget, buf);
  const { dist, cells, count } = buf;

  // --- Déplacements normaux (toute case atteinte sauf la case de départ) ---
  for (let i = 1; i < count && !onlyAttacks; i++) {
    const c = cells[i];
    out.push({ kind: K_MOVE, piece: p, dest: c, cost: dist[c], target: -1, via: -1 });
  }

  // --- Sorties : depuis une case atteinte de la rangée d'arrivée, s'il reste de quoi payer ---
  const lastRow = exitRow(player, size);
  for (let i = 0; i < count && !onlyAttacks; i++) {
    const c = cells[i];
    if (((c / size) | 0) !== lastRow) continue;
    if (!opts.exitInSameMove && c !== start) continue;
    const cost = dist[c] + opts.exitCost;
    if (cost <= budget) out.push({ kind: K_EXIT, piece: p, dest: c, cost, target: -1, via: -1 });
  }

  // --- Attaques : pour chaque cible, la case d'appui qui donne la meilleure attaque ---
  // (la hauteur et la charge dépendent de la case d'appui). À attaque égale, la moins chère.
  // Les attaques trop faibles (attaque < défense) ne sont pas proposées.
  const firstAttack = out.length;
  const bestAttack: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = cells[i];
    for (let k = 0; k < 4; k++) {
      const t = neigh[a * 4 + k];
      if (t < 0) continue;
      const q = s.board[t];
      if (q < 0 || s.pplayer[q] === player) continue;
      const entry = opts.attackEntryUsesHeight ? stepCost(heights[a], heights[t]) : 1;
      const cost = dist[a] + entry;
      if (cost > budget) continue;
      const r = combat(s, p, q, cost, a);
      if (r.attack < r.defense) continue;
      let j = firstAttack;
      while (j < out.length && out[j].target !== q) j++;
      if (j === out.length) {
        out.push({ kind: K_ATTACK, piece: p, dest: t, cost, target: q, via: a });
        bestAttack.push(r.attack);
      } else {
        const b = j - firstAttack;
        if (r.attack > bestAttack[b] || (r.attack === bestAttack[b] && cost < out[j].cost)) {
          out[j].cost = cost;
          out[j].via = a;
          bestAttack[b] = r.attack;
        }
      }
    }
  }

  // --- Coups spéciaux de l'Explorateur : case d'arrivée vide, relief ignoré ---
  if (type === EXPLORER && !onlyAttacks) {
    for (let k = 0; k < 4; k++) {
      const d = diag[start * 4 + k];
      if (d >= 0 && s.board[d] < 0) out.push({ kind: K_DIAG, piece: p, dest: d, cost: 1, target: -1, via: -1 });
    }
    for (let k = 0; k < 4; k++) {
      const d = leap[start * 4 + k];
      if (d < 0 || s.board[d] >= 0) continue;
      if (!opts.leapOverPieces && s.board[leapMid[start * 4 + k]] >= 0) continue; // pas de saut par-dessus une pièce
      out.push({ kind: K_LEAP, piece: p, dest: d, cost: 2, target: -1, via: -1 });
    }
  }
}

/** Attaque refusée : la cible est en vue, mais l'attaque n'est pas permise. */
export interface BlockedAttackAction {
  piece: number;
  target: number;
  /** Case d'appui (voisine de la cible) : la meilleure pour 'weak', la moins chère pour 'range'. */
  via: number;
  /** Coût du chemin jusqu'à la cible via cette case d'appui, entrée sur sa case comprise. */
  cost: number;
  /** 'weak' : à portée mais attaque < défense ; 'range' : case voisine atteinte, mais l'entrée dépasse le Mouvement. */
  reason: 'weak' | 'range';
}

/**
 * Attaques refusées d'une pièce, pour les expliquer au joueur (anneau gris).
 * On ne retient que les ennemis « en vue » : ceux dont une case voisine est
 * atteignable. Les ennemis plus lointains ne sont pas signalés (ce serait du bruit).
 * N'est utilisé que par l'interface, jamais par l'IA.
 */
export function blockedAttacks(
  s: CoreState,
  p: number,
  opts: MovementOptions = DEFAULT_MOVEMENT_OPTIONS,
  buf: ReachBuffers = sharedBuffers(s.topo.n),
): BlockedAttackAction[] {
  if (s.pstatus[p] !== ST_BOARD) return [];
  const { heights, neigh } = s.topo;
  const player = s.pplayer[p];
  const budget = MOVEMENT[s.ptype[p]];
  reach(s, s.ppos[p], budget, buf);
  const { dist, cells, count } = buf;
  // Par cible : l'approche la moins chère (pour 'range') et la meilleure attaque à portée (pour 'weak').
  const cheapest = new Map<number, { via: number; cost: number }>();
  const best = new Map<number, { via: number; cost: number; attack: number; defense: number }>();
  for (let i = 0; i < count; i++) {
    const a = cells[i];
    for (let k = 0; k < 4; k++) {
      const t = neigh[a * 4 + k];
      if (t < 0) continue;
      const q = s.board[t];
      if (q < 0 || s.pplayer[q] === player) continue;
      const cost = dist[a] + (opts.attackEntryUsesHeight ? stepCost(heights[a], heights[t]) : 1);
      const prev = cheapest.get(q);
      if (!prev || cost < prev.cost) cheapest.set(q, { via: a, cost });
      if (cost > budget) continue;
      const r = combat(s, p, q, cost, a);
      const b = best.get(q);
      if (!b || r.attack > b.attack || (r.attack === b.attack && cost < b.cost))
        best.set(q, { via: a, cost, attack: r.attack, defense: r.defense });
    }
  }
  const out: BlockedAttackAction[] = [];
  for (const [q, c] of cheapest) {
    const b = best.get(q);
    if (!b) out.push({ piece: p, target: q, via: c.via, cost: c.cost, reason: 'range' });
    else if (b.attack < b.defense) out.push({ piece: p, target: q, via: b.via, cost: b.cost, reason: 'weak' });
  }
  return out;
}

/** Tous les coups légaux du joueur au trait (PASS seul s'il n'en a aucun ; rien si la partie est finie). */
export function generateActions(s: CoreState, out: Action[] = []): Action[] {
  out.length = 0;
  if (s.result) return out;
  for (let p = 0; p < s.ptype.length; p++) if (s.pplayer[p] === s.current && s.pstatus[p] === ST_BOARD) pieceActions(s, p, out);
  if (out.length === 0) out.push(PASS);
  return out;
}

// -----------------------------------------------------------------------------
// Fin de partie
// -----------------------------------------------------------------------------

function byScore(s: CoreState, reason: GameResult['reason']): GameResult {
  const a = s.score[1];
  const b = s.score[2];
  return { winner: a > b ? 1 : b > a ? 2 : 'draw', reason };
}

/**
 * Un joueur sans aucune pièce sur le plateau :
 *  - si sa dernière pièce a été CAPTURÉE : il a perdu ;
 *  - si sa dernière pièce est SORTIE : on compare ses points au maximum que l'adversaire
 *    peut encore atteindre (score + Force de ses pièces sur le plateau) :
 *    adversaire incapable de l'égaler → il gagne ; égalité possible au mieux → nulle ; sinon il perd.
 * Renvoie null si les deux joueurs ont encore des pièces.
 */
function eliminationResult(s: CoreState, byExit: boolean): GameResult | null {
  const on = [0, 0, 0];
  const potential = [0, s.score[1], s.score[2]];
  for (let p = 0; p < s.ptype.length; p++) {
    if (s.pstatus[p] !== ST_BOARD) continue;
    on[s.pplayer[p]]++;
    potential[s.pplayer[p]] += STRENGTH[s.ptype[p]];
  }
  if (on[1] && on[2]) return null;
  // Les deux à zéro est impossible : un coup ne retire qu'une pièce à la fois.
  const out: PlayerId = on[1] ? 2 : 1;
  const foe: PlayerId = out === 1 ? 2 : 1;
  if (!byExit) return { winner: foe, reason: 'eliminated' };
  const mine = s.score[out];
  const best = potential[foe];
  return { winner: best < mine ? out : best === mine ? 'draw' : foe, reason: 'eliminated' };
}

/**
 * Limite de coups atteinte.
 *  - Si au moins un joueur a marqué : le meilleur score gagne (égalité = nulle).
 *  - Si personne n'a marqué : gagne le joueur dont la pièce la plus avancée a le
 *    moins de rangées à franchir ; à égalité, celui dont cette pièce (la plus
 *    avancée) a la plus grande Force ; sinon nulle.
 *    HYPOTHÈSE : un joueur sans pièce sur le plateau perd ce départage
 *    (nulle si aucun des deux n'en a).
 */
export function moveLimitResult(s: CoreState): GameResult {
  if (s.score[1] > 0 || s.score[2] > 0) return byScore(s, 'moveLimit');
  const size = s.topo.size;
  const best = [null, { rows: Infinity, str: 0 }, { rows: Infinity, str: 0 }];
  for (let p = 0; p < s.ptype.length; p++) {
    if (s.pstatus[p] !== ST_BOARD) continue;
    const pl = s.pplayer[p] as PlayerId;
    const row = (s.ppos[p] / size) | 0;
    const rows = Math.abs(exitRow(pl, size) - row);
    const str = STRENGTH[s.ptype[p]];
    const b = best[pl]!;
    if (rows < b.rows || (rows === b.rows && str > b.str)) best[pl] = { rows, str };
  }
  const [, a, b] = best as [null, { rows: number; str: number }, { rows: number; str: number }];
  let winner: GameResult['winner'] = 'draw';
  if (a.rows < b.rows) winner = 1;
  else if (b.rows < a.rows) winner = 2;
  else if (a.rows !== Infinity && a.str !== b.str) winner = a.str > b.str ? 1 : 2;
  return { winner, reason: 'moveLimit' };
}

// -----------------------------------------------------------------------------
// Jouer / annuler (make / unmake) — utilisé en boucle par l'IA
// -----------------------------------------------------------------------------

export interface Undo {
  a: Action;
  from: number;
  turn: number;
  exits: number;
  firstExitType: number;
  exited1: number;
  exited2: number;
  result: GameResult | null;
  score1: number;
  score2: number;
  h1: number;
  h2: number;
}

function moveTo(s: CoreState, p: number, cell: number) {
  zToggle(s, p, zSlot(s, p));
  s.board[s.ppos[p]] = -1;
  s.ppos[p] = cell;
  s.board[cell] = p;
  zToggle(s, p, zSlot(s, p));
}

function remove(s: CoreState, p: number, status: number) {
  zToggle(s, p, zSlot(s, p));
  if (s.board[s.ppos[p]] === p) s.board[s.ppos[p]] = -1;
  s.ppos[p] = -1;
  s.pstatus[p] = status;
  zToggle(s, p, zSlot(s, p));
}

export function makeAction(s: CoreState, a: Action): Undo {
  const u: Undo = {
    a,
    from: a.piece >= 0 ? s.ppos[a.piece] : -1,
    turn: s.turn,
    exits: s.exits,
    firstExitType: s.firstExitType,
    exited1: s.exited[1],
    exited2: s.exited[2],
    result: s.result,
    score1: s.score[1],
    score2: s.score[2],
    h1: s.h1,
    h2: s.h2,
  };
  const p = a.piece;
  switch (a.kind) {
    case K_MOVE:
    case K_DIAG:
    case K_LEAP:
      moveTo(s, p, a.dest);
      break;
    case K_ATTACK:
      // Le défenseur est retiré définitivement, l'attaquant prend sa case.
      remove(s, a.target, ST_CAPTURED);
      moveTo(s, p, a.dest);
      break;
    case K_EXIT: {
      const player = s.pplayer[p] as PlayerId;
      remove(s, p, ST_EXITED);
      s.score[player] += STRENGTH[s.ptype[p]];
      s.exits++;
      s.exited[player]++;
      if (s.exits === 1) s.firstExitType = s.ptype[p];
      // Une Sentinelle qui sort la première de la partie gagne tout de suite ;
      // sinon, la 2e sortie d'un même joueur gagne.
      if (s.ptype[p] === SENTINEL && sentinelExitWinsNow(s.exits - 1)) {
        s.result = { winner: player, reason: 'sentinel' };
      } else if (s.exited[player] >= RULES.end.exitsToWin) {
        s.result = { winner: player, reason: 'secondExit' };
      }
      break;
    }
    case K_PASS:
      break;
  }
  if (!s.result && RULES.end.noPiecesLoses && a.kind !== K_PASS) s.result = eliminationResult(s, a.kind === K_EXIT);
  s.turn++;
  s.current = s.current === 1 ? 2 : 1;
  s.h1 ^= Z_SIDE[0];
  s.h2 ^= Z_SIDE[1];
  if (!s.result && s.turn >= RULES.maxTurns) s.result = moveLimitResult(s);
  return u;
}

export function unmakeAction(s: CoreState, u: Undo): void {
  const a = u.a;
  const p = a.piece;
  switch (a.kind) {
    case K_MOVE:
    case K_DIAG:
    case K_LEAP:
      s.board[a.dest] = -1;
      s.board[u.from] = p;
      s.ppos[p] = u.from;
      break;
    case K_ATTACK:
      s.board[u.from] = p;
      s.ppos[p] = u.from;
      s.board[a.dest] = a.target;
      s.ppos[a.target] = a.dest;
      s.pstatus[a.target] = ST_BOARD;
      break;
    case K_EXIT:
      s.board[u.from] = p;
      s.ppos[p] = u.from;
      s.pstatus[p] = ST_BOARD;
      break;
  }
  s.turn = u.turn;
  s.current = s.current === 1 ? 2 : 1;
  s.exits = u.exits;
  s.firstExitType = u.firstExitType;
  s.exited[1] = u.exited1;
  s.exited[2] = u.exited2;
  s.result = u.result;
  s.score[1] = u.score1;
  s.score[2] = u.score2;
  s.h1 = u.h1;
  s.h2 = u.h2;
}

/** Vrai si une Sentinelle qui sort fait gagner, sachant que `exitsBefore` pièces sont déjà sorties. */
export function sentinelExitWinsNow(exitsBefore: number): boolean {
  return RULES.end.sentinelExitWins && (!RULES.end.sentinelMustExitFirst || exitsBefore === 0);
}

/** Vrai si l'action donne immédiatement la victoire au joueur qui la joue (tri des coups, niveau Facile). */
export function isImmediateWin(s: CoreState, a: Action): boolean {
  if (a.kind === K_ATTACK && RULES.end.noPiecesLoses) {
    // Capturer la dernière pièce adverse sur le plateau (une sortie de sa dernière pièce, elle, dépend des scores).
    const foe = s.pplayer[a.target];
    for (let p = 0; p < s.ptype.length; p++) if (p !== a.target && s.pstatus[p] === ST_BOARD && s.pplayer[p] === foe) return false;
    return true;
  }
  if (a.kind !== K_EXIT) return false;
  const pl = s.pplayer[a.piece] as PlayerId;
  if (s.ptype[a.piece] === SENTINEL && sentinelExitWinsNow(s.exits)) return true;
  return s.exited[pl] + 1 >= RULES.end.exitsToWin;
}

export { ST_EXITED, ST_CAPTURED };
