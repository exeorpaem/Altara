// Règles d'Altara — toutes les constantes du jeu sont regroupées ici.
// Ce fichier est pur TypeScript : aucune dépendance à Three.js ni au DOM.

export type PlayerId = 1 | 2;
export type PieceType = 'explorer' | 'vanguard' | 'sentinel';

export interface PieceDef {
  type: PieceType;
  /** Nom affiché */
  name: string;
  /** Lettre utilisée dans la notation de l'historique */
  letter: string;
  /** Mouvement = nombre de côtés du socle */
  movement: number;
  /** Force = nombre de pointes du sommet */
  strength: number;
  /** Capacité spéciale en une ligne (infobulle) */
  ability: string;
  /**
   * Indications de forme pour la construction procédurale (render/pieces.ts).
   * Les valeurs sont en unités « case » (une case = 1).
   */
  visual: {
    /** Hauteur totale de la pièce */
    height: number;
    /** Rayon du socle */
    baseRadius: number;
    /** Rayon le plus fin du fût (taille de guêpe) */
    waist: number;
  };
}

export const RULES = {
  board: {
    size: 10,
    minHeight: 0,
    maxHeight: 6,
    /** Différence de hauteur maximale entre deux cases orthogonalement voisines */
    maxNeighborDelta: 2,
  },
  /** Somme Mouvement + Force, identique pour toutes les pièces */
  pieceBudget: 6,
  /** Nombre maximal de coups d'une partie (affichage « x / 200 ») */
  maxTurns: 200,
  /**
   * Coup de réponse final : à la limite, le second joueur vient de jouer le dernier coup ;
   * le joueur qui a commencé joue encore un coup avant le départage (équité entre les camps).
   */
  finalReply: true,
  /** Coût de la sortie par le bord adverse */
  exitCost: 1,
  /** Règles de déplacement (lues par core.ts : changer une valeur suffit). */
  movement: {
    /** Entrer sur la case attaquée coûte un pas normal (dénivelé compris). */
    attackEntryUsesHeight: true,
    /** Bond de l'Explorateur : la case intermédiaire doit être vide (pas de saut par-dessus une pièce). */
    leapOverPieces: false,
    /** Les coups spéciaux de l'Explorateur ne permettent ni d'attaquer ni de sortir. */
    explorerSpecialCanAttackOrExit: false,
    /**
     * HYPOTHÈSE (session 1, non contredite) : une pièce peut atteindre la dernière
     * rangée et sortir dans le même coup (coût du chemin + coût de sortie ≤ Mouvement).
     */
    exitInSameMove: true,
  },
  /** Voisinage utilisé partout (déplacement, attaque, alliés, renforts) : orthogonal. */
  adjacency: [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as readonly (readonly [number, number])[],
  /** Combat (voir combat.ts) */
  combat: {
    /** Bonus/malus si la case de départ de l'attaquant est plus haute/basse que la cible */
    height: 1,
    /** Bonus de charge de l'Avant-garde… */
    charge: 1,
    /** …accordé si le chemin le plus court jusqu'à la cible coûte exactement : */
    chargeCost: 4,
    /** Bonus de défense par pièce alliée adjacente au défenseur */
    reinforcement: 1,
  },
  /** Fin de partie */
  end: {
    /** Un joueur gagne dès que ce nombre de SES pièces est sorti (une pièce capturée ne compte pas). */
    exitsToWin: 2,
    /** Une Sentinelle qui sort fait gagner son camp immédiatement… */
    sentinelExitWins: true,
    /**
     * … à condition d'être la PREMIÈRE pièce sortie de la partie (tous camps confondus).
     * Sinon, c'est une sortie ordinaire : elle rapporte ses points et compte pour exitsToWin.
     */
    sentinelMustExitFirst: true,
    /** Plus aucune pièce sur le plateau : défaite (ou comparaison des scores si la dernière est sortie). */
    noPiecesLoses: true,
  },
  /**
   * Colonnes de départ (indices 0 à 9) : formation centrée, 2 cases libres de chaque côté.
   * J2 est placé par symétrie centrale (colonne 9 − c) : il est donc centré lui aussi.
   */
  startColumns: [2, 3, 4, 5, 6, 7],
  startOrder: ['sentinel', 'vanguard', 'explorer', 'explorer', 'vanguard', 'sentinel'] as PieceType[],
} as const;

export const PIECES: Record<PieceType, PieceDef> = {
  explorer: {
    type: 'explorer',
    name: 'Explorateur',
    letter: 'E',
    movement: 5,
    strength: 1,
    ability: 'Peut faire un pas en diagonale ou bondir de 2 cases en ignorant le relief.',
    visual: { height: 1.0, baseRadius: 0.3, waist: 0.075 },
  },
  vanguard: {
    type: 'vanguard',
    name: 'Avant-garde',
    letter: 'A',
    movement: 4,
    strength: 2,
    ability: 'Pièce polyvalente, équilibre entre vitesse et force.',
    visual: { height: 1.17, baseRadius: 0.31, waist: 0.1 },
  },
  sentinel: {
    type: 'sentinel',
    name: 'Sentinelle',
    letter: 'S',
    movement: 3,
    strength: 3,
    ability: 'Pièce la plus robuste, lente mais redoutable.',
    visual: { height: 1.35, baseRadius: 0.32, waist: 0.13 },
  },
};

export const PIECE_TYPES: PieceType[] = ['explorer', 'vanguard', 'sentinel'];

// Vérification de cohérence : Mouvement + Force = budget pour chaque pièce.
for (const def of Object.values(PIECES)) {
  if (def.movement + def.strength !== RULES.pieceBudget) {
    throw new Error(`Pièce ${def.name} : Mouvement + Force ≠ ${RULES.pieceBudget}`);
  }
}

/** Nombre total de coups avant le départage (limite + éventuel coup de réponse final). */
export const TURN_LIMIT = RULES.maxTurns + (RULES.finalReply ? 1 : 0);
