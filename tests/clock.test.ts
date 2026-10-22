import { describe, expect, it } from 'vitest';
import { LocalEngine } from '../src/engine/engine';

const firstMove = (eng: LocalEngine) => {
  const s = eng.getState();
  const p = s.pieces.find((x) => x.player === s.current && eng.getLegalMoves(x.id).length)!;
  return eng.getLegalMoves(p.id)[0];
};

describe('pendule', () => {
  it('10+0 : chaque joueur commence avec 10 minutes', () => {
    const eng = LocalEngine.create('woods', 'CLK', { minutes: 10, incrementSec: 0 });
    expect(eng.getState().clock).toEqual({ initialMs: 600_000, incrementMs: 0, remaining: { 1: 600_000, 2: 600_000 } });
  });

  it('le temps de réflexion est décompté du joueur qui joue, et de lui seul', () => {
    const eng = LocalEngine.create('woods', 'CLK', { minutes: 10, incrementSec: 0 });
    eng.play(firstMove(eng), 12_345);
    expect(eng.getState().clock!.remaining).toEqual({ 1: 600_000 - 12_345, 2: 600_000 });
    eng.play(firstMove(eng), 1_000);
    expect(eng.getState().clock!.remaining).toEqual({ 1: 587_655, 2: 599_000 });
  });

  it("l'incrément est ajouté après chaque coup (3+2)", () => {
    const eng = LocalEngine.create('woods', 'CLK', { minutes: 3, incrementSec: 2 });
    eng.play(firstMove(eng), 5_000);
    expect(eng.getState().clock!.remaining[1]).toBe(180_000 - 5_000 + 2_000);
  });

  it('drapeau : le joueur à court de temps perd', () => {
    const eng = LocalEngine.create('woods', 'CLK', { minutes: 10, incrementSec: 0 });
    eng.play(firstMove(eng), 1000);
    eng.flag(2);
    expect(eng.getState().result).toEqual({ winner: 1, reason: 'time' });
    expect(eng.getState().clock!.remaining[2]).toBe(0);
    expect(eng.getLegalMoves(eng.getState().pieces[0].id)).toHaveLength(0);
  });

  it('un coup joué après la fin du temps fait tomber le drapeau au lieu d’être joué', () => {
    const eng = LocalEngine.create('woods', 'CLK', { minutes: 1, incrementSec: 0 });
    eng.play(firstMove(eng), 60_000);
    expect(eng.getState().result).toEqual({ winner: 2, reason: 'time' });
    expect(eng.getState().history).toHaveLength(0);
  });

  it('annuler restaure aussi la pendule ; la sauvegarde la conserve', () => {
    const eng = LocalEngine.create('woods', 'CLK', { minutes: 10, incrementSec: 0 });
    eng.play(firstMove(eng), 30_000);
    const copy = LocalEngine.create('woods', 'X');
    copy.load(eng.serialize());
    expect(copy.getState().clock!.remaining[1]).toBe(570_000);
    eng.undo();
    expect(eng.getState().clock!.remaining[1]).toBe(600_000);
  });

  it('sans cadence : pas de pendule, le temps est ignoré', () => {
    const eng = LocalEngine.create('woods', 'CLK');
    eng.play(firstMove(eng), 99_999_999);
    expect(eng.getState().clock).toBeNull();
    expect(eng.getState().result).toBeNull();
  });
});
