// Côté interface : obtient le coup de l'IA, de préférence via un Web Worker.
//
// Certaines pages hôtes (aperçus intégrés, iframes avec une politique de sécurité
// stricte) interdisent les workers créés à la volée : le navigateur les bloque
// sans lever d'exception, et une IA qui attendrait sa réponse resterait figée.
// Le client se protège donc à trois niveaux :
//   1. poignée de main au démarrage (ping → pong en moins de 2,5 s) ;
//   2. erreur du worker ou absence de réponse dans le délai prévu → abandon ;
//   3. dans ces cas, l'IA calcule directement sur le fil principal (repli).
// Le repli fige l'affichage pendant la réflexion : on y limite donc le niveau
// recherche à 1 s par coup (niveaux 6 à 10).
import AiWorker from './worker?worker&inline';
import { AI_LEVELS, chooseMove, levelNumber, thinkBudget, type AiMove, type AiOptions } from '../engine/ai/search';
import type { GameState } from '../engine/types';

const HANDSHAKE_MS = 2500;
/** Marge accordée au worker au-delà de son temps de réflexion prévu. */
const WATCHDOG_MARGIN_MS = 4000;
const FALLBACK_HARD_MS = 1000;

export type AiMode = 'pending' | 'worker' | 'main-thread';

export class AiClient {
  private worker: Worker | null = null;
  private ready: Promise<boolean>;
  private nextId = 1;
  private inflight: { id: number; resolve: (r: AiMove) => void; reject: (e: Error) => void; timer: number } | null = null;
  /** Où l'IA calcule (utile pour le débogage). */
  mode: AiMode = 'pending';

  constructor() {
    this.ready = this.spawn();
  }

  /** Démarre un worker et vérifie qu'il répond vraiment. */
  private spawn(): Promise<boolean> {
    return new Promise((resolve) => {
      let w: Worker;
      try {
        w = new AiWorker();
      } catch {
        this.mode = 'main-thread';
        return resolve(false);
      }
      const fail = () => {
        clearTimeout(timer);
        w.terminate();
        this.worker = null;
        this.mode = 'main-thread';
        console.warn("[Altara] Web Worker indisponible dans cette page : l'IA calcule sur le fil principal.");
        resolve(false);
      };
      const timer = window.setTimeout(fail, HANDSHAKE_MS);
      w.onerror = fail;
      w.onmessage = (e) => {
        if (!e.data?.pong) return;
        clearTimeout(timer);
        this.worker = w;
        this.mode = 'worker';
        w.onmessage = (ev) => this.onResult(ev.data);
        // Une erreur plus tard (worker tué, mémoire…) : on bascule sur le repli.
        w.onerror = () => this.abandonWorker(new Error('Erreur du worker'));
        resolve(true);
      };
      w.postMessage({ ping: true });
    });
  }

  private onResult(data: AiMove & { id: number; error?: string }) {
    const job = this.inflight;
    if (!job || job.id !== data.id) return; // réponse d'une demande annulée
    clearTimeout(job.timer);
    this.inflight = null;
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data);
  }

  private abandonWorker(err: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.mode = 'main-thread';
    this.ready = Promise.resolve(false);
    const job = this.inflight;
    this.inflight = null;
    if (job) {
      clearTimeout(job.timer);
      job.reject(err);
    }
  }

  async think(state: GameState, opts: AiOptions): Promise<AiMove> {
    if ((await this.ready) && this.worker) {
      try {
        return await this.viaWorker(state, opts);
      } catch (e) {
        console.warn('[Altara] IA : le worker ne répond pas, repli sur le fil principal.', e);
        this.abandonWorker(e as Error);
      }
    }
    return this.onMainThread(state, opts);
  }

  private viaWorker(state: GameState, opts: AiOptions): Promise<AiMove> {
    const id = this.nextId++;
    // Délai de garde : temps de réflexion prévu par le niveau (+ marge).
    const timed = AI_LEVELS[levelNumber(opts.level)].kind === 'timed';
    const expected = timed ? thinkBudget(opts) : 500;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('délai dépassé')), expected + WATCHDOG_MARGIN_MS);
      this.inflight = { id, resolve, reject, timer };
      this.worker!.postMessage({ id, state, opts });
    });
  }

  private async onMainThread(state: GameState, opts: AiOptions): Promise<AiMove> {
    // On laisse d'abord le navigateur afficher l'indicateur « réflexion… ».
    await new Promise((r) => setTimeout(r, 30));
    const timeMs = Math.min(thinkBudget(opts), FALLBACK_HARD_MS);
    return chooseMove(state, { ...opts, timeMs });
  }

  /** Abandonne la réflexion en cours (nouvelle partie, annulation…). */
  cancel() {
    const job = this.inflight;
    if (!job) return;
    clearTimeout(job.timer);
    this.inflight = null;
    // Le worker est peut-être en plein calcul : on le remplace par un neuf.
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.mode = 'pending';
      this.ready = this.spawn();
    }
  }
}
