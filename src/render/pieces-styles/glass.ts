// Proposition A — « Flèches de verre ».
// Fûts élancés à facettes tordues (autant de facettes que de côtés au socle),
// sommets en cristaux fins bipyramidaux, vernis brillant (clearcoat) et cristaux
// légèrement translucides. Une seule MeshPhysicalMaterial par partie : coût modéré.
import * as THREE from 'three';
import { PIECES } from '../../engine/rules';
import { PALETTE } from '../palette';
import { baseMesh, crystal, finalize, lathe, polyBase, ringPlace, shade, spike, stdMat, twistedPrism, type PieceBuilder } from './common';

interface Spec {
  baseH: number;
  shaftH: number;
  r0: number;
  r1: number;
  twist: number;
  lean: number;
  bead: number;
  cr: number;
  ch: number;
  ringR: number;
  tilt: number;
  offset: number;
}

const SPEC = {
  // Explorateur : aiguille fine et haute, un seul cristal dans l'axe.
  explorer: { baseH: 0.06, shaftH: 0.5, r0: 0.095, r1: 0.04, twist: 1.1, lean: 0, bead: 0.055, cr: 0.058, ch: 0.42, ringR: 0, tilt: 0, offset: 0 },
  // Avant-garde : fût penché vers l'avant, deux cristaux ouverts en V latéral.
  vanguard: { baseH: 0.07, shaftH: 0.6, r0: 0.1, r1: 0.05, twist: 0.8, lean: 0.12, bead: 0.075, cr: 0.055, ch: 0.46, ringR: 0.05, tilt: 0.5, offset: Math.PI / 2 },
  // Sentinelle : fût large et droit, couronne de trois cristaux (un vers l'avant).
  sentinel: { baseH: 0.08, shaftH: 0.68, r0: 0.16, r1: 0.085, twist: 1.0, lean: 0, bead: 0.12, cr: 0.065, ch: 0.52, ringR: 0.08, tilt: 0.42, offset: 0 },
} satisfies Record<string, Spec>;

export const buildGlassPiece: PieceBuilder = ({ type, player }) => {
  const def = PIECES[type];
  const s: Spec = SPEC[type];
  const camp = PALETTE.camp[player];
  const M = def.movement;

  const matBase = stdMat(shade(camp, -0.12), { roughness: 0.35 });
  const matShaft = new THREE.MeshPhysicalMaterial({
    color: shade(camp, 0),
    flatShading: true,
    roughness: 0.22,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const matCrystal = new THREE.MeshPhysicalMaterial({
    color: shade(camp, 0.16),
    emissive: shade(camp, -0.2),
    emissiveIntensity: 0.25,
    flatShading: true,
    roughness: 0.06,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.86,
  });

  const g = new THREE.Group();
  // Socle mince à arête vive : biseau en haut, filet en bas.
  g.add(
    baseMesh(
      polyBase(M, def.visual.baseRadius, [
        [0.94, 0],
        [1, s.baseH * 0.35],
        [0.9, s.baseH],
      ]),
      matBase,
      M,
    ),
  );

  const upper = new THREE.Group();
  upper.position.y = s.baseH;
  upper.rotation.x = s.lean;
  g.add(upper);
  // Le fût a autant de facettes que le socle a de côtés : la lecture M se prolonge.
  upper.add(new THREE.Mesh(twistedPrism(s.shaftH, s.r0, s.r1, M, s.twist, 5), matShaft));
  // Perle facettée qui sertit les cristaux.
  const bead = new THREE.Mesh(
    lathe(
      [
        [0, 0],
        [s.r1 * 1.05, 0],
        [s.bead, 0.025],
        [s.bead * 0.7, 0.045],
        [0, 0.045],
      ],
      M,
    ),
    matShaft,
  );
  bead.position.y = s.shaftH;
  upper.add(bead);

  const top = s.shaftH + 0.03;
  const n = def.strength;
  for (let i = 0; i < n; i++) {
    const c = spike(crystal(s.cr, s.ch, 5, 0.14), matCrystal);
    upper.add(ringPlace(c, i, n, s.ringR, s.tilt, s.offset, top));
  }
  return finalize(g, type, player, def.visual.height, 'glass');
};
