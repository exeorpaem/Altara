# CLAUDE.md — contexte du projet Altara

Ce fichier est lu automatiquement par Claude Code. Il résume l'état du projet, les décisions prises
et ce qui reste à faire. **Le garder à jour** à la fin de chaque session de travail.

## Le projet

**Altara** : jeu de stratégie 3D pour 2 joueurs (refonte originale d'un jeu de plateau « traversée »).
Faire sortir ses pièces par le bord adverse d'un plateau 10×10 en relief. Ne jamais réutiliser le nom
ni les éléments graphiques du jeu d'origine.

- Dépôt : https://github.com/exeorpaem/Altara · jeu publié (GitHub Pages) : https://exeorpaem.github.io/Altara/
- Stack : Vite + TypeScript + Three.js, HTML/CSS simple, Vitest. **Aucune autre dépendance** sans justification.

## Préférences de l'utilisateur (Alexis)

- Répondre **en français**, de façon **concise** (pas de reformulation, pas de récapitulatif inutile).
- **Débutant en développement** : expliquer les concepts clés quand c'est utile, sans condescendance.
- **Règle ambiguë → demander** (1 à 5 questions ciblées) au lieu de choisir en silence. Les choix
  provisoires sont signalés comme « HYPOTHÈSE » dans le code et listés ci-dessous.
- Être direct et honnête, même pour dire qu'une approche est mauvaise.
- Commentaires de code **en français** sur les parties non évidentes.

## Commandes

```bash
npm install
npm run dev          # jeu : http://localhost:5173/ · vitrine des pièces : /showcase/
npm test             # tests Vitest (117) (tous doivent passer avant chaque commit)
npx tsc --noEmit     # vérification des types
npm run build        # build de production (BASE_PATH=/Altara/ pour GitHub Pages)
npm run selfplay -- --duel 50 --equity 100 --jobs 4
npm run selfplay -- --only ladder --ladder 1-3,3-5,5-7,7-9 --ladder-games 8
```

Modes de terrain : random, mountains, valleys, highlands, woods, desert, volcano, archipelago, marsh, canyon.

Débogage navigateur : ajouter `?debug` à l'URL expose `window.__altara`
(`engine()`, `view()`, `board()`, `ai`, `sound`, `screenOf(row, col)`, `soundDemo()`).
Paramètres d'URL : `?mode=woods&seed=KNVDF0&ai=5|local&cadence=10%2B0&first=1|2|random`
(dans une URL, `+` se lit comme un espace : la cadence est encodée).

## Architecture (voir aussi README.md)

```
src/engine/   PUR TypeScript (ni Three.js ni DOM) — toute la logique de jeu
  rules.ts      TOUTES les constantes de règles + définition des pièces (point d'entrée des réglages)
  terrain.ts    générateur (10 modes, seed, symétrie 180°, lissage |Δh| ≤ 2)
  core.ts       position compacte (tableaux typés), Dijkstra borné (file à seaux), Zobrist
  actions.ts    génération des coups, make/unmake, fin de partie, attaques refusées
  combat.ts     calcul des forces (attaque / défense, détail des modificateurs)
  movement.ts   coups « lisibles » avec chemins pour l'interface
  engine.ts     LocalEngine implémente GameEngine (types.ts) : play(move, elapsedMs), undo, flag,
                getPotentialMoves (inspection), getBlockedAttacks (anneau gris), serialize/load
  ai/evaluate.ts  évaluation + EVAL_WEIGHTS ; ai/search.ts  niveaux 1–10 (AI_LEVELS), alpha-bêta, TT
src/ai/       Web Worker de l'IA + client (poignée de main, délai de garde, repli fil principal)
src/render/   scène, plateau, pièces procédurales, game-view (sélection, marqueurs, animations), skins (une palette par mode de terrain)
src/ui/       CSS, pendule (clock.ts), sound design Web Audio (sound.ts), fiche de règles (rules-panel.ts), accueil (home.ts), thème (theme.ts), CSS : base / game / home / panels
src/main.ts   page de jeu (branche tout ensemble)
scripts/selfplay.ts   IA contre IA sans rendu, rapport dans reports/
.github/workflows/    ci.yml (types + tests + build) · pages.yml (déploiement GitHub Pages)
```

**Règle d'architecture** : le rendu ne dépend que de l'interface `GameEngine` ; une seule
implémentation des règles (core/actions) sert à l'interface ET à l'IA.

## Règles implémentées (état actuel)

- Plateau 10×10, hauteurs 0–6, |Δh| ≤ 2 entre voisins, symétrie par rotation de 180°, seed affichée.
- Pièces (Mouvement + Force = 6) : Explorateur 5/1, Avant-garde 4/2, Sentinelle 3/3. Socle à M côtés,
  sommet à N pointes. Départ centré : colonnes C à H (2 cases libres de chaque côté), J2 par symétrie.
- Déplacement orthogonal ; pas = 1 à plat, sinon |Δh| + 1 ; pas de traversée de pièce ; pas de fin sur
  la case de départ. Explorateur à la place : diagonale ou bond de 2 (relief ignoré, arrivée ET case
  intermédiaire vides) ; ces coups spéciaux n'attaquent pas et ne sortent pas.
- Sortie par la rangée adverse s'il reste ≥ 1 point (coût 1) ; rapporte la Force en points.
- Combat : chemin normal jusqu'à une case adjacente + entrée (dénivelé compris), coût ≤ Mouvement.
  Légal si attaque ≥ défense (égalité = l'attaquant gagne). Défenseur retiré, l'attaquant prend sa case.
  - Attaque = Force + hauteur (±1 : **case d'appui** — voisine de la cible, d'où l'on entre — vs case
    de la cible) + Force de chaque autre allié adjacent à la cible + charge (+1 Avant-garde si le chemin
    le plus court jusqu'à la cible **coûte** exactement 4).
  - **Seul le chemin le plus court** (coût minimal) est autorisé pour attaquer : pas de détour pour la
    charge ou la hauteur. À coût minimal égal, case d'appui choisie automatiquement (meilleure attaque).
  - Défense = Force + 1 par allié du défenseur adjacent à lui. Hauteur des alliés/renforts ignorée.
- Fin de partie (règle actuelle, décidée par l'utilisateur) :
  - une **Sentinelle qui sort fait gagner immédiatement**, seulement si c'est la **1re pièce sortie de
    la partie** (tous camps) ; sinon sortie ordinaire ;
  - joueur **sans pièce sur le plateau** (raison « eliminated ») : dernière capturée → perd ; dernière sortie →
    gagne si l'adversaire ne peut plus l'égaler, nulle si égalité au mieux, sinon perd ;
  - sinon le **premier joueur à faire sortir sa 2e pièce** gagne (pièces capturées : ne comptent pas) ;
  - 200 coups (passes comprises) : **seul le score en points départage**, égalité = nulle
    (`RULES.limitScoreOnly`). Le coup de réponse final (`RULES.finalReply`) a été essayé puis désactivé ;
  - pendule (10+0 par défaut, chute = défaite, raison « time ») ; joueur sans coup légal : passe.

## Hypothèses à faire confirmer (ne pas trancher seul)

1. `RULES.movement.exitInSameMove = true` : atteindre la dernière rangée et sortir dans le même coup.
2. (Tranché) Dernière pièce SORTIE : gagne si l'adversaire ne peut plus l'égaler (score + Force de ses
   pièces restantes < ses points), nulle si au mieux égalité, sinon perd. Dernière pièce CAPTURÉE : perd.
3. (Tranché) **Charge** : on compte le **coût** du chemin (pas le nombre de cases) ; la charge par
   contournement a été **supprimée** : attaque par le chemin le plus court uniquement.
4. Notation d'attaque depuis la case de départ (ex. `A G4×H6`).

## Faits connus / pièges

- Équité (reports/equite-2026-10-22.md + témoins) : l'ancien départage « pièce la plus avancée »
  récompensait le dernier à jouer ; le coup de réponse final inversait le biais (64,8 % pour le 1er).
  Règle retenue : départage au score seul → les parties à la limite sont presque toutes nulles ;
  le 1er joueur gagne 60 % des parties décisives (avantage de course). Vallées et Canyon restent
  déséquilibrés (générateur à revoir).
- Les rapports d'équité dans `reports/` datent de l'**ancienne** règle de fin (2 sorties tous camps,
  1re sortie Sentinelle) : à relancer avec la règle actuelle.
- Le Web Worker de l'IA peut être bloqué par une CSP (aperçus intégrés) : le client bascule alors sur
  le fil principal (Difficile limité à 1 s). Ne pas retirer ce repli.
- Sous Vitest, ne pas dépendre de l'ordre des tests ; les tests de terrain tournent 6 000 générations.
- `npm test` exécute aussi les worktrees d'agents sous `.claude/` : utiliser
  `npx vitest run --exclude '.claude/**'` quand il y en a.

## Fait (résumé)

Moteur complet et testé (117 tests) · rendu low-poly pastel, palette (skin) imposée par le terrain (10 palettes), île flottante · sélection,
marqueurs, aperçu de chemin, animations · inspection des pièces adverses (anneaux creux) · anneau gris
des attaques refusées avec explication · IA 1 à 10 dans un Web Worker · pendule · sound design
synthétisé (une gamme pentatonique, voix par camp, ambiance) · bouton Annuler / Ctrl+Z · clic droit =
désélection · CI et déploiement GitHub Pages · fiche de règles · choix du joueur qui commence ·
10 modes de terrain avec décors 3D (src/render/decor.ts). Mode en ligne : abandonné. Design des
pièces : on garde le design d'origine (styles alternatifs essayés puis abandonnés).

## Interface ajoutée (session UI)

Accueil, Recommencer/Menu, décompte sorties/captures (`engine/tally.ts`), historique + relecture (`engine/replay.ts`,
`GameView.setReplay`), mobile < 700 px (tiroirs), mode daltonien (`altara.colorblind`), thème Auto/Clair/Sombre
(`altara.theme`, variables CSS). Pièges : `updateUrl()` retire `?debug` de l'URL (recharger via goto avec `&debug`) ;
pendant une relecture, l'IA joue directement sur le moteur réel (pas d'animation).

## Reste à faire (cahier des charges initial, étape 5 non terminée)

- [x] **Historique** : panneau latéral avec notation, clic = relecture de la position, retour au présent.
- [ ] **Sauvegarde automatique** (localStorage via serialize/load, try/catch) + reprise proposée à l'accueil.
- [x] **Écran d'accueil** (mode, terrain, seed facultative) — aujourd'hui tout est dans le panneau.
- [x] **Mode daltonien** : motif ou liseré par camp en plus de la couleur.
- [x] **Fiche de règles** : bouton « Règles » / touche R (`src/ui/rules-panel.ts`, contenu lu depuis RULES/PIECES).
- [x] Boutons Recommencer / Menu en jeu ; affichage des pièces sorties et capturées.
- [ ] Relancer le self-play d'équité avec la nouvelle règle de fin et commenter les résultats.
- [x] GitHub Actions vertes, Pages activé (Source : GitHub Actions ; un déploiement peut demander
      une approbation dans l'onglet Actions).
