import { describe, expect, it } from 'vitest';
import { LocalEngine } from '../src/engine/engine';

describe('qui commence', () => {
  it('Corail commence par défaut', () => {
    expect(LocalEngine.create('random', 'ABC', null).getState().current).toBe(1);
  });
  it('Lagon peut commencer', () => {
    const eng = LocalEngine.create('random', 'ABC', null, 2);
    const s = eng.getState();
    expect(s.current).toBe(2);
    const p = s.pieces.find((x) => x.player === 2)!;
    expect(eng.getLegalMoves(p.id).length).toBeGreaterThan(0);
    expect(eng.getLegalMoves(s.pieces.find((x) => x.player === 1)!.id)).toHaveLength(0);
  });
});
