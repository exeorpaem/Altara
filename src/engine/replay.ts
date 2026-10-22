// Relecture : reconstruit la position après n coups en rejouant l'historique depuis l'état
// initial, avec le même moteur que la partie (aucune règle dupliquée dans le rendu).
import type { PlayerId } from './rules';
import { LocalEngine, newGameState } from './engine';
import type { GameState } from './types';

/** Joueur qui a ouvert la partie (déduit du premier enregistrement de l'historique). */
export function firstPlayerOf(state: GameState): PlayerId {
  return state.history[0]?.player ?? state.current;
}

/**
 * Position après les `ply` premiers enregistrements de l'historique (passes comprises), sans pendule.
 * Hypothèse : la partie est partie de la disposition standard (c'est le cas de toutes les parties de l'interface).
 * Les passes sont rejouées par le moteur lui-même : si le coup qui précède une passe est le dernier retenu,
 * la position renvoyée inclut déjà cette passe (les pièces sont de toute façon identiques).
 */
export function stateAtPly(final: GameState, ply: number): GameState {
  const n = Math.max(0, Math.min(ply, final.history.length));
  const eng = new LocalEngine(newGameState(final.terrain, null, firstPlayerOf(final)));
  for (const rec of final.history.slice(0, n)) {
    if (rec.pass || !rec.move) continue;
    eng.play(rec.move);
  }
  return eng.getState();
}
