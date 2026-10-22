import { describe, expect, it } from 'vitest';
import { LocalEngine } from '../src/engine/engine';
import { chooseAction, chooseMove, orderActions, thinkBudget, type AiLevel } from '../src/engine/ai/search';
import { evaluate } from '../src/engine/ai/evaluate';
import { generateActions, makeAction, unmakeAction, K_EXIT, K_ATTACK } from '../src/engine/actions';
import { fromGameState, type CoreState } from '../src/engine/core';
import { mulberry32 } from '../src/engine/random';
import { flat, piece, state } from './helpers';

/** Instantané comparable d'une position compacte. */
const snap = (s: CoreState) =>
  JSON.stringify([Array.from(s.board), Array.from(s.ppos), Array.from(s.pstatus), s.current, s.turn, Array.from(s.score), s.exits, s.firstExitType, s.result, s.h1, s.h2]);

describe('jouer / annuler (make / unmake)', () => {
  it('annuler restaure exactement la position, et le hachage reste cohérent', () => {
    const rand = mulberry32(42);
    for (const mode of ['random', 'mountains', 'desert'] as const) {
      const eng = LocalEngine.create(mode, `MU-${mode}`);
      const s = fromGameState(eng.getState());
      const stack: [ReturnType<typeof makeAction>, string][] = [];
      for (let i = 0; i < 120 && !s.result; i++) {
        const acts = generateActions(s, []);
        const a = acts[Math.floor(rand() * acts.length)];
        const before = snap(s);
        const u = makeAction(s, a);
        stack.push([u, before]);
        // Le hachage incrémental doit égaler celui recalculé de zéro.
        const fresh = fromGameState(toGameState(eng, s));
        expect([s.h1, s.h2]).toEqual([fresh.h1, fresh.h2]);
      }
      while (stack.length) {
        const [u, before] = stack.pop()!;
        unmakeAction(s, u);
        expect(snap(s)).toBe(before);
      }
    }
  });
});

/** Reconstitue un GameState à partir d'une position compacte (pour recalculer le hachage). */
function toGameState(eng: LocalEngine, s: CoreState) {
  const g = structuredClone(eng.getState());
  g.pieces.forEach((p, i) => {
    p.status = s.pstatus[i] === 0 ? 'board' : s.pstatus[i] === 1 ? 'exited' : 'captured';
    if (s.ppos[i] >= 0) [p.row, p.col] = [Math.floor(s.ppos[i] / 10), s.ppos[i] % 10];
  });
  g.current = s.current;
  return g;
}

describe('IA', () => {
  const levels: AiLevel[] = ['easy', 'medium', 'hard'];

  it('chaque niveau renvoie un coup légal', () => {
    const eng = LocalEngine.create('highlands', 'AI-LEGAL');
    for (const level of levels) {
      const r = chooseMove(eng.getState(), { level, seed: 1, timeMs: 200 });
      expect(r.move).not.toBeNull();
      expect(eng.getLegalMoves(r.move!.pieceId)).toContainEqual(r.move);
    }
  });

  it('Moyen et Difficile jouent la victoire immédiate de la Sentinelle', () => {
    const s1 = piece('sentinel', 1, 8, 4); // 1 pas + sortie = 2 ≤ 3
    const others = [piece('vanguard', 1, 2, 2), piece('sentinel', 2, 5, 5), piece('vanguard', 2, 6, 8)];
    const g = state(flat(), [s1, ...others]);
    for (const level of ['medium', 'hard'] as const) {
      const r = chooseMove(g, { level, seed: 3, timeMs: 300 });
      expect(r.move?.kind).toBe('exit');
      expect(r.move?.pieceId).toBe(s1.id);
    }
  });

  it("Moyen empêche une victoire de Sentinelle adverse quand c'est possible (capture)", () => {
    // La Sentinelle J2 en (1,4) sortirait au prochain coup ; J1 peut la capturer à 2 contre… :
    // Sentinelle J1 (3) + Explorateur allié adjacent à la cible (+1) = 4 ≥ 3.
    const threat = piece('sentinel', 2, 1, 4);
    const hunter = piece('sentinel', 1, 1, 2);
    const ally = piece('explorer', 1, 0, 4);
    const g = state(flat(), [threat, hunter, ally, piece('vanguard', 1, 5, 8), piece('vanguard', 2, 8, 8)]);
    const r = chooseMove(g, { level: 'medium', seed: 1 });
    expect(r.move?.kind).toBe('attack');
    expect(r.move?.targetId).toBe(threat.id);
  });

  it('Facile rate parfois la victoire de Sentinelle (environ 30 %)', () => {
    const s1 = piece('sentinel', 1, 8, 4);
    const g = state(flat(), [s1, piece('vanguard', 1, 2, 2), piece('sentinel', 2, 5, 5)]);
    const s = fromGameState(g);
    let missed = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const r = chooseAction(s, { level: 'easy', seed: i });
      const win = r.action.kind === K_EXIT && r.action.piece === 0;
      if (!win) missed++;
    }
    // Quand il ne rate pas exprès, la victoire est dans son top 3 : il la joue ≈ 1 fois sur 3 au pire.
    expect(missed / N).toBeGreaterThan(0.25);
    expect(missed / N).toBeLessThan(0.9);
  });

  it('la seed rend le choix reproductible', () => {
    const g = LocalEngine.create('woods', 'SEED').getState();
    for (const level of ['easy', 'medium'] as const) {
      const a = chooseMove(g, { level, seed: 'abc' }).move;
      const b = chooseMove(g, { level, seed: 'abc' }).move;
      expect(a).toEqual(b);
    }
  });

  it('Difficile respecte sa limite de temps', () => {
    const g = LocalEngine.create('random', 'TIME').getState();
    const r = chooseMove(g, { level: 'hard', seed: 1, timeMs: 400 });
    expect(r.info.ms).toBeLessThan(800);
    expect(r.info.depth).toBeGreaterThanOrEqual(2);
  });

  it("l'évaluation est antisymétrique (vue de J1 = −vue de J2)", () => {
    const s = fromGameState(LocalEngine.create('mountains', 'SYM').getState());
    expect(evaluate(s, 1)).toBeCloseTo(-evaluate(s, 2));
  });

  it('tri des coups : victoire immédiate, sorties, captures (Force décroissante), puis le reste', () => {
    const v1 = piece('vanguard', 1, 9, 0); // peut sortir (pas une victoire immédiate : ce n'est pas une Sentinelle)
    const s1 = piece('sentinel', 1, 8, 5); // peut sortir → victoire immédiate (première sortie)
    const hunter = piece('sentinel', 1, 4, 4);
    const weak = piece('explorer', 2, 4, 6);
    const mid = piece('vanguard', 2, 3, 4);
    const s = fromGameState(state(flat(), [v1, s1, hunter, weak, mid]));
    const acts = generateActions(s, []);
    orderActions(s, acts, -1);
    expect(acts[0]).toMatchObject({ kind: K_EXIT, piece: 1 });
    const kinds = acts.map((a) => a.kind);
    const firstAttack = kinds.indexOf(K_ATTACK);
    const lastExit = kinds.lastIndexOf(K_EXIT);
    expect(lastExit).toBeLessThan(firstAttack);
    // Capture de l'Avant-garde (Force 2) avant celle de l'Explorateur (Force 1)
    const attacks = acts.filter((a) => a.kind === K_ATTACK);
    expect(attacks.map((a) => s.ptype[a.target])).toEqual([...attacks.map((a) => s.ptype[a.target])].sort((x, y) => y - x));
    expect(kinds.slice(firstAttack + attacks.length).every((k) => k !== K_ATTACK && k !== K_EXIT)).toBe(true);
  });

  it('Difficile adapte son temps à sa pendule', () => {
    expect(thinkBudget({ level: 'hard' })).toBe(1500);
    expect(thinkBudget({ level: 'hard', clockMs: 600_000 })).toBe(1500); // 10 min : limite habituelle
    expect(thinkBudget({ level: 'hard', clockMs: 15_000 })).toBe(500); // 1/30 du temps restant
    expect(thinkBudget({ level: 'hard', clockMs: 500 })).toBe(60); // plancher
    const g = LocalEngine.create('random', 'CLOCK').getState();
    const r = chooseMove(g, { level: 'hard', seed: 1, clockMs: 6_000 });
    expect(r.info.ms).toBeLessThan(450);
    expect(r.move).not.toBeNull();
  });
});

describe('échelle de difficulté 1 à 10', () => {
  it('chaque niveau joue un coup légal', async () => {
    const { AI_LEVELS } = await import('../src/engine/ai/search');
    const eng = LocalEngine.create('highlands', 'LADDER');
    for (const n of Object.keys(AI_LEVELS).map(Number)) {
      const r = chooseMove(eng.getState(), { level: n, seed: 1, timeMs: n >= 6 ? 150 : undefined });
      expect(r.move, `niveau ${n}`).not.toBeNull();
      expect(eng.getLegalMoves(r.move!.pieceId)).toContainEqual(r.move);
    }
  });

  it('les anciens noms correspondent aux niveaux 3, 5 et 9', async () => {
    const { levelNumber } = await import('../src/engine/ai/search');
    expect([levelNumber('easy'), levelNumber('medium'), levelNumber('hard')]).toEqual([3, 5, 9]);
    expect([levelNumber(0), levelNumber(42), levelNumber(6.4)]).toEqual([1, 10, 6]);
  });

  it('les ressources augmentent avec le niveau (temps et profondeur)', async () => {
    const { AI_LEVELS, thinkBudget } = await import('../src/engine/ai/search');
    const budgets = [6, 7, 8, 9, 10].map((n) => thinkBudget({ level: n }));
    expect(budgets).toEqual([1500, 500, 1000, 1500, 3000]);
    expect(AI_LEVELS[6].maxDepth).toBe(3);
    // La pendule plafonne toujours la réflexion (1/30 du temps restant).
    expect(thinkBudget({ level: 10, clockMs: 30_000 })).toBe(1000);
  });

  it('niveau 1 : coups au hasard (variés selon la seed)', () => {
    const g = LocalEngine.create('woods', 'RAND').getState();
    const picks = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(chooseMove(g, { level: 1, seed: i }).move)));
    expect(picks.size).toBeGreaterThan(4);
  });
});
