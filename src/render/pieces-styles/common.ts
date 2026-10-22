// Outils partagés par les styles de pièces proposés (voir index.ts).
//
// Conventions communes à TOUS les styles (identiques à render/pieces.ts) :
//   - origine au centre du dessous du socle, avant de la pièce = +Z local ;
//   - le maillage du socle porte userData.part = 'base' (polygone à M côtés) ;
//   - chaque pointe du sommet est un maillage userData.part = 'spike' (N pointes).
// Ces étiquettes permettent aux tests de vérifier la lecture M / N sur la géométrie.
import * as THREE from 'three';
import type { PieceType, PlayerId } from '../../engine/rules';

export interface PieceMeshOptions {
  type: PieceType;
  player: PlayerId;
}
export type PieceBuilder = (o: PieceMeshOptions) => THREE.Group;

/** Couleur du camp modulée en luminosité. */
export function shade(hex: string, delta: number): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l * (1 + delta), 0, 1));
  return c;
}

export function stdMat(color: THREE.Color, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.55, metalness: 0.05, ...extra });
}

/**
 * Socle polygonal : tour (lathe) d'exactement `sides` segments sur le profil donné
 * (couples [rayon relatif, hauteur], du bas vers le haut). Sommet du polygone face à
 * +Z pour un nombre impair de côtés, face plate vers +Z pour un nombre pair. Mis à
 * l'échelle pour que la boîte englobante fasse 2r, mais jamais recentré : le centre
 * du polygone reste sur l'axe du fût.
 */
export function polyBase(sides: number, r: number, profile: [number, number][]): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0, profile[0][1]),
    ...profile.map(([k, y]) => new THREE.Vector2(r * k, y)),
    new THREE.Vector2(0, profile[profile.length - 1][1]),
  ];
  const phiStart = sides % 2 === 0 ? Math.PI / sides : 0;
  const g = new THREE.LatheGeometry(pts, sides, phiStart);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const span = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  const k = (2 * r) / span;
  g.scale(k, 1, k);
  return g;
}

/** Tour (lathe) à partir de couples [rayon, hauteur]. */
export function lathe(profile: [number, number][], segments: number, phiStart = 0): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(x, y)),
    segments,
    phiStart,
  );
}

/** Prisme effilé à `sides` facettes, tordu de `twist` radians du bas vers le haut. */
export function twistedPrism(h: number, r0: number, r1: number, sides: number, twist = 0, rows = 4): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, sides, rows, true);
  g.translate(0, h / 2, 0);
  if (twist) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const a = (p.getY(i) / h) * twist;
      const x = p.getX(i);
      const z = p.getZ(i);
      p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), p.getY(i), x * Math.sin(a) + z * Math.cos(a));
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Lame / corne : cône à `radial` facettes, aplati en X (flat < 1), dont les sommets
 * sont décalés vers +Z proportionnellement à t² (t = hauteur relative) : la pointe se recourbe.
 */
export function bentBlade(radius: number, h: number, bend: number, radial = 4, flat = 1, rows = 6): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, h, radial, rows, true);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h;
    p.setX(i, p.getX(i) * flat);
    p.setZ(i, p.getZ(i) + bend * t * t);
  }
  g.computeVertexNormals();
  return g;
}

/** Bipyramide facettée (cristal) : large au bas, effilée en haut. */
export function crystal(r: number, h: number, facets = 5, waist = 0.16): THREE.BufferGeometry {
  return lathe(
    [
      [0, 0],
      [r, h * waist],
      [r * 0.8, h * 0.6],
      [0, h],
    ],
    facets,
  );
}

/** Marque un maillage comme pointe du sommet (comptée par les tests). */
export function spike(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.userData.part = 'spike';
  return m;
}

/** Marque un maillage comme socle à `sides` côtés. */
export function baseMesh(geo: THREE.BufferGeometry, mat: THREE.Material, sides: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.userData.part = 'base';
  m.userData.sides = sides;
  return m;
}

/**
 * Dispose `obj` en couronne : i-ème sur n, à `radius` de l'axe, incliné de `tilt`
 * vers l'extérieur. Angle 0 = avant (+Z) ; `offset` fait tourner toute la couronne.
 */
export function ringPlace(obj: THREE.Object3D, i: number, n: number, radius: number, tilt: number, offset = 0, y = 0): THREE.Group {
  const pivot = new THREE.Group();
  pivot.rotation.y = offset + (i / n) * Math.PI * 2;
  pivot.position.y = y;
  obj.position.z += radius;
  obj.rotation.x += tilt;
  pivot.add(obj);
  return pivot;
}

/** Ombres + métadonnées communes ; renvoie le groupe. */
export function finalize(group: THREE.Group, type: PieceType, player: PlayerId, height: number, style: string): THREE.Group {
  group.name = `piece-${type}-${player}`;
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  group.userData = { type, player, height, style };
  return group;
}

/** Libère géométries et matériaux d'une pièce (quel que soit son style). */
export function disposePiece(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) mat.dispose();
  });
}
