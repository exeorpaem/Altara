// Implémentation locale de GameEngine : règles complètes (déplacement, combat, score, fin de partie).
import { PIECES, RULES, type PlayerId } from './rules';
import { generateTerrain, type Terrain, type TerrainMode } from './terrain';
import { K_ATTACK, K_PASS, PASS, generateActions, makeAction, pieceActions, type Action } from './actions';
import { combat } from './combat';
import { ST_BOARD, ST_EXITED, fromGameState, type CoreState } from './core';
import { blockedAttackList, findAction, legalMoves } from './movement';
import type { AttackPreview, BlockedAttack, ClockState, GameEngine, GameState, Move, MoveRecord, Piece } from './types';

/** Cadence de jeu : minutes par joueur + incrément en secondes par coup (10+0, 3+2…). */
export interface TimeControl {
  minutes: number;
  incrementSec: number;
}

export function makeClock(tc: TimeControl | null | undefined): ClockState | null {
  if (!tc) return null;
  const ms = tc.minutes * 60_000;
  return { initialMs: ms, incrementMs: tc.incrementSec * 1000, remaining: { 1: ms, 2: ms } };
}

const COLS = 'ABCDEFGHIJKLMNOP';
/** Notation d'une case : colonne en lettre (A à gauche pour J1), rangée en chiffre (1 = départ J1). */
export const cellName = (row: number, col: number) => `${COLS[col]}${row + 1}`;

export function initialPieces(size: number): Piece[] {
  const pieces: Piece[] = [];
  const last = size - 1;
  for (const player of [1, 2] as PlayerId[]) {
    RULES.startColumns.forEach((col, k) => {
      const type = RULES.startOrder[k];
      pieces.push({
        id: `${player}-${type}-${k}`,
        type,
        player,
        // J2 est placé par symétrie centrale : même ordre vu depuis son côté.
        row: player === 1 ? 0 : last,
        col: player === 1 ? col : last - col,
        status: 'board',
      });
    });
  }
  return pieces;
}

export function newGameState(terrain: Terrain, tc?: TimeControl | null): GameState {
  return {
    clock: makeClock(tc),
    terrain,
    pieces: initialPieces(terrain.size),
    current: 1,
    turn: 0,
    score: { 1: 0, 2: 0 },
    history: [],
    result: null,
  };
}

export function notate(move: Move, piece: Piece): string {
  const letter = PIECES[piece.type].letter;
  const from = move.path[0];
  const to = move.path[move.path.length - 1];
  const a = cellName(from.row, from.col);
  const b = cellName(to.row, to.col);
  switch (move.kind) {
    case 'move':
    case 'explorerDiagonal':
      return `${letter} ${a}→${b}`;
    case 'explorerLeap':
      return `${letter} ${a}⤳${b}`;
    case 'attack':
      return `${letter} ${a}×${b}`;
    case 'exit':
      return `${letter} ${b}↑`;
  }
}

/** Recopie dans l'état lisible les champs modifiés par une action sur la position compacte. */
function writeBack(g: GameState, s: CoreState) {
  const size = s.topo.size;
  g.pieces.forEach((p, i) => {
    p.status = s.pstatus[i] === ST_BOARD ? 'board' : s.pstatus[i] === ST_EXITED ? 'exited' : 'captured';
    if (s.ppos[i] >= 0) {
      p.row = Math.floor(s.ppos[i] / size);
      p.col = s.ppos[i] % size;
    }
  });
  g.current = s.current;
  g.turn = s.turn;
  g.score = { 1: s.score[1], 2: s.score[2] };
  g.result = s.result ? { ...s.result } : null;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export class LocalEngine implements GameEngine {
  private state: GameState;
  private past: GameState[] = [];

  constructor(terrainOrState: Terrain | GameState) {
    this.state = 'pieces' in terrainOrState ? clone(terrainOrState) : newGameState(terrainOrState);
    this.state.result ??= null;
  }

  static create(mode: TerrainMode, seed: string, tc?: TimeControl | null): LocalEngine {
    return new LocalEngine(newGameState(generateTerrain(mode, seed), tc));
  }

  getState(): GameState {
    return this.state;
  }

  getLegalMoves(pieceId: string): Move[] {
    const p = this.state.pieces.find((x) => x.id === pieceId);
    if (!p || p.player !== this.state.current || this.state.result) return [];
    return legalMoves(this.state, pieceId);
  }

  getPotentialMoves(pieceId: string): Move[] {
    const p = this.state.pieces.find((x) => x.id === pieceId);
    if (!p || p.status !== 'board' || this.state.result) return [];
    return legalMoves(this.state, pieceId); // mêmes règles, sans condition de trait
  }

  getBlockedAttacks(pieceId: string): BlockedAttack[] {
    const p = this.state.pieces.find((x) => x.id === pieceId);
    if (!p || p.status !== 'board') return [];
    return blockedAttackList(this.state, pieceId);
  }

  previewAttack(move: Move): AttackPreview {
    const s = fromGameState(this.state);
    const a = s.ids.indexOf(move.pieceId);
    const t = s.ids.indexOf(move.targetId!);
    const r = combat(s, a, t, move.cost, true);
    return { attack: r.attack, defense: r.defense, details: r.details };
  }

  play(move: Move, elapsedMs = 0): GameState {
    // Pendule : si le temps de réflexion dépasse le temps restant, le coup arrive trop tard.
    const clock = this.state.clock;
    if (clock && !this.state.result && elapsedMs >= clock.remaining[this.state.current]) return this.flag(this.state.current);
    const s = fromGameState(this.state);
    const p = s.ids.indexOf(move.pieceId);
    if (p < 0 || s.pplayer[p] !== s.current || s.result) throw new Error('Coup illégal');
    const actions: Action[] = [];
    pieceActions(s, p, actions);
    const action = findAction(s, actions, move);
    if (!action) throw new Error('Coup illégal');
    // On garde le chemin affiché si c'est bien un chemin de même coût ; sinon on régénère.
    const legal = legalMoves(this.state, move.pieceId).find((m) => m.kind === move.kind && sameEnd(m, move))!;

    this.past.push(clone(this.state));
    const g = this.state;
    const piece = g.pieces[p];
    const record: MoveRecord = { player: g.current, move: clone(legal), notation: notate(legal, piece) };
    if (action.kind === K_ATTACK) record.capturedId = s.ids[action.target];
    makeAction(s, action);
    writeBack(g, s);
    if (g.clock) {
      // Décompte du temps de réflexion, puis incrément (cadence « + n s »).
      g.clock.remaining[record.player] += g.clock.incrementMs - Math.max(0, elapsedMs);
    }
    g.history.push(record);
    this.autoPass();
    return g;
  }

  /** Chute du drapeau : le joueur n'a plus de temps et perd la partie. */
  flag(player: PlayerId): GameState {
    const g = this.state;
    if (g.result || !g.clock) return g;
    this.past.push(clone(g));
    g.clock.remaining[player] = 0;
    g.result = { winner: player === 1 ? 2 : 1, reason: 'time' };
    return g;
  }

  /**
   * Un joueur sans aucun coup légal passe son tour (enregistré dans l'historique).
   * Si les deux joueurs sont bloqués, les passes s'enchaînent jusqu'à la limite de coups.
   */
  private autoPass() {
    const g = this.state;
    while (!g.result) {
      const s = fromGameState(g);
      const acts = generateActions(s);
      if (acts.length !== 1 || acts[0].kind !== K_PASS) return;
      g.history.push({ player: g.current, pass: true, notation: '— passe' });
      makeAction(s, PASS);
      writeBack(g, s);
    }
  }

  undo(): GameState {
    const prev = this.past.pop();
    if (prev) this.state = prev;
    return this.state;
  }

  serialize(): string {
    return JSON.stringify({ v: 2, state: this.state, past: this.past });
  }

  load(data: string): GameState {
    const parsed = JSON.parse(data);
    if ((parsed?.v !== 1 && parsed?.v !== 2) || !parsed.state) throw new Error('Sauvegarde invalide');
    this.state = parsed.state;
    this.state.result ??= null;
    this.past = parsed.past ?? [];
    return this.state;
  }
}

const sameEnd = (a: Move, b: Move) => {
  const x = a.path[a.path.length - 1];
  const y = b.path[b.path.length - 1];
  return x.row === y.row && x.col === y.col;
};

