// Registre des styles de pièces : le style actuel (render/pieces.ts, défaut du jeu)
// et les propositions à comparer. Tous exposent la même API que buildPieceMesh.
// Jeu : ?pieces=<id> · vitrine : ?style=<id> (ou ?style=all pour la grille).
import { buildPieceMesh } from '../pieces';
import { buildCelestialPiece } from './celestial';
import type { PieceBuilder } from './common';
import { buildGlassPiece } from './glass';
import { buildOrganicPiece } from './organic';
import { buildOrigamiPiece } from './origami';

export type { PieceBuilder, PieceMeshOptions } from './common';
export { disposePiece } from './common';

export interface PieceStyle {
  id: string;
  name: string;
  description: string;
  build: PieceBuilder;
}

export const DEFAULT_STYLE_ID = 'current';

export const PIECE_STYLES: PieceStyle[] = [
  { id: 'current', name: 'Actuel', description: "Design d'origine, en place dans le jeu.", build: buildPieceMesh },
  { id: 'glass', name: 'Flèches de verre', description: 'Fûts tordus à facettes, cristaux translucides.', build: buildGlassPiece },
  { id: 'organic', name: 'Sculpture organique', description: 'Profils en S, gorge fine, lames recourbées.', build: buildOrganicPiece },
  { id: 'celestial', name: 'Architecture céleste', description: 'Obélisques à gradins, halo flottant, aiguilles.', build: buildCelestialPiece },
  { id: 'origami', name: 'Origami', description: 'Colonnes plissées, ailettes pliées, arêtes vives.', build: buildOrigamiPiece },
];

/** Style d'identifiant `id`, ou le style par défaut si l'identifiant est inconnu/absent. */
export function pieceStyle(id: string | null | undefined): PieceStyle {
  return PIECE_STYLES.find((s) => s.id === id) ?? PIECE_STYLES.find((s) => s.id === DEFAULT_STYLE_ID)!;
}
