// Recherche de coups pour l'IA (pur TypeScript, aucune dépendance au DOM).
//
// Trois niveaux :
//  - Facile    : 1 coup de profondeur, choix au hasard parmi les 3 meilleurs ;
//                rate volontairement une victoire de Sentinelle 30 % du temps.
//  - Moyen     : minimax alpha-bêta, profondeur 2.
//  - Difficile : alpha-bêta en approfondissement itératif, limite de temps,
//                table de transposition indexée par hachage de Zobrist.
import type { PlayerId } from '../rules';
import { hashSeed, mulberry32 } from '../random';
import {
  K_ATTACK,
  K_EXIT,
  K_PASS,
  generateActions,
  isImmediateWin,
  makeAction,
  unmakeAction,
  type Action,
} from '../actions';
import { SENTINEL, STRENGTH, cloneCore, fromGameState, type CoreState } from '../core';
import { legalMoves } from '../movement';
import type { GameState, Move } from '../types';
import { EVAL_WEIGHTS, evaluate, type EvalWeights } from './evaluate';

export type AiLevel = 'easy' | 'medium' | 'hard';

/**
 * Échelle de difficulté de 1 à 10. Chaque niveau donne à l'IA plus de « réflexion »
 * que le précédent :
 *  - random  : coup légal au hasard ;
 *  - shallow : 1 coup de profondeur, tirage parmi les `topN` meilleurs, rate une victoire
 *              de Sentinelle avec la probabilité `miss` ;
 *  - fixed   : alpha-bêta à profondeur fixe ;
 *  - timed   : alpha-bêta en approfondissement itératif avec table de transposition,
 *              limité en temps (et éventuellement en profondeur).
 * Les anciens niveaux correspondent à : Facile = 3, Moyen = 5, Difficile = 9.
 */
export interface LevelConfig {
  name: string;
  /** Description courte, affichée dans l'interface. */
  hint: string;
  kind: 'random' | 'shallow' | 'fixed' | 'timed';
  topN?: number;
  miss?: number;
  depth?: number;
  timeMs?: number;
  maxDepth?: number;
}

export const AI_LEVELS: Record<number, LevelConfig> = {
  1: { name: 'Débutant', hint: 'joue au hasard', kind: 'random' },
  2: { name: 'Novice', hint: 'regarde 1 coup, se trompe souvent', kind: 'shallow', topN: 6, miss: 0.6 },
  3: { name: 'Facile', hint: 'regarde 1 coup, avec un peu de hasard', kind: 'shallow', topN: 3, miss: 0.3 },
  4: { name: 'Apprenti', hint: 'joue le meilleur coup immédiat', kind: 'shallow', topN: 1, miss: 0 },
  5: { name: 'Moyen', hint: 'anticipe ta réponse (2 coups)', kind: 'fixed', depth: 2 },
  6: { name: 'Confirmé', hint: 'calcule 3 coups à l’avance', kind: 'timed', maxDepth: 3, timeMs: 1500 },
  7: { name: 'Fort', hint: 'recherche approfondie (0,5 s)', kind: 'timed', timeMs: 500 },
  8: { name: 'Expert', hint: 'recherche approfondie (1 s)', kind: 'timed', timeMs: 1000 },
  9: { name: 'Difficile', hint: 'recherche approfondie (1,5 s)', kind: 'timed', timeMs: 1500 },
  10: { name: 'Maître', hint: 'recherche approfondie (3 s)', kind: 'timed', timeMs: 3000 },
};

const NAMED_LEVELS: Record<AiLevel, number> = { easy: 3, medium: 5, hard: 9 };

/** Niveau numérique (1 à 10) à partir d'un nombre ou d'un ancien nom (easy/medium/hard). */
export function levelNumber(level: AiLevel | number): number {
  const n = typeof level === 'number' ? level : NAMED_LEVELS[level];
  return Math.min(10, Math.max(1, Math.round(n)));
}

export interface AiOptions {
  /** Niveau 1 à 10 (ou 'easy' / 'medium' / 'hard', équivalents à 3 / 5 / 9). */
  level: AiLevel | number;
  /** Seed : départage reproductible des coups de même valeur (et hasard du niveau Facile). */
  seed?: string | number;
  /** Difficile : temps de réflexion (ms). */
  timeMs?: number;
  /**
   * Temps restant à la pendule de l'IA (ms), si la partie a une cadence.
   * L'IA ne s'accorde alors qu'une fraction de ce temps par coup (voir thinkBudget).
   */
  clockMs?: number;
  /** Difficile : budget de nœuds (alternative déterministe au temps, utile en test). */
  maxNodes?: number;
  /** Profondeur imposée (sinon : 1 / 2 / itératif selon le niveau). */
  depth?: number;
  weights?: EvalWeights;
}

export interface AiResult {
  action: Action;
  value: number;
  depth: number;
  nodes: number;
  ms: number;
}

export const AI_DEFAULTS = {
  easy: { depth: 1, missSentinelWin: 0.3, topN: 3 },
  medium: { depth: 2 },
  hard: { timeMs: 1500, maxDepth: 30 },
  /** Gestion de la pendule : part du temps restant accordée à un coup, et plancher. */
  clock: { fraction: 1 / 30, minMs: 60, /** sous ce temps restant, Moyen descend à 1 coup de profondeur */ panicMs: 3000 },
};

class Timeout extends Error {}

// -----------------------------------------------------------------------------
// Tri des coups
// -----------------------------------------------------------------------------

export const actionKey = (a: Action) => (a.kind * 32 + (a.piece + 1)) * 1024 + (a.dest + 1);

/**
 * Tri pour l'élagage alpha-bêta : plus les bons coups sont essayés tôt, plus
 * la fenêtre se resserre vite et plus on coupe de branches.
 * Ordre : coup de la table de transposition, victoires immédiates, sorties,
 * captures (Force capturée décroissante), puis le reste trié par progrès vers
 * la sortie (coût restant gagné × Force).
 */
export function orderActions(s: CoreState, acts: Action[], best: number) {
  const scores = new Map<Action, number>();
  for (const a of acts) {
    let v: number;
    if (actionKey(a) === best) v = 1e9;
    else if (isImmediateWin(s, a)) v = 1e8;
    else if (a.kind === K_EXIT) v = 1e7 + STRENGTH[s.ptype[a.piece]];
    else if (a.kind === K_ATTACK) v = 1e6 + STRENGTH[s.ptype[a.target]] * 100 - STRENGTH[s.ptype[a.piece]];
    else if (a.kind === K_PASS) v = 0;
    else {
      const ed = s.topo.exitDist[s.pplayer[a.piece]];
      v = (ed[s.ppos[a.piece]] - ed[a.dest]) * STRENGTH[s.ptype[a.piece]];
    }
    scores.set(a, v);
  }
  acts.sort((x, y) => scores.get(y)! - scores.get(x)!); // tri stable : l'ordre (mélangé) d'origine départage
}

function shuffle<T>(arr: T[], rand: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// -----------------------------------------------------------------------------
// Alpha-bêta (négamax)
// -----------------------------------------------------------------------------

interface TTEntry {
  depth: number;
  value: number;
  flag: 0 | 1 | 2; // 0 exacte, 1 borne inférieure, 2 borne supérieure
  best: number;
}

class Searcher {
  nodes = 0;
  deadline = Infinity;
  maxNodes = Infinity;
  tt: Map<number, TTEntry> | null;
  constructor(
    private w: EvalWeights,
    private rand: () => number,
    useTT: boolean,
  ) {
    this.tt = useTT ? new Map() : null;
  }

  /** Valeur d'une position terminale pour le joueur au trait (victoires rapides préférées). */
  private terminal(s: CoreState, ply: number): number {
    const r = s.result!;
    if (r.winner === 'draw') return 0;
    return r.winner === s.current ? this.w.win - ply : -(this.w.win - ply);
  }

  private ttKey(s: CoreState) {
    return (s.h1 >>> 0) * 2097152 + (s.h2 & 0x1fffff);
  }

  /**
   * Négamax avec élagage alpha-bêta : la valeur est vue par le joueur au trait,
   * et la valeur d'un coup = −(valeur de la position pour l'adversaire).
   * [alpha, beta] est la fenêtre utile : dès qu'un coup atteint beta,
   * l'adversaire n'aurait jamais laissé arriver cette position → coupure.
   */
  search(s: CoreState, depth: number, alpha: number, beta: number, ply: number): number {
    if (++this.nodes % 256 === 0 && (performance.now() > this.deadline || this.nodes > this.maxNodes)) throw new Timeout();
    if (s.result) return this.terminal(s, ply);
    if (depth === 0) return evaluate(s, s.current, this.w);

    const alpha0 = alpha;
    let ttBest = -1;
    const key = this.tt ? this.ttKey(s) : 0;
    if (this.tt) {
      const e = this.tt.get(key);
      if (e) {
        ttBest = e.best;
        if (e.depth >= depth) {
          if (e.flag === 0) return e.value;
          if (e.flag === 1 && e.value > alpha) alpha = e.value;
          else if (e.flag === 2 && e.value < beta) beta = e.value;
          if (alpha >= beta) return e.value;
        }
      }
    }

    const acts = generateActions(s, []);
    orderActions(s, acts, ttBest);
    let best = -Infinity;
    let bestKey = -1;
    for (const a of acts) {
      const u = makeAction(s, a);
      const v = -this.search(s, depth - 1, -beta, -alpha, ply + 1);
      unmakeAction(s, u);
      if (v > best) {
        best = v;
        bestKey = actionKey(a);
      }
      if (v > alpha) alpha = v;
      if (alpha >= beta) break; // coupure bêta
    }

    if (this.tt) {
      if (this.tt.size > 400_000) this.tt.clear();
      const flag = best <= alpha0 ? 2 : best >= beta ? 1 : 0;
      this.tt.set(key, { depth, value: best, flag, best: bestKey });
    }
    return best;
  }

  /** Racine : renvoie le meilleur coup à la profondeur donnée. */
  root(s: CoreState, depth: number, prevBest: number): { action: Action; value: number } {
    const acts = generateActions(s, []);
    shuffle(acts, this.rand);
    orderActions(s, acts, prevBest);
    let alpha = -Infinity;
    let bestA = acts[0];
    for (const a of acts) {
      const u = makeAction(s, a);
      const v = -this.search(s, depth - 1, -Infinity, -alpha, 1);
      unmakeAction(s, u);
      if (v > alpha) {
        alpha = v;
        bestA = a;
      }
    }
    return { action: bestA, value: alpha };
  }
}

// -----------------------------------------------------------------------------
// Points d'entrée
// -----------------------------------------------------------------------------

/**
 * Temps de réflexion du niveau Difficile pour ce coup : sa limite habituelle
 * (1,5 s), mais jamais plus d'1/30 du temps restant à sa pendule. Avec 10 minutes,
 * la limite habituelle s'applique ; quand la pendule baisse, l'IA joue plus vite
 * et ne peut pas perdre au temps (au pire 60 ms par coup).
 */
export function thinkBudget(opts: AiOptions): number {
  const base = opts.timeMs ?? AI_LEVELS[levelNumber(opts.level)].timeMs ?? AI_DEFAULTS.hard.timeMs;
  if (opts.clockMs === undefined) return base;
  const c = AI_DEFAULTS.clock;
  return Math.max(c.minMs, Math.min(base, opts.clockMs * c.fraction));
}

export function chooseAction(state: CoreState, opts: AiOptions): AiResult {
  const t0 = performance.now();
  const w = opts.weights ?? EVAL_WEIGHTS;
  const rand = mulberry32(hashSeed(`${opts.seed ?? 0}:${state.turn}:${state.h1}`));
  const s = cloneCore(state);
  const me = s.current as PlayerId;
  const acts = generateActions(s, []);
  if (acts.length === 1) return { action: acts[0], value: 0, depth: 0, nodes: 0, ms: performance.now() - t0 };

  const cfg = AI_LEVELS[levelNumber(opts.level)];

  if (cfg.kind === 'random' && !opts.depth) {
    const a = acts[Math.floor(rand() * acts.length)];
    return { action: a, value: 0, depth: 0, nodes: 0, ms: performance.now() - t0 };
  }

  if (cfg.kind === 'shallow' && !opts.depth) {
    // 1 coup de profondeur : on joue chaque coup et on évalue la position obtenue.
    let pool = acts;
    // Rate volontairement la victoire de Sentinelle (30 % au niveau 3).
    const sentinelWin = (a: Action) => a.kind === K_EXIT && s.ptype[a.piece] === SENTINEL;
    if (acts.some(sentinelWin) && rand() < (cfg.miss ?? 0)) pool = acts.filter((a) => !sentinelWin(a));
    if (pool.length === 0) pool = acts;
    const scored = pool.map((a) => {
      const u = makeAction(s, a);
      const v = s.result
        ? s.result.winner === 'draw'
          ? 0
          : s.result.winner === me
            ? w.win
            : -w.win
        : evaluate(s, me, w);
      unmakeAction(s, u);
      return { a, v };
    });
    shuffle(scored, rand);
    scored.sort((x, y) => y.v - x.v);
    const pick = scored[Math.floor(rand() * Math.min(cfg.topN ?? 1, scored.length))];
    return { action: pick.a, value: pick.v, depth: 1, nodes: scored.length, ms: performance.now() - t0 };
  }

  // Profondeur fixe. En zeitnot (peu de temps à la pendule), 1 coup de profondeur suffit.
  if (cfg.kind === 'fixed' || opts.depth) {
    const panic = !opts.depth && opts.clockMs !== undefined && opts.clockMs < AI_DEFAULTS.clock.panicMs;
    const depth = panic ? 1 : (opts.depth ?? cfg.depth ?? 2);
    const sr = new Searcher(w, rand, false);
    const r = sr.root(s, depth, -1);
    return { ...r, depth, nodes: sr.nodes, ms: performance.now() - t0 };
  }

  // Niveaux 6 à 10 : approfondissement itératif. Chaque itération réutilise la table de
  // transposition de la précédente (meilleurs coups essayés en premier → élagage
  // bien plus efficace). Si le temps est écoulé en cours d'itération, on garde le
  // résultat de la dernière itération complète.
  const sr = new Searcher(w, rand, true);
  sr.deadline = t0 + thinkBudget(opts);
  if (opts.maxNodes) {
    sr.maxNodes = opts.maxNodes;
    sr.deadline = Infinity;
  }
  let best: { action: Action; value: number } = { action: acts[0], value: 0 };
  let depth = 0;
  for (let d = 1; d <= (cfg.maxDepth ?? AI_DEFAULTS.hard.maxDepth); d++) {
    try {
      // Recherche sur une copie : une interruption laisse la copie dans un état quelconque.
      best = sr.root(cloneCore(s), d, actionKey(best.action));
      depth = d;
    } catch (e) {
      if (e instanceof Timeout) break;
      throw e;
    }
    if (Math.abs(best.value) > w.win / 2) break; // victoire ou défaite forcée trouvée
    // Inutile de lancer une itération qui n'aura pas le temps d'aboutir.
    if (performance.now() - t0 > (sr.deadline - t0) * 0.5 && !opts.maxNodes) break;
  }
  return { ...best, depth, nodes: sr.nodes, ms: performance.now() - t0 };
}

/** Coup choisi par l'IA, sous forme de Move (avec chemin) prêt à être animé et joué. */
export interface AiMove {
  move: Move | null;
  pass: boolean;
  info: { depth: number; nodes: number; ms: number; value: number };
}

export function chooseMove(g: GameState, opts: AiOptions): AiMove {
  const s = fromGameState(g);
  const r = chooseAction(s, opts);
  const info = { depth: r.depth, nodes: r.nodes, ms: Math.round(r.ms), value: r.value };
  if (r.action.kind === K_PASS) return { move: null, pass: true, info };
  const id = s.ids[r.action.piece];
  const size = s.topo.size;
  const row = Math.floor(r.action.dest / size);
  const col = r.action.dest % size;
  const kinds = ['move', 'explorerDiagonal', 'explorerLeap', 'exit', 'attack'];
  const move = legalMoves(g, id).find((m) => {
    const e = m.path[m.path.length - 1];
    return m.kind === kinds[r.action.kind] && e.row === row && e.col === col;
  });
  return { move: move ?? null, pass: false, info };
}
