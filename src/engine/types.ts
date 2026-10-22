// Types partagés du moteur (aucune dépendance au rendu).
import type { PieceType, PlayerId } from './rules';
import type { Terrain } from './terrain';

export interface Cell {
  row: number;
  col: number;
}

export type PieceStatus = 'board' | 'exited' | 'captured';

export interface Piece {
  id: string;
  type: PieceType;
  player: PlayerId;
  row: number;
  col: number;
  status: PieceStatus;
}

export type MoveKind = 'move' | 'explorerDiagonal' | 'explorerLeap' | 'exit' | 'attack';

export interface Move {
  pieceId: string;
  /**
   * Chemin complet, case de départ comprise (path[0]).
   * - move / spécial : dernière case = destination ;
   * - exit : dernière case = case de la rangée d'arrivée d'où la pièce sort ;
   * - attack : dernière case = case de la pièce attaquée.
   */
  path: Cell[];
  cost: number;
  kind: MoveKind;
  targetId?: string;
}

export interface MoveRecord {
  player: PlayerId;
  /** Coup joué ; absent si le joueur a passé son tour (aucun coup légal). */
  move?: Move;
  pass?: boolean;
  /** Pièce capturée par une attaque. */
  capturedId?: string;
  notation: string;
}

/**
 * sentinel : une Sentinelle est sortie ; secondExit : un joueur a fait sortir sa 2e pièce ;
 * eliminated : l'adversaire n'a plus aucune pièce sur le plateau ;
 * moveLimit : limite de coups ; time : pendule tombée. (« score » : ancienne règle, conservé
 * pour relire les vieilles sauvegardes.)
 */
export type EndReason = 'sentinel' | 'secondExit' | 'eliminated' | 'score' | 'moveLimit' | 'time';

/**
 * Pendule (cadence « minutes + incrément », comme aux échecs).
 * Le moteur ne lit jamais l'horloge : l'interface mesure le temps de réflexion
 * et le transmet à play() ; le moteur le décompte et applique l'incrément.
 */
export interface ClockState {
  initialMs: number;
  incrementMs: number;
  /** Temps restant de chaque joueur au début de son tour (ms). */
  remaining: Record<PlayerId, number>;
}

export interface GameResult {
  winner: PlayerId | 'draw';
  reason: EndReason;
}

export interface GameState {
  terrain: Terrain;
  pieces: Piece[];
  current: PlayerId;
  /** Nombre de coups joués (un coup = le tour d'un joueur, passes comprises). */
  turn: number;
  /** Score : somme des Forces des pièces sorties. */
  score: Record<PlayerId, number>;
  history: MoveRecord[];
  /** Résultat, ou null tant que la partie continue. */
  result: GameResult | null;
  /** Pendule, ou null pour une partie sans limite de temps. */
  clock?: ClockState | null;
}

/** Attaque refusée, avec sa raison (affichée par l'anneau gris). */
export interface BlockedAttack {
  pieceId: string;
  targetId: string;
  reason: 'weak' | 'range';
  /** Coût du chemin le moins cher jusqu'à la cible, entrée comprise. */
  cost: number;
  /** Chemin jusqu'à la case d'appui, puis la case de la cible. */
  path: Cell[];
  /** Forces (seulement si reason = 'weak') et détail des modificateurs. */
  attack?: number;
  defense?: number;
  details: string[];
}

export interface AttackPreview {
  attack: number;
  defense: number;
  details: string[];
}

export interface GameEngine {
  getState(): GameState;
  getLegalMoves(pieceId: string): Move[];
  /**
   * Coups qu'aurait une pièce si c'était à son camp de jouer, dans la position actuelle
   * (inspection d'une pièce adverse). Vide si la partie est finie ou la pièce hors plateau.
   */
  getPotentialMoves?(pieceId: string): Move[];
  previewAttack?(move: Move): AttackPreview;
  /** Attaques refusées d'une pièce (trop faible, ou juste hors de portée), pour les expliquer. */
  getBlockedAttacks?(pieceId: string): BlockedAttack[];
  /** `elapsedMs` : temps de réflexion du joueur pour ce coup (décompté de sa pendule). */
  play(move: Move, elapsedMs?: number): GameState;
  /** Le joueur n'a plus de temps : il perd (raison « time »). */
  flag?(player: PlayerId): GameState;
  undo(): GameState;
  serialize(): string;
  load(data: string): GameState;
}
