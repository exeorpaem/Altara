// Calcul des forces d'un combat.
//
// Force d'attaque = Force de base de l'attaquant
//   + hauteur : +1 si la case d'appui (case voisine de la cible d'où l'attaquant
//               entre sur sa case, dernière case du chemin) est plus haute que
//               celle de la cible, −1 si plus basse, 0 sinon ;
//   + alliés  : + la Force de base de chaque AUTRE pièce alliée de l'attaquant
//               orthogonalement adjacente à la cible ;
//   + charge  : +1 si l'attaquant est une Avant-garde et que le chemin le plus
//               court jusqu'à la cible PASSANT PAR la case d'appui (entrée comprise)
//               coûte exactement 4.
// Quand plusieurs cases d'appui sont possibles, le moteur choisit celle qui donne
// la meilleure attaque (voir actions.ts).
// Force de défense = Force de base du défenseur
//   + renforts : +1 par pièce alliée du défenseur orthogonalement adjacente à lui.
//
// L'attaque est légale si attaque ≥ défense.
import { PIECES, RULES } from './rules';
import { STRENGTH, TYPE_OF, VANGUARD, type CoreState } from './core';

export interface CombatResult {
  attack: number;
  defense: number;
  /** Détail lisible des modificateurs (rempli seulement si demandé). */
  details: string[];
}

const signed = (v: number) => (v > 0 ? `+${v}` : `−${-v}`);

/**
 * @param attacker indice de la pièce qui attaque (encore sur sa case de départ)
 * @param target   indice de la pièce attaquée
 * @param cost     coût du chemin le plus court jusqu'à la cible via `via`, entrée comprise
 * @param via      case d'appui : voisine de la cible, d'où l'attaquant entre sur sa case
 */
export function combat(
  s: CoreState,
  attacker: number,
  target: number,
  cost: number,
  via: number,
  withDetails = false,
): CombatResult {
  const { heights, neigh } = s.topo;
  const C = RULES.combat;
  const details: string[] = [];
  const aType = s.ptype[attacker];
  const dType = s.ptype[target];
  const aPlayer = s.pplayer[attacker];
  const tCell = s.ppos[target];

  let attack = STRENGTH[aType];
  if (withDetails) details.push(`Attaque : Force de base ${STRENGTH[aType]} (${PIECES[TYPE_OF[aType]].name})`);

  const dh = heights[via] - heights[tCell];
  if (dh !== 0) {
    const v = dh > 0 ? C.height : -C.height;
    attack += v;
    if (withDetails) details.push(`${signed(v)} hauteur (${dh > 0 ? 'appui plus haut que la cible' : 'appui plus bas que la cible'})`);
  }

  let defense = STRENGTH[dType];
  const defDetails: string[] = [];
  for (let k = 0; k < 4; k++) {
    const nb = neigh[tCell * 4 + k];
    if (nb < 0) continue;
    const q = s.board[nb];
    if (q < 0 || q === attacker) continue;
    if (s.pplayer[q] === aPlayer) {
      attack += STRENGTH[s.ptype[q]];
      if (withDetails) details.push(`${signed(STRENGTH[s.ptype[q]])} allié (${PIECES[TYPE_OF[s.ptype[q]]].name})`);
    } else {
      defense += C.reinforcement;
      if (withDetails) defDetails.push(`${signed(C.reinforcement)} renfort (${PIECES[TYPE_OF[s.ptype[q]]].name})`);
    }
  }

  if (aType === VANGUARD && cost === C.chargeCost) {
    attack += C.charge;
    if (withDetails) details.push(`${signed(C.charge)} charge (chemin de coût ${C.chargeCost})`);
  }

  if (withDetails) details.push(`Défense : Force de base ${STRENGTH[dType]} (${PIECES[TYPE_OF[dType]].name})`, ...defDetails);
  return { attack, defense, details };
}
