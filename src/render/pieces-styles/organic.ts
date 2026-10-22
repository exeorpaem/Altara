// Proposition B — « Sculpture organique ».
// Corps tournés au profil en S (pied, gorge fine, renflement, col), ombrage lisse ;
// sommet en lames recourbées vers l'extérieur comme des pétales ou des flammes.
// Seul le socle reste à facettes nettes : le polygone M doit se lire sans ambiguïté.
import * as THREE from 'three';
import { PIECES, type PieceType } from '../../engine/rules';
import { PALETTE } from '../palette';
import { baseMesh, bentBlade, finalize, lathe, polyBase, ringPlace, shade, spike, stdMat, type PieceBuilder } from './common';

interface Spec {
  baseH: number;
  /** Profil du corps [rayon, hauteur] au-dessus du socle, du bas vers le haut. */
  body: [number, number][];
  blade: { r: number; h: number; bend: number; flat: number; ring: number; tilt: number; offset: number };
}

const SPEC: Record<PieceType, Spec> = {
  // Explorateur : tige fine, petit bourgeon, une flamme unique légèrement penchée vers l'avant.
  explorer: {
    baseH: 0.07,
    body: [
      [0.12, 0],
      [0.07, 0.04],
      [0.034, 0.16],
      [0.028, 0.34],
      [0.05, 0.46],
      [0.062, 0.51],
      [0.042, 0.56],
      [0.026, 0.6],
      [0, 0.6],
    ],
    blade: { r: 0.07, h: 0.38, bend: 0.06, flat: 0.5, ring: 0, tilt: 0, offset: 0 },
  },
  // Avant-garde : vase élancé, deux lames qui s'ouvrent en lyre sur les côtés.
  vanguard: {
    baseH: 0.075,
    body: [
      [0.15, 0],
      [0.085, 0.05],
      [0.046, 0.2],
      [0.05, 0.38],
      [0.088, 0.53],
      [0.098, 0.58],
      [0.066, 0.63],
      [0, 0.63],
    ],
    blade: { r: 0.05, h: 0.46, bend: 0.13, flat: 0.45, ring: 0.05, tilt: 0.34, offset: Math.PI / 2 },
  },
  // Sentinelle : coupe en tulipe, trois pétales-lames recourbés (un vers l'avant).
  sentinel: {
    baseH: 0.085,
    body: [
      [0.18, 0],
      [0.11, 0.06],
      [0.07, 0.22],
      [0.075, 0.42],
      [0.14, 0.6],
      [0.16, 0.67],
      [0.11, 0.71],
      [0, 0.71],
    ],
    blade: { r: 0.065, h: 0.5, bend: 0.12, flat: 0.45, ring: 0.09, tilt: 0.24, offset: 0 },
  },
};

export const buildOrganicPiece: PieceBuilder = ({ type, player }) => {
  const def = PIECES[type];
  const s = SPEC[type];
  const camp = PALETTE.camp[player];
  const M = def.movement;

  const matBase = stdMat(shade(camp, -0.1), { roughness: 0.5 });
  const matBody = stdMat(shade(camp, 0), { flatShading: false, roughness: 0.38 });
  const matBlade = stdMat(shade(camp, 0.1), { flatShading: false, roughness: 0.32, side: THREE.DoubleSide });

  const g = new THREE.Group();
  g.add(
    baseMesh(
      polyBase(M, def.visual.baseRadius, [
        [1, 0],
        [1, s.baseH * 0.3],
        [0.86, s.baseH],
      ]),
      matBase,
      M,
    ),
  );
  const body = new THREE.Mesh(lathe(s.body, 20), matBody);
  body.position.y = s.baseH;
  g.add(body);

  const top = s.baseH + s.body[s.body.length - 1][1] - 0.015;
  const b = s.blade;
  const n = def.strength;
  for (let i = 0; i < n; i++) {
    const blade = spike(bentBlade(b.r, b.h, b.bend, 6, b.flat, 8), matBlade);
    // L'aplatissement est en X : la lame présente son tranchant de côté et se
    // recourbe vers l'extérieur (+Z local après placement en couronne).
    g.add(ringPlace(blade, i, n, b.ring, b.tilt, b.offset, top));
  }
  return finalize(g, type, player, def.visual.height, 'organic');
};
