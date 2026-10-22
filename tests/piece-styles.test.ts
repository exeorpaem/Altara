import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PIECES, PIECE_TYPES, type PlayerId } from '../src/engine/rules';
import { PIECE_STYLES, pieceStyle, DEFAULT_STYLE_ID, disposePiece } from '../src/render/pieces-styles';

/** Nombre de sommets distincts du contour inférieur du socle (= nombre de côtés). */
function baseCorners(mesh: THREE.Mesh): { count: number; center: THREE.Vector2 } {
  const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
  let minY = Infinity;
  for (let i = 0; i < p.count; i++) minY = Math.min(minY, p.getY(i));
  const keys = new Map<string, THREE.Vector2>();
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getY(i) - minY) > 1e-6) continue;
    const v = new THREE.Vector2(p.getX(i), p.getZ(i));
    if (v.length() < 1e-4) continue; // centre du disque
    keys.set(`${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)}`, v); // -0 et 0 confondus (couture du tour)
  }
  const center = new THREE.Vector2();
  for (const v of keys.values()) center.add(v);
  return { count: keys.size, center: center.divideScalar(keys.size) };
}

const proposals = PIECE_STYLES.filter((s) => s.id !== 'current');

describe('styles de pièces proposés', () => {
  it('le style par défaut reste le style actuel', () => {
    expect(DEFAULT_STYLE_ID).toBe('current');
    expect(pieceStyle(null).id).toBe('current');
    expect(pieceStyle('inconnu').id).toBe('current');
  });

  for (const style of proposals) {
    describe(style.name, () => {
      for (const type of PIECE_TYPES) {
        for (const player of [1, 2] as PlayerId[]) {
          it(`${type} J${player} : socle à M côtés, N pointes, hauteur proche`, () => {
            const def = PIECES[type];
            const g = style.build({ type, player });
            g.updateMatrixWorld(true);
            const bases: THREE.Mesh[] = [];
            const spikes: THREE.Mesh[] = [];
            let tris = 0;
            g.traverse((o) => {
              const m = o as THREE.Mesh;
              if (!m.isMesh) return;
              if (m.userData.part === 'base') bases.push(m);
              if (m.userData.part === 'spike') spikes.push(m);
              const geo = m.geometry;
              tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
            });
            expect(bases).toHaveLength(1);
            const { count, center } = baseCorners(bases[0]);
            expect(count).toBe(def.movement);
            expect(center.length()).toBeLessThan(1e-3); // centré sous le fût
            expect(spikes).toHaveLength(def.strength);
            // Les pointes sont au-dessus du fût et leurs extrémités sont bien séparées.
            const tips = spikes.map((s) => {
              const box = new THREE.Box3().setFromObject(s);
              return box.max.y;
            });
            for (const t of tips) expect(t).toBeGreaterThan(def.visual.height * 0.75);
            const h = new THREE.Box3().setFromObject(g).max.y;
            expect(h).toBeGreaterThan(def.visual.height * 0.85);
            expect(h).toBeLessThan(def.visual.height * 1.12);
            expect(tris).toBeLessThan(1500); // budget raisonnable pour 12 pièces
            expect(g.userData.type).toBe(type);
            disposePiece(g);
          });
        }
      }
    });
  }
});
