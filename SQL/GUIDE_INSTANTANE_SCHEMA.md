# Instantané du schéma — procédure sans build ni outil à installer

## Pourquoi cette méthode plutôt que des migrations avec un CLI

Cap Huma est un site 100% statique, volontairement sans build ni framework
— contrainte réelle liée aux droits d'administration des postes ALIMA, pas
une préférence de style. Un outil en ligne de commande (CLI Supabase, npm,
Node.js) irait contre cette contrainte : il faudrait l'installer sur un
poste, ce qui n'est pas toujours possible.

La méthode ci-dessous ne demande rien d'autre qu'un navigateur : copier des
requêtes SQL en lecture seule dans l'éditeur SQL Supabase (le même outil
déjà utilisé pour tout le reste), et coller le résultat dans un fichier.
C'est exactement la méthode qui a produit `schema_snapshot_2026-08-18.sql`
— ses propres requêtes de génération sont reproduites plus bas.

**Ce que cette méthode n'est pas** : un remplacement du backup mensuel
automatique (fonction `monthly-maintenance`), qui sauvegarde les *données*.
Ici, il s'agit de la *structure* de la base (tables, policies, fonctions)
— utile à un futur repreneur pour comprendre le système sans devoir tout
redécouvrir en lisant le code.

## Quand en prendre un

- Aujourd'hui, pour avoir une version à jour avant la reprise IT.
- Après toute modification du schéma (nouvelle table, nouvelle policy,
  nouvelle fonction, etc.) — remplace alors l'instantané précédent.
- À défaut de changement, une fois par trimestre suffit largement pour un
  outil à ce rythme d'évolution.

## Comment procéder (une seule requête)

1. Ouvrir l'éditeur SQL du projet Supabase Cap Huma.
2. Coller et exécuter la requête combinée ci-dessous. Lecture seule
   (`select`), aucun risque pour les données — elle rassemble les 9
   informations en une seule fois, sous forme d'un unique bloc JSON.
3. Copier le résultat (un clic droit sur la cellule → copier, ou
   `Download CSV`/`Copy` selon l'interface).
4. Coller ce résultat ici, ou l'enregistrer tel quel dans un nouveau
   fichier `sql/schema_snapshot_AAAA-MM-JJ.sql` (date du jour).
5. Committer ce nouveau fichier. L'ancien reste dans l'historique Git, pas
   besoin de le supprimer.
6. Si quelque chose d'inattendu apparaît (une info qui ne correspond pas à
   la documentation existante), ajouter une note libre à la fin du
   fichier — voir la section 8 de l'instantané du 18/08/2026 pour un
   exemple de ce type de note.

**Aucune urgence à le faire aujourd'hui** : ce guide reste dans le dépôt,
l'IT pourra faire exactement cette opération seul au moment de la reprise.

## La requête combinée

```sql
select jsonb_pretty(jsonb_build_object(
  'colonnes', (select jsonb_agg(t) from (
      select table_name, column_name, data_type, is_nullable, column_default, ordinal_position
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position
  ) t),
  'contraintes', (select jsonb_agg(t) from (
      select tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name,
             ccu.table_name as references_table, ccu.column_name as references_column
      from information_schema.table_constraints tc
      left join information_schema.key_column_usage kcu
          on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      left join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.table_schema = 'public' and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK')
      order by tc.table_name, tc.constraint_type, kcu.ordinal_position
  ) t),
  'policies_rls', (select jsonb_agg(t) from (
      select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies where schemaname = 'public' order by tablename, policyname
  ) t),
  'rls_active', (select jsonb_agg(t) from (
      select relname as table_name, relrowsecurity as rls_enabled
      from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
      order by relname
  ) t),
  'grants', (select jsonb_agg(t) from (
      select table_name, grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' order by table_name, grantee, privilege_type
  ) t),
  'fonctions', (select jsonb_agg(t) from (
      select p.proname as function_name, pg_get_functiondef(p.oid) as definition
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by p.proname
  ) t),
  'triggers', (select jsonb_agg(t) from (
      select event_object_table as table_name, trigger_name, action_timing,
             event_manipulation, action_statement
      from information_schema.triggers where trigger_schema = 'public'
      order by event_object_table, trigger_name
  ) t),
  'index', (select jsonb_agg(t) from (
      select tablename, indexname, indexdef
      from pg_indexes where schemaname = 'public' order by tablename, indexname
  ) t),
  'contraintes_check_detail', (select jsonb_agg(t) from (
      select conrelid::regclass::text as table_name, conname as constraint_name,
             pg_get_constraintdef(oid) as definition
      from pg_constraint
      where connamespace = 'public'::regnamespace and contype = 'c'
        and conname not like '%\_not\_null'
      order by table_name, conname
  ) t)
)) as instantane_schema;
```

## Détail des 9 requêtes d'origine (si besoin de les relancer séparément)

Utile seulement si la requête combinée pose problème (résultat tronqué par
l'éditeur sur un très gros schéma, par exemple) — sinon, ignorer cette
section et n'utiliser que la requête combinée ci-dessus.

**1) Colonnes de toutes les tables**
```sql
select table_name, column_name, data_type, is_nullable, column_default, ordinal_position
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

**2) Contraintes (PK, FK, UNIQUE, CHECK)**
```sql
select tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name,
       ccu.table_name as references_table, ccu.column_name as references_column
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
left join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
where tc.table_schema = 'public' and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK')
order by tc.table_name, tc.constraint_type, kcu.ordinal_position;
```

**3) Policies RLS**
```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;
```

**4) RLS activé/désactivé par table**
```sql
select relname as table_name, relrowsecurity as rls_enabled
from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;
```

**5) GRANT par table et par rôle**
```sql
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' order by table_name, grantee, privilege_type;
```

**6) Code source des fonctions**
```sql
select p.proname as function_name, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by p.proname;
```

**7) Triggers**
```sql
select event_object_table as table_name, trigger_name, action_timing,
       event_manipulation, action_statement
from information_schema.triggers where trigger_schema = 'public'
order by event_object_table, trigger_name;
```

**8) Index**
```sql
select tablename, indexname, indexdef
from pg_indexes where schemaname = 'public' order by tablename, indexname;
```

**9) Texte exact des contraintes CHECK nommées**
```sql
select conrelid::regclass as table_name, conname as constraint_name,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace and contype = 'c'
  and conname not like '%\_not\_null'
order by table_name, conname;
```

## Ce que je n'ai pas pu faire à votre place

Je n'ai pas d'accès à votre projet Supabase réel, donc je ne peux pas
exécuter ces requêtes moi-même ni produire l'instantané d'aujourd'hui à
votre place. Si vous collez ici les résultats des 9 requêtes, je peux en
revanche les mettre en forme dans un fichier `schema_snapshot_2026-09-12.sql`
prêt à committer, dans le même format que celui du 18/08/2026.
