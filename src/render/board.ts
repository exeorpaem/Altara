// Rendu du plateau : colonnes de blocs low-poly empilés, un bloc par niveau.
//
// Lisibilité des hauteurs : chaque bloc a des arêtes biseautées, ce qui creuse
// une rainure entre deux niveaux ; on y glisse un fin liseré plus foncé. On peut
// ainsi compter les niveaux d'une colonne sans tourner la caméra.
// Les blocs sont dessinés avec des InstancedMesh (un seul appel de dessin pour
// tous les blocs) : jusqu'à 700 blocs restent très légers.
import * as THREE from 'three';
import type { Terrain } from '../engine/terrain';
import type { PlayerId } from '../engine/rules';
import { PALETTE } from './palette';
import { SKINS, type Skin } from './skins';

/** Taille d'une case et hauteur d'un niveau, en unités monde. */
export const CELL = 1;
export const LEVEL_H = 0.3;
/** Épaisseur du socle (niveau 0) : une case de hauteur 0 reste un bloc visible. */
const GAP = 0.05; // jour entre deux colonnes voisines
const BEVEL = 0.03;

/** Coordonnées monde du centre d'une case. La rangée 0 (départ J1) est côté +Z (près de la caméra). */
export function cellCenter(size: number, row: number, col: number): { x: number; z: number } {
  return { x: (col - (size - 1) / 2) * CELL, z: ((size - 1) / 2 - row) * CELL };
}

/** Altitude du dessus d'une case de hauteur h. */
export const topY = (h: number) => (h + 1) * LEVEL_H;

/** Bloc biseauté : carré aux coins chanfreinés, extrudé avec un biseau d'une seule facette. */
function chamferedBlock(size: number, height: number, chamfer: number, bevel: number): THREE.BufferGeometry {
  const s = size / 2 - bevel;
  const c = chamfer;
  const shape = new THREE.Shape();
  shape.moveTo(-s + c, -s);
  shape.lineTo(s - c, -s);
  shape.lineTo(s, -s + c);
  shape.lineTo(s, s - c);
  shape.lineTo(s - c, s);
  shape.lineTo(-s + c, s);
  shape.lineTo(-s, s - c);
  shape.lineTo(-s, -s + c);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: height - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2); // l'extrusion part en +Z : on la redresse vers +Y
  g.translate(0, bevel, 0); // le dessous du bloc est à y = 0
  return g;
}

/** Couleur d'un niveau : s'éclaircit avec l'altitude, avec une nuance propre au skin dans les creux. */
function levelColor(level: number, maxLevel: number, skin: Skin): THREE.Color {
  if (skin.shallow && level <= 1) return new THREE.Color(level === 0 ? skin.hollow : skin.shallow);
  const t = level / Math.max(1, maxLevel);
  const c = new THREE.Color(skin.low).lerp(new THREE.Color(skin.high), t);
  const hollow = Math.max(0, 1 - level / 2) * skin.hollowMix; // niveaux 0 et 1 seulement
  return c.lerp(new THREE.Color(skin.hollow), hollow);
}

export interface BoardView {
  group: THREE.Group;
  terrain: Terrain;
  /** Point au centre du dessus de la case (pour poser une pièce ou un marqueur). */
  cellTop(row: number, col: number): THREE.Vector3;
  /** Maillage des blocs (pour le lancer de rayon) et case correspondant à une instance. */
  pickMesh: THREE.InstancedMesh;
  cellOfInstance(id: number): { row: number; col: number };
  dispose(): void;
}

export function buildBoard(terrain: Terrain, maxLevel = 6, skin: Skin = SKINS[0]): BoardView {
  const { size, heights } = terrain;
  const group = new THREE.Group();
  group.name = 'board';

  // --- Blocs -------------------------------------------------------------
  let blockCount = 0;
  for (const row of heights) for (const h of row) blockCount += h + 1;

  const blockGeo = chamferedBlock(CELL - GAP, LEVEL_H, 0.08, BEVEL);
  const blockMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.92, metalness: 0 });
  const blocks = new THREE.InstancedMesh(blockGeo, blockMat, blockCount);
  blocks.castShadow = true;
  blocks.receiveShadow = true;

  // Liserés : fines plaques foncées logées dans la rainure entre deux niveaux.
  // Presque à fleur des faces : la plaque remplit la rainure et dessine un trait net.
  const lineGeo = new THREE.BoxGeometry(CELL - GAP - 0.006, 0.026, CELL - GAP - 0.006);
  const lineMat = new THREE.MeshStandardMaterial({ color: skin.line, roughness: 1 });
  const lines = new THREE.InstancedMesh(lineGeo, lineMat, blockCount);

  const coral = new THREE.Color(PALETTE.camp[1]);
  const lagoon = new THREE.Color(PALETTE.camp[2]);
  const neutral = new THREE.Color('#F4EFEA');
  const m = new THREE.Matrix4();
  let i = 0;
  let li = 0;
  /** instanceId du bloc → case (r·100 + c), pour savoir quelle case est sous le pointeur. */
  const instanceCell: number[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const { x, z } = cellCenter(size, r, c);
      const h = heights[r][c];
      for (let level = 0; level <= h; level++) {
        m.makeTranslation(x, level * LEVEL_H, z);
        blocks.setMatrixAt(i, m);
        const col = levelColor(level, maxLevel, skin);
        // Rangées d'arrivée : le bloc du dessus prend la couleur du camp qui doit y sortir.
        // J1 (corail) sort par la dernière rangée, J2 (lagon) par la rangée 0.
        // Mélange sur une base claire neutre (un peu du sol pour garder le relief) : la teinte du camp
        // reste reconnaissable quelle que soit la palette (pas de violet ni de gris).
        if (level === h && (r === size - 1 || r === 0)) {
          const camp = r === 0 ? lagoon : coral;
          col.lerp(neutral, 0.7).lerp(camp, 0.72);
        }
        blocks.setColorAt(i, col);
        instanceCell.push(r * 100 + c);
        i++;
        if (level > 0) {
          m.makeTranslation(x, level * LEVEL_H, z);
          lines.setMatrixAt(li++, m);
        }
      }
    }
  }
  lines.count = li;
  blocks.instanceMatrix.needsUpdate = true;
  if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
  group.add(blocks, lines);

  // --- Halos au-delà des bords d'arrivée ------------------------------------
  group.add(arrivalHalo(terrain, 1), arrivalHalo(terrain, 2));

  const cellTop = (row: number, col: number) => {
    const { x, z } = cellCenter(size, row, col);
    return new THREE.Vector3(x, topY(heights[row][col]), z);
  };

  return {
    group,
    terrain,
    cellTop,
    pickMesh: blocks,
    cellOfInstance: (id) => ({ row: Math.floor(instanceCell[id] / 100), col: instanceCell[id] % 100 }),
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose();
      });
    },
  };
}

/** Texture de dégradé (opaque au bord du plateau → transparent vers l'extérieur). */
function haloTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Halo d'arrivée : un voile lumineux qui « déborde » du bord par lequel le camp
 * doit sortir. Une bande en dégradé, en transparence, posée au ras de l'île.
 */
function arrivalHalo(terrain: Terrain, player: PlayerId): THREE.Group {
  const { size } = terrain;
  const half = (size * CELL) / 2;
  const tex = haloTexture();
  const mat = new THREE.MeshBasicMaterial({
    color: PALETTE.camp[player],
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const g = new THREE.Group();
  const depth = 1.5;
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(size * CELL + 0.6, depth), mat);
  // Le haut de la texture (opaque) passe côté +Z local, c'est-à-dire contre le bord du plateau.
  strip.rotation.x = Math.PI / 2;
  // Posé juste au-dessus de la dalle de l'île, il s'en échappe dans le vide.
  strip.position.set(0, 0.015, -(half + depth / 2));
  g.add(strip);
  // Le groupe est construit pour le bord −Z (arrivée de J1) puis tourné pour J2.
  if (player === 2) g.rotation.y = Math.PI;
  g.renderOrder = 2;
  return g;
}
