// Écran d'accueil : descriptions des terrains et mini-aperçu en relief (carte des hauteurs).
import type { TerrainMode } from '../engine/terrain';
import type { Skin } from '../render/skins';

export const MODE_BLURB: Record<TerrainMode, string> = {
  random: 'Relief libre : collines et creux tirés au hasard.',
  mountains: 'Un ou deux pics au centre, entourés de contreforts à gravir.',
  valleys: 'Un plateau haut creusé de quelques cuvettes : les crêtes servent de passages.',
  highlands: 'Un pic et une cuvette face à face : montagnes et vallées réunies.',
  woods: 'Collines douces, peu de dénivelé : un jeu de manœuvre.',
  desert: 'Grandes étendues plates, parfois un pic isolé : course de vitesse.',
  volcano: 'Un grand cône au centre, pentes raides vers les bords.',
  archipelago: 'Des plateaux séparés par des creux profonds : il faut choisir ses îles.',
  marsh: 'Presque plat, parsemé de petites cuvettes qui ralentissent.',
  canyon: "Un couloir central entre deux falaises : tout le monde s'y retrouve.",
};

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/** Dessine les hauteurs (rangée 0 en bas = camp Corail) : clair = haut, creux teintés. */
export function drawTerrainPreview(canvas: HTMLCanvasElement, heights: number[][], skin: Skin, maxLevel = 6): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const n = heights.length;
  const cell = canvas.width / n;
  const lo = hex(skin.low), hi = hex(skin.high), hol = hex(skin.hollow);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const h = heights[r][c];
      const t = h / maxLevel;
      const hollow = Math.max(0, 1 - h / 2) * skin.hollowMix;
      const col = lo.map((v, i) => {
        const base = v + (hi[i] - v) * t;
        return Math.round(base + (hol[i] - base) * hollow);
      });
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.fillRect(c * cell, (n - 1 - r) * cell, cell, cell);
    }
  }
  // Bandes de départ : Corail en bas, Lagon en haut.
  ctx.fillStyle = '#F28B82';
  ctx.fillRect(0, canvas.height - 3, canvas.width, 3);
  ctx.fillStyle = '#6EC6CA';
  ctx.fillRect(0, 0, canvas.width, 3);
}
