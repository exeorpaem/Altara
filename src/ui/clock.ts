// Pendule côté interface : mesure le temps de réflexion du joueur au trait.
// Le moteur garde le temps restant de chacun (GameState.clock) ; ici on ne mesure
// que la réflexion du tour en cours, qu'on lui transmet au moment de jouer.
//
// La pendule ne tourne que pendant la réflexion : elle s'arrête dès que le coup est
// choisi (les animations ne sont pas décomptées) et pendant l'écran de fin.
import type { PlayerId } from '../engine/rules';
import type { GameState } from '../engine/types';

export class GameClock {
  private running: PlayerId | null = null;
  private since = 0;
  /** Réflexion déjà accumulée pendant ce tour (pendule arrêtée, coup pas encore joué). */
  private pending = 0;

  /** Démarre la pendule du joueur `p` (sans effet si elle tourne déjà pour lui). */
  start(p: PlayerId) {
    if (this.running === p) return;
    if (this.running !== null) this.stop();
    this.running = p;
    this.since = performance.now();
  }

  /** Arrête la pendule en gardant le temps de réflexion du tour. */
  stop() {
    if (this.running === null) return;
    this.pending += performance.now() - this.since;
    this.running = null;
  }

  /** Arrête la pendule et rend le temps de réflexion du tour (remis à zéro). */
  take(): number {
    this.stop();
    const v = this.pending;
    this.pending = 0;
    return v;
  }

  reset() {
    this.running = null;
    this.pending = 0;
  }

  get isRunning() {
    return this.running !== null;
  }

  /** Temps restant affiché pour le joueur `p`, réflexion en cours comprise. */
  remaining(state: GameState, p: PlayerId): number {
    if (!state.clock) return Infinity;
    let left = state.clock.remaining[p];
    if (p === state.current && !state.result) {
      left -= this.pending + (this.running === p ? performance.now() - this.since : 0);
    }
    return Math.max(0, left);
  }
}

/** 10:00, 0:42, puis 9,4 sous les 10 dernières secondes. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  if (ms < 10_000) return (Math.floor(ms / 100) / 10).toFixed(1).replace('.', ',');
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
