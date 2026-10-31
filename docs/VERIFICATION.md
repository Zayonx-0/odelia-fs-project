# Vérification du rendu — exercice 17

Binôme : **Matyas Ricci et Mathis Valencia**. Vérification du 31 octobre 2026.

| Couche | Résultat | Ce qui est exercé |
|---|---|---|
| Backend | 32 tests JUnit réussis | Autorisations réelles des ressources et de BoardAccess, dépôts en mémoire, invariants et absence de mutation après refus. |
| Frontend | 31 tests Angular réussis dans Chrome Headless | Composants et templates, rôles, erreurs, ajout/retrait et renommage, réponses HTTP simulées. |
| API intégrée | 89 contrôles HTTP réussis | Open Liberty, PostgreSQL et vrais JWT des comptes Keycloak alice/bob/carol. |
| Compilation | WAR et build Angular de production réussis | Java 21 et budgets Angular. |

La vérification HTTP utilise Java 21.0.13, Open Liberty, PostgreSQL 16.15 et
Keycloak 26.0.8. Les services ont été démarrés dans un environnement local isolé,
avec le realm fourni dans le dépôt. Le frontend a été vérifié avec Node 24.14.1
et Chrome. La CI utilise Java 21 et Node 22.

Le script HTTP couvre les tiers sans relation au tableau, le cycle complet d'un
membre sur les cartes et colonnes, les opérations réservées au propriétaire,
le contournement administrateur, les déplacements vers et depuis un tableau
inaccessible et le retrait avec le même JWT. Les tableaux créés sont nettoyés
à la fin du scénario ; les tableaux préexistants ne sont pas supprimés.

Ces nombres désignent des couches distinctes : les tests JUnit n'exécutent pas
le serveur, et les tests Angular simulent les réponses du backend. Le scénario
HTTP complète cette couverture avec les services réels. Il nécessite une pile
démarrée et n'est donc pas inclus dans les deux jobs unitaires de la CI.

Les commandes et la correspondance avec R1–R10 et F1–F5 sont détaillées dans
[BOARD_SHARING.md](BOARD_SHARING.md).
