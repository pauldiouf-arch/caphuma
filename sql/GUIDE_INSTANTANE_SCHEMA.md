# Schéma de référence — le produire et le tenir à jour sans outil à installer

## Ce que c'est

`sql/schema_reference.sql` est un script exécutable qui recrée toute la
structure de la base : tables, contraintes, index, fonctions, déclencheurs,
Row Level Security, policies (y compris celles du Storage), droits sur les
tables, séquences et fonctions, et buckets Storage.

Il est produit par une requête en lecture seule, `sql/generer_schema_reference.sql`,
exécutée dans l'éditeur SQL de Supabase. Aucun outil à installer (CLI
Supabase, Node.js, `pg_dump`) : les postes ALIMA ne le permettent pas
toujours, et la méthode ne demande qu'un navigateur.

Les anciens instantanés `schema_snapshot_AAAA-MM-JJ.sql` restent dans le
dépôt comme archives datées. Ils ne sont pas exécutables et ne sont plus
produits.

## Quand le régénérer

- Le jour même de tout changement de schéma (table, colonne, contrainte,
  index, fonction, déclencheur, policy, droit, bucket), dans le même dépôt
  que le script de changement.
- Sinon une fois par trimestre : comparer avec la version précédente dans
  l'historique Git fait apparaître tout changement fait hors procédure.

## Comment le régénérer

1. Ouvrir `sql/generer_schema_reference.sql` dans un éditeur de texte et
   copier tout son contenu.
2. Dans Supabase : **SQL Editor** → **+ New query** → coller → **Run**.
   Résultat attendu : une seule cellule, colonne `schema_reference`, dont le
   texte commence par `begin;`.
3. Récupérer le texte : **Export** → **Download CSV**. Dans le fichier CSV,
   supprimer la première ligne (`schema_reference`), le guillemet `"` du
   tout début et celui de la toute fin, puis remplacer chaque `""` par `"`.
4. Remplacer dans `sql/schema_reference.sql` tout ce qui suit l'en-tête de
   commentaires par ce texte, et mettre à jour la date de l'en-tête.
5. Lire la dernière rubrique du script, « Contrôle : objets non reproduits
   par ce script ». Elle doit indiquer `-- Aucun.` Sinon, l'objet cité existe
   en base mais le script ne sait pas le recréer : le documenter, ou étendre
   la requête.
6. Déposer le fichier dans le dépôt.

La requête ne doit jamais contenir en toutes lettres un verbe de création
ou d'insertion suivi d'un nom de table, même dans une chaîne ou un
commentaire : l'éditeur SQL Supabase les repère et tente d'agir sur la table
citée, ce qui fait échouer la requête. C'est pourquoi ces verbes y sont
passés en argument de `format()`.

## Ce que le script couvre, et ce qu'il ne couvre pas

Couvert : extensions installées dans `public`, séquences, tables et
colonnes, contraintes, index, fonctions, déclencheurs (y compris ceux posés
hors `public` qui appellent une fonction de `public`), RLS, policies de
`public` et de `storage`, droits, buckets.

Les droits sont d'abord tous retirés puis redonnés exactement : un projet
Supabase neuf accorde par défaut des droits larges à `anon` et
`authenticated`, qui ne correspondent pas à ceux de Cap Huma.

Non couvert : comptes et réglages Auth, réglages du projet (URL autorisées,
e-mails, clés), code et secrets des Edge Functions, tâches planifiées, et
les données elles-mêmes (sauvegarde mensuelle dans le bucket `backups`).

## Recréer la base sur un projet neuf

1. Créer le projet Supabase.
2. Exécuter `sql/schema_reference.sql`. Le script tient en un seul bloc :
   en cas d'erreur, rien n'est créé. Si l'éditeur SQL le refuse, l'exécuter
   avec `psql "<chaîne de connexion>" -f sql/schema_reference.sql` (chaîne
   de connexion : Project Settings → Database).
3. Vérifier : relancer `sql/generer_schema_reference.sql` sur le nouveau
   projet. Le résultat doit être identique au fichier, en-tête mis à part.
4. Restaurer les données depuis la dernière sauvegarde du bucket `backups`,
   redéployer les Edge Functions et leurs secrets, recréer les comptes.
