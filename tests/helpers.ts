// Outils de test : plateaux et positions sur mesure.
import type { GameState, MoveRecord, Piece } from '../src/engine/types';
import type { PieceType, PlayerId } from '../src/engine/rules';

/** Plateau 10×10 plat (hauteur 0) avec quelques hauteurs imposées [rangée, colonne, hauteur]. */
export function flat(overrides: [number, number, number][] = []): number[][] {
  const h = Array.from({ length: 10 }, () => Array(10).fill(0));
  for (const [r, c, v] of overrides) h[r][c] = v;
  return h;
}

let n = 0;
export const piece = (type: PieceType, player: PlayerId, row: number, col: number, status: Piece['status'] = 'board'): Piece => ({
  id: `t${n++}-${player}-${type}`,
  type,
  player,
  row,
  col,
  status,
});

export function state(
  heights: number[][],
  pieces: Piece[],
  current: PlayerId = 1,
  extra: Partial<Pick<GameState, 'turn' | 'score' | 'history'>> = {},
): GameState {
  return {
    terrain: { size: 10, mode: 'random', seed: 'TEST', heights },
    pieces,
    current,
    turn: extra.turn ?? 0,
    score: extra.score ?? { 1: 0, 2: 0 },
    history: extra.history ?? [],
    result: null,
  };
}

/** Faux enregistrement de sortie (pour reconstituer « qui est sorti en premier »). */
export const exitRecord = (p: Piece): MoveRecord => ({
  player: p.player,
  move: { pieceId: p.id, path: [{ row: p.row, col: p.col }], cost: 1, kind: 'exit' },
  notation: 'test',
});

export const dest = (m: { path: { row: number; col: number }[] }) => m.path[m.path.length - 1];
