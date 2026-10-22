import { describe, expect, it } from 'vitest';
import { LocalEngine } from '../src/engine/engine';
import { stateAtPly } from '../src/engine/replay';
import { tally } from '../src/engine/tally';
import { mulberry32 } from '../src/engine/random';
import type { GameState } from '../src/engine/types';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
/** Ce qui définit une position (la pendule et l'historique sont comparés à part). */
const position = (s: GameState) => ({ pieces: s.pieces, current: s.current, turn: s.turn, score: s.score, result: s.result });

/** Partie jouée au hasard (reproductible) ; renvoie le moteur et un instantané après chaque coup. */
function randomGame(seed: number, mode: 'woods' | 'volcano', plies: number, first: 1 | 2 = 1) {
  const rnd = mulberry32(seed);
  const eng = LocalEngine.create(mode, 'REPLAY', null, first);
  const snaps: GameState[] = [clone(eng.getState())];
  for (let i = 0; i < plies && !eng.getState().result; i++) {
    const s = eng.getState();
    const moves = s.pieces.filter((p) => p.player === s.current && p.status === 'board').flatMap((p) => eng.getLegalMoves(p.id));
    if (!moves.length) break;
    // On privilégie un peu les attaques et sorties pour couvrir captures et sorties.
    const strong = moves.filter((m) => m.kind === 'attack' || m.kind === 'exit');
    const pool = strong.length && rnd() < 0.7 ? strong : moves;
    eng.play(pool[Math.floor(rnd() * pool.length)]);
    snaps.push(clone(eng.getState()));
  }
  return { eng, snaps };
}

describe('relecture : reconstruction depuis l\'historique', () => {
  it('chaque position reconstruite est identique à celle vécue pendant la partie', () => {
    for (const [seed, mode] of [[1, 'woods'], [7, 'volcano'], [42, 'woods']] as const) {
      const { eng, snaps } = randomGame(seed, mode, 80);
      const final = eng.getState();
      expect(final.history.length).toBeGreaterThan(20);
      for (const snap of snaps) {
        const n = snap.history.length;
        const rebuilt = stateAtPly(final, n);
        expect(position(rebuilt)).toEqual(position(snap));
        expect(rebuilt.history).toEqual(snap.history);
      }
    }
  });

  it('ply 0 = position initiale, dernier ply = position finale', () => {
    const { eng } = randomGame(3, 'woods', 40, 2); // Lagon ouvre
    const final = eng.getState();
    const start = stateAtPly(final, 0);
    expect(start.history).toEqual([]);
    expect(start.turn).toBe(0);
    expect(start.current).toBe(2);
    expect(start.pieces.every((p) => p.status === 'board')).toBe(true);
    expect(position(stateAtPly(final, final.history.length))).toEqual(position(final));
    // Valeurs hors bornes : ramenées dans l'historique.
    expect(position(stateAtPly(final, 9999))).toEqual(position(final));
    expect(stateAtPly(final, -5).turn).toBe(0);
  });

  it("ne modifie pas l'état d'origine et coïncide avec l'annulation", () => {
    const { eng } = randomGame(5, 'woods', 30);
    const before = clone(eng.getState());
    const k = eng.getState().history.length - 4;
    const rebuilt = stateAtPly(eng.getState(), k);
    expect(eng.getState()).toEqual(before);
    eng.undo();
    eng.undo();
    eng.undo();
    eng.undo();
    expect(position(rebuilt)).toEqual(position(eng.getState()));
  });

  it('le décompte sorties/captures d\'une position relue suit la position, pas la fin de partie', () => {
    const { eng, snaps } = randomGame(7, 'volcano', 120);
    const final = eng.getState();
    for (const snap of snaps) {
      expect(tally(stateAtPly(final, snap.history.length))).toEqual(tally(snap));
    }
    // Le décompte est monotone au fil de la partie (une pièce sortie ou capturée ne revient pas).
    const sizes = snaps.map((s) => tally(s)).map((t) => t[1].exited.length + t[1].captured.length + t[2].exited.length + t[2].captured.length);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    expect(sizes[sizes.length - 1]).toBeGreaterThan(0); // la partie de test contient bien des sorties ou captures
  });
});
