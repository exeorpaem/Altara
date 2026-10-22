import { describe, expect, it } from 'vitest';
import { LocalEngine } from '../src/engine/engine';
import { RULES } from '../src/engine/rules';
import { exitRecord, flat, piece, state } from './helpers';
import type { GameState, Move } from '../src/engine/types';

const exitOf = (eng: LocalEngine, id: string) => eng.getLegalMoves(id).find((m) => m.kind === 'exit')!;
const anyMove = (eng: LocalEngine, id: string) => eng.getLegalMoves(id).find((m) => m.kind === 'move')!;

describe('score', () => {
  it("une sortie rapporte la Force de la pièce et la retire du plateau", () => {
    const v = piece('vanguard', 1, 9, 4);
    const spare = piece('explorer', 1, 2, 2); // J1 garde une pièce sur le plateau
    const foe = piece('explorer', 2, 5, 5);
    const eng = new LocalEngine(state(flat(), [v, spare, foe]));
    eng.play(exitOf(eng, v.id));
    const s = eng.getState();
    expect(s.score).toEqual({ 1: 2, 2: 0 });
    expect(s.pieces.find((p) => p.id === v.id)!.status).toBe('exited');
    expect(s.result).toBeNull(); // une seule sortie : la partie continue
  });
});

describe('victoire de la Sentinelle', () => {
  it('une Sentinelle qui sort en premier fait gagner son camp', () => {
    const s = piece('sentinel', 2, 0, 4); // J2 sort par la rangée 0
    const foe = piece('explorer', 1, 5, 5);
    const eng = new LocalEngine(state(flat(), [s, foe], 2));
    eng.play(exitOf(eng, s.id));
    expect(eng.getState().result).toEqual({ winner: 2, reason: 'sentinel' });
    expect(eng.getLegalMoves(foe.id)).toHaveLength(0); // partie terminée
  });

  it("une Sentinelle qui sort en deuxième ne gagne PAS : sortie ordinaire", () => {
    // J1 a déjà fait sortir une Avant-garde… puis J2 sort une Sentinelle : la partie continue.
    const out = piece('vanguard', 1, 9, 2, 'exited');
    const s2 = piece('sentinel', 2, 0, 4);
    const spare = piece('explorer', 2, 7, 7); // J2 garde une pièce sur le plateau
    const j1 = piece('explorer', 1, 5, 5);
    const eng = new LocalEngine(state(flat(), [out, s2, spare, j1], 2, { score: { 1: 2, 2: 0 }, history: [exitRecord(out)] }));
    eng.play(exitOf(eng, s2.id));
    const st = eng.getState();
    expect(st.result).toBeNull();
    expect(st.score).toEqual({ 1: 2, 2: 3 }); // elle rapporte quand même sa Force
  });

  it('une Sentinelle sortie en deuxième compte pour la règle des 2 sorties', () => {
    // J2 a déjà sorti un Explorateur : sa Sentinelle est sa 2e sortie, J2 gagne par 2e sortie.
    const out = piece('explorer', 2, 0, 2, 'exited');
    const s2 = piece('sentinel', 2, 0, 4);
    const j1 = piece('explorer', 1, 5, 5);
    const eng = new LocalEngine(state(flat(), [out, s2, j1], 2, { score: { 1: 0, 2: 1 }, history: [exitRecord(out)] }));
    eng.play(exitOf(eng, s2.id));
    expect(eng.getState().result).toEqual({ winner: 2, reason: 'secondExit' });
  });
});

describe('élimination', () => {
  it("capturer la dernière pièce adverse fait gagner", () => {
    const atk = piece('sentinel', 1, 4, 4);
    const last = piece('explorer', 2, 4, 5);
    const gone = piece('vanguard', 2, 0, 0, 'captured');
    const eng = new LocalEngine(state(flat(), [atk, last, gone]));
    const m = eng.getLegalMoves(atk.id).find((x) => x.kind === 'attack' && x.targetId === last.id)!;
    eng.play(m);
    expect(eng.getState().result).toEqual({ winner: 1, reason: 'eliminated' });
  });

  // Sortie de la dernière pièce : on compare ses points au maximum atteignable par l'adversaire.
  const lastExit = (foeScore: number, foeType: 'explorer' | 'vanguard' | 'sentinel') => {
    const v = piece('vanguard', 1, 9, 4); // sortie : J1 aura 2 points
    const gone = piece('explorer', 1, 0, 0, 'captured');
    const foe = piece(foeType, 2, 5, 5);
    const eng = new LocalEngine(state(flat(), [v, gone, foe], 1, { score: { 1: 0, 2: foeScore } }));
    eng.play(exitOf(eng, v.id));
    return eng.getState().result;
  };
  it("dernière pièce sortie : l'adversaire ne peut plus égaler → victoire", () => {
    expect(lastExit(0, 'explorer')).toEqual({ winner: 1, reason: 'eliminated' }); // 0 + 1 < 2
  });
  it("dernière pièce sortie : l'adversaire peut au mieux égaler → nulle", () => {
    expect(lastExit(0, 'vanguard')).toEqual({ winner: 'draw', reason: 'eliminated' }); // 0 + 2 = 2
  });
  it("dernière pièce sortie : l'adversaire peut dépasser → défaite", () => {
    expect(lastExit(0, 'sentinel')).toEqual({ winner: 2, reason: 'eliminated' }); // 0 + 3 > 2
  });
});

describe('fin par deuxième sortie', () => {
  it('le premier joueur qui fait sortir sa 2e pièce gagne', () => {
    const out = piece('explorer', 1, 9, 2, 'exited');
    const e2 = piece('explorer', 1, 9, 6);
    const foe = piece('sentinel', 2, 4, 4);
    const eng = new LocalEngine(state(flat(), [out, e2, foe], 1, { score: { 1: 1, 2: 0 }, history: [exitRecord(out)] }));
    eng.play(exitOf(eng, e2.id));
    expect(eng.getState().result).toEqual({ winner: 1, reason: 'secondExit' });
  });

  it('une sortie de chaque camp ne termine pas la partie', () => {
    const out = piece('vanguard', 2, 0, 2, 'exited'); // J2 a sorti une pièce
    const v1 = piece('vanguard', 1, 9, 4); // J1 sort sa première
    const spare = piece('explorer', 1, 2, 2); // J1 garde une pièce sur le plateau
    const j2 = piece('explorer', 2, 5, 5);
    const eng = new LocalEngine(state(flat(), [out, v1, spare, j2], 1, { score: { 1: 0, 2: 2 }, history: [exitRecord(out)] }));
    eng.play(exitOf(eng, v1.id));
    expect(eng.getState().result).toBeNull();
    expect(eng.getState().score).toEqual({ 1: 2, 2: 2 });
  });

  it("une pièce capturée ne compte pas comme sortie", () => {
    // J1 a perdu une pièce (capturée) et en a sorti une : sa prochaine sortie est la 2e et gagne,
    // la capture n'a rien avancé (ni pour lui, ni pour l'adversaire).
    const lost = piece('vanguard', 1, 4, 4, 'captured');
    const out = piece('explorer', 1, 9, 2, 'exited');
    const e2 = piece('explorer', 1, 8, 6);
    const j2 = piece('sentinel', 2, 4, 8);
    const g = state(flat(), [lost, out, e2, j2], 1, { score: { 1: 1, 2: 0 }, history: [exitRecord(out)] });
    const eng = new LocalEngine(g);
    // Avant la sortie : un seul « sorti » pour J1 malgré la pièce capturée.
    eng.play(eng.getLegalMoves(e2.id).find((m) => m.kind === 'move' && m.path.at(-1)!.row === 8)!);
    expect(eng.getState().result).toBeNull();
  });
});

describe('limite de coups', () => {
  const last = RULES.maxTurns - 1;
  const atLimit = (g: GameState, mover: string) => {
    const eng = new LocalEngine(g);
    eng.play(anyMove(eng, mover) as Move);
    return eng.getState();
  };

  it('le score le plus élevé gagne', () => {
    const out = piece('explorer', 2, 0, 0, 'exited');
    const a = piece('sentinel', 1, 8, 4);
    const b = piece('sentinel', 2, 8, 8);
    const s = atLimit(state(flat(), [out, a, b], 1, { turn: last, score: { 1: 0, 2: 1 }, history: [exitRecord(out)] }), a.id);
    expect(s.turn).toBe(RULES.maxTurns);
    expect(s.result).toEqual({ winner: 2, reason: 'moveLimit' });
  });

  it('sans score : la pièce la plus avancée gagne', () => {
    const a = piece('explorer', 1, 1, 0); // J1 : il lui reste 8 rangées au mieux…
    const a2 = piece('explorer', 1, 7, 9); // …non : 2 rangées
    const b = piece('sentinel', 2, 3, 5); // J2 : 3 rangées
    const s = atLimit(state(flat(), [a, a2, b], 1, { turn: last }), a.id);
    expect(s.result).toEqual({ winner: 1, reason: 'moveLimit' });
  });

  it('sans score, à avancée égale : la plus grande Force gagne', () => {
    const a = piece('explorer', 1, 7, 0); // 2 rangées, Force 1
    const b = piece('vanguard', 2, 2, 9); // 2 rangées, Force 2
    const s = atLimit(state(flat(), [a, b], 1, { turn: last }), a.id);
    // Le coup de J1 peut faire avancer son Explorateur : on choisit un coup qui reste à 2 rangées.
    expect(s.result?.reason).toBe('moveLimit');
    const eng = new LocalEngine(state(flat(), [a, b], 1, { turn: last }));
    const sideways = eng.getLegalMoves(a.id).find((m) => m.kind === 'move' && m.path.at(-1)!.row === 7)!;
    eng.play(sideways);
    expect(eng.getState().result).toEqual({ winner: 2, reason: 'moveLimit' });
  });

  it('sans score, avancée et Force égales : nulle', () => {
    const a = piece('vanguard', 1, 7, 0);
    const b = piece('vanguard', 2, 2, 9);
    const eng = new LocalEngine(state(flat(), [a, b], 1, { turn: last }));
    eng.play(eng.getLegalMoves(a.id).find((m) => m.kind === 'move' && m.path.at(-1)!.row === 7)!);
    expect(eng.getState().result).toEqual({ winner: 'draw', reason: 'moveLimit' });
  });

  it('pas de fin avant la limite', () => {
    const a = piece('vanguard', 1, 4, 0);
    const b = piece('vanguard', 2, 4, 9);
    const s = atLimit(state(flat(), [a, b], 1, { turn: last - 1 }), a.id);
    expect(s.result).toBeNull();
  });
});

describe('passe', () => {
  /** J2 : une Sentinelle enfermée dans le coin (9,0) par des pièces J1 qu'elle ne peut pas attaquer. */
  function cage() {
    const prisoner = piece('sentinel', 2, 9, 0);
    const w1 = piece('sentinel', 1, 8, 0);
    const w2 = piece('sentinel', 1, 9, 1);
    const glue = piece('explorer', 1, 8, 1); // renfort des deux gardiens (défense 4 > 3)
    const free = piece('vanguard', 1, 3, 5);
    return { prisoner, pieces: [prisoner, w1, w2, glue, free], free };
  }

  it('un joueur sans coup légal passe son tour (et c’est enregistré)', () => {
    const { pieces, free, prisoner } = cage();
    const eng = new LocalEngine(state(flat(), pieces));
    expect(eng.getLegalMoves(free.id).length).toBeGreaterThan(0);
    eng.play(anyMove(eng, free.id));
    const s = eng.getState();
    expect(s.current).toBe(1); // J2 a passé
    expect(s.turn).toBe(2); // la passe compte comme un coup
    expect(s.history.at(-1)).toMatchObject({ player: 2, pass: true });
    expect(s.pieces.find((p) => p.id === prisoner.id)!.row).toBe(9);
  });

  it('si les deux camps sont bloqués, les passes s’enchaînent jusqu’à la limite de coups', () => {
    // Deux Sentinelles au fond de puits (voisins à +4 : chaque pas coûterait 5 > 3).
    const pit = (r: number, c: number): [number, number, number][] => [
      [r - 1, c, 4],
      [r + 1, c, 4],
      [r, c - 1, 4],
      [r, c + 1, 4],
    ];
    const h = flat([...pit(5, 2), ...pit(5, 7)]);
    const s1 = piece('sentinel', 1, 5, 2);
    const s2 = piece('sentinel', 2, 5, 7);
    const v1 = piece('vanguard', 1, 9, 4); // seule pièce mobile : elle sort
    const eng = new LocalEngine(state(h, [s1, s2, v1]));
    eng.play(exitOf(eng, v1.id));
    const s = eng.getState();
    expect(s.turn).toBe(RULES.maxTurns);
    expect(s.history.filter((r) => r.pass)).toHaveLength(RULES.maxTurns - 1);
    expect(s.result).toEqual({ winner: 1, reason: 'moveLimit' }); // J1 a marqué 2, J2 rien
  });
});
