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

  describe('formes des nouveaux modes', () => {
    const N = 100;
    const cells = (mode: Parameters<typeof generateTerrain>[0], pick: (r: number, c: number) => boolean) => {
      let s = 0, k = 0;
      for (let i = 0; i < N; i++) {
        const t = generateTerrain(mode, `f${i}`);
        for (let r = 0; r < t.size; r++) for (let c = 0; c < t.size; c++) if (pick(r, c)) { s += t.heights[r][c]; k++; }
      }
      return s / k;
    };
    it('volcan : centre plus haut que les bords', () => {
      const centre = cells('volcano', (r, c) => r >= 4 && r <= 5 && c >= 4 && c <= 5);
      const bords = cells('volcano', (r, c) => r === 0 || c === 0 || r === 9 || c === 9);
      expect(centre).toBeGreaterThan(bords + 2);
    });
    it('canyon : couloir central plus bas que les flancs', () => {
      const couloir = cells('canyon', (_r, c) => c >= 4 && c <= 5);
      const flancs = cells('canyon', (_r, c) => c <= 1 || c >= 8);
      expect(couloir).toBeLessThan(flancs - 1.5);
    });
    it('marais : faible amplitude', () => {
      for (let i = 0; i < N; i++) {
        const f = generateTerrain('marsh', `f${i}`).heights.flat();
        expect(Math.max(...f) - Math.min(...f)).toBeLessThanOrEqual(3);
      }
    });
    it('archipel : forte proportion de creux', () => {
      let low = 0;
      for (let i = 0; i < N; i++) low += generateTerrain('archipelago', `f${i}`).heights.flat().filter((h) => h <= 1).length;
      expect(low / (N * 100)).toBeGreaterThan(0.3);
    });
  });
});
