// Proposition D — « Origami ».
// Tout est plans pliés à arêtes vives : socle en tronc de pyramide à M pans,
// colonne plissée en étoile à M branches (plis rentrants/sortants), sommet de
// N ailettes pliées (deux triangles autour d'une arête de pli).
import * as THREE from 'three';
import { PIECES, type PieceType } from '../../engine/rules';
import { PALETTE } from '../palette';
import { baseMesh, finalize, polyBase, ringPlace, shade, spike, stdMat, type PieceBuilder } from './common';

/**
 * Colonne plissée : section en étoile à `k` branches (2k sommets, rayons
 * alternés r / r·inner), effilée de r0 à r1 et légèrement tordue. Triangles
 * indépendants (non indexés) → chaque pan reste parfaitement plat.
 */
function pleatedColumn(k: number, h: number, r0: number, r1: number, inner: number, twist: number, phi: number): THREE.BufferGeometry {
  const ring = (y: number, r: number, a0: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 2 * k; i++) {
      const a = a0 + (i / (2 * k)) * Math.PI * 2;
      const rr = i % 2 === 0 ? r : r * inner;
      pts.push(new THREE.Vector3(Math.sin(a) * rr, y, Math.cos(a) * rr));
    }
    return pts;
  };
  const lo = ring(0, r0, phi);
  const hi = ring(h, r1, phi + twist);
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  const top = new THREE.Vector3(0, h, 0);
  for (let i = 0; i < 2 * k; i++) {
    const j = (i + 1) % (2 * k);
    tri(lo[i], lo[j], hi[j]);
    tri(lo[i], hi[j], hi[i]);
    tri(hi[i], hi[j], top);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Ailette pliée : losange allongé plié le long de son axe vertical. Les deux
 * flancs reculent de `fold` vers −Z : l'arête de pli fait face à +Z (extérieur).
 */
function foldedFin(w: number, h: number, fold: number, shoulder = 0.3): THREE.BufferGeometry {
  const b = new THREE.Vector3(0, 0, 0);
  const t = new THREE.Vector3(0, h, 0);
  const l = new THREE.Vector3(-w, h * shoulder, -fold);
  const r = new THREE.Vector3(w, h * shoulder, -fold);
  const pos = [...b.toArray(), ...t.toArray(), ...l.toArray(), ...b.toArray(), ...r.toArray(), ...t.toArray()];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

interface Spec {
  baseH: number;
  colH: number;
  r0: number;
  r1: number;
  inner: number;
  twist: number;
  fin: { w: number; h: number; fold: number; ring: number; tilt: number; offset: number };
}

const SPEC: Record<PieceType, Spec> = {
  explorer: {
    baseH: 0.08,
    colH: 0.52,
    r0: 0.1,
    r1: 0.035,
    inner: 0.4,
    twist: 0.9,
    fin: { w: 0.07, h: 0.42, fold: 0.05, ring: 0, tilt: 0, offset: 0 },
  },
  vanguard: {
    baseH: 0.09,
    colH: 0.6,
    r0: 0.13,
    r1: 0.05,
    inner: 0.4,
    twist: 0.8,
    fin: { w: 0.075, h: 0.46, fold: 0.05, ring: 0.04, tilt: 0.5, offset: Math.PI / 2 },
  },
  sentinel: {
    baseH: 0.1,
    colH: 0.7,
    r0: 0.18,
    r1: 0.075,
    inner: 0.45,
    twist: 0.7,
    fin: { w: 0.08, h: 0.5, fold: 0.05, ring: 0.07, tilt: 0.36, offset: 0 },
  },
};

export const buildOrigamiPiece: PieceBuilder = ({ type, player }) => {
  const def = PIECES[type];
  const s = SPEC[type];
  const camp = PALETTE.camp[player];
  const M = def.movement;

  const matBase = stdMat(shade(camp, -0.12), { roughness: 0.8 });
  const matPaper = stdMat(shade(camp, 0.02), { roughness: 0.85, side: THREE.DoubleSide });
  const matFin = stdMat(shade(camp, 0.14), { roughness: 0.8, side: THREE.DoubleSide });

  const g = new THREE.Group();
  g.add(
    baseMesh(
      polyBase(M, def.visual.baseRadius, [
        [1, 0],
        [1, s.baseH * 0.25],
        [0.62, s.baseH],
      ]),
      matBase,
      M,
    ),
  );
  // Les branches de l'étoile s'alignent sur les sommets du socle.
  const phi = M % 2 === 0 ? Math.PI / M : 0;
  const col = new THREE.Mesh(pleatedColumn(M, s.colH, s.r0, s.r1, s.inner, s.twist, phi), matPaper);
  col.position.y = s.baseH;
  g.add(col);

  const top = s.baseH + s.colH - 0.02;
  const f = s.fin;
  const n = def.strength;
  for (let i = 0; i < n; i++) {
    const fin = spike(foldedFin(f.w, f.h, f.fold), matFin);
    g.add(ringPlace(fin, i, n, f.ring, f.tilt, f.offset, top));
  }
  return finalize(g, type, player, def.visual.height, 'origami');
};
