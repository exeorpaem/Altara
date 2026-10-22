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

/** Matériau double face (voile, fanion) : visible des deux côtés. */
function flatMaterial(color: THREE.Color): THREE.MeshStandardMaterial {
  const m = material(color);
  m.side = THREE.DoubleSide;
  return m;
}

/** Fût tronconique à `sides` facettes, de r0 (bas) à r1 (haut). */
function buildColumn(height: number, r0: number, r1: number, sides: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, height, sides, 1);
  g.translate(0, height / 2, 0);
  return g;
}

/** Triangle plat (voile) défini par 3 points, normales plates. */
function buildTriangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...c.toArray()], 3));
  g.computeVertexNormals();
  return g;
}

/**
 * EXPLORATEUR : élancé et léger. Une unique flèche (Force 1) et un fanion
 * triangulaire qui flotte vers l'arrière.
 */
function crownExplorer(mat: THREE.Material, matFlag: THREE.Material, h: number): THREE.Object3D {
  const group = new THREE.Group();
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.05, 0),
    new THREE.Vector2(0.025, h * 0.25),
    new THREE.Vector2(0.095, h * 0.45), // épaulement du fer
    new THREE.Vector2(0.03, h * 0.6),
    new THREE.Vector2(0, h), // pointe unique
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 4, Math.PI / 4), mat));
  // Fanion sous le fer, flottant vers l'arrière (-Z) et sur le côté : lisible de dessus.
  group.add(
    new THREE.Mesh(
      buildTriangle(
        new THREE.Vector3(0.02, h * 0.8, 0),
        new THREE.Vector3(0.02, h * 0.3, 0),
        new THREE.Vector3(0.26, h * 0.58, -0.22),
      ),
      matFlag,
    ),
  );
  return group;
}

/** AVANT-GARDE : deux lames/cornes écartées, couchées vers l'avant (+Z), sur un cimier en coin. */
function crownVanguard(mat: THREE.Material, h: number): THREE.Object3D {
  const group = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.07, 4).rotateY(Math.PI / 4), mat);
  cap.position.y = 0.035;
  group.add(cap);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(buildHorn(0.06, h * 1.1, 0.12, 4), mat);
    horn.position.set(side * 0.08, 0.05, 0.02);
    horn.rotation.z = -side * 0.35; // écartement latéral
    horn.rotation.x = 0.8; // couchées vers l'avant
    group.add(horn);
  }
  return group;
}

/** SENTINELLE : tour de guet. Tambour large à créneaux, trois merlons épais (Force 3), un face à l'avant. */
function crownSentinel(mat: THREE.Material, h: number): THREE.Object3D {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(buildColumn(h * 0.3, 0.2, 0.235, 8), mat));
  const mh = h * 0.7;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2; // a = 0 → vers l'avant (+Z)
    const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.15, mh, 0.1), mat);
    merlon.rotation.y = a;
    merlon.position.set(Math.sin(a) * 0.17, h * 0.3 + mh / 2, Math.cos(a) * 0.17);
    group.add(merlon);
  }
  return group;
}

export interface PieceMeshOptions {
  type: PieceType;
  player: PlayerId;
}

/** Construit le modèle 3D complet d'une pièce. L'avant regarde vers +Z local. */
export function buildPieceMesh({ type, player }: PieceMeshOptions): THREE.Group {
  const def = PIECES[type];
  const { height, baseRadius, waist } = def.visual;
  const camp = PALETTE.camp[player];

  const matBase = material(shade(camp, -0.08));
  const matRing = material(shade(camp, 0.08));
  const matShaft = material(shade(camp, 0));
  const matCrown = material(shade(camp, 0.05));

  const group = new THREE.Group();
  group.name = `piece-${type}-${player}`;
  // Haut de la pièce : s'incline vers l'avant pour l'Avant-garde (le socle reste droit).
  const upper = new THREE.Group();

  const addTo = (parent: THREE.Object3D, geo: THREE.BufferGeometry | THREE.Object3D, mat: THREE.Material | undefined, y: number) => {
    const obj = geo instanceof THREE.Object3D ? geo : new THREE.Mesh(geo, mat);
    obj.position.y += y;
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    parent.add(obj);
    return obj;
  };

  addTo(group, buildBase(def.movement, baseRadius), matBase, 0);
  const ringR = baseRadius * (type === 'sentinel' ? 0.8 : 0.68);
  addTo(group, buildRing(ringR), matRing, BASE_H);
  group.add(upper);
  upper.position.y = BASE_H + RING_H;

  const crownH = CROWN_H[type];
  const shaftH = height - BASE_H - RING_H - COLLAR_H - crownH;
  const top = shaftH + COLLAR_H;

  if (type === 'explorer') {
    addTo(upper, buildColumn(shaftH, ringR * 0.5, waist * 0.7, 8), matShaft, 0);
    addTo(upper, buildCollar(waist * 1.5), matRing, shaftH);
    addTo(upper, crownExplorer(matCrown, flatMaterial(shade(camp, 0.18)), crownH), undefined, top);
  } else if (type === 'vanguard') {
    upper.rotation.x = 0.13; // légère inclinaison vers l'avant (+Z)
    addTo(upper, buildColumn(shaftH, ringR * 0.8, waist * 1.1, 8), matShaft, 0);
    // Proue triangulaire sur la face avant : coin dont l'arête pointe vers +Z.
    const prow = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.17, shaftH * 0.85, 3), matRing);
    prow.scale.set(0.7, 1, 1.15);
    prow.position.set(0, shaftH * 0.46, 0.085);
    addTo(upper, prow, undefined, 0);
    addTo(upper, buildCollar(waist * 1.7), matRing, shaftH);
    addTo(upper, crownVanguard(matCrown, crownH), undefined, top);
  } else {
    addTo(upper, buildColumn(shaftH, ringR * 0.95, 0.19, 8), matShaft, 0);
    addTo(upper, buildCollar(0.26), matRing, shaftH);
    addTo(upper, crownSentinel(matCrown, crownH), undefined, top);
  }

  group.userData = { type, player, height };
  return group;
}
