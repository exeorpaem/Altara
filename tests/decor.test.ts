import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { avoidCampColor, buildDecor, decorPalette, classifyCells, DECOR_TRIANGLE_BUDGET } from '../src/render/decor';
import { MODE_SKIN, SKINS, skinById, skinForMode } from '../src/render/skins';
import { PALETTE } from '../src/render/palette';
import { generateTerrain, TERRAIN_MODES } from '../src/engine/terrain';

describe('classifyCells', () => {
  it('reconnaît un sommet, une cuvette et un plat', () => {
    const peak = classifyCells([[1, 1, 1], [1, 2, 1], [1, 1, 1]]);
    expect(peak[1][1]).toBe('summit');
    const pit = classifyCells([[2, 2, 2], [2, 1, 2], [2, 2, 2]]);
    expect(pit[1][1]).toBe('basin');
    const flat = classifyCells([[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
    expect(flat[1][1]).toBe('flat');
  });

  it('reconnaît une falaise (|Δh| = 2)', () => {
    const g = classifyCells([[0, 0, 0], [0, 0, 2], [0, 0, 2]]);
    expect(g[1][1]).toBe('cliff');
    expect(g[1][2]).toBe('cliff'); // la case haute voit aussi le dénivelé de 2
  });

  it('reconnaît un plateau (≥ 3 voisins de même hauteur, pas tous) et une pente', () => {
    const g = classifyCells([[3, 3, 3], [3, 3, 4], [3, 3, 3]]);
    expect(g[1][1]).toBe('plateau');
    const s = classifyCells([[0, 1, 2], [0, 1, 2], [0, 1, 2]]);
    expect(s[1][1]).toBe('slope');
  });

  it('est symétrique sur un terrain symétrique (rotation 180°)', () => {
    const t = generateTerrain('mountains', 'KNVDF0');
    const k = classifyCells(t.heights);
    const n = t.size;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) expect(k[r][c]).toBe(k[n - 1 - r][n - 1 - c]);
  });
});

describe('buildDecor', () => {
  it('respecte le budget de triangles pour chaque mode avec sa palette et se libère proprement', () => {
    for (const m of TERRAIN_MODES) {
      const d = buildDecor(generateTerrain(m.id, 'KNVDF0'), skinForMode(m.id));
      expect(d.stats.triangles).toBeGreaterThan(500);
      expect(d.stats.triangles).toBeLessThanOrEqual(DECOR_TRIANGLE_BUDGET);
      expect(d.stats.drawCalls).toBeLessThanOrEqual(4);
      d.dispose();
    }
  });

  it('est déterministe pour une même seed', () => {
    const t = generateTerrain('woods', 'ABC123');
    const a = buildDecor(t, skinForMode('woods'));
    const b = buildDecor(t, skinForMode('woods'));
    expect(a.stats.triangles).toBe(b.stats.triangles);
    const pa = (a.group.children[0] as THREE.Mesh).geometry.attributes.position.array;
    const pb = (b.group.children[0] as THREE.Mesh).geometry.attributes.position.array;
    expect(Array.from(pa.slice(0, 60))).toEqual(Array.from(pb.slice(0, 60)));
  });

  it('les détails des cases restent bas (≤ 0,15 au-dessus de la case) ', () => {
    const t = generateTerrain('valleys', 'KNVDF0');
    const d = buildDecor(t, skinForMode('valleys'));
    const mesh = d.group.getObjectByName('decor-surface') as THREE.Mesh;
    const pos = mesh.geometry.attributes.position;
    const n = t.size;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const col = Math.min(n - 1, Math.max(0, Math.round(x + (n - 1) / 2)));
      const row = Math.min(n - 1, Math.max(0, Math.round((n - 1) / 2 - z)));
      // Un détail peut déborder un peu sur la case voisine : on prend la plus haute de la zone 3×3.
      let hmax = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) hmax = Math.max(hmax, t.heights[Math.min(n - 1, Math.max(0, row + dr))][Math.min(n - 1, Math.max(0, col + dc))]);
      const top = (hmax + 1) * 0.3;
      expect(y - top).toBeLessThanOrEqual(0.16);
    }
    d.dispose();
  });
});

describe('couleurs', () => {
  it('désature toute teinte proche d’un camp', () => {
    const coral = avoidCampColor(new THREE.Color(PALETTE.camp[1]));
    const hsl = { h: 0, s: 0, l: 0 };
    coral.getHSL(hsl);
    expect(hsl.s).toBeLessThan(0.3);
  });
});

describe('palettes par mode', () => {
  it('chaque mode a sa palette, et chaque palette sert un mode', () => {
    for (const m of TERRAIN_MODES) expect(skinById(MODE_SKIN[m.id]).id).toBe(MODE_SKIN[m.id]);
    expect(new Set(TERRAIN_MODES.map((m) => MODE_SKIN[m.id])).size).toBe(TERRAIN_MODES.length);
    expect(SKINS.length).toBe(TERRAIN_MODES.length);
  });

  it('aucune couleur de palette (ni de décor) ne ressemble aux camps corail / lagon', () => {
    const camps = (Object.values(PALETTE.camp) as string[]).map((c) => {
      const h = { h: 0, s: 0, l: 0 };
      new THREE.Color(c).getHSL(h);
      return h.h;
    });
    const clash = (c: THREE.Color) => {
      const h = { h: 0, s: 0, l: 0 };
      c.getHSL(h);
      return camps.some((ch) => Math.min(Math.abs(h.h - ch), 1 - Math.abs(h.h - ch)) < 0.05 && h.s > 0.3);
    };
    for (const m of TERRAIN_MODES) {
      const sk = skinForMode(m.id);
      const cols = [sk.low, sk.high, sk.hollow, sk.line, sk.slab, sk.rock]; // ciel / brume exclus : fonds clairs lointains;
      for (const c of cols) expect(clash(new THREE.Color(c)), `${m.id} ${c}`).toBe(false);
      const pal = decorPalette(sk, m.id);
      for (const v of Object.values(pal)) for (const c of Array.isArray(v) ? v : [v]) expect(clash(c), `${m.id} décor`).toBe(false);
    }
  });
});
