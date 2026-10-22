// Palette pastel d'Altara (partagée par toutes les pages de rendu).
import type { PlayerId } from '../engine/rules';

export const PALETTE = {
  camp: {
    1: '#F28B82', // corail
    2: '#6EC6CA', // lagon
  } as Record<PlayerId, string>,
  sky: { top: '#BFD9F2', bottom: '#FCE9DC' },
  fog: '#EADFE0',
  sandLow: '#D8C59C',
  sandHigh: '#FFF9EE',
  sage: '#A3BC8E',
  rock: '#B7A99A',
};
