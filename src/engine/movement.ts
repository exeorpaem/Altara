// Coups légaux « lisibles » (avec chemins) pour l'interface.
// La logique des règles est dans actions.ts / core.ts ; ce module ne fait que
// convertir les coups compacts en objets Move, en reconstruisant le chemin de
// coût minimal grâce aux prédécesseurs mémorisés par le Dijkstra.
import {
  DEFAULT_MOVEMENT_OPTIONS,
  K_ATTACK,
  K_DIAG,
  K_EXIT,
  K_LEAP,
  KIND_NAMES,
  pieceActions,
  sharedBuffers,
  type Action,
  type MovementOptions,
} from './actions';
import { fromGameState, type CoreState } from './core';
import { blockedAttacks } from './actions';
import { combat } from './combat';
import type { BlockedAttack, Cell, GameState, Move } from './types';

export { stepCost, exitRow } from './core';
export { DEFAULT_MOVEMENT_OPTIONS, type MovementOptions } from './actions';

export function cellOf(s: CoreState, cell: number): Cell {
  return { row: Math.floor(cell / s.topo.size), col: cell % s.topo.size };
}

/** Convertit une action compacte en Move (avec chemin), à partir du Dijkstra de sa pièce. */
function toMove(s: CoreState, a: Action, prev: Int16Array): Move {
  const start = s.ppos[a.piece];
  const chain = (to: number) => {
    const path: Cell[] = [];
    for (let c = to; c !== -1; c = c === start ? -1 : prev[c]) path.unshift(cellOf(s, c));
    return path;
  };
  let path: Cell[];
  if (a.kind === K_DIAG || a.kind === K_LEAP) path = [cellOf(s, start), cellOf(s, a.dest)];
  else if (a.kind === K_ATTACK) path = [...chain(a.via), cellOf(s, a.dest)];
  else path = chain(a.dest); // déplacement ou sortie
  const move: Move = { pieceId: s.ids[a.piece], path, cost: a.cost, kind: KIND_NAMES[a.kind] as Move['kind'] };
  if (a.kind === K_ATTACK) move.targetId = s.ids[a.target];
  return move;
}

/** Tous les coups légaux d'une pièce (quel que soit le joueur au trait). */
export function legalMoves(state: GameState, pieceId: string, opts: MovementOptions = DEFAULT_MOVEMENT_OPTIONS): Move[] {
  if (state.result) return [];
  const s = fromGameState(state);
  const p = s.ids.indexOf(pieceId);
  if (p < 0) return [];
  const buf = sharedBuffers(s.topo.n);
  const actions: Action[] = [];
  pieceActions(s, p, actions, opts, buf);
  // Le Dijkstra est encore dans `buf` (les coups spéciaux ne le modifient pas).
  return actions.map((a) => toMove(s, a, buf.prev));
}

/** Attaques refusées d'une pièce, avec chemin et explication (quel que soit le joueur au trait). */
export function blockedAttackList(state: GameState, pieceId: string): BlockedAttack[] {
  if (state.result) return [];
  const s = fromGameState(state);
  const p = s.ids.indexOf(pieceId);
  if (p < 0) return [];
  const buf = sharedBuffers(s.topo.n);
  const list = blockedAttacks(s, p, DEFAULT_MOVEMENT_OPTIONS, buf);
  return list.map((b) => {
    const path: Cell[] = [];
    for (let c = b.via; c !== -1; c = c === s.ppos[p] ? -1 : buf.prev[c]) path.unshift(cellOf(s, c));
    path.push(cellOf(s, s.ppos[b.target]));
    const r = combat(s, p, b.target, b.cost, true);
    return {
      pieceId,
      targetId: s.ids[b.target],
      reason: b.reason,
      cost: b.cost,
      path,
      ...(b.reason === 'weak' ? { attack: r.attack, defense: r.defense } : {}),
      details: b.reason === 'weak' ? r.details : [],
    };
  });
}

/** Retrouve l'action compacte correspondant à un Move (même pièce, même nature, même arrivée). */
export function findAction(s: CoreState, actions: Action[], move: Move): Action | undefined {
  const p = s.ids.indexOf(move.pieceId);
  const end = move.path[move.path.length - 1];
  const dest = end.row * s.topo.size + end.col;
  return actions.find((a) => a.piece === p && KIND_NAMES[a.kind] === move.kind && a.dest === dest);
}

export { K_EXIT };
