import { describe, expect, it } from 'vitest';
import { legalMoves, stepCost, DEFAULT_MOVEMENT_OPTIONS } from '../src/engine/movement';
import { LocalEngine } from '../src/engine/engine';
import type { GameState, Piece } from '../src/engine/types';
import type { PieceType, PlayerId } from '../src/engine/rules';

/** Plateau 10×10 plat (hauteur 0) avec quelques hauteurs imposées. */
function flat(overrides: [number, number, number][] = []): number[][] {
  const h = Array.from({ length: 10 }, () => Array(10).fill(0));
  for (const [r, c, v] of overrides) h[r][c] = v;
  return h;
}

let n = 0;
const piece = (type: PieceType, player: PlayerId, row: number, col: number): Piece => ({
  id: `t${n++}`,
  type,
  player,
  row,
  col,
  status: 'board',
});

function state(heights: number[][], pieces: Piece[], current: PlayerId = 1): GameState {
  return {
    terrain: { size: 10, mode: 'random', seed: 'TEST', heights },
    pieces,
    current,
    turn: 0,
    score: { 1: 0, 2: 0 },
    history: [],
  };
}

const dest = (m: { path: { row: number; col: number }[] }) => m.path[m.path.length - 1];
const at = (moves: ReturnType<typeof legalMoves>, r: number, c: number, kind = 'move') =>
  moves.find((m) => m.kind === kind && dest(m).row === r && dest(m).col === c);

describe('coût des pas', () => {
  it('1 à hauteur égale, |Δh| + 1 sinon, en montée comme en descente', () => {
    expect(stepCost(2, 2)).toBe(1);
    expect(stepCost(0, 1)).toBe(2);
    expect(stepCost(0, 2)).toBe(3);
    expect(stepCost(2, 0)).toBe(3);
    expect(stepCost(3, 2)).toBe(2);
  });

  it('une montée de 2 coûte 3 ; le Dijkstra contourne une colline trop chère', () => {
    // Sentinelle (M3) en (4,4), colline de hauteur 2 en (4,5)
    const s = piece('sentinel', 1, 4, 4);
    const moves = legalMoves(state(flat([[4, 5, 2]]), [s]), s.id);
    expect(at(moves, 4, 5)?.cost).toBe(3);
    expect(at(moves, 4, 6)).toBeUndefined(); // 3 + 3 par la colline, 4 en contournant : hors budget
    // Avant-garde (M4) : (4,6) atteignable en contournant (4 pas plats) plutôt qu'en franchissant (6)
    const v = piece('vanguard', 1, 4, 4);
    const mv = legalMoves(state(flat([[4, 5, 2]]), [v]), v.id);
    expect(at(mv, 4, 6)?.cost).toBe(4);
    expect(at(mv, 4, 6)?.path.some((c) => c.row === 4 && c.col === 5)).toBe(false);
  });

  it('la descente coûte comme la montée', () => {
    const s = piece('sentinel', 1, 4, 4);
    const moves = legalMoves(state(flat([[4, 4, 2], [4, 5, 0], [4, 3, 1]]), [s]), s.id);
    expect(at(moves, 4, 5)?.cost).toBe(3);
    expect(at(moves, 4, 3)?.cost).toBe(2);
  });

  it('respecte le budget de Mouvement et choisit le chemin le moins cher', () => {
    const e = piece('vanguard', 1, 0, 0); // M4
    const moves = legalMoves(state(flat(), [e]), e.id);
    expect(at(moves, 0, 4)?.cost).toBe(4);
    expect(at(moves, 0, 5)).toBeUndefined();
    expect(at(moves, 2, 2)?.cost).toBe(4);
    for (const m of moves) {
      if (m.kind !== 'move') continue;
      // Le chemin est continu, orthogonal, et son coût correspond au coût annoncé.
      let sum = 0;
      for (let i = 1; i < m.path.length; i++) {
        const a = m.path[i - 1];
        const b = m.path[i];
        expect(Math.abs(a.row - b.row) + Math.abs(a.col - b.col)).toBe(1);
        sum += 1;
      }
      expect(sum).toBe(m.cost);
    }
  });
});

describe('blocage par les pièces', () => {
  it('ne traverse ni allié ni ennemi', () => {
    // Sentinelle (M3) en (0,4) dans un couloir : murs de hauteur 6 de chaque côté.
    const walls: [number, number, number][] = [];
    for (let r = 0; r < 10; r++) walls.push([r, 3, 6], [r, 5, 6]);
    const s = piece('sentinel', 1, 0, 4);
    const ally = piece('vanguard', 1, 1, 4);
    const moves = legalMoves(state(flat(walls), [s, ally]), s.id);
    expect(moves.filter((m) => m.kind === 'move')).toHaveLength(0);

    const enemy = piece('vanguard', 2, 2, 4);
    const moves2 = legalMoves(state(flat(walls), [s, enemy]), s.id);
    expect(at(moves2, 1, 4)).toBeDefined();
    expect(at(moves2, 3, 4)).toBeUndefined(); // derrière l'ennemi
  });

  it("ne peut pas finir sur une case occupée", () => {
    const s = piece('sentinel', 1, 4, 4);
    const other = piece('explorer', 1, 4, 5);
    const moves = legalMoves(state(flat(), [s, other]), s.id);
    expect(moves.some((m) => m.kind !== 'attack' && dest(m).row === 4 && dest(m).col === 5)).toBe(false);
  });
});

describe('case de départ', () => {
  it("n'est jamais une destination, même par un aller-retour", () => {
    const s = piece('sentinel', 1, 4, 4);
    const moves = legalMoves(state(flat(), [s]), s.id);
    expect(moves.some((m) => m.kind === 'move' && dest(m).row === 4 && dest(m).col === 4)).toBe(false);
  });
});

describe("coups spéciaux de l'Explorateur", () => {
  it('pas diagonal et bond de 2 en ignorant la hauteur', () => {
    const e = piece('explorer', 1, 4, 4);
    const h = flat([
      [5, 5, 6],
      [6, 4, 6],
      [5, 4, 3],
    ]);
    const moves = legalMoves(state(h, [e]), e.id);
    expect(at(moves, 5, 5, 'explorerDiagonal')).toBeDefined();
    expect(at(moves, 3, 3, 'explorerDiagonal')).toBeDefined();
    expect(at(moves, 6, 4, 'explorerLeap')).toBeDefined();
    expect(at(moves, 4, 6, 'explorerLeap')).toBeDefined();
    expect(moves.filter((m) => m.kind === 'explorerDiagonal')).toHaveLength(4);
    expect(moves.filter((m) => m.kind === 'explorerLeap')).toHaveLength(4);
  });

  it("la case d'arrivée doit être vide", () => {
    const e = piece('explorer', 1, 4, 4);
    const blocker = piece('sentinel', 2, 5, 5);
    const ally = piece('sentinel', 1, 4, 6);
    const moves = legalMoves(state(flat(), [e, blocker, ally]), e.id);
    expect(at(moves, 5, 5, 'explorerDiagonal')).toBeUndefined();
    expect(at(moves, 4, 6, 'explorerLeap')).toBeUndefined();
  });

  it('le bond ne passe pas par-dessus une pièce (case intermédiaire occupée)', () => {
    const e = piece('explorer', 1, 4, 4);
    const midAlly = piece('sentinel', 1, 4, 5);
    const midFoe = piece('sentinel', 2, 5, 4);
    const moves = legalMoves(state(flat(), [e, midAlly, midFoe]), e.id);
    expect(at(moves, 4, 6, 'explorerLeap')).toBeUndefined();
    expect(at(moves, 6, 4, 'explorerLeap')).toBeUndefined();
    expect(at(moves, 4, 2, 'explorerLeap')).toBeDefined(); // côté libre
    // L'option reste réglable dans rules.ts
    const loose = legalMoves(state(flat(), [e, midAlly, midFoe]), e.id, { ...DEFAULT_MOVEMENT_OPTIONS, leapOverPieces: true });
    expect(at(loose, 4, 6, 'explorerLeap')).toBeDefined();
  });

  it("les coups spéciaux ne servent pas à attaquer", () => {
    // Ennemi faible en diagonale et à 2 cases, sur un terrain qui rend toute approche normale impossible.
    const e = piece('explorer', 1, 4, 4);
    const foeDiag = piece('explorer', 2, 5, 5);
    const foeLeap = piece('explorer', 2, 2, 4);
    const walls: [number, number, number][] = [
      [4, 4, 6], // l'Explorateur est sur un pic : chaque pas coûte 3 au minimum
      [3, 4, 4],
      [5, 4, 4],
      [4, 3, 4],
      [4, 5, 4],
    ];
    const moves = legalMoves(state(flat(walls), [e, foeDiag, foeLeap]), e.id);
    expect(moves.some((m) => m.kind === 'attack')).toBe(false);
    // Aucun coup spécial ne vise une case occupée par un ennemi
    expect(moves.some((m) => m.kind.startsWith('explorer') && [foeDiag, foeLeap].some((f) => dest(m).row === f.row && dest(m).col === f.col))).toBe(false);
  });

  it('ne sort pas du plateau', () => {
    const e = piece('explorer', 1, 0, 0);
    const moves = legalMoves(state(flat(), [e]), e.id);
    expect(moves.filter((m) => m.kind === 'explorerDiagonal')).toHaveLength(1);
    expect(moves.filter((m) => m.kind === 'explorerLeap')).toHaveLength(2);
  });

  it("les autres pièces n'ont pas de coup spécial", () => {
    const s = piece('vanguard', 1, 4, 4);
    expect(legalMoves(state(flat(), [s]), s.id).some((m) => m.kind.startsWith('explorer'))).toBe(false);
  });
});

describe('sortie', () => {
  it('possible si la pièce atteint la dernière rangée avec au moins 1 point restant', () => {
    const s = piece('sentinel', 1, 7, 4); // M3 : 2 pas jusqu'à la rangée 9, +1 pour sortir = 3
    const moves = legalMoves(state(flat(), [s]), s.id);
    const exits = moves.filter((m) => m.kind === 'exit');
    expect(exits.length).toBe(1);
    expect(exits[0].cost).toBe(3);
    expect(dest(exits[0])).toEqual({ row: 9, col: 4 });
  });

  it('impossible sans point restant', () => {
    const s = piece('sentinel', 1, 6, 4); // 3 pas pour atteindre la rangée 9 : plus rien pour sortir
    const moves = legalMoves(state(flat(), [s]), s.id);
    expect(moves.some((m) => m.kind === 'exit')).toBe(false);
    expect(at(moves, 9, 4)).toBeDefined(); // mais elle peut s'y arrêter
  });

  it('une pièce déjà sur la rangée d’arrivée sort pour 1', () => {
    const s = piece('sentinel', 1, 9, 4);
    const exit = legalMoves(state(flat(), [s]), s.id).find((m) => m.kind === 'exit' && dest(m).col === 4);
    expect(exit?.cost).toBe(1);
    expect(exit?.path).toHaveLength(1);
  });

  it('J2 sort par la rangée 0, jamais par la rangée 9', () => {
    const s = piece('sentinel', 2, 1, 4);
    const exits = legalMoves(state(flat(), [s], 2), s.id).filter((m) => m.kind === 'exit');
    expect(exits.every((m) => dest(m).row === 0)).toBe(true);
    expect(exits.length).toBeGreaterThan(0);
  });

  it('le dénivelé compte avant la sortie', () => {
    const s = piece('sentinel', 1, 8, 4);
    const moves = legalMoves(state(flat([[9, 3, 2], [9, 4, 2], [9, 5, 2]]), [s]), s.id);
    // monter en (9,4) coûte 3 : plus de point pour sortir ; la sortie passe par une case plate
    expect(moves.some((m) => m.kind === 'exit' && dest(m).col === 4)).toBe(false);
  });
});

describe('attaque (liste seulement)', () => {
  it('cible un ennemi atteignable ; coût = chemin + entrée sur sa case', () => {
    const s = piece('sentinel', 1, 4, 4);
    const foe = piece('explorer', 2, 4, 6);
    const att = legalMoves(state(flat(), [s, foe]), s.id).find((m) => m.kind === 'attack');
    expect(att?.targetId).toBe(foe.id);
    expect(att?.cost).toBe(2);
    expect(dest(att!)).toEqual({ row: 4, col: 6 });
  });

  it("n'attaque pas un allié ni un ennemi hors de portée", () => {
    const s = piece('sentinel', 1, 0, 0);
    const ally = piece('sentinel', 1, 0, 1);
    const far = piece('sentinel', 2, 5, 5);
    expect(legalMoves(state(flat(), [s, ally, far]), s.id).some((m) => m.kind === 'attack')).toBe(false);
  });
});

describe('moteur local', () => {
  it('joue, alterne les joueurs et annule', () => {
    const eng = LocalEngine.create('woods', 'ABC');
    const p = eng.getState().pieces.find((x) => x.player === 1 && x.type === 'explorer')!;
    const move = eng.getLegalMoves(p.id).find((m) => m.kind === 'explorerDiagonal')!;
    eng.play(move);
    expect(eng.getState().current).toBe(2);
    expect(eng.getState().history[0].notation).toMatch(/^E /);
    expect(eng.getState().result).toBeNull();
    expect(eng.getLegalMoves(p.id)).toHaveLength(0); // ce n'est plus son tour
    eng.undo();
    expect(eng.getState().current).toBe(1);
    const restored = new LocalEngine(eng.getState());
    restored.load(eng.serialize());
    expect(restored.getState()).toEqual(eng.getState());
  });
});

describe('position de départ', () => {
  it('les deux formations sont centrées (2 cases libres de chaque côté) et symétriques', async () => {
    const { initialPieces } = await import('../src/engine/engine');
    const pieces = initialPieces(10);
    for (const pl of [1, 2] as const) {
      const cols = pieces.filter((p) => p.player === pl).map((p) => p.col).sort((a, b) => a - b);
      expect(cols).toEqual([2, 3, 4, 5, 6, 7]);
    }
    // Symétrie centrale : la pièce k de J2 est l'image de la pièce k de J1.
    const j1 = pieces.filter((p) => p.player === 1);
    const j2 = pieces.filter((p) => p.player === 2);
    j1.forEach((p, k) => expect([j2[k].row, j2[k].col, j2[k].type]).toEqual([9 - p.row, 9 - p.col, p.type]));
  });
});

describe('inspection d’une pièce adverse', () => {
  it('donne exactement les coups que la pièce aurait si c’était son tour', async () => {
    const { LocalEngine } = await import('../src/engine/engine');
    const eng = LocalEngine.create('highlands', 'INSPECT');
    const foe = eng.getState().pieces.find((p) => p.player === 2 && p.type === 'explorer')!;
    expect(eng.getLegalMoves(foe.id)).toHaveLength(0); // pas son tour : non jouable
    const potential = eng.getPotentialMoves(foe.id);
    expect(potential.length).toBeGreaterThan(0);
    // Même position, mais au tour de J2 : les coups légaux sont identiques.
    const mirror = new LocalEngine({ ...structuredClone(eng.getState()), current: 2 });
    expect(mirror.getLegalMoves(foe.id)).toEqual(potential);
  });

  it('rien pour une pièce sortie/capturée ou une partie terminée', async () => {
    const { LocalEngine } = await import('../src/engine/engine');
    const eng = LocalEngine.create('woods', 'INSPECT2', { minutes: 1, incrementSec: 0 });
    const foe = eng.getState().pieces.find((p) => p.player === 2)!;
    eng.flag(1);
    expect(eng.getPotentialMoves(foe.id)).toHaveLength(0);
  });
});
