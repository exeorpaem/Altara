// Décors 3D procéduraux, choisis selon le mode de terrain et colorés d'après le skin actif.
//
// Deux étages :
//   1. analyse du relief (classifyCells, pure et testée) : sommet, falaise, cuvette, plateau, pente, plat ;
//   2. génération de géométries fusionnées (un seul maillage « sommet-couleur » par catégorie) :
//      - détails BAS sur les cases jouables (jamais plus de ~0,15 unité, centre de case dégagé) ;
//      - décor autour : bordure de l'île, dessous de l'île, îlots flottants, nuages, cascade.
// Pur rendu : aucune règle de jeu n'est lue ni modifiée (le terrain n'est que lu).
import * as THREE from 'three';
import type { Terrain, TerrainMode } from '../engine/terrain';
import { hashSeed, mulberry32 } from '../engine/random';
import { PALETTE } from './palette';
import { CELL, cellCenter, topY } from './board';
import type { Skin } from './skins';

// ---------------------------------------------------------------------------
// 1. Reconnaissance de formes du relief
// ---------------------------------------------------------------------------

export type CellClass = 'summit' | 'cliff' | 'basin' | 'plateau' | 'slope' | 'flat';

/**
 * Classe chaque case d'après ses 4 voisins orthogonaux. Ordre de priorité :
 *  - summit  : strictement plus haute que tous ses voisins ;
 *  - basin   : strictement plus basse que tous ses voisins ;
 *  - cliff   : au moins un voisin à |Δh| ≥ 2 ;
 *  - plateau : au moins 3 voisins de même hauteur, mais pas tous (bord d'un replat) ;
 *  - slope   : au moins un voisin à |Δh| = 1 (reste des cas non plats) ;
 *  - flat    : tous les voisins à la même hauteur.
 */
export function classifyCells(heights: number[][]): CellClass[][] {
  const n = heights.length;
  return heights.map((row, r) =>
    row.map((h, c) => {
      const nb: number[] = [];
      if (r > 0) nb.push(heights[r - 1][c]);
      if (r < n - 1) nb.push(heights[r + 1][c]);
      if (c > 0) nb.push(heights[r][c - 1]);
      if (c < row.length - 1) nb.push(heights[r][c + 1]);
      if (nb.length === 0) return 'flat';
      if (nb.every((x) => h > x)) return 'summit';
      if (nb.every((x) => h < x)) return 'basin';
      if (nb.some((x) => Math.abs(x - h) >= 2)) return 'cliff';
      const same = nb.filter((x) => x === h).length;
      if (same === nb.length) return 'flat';
      if (same >= 3) return 'plateau';
      return 'slope';
    }),
  );
}

// ---------------------------------------------------------------------------
// 2. Couleurs : dérivées du skin, jamais celles des camps
// ---------------------------------------------------------------------------

const mix = (a: string | THREE.Color, b: string | THREE.Color, t: number) =>
  new THREE.Color(a).lerp(new THREE.Color(b), t);

const CAMP_HUES = (Object.values(PALETTE.camp) as string[]).map((c) => {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(c).getHSL(hsl);
  return hsl.h;
});

/** Si une teinte ressemble trop à un camp (corail / lagon), on la désature : les camps restent uniques. */
export function avoidCampColor(color: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  for (const ch of CAMP_HUES) {
    const d = Math.min(Math.abs(hsl.h - ch), 1 - Math.abs(hsl.h - ch));
    if (d < 0.05 && hsl.s > 0.3) {
      color.setHSL(hsl.h, 0.18, hsl.l);
      break;
    }
  }
  return color;
}

export interface DecorPalette {
  grass: THREE.Color; leaf: THREE.Color; leafDark: THREE.Color; trunk: THREE.Color;
  stone: THREE.Color; stoneDark: THREE.Color; snow: THREE.Color; sand: THREE.Color; sandDark: THREE.Color;
  cactus: THREE.Color; heather: THREE.Color; bone: THREE.Color; water: THREE.Color; crack: THREE.Color;
  frost: THREE.Color; moss: THREE.Color; cap: THREE.Color; flowers: THREE.Color[]; cloud: THREE.Color;
  islet: THREE.Color;
}

/** Palette du décor : chaque teinte « cible » est mélangée au skin pour rester cohérente avec lui. */
export function decorPalette(skin: Skin, mode: TerrainMode): DecorPalette {
  const dry = mode === 'desert';
  const p: DecorPalette = {
    grass: mix(skin.hollow, '#4E9A4A', 0.7),
    leaf: mix(skin.low, '#76B26C', 0.6),
    leafDark: mix(skin.line, '#4F8A5A', 0.55),
    trunk: mix(skin.rock, '#8C6B52', 0.5),
    stone: mix(skin.rock, skin.high, 0.1),
    stoneDark: mix(skin.rock, skin.line, 0.35),
    snow: mix(skin.high, '#FFFFFF', 0.75),
    sand: mix(skin.high, '#FFF3CF', 0.6),
    sandDark: mix(skin.low, skin.line, 0.6),
    cactus: mix(skin.hollow, '#74AE88', 0.6),
    heather: mix(skin.high, '#8E6BC0', 0.8),
    bone: mix(skin.high, '#F3ECDD', 0.7),
    water: mix(skin.hollow, '#4F9AD8', 0.7),
    crack: mix(skin.line, '#4A4844', 0.4),
    frost: mix('#FFFFFF', '#DCEEFF', 0.4),
    moss: mix(skin.hollow, '#3F8456', 0.75),
    cap: mix(skin.high, '#B8895A', 0.7),
    flowers: [mix(skin.high, '#F2CB2E', 0.85), mix(skin.high, '#8E74E0', 0.8), new THREE.Color('#FFFFFF')],
    cloud: new THREE.Color(skin.cloud),
    islet: dry ? mix(skin.low, '#E6CF9C', 0.4) : mix(skin.low, '#86BC72', 0.5),
  };
  for (const k of Object.keys(p) as (keyof DecorPalette)[]) {
    const v = p[k];
    if (Array.isArray(v)) v.forEach(avoidCampColor);
    else avoidCampColor(v);
  }
  return p;
}

// ---------------------------------------------------------------------------
// 3. Accumulateur de géométrie fusionnée (positions + couleurs de sommets)
// ---------------------------------------------------------------------------

/** Gabarit non indexé (normales calculées plus tard, ombrage « à facettes »). */
interface Tpl { pos: Float32Array }
const tpl = (g: THREE.BufferGeometry): Tpl => {
  const ni = g.index ? g.toNonIndexed() : g;
  const t = { pos: new Float32Array(ni.attributes.position.array) };
  g.dispose();
  if (ni !== g) ni.dispose();
  return t;
};
const up = (g: THREE.BufferGeometry, s = 1) => g.translate(0, 0.5 * s, 0);

/** Gabarits unitaires, base posée en y = 0 (sauf ico/dodéca centrés). Créés une seule fois. */
type TplName = 'cone5' | 'cone6' | 'cyl6' | 'box' | 'ico' | 'dodeca' | 'cyl7';
let TPL: Record<TplName, Tpl> | null = null;
function templates() {
  return (TPL ??= {
    cone5: tpl(up(new THREE.ConeGeometry(1, 1, 5, 1, false))),
    cone6: tpl(up(new THREE.ConeGeometry(1, 1, 6, 1, false))),
    cyl6: tpl(up(new THREE.CylinderGeometry(1, 1, 1, 6, 1, false))),
    cyl7: tpl(up(new THREE.CylinderGeometry(1, 1, 1, 7, 1, false))),
    box: tpl(up(new THREE.BoxGeometry(1, 1, 1))),
    ico: tpl(new THREE.IcosahedronGeometry(1, 0)),
    dodeca: tpl(new THREE.DodecahedronGeometry(1, 0)),
  });
}

class Acc {
  pos: number[] = [];
  col: number[] = [];
  tris = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private t = new THREE.Vector3();
  constructor(private rand: () => number, private limit: number) {}

  /** Ajoute une instance du gabarit (position, échelle, rotations Y puis X/Z) avec une légère variation de teinte. */
  add(name: TplName, p: [number, number, number], s: [number, number, number], ry: number, color: THREE.Color, rx = 0, rz = 0) {
    const g = templates()[name].pos;
    const n = g.length / 9;
    if (this.tris + n > this.limit) return;
    this.tris += n;
    this.e.set(rx, ry, rz, 'YXZ');
    this.q.setFromEuler(this.e);
    this.m.compose(this.t.set(p[0], p[1], p[2]), this.q, this.s.set(s[0], s[1], s[2]));
    const k = 0.94 + this.rand() * 0.12;
    for (let i = 0; i < g.length; i += 3) {
      this.v.set(g[i], g[i + 1], g[i + 2]).applyMatrix4(this.m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.col.push(color.r * k, color.g * k, color.b * k);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); // non indexé → une normale par face (facettes)
    return g;
  }
}

// ---------------------------------------------------------------------------
// 4. Détails BAS sur les cases jouables (≤ ~0,15 unité, centre dégagé)
// ---------------------------------------------------------------------------

type Detail = 'grass' | 'pebble' | 'crack' | 'flower' | 'ripple' | 'frost' | 'moss' | 'puddle' | 'mushroom' | 'heather' | 'bone' | 'dry';

type Recipe = Record<CellClass, { kinds: Detail[]; n: [number, number] }>;

/** Recettes : quels détails, et combien, selon le mode et la classe de case. */
const RECIPES: Record<TerrainMode, Recipe> = {
  woods: {
    flat: { kinds: ['grass', 'moss', 'mushroom'], n: [1, 3] },
    slope: { kinds: ['grass', 'pebble', 'moss'], n: [1, 3] },
    plateau: { kinds: ['grass', 'mushroom', 'flower'], n: [2, 3] },
    cliff: { kinds: ['pebble', 'moss', 'grass'], n: [2, 4] },
    summit: { kinds: ['mushroom', 'pebble', 'grass'], n: [2, 3] },
    basin: { kinds: ['moss', 'mushroom', 'puddle'], n: [2, 3] },
  },
  mountains: {
    flat: { kinds: ['pebble', 'frost', 'crack'], n: [1, 3] },
    slope: { kinds: ['pebble', 'frost', 'crack'], n: [1, 3] },
    plateau: { kinds: ['pebble', 'frost', 'grass'], n: [2, 3] },
    cliff: { kinds: ['pebble', 'crack', 'frost'], n: [3, 4] },
    summit: { kinds: ['frost', 'pebble'], n: [2, 3] },
    basin: { kinds: ['puddle', 'pebble', 'moss'], n: [2, 3] },
  },
  valleys: {
    flat: { kinds: ['grass', 'flower'], n: [2, 3] },
    slope: { kinds: ['grass', 'flower'], n: [2, 3] },
    plateau: { kinds: ['grass', 'flower', 'pebble'], n: [2, 3] },
    cliff: { kinds: ['pebble', 'grass'], n: [2, 3] },
    summit: { kinds: ['flower', 'grass'], n: [2, 3] },
    basin: { kinds: ['puddle', 'moss', 'flower'], n: [2, 3] },
  },
  highlands: {
    flat: { kinds: ['heather', 'pebble', 'grass'], n: [1, 3] },
    slope: { kinds: ['heather', 'grass'], n: [2, 3] },
    plateau: { kinds: ['heather', 'pebble', 'flower'], n: [2, 3] },
    cliff: { kinds: ['pebble', 'crack', 'moss'], n: [2, 4] },
    summit: { kinds: ['heather', 'pebble'], n: [2, 3] },
    basin: { kinds: ['moss', 'puddle', 'heather'], n: [2, 3] },
  },
  desert: {
    flat: { kinds: ['ripple', 'crack', 'dry'], n: [1, 3] },
    slope: { kinds: ['ripple', 'pebble'], n: [1, 3] },
    plateau: { kinds: ['crack', 'ripple', 'pebble'], n: [2, 3] },
    cliff: { kinds: ['pebble', 'crack'], n: [2, 4] },
    summit: { kinds: ['pebble', 'ripple', 'bone'], n: [2, 3] },
    basin: { kinds: ['ripple', 'crack', 'bone'], n: [2, 3] },
  },
  random: {
    flat: { kinds: ['grass', 'pebble', 'flower'], n: [1, 2] },
    slope: { kinds: ['grass', 'pebble', 'frost'], n: [1, 2] },
    plateau: { kinds: ['grass', 'flower', 'crack'], n: [1, 3] },
    cliff: { kinds: ['pebble', 'crack'], n: [2, 3] },
    summit: { kinds: ['pebble', 'grass', 'mushroom'], n: [1, 3] },
    basin: { kinds: ['puddle', 'moss', 'flower'], n: [1, 3] },
  },
};

/** Emprise au sol agrandie (×1,1) sans toucher à la hauteur : lecture plus nette depuis la caméra. */
const FOOT = 1.1;
function surfaceDetail(acc0: Acc, kind: Detail, x: number, y: number, z: number, rnd: () => number, pal: DecorPalette) {
  const acc = {
    add: (n: TplName, p: [number, number, number], sc: [number, number, number], ry: number, c: THREE.Color, rx = 0, rz = 0) =>
      acc0.add(n, p, [sc[0] * FOOT, sc[1], sc[2] * FOOT], ry, c, rx, rz),
  };
  const ry = rnd() * Math.PI * 2;
  const y0 = y + 0.008; // décollé du dessus du bloc : pas de scintillement (z-fighting)
  switch (kind) {
    case 'grass': // touffe de 3 brins, ≤ 0,11
      for (let i = 0; i < 3; i++) {
        const a = ry + i * 2.1;
        acc.add('cone5', [x + Math.cos(a) * 0.02, y0, z + Math.sin(a) * 0.02], [0.016, 0.07 + rnd() * 0.04, 0.016], 0, pal.grass, Math.cos(a) * 0.35, Math.sin(a) * 0.35);
      }
      break;
    case 'pebble':
      acc.add('dodeca', [x, y0 + 0.02, z], [0.04 + rnd() * 0.03, 0.03, 0.04 + rnd() * 0.03], ry, pal.stone);
      if (rnd() < 0.6) acc.add('dodeca', [x + 0.06, y0 + 0.012, z + 0.03], [0.022, 0.018, 0.022], ry, pal.stoneDark);
      break;
    case 'crack': // fissure : fine lamelle plate, légèrement coudée
      acc.add('box', [x, y0, z], [0.2 + rnd() * 0.1, 0.006, 0.014], ry, pal.crack);
      acc.add('box', [x + Math.cos(ry) * 0.1, y0, z - Math.sin(ry) * 0.1], [0.08, 0.006, 0.012], ry + 0.8, pal.crack);
      break;
    case 'flower': {
      const c = pal.flowers[Math.floor(rnd() * pal.flowers.length)];
      acc.add('cone5', [x, y0, z], [0.008, 0.07, 0.008], 0, pal.grass);
      acc.add('ico', [x, y0 + 0.08, z], [0.03, 0.022, 0.03], ry, c);
      break;
    }
    case 'ripple': // ride de sable : petite crête allongée
      acc.add('box', [x, y0, z], [0.22, 0.02, 0.035], ry, pal.sand);
      acc.add('box', [x + Math.sin(ry) * 0.07, y0, z + Math.cos(ry) * 0.07], [0.15, 0.014, 0.03], ry, pal.sandDark);
      break;
    case 'frost':
      acc.add('cyl6', [x, y0, z], [0.11 + rnd() * 0.05, 0.012, 0.09 + rnd() * 0.04], ry, pal.frost);
      break;
    case 'moss':
      acc.add('cyl6', [x, y0, z], [0.1, 0.014, 0.08], ry, pal.moss);
      acc.add('ico', [x + 0.03, y0 + 0.012, z], [0.035, 0.02, 0.035], ry, pal.moss);
      break;
    case 'puddle':
      acc.add('cyl7', [x, y0, z], [0.12 + rnd() * 0.04, 0.01, 0.09], ry, pal.water);
      break;
    case 'mushroom':
      acc.add('cyl6', [x, y0, z], [0.012, 0.06, 0.012], 0, pal.bone);
      acc.add('cone6', [x, y0 + 0.05, z], [0.05, 0.045, 0.05], 0, pal.cap);
      break;
    case 'heather':
      for (let i = 0; i < 2; i++) acc.add('cone5', [x + i * 0.035, y0, z + i * 0.02], [0.03, 0.1 - i * 0.025, 0.03], ry, pal.heather);
      break;
    case 'bone':
      acc.add('box', [x, y0, z], [0.14, 0.02, 0.025], ry, pal.bone);
      acc.add('box', [x, y0, z], [0.1, 0.02, 0.022], ry + 0.9, pal.bone);
      break;
    case 'dry': // brindille sèche
      acc.add('cone5', [x, y0, z], [0.014, 0.09, 0.014], 0, pal.sandDark, 0.5, ry);
      acc.add('cone5', [x + 0.02, y0, z], [0.012, 0.07, 0.012], 0, pal.sandDark, -0.4, ry);
      break;
  }
}

/** Neige en altitude (mode Montagnes) : petites calottes sur les cases hautes. */
const SNOW_LINE = 4;

function decorateCells(acc: Acc, terrain: Terrain, pal: DecorPalette) {
  const { size, heights, mode, seed } = terrain;
  const classes = classifyCells(heights);
  const recipe = RECIPES[mode];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Un générateur par case : le décor d'une case ne dépend pas de l'ordre de parcours.
      const rnd = mulberry32(hashSeed(`${seed}:decor:${r},${c}`));
      const cls = classes[r][c];
      const { kinds, n } = recipe[cls];
      const { x: cx, z: cz } = cellCenter(size, r, c);
      const y = topY(heights[r][c]);
      // Plateau lisible : 0 ou 1 petit détail par case (un peu plus sur falaises/cuvettes, qui racontent le relief).
      const p1 = cls === 'cliff' || cls === 'basin' || cls === 'summit' ? 0.85 : 0.5;
      const count = rnd() < p1 ? 1 : 0;
      void n;
      for (let i = 0; i < count; i++) {
        let kind = kinds[Math.floor(rnd() * kinds.length)];
        if (mode === 'mountains' && heights[r][c] >= SNOW_LINE && rnd() < 0.5) kind = 'frost';
        // Anneau 0,3–0,43 autour du centre : la pièce posée reste entièrement visible.
        const a = rnd() * Math.PI * 2;
        const rad = 0.27 + rnd() * 0.12;
        const dx = Math.max(-0.36, Math.min(0.36, Math.cos(a) * rad));
        const dz = Math.max(-0.36, Math.min(0.36, Math.sin(a) * rad));
        surfaceDetail(acc, kind, cx + dx * CELL, y, cz + dz * CELL, rnd, pal);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Éléments hauts (autour du plateau : bordure d'île, îlots)
// ---------------------------------------------------------------------------

type Prop = 'pine' | 'oak' | 'fern' | 'mushroom' | 'rock' | 'snowrock' | 'stone' | 'heather' | 'flower' | 'grass' | 'cactus' | 'bone';

/** Éléments de décor par mode, avec leur poids de tirage. */
const PROPS: Record<TerrainMode, [Prop, number][]> = {
  woods: [['pine', 3], ['oak', 3], ['fern', 2], ['mushroom', 1], ['rock', 1]],
  mountains: [['pine', 3], ['snowrock', 3], ['rock', 2]],
  valleys: [['oak', 1], ['flower', 3], ['grass', 3], ['rock', 1]],
  highlands: [['heather', 3], ['stone', 2], ['rock', 2], ['grass', 1]],
  desert: [['cactus', 3], ['rock', 2], ['bone', 1]],
  random: [['oak', 1], ['pine', 1], ['rock', 1], ['flower', 1], ['grass', 1], ['heather', 1]],
};

function pickWeighted<T>(list: [T, number][], rnd: () => number): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let t = rnd() * total;
  for (const [v, w] of list) if ((t -= w) <= 0) return v;
  return list[0][0];
}

function prop(acc: Acc, kind: Prop, x: number, y: number, z: number, s: number, rnd: () => number, pal: DecorPalette) {
  const ry = rnd() * Math.PI * 2;
  switch (kind) {
    case 'pine':
      acc.add('box', [x, y, z], [0.07 * s, 0.22 * s, 0.07 * s], ry, pal.trunk);
      acc.add('cone6', [x, y + 0.14 * s, z], [0.36 * s, 0.5 * s, 0.36 * s], ry, pal.leafDark);
      acc.add('cone6', [x, y + 0.4 * s, z], [0.28 * s, 0.45 * s, 0.28 * s], ry, pal.leaf);
      acc.add('cone6', [x, y + 0.65 * s, z], [0.18 * s, 0.4 * s, 0.18 * s], ry, pal.leafDark);
      break;
    case 'oak':
      acc.add('box', [x, y, z], [0.08 * s, 0.35 * s, 0.08 * s], ry, pal.trunk);
      acc.add('ico', [x, y + 0.5 * s, z], [0.3 * s, 0.26 * s, 0.3 * s], ry, pal.leaf);
      acc.add('ico', [x + 0.12 * s, y + 0.4 * s, z + 0.06 * s], [0.18 * s, 0.16 * s, 0.18 * s], ry, pal.leafDark);
      break;
    case 'fern':
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + ry;
        acc.add('cone5', [x + Math.cos(a) * 0.04 * s, y, z + Math.sin(a) * 0.04 * s], [0.045 * s, 0.32 * s, 0.012 * s], -a, pal.leaf, 0, 0.9);
      }
      break;
    case 'mushroom':
      acc.add('cyl6', [x, y, z], [0.035 * s, 0.14 * s, 0.035 * s], 0, pal.bone);
      acc.add('cone6', [x, y + 0.12 * s, z], [0.13 * s, 0.1 * s, 0.13 * s], 0, pal.cap);
      break;
    case 'rock':
      acc.add('dodeca', [x, y + 0.12 * s, z], [0.22 * s, 0.16 * s, 0.2 * s], ry, pal.stone);
      acc.add('dodeca', [x + 0.2 * s, y + 0.06 * s, z + 0.08 * s], [0.1 * s, 0.08 * s, 0.1 * s], ry + 1, pal.stoneDark);
      break;
    case 'snowrock':
      acc.add('dodeca', [x, y + 0.2 * s, z], [0.26 * s, 0.26 * s, 0.24 * s], ry, pal.stone);
      acc.add('cone5', [x, y + 0.3 * s, z], [0.17 * s, 0.14 * s, 0.17 * s], ry, pal.snow);
      break;
    case 'stone': // pierre levée
      acc.add('box', [x, y, z], [0.14 * s, 0.6 * s, 0.1 * s], ry, pal.stone, 0, (rnd() - 0.5) * 0.15);
      acc.add('box', [x + 0.1 * s, y, z], [0.1 * s, 0.35 * s, 0.08 * s], ry, pal.stoneDark);
      break;
    case 'heather':
      for (let i = 0; i < 4; i++) acc.add('cone5', [x + (rnd() - 0.5) * 0.18 * s, y, z + (rnd() - 0.5) * 0.18 * s], [0.08 * s, 0.2 * s, 0.08 * s], ry, i % 2 ? pal.heather : pal.grass);
      break;
    case 'flower': {
      const c = pal.flowers[Math.floor(rnd() * pal.flowers.length)];
      for (let i = 0; i < 3; i++) {
        const fx = x + (rnd() - 0.5) * 0.2 * s;
        const fz = z + (rnd() - 0.5) * 0.2 * s;
        acc.add('cone5', [fx, y, fz], [0.012 * s, 0.14 * s, 0.012 * s], 0, pal.grass);
        acc.add('ico', [fx, y + 0.15 * s, fz], [0.04 * s, 0.03 * s, 0.04 * s], ry, pal.flowers[(i + Math.floor(c.r * 9)) % pal.flowers.length]);
      }
      break;
    }
    case 'grass':
      for (let i = 0; i < 4; i++) {
        const a = ry + i * 1.6;
        acc.add('cone5', [x + Math.cos(a) * 0.04 * s, y, z + Math.sin(a) * 0.04 * s], [0.03 * s, 0.2 * s, 0.03 * s], 0, pal.grass, Math.cos(a) * 0.3, Math.sin(a) * 0.3);
      }
      break;
    case 'cactus':
      acc.add('cyl6', [x, y, z], [0.07 * s, 0.5 * s, 0.07 * s], ry, pal.cactus);
      acc.add('cone6', [x, y + 0.5 * s, z], [0.07 * s, 0.07 * s, 0.07 * s], ry, pal.cactus);
      acc.add('cyl6', [x + 0.1 * s, y + 0.2 * s, z], [0.04 * s, 0.22 * s, 0.04 * s], ry, pal.cactus);
      acc.add('box', [x + 0.05 * s, y + 0.2 * s, z], [0.1 * s, 0.04 * s, 0.04 * s], 0, pal.cactus);
      break;
    case 'bone':
      acc.add('box', [x, y, z], [0.3 * s, 0.05 * s, 0.05 * s], ry, pal.bone);
      acc.add('ico', [x + 0.17 * s, y + 0.04 * s, z], [0.07 * s, 0.06 * s, 0.07 * s], ry, pal.bone);
      break;
  }
}

/** Bordure de la dalle : le dessus de l'île fait 0,55 de plus que le plateau de chaque côté. */
function decorateRim(acc: Acc, terrain: Terrain, pal: DecorPalette) {
  const rnd = mulberry32(hashSeed(`${terrain.seed}:rim`));
  const half = terrain.size / 2; // 5
  const list = PROPS[terrain.mode];
  const perSide = 26;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < perSide; i++) {
      const u = ((i + 0.2 + rnd() * 0.6) / perSide) * (half * 2 + 1) - (half + 0.5);
      const off = half + 0.17 + rnd() * 0.22; // dans la bande libre 5,0–5,55
      let x = u, z = -off;
      if (side === 1) { x = off; z = u; }
      if (side === 2) { x = u; z = off; }
      if (side === 3) { x = -off; z = u; }
      // Côté caméra (+Z) : éléments plus petits pour ne jamais masquer la rangée de départ.
      const front = side === 2 ? 0.6 : 1.25;
      const kind = pickWeighted(list, rnd);
      prop(acc, kind, x, 0, z, (0.8 + rnd() * 0.7) * front, rnd, pal);
    }
  }
}

/** Dessous de l'île : stalactites et blocs suspendus qui épousent la silhouette du cône rocheux. */
function decorateUnderside(acc: Acc, terrain: Terrain, pal: DecorPalette, skin: Skin) {
  const rnd = mulberry32(hashSeed(`${terrain.seed}:under`));
  const rock = mix(skin.rock, pal.stoneDark, 0.3);
  const rockLight = mix(skin.rock, skin.high, 0.2);
  for (let i = 0; i < 80; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 0.3 + rnd() * 4.2; // profondeur sous la dalle
    const R = 7.2 * (1 - (d + 0.5) / 6.2) * 0.95 + 0.1; // rayon du cône à cette profondeur
    const len = 0.5 + rnd() * 1.1;
    const w = 0.12 + rnd() * 0.16;
    // Pointe vers le bas : on retourne le cône (rx = π), son origine devient le sommet de la base.
    acc.add('cone5', [Math.cos(a) * R, -0.5 - d, Math.sin(a) * R], [w, len, w], rnd() * 6, i % 3 ? rock : rockLight, Math.PI);
  }
  for (let i = 0; i < 18; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 0.5 + rnd() * 3;
    const R = 7.2 * (1 - (d + 0.5) / 6.2) * 0.95 + 0.1;
    const s = 0.2 + rnd() * 0.3;
    acc.add('dodeca', [Math.cos(a) * R, -0.5 - d, Math.sin(a) * R], [s, s * 0.8, s], rnd() * 6, rockLight);
  }
}

/** Petits îlots flottants avec un élément du thème, autour de l'île principale. */
function decorateIslets(acc: Acc, terrain: Terrain, pal: DecorPalette, skin: Skin) {
  const rnd = mulberry32(hashSeed(`${terrain.seed}:islets`));
  const list = PROPS[terrain.mode];
  const rock = mix(skin.rock, skin.high, 0.1);
  const count = 11;
  for (let k = 0; k < count; k++) {
    // Répartis autour, jamais derrière le plateau côté caméra (+Z) trop près.
    const a = (k / count) * Math.PI * 2 + 0.4 + rnd() * 0.5;
    const dist = 11 + rnd() * 10;
    const x = Math.cos(a) * dist;
    const z = Math.sin(a) * dist;
    const y = -3.5 + rnd() * 4.5;
    const R = 0.7 + rnd() * 1.5;
    acc.add('cyl7', [x, y - 0.25, z], [R, 0.25, R], rnd() * 6, pal.islet);
    acc.add('cone6', [x, y - 0.25, z], [R * 0.95, R * 1.7, R * 0.95], Math.PI, rock, Math.PI);
    const n = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const aa = rnd() * Math.PI * 2;
      const rr = rnd() * R * 0.5;
      prop(acc, pickWeighted(list, rnd), x + Math.cos(aa) * rr, y, z + Math.sin(aa) * rr, 0.8 + rnd() * 0.6, rnd, pal);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Éléments translucides : cascade et nuages d'appoint
// ---------------------------------------------------------------------------

function decorateTranslucent(acc: Acc, terrain: Terrain, pal: DecorPalette) {
  const rnd = mulberry32(hashSeed(`${terrain.seed}:sky`));
  // Cascade (modes à eau) : chute depuis le bord de la dalle, puis coulée le long du cône rocheux
  // (décalée vers l'extérieur pour ne pas s'enfouir dans la roche), avec des embruns au pied.
  if (terrain.mode === 'valleys' || terrain.mode === 'highlands') {
    const z = 1.5; // côté gauche : visible dans la vue par défaut
    // Nappe qui déborde du bord de la dalle, puis chute verticale en dehors du rocher (x = −7,6).
    acc.add('box', [-6.6, -0.42, z], [2.1, 0.07, 1.0], 0, pal.water);
    acc.add('box', [-7.6, -3.0, z], [0.14, 2.6, 1.0], 0, pal.water);
    acc.add('ico', [-7.4, -0.4, z], [0.45, 0.14, 0.6], 0, pal.frost);
    acc.add('ico', [-7.4, -3.1, z], [0.5, 0.25, 0.7], 0, pal.frost);
  }
  // Nuages d'appoint : amas de 3 à 4 volumes écrasés, loin du plateau.
  for (let k = 0; k < 5; k++) {
    const a = k * 1.3 + rnd();
    const dist = 14 + rnd() * 10;
    const x = Math.cos(a) * dist;
    const z = Math.sin(a) * dist;
    const y = -6 + rnd() * 9;
    const puffs = 3 + Math.floor(rnd() * 2);
    for (let p = 0; p < puffs; p++) {
      const s = 0.7 + rnd() * 0.8;
      acc.add('ico', [x + p * 0.9 - puffs * 0.45, y + rnd() * 0.3, z + (rnd() - 0.5) * 0.8], [s, s * 0.6, s], rnd() * 6, pal.cloud);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Assemblage
// ---------------------------------------------------------------------------

/** Budget global de triangles du décor (mobile). */
export const DECOR_TRIANGLE_BUDGET = 30000;

export interface DecorView {
  group: THREE.Group;
  /** Triangles total et nombre de maillages (≈ appels de dessin). */
  stats: { triangles: number; drawCalls: number };
  dispose(): void;
}

export function buildDecor(terrain: Terrain, skin: Skin): DecorView {
  const pal = decorPalette(skin, terrain.mode);
  const rand = mulberry32(hashSeed(`${terrain.seed}:tint`));
  const group = new THREE.Group();
  group.name = 'decor';

  // 3 maillages : détails des cases (pas d'ombre portée), décor autour (ombres), éléments translucides.
  const surface = new Acc(rand, 16000);
  decorateCells(surface, terrain, pal);
  const around = new Acc(rand, 10000);
  decorateRim(around, terrain, pal);
  decorateUnderside(around, terrain, pal, skin);
  decorateIslets(around, terrain, pal, skin);
  const sky = new Acc(rand, 4000);
  decorateTranslucent(sky, terrain, pal);

  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
  const glass = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, transparent: true, opacity: 0.85, depthWrite: false });
  let triangles = 0;
  let drawCalls = 0;
  const mk = (acc: Acc, mat: THREE.Material, cast: boolean, name: string) => {
    const g = acc.build();
    if (!g) return;
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
    triangles += acc.tris;
    drawCalls++;
  };
  mk(surface, solid, false, 'decor-surface');
  mk(around, solid, true, 'decor-around');
  mk(sky, glass, false, 'decor-sky');

  return {
    group,
    stats: { triangles, drawCalls },
    dispose() {
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      solid.dispose();
      glass.dispose();
    },
  };
}
