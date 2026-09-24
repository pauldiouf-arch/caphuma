# Tests automatiques du site

Ces tests ouvrent le site dans un vrai navigateur, sur ordinateur (1366 × 768) et
sur téléphone (390 × 844), et vérifient ce que voit l'utilisateur. Supabase est
simulé : aucune clé, aucune vraie donnée lue ou modifiée. Les pannes (serveur en
erreur, e-mail en double, liste des postes modifiée entre-temps…) sont provoquées
volontairement.

GitHub les lance tout seul à chaque dépôt de fichiers, grâce à
`.github/workflows/tests-site.yml`. Durée : 2 à 4 minutes.

## Ce qui est vérifié

| Fichier | Contenu |
|---|---|
| `erreurs-visibles.spec.js` | Chaque erreur qui bloque une action affiche un message lisible en entier, sans avoir à faire défiler : talents, postes, évaluations, Dévalidés, fiche talent, statistiques, Liste Rouge, import, tableau de bord. Les enregistrements normaux ferment toujours leur fenêtre. |
| `non-regression.spec.js` | La police Inter se charge depuis le site sur les 15 pages, sans appel vers un autre site ni blocage de sécurité ; le PDF de la fiche talent se génère. |
| `simulateur-supabase.js` | La fausse base Supabase utilisée par les tests. |
| `compte-rendu.js` | Écrit le compte rendu en français. |

Les droits en base se testent à part, avec `sql/tests_rls_roles.sql`.

## Lire le résultat

1. Sur GitHub, ouvrir l'onglet **Actions** du dépôt.
2. La ligne du haut correspond au dernier dépôt :
   - coche verte : tout est bon ;
   - croix rouge : au moins un test a échoué ;
   - rond jaune : en cours, attendre.
3. Cliquer sur la ligne : le compte rendu s'affiche en bas de la page (rubrique
   « tests summary »), avec la liste des tests échoués et le message de chacun.

Pour relancer sans rien déposer : onglet **Actions**, « Tests du site » dans la
colonne de gauche, bouton **Run workflow**, puis **Run workflow**.

## Envoyer le compte rendu à Claude

Au choix :

- **Le plus simple** : sur la page du résultat, sélectionner tout le compte rendu
  (de « Compte rendu des tests du site Cap Huma » jusqu'à la fin), le copier et le
  coller dans la conversation.
- **Le plus complet** : sur la même page, rubrique **Artifacts** en bas,
  télécharger `compte-rendu-tests` (un fichier .zip) et le joindre tel quel à la
  conversation. Il contient le compte rendu, une capture d'écran de chaque test
  échoué et le rapport détaillé. Il reste disponible 30 jours.

## Quand un test échoue sans que le site soit cassé

Les tests retrouvent les boutons et les champs par leur identifiant (`id`). Si une
page est modifiée (bouton renommé, champ déplacé), un test peut échouer alors que
le site fonctionne : il faut alors mettre le test à jour en même temps que la page.
Un test marqué « réussi au 2e essai » a buté une fois sur une lenteur passagère ;
s'il revient souvent, le signaler.
