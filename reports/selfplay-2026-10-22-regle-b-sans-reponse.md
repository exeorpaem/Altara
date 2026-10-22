> Départage à la limite : **score seul** (règle b), coup de réponse final **désactivé** (règle retenue).

# Rapport de self-play — 2026-10-22 17:25

## Équité des terrains — Moyen contre Moyen

Premier joueur = camp qui joue le 1er coup (alterné, même terrain pour chaque paire de parties). IC = intervalle de Wilson à 95 % sur la part du premier joueur (hors nulles).

| Mode | Parties | 1er gagne | 2e gagne | Nulles | 1er (hors nulles) | IC 95 % | J1 gagne | J2 gagne | Fins | Durée moy. | |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Aléatoire | 100 | 46 | 24 | 30 | 65.7 % | 54–76 % | 40 | 30 | sentinel 54, moveLimit 31, secondExit 15 | 84 | ⚠️ |
| Montagnes | 100 | 45 | 38 | 17 | 54.2 % | 44–65 % | 42 | 41 | sentinel 45, eliminated 7, secondExit 31, moveLimit 17 | 64 |  |
| Vallées | 100 | 25 | 14 | 61 | 64.1 % | 48–77 % | 16 | 23 | sentinel 32, moveLimit 61, secondExit 6, eliminated 1 | 138 | ⚠️ |
| Hautes terres | 100 | 43 | 36 | 21 | 54.4 % | 43–65 % | 36 | 43 | sentinel 43, moveLimit 25, secondExit 30, eliminated 2 | 77 |  |
| Bois | 100 | 47 | 46 | 7 | 50.5 % | 41–60 % | 49 | 44 | sentinel 63, secondExit 27, moveLimit 7, eliminated 3 | 44 |  |
| Désert | 100 | 57 | 38 | 5 | 60.0 % | 50–69 % | 41 | 54 | sentinel 65, secondExit 24, eliminated 4, moveLimit 7 | 40 |  |
| Volcan | 100 | 64 | 36 | 0 | 64.0 % | 54–73 % | 48 | 52 | sentinel 55, secondExit 42, eliminated 3 | 40 | ⚠️ |
| Archipel | 100 | 42 | 38 | 20 | 52.5 % | 42–63 % | 50 | 30 | sentinel 31, secondExit 45, moveLimit 23, eliminated 1 | 77 |  |
| Marais | 100 | 53 | 37 | 10 | 58.9 % | 49–68 % | 42 | 48 | sentinel 67, secondExit 15, moveLimit 16, eliminated 2 | 56 |  |
| Canyon | 100 | 75 | 22 | 3 | 77.3 % | 68–85 % | 47 | 50 | sentinel 81, secondExit 11, eliminated 5, moveLimit 3 | 24 | ⚠️ |
| Total | 1000 | 497 | 329 | 174 | 60.2 % | 57–63 % | 411 | 415 | sentinel 536, moveLimit 190, secondExit 246, eliminated 28 | 64 | ⚠️ |

⚠️ Déséquilibre (> 60 %, < 40 % ou IC excluant 50 %) : Aléatoire (1er 65.7 %), Vallées (1er 64.1 %), Volcan (1er 64.0 %), Canyon (1er 77.3 %)

Parties arrivées à la limite de coups (200) : 190/1000 ; parmi elles, le premier joueur gagne 12, le second 4, nulles 174.
Quand J1 commence (500 parties) : J1 gagne 249, adversaire 167, nulles 84.
Quand J2 commence (500 parties) : J2 gagne 248, adversaire 162, nulles 90.

Durée totale : 117 s
