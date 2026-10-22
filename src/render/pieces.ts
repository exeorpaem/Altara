// Construction procédurale des pièces « style échecs ».
//
// Chaque pièce encode deux valeurs de rules.ts :
//   - le SOCLE est un polygone à M côtés (M = Mouvement) ;
//   - le SOMMET porte N pointes (N = Force).
// On empile, de bas en haut : socle → anneau → fût → col → sommet.
// Toutes les hauteurs sont en unités « case » ; l'origine est au centre du
// dessous du socle, et l'avant de la pièce est l'axe local +Z.
import * as THREE from 'three';
import { PIECES, type PieceType, type PlayerId } from '../engine/rules';
import { PALETTE } from './palette';

const BASE_H = 0.11; // socle
const RING_H = 0.035; // anneau
const COLLAR_H = 0.045; // col
const CROWN_H: Record<PieceType, number> = { explorer: 0.36, vanguard: 0.34, sentinel: 0.3 };

/** Couleur du camp modulée en luminosité (±8 % maximum selon la partie de la pièce). */
function shade(hex: string, delta: number): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l * (1 + delta), 0, 1));
  return c;
}

function material(color: THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.55, metalness: 0.05 });
}

/**
 * Socle : LatheGeometry avec exactement M segments → prisme à M côtés.
 * Le profil comporte un léger évasement vers le bas et un biseau fin en haut.
 * phiStart = 0 place un sommet du polygone face à l'avant (+Z) ; pour un nombre
 * pair de côtés on décale d'un demi-secteur pour présenter une face plate.
 */
function buildBase(sides: number, r: number): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r, 0),
    new THREE.Vector2(r, 0.02), // petit pied vertical
    new THREE.Vector2(r * 0.9, BASE_H - 0.025), // évasement
    new THREE.Vector2(r * 0.84, BASE_H), // biseau
    new THREE.Vector2(0, BASE_H),
  ];
  const phiStart = sides % 2 === 0 ? Math.PI / sides : 0;
  const g = new THREE.LatheGeometry(pts, sides, phiStart);
  // Le polygone reste centré sur son propre centre (= axe du fût) : recentrer sa
  // boîte englobante décalait le triangle de la Sentinelle par rapport au fût.
  // On met seulement à l'échelle pour que le plus grand côté de la boîte vaille
  // 2r : les trois socles occupent à peu près la même place sur la case.
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const span = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  const k = (2 * r) / span;
  g.scale(k, 1, k);
  return g;
}

/** Anneau : fine bague lisse posée sur le socle. */
function buildRing(r: number): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r, 0),
    new THREE.Vector2(r * 1.06, RING_H * 0.5),
    new THREE.Vector2(r, RING_H),
    new THREE.Vector2(0, RING_H),
  ];
  return new THREE.LatheGeometry(pts, 24);
}

/**
 * Fût : profil concave (forme de balustre).
 * rayon(t) = taille + (bas − taille)·(1−t)^a + (haut − taille)·t^b
 * Les exposants donnent une courbe qui se resserre vite au-dessus de la base
 * puis s'ouvre doucement vers le col. Peu de segments radiaux : facettes low-poly.
 */
function buildShaft(height: number, bottom: number, waist: number, top: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = waist + (bottom - waist) * (1 - t) ** 2.4 + (top - waist) * t ** 2.2;
    pts.push(new THREE.Vector2(r, t * height));
  }
  pts.push(new THREE.Vector2(0, height));
  return new THREE.LatheGeometry(pts, 12);
}

/** Col : petit disque débordant, biseauté dessus et dessous. */
function buildCollar(r: number): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r * 0.8, 0),
    new THREE.Vector2(r, COLLAR_H * 0.4),
    new THREE.Vector2(r, COLLAR_H * 0.65),
    new THREE.Vector2(r * 0.82, COLLAR_H),
    new THREE.Vector2(0, COLLAR_H),
  ];
  return new THREE.LatheGeometry(pts, 16);
}

/**
 * Corne / pointe courbée : un cône dont on « plie » les sommets.
 * Chaque sommet est décalé vers l'avant proportionnellement à t² (t = hauteur
 * relative), ce qui donne une pointe qui se recourbe progressivement.
 */
function buildHorn(radius: number, height: number, bend: number, radial = 6): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, radial, 6);
  g.translate(0, height / 2, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height;
    pos.setZ(i, pos.getZ(i) + bend * t * t);
  }
  g.computeVertexNormals();
  return g;
}

/** Sommet de l'Explorateur : une flèche unique, effilée (fer en losange). */
function crownExplorer(mat: THREE.Material, h: number): THREE.Object3D {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.055, 0),
    new THREE.Vector2(0.03, h * 0.22), // tige
    new THREE.Vector2(0.105, h * 0.42), // épaulement du fer
    new THREE.Vector2(0.035, h * 0.56), // rétrécissement
    new THREE.Vector2(0, h), // pointe
  ];
  // 4 segments : fer de flèche à facettes, lisible de côté comme de dessus.
  const g = new THREE.LatheGeometry(pts, 4, Math.PI / 4);
  return new THREE.Mesh(g, mat);
}

/** Sommet de l'Avant-garde : deux cornes inclinées vers l'avant, comme un cimier. */
function crownVanguard(mat: THREE.Material, h: number): THREE.Object3D {
  const group = new THREE.Group();
  // Petit chapeau qui porte les cornes
  const cap = new THREE.Mesh(
    new THREE.LatheGeometry(
      [new THREE.Vector2(0, 0), new THREE.Vector2(0.11, 0), new THREE.Vector2(0.09, 0.06), new THREE.Vector2(0, 0.08)],
      10,
    ),
    mat,
  );
  group.add(cap);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(buildHorn(0.058, h, 0.16), mat);
    horn.position.set(side * 0.06, 0.04, -0.03);
    horn.rotation.z = -side * 0.38; // écartement latéral
    horn.rotation.x = 0.22; // inclinaison vers l'avant
    group.add(horn);
  }
  return group;
}

/** Sommet de la Sentinelle : couronne à trois pointes (une face à l'avant). */
function crownSentinel(mat: THREE.Material, h: number): THREE.Object3D {
  const group = new THREE.Group();
  const band = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.12, 0),
        new THREE.Vector2(0.15, h * 0.3),
        new THREE.Vector2(0.115, h * 0.34),
        new THREE.Vector2(0, h * 0.2), // creux au centre de la couronne
      ],
      12,
    ),
    mat,
  );
  group.add(band);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2; // a = 0 → vers l'avant (+Z)
    const spike = new THREE.Mesh(buildHorn(0.065, h * 0.95, 0.05, 4), mat);
    // La courbure de buildHorn pousse vers +Z local : on l'oriente vers l'extérieur.
    spike.rotation.y = a;
    spike.position.set(Math.sin(a) * 0.095, h * 0.2, Math.cos(a) * 0.095);
    group.add(spike);
  }
  return group;
}

export interface PieceMeshOptions {
  type: PieceType;
  player: PlayerId;
  /** Mode daltonien : ajoute un repère non coloré sur le socle (anneau plein = Corail, pointillé = Lagon). */
  accessible?: boolean;
}

/**
 * Repère daltonien posé sur le dessus du socle : anneau plein pour Corail, anneau en pointillé
 * (10 tirets) pour Lagon. Sombre, donc lisible sur les deux couleurs de camp.
 */
function accessibleMark(player: PlayerId, r: number): THREE.Object3D {
  const mat = new THREE.MeshBasicMaterial({ color: '#34344a' });
  const inner = r * 0.7;
  const outer = r * 0.83;
  const pts = [new THREE.Vector2(inner, 0), new THREE.Vector2(outer, 0), new THREE.Vector2(outer, 0.012), new THREE.Vector2(inner, 0.012)];
  const g = new THREE.Group();
  if (player === 1) g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 32), mat));
  else {
    const n = 10;
    for (let k = 0; k < n; k++) g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 3, (k / n) * Math.PI * 2, ((Math.PI * 2) / n) * 0.55), mat));
  }
  g.position.y = BASE_H + 0.002;
  return g;
}

/** Construit le modèle 3D complet d'une pièce. L'avant regarde vers +Z local. */
export function buildPieceMesh({ type, player, accessible }: PieceMeshOptions): THREE.Group {
  const def = PIECES[type];
  const { height, baseRadius, waist } = def.visual;
  const camp = PALETTE.camp[player];

  // Légère variation de luminosité entre les parties (±8 % max).
  const matBase = material(shade(camp, -0.08));
  const matRing = material(shade(camp, 0.08));
  const matShaft = material(shade(camp, 0));
  const matCrown = material(shade(camp, 0.05));

  const group = new THREE.Group();
  group.name = `piece-${type}-${player}`;
  let y = 0;

  const add = (geo: THREE.BufferGeometry | THREE.Object3D, mat?: THREE.Material) => {
    const obj = geo instanceof THREE.Object3D ? geo : new THREE.Mesh(geo, mat);
    obj.position.y += y;
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(obj);
    return obj;
  };

  add(buildBase(def.movement, baseRadius), matBase);
  y += BASE_H;
  if (accessible) group.add(accessibleMark(player, baseRadius));

  const ringR = baseRadius * 0.68;
  add(buildRing(ringR), matRing);
  y += RING_H;

  const crownH = CROWN_H[type];
  const shaftH = height - BASE_H - RING_H - COLLAR_H - crownH;
  const shaftTop = waist * 1.1 + 0.02;
  add(buildShaft(shaftH, ringR * 0.8, waist, shaftTop), matShaft);
  y += shaftH;

  add(buildCollar(shaftTop * 1.35), matRing);
  y += COLLAR_H;

  const crown =
    type === 'explorer'
      ? crownExplorer(matCrown, crownH)
      : type === 'vanguard'
        ? crownVanguard(matCrown, crownH)
        : crownSentinel(matCrown, crownH);
  add(crown);

  group.userData = { type, player, height };
  return group;
}
