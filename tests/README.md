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
| `pages.spec.js` | Chaque page, pour chaque rôle (admin, recruteur, visiteur) : la page s'ouvre sans erreur, chacun voit les bons boutons et pas les autres, les pages refusées renvoient ailleurs, un texte piégé (`<b data-xss>`) s'affiche comme du texte, pas de problème d'accessibilité grave (outil axe, normes WCAG 2.2 AA), pas de défilement horizontal sur téléphone. Sans session ou avec un compte suspendu, retour à la connexion. Aucune page du visiteur ne lit directement les tables qui lui sont fermées (talents, postes, commentaires, évaluations, historique des pools). |
| `parcours-talents.spec.js` | Les parcours complets : connexion (bons et mauvais identifiants, compte suspendu, mot de passe oublié, déconnexion), liste des talents (filtres, recherche, pagination, arbitrage à 24 mois, prolongation, dévalidation, création, modification, brouillon, export Excel vérifié ligne par ligne), fiche talent (commentaires, liens de partage avec jeton fourni par la base et 90 jours au plus, dévalidation et réintégration, Liste Rouge, changement de pool, passage en expat, suppression), lien de partage public (valide, révoqué, expiré, introuvable) et, pour le visiteur, liste et fiche servies par les fonctions de la base sans lecture directe des tables (pages de 20, frappe de recherche regroupée, nationalité envoyée en codes pays, export Excel masqué, fiche refusée pour la Liste Rouge, limite horaire atteinte). Connexion, déconnexion et exports passent par la fonction de journalisation de la base, jamais par une écriture directe dans le journal. |
| `parcours-postes.spec.js` | Postes (liste et indicateurs, création, modification, occupant déjà en poste, avertissements des détachements, suppression, resynchronisation, contrats échus, pagination), évaluations (droits, ajout, modification, suppression, visiteur sans l'e-mail des auteurs), postes et statistiques du visiteur servis par les fonctions de la base sans lecture directe des tables (limite horaire atteinte comprise), Dévalidés (filtre, réintégration, Liste Rouge, suppression) et page Liste Rouge (motif et documents, ajout avec contrôle des fichiers, retrait, pagination, ajout possible sur téléphone). |
| `parcours-admin.spec.js` | Administration : comptes (liste, création, suspension, suppression, nouveau code d'accès, demandes à traiter, refus et avertissements du serveur), pools (création, code déjà pris, modification, archivage, suppression d'un pool jamais utilisé ; leur journal est tenu par la base, le site n'y écrit rien), import en masse à partir des vrais modèles (motifs de refus ligne par ligne, format et nombre de lignes, seules les lignes valides envoyées), extraction Excel (feuilles et lignes, formules neutralisées, export journalisé), statistiques (indicateurs par pool, analyse IA sans nom ni e-mail envoyé, réponse affichée sans code actif, panne), journal d'audit (compteurs, filtres dont « Consultation », pages, export) et guide. |
| `apparence.spec.js` | Compare 9 écrans (tableau de bord selon le rôle, talents, fiche talent, postes, connexion, lien public) en 4 largeurs, du téléphone au grand écran, avec les captures de référence du dossier `captures-reference/`. Tout déplacement ou changement visuel non prévu fait échouer le test ; le rapport détaillé montre alors l'image attendue, l'image obtenue et leurs différences. Les dates, qui changent chaque jour, sont masquées. Après une modification voulue de la présentation, les captures de référence sont livrées avec le lot. |
| `erreurs-visibles.spec.js` | Chaque erreur qui bloque une action affiche un message lisible en entier, sans avoir à faire défiler. Les enregistrements normaux ferment toujours leur fenêtre. |
| `regles.spec.js` | Les règles de calcul communes (validité des 24 mois, durées, pays, pagination, lecture par pages, nouvel essai réseau, brouillons, notifications) et les liens entre les pages. |
| `non-regression.spec.js` | La police Inter se charge depuis le site sur les 15 pages, sans appel vers un autre site ni blocage de sécurité ; le PDF de la fiche talent se génère. |
| `donnees.js` | Le jeu de données fictif : talents, postes, comptes, commentaires… avec des textes piégés. |
| `simulateur-supabase.js` | La fausse base Supabase utilisée par les tests. Comme la vraie base, elle ne renvoie rien au visiteur qui lit directement une table fermée, et elle simule les fonctions `visitor_*()`. |
| `serveur-statique.js` | Sert les pages du site pendant les tests. |
| `compte-rendu.js` | Écrit le compte rendu en français. |

Les problèmes d'accessibilité graves font échouer le test ; les autres sont listés
dans le compte rendu, rubrique « Points à améliorer, non bloquants ».

Les droits en base se testent à part, avec `sql/tests_rls_roles.sql` : droits par rôle, règles des liens de partage (jeton, durée, révocation, contenu de la page publique) et journalisation faite par la base.

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
