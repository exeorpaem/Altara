// Générateur de plateaux.
//
// Principe, en 4 temps :
//   1. un champ continu est produit par du « value noise » fractal, façonné
//      différemment selon le mode (pics, cuvettes, plaines…) ;
//   2. symétrisation : chaque case et sa case opposée par rotation de 180°
//      reçoivent la moyenne des deux valeurs → plateau équitable ;
//   3. arrondi aux hauteurs entières et bornage à [min, max] ;
//   4. lissage : on corrige toute différence > 2 entre voisins orthogonaux.
// Les opérations 3 et 4 sont « symétriques » (elles traitent une case et son
// opposée exactement de la même façon), donc la symétrie survit au lissage.
import { RULES } from './rules';
import { hashSeed, mulberry32 } from './random';

export type TerrainMode = 'random' | 'mountains' | 'valleys' | 'highlands' | 'woods' | 'desert' | 'volcano' | 'archipelago' | 'marsh' | 'canyon';

export const TERRAIN_MODES: { id: TerrainMode; label: string }[] = [
  { id: 'random', label: 'Aléatoire' },
  { id: 'mountains', label: 'Montagnes' },
  { id: 'valleys', label: 'Vallées' },
  { id: 'highlands', label: 'Hautes terres' },
  { id: 'woods', label: 'Bois' },
  { id: 'desert', label: 'Désert' },
  { id: 'volcano', label: 'Volcan' },
  { id: 'archipelago', label: 'Archipel' },
  { id: 'marsh', label: 'Marais' },
  { id: 'canyon', label: 'Canyon' },
];

export interface Terrain {
  size: number;
  mode: TerrainMode;
  seed: string;
  /** heights[row][col] ; la rangée 0 est le bord de départ du joueur 1 (en bas). */
  heights: number[][];
}

export interface TerrainOptions {
  size?: number;
  minHeight?: number;
  maxHeight?: number;
  maxDelta?: number;
}

// ---------------------------------------------------------------------------
// Bruit
// ---------------------------------------------------------------------------

/**
 * Value noise : des valeurs aléatoires sont tirées aux nœuds d'une grille
 * entière, puis interpolées (avec un lissage « smoothstep ») entre les nœuds.
 */
function makeValueNoise(rand: () => number) {
  const N = 32;
  const lattice = Array.from({ length: N * N }, () => rand());
  const at = (i: number, j: number) => lattice[(((i % N) + N) % N) * N + (((j % N) + N) % N)];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = fade(x - xi);
    const ty = fade(y - yi);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * tx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * tx;
    return a + (b - a) * ty; // dans [0, 1]
  };
}

/** Bruit fractal (fBm) : somme d'octaves de plus en plus fines et faibles, normalisée dans [0, 1]. */
function makeFbm(rand: () => number, octaves = 3) {
  const noise = makeValueNoise(rand);
  const ox = rand() * 100;
  const oy = rand() * 100;
  return (x: number, y: number) => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq + ox, y * freq + oy);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

interface Feature {
  x: number;
  y: number;
  s: number;
}

/**
 * Bosse gaussienne « symétrisée » : une en (x, y) et sa jumelle en (−x, −y).
 * Pourquoi : la symétrisation finale fait la moyenne d'une case et de son
 * opposée. Une bosse isolée y perdrait la moitié de sa hauteur ; une paire
 * de bosses déjà symétriques traverse la moyenne intacte.
 */
const bump = (u: number, v: number, f: Feature) => {
  const g = (cx: number, cy: number) => Math.exp(-((u - cx) ** 2 + (v - cy) ** 2) / f.s);
  // max plutôt que somme : deux bosses proches du centre ne s'additionnent pas.
  return Math.max(g(f.x, f.y), g(-f.x, -f.y));
};

// ---------------------------------------------------------------------------
// Façonnage par mode
// ---------------------------------------------------------------------------

/**
 * Renvoie une fonction (u, v) → hauteur continue (avant symétrie et arrondi).
 * u, v ∈ [-1, 1] avec (0, 0) au centre du plateau. H = hauteur maximale.
 */
function shapeFor(mode: TerrainMode, rand: () => number, H: number) {
  const fbm = makeFbm(rand);
  const n = (u: number, v: number, f: number) => fbm((u + 1) * f, (v + 1) * f);
  // Contraste : étire un bruit centré autour de 0,5 (sinon tout reste à mi-hauteur).
  const contrast = (x: number, k: number) => Math.min(1, Math.max(0, (x - 0.5) * k + 0.5));
  const between = (a: number, b: number) => a + rand() * (b - a);

  switch (mode) {
    case 'random':
      return (u: number, v: number) => H * contrast(n(u, v, 1.7), 2.6);

    case 'mountains': {
      // 1 ou 2 pics proches du centre (la symétrie les double) + contreforts bruités.
      const peaks = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({
        x: between(-0.35, 0.35),
        y: between(-0.3, 0.3),
        s: between(0.06, 0.12),
      }));
      return (u: number, v: number) => {
        let h = 0.6 + 1.6 * n(u, v, 2.2);
        for (const p of peaks) h = Math.max(h, (H + 0.5) * bump(u, v, p));
        return h;
      };
    }

    case 'valleys': {
      // Plateau haut, creusé de 2 à 3 cuvettes ; les crêtes restent entre elles.
      const basins = Array.from({ length: 2 + Math.floor(rand() * 2) }, () => ({
        x: between(-0.7, 0.7),
        y: between(-0.6, 0.6),
        s: between(0.08, 0.16),
      }));
      return (u: number, v: number) => {
        let h = H * (0.75 + 0.25 * n(u, v, 2));
        for (const b of basins) h -= H * 1.1 * bump(u, v, b);
        return h;
      };
    }

    case 'highlands': {
      // Montagnes et vallées réunies : un pic et une cuvette (doublés par la symétrie).
      // Le pic est placé sur un axe, la cuvette sur l'axe perpendiculaire : ils ne s'annulent pas.
      const ang = rand() * Math.PI;
      const dp = between(0.15, 0.4);
      const db = between(0.45, 0.65);
      const peak = { x: Math.cos(ang) * dp, y: Math.sin(ang) * dp, s: between(0.12, 0.18) };
      const basin = { x: -Math.sin(ang) * db, y: Math.cos(ang) * db, s: between(0.1, 0.16) };
      return (u: number, v: number) =>
        H * 0.45 +
        H * 0.4 * (n(u, v, 2) - 0.5) +
        H * 0.75 * bump(u, v, peak) -
        H * 0.75 * bump(u, v, basin);
    }

    case 'woods':
      // Collines douces : basse fréquence, faible amplitude (hauteurs ~ 0 à 3).
      return (u: number, v: number) => 3.4 * contrast(n(u, v, 1.8), 2.2);

    case 'desert': {
      // Étendues plates (0 ou 1) et, une fois sur deux, un pic isolé.
      const hasPeak = rand() < 0.55;
      const peak = { x: between(-0.6, 0.6), y: between(-0.5, 0.5), s: between(0.03, 0.05) };
      return (u: number, v: number) =>
        Math.max(1.2 * contrast(n(u, v, 1.5), 1.6), hasPeak ? H * bump(u, v, peak) : 0);
    }

    case 'volcano': {
      // Grand cône centré (le centre est son propre symétrique), cratère léger, pentes vers les bords.
      const sm = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
      return (u: number, v: number) => {
        const r = Math.hypot(u, v);
        const cone = (H + 0.6) * sm(1 - r / 0.95);
        const crater = 1.4 * Math.exp(-(r * r) / 0.012);
        return 0.3 + cone - crater + 0.9 * (n(u, v, 2.4) - 0.5);
      };
    }

    case 'archipelago': {
      // 2 paires de plateaux (la symétrie double chaque bosse), séparés par des creux profonds.
      const isles = Array.from({ length: 2 }, (_, i) => ({
        x: between(0.25, 0.6) * (i ? -1 : 1),
        y: between(0.2, 0.55),
        s: between(0.1, 0.17),
      }));
      return (u: number, v: number) => {
        let m = 0;
        for (const f of isles) m = Math.max(m, bump(u, v, f));
        const plateau = Math.min(1, Math.max(0, (m - 0.3) * 3.5)); // flanc raide, sommet plat
        return 0.2 + (2.8 + 2.0 * n(u, v, 2)) * plateau + 0.8 * (n(u, v, 3) - 0.5) * (1 - plateau);
      };
    }

    case 'marsh':
      // Quasi plat (1 à 3), parsemé de nombreuses petites cuvettes.
      return (u: number, v: number) => 1 + 2 * contrast(n(u, v, 4.2), 2.2);

    case 'canyon': {
      // Couloir central entre les deux camps (axe des rangées), légèrement sinueux ; deux falaises.
      // Décalage impair en v → la forme reste symétrique par rotation de 180°.
      const amp = between(0.05, 0.12);
      const k = between(1.5, 2.5);
      const sm = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
      return (u: number, v: number) => {
        const d = Math.abs(u - amp * Math.sin(k * v));
        const wall = sm((d - 0.2) / 0.28);
        return 0.4 + 0.5 * n(u, v, 3) + wall * (3.6 + 1.2 * n(u, v, 2));
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Lissage
// ---------------------------------------------------------------------------

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function neighbors(h: number[][], r: number, c: number): number[] {
  const out: number[] = [];
  for (const [dr, dc] of DIRS) {
    const row = h[r + dr];
    if (row && c + dc >= 0 && c + dc < row.length) out.push(row[c + dc]);
  }
  return out;
}

/**
 * Corrige les différences > maxDelta entre voisins orthogonaux.
 *
 * Phase 1 (douce, au plus 12 tours) : chaque case trop haute par rapport à un
 * voisin descend d'un cran, chaque case trop basse monte d'un cran ; toutes les
 * cases sont mises à jour en même temps. Les pics et les creux se rejoignent à
 * mi-chemin : le relief garde son caractère.
 *
 * Phase 2 (garantie) : h ← min(h, min(voisins) + maxDelta), répétée jusqu'à
 * stabilité. Les valeurs ne font que baisser et sont bornées, donc ça termine,
 * et à la fin plus aucune paire ne dépasse maxDelta.
 *
 * Les deux phases ne dépendent que des valeurs voisines, sans ordre de parcours,
 * donc une case et son opposée (même voisinage, par symétrie) évoluent pareil.
 */
function smooth(h: number[][], maxDelta: number): number[][] {
  let cur = h.map((row) => row.slice());
  const size = cur.length;

  for (let iter = 0; iter < 12; iter++) {
    let changed = false;
    const next = cur.map((row) => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const nb = neighbors(cur, r, c);
        const tooHigh = cur[r][c] > Math.min(...nb) + maxDelta;
        const tooLow = cur[r][c] < Math.max(...nb) - maxDelta;
        // Coincée entre un voisin très haut et un très bas : on laisse les voisins bouger.
        if (tooHigh && !tooLow) next[r][c]--, (changed = true);
        else if (tooLow && !tooHigh) next[r][c]++, (changed = true);
      }
    }
    cur = next;
    if (!changed) break;
  }

  for (let guard = 0; guard < 1000; guard++) {
    let changed = false;
    const next = cur.map((row) => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cap = Math.min(...neighbors(cur, r, c)) + maxDelta;
        if (cur[r][c] > cap) {
          next[r][c] = cap;
          changed = true;
        }
      }
    }
    cur = next;
    if (!changed) break;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

export function generateTerrain(mode: TerrainMode, seed: string, opts: TerrainOptions = {}): Terrain {
  const size = opts.size ?? RULES.board.size;
  const min = opts.minHeight ?? RULES.board.minHeight;
  const max = opts.maxHeight ?? RULES.board.maxHeight;
  const maxDelta = opts.maxDelta ?? RULES.board.maxNeighborDelta;

  // Le mode entre dans la seed : même seed + autre mode = autre plateau.
  const rand = mulberry32(hashSeed(`${mode}:${seed}`));
  const shape = shapeFor(mode, rand, max - min);

  // 1. Champ continu
  const raw: number[][] = [];
  for (let r = 0; r < size; r++) {
    raw.push([]);
    for (let c = 0; c < size; c++) {
      const u = (c / (size - 1)) * 2 - 1;
      const v = (r / (size - 1)) * 2 - 1;
      raw[r].push(shape(u, v));
    }
  }

  // 2 et 3. Symétrie centrale (rotation de 180°), arrondi, bornage
  const heights: number[][] = [];
  for (let r = 0; r < size; r++) {
    heights.push([]);
    for (let c = 0; c < size; c++) {
      const avg = (raw[r][c] + raw[size - 1 - r][size - 1 - c]) / 2;
      // Arrondi au demi supérieur, appliqué au même nombre pour les deux cases : symétrie exacte.
      heights[r].push(Math.min(max, Math.max(min, Math.round(avg + min))));
    }
  }

  // 4. Lissage
  return { size, mode, seed, heights: smooth(heights, maxDelta) };
}

/** Utilitaires de vérification (utilisés par les tests et en mode debug). */
export function maxNeighborDiff(t: Terrain): number {
  let worst = 0;
  for (let r = 0; r < t.size; r++)
    for (let c = 0; c < t.size; c++) {
      if (r + 1 < t.size) worst = Math.max(worst, Math.abs(t.heights[r][c] - t.heights[r + 1][c]));
      if (c + 1 < t.size) worst = Math.max(worst, Math.abs(t.heights[r][c] - t.heights[r][c + 1]));
    }
  return worst;
}

export function isRotationSymmetric(t: Terrain): boolean {
  const n = t.size;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (t.heights[r][c] !== t.heights[n - 1 - r][n - 1 - c]) return false;
  return true;
}
