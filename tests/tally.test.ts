import { describe, expect, it } from 'vitest';
import { LocalEngine } from '../src/engine/engine';
import { tally } from '../src/engine/tally';
import { flat, piece, state } from './helpers';

describe('décompte sorties / captures', () => {
  it('compte sorties, captures et points par camp', () => {
    const state0 = state(flat(), [
      piece('explorer', 1, 9, 0, 'exited'),
      piece('sentinel', 1, 9, 1, 'captured'),
      piece('vanguard', 1, 4, 4),
      piece('vanguard', 2, 0, 0, 'exited'),
      piece('sentinel', 2, 0, 1, 'exited'),
      piece('explorer', 2, 5, 5),
    ]);
    const t = tally(state0);
    expect(t[1]).toEqual({ exited: ['explorer'], captured: ['sentinel'], points: 1 });
    expect(t[2]).toEqual({ exited: ['vanguard', 'sentinel'], captured: [], points: 5 });
  });

  it('suit un vrai coup puis son annulation', () => {
    const v = piece('vanguard', 1, 9, 4);
    const spare = piece('explorer', 1, 2, 2);
    const foe = piece('explorer', 2, 5, 5);
    const eng = new LocalEngine(state(flat(), [v, spare, foe]));
    expect(tally(eng.getState())[1].exited).toEqual([]);
    eng.play(eng.getLegalMoves(v.id).find((m) => m.kind === 'exit')!);
    expect(tally(eng.getState())[1]).toEqual({ exited: ['vanguard'], captured: [], points: 2 });
    expect(tally(eng.getState())[1].points).toBe(eng.getState().score[1]); // cohérent avec le score du moteur
    eng.undo();
    expect(tally(eng.getState())[1]).toEqual({ exited: [], captured: [], points: 0 });
  });

  it('compte une capture après une attaque', () => {
    const a = piece('sentinel', 1, 4, 4);
    const foe = piece('explorer', 2, 4, 5);
    const spare = piece('sentinel', 2, 9, 9);
    const eng = new LocalEngine(state(flat(), [a, foe, spare]));
    const atk = eng.getLegalMoves(a.id).find((m) => m.kind === 'attack' && m.targetId === foe.id)!;
    eng.play(atk);
    expect(tally(eng.getState())[2].captured).toEqual(['explorer']);
    expect(tally(eng.getState())[1].captured).toEqual([]);
  });
});
