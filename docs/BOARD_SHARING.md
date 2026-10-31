# Exercice 17 — partage de tableaux

**Binôme : Matyas Ricci et Mathis Valencia**

## Modèle et autorisations

Une ligne `BoardMember` associe un `boardId` à un `username`. Son existence donne
les droits de membre ; aucun autre rôle de membre n'est proposé. La contrainte
d'unicité sur `(BOARD_ID, USERNAME)` empêche les doublons en base. Le propriétaire
reste uniquement dans `Board.owner` : il n'est jamais ajouté comme membre.

`BoardAccess` centralise les deux décisions :

| Action | Propriétaire | Membre | Administrateur | Tiers |
|---|---|---|---|---|
| Lire le tableau et ses membres | Oui | Oui | Oui | 403 |
| Créer/modifier/déplacer/supprimer cartes et colonnes | Oui | Oui | Oui | 403 |
| Renommer ou supprimer le tableau | Oui | 403 | Oui | 403 |
| Ajouter ou retirer un membre | Oui | 403 | Oui | 403 |

`requireBoardAccess` autorise les collaborateurs. Les cartes et colonnes remontent
à leur tableau pour appliquer ce contrôle. Un déplacement contrôle le tableau de
départ et celui d'arrivée : partager un tableau ne permet pas d'accéder aux autres.

`requireBoardOwner` protège les paramètres et la gestion des membres. Le contrôle
précède la validation de l'ajout/retrait d'un membre et du renommage : un membre
reste refusé en 403 même s'il envoie un nom vide ou tente de retirer un utilisateur
inexistant. La validation d'un nom invalide par un propriétaire retourne 400.

Les adhésions sont relues à chaque requête. Le retrait bloque donc immédiatement
les prochaines requêtes du même utilisateur, même si son JWT est encore valide.
La suppression d'un tableau nettoie aussi ses adhésions, colonnes et cartes.

## Couverture des exigences

| Critères | Vérifications livrées |
|---|---|
| R1 | Entité/dépôt BoardMember ; invariants propriétaire/membre et nettoyage vérifiés par les tests de ressources et le script HTTP. |
| R2–R4 | Ajout, lecture et retrait ; refus des tiers ; retrait avec la même session et restauration de l'accès. |
| R5, R10 | Nom vide, absent ou trop long, doublon après suppression des espaces, ajout/retrait du propriétaire : 400. |
| R6 | Tableaux possédés + partagés, tri, absence de doublons et visibilité administrateur. |
| R7 | Lecture et cycle création/modification/déplacement/suppression des cartes et colonnes par un membre. |
| R8 | Renommage, suppression et gestion des membres refusés en 403 ; aucune modification en cas d'échec. |
| R9 | Refus sur toutes les familles de ressources ; aucun accès via une carte/colonne orpheline ni via un autre tableau. |
| F1, F5 | Rendu d'un tableau partagé, badge et visibilité des contrôles selon le rôle ; protection des appels directs aux méthodes du composant. |
| F2–F3 | Panneau visible à tout collaborateur ; contrôles d'ajout/retrait réservés au propriétaire/administrateur. |
| F4 | Erreurs 400/403 et réseau affichées ; membres et brouillon conservés après échec ; nouvelle tentative possible. |

Les tests de ressources utilisent les classes de production `BoardResource`,
`BoardListResource`, `CardResource` et `BoardAccess`, avec des dépôts en mémoire.
Ils ne simulent pas le conteneur Jakarta, la validation du JWT ni les transactions.
Ces couches sont exercées séparément par le script HTTP sur la pile démarrée.

Les tests Angular utilisent les vrais composants et leur HTML dans Chrome, avec
des réponses HTTP simulées et des identités contrôlées. Ils vérifient aussi le
blocage des doubles soumissions et l'effacement du contenu après un rechargement
refusé. Un test empêche d'étiqueter tous les tableaux visibles par un administrateur
comme « partagés » : son accès global ne signifie pas qu'il en est membre.

Les résultats du contrôle local sont consignés dans [VERIFICATION.md](VERIFICATION.md).

## Relancer les vérifications

Prérequis : Java 21+, Maven, Node compatible avec `frontend/package.json`, Python 3.

```sh
cd backend
mvn package
cd ../frontend
npm ci
npm test
npm run build
```

Le lanceur de tests respecte `CHROME_BIN`, puis recherche Chrome installé par
Puppeteer ou un navigateur système. Si nécessaire :

```sh
npx puppeteer browsers install chrome
```

Le workflow `.github/workflows/verify.yml` exécute les tests et compilations sur
chaque mise à jour de PR, avec Java 21 et Node 22. Le test HTTP nécessite les
services de l'application et se lance séparément.

### API avec la pile du cours

Démarrer PostgreSQL, Keycloak et le backend comme dans le README, puis depuis la
racine du dépôt :

```sh
python3 scripts/test-sharing.py --report /tmp/kanban-sharing-results.json
```

Le script obtient de vrais JWT Keycloak pour `alice`, `bob` et `carol`, utilise un
préfixe unique et supprime uniquement ses propres tableaux, y compris après un
échec. Il fonctionne avec des tableaux déjà présents. Les mots de passe de cours
sont utilisés par défaut ; `ALICE_PASSWORD`, `BOB_PASSWORD` et `CAROL_PASSWORD`
permettent de les remplacer sans les écrire dans le dépôt.

`--api-url` et `--keycloak-url` permettent de tester d'autres ports. Les jetons ne
sont jamais imprimés ni écrits dans le rapport JSON. Le code de sortie est non nul
si un statut ou une assertion échoue, ou si le nettoyage échoue.

Le mode facultatif `--signing-key` sert uniquement à une pile locale isolée dont
la configuration approuve une clé de test. Il permet de vérifier HTTP/Jakarta
Data/PostgreSQL sans lancer Keycloak ; il ne teste pas le parcours de connexion.
Aucune clé privée ni modification de confiance JWT n'est livrée dans le dépôt.

## Prolongements choisis

Le badge de partage et la présentation du panneau rendent les rôles plus lisibles.
Les boutons de gestion sont bloqués pendant une requête pour éviter un double clic
et redeviennent utilisables après un échec. Les erreurs ont un rôle d'alerte pour
les technologies d'assistance.

Le renommage depuis la liste prolonge le minimum de l'exercice 17. Il permet
d'exercer la même séparation des droits dans un parcours complet : un propriétaire
ou un administrateur renomme, un membre travaille sur le contenu. Ses tests couvrent
le refus du membre, le tri après renommage, les doubles soumissions, l'annulation
et la conservation du brouillon après erreur.

Ces ajouts ne modifient pas les règles de création ou de transfert de propriété.
Les notifications et les mises à jour en temps réel restent hors périmètre.
