// Évaluation statique d'une position pour l'IA.
//
// La valeur est toujours exprimée du point de vue d'un joueur `me` :
// positive = bon pour `me`. Chaque terme est calculé pour les deux camps et on
// fait la différence (moi − adversaire). Les poids sont dans EVAL_WEIGHTS,
// pour être réglés sans toucher au code.
import { RULES, type PlayerId } from '../rules';
import { pieceActions, sentinelExitWinsNow, K_ATTACK, type Action } from '../actions';
import { MOVEMENT, SENTINEL, ST_BOARD, STRENGTH, type CoreState } from '../core';

export interface EvalWeights {
  /** Valeur d'une victoire (les nulles valent 0). */
  win: number;
  /** Par point de score (Force des pièces sorties). */
  score: number;
  /** Matériel : par point de Force encore sur le plateau. */
  material: number;
  /**
   * Course : par point de Force × (horizon − coût minimal pour sortir).
   * Le coût vient d'un Dijkstra sur le terrain (pré-calculé par plateau),
   * sans tenir compte des pièces.
   */
  race: number;
  /** Au-delà de ce coût, une pièce ne marque plus de points de course. */
  raceHorizon: number;
  /** Pièce capable de sortir dès son prochain tour (coût ≤ Mouvement), par point de Force. */
  exitReady: number;
  /** Multiplicateur de course et de « prête à sortir » pour une pièce dont la sortie ferait gagner. */
  sentinelThreat: number;
  /** Pièce capturable par le camp qui a le trait : fraction de sa valeur matérielle perdue. */
  hanging: number;
  /** Pièce du camp au trait qui serait capturable par l'adversaire (elle peut encore fuir). */
  threatened: number;
  /** Contrôle des hauteurs : par niveau de hauteur occupé. */
  height: number;
}

export const EVAL_WEIGHTS: EvalWeights = {
  win: 1_000_000,
  score: 120,
  material: 40,
  race: 2,
  raceHorizon: 20,
  exitReady: 25,
  sentinelThreat: 3,
  hanging: 0.75,
  threatened: 0.2,
  height: 1.5,
};

const scratch: Action[] = [];

/**
 * Marque dans `out` (indexé par pièce) les pièces de l'adversaire de `by`
 * qu'une pièce de `by` pourrait capturer au prochain coup.
 * Préfiltre : une attaque coûte au moins la distance de Manhattan à la cible,
 * on ignore donc les pièces trop loin de tout ennemi (évite des Dijkstra inutiles).
 */
export function markCapturable(s: CoreState, by: PlayerId, out: Uint8Array): void {
  out.fill(0);
  const size = s.topo.size;
  const P = s.ptype.length;
  for (let p = 0; p < P; p++) {
    if (s.pstatus[p] !== ST_BOARD || s.pplayer[p] !== by) continue;
    const r = (s.ppos[p] / size) | 0;
    const c = s.ppos[p] % size;
    const m = MOVEMENT[s.ptype[p]];
    let near = false;
    for (let q = 0; q < P && !near; q++) {
      if (s.pstatus[q] !== ST_BOARD || s.pplayer[q] === by) continue;
      const rq = (s.ppos[q] / size) | 0;
      near = Math.abs(rq - r) + Math.abs((s.ppos[q] % size) - c) <= m;
    }
    if (!near) continue;
    scratch.length = 0;
    pieceActions(s, p, scratch, undefined, undefined, true);
    for (const a of scratch) if (a.kind === K_ATTACK) out[a.target] = 1;
  }
}

const capByMover = new Uint8Array(32);
const capByOther = new Uint8Array(32);

/** Évaluation de la position du point de vue de `me` (partie non terminée). */
export function evaluate(s: CoreState, me: PlayerId, w: EvalWeights = EVAL_WEIGHTS): number {
  const { exitDist, heights } = s.topo;
  const P = s.ptype.length;
  let v = w.score * (s.score[me] - s.score[me === 1 ? 2 : 1]);

  // Sécurité : qui peut capturer quoi au prochain coup.
  const mover = s.current;
  const other: PlayerId = mover === 1 ? 2 : 1;
  markCapturable(s, mover, capByMover);
  markCapturable(s, other, capByOther);

  for (let p = 0; p < P; p++) {
    if (s.pstatus[p] !== ST_BOARD) continue;
    const pl = s.pplayer[p] as PlayerId;
    const sign = pl === me ? 1 : -1;
    const type = s.ptype[p];
    const str = STRENGTH[type];
    const pos = s.ppos[p];
    let t = w.material * str;

    // Course vers la sortie. Une sortie qui fait gagner (Sentinelle tant que rien n'est sorti,
    // ou 2e pièce d'un joueur qui en a déjà sorti une) compte beaucoup plus qu'une autre.
    const d = exitDist[pl][pos];
    const winningExit =
      (type === SENTINEL && sentinelExitWinsNow(s.exits)) || s.exited[pl] + 1 >= RULES.end.exitsToWin;
    const boost = winningExit ? w.sentinelThreat : 1;
    t += w.race * str * Math.max(0, w.raceHorizon - d) * boost;
    if (d <= MOVEMENT[type]) t += w.exitReady * str * boost;

    t += w.height * heights[pos];

    // Une pièce de l'adversaire du trait, capturable par le trait, est presque perdue ;
    // une pièce du trait menacée peut encore s'enfuir : pénalité plus légère.
    if (pl === other && capByMover[p]) t -= w.hanging * w.material * str;
    if (pl === mover && capByOther[p]) t -= w.threatened * w.material * str;

    v += sign * t;
  }
  return v;
}
