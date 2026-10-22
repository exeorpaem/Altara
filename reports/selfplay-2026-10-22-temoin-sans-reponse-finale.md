> **Campagne témoin** : même protocole que equite-2026-10-22.md, mais avec `RULES.finalReply = false` (sans coup de réponse final).

# Rapport de self-play — 2026-10-22 17:18

## Équité des terrains — Moyen contre Moyen

Premier joueur = camp qui joue le 1er coup (alterné, même terrain pour chaque paire de parties). IC = intervalle de Wilson à 95 % sur la part du premier joueur (hors nulles).

| Mode | Parties | 1er gagne | 2e gagne | Nulles | 1er (hors nulles) | IC 95 % | J1 gagne | J2 gagne | Fins | Durée moy. | |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Aléatoire | 100 | 53 | 39 | 8 | 57.6 % | 47–67 % | 51 | 41 | sentinel 54, moveLimit 31, secondExit 15 | 84 |  |
| Montagnes | 100 | 52 | 48 | 0 | 52.0 % | 42–62 % | 52 | 48 | sentinel 45, moveLimit 17, eliminated 7, secondExit 31 | 64 |  |
| Vallées | 100 | 29 | 46 | 25 | 38.7 % | 28–50 % | 37 | 38 | sentinel 32, moveLimit 61, secondExit 6, eliminated 1 | 138 | ⚠️ |
| Hautes terres | 100 | 46 | 49 | 5 | 48.4 % | 39–58 % | 44 | 51 | sentinel 43, moveLimit 25, secondExit 30, eliminated 2 | 77 |  |
| Bois | 100 | 48 | 50 | 2 | 49.0 % | 39–59 % | 53 | 45 | sentinel 63, secondExit 27, moveLimit 7, eliminated 3 | 44 |  |
| Désert | 100 | 59 | 41 | 0 | 59.0 % | 49–68 % | 45 | 55 | sentinel 65, secondExit 24, eliminated 4, moveLimit 7 | 40 |  |
| Volcan | 100 | 64 | 36 | 0 | 64.0 % | 54–73 % | 48 | 52 | sentinel 55, secondExit 42, eliminated 3 | 40 | ⚠️ |
| Archipel | 100 | 48 | 45 | 7 | 51.6 % | 42–62 % | 57 | 36 | sentinel 31, secondExit 45, moveLimit 23, eliminated 1 | 77 |  |
| Marais | 100 | 56 | 42 | 2 | 57.1 % | 47–66 % | 45 | 53 | sentinel 67, secondExit 15, moveLimit 16, eliminated 2 | 56 |  |
| Canyon | 100 | 75 | 25 | 0 | 75.0 % | 66–82 % | 49 | 51 | sentinel 81, secondExit 11, eliminated 5, moveLimit 3 | 24 | ⚠️ |
| Total | 1000 | 530 | 421 | 49 | 55.7 % | 53–59 % | 481 | 470 | sentinel 536, moveLimit 190, secondExit 246, eliminated 28 | 64 | ⚠️ |

⚠️ Déséquilibre (> 60 %, < 40 % ou IC excluant 50 %) : Vallées (1er 38.7 %), Volcan (1er 64.0 %), Canyon (1er 75.0 %)

Parties arrivées à la limite de coups (200) : 190/1000 ; parmi elles, le premier joueur gagne 45, le second 96, nulles 49.
Quand J1 commence (500 parties) : J1 gagne 268, adversaire 208, nulles 24.
Quand J2 commence (500 parties) : J2 gagne 262, adversaire 213, nulles 25.

Durée totale : 140 s
