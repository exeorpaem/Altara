// Proposition C — « Architecture céleste ».
// Socle à gradins, obélisque à M pans, halo fin en lévitation autour du fût,
// orbe de sertissage et aiguilles très fines au sommet (N aiguilles).
import * as THREE from 'three';
import { PIECES, type PieceType } from '../../engine/rules';
import { PALETTE } from '../palette';
import { baseMesh, finalize, lathe, polyBase, ringPlace, shade, spike, stdMat, twistedPrism, type PieceBuilder } from './common';

interface Spec {
  baseH: number;
  shaftH: number;
  r0: number;
  r1: number;
  /** Halo : rayon, hauteur relative sur le fût, inclinaison vers l'avant. */
  halo: { r: number; at: number; tilt: number };
  orb: number;
  needle: { r: number; h: number; ring: number; tilt: number; offset: number };
}

const SPEC: Record<PieceType, Spec> = {
  explorer: {
    baseH: 0.08,
    shaftH: 0.46,
    r0: 0.075,
    r1: 0.04,
    halo: { r: 0.12, at: 0.72, tilt: 0 },
    orb: 0.045,
    needle: { r: 0.03, h: 0.42, ring: 0, tilt: 0, offset: 0 },
  },
  vanguard: {
    baseH: 0.085,
    shaftH: 0.56,
    r0: 0.1,
    r1: 0.055,
    halo: { r: 0.15, at: 0.7, tilt: 0.4 },
    orb: 0.055,
    needle: { r: 0.032, h: 0.46, ring: 0.05, tilt: 0.46, offset: Math.PI / 2 },
  },
  sentinel: {
    baseH: 0.09,
    shaftH: 0.66,
    r0: 0.13,
    r1: 0.065,
    halo: { r: 0.2, at: 0.62, tilt: 0 },
    orb: 0.06,
    needle: { r: 0.036, h: 0.48, ring: 0.07, tilt: 0.32, offset: 0 },
  },
};

export const buildCelestialPiece: PieceBuilder = ({ type, player }) => {
  const def = PIECES[type];
  const s = SPEC[type];
  const camp = PALETTE.camp[player];
  const M = def.movement;

  const matBase = stdMat(shade(camp, -0.12), { roughness: 0.6 });
  const matShaft = stdMat(shade(camp, 0), { roughness: 0.45 });
  const matGold = stdMat(shade(camp, 0.22), { roughness: 0.25, metalness: 0.35, emissive: shade(camp, -0.3), emissiveIntensity: 0.2 });

  const g = new THREE.Group();
  // Socle à deux gradins : la marche supérieure répète le polygone, plus petit.
  const bh = s.baseH;
  g.add(
    baseMesh(
      polyBase(M, def.visual.baseRadius, [
        [1, 0],
        [1, bh * 0.45],
        [0.78, bh * 0.45],
        [0.78, bh * 0.85],
        [0.6, bh],
      ]),
      matBase,
      M,
    ),
  );

  // Obélisque à M pans, sommet en pyramidion tronqué.
  const phi = M % 2 === 0 ? Math.PI / M : 0;
  const shaft = new THREE.Mesh(
    lathe(
      [
        [0, 0],
        [s.r0, 0],
        [s.r1, s.shaftH],
        [s.r1 * 0.55, s.shaftH + 0.03],
        [0, s.shaftH + 0.03],
      ],
      M,
      phi,
    ),
    matShaft,
  );
  shaft.position.y = bh;
  g.add(shaft);

  // Halo flottant (anneau fin, non relié au fût).
  const halo = new THREE.Mesh(new THREE.TorusGeometry(s.halo.r, 0.009, 4, 28), matGold);
  halo.rotation.x = Math.PI / 2 - s.halo.tilt;
  halo.position.y = bh + s.shaftH * s.halo.at;
  g.add(halo);

  const top = bh + s.shaftH + 0.03;
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(s.orb, 0), matGold);
  orb.position.y = top + s.orb * 0.6;
  g.add(orb);

  const nd = s.needle;
  const n = def.strength;
  for (let i = 0; i < n; i++) {
    const needle = spike(twistedPrism(nd.h, nd.r, 0, 4, 0, 1), matGold);
    g.add(ringPlace(needle, i, n, nd.ring, nd.tilt, nd.offset, top + s.orb * 0.9));
  }
  return finalize(g, type, player, def.visual.height, 'celestial');
};
