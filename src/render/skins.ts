// Skins de plateau, un par mode de terrain : seul le décor change, jamais les couleurs des camps
// (corail et lagon doivent rester lisibles sur toutes les palettes).
import type { TerrainMode } from '../engine/terrain';

export interface Skin {
  id: string;
  name: string;
  /** Bloc le plus bas → bloc le plus haut (dégradé d'altitude) */
  low: string;
  high: string;
  /** Teinte des creux (niveaux 0 et 1) et force du mélange */
  hollow: string;
  hollowMix: number;
  /** Liseré entre deux niveaux */
  line: string;
  /** Dalle de l'île et roche du socle */
  slab: string;
  rock: string;
  sky: { top: string; bottom: string };
  fog: string;
  cloud: string;
}

export const SKINS: Skin[] = [
  {
    id: 'dunes',
    name: 'Dunes',
    low: '#D8C59C',
    high: '#FFF9EE',
    hollow: '#A3BC8E',
    hollowMix: 0.55,
    line: '#8F7F69',
    slab: '#D9CBB4',
    rock: '#B7A99A',
    sky: { top: '#BFD9F2', bottom: '#FCE9DC' },
    fog: '#EADFE0',
    cloud: '#FFFFFF',
  },
  {
    id: 'prairie',
    name: 'Prairie',
    low: '#9DBF8A',
    high: '#EEF3D6',
    hollow: '#7FAE9A',
    hollowMix: 0.5,
    line: '#6F8462',
    slab: '#C9B99A',
    rock: '#A39686',
    sky: { top: '#B9E0F0', bottom: '#F4F1D8' },
    fog: '#DCEBE0',
    cloud: '#FFFFFF',
  },
  {
    id: 'banquise',
    name: 'Banquise',
    low: '#B7CDE0',
    high: '#FBFDFF',
    hollow: '#8FB8D6',
    hollowMix: 0.5,
    line: '#7F95AE',
    slab: '#DDE6EF',
    rock: '#9AA6B8',
    sky: { top: '#C9CCF0', bottom: '#EEF2FA' },
    fog: '#E3E7F3',
    cloud: '#FFFFFF',
  },
  {
    id: 'ardoise',
    name: 'Ardoise',
    low: '#9EA7AE',
    high: '#E8EBEC',
    hollow: '#8A9C98',
    hollowMix: 0.45,
    line: '#5E676E',
    slab: '#B9BEC1',
    rock: '#7F878D',
    sky: { top: '#C8D2DA', bottom: '#EDEFF0' },
    fog: '#DDE2E5',
    cloud: '#F7F8F9',
  },
  {
    id: 'jardin',
    name: 'Jardin zen',
    low: '#CFC6B4',
    high: '#F7F4EC',
    hollow: '#B9C9A0',
    hollowMix: 0.6,
    line: '#6B6458',
    slab: '#8E9A7A',
    rock: '#7C7468',
    sky: { top: '#D7E6E0', bottom: '#F6EEE2' },
    fog: '#E6EAE2',
    cloud: '#FFFFFF',
  },
  {
    id: 'foret',
    name: 'Forêt',
    low: '#6F9A66',
    high: '#C9DDB0',
    hollow: '#4F8A6A',
    hollowMix: 0.55,
    line: '#42593E',
    slab: '#9C8F72',
    rock: '#7A6D5C',
    sky: { top: '#A5C4D6', bottom: '#DCE6CF' },
    fog: '#C5D6C4',
    cloud: '#F1F5EC',
  },
  {
    id: 'volcan',
    name: 'Volcan',
    low: '#6E6862',
    high: '#B9A89A',
    hollow: '#4F4A4C',
    hollowMix: 0.5,
    line: '#2E2A2C',
    slab: '#5A5457',
    rock: '#3E393C',
    sky: { top: '#CE9A5E', bottom: '#F2C08A' },
    fog: '#C9A892',
    cloud: '#E8C7A8',
  },
  {
    id: 'lagon',
    name: 'Lagon',
    low: '#EAD9AE',
    high: '#FFF8E4',
    hollow: '#58B0E8',
    hollowMix: 1,
    line: '#A8946A',
    slab: '#E6D8B8',
    rock: '#B8A78A',
    sky: { top: '#9CCBEA', bottom: '#F6F0DC' },
    fog: '#E3ECF4',
    cloud: '#FFFFFF',
  },
  {
    id: 'marais',
    name: 'Marais',
    low: '#8A9457',
    high: '#D6D8A8',
    hollow: '#6C7F4E',
    hollowMix: 0.55,
    line: '#4F5A38',
    slab: '#A89C78',
    rock: '#7E7458',
    sky: { top: '#B5C2B0', bottom: '#E4E6CC' },
    fog: '#CBD2BC',
    cloud: '#EEF0E0',
  },
  {
    id: 'canyon',
    name: 'Canyon',
    low: '#CC9460',
    high: '#F0CFA0',
    hollow: '#C48C4C',
    hollowMix: 0.5,
    line: '#7A5228',
    slab: '#D6AE80',
    rock: '#A87238',
    sky: { top: '#E6B88E', bottom: '#F8E2C6' },
    fog: '#E8CDB4',
    cloud: '#FFF1E2',
  },
];

/** Le skin est imposé par le mode de terrain (le joueur ne le choisit plus). */
export const MODE_SKIN: Record<TerrainMode, string> = {
  random: 'jardin',
  mountains: 'banquise',
  valleys: 'prairie',
  highlands: 'ardoise',
  woods: 'foret',
  desert: 'dunes',
  volcano: 'volcan',
  archipelago: 'lagon',
  marsh: 'marais',
  canyon: 'canyon',
};

export const skinById = (id: string | null | undefined) => SKINS.find((s) => s.id === id) ?? SKINS[0];
export const skinForMode = (mode: TerrainMode): Skin => skinById(MODE_SKIN[mode]);
