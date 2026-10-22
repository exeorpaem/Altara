// Skins de plateau : seul le décor change, jamais les couleurs des camps
// (corail et lagon doivent rester lisibles sur tous les skins).

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
    id: 'crepuscule',
    name: 'Crépuscule',
    low: '#C9B3CF',
    high: '#FFEBD8',
    hollow: '#9E9CC8',
    hollowMix: 0.5,
    line: '#8C7790',
    slab: '#D8C2C8',
    rock: '#9C8798',
    sky: { top: '#A9A5D6', bottom: '#FFD8B8' },
    fog: '#E9D3D6',
    cloud: '#FFF1E8',
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
];

export const skinById = (id: string | null | undefined) => SKINS.find((s) => s.id === id) ?? SKINS[0];
