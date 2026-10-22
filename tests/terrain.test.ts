import { describe, expect, it } from 'vitest';
import { generateTerrain, isRotationSymmetric, maxNeighborDiff, TERRAIN_MODES } from '../src/engine/terrain';
import { RULES } from '../src/engine/rules';

describe('générateur de terrain', () => {
  for (const { id, label } of TERRAIN_MODES) {
    it(`${label} : contrainte ≤ 2, symétrie et bornes sur 1 000 seeds`, () => {
      for (let i = 0; i < 1000; i++) {
        const t = generateTerrain(id, `seed-${i}`);
        expect(t.heights.length).toBe(RULES.board.size);
        expect(maxNeighborDiff(t)).toBeLessThanOrEqual(RULES.board.maxNeighborDelta);
        expect(isRotationSymmetric(t)).toBe(true);
        const flat = t.heights.flat();
        expect(flat.every((h) => Number.isInteger(h))).toBe(true);
        expect(Math.min(...flat)).toBeGreaterThanOrEqual(RULES.board.minHeight);
        expect(Math.max(...flat)).toBeLessThanOrEqual(RULES.board.maxHeight);
      }
    });
  }

  it('est déterministe : même seed et même mode → même plateau', () => {
    expect(generateTerrain('mountains', 'ABC123')).toEqual(generateTerrain('mountains', 'ABC123'));
    expect(generateTerrain('mountains', 'ABC123')).not.toEqual(generateTerrain('mountains', 'ABC124'));
  });

  it('les modes ont des caractères distincts (hauteur moyenne)', () => {
    const mean = (mode: Parameters<typeof generateTerrain>[0]) => {
      let s = 0;
      for (let i = 0; i < 200; i++) for (const row of generateTerrain(mode, `m${i}`).heights) for (const h of row) s += h;
      return s / (200 * 100);
    };
    // Le désert et les bois restent bas ; les vallées sont un plateau haut creusé.
    expect(mean('desert')).toBeLessThan(mean('woods') + 0.5);
    expect(mean('woods')).toBeLessThan(mean('valleys'));
  });
});
