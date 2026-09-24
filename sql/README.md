# Dossier `sql/` — base de données de Cap Huma

Ce dossier contient le code SQL de la base Supabase de Cap Huma : la structure
complète de la base, de quoi la régénérer, les tests des droits, et tous les
scripts de changement déjà exécutés en base.

## Organisation

| Emplacement | Contenu |
|---|---|
| `schema_reference.sql` | Script exécutable qui recrée toute la structure de la base. **C'est la référence.** |
| `generer_schema_reference.sql` | Requête en lecture seule qui produit `schema_reference.sql` depuis la base réelle. |
| `tests_rls_roles.sql` | Tests des droits par rôle (visiteur, recruteur, admin, compte suspendu) et des fonctions appelées par le site. |
| `historique/` | Scripts de changement déjà exécutés en base, conservés pour mémoire (catalogue ci-dessous). |
| `archives/` | Anciens instantanés `schema_snapshot_AAAA-MM-JJ.sql`, non exécutables, plus produits. |

Un nouveau script de changement se dépose à la racine de `sql/` le temps de son
exécution, puis rejoint `historique/` et le catalogue ci-dessous, et
`schema_reference.sql` est régénéré le même jour.

## Le schéma de référence

`schema_reference.sql` recrée tables, contraintes, index, fonctions,
déclencheurs, Row Level Security, policies (y compris celles du Storage),
droits sur les tables, séquences et fonctions, et buckets Storage.

Il est produit par `generer_schema_reference.sql`, exécutée dans l'éditeur SQL
de Supabase. Aucun outil à installer (CLI Supabase, Node.js, `pg_dump`) : les
postes ALIMA ne le permettent pas toujours, et la méthode ne demande qu'un
navigateur.

### Quand le régénérer

- Le jour même de tout changement de schéma (table, colonne, contrainte,
  index, fonction, déclencheur, policy, droit, bucket).
- Sinon une fois par trimestre : comparer avec la version précédente dans
  l'historique Git fait apparaître tout changement fait hors procédure.

### Comment le régénérer

1. Ouvrir `sql/generer_schema_reference.sql` et copier tout son contenu.
2. Dans Supabase : **SQL Editor** → **+ New query** → coller → **Run**.
   Résultat attendu : une seule cellule, colonne `schema_reference`, dont le
   texte commence par `begin;`.
3. Récupérer le texte : **Export** → **Download CSV** (pas l'export en
   tableau Markdown, qui double les `\` et ajoute des `\` devant les `|`).
   Dans le fichier CSV, supprimer la première ligne (`schema_reference`), le
   guillemet `"` du tout début et celui de la toute fin, puis remplacer
   chaque `""` par `"`.
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

### Ce que le script couvre, et ce qu'il ne couvre pas

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

### Recréer la base sur un projet neuf

1. Créer le projet Supabase.
2. Exécuter `sql/schema_reference.sql`. Le script tient en un seul bloc :
   en cas d'erreur, rien n'est créé. Si l'éditeur SQL le refuse, l'exécuter
   avec `psql "<chaîne de connexion>" -f sql/schema_reference.sql` (chaîne
   de connexion : Project Settings → Database).
3. Vérifier : relancer `sql/generer_schema_reference.sql` sur le nouveau
   projet. Le résultat doit être identique au fichier, en-tête mis à part.
4. Restaurer les données depuis la dernière sauvegarde du bucket `backups`,
   redéployer les Edge Functions et leurs secrets, recréer les comptes.

## Les tests des droits

Coller `sql/tests_rls_roles.sql` en entier dans l'éditeur SQL, puis **Run**.
Le script finit toujours par une erreur rouge volontaire, qui annule toutes
les données de test ; sa première ligne donne le bilan. Attendu :
`A3 BILAN : TOUS LES TESTS ONT REUSSI (77/77, 0 IGNORE)`. L'en-tête du script
explique les cas IGNORE possibles.

À relancer après tout changement de droits, de policy ou de fonction appelée
par le site.

## Catalogue de `historique/`

Scripts déjà exécutés en base, dans l'ordre d'exécution. Ne rien rejouer sur
le projet en production sans lire l'en-tête du script : la structure actuelle
est dans `schema_reference.sql`. La commande d'annulation, quand elle existe,
est en fin de fichier.

| Exécuté le | Script | Objet | Rejouable | Modifié ensuite par |
|---|---|---|---|---|
| 14/08/2026 | `create_rate_limit_log.sql` | Table `rate_limit_log` des limites de débit des Edge Functions | Non indiqué | `rate_limit_log_grant_service_role.sql`, `hygiene_base.sql` (droits) |
| 14/08/2026 | `rate_limit_log_grant_service_role.sql` | Droits de `service_role` sur `rate_limit_log` | Non indiqué | — |
| 14/08/2026 | `comments_evaluations_restrict_visitor.sql` | Un visiteur ne lit pas les commentaires et évaluations d'un talent en Liste Rouge ou dévalidé | Non indiqué | — |
| 18/08/2026 | `audit_missions_trigger.sql` | Journal d'audit automatique sur `missions` | Non indiqué | `privileges_fonctions_storage.sql` (droits d'appel) |
| 18/08/2026 | `audit_share_tokens_trigger.sql` | Journal d'audit automatique sur `share_tokens` | Non indiqué | `privileges_fonctions_storage.sql` (droits d'appel) |
| 18-19/08/2026 | `audit_talents_trigger.sql` | Journal d'audit automatique sur `talents`, action métier déduite | Non indiqué | `privileges_fonctions_storage.sql` (droits d'appel), `hygiene_base.sql` (commentaires retirés du code) |
| — | `functions_is_admin_get_shared_talent.sql` | Version de référence de `is_admin()` et `get_shared_talent()` | Non indiqué | `suspension_compte.sql` (`is_admin()` réécrite) ; `get_shared_talent()` identique, hors commentaires, à celle de l'étape 5 |
| 15-16/09/2026 | `staff_national_detachement_socle_en_base.sql` | Staff national et détachement : colonnes et contraintes (reconstitué) | Inutile sur ce projet | — |
| 16/09/2026 | `staff_national_detachement_etape4_garde_fou_occupant.sql` | Garde-fou en base sur le type de staff de l'occupant d'un poste | Non indiqué | `privileges_fonctions_storage.sql` (droits d'appel) |
| 17/09/2026 | `staff_national_detachement_etape2_country_nullable.sql` | `missions.country` n'est plus obligatoire (reconstitué) | Sans effet si déjà appliqué | — |
| 18/09/2026 | `staff_national_detachement_etape5_get_shared_talent_detachement.sql` | Lien de partage : le détachement est renvoyé à part | Non indiqué | — |
| 22/09/2026 | `create_client_error_logs.sql` | Table `client_error_logs` des erreurs du navigateur (reconstitué) | Non | `client_error_logs_grants.sql`, `author_fields_from_session.sql`, `hygiene_base.sql` |
| 22/09/2026 | `client_error_logs_grants.sql` | Droits et règle de suppression de `client_error_logs` | Oui | — |
| 22/09/2026 | `users_fk_on_delete.sql` | Suppression d'un compte : les données qui le citent sont conservées | Oui | — |
| 23/09/2026 | `author_fields_from_session.sql` | Auteur affiché imposé par la base ; limites sur `client_error_logs` | Oui | `audit_logs_auteur_et_volume.sql` (étendu à `audit_logs`) |
| 23/09/2026 | `privileges_fonctions_storage.sql` | Droits d'appel des fonctions de déclencheur ; suppression des documents Liste Rouge | Oui | — |
| 23/09/2026 | `suspension_compte.sql` | Un compte suspendu perd tout accès aux données | Oui | — |
| 23/09/2026 | `users_modification_via_manage_users.sql` | `users` n'est plus modifiable depuis le site | Oui | — |
| 23/09/2026 | `audit_logs_auteur_et_volume.sql` | Auteur, date, volume et actions du journal d'audit imposés par la base | Oui | — |
| 23/09/2026 | `hygiene_base.sql` | Nettoyage : droits inutiles, doublons, pools en `ON DELETE RESTRICT` | Oui | — |
| 23/09/2026 | `demandes_nouveau_code.sql` | Table `access_code_requests` et demande de nouveau code d'accès | Oui | — |
| 23/09/2026 | `changement_pool_atomique.sql` | Changement de pool et passage en expat en une seule opération | Oui | — |
| 23/09/2026 | `sortie_occupant_poste.sql` | Sortie et entrée d'un occupant, contrats échus traités en base (reconstitué) | Non | `enregistrement_poste_atomique.sql` (`archive_mission_occupant()` supprimée) |
| 23/09/2026 | `enregistrement_poste_atomique.sql` | Enregistrement, suppression et resynchronisation d'un poste en une seule opération | Oui | — |
| 24/09/2026 | `monthly_maintenance_sauvegarde_journal.sql` | Lecture de `notification_preferences` pour la sauvegarde mensuelle ; auteur « Système » dans le journal des talents sans compte connecté | Oui | — |

« Reconstitué » : le script d'origine n'avait pas été conservé ; il a été
réécrit d'après la base réelle, et son en-tête le précise.

## `archives/`

`schema_snapshot_2026-08-18.sql`, `schema_snapshot_2026-09-12.sql`,
`schema_snapshot_2026-09-19.sql`, `schema_snapshot_2026-09-22.sql` : anciens
instantanés datés, non exécutables. Ils ne sont plus produits ni modifiés :
`schema_reference.sql` les remplace.
