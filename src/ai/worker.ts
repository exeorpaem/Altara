// Web Worker de l'IA : n'importe que engine/ (aucun accès au DOM).
// L'interface reste fluide pendant que l'IA réfléchit sur ce fil séparé.
import { chooseMove, type AiOptions } from '../engine/ai/search';
import type { GameState } from '../engine/types';

type Request = { ping: true } | { id: number; state: GameState; opts: AiOptions };
const post = (m: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);

self.onmessage = (e: MessageEvent<Request>) => {
  // Poignée de main : prouve au client que le worker a bien démarré.
  if ('ping' in e.data) return post({ pong: true });
  const { id, state, opts } = e.data;
  try {
    post({ id, ...chooseMove(state, opts) });
  } catch (err) {
    post({ id, error: String(err) });
  }
};
