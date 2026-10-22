// Décompte des pièces sorties et capturées par camp (affichage permanent en jeu).
// Fonction pure : elle ne lit que l'état, donc elle suit aussi l'annulation et la relecture.
import { PIECES, type PieceType, type PlayerId } from './rules';
import type { GameState } from './types';

export interface Tally {
  /** Types des pièces de ce camp sorties par le bord adverse (ordre de la liste des pièces). */
  exited: PieceType[];
  /** Types des pièces de ce camp capturées par l'adversaire. */
  captured: PieceType[];
  /** Points marqués : somme des Forces des pièces sorties. */
  points: number;
}

export function tally(state: GameState): Record<PlayerId, Tally> {
  const out: Record<PlayerId, Tally> = {
    1: { exited: [], captured: [], points: 0 },
    2: { exited: [], captured: [], points: 0 },
  };
  for (const p of state.pieces) {
    if (p.status === 'exited') {
      out[p.player].exited.push(p.type);
      out[p.player].points += PIECES[p.type].strength;
    } else if (p.status === 'captured') out[p.player].captured.push(p.type);
  }
  return out;
}
