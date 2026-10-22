# Altara

Jeu de stratégie 3D pour deux joueurs, sur un plateau en relief : faire sortir ses pièces par le bord adverse.
Vite + TypeScript + Three.js, tests Vitest.

## Lancer

```bash
npm install
npm run dev        # jeu : http://localhost:5173/  · vitrine des pièces : /showcase/
npm test           # tous les tests du moteur
npm run build      # build de production (dist/)
npm run selfplay   # IA contre IA, sans rendu (voir plus bas)
```

## GitHub Actions

- **CI** (`.github/workflows/ci.yml`) : à chaque push et pull request — vérification des types, tests, build.
- **Déploiement** (`.github/workflows/pages.yml`) : à chaque push sur `main`, le jeu est construit et publié sur
  GitHub Pages, jouable à `https://<compte>.github.io/<dépôt>/` (vitrine : `…/showcase/`).
  À activer une seule fois : *Settings → Pages → Build and deployment → Source : GitHub Actions*.
  Le sous-dossier de publication est passé au build par la variable `BASE_PATH`.

## Structure

```
src/
  engine/            pur TypeScript (aucun Three.js, aucun DOM)
    rules.ts         ← TOUTES les constantes de règles et la définition des pièces
    terrain.ts       générateur de plateaux (10 modes, seed, symétrie, lissage)
    core.ts          position compacte (tableaux typés), Dijkstra borné, Zobrist
    actions.ts       génération des coups, jouer/annuler, fin de partie
    combat.ts        calcul des forces d'attaque et de défense
    movement.ts      coups « lisibles » avec chemins (pour l'interface)
    engine.ts        LocalEngine : implémente l'interface GameEngine
    types.ts         GameState, Move, GameEngine…
    ai/evaluate.ts   évaluation d'une position + poids (EVAL_WEIGHTS)
    ai/search.ts     niveaux Facile / Moyen / Difficile
  ai/                Web Worker de l'IA + client côté interface
  render/            scène, plateau, pièces, marqueurs, animations (via GameEngine uniquement)
  ui/                styles
  main.ts            page de jeu
scripts/selfplay.ts  self-play et rapport d'équilibrage
tests/               tests Vitest
```

## Où modifier

| Pour changer… | Fichier |
|---|---|
| Mouvement / Force / nom / forme des pièces | `src/engine/rules.ts` → `PIECES` |
| Taille du plateau, hauteurs, limite de coups, coût de sortie | `src/engine/rules.ts` → `RULES` |
| Bonus de combat (hauteur, charge, renfort) | `RULES.combat` |
| Conditions de fin (sorties pour gagner, victoire de Sentinelle) | `RULES.end` |
| Options de déplacement (bond, coups spéciaux, sortie dans le même coup) | `RULES.movement` |
| Poids de l'évaluation de l'IA | `src/engine/ai/evaluate.ts` → `EVAL_WEIGHTS` |
| Réglages des niveaux d'IA (profondeur, temps, 30 % de Facile) | `src/engine/ai/search.ts` → `AI_DEFAULTS` |
| Construction 3D des pièces | `src/render/pieces.ts` |
| Skins du plateau | `src/render/skins.ts` |
| Sons (catalogue, niveaux, ambiance) | `src/ui/sound.ts` |
| Colonnes de départ | `RULES.startColumns` |
| Cadences proposées | `index.html` (liste « Cadence ») ; pendule : `src/ui/clock.ts` |

## Règles implémentées

**Plateau** : 10×10, hauteurs 0 à 6, au plus 2 d'écart entre voisins orthogonaux, symétrique par rotation de 180°.

**Pièces** (Mouvement + Force = 6) : Explorateur 5/1, Avant-garde 4/2, Sentinelle 3/3.
J1 (Corail) part du bas et sort par le haut ; J2 (Lagon) l'inverse. J1 commence.
Formation de départ centrée (colonnes C à H, 2 cases libres de chaque côté), J2 placé par symétrie centrale.

**Déplacement** : orthogonal, case par case ; un pas coûte 1 à plat, |Δh| + 1 sinon.
On ne traverse aucune pièce et on ne finit pas sur sa case de départ.
**Explorateur**, à la place : pas diagonal ou bond de 2 cases, relief ignoré ; arrivée vide **et**, pour le bond,
case intermédiaire vide. Ces coups ne permettent ni d'attaquer ni de sortir.

**Sortie** : depuis une case de la rangée d'arrivée, s'il reste au moins 1 point (coût 1).
La pièce rapporte sa Force au score. *Hypothèse non tranchée : on peut atteindre la rangée et sortir dans le même coup.*

**Combat** : chemin normal jusqu'à une case adjacente à l'ennemi puis entrée sur sa case (coût total ≤ Mouvement,
entrée comprise avec le dénivelé). Légal si **attaque ≥ défense** ; le défenseur est retiré, l'attaquant prend sa case.

- Attaque = Force de base + hauteur (+1 si la **case d'appui** — la case voisine de la cible d'où l'on entre — est plus
  haute que la cible, −1 si plus basse) + Force de base de chaque autre allié adjacent à la cible + charge (+1 pour une
  Avant-garde dont le chemin passant par cette case d'appui coûte exactement 4).
- S'il y a plusieurs cases d'appui possibles, le jeu choisit automatiquement celle qui donne la meilleure attaque
  (à attaque égale, la moins chère).
- Défense = Force de base + 1 par allié du défenseur adjacent à lui.

**Fin de partie**
- Une **Sentinelle qui sort** fait gagner son camp **immédiatement**, à condition d'être la **première pièce sortie
  de la partie** (tous camps confondus). Sinon, c'est une sortie ordinaire (points + compte pour la 2e sortie).
- Sinon, le **premier joueur qui fait sortir sa deuxième pièce** gagne.
- Un joueur qui n'a **plus aucune pièce sur le plateau** : si la dernière a été **capturée**, il a **perdu** ; si elle
  est **sortie**, il **gagne** si l'adversaire ne peut plus l'égaler (score + Force de ses pièces restantes), partie
  **nulle** si l'adversaire peut au mieux égaliser, sinon il **perd**. Une pièce capturée ne compte jamais
  comme une sortie. Chaque sortie rapporte aussi la Force de la pièce en points (utilisés à la limite de coups).
- 200 coups (un coup = le tour d'un joueur, passes comprises) : meilleur score en points ; si personne n'a marqué,
  la pièce la plus avancée (moins de rangées à franchir), puis la plus grande Force de cette pièce, sinon nulle.
  (Un joueur sans pièce a déjà perdu avant d'arriver là.)
- Un joueur sans coup légal passe son tour (affiché à l'écran).
- **Pendule** (cadence choisie dans le panneau, 10+0 par défaut : 10 minutes par joueur, sans incrément) :
  le joueur dont la pendule tombe à 0 perd (raison « time »). Seul le temps de réflexion est décompté :
  la pendule s'arrête dès que le coup est choisi (pas pendant les animations). Autres cadences : 5+0, 3+2, 15+10, sans limite.

## IA

L'IA tourne dans un **Web Worker** (`src/ai/worker.ts`) qui n'importe que `engine/` : l'interface reste fluide.
Si la page hôte interdit les workers (iframe avec politique de sécurité stricte, aperçu intégré…), le client
(`src/ai/client.ts`) s'en aperçoit (poignée de main au démarrage, délai de garde à chaque coup) et l'IA calcule
alors sur le fil principal : l'affichage se fige pendant sa réflexion (Difficile limité à 1 s par coup dans ce cas).
Elle joue Lagon (J2). Choix du niveau et de la seed dans le panneau « Partie & décor ».

Échelle de difficulté de **1 à 10** (curseur dans le panneau ; réglages dans `AI_LEVELS`, `search.ts`) :

| Niveau | Nom | Méthode |
|---|---|---|
| 1 | Débutant | coup légal au hasard |
| 2 | Novice | 1 coup de profondeur, au hasard parmi les 6 meilleurs ; rate une victoire de Sentinelle 60 % du temps |
| 3 | Facile | 1 coup de profondeur, au hasard parmi les 3 meilleurs ; rate une victoire de Sentinelle 30 % du temps |
| 4 | Apprenti | meilleur coup à 1 coup de profondeur |
| 5 | Moyen | minimax alpha-bêta, profondeur 2 |
| 6 | Confirmé | alpha-bêta itératif jusqu'à 3 coups |
| 7 | Fort | alpha-bêta itératif + table de transposition (Zobrist), 0,5 s |
| 8 | Expert | idem, 1 s |
| 9 | Difficile | idem, 1,5 s |
| 10 | Maître | idem, 3 s |

Les anciens noms restent acceptés (Facile = 3, Moyen = 5, Difficile = 9), y compris dans l'URL (`?ai=7`, `?ai=local`).

**Gestion de la pendule** : l'IA reçoit son temps restant. Difficile s'accorde au plus 1/30 de ce temps par coup
(donc 1,5 s tant qu'il reste plus de 45 s, puis de moins en moins, jamais sous 60 ms) ; Moyen passe à 1 coup de
profondeur sous 3 s. Réglages : `AI_DEFAULTS.clock` dans `search.ts`.

Tri des coups (élagage) : coup de la table de transposition, victoires immédiates, sorties, captures par Force
capturée décroissante, puis progrès vers la sortie.
La **seed** départage les coups de même valeur : à seed égale, Facile et Moyen rejouent exactement la même partie.
Difficile dépend aussi du temps machine (option `maxNodes` pour un comportement déterministe).

### Évaluation et poids (`EVAL_WEIGHTS`)

| Poids | Rôle |
|---|---|
| `score` | par point de score d'écart |
| `material` | par point de Force encore sur le plateau |
| `race`, `raceHorizon` | course : Force × (horizon − coût minimal de sortie, Dijkstra sur le terrain) |
| `exitReady` | pièce capable de sortir au prochain tour |
| `sentinelThreat` | multiplicateur pour les Sentinelles tant qu'aucune pièce n'est sortie |
| `hanging` / `threatened` | pièce capturable par le camp au trait / pièce du trait menacée |
| `height` | petit bonus par niveau de hauteur occupé |
| `win` | victoire = +win, défaite = −win, nulle = 0 |

Après un changement de poids : `npm test`, puis `npm run selfplay` pour mesurer l'effet.

## Interface : inspecter une pièce

Cliquer sur une pièce qu'on ne peut pas jouer (pièce adverse, ou n'importe quelle pièce pendant que l'IA réfléchit)
affiche les coups qu'elle aurait si c'était à son camp de jouer : marqueurs creux, bandeau « ses coups s'il jouait
maintenant », chemins et aperçus de combat au survol (« Menace : combat possible »). Rien n'est jouable dans ce mode.
Moteur : `GameEngine.getPotentialMoves(pieceId)`.

**Clic droit** (ou Échap) : annule la sélection ou l'inspection en cours, sans jamais jouer de coup.

**Règles** (bouton en bas ou touche **R**) : fiche de règles en sections repliables, générée depuis `src/engine/rules.ts` ; Échap, × ou un clic à côté la ferme, la partie continue derrière.

**Annuler le coup** (bouton en bas, **Ctrl+Z**, ou depuis l'écran de fin) : défait le dernier coup. Contre l'IA, on
revient à son propre tour (la réponse de l'IA est annulée aussi), même pendant que l'IA réfléchit. Le bouton est grisé
quand il n'y a rien à annuler ; une défaite au temps ne s'annule pas. La pendule revient à son état d'avant le coup.

## Son

Tout est synthétisé en direct avec la Web Audio API (`src/ui/sound.ts`), sans aucun fichier audio.

- **Une seule gamme** (ré majeur pentatonique) : les sons qui se chevauchent ne sonnent jamais faux.
- **Une voix par camp** : Corail chaleureux (cloche FM douce, centré sur ré), Lagon aérien (cloche de verre, centré sur la).
- **Un registre par pièce** : Explorateur aigu, Avant-garde médium, Sentinelle grave (sélection, sortie).
- **Le relief s'entend** : chaque pas est un « toc » de bois dont la hauteur suit l'altitude de la case ;
  chaque marche ajoute un petit glissando montant ou descendant.
- Bond (souffle qui monte et retombe), attaque (coup sourd et rond), capture (éclats de cristal qui tombent),
  sortie (arpège qui s'envole), changement de tour, passe, victoire / défaite / nulle.
- **Ambiance** : nappe lente (ré – si m – sol – la sus), cloches lointaines, souffle de vent ; désactivable.
- Réverbération générée, compresseur en sortie (aucune saturation), volume et sourdine mémorisés (touche **M**).

Le son démarre au premier clic (règle des navigateurs). En mode `?debug`, `__altara.soundDemo()` rend une démo
hors-ligne de tous les sons et mesure leurs niveaux.

## Self-play

```bash
npm run selfplay                                   # 50 duels Difficile/Moyen + 100 parties Moyen/Moyen par mode
npm run selfplay -- --duel 10 --equity 20          # version courte
npm run selfplay -- --only duel --hard-ms 1500 --jobs 4
npm run selfplay -- --only ladder --ladder 1-3,3-5,5-7,7-9 --ladder-games 8   # chaque niveau contre le précédent
```

Les parties sont réparties sur plusieurs processus (`--jobs`, par défaut le nombre de cœurs).
Le rapport s'affiche et est enregistré dans `reports/` (Markdown + JSON brut).
**Attention** : le niveau Difficile est limité en temps ; si la machine est chargée, il réfléchit moins profondément.
