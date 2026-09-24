-- ============================================================================
-- schema_snapshot_2026-08-18.sql
-- ----------------------------------------------------------------------------
-- Instantané complet du schéma Postgres de Cap Huma (projet Supabase),
-- généré le 18/08/2026 (chantier A4, Master Context §7).
--
-- Ce fichier N'EST PAS un script à exécuter : c'est une PHOTO fidèle de
-- l'état réel de la base à cette date (colonnes, contraintes, RLS, policies,
-- GRANT, fonctions, triggers, index), extraite directement depuis l'éditeur
-- SQL Supabase (information_schema / pg_catalog) — pas reconstruite de
-- mémoire (règle 7 du Master Context). Les requêtes utilisées pour la
-- produire sont reproduites en fin de fichier (§9), pour pouvoir régénérer
-- un futur instantané de la même façon.
--
-- Résumé : 11 tables, RLS activé sur les 11, 5 fonctions (2 SECURITY
-- DEFINER : is_admin/get_shared_talent ; 3 fonctions RPC "métier" :
-- get_notification_alerts/get_pool_mission_counts/get_pool_talent_stats —
-- voir note importante en §8), 0 trigger, 4 dépendances CDN (hors sujet
-- ici, voir Dossier §6).
-- ============================================================================


-- ============================================================================
-- 1. TABLES ET COLONNES (information_schema.columns, 18/08/2026)
-- ============================================================================

-- ---- audit_logs (10 colonnes) --------------------------------------------
--   id            uuid                       NOT NULL  default gen_random_uuid()
--   user_id       uuid                       NULL
--   user_email    text                       NULL
--   user_name     text                       NULL
--   action        text                       NOT NULL
--   entity_type   text                       NOT NULL
--   entity_id     text                       NULL
--   entity_name   text                       NULL
--   details       text                       NULL
--   created_at    timestamp with time zone   NULL      default now()

-- ---- comments (6 colonnes) -------------------------------------------------
--   id            uuid                       NOT NULL  default gen_random_uuid()
--   talent_id     uuid                       NOT NULL
--   user_id       uuid                       NOT NULL
--   content       text                       NOT NULL
--   created_at    timestamp with time zone   NULL      default now()
--   author_email  text                       NULL

-- ---- evaluations (15 colonnes) --------------------------------------------
--   id                    uuid                       NOT NULL  default gen_random_uuid()
--   mission_id            uuid                       NOT NULL  -- ⚠️ NOT NULL non documenté avant A3 (voir §4.2 Dossier)
--   talent_id             uuid                       NOT NULL
--   author_id             uuid                       NULL
--   context               text                       NOT NULL
--   positive_points       text                       NULL
--   negative_points       text                       NULL
--   rating                integer                    NULL
--   legacy_content        text                       NULL
--   is_archived           boolean                    NULL      default false
--   created_at            timestamp with time zone   NULL      default now()
--   author_email          text                       NULL
--   comment_text          text                       NULL
--   is_moderated          boolean                    NULL      default false
--   is_red_list_trigger   boolean                    NULL      default false

-- ---- missions (23 colonnes) ------------------------------------------------
--   id                            uuid                       NOT NULL  default gen_random_uuid()
--   title                         text                       NOT NULL
--   pool                          text                       NULL      -- FK -> pools(pool_id)
--   pool_level                    text                       NOT NULL
--   country                       text                       NOT NULL
--   location                      text                       NOT NULL
--   project_name                  text                       NULL
--   candidate_type                text                       NULL
--   desk                          text                       NULL
--   status                        text                       NOT NULL  default 'vacant'
--   occupant_id                   uuid                       NULL
--   contract_start_date           timestamp with time zone   NULL
--   contract_end_date             timestamp with time zone   NULL
--   contract_status               text                       NULL
--   future_talent_id              uuid                       NULL
--   future_contract_start_date    timestamp with time zone   NULL
--   future_contract_end_date      timestamp with time zone   NULL
--   created_at                    timestamp with time zone   NULL      default now()
--   created_by                    uuid                       NULL
--   pool_id                       text                       NULL
--   is_expat                      boolean                    NULL      default true
--   current_occupant_id           uuid                       NULL
--   future_occupant_id            uuid                       NULL

-- ---- notification_preferences (5 colonnes) ---------------------------------
--   id            uuid                       NOT NULL  default gen_random_uuid()
--   user_id       uuid                       NOT NULL
--   enabled       boolean                    NOT NULL  default true
--   pool_scope    text[]                     NULL
--   updated_at    timestamp with time zone   NOT NULL  default now()

-- ---- pool_history (7 colonnes) ---------------------------------------------
--   id                 uuid                       NOT NULL  default gen_random_uuid()
--   talent_id          uuid                       NOT NULL
--   from_pool          text                       NULL
--   to_pool            text                       NOT NULL
--   changed_at         timestamp with time zone   NOT NULL  default now()
--   changed_by         uuid                       NULL
--   changed_by_name    text                       NULL

-- ---- pools (12 colonnes) ----------------------------------------------------
--   id                   uuid                       NOT NULL  default gen_random_uuid()
--   pool_id              text                       NOT NULL  -- vraie clé métier, référencée en FK ailleurs
--   name                 text                       NOT NULL
--   full_name            text                       NOT NULL
--   level                text                       NOT NULL  -- CHECK: 'mission' | 'project'
--   description          text                       NULL
--   color                text                       NULL
--   is_active            boolean                    NULL      default true
--   created_at           timestamp with time zone   NULL      default now()
--   is_archived          boolean                    NOT NULL  default false
--   archived_at          timestamp with time zone   NULL
--   archived_by_name     text                       NULL
--   -- ⚠️ is_active ET is_archived coexistent (Dossier §4.2) — non revérifié ici

-- ---- rate_limit_log (4 colonnes) -- déjà versionnée intégralement dans
--      create_rate_limit_log.sql (18/08/2026) — non répétée ici en détail.

-- ---- share_tokens (10 colonnes) ---------------------------------------------
--   id                 uuid                       NOT NULL  default gen_random_uuid()
--   token              text                       NOT NULL  -- UNIQUE
--   talent_id          uuid                       NOT NULL
--   created_by         uuid                       NOT NULL
--   expires_at         timestamp with time zone   NULL
--   is_revoked         boolean                    NULL      default false
--   view_count         integer                    NULL      default 0
--   last_viewed_at     timestamp with time zone   NULL
--   created_at         timestamp with time zone   NULL      default now()
--   created_by_name    text                       NULL

-- ---- talents (58 colonnes) -- la plus grande table, cœur métier du site --
--   id                                        uuid       NOT NULL  default gen_random_uuid()
--   first_name                                text       NOT NULL
--   last_name                                 text       NOT NULL
--   email                                     text       NULL
--   pool                                      text       NULL      -- FK -> pools(pool_id)
--   status                                    text       NOT NULL  default 'En attente de poste'
--   is_valid                                  boolean    NULL      default true
--   is_red_listed                             boolean    NULL      default false
--   experience_months_alima                   integer    NULL      default 0
--   experience_months_humanitarian            integer    NULL      default 0
--   number_of_alima_missions                  text       NULL      default 'none'
--   status_history                            jsonb      NULL      default '[]'
--   last_status_change_date                   timestamptz NULL
--   pool_integration_date                     timestamptz NULL     default now()
--   availability                              jsonb      NULL      default '{"type": "none"}'
--   has_emergency_mission                     boolean    NULL      default false
--   emergency_mission_comments                text       NULL
--   has_mission_opening                       boolean    NULL      default false
--   mission_opening_comments                  text       NULL
--   has_mission_closure                       boolean    NULL      default false
--   closure_mission_comments                  text       NULL
--   intervention_contexts                     text[]     NULL
--   intervention_zones                        text[]     NULL
--   key_skills                                text[]     NULL
--   has_visa                                  boolean    NULL      default false
--   nationality                               text       NULL
--   country_of_residence                      text       NULL
--   education_level                           text       NULL
--   education_specialty                       text       NULL
--   alima_trainings                           jsonb      NULL      default '[]'
--   last_experience_update                    timestamptz NULL
--   red_list_date                             timestamptz NULL
--   red_list_reason                           text       NULL
--   red_list_added_by                         uuid       NULL
--   red_list_added_by_name                    text       NULL
--   red_list_documents                        text[]     NULL
--   last_mission_end_date                     timestamptz NULL
--   is_currently_on_mission                   boolean    NULL      default false
--   months_without_mission                    integer    NULL      default 0
--   created_at                                timestamptz NULL     default now()
--   created_by                                uuid       NULL
--   gender                                    text       NULL
--   languages                                 text[]     NULL
--   other_languages                           text[]     NULL
--   current_function                          text       NULL
--   availability_type                         text       NULL
--   availability_months                       integer    NULL
--   availability_date                         date       NULL
--   project_status                            text       NULL
--   had_alima_mission                         boolean    NULL      default false
--   months_without_alima_mission               integer   NULL      default 0
--   devalidation_date                         date       NULL
--   archived_position_passages                jsonb      NULL      default '[]'
--   devalidation_extension_until              date       NULL
--   devalidation_extension_months             integer    NULL
--   devalidation_extension_granted_by         uuid       NULL
--   devalidation_extension_granted_by_name    text       NULL
--   devalidation_extension_granted_at         timestamptz NULL

-- ---- users (6 colonnes) -----------------------------------------------------
--   id            uuid    NOT NULL  -- FK -> auth.users(id), schéma Supabase Auth (voir note §2)
--   name          text    NULL
--   email         text    NULL
--   role          text    NULL      default 'user'  -- CHECK: probablement 'admin'|'user'|'visitor', texte exact non capturé (voir §2)
--   is_active     boolean NULL      default true
--   created_at    timestamptz NULL  default now()


-- ============================================================================
-- 2. CONTRAINTES (PK / FK / UNIQUE / CHECK) — information_schema, 18/08/2026
-- ----------------------------------------------------------------------------
-- Les contraintes "NOT NULL" générées automatiquement par Postgres (noms du
-- type "2200_xxxxx_n_not_null") sont omises ici : elles font double emploi
-- avec la colonne "is_nullable" du §1, propre à chaque colonne.
--
-- ⚠️ LIMITE CONNUE DE CET INSTANTANÉ : le texte exact des contraintes CHECK
-- nommées ci-dessous n'a pas été capturé (la requête utilisée donne le nom
-- et la colonne, pas la définition). Les valeurs autorisées existent déjà en
-- pratique dans le code front (STATUS_LABELS, DESK_LABELS, etc. de
-- caphuma-utils.js, et les <select> des formulaires), mais ne sont pas
-- confirmées ici au niveau base. Une requête complémentaire (pg_get_
-- constraintdef) comblerait ce point si besoin — voir proposition en fin de
-- réponse, pas incluse dans cet instantané pour ne pas le retarder.
-- ============================================================================

-- audit_logs      : PK(id) ; FK(user_id) -> users(id)
-- comments        : PK(id) ; FK(talent_id) -> talents(id) ; FK(user_id) -> users(id)
-- evaluations     : PK(id) ; FK(talent_id) -> talents(id) ; FK(mission_id) -> missions(id) ;
--                   FK(author_id) -> users(id) ; CHECK evaluations_rating_check (texte non capturé)
-- missions        : PK(id) ; FK(created_by) -> users(id) ; FK(occupant_id) -> talents(id) ;
--                   FK(pool) -> pools(pool_id) ; FK(future_talent_id) -> talents(id) ;
--                   CHECK missions_status_check, missions_contract_status_check,
--                   missions_desk_check, missions_candidate_type_check,
--                   missions_pool_level_check (textes non capturés)
-- notification_preferences : PK(id) ; FK(user_id) -> users(id) ; UNIQUE(user_id)
-- pool_history    : PK(id) ; FK(changed_by) -> users(id) ; FK(talent_id) -> talents(id)
-- pools           : PK(id) ; UNIQUE(pool_id) ; CHECK pools_level_check (texte non capturé)
-- rate_limit_log  : PK(id) — aucune FK (choix assumé, voir create_rate_limit_log.sql)
-- share_tokens    : PK(id) ; FK(talent_id) -> talents(id) ; FK(created_by) -> users(id) ;
--                   UNIQUE(token)
-- talents         : PK(id) ; FK(red_list_added_by) -> users(id) ; FK(pool) -> pools(pool_id) ;
--                   FK(created_by) -> users(id) ;
--                   CHECK talents_status_check, talents_education_level_check,
--                   talents_availability_type_check, talents_project_status_check,
--                   talents_number_of_alima_missions_check (textes non capturés)
--                   ⚠️ Curiosité relevée, pas vérifiée plus loin : DEUX contraintes CHECK
--                   distinctes existent sur la colonne number_of_alima_missions
--                   ("talents_number_of_missions_check" ET
--                   "talents_number_of_alima_missions_check") — possible reliquat
--                   d'un renommage de colonne, à vérifier un jour si l'occasion se
--                   présente, sans urgence (aucun symptôme observé).
-- users           : PK(id) ; UNIQUE(email) ; FK(id) -> auth.users(id) (schéma "auth" de
--                   Supabase, hors du schéma "public" — voir note §2 ci-dessus) ;
--                   CHECK users_role_check (texte non capturé)


-- ============================================================================
-- 3. ROW LEVEL SECURITY — activé/désactivé par table (pg_class, 18/08/2026)
-- ============================================================================
-- Les 11 tables ont RLS ACTIVÉ, sans exception :
-- audit_logs, comments, evaluations, missions, notification_preferences,
-- pool_history, pools, rate_limit_log, share_tokens, talents, users.


-- ============================================================================
-- 4. POLICIES RLS — résumé par table (pg_policies, 18/08/2026)
-- ----------------------------------------------------------------------------
-- Résumé en langage clair, cohérent avec le tableau du Dossier technique
-- §4.3. Le texte SQL brut complet des policies RESTRICTIVE (les plus
-- sensibles) est versionné mot pour mot dans comments_evaluations_restrict_
-- visitor.sql (18/08/2026) et talents_restrict_visitor.sql (17/07/2026,
-- déjà dans sql/). Le texte brut des policies PERMISSIVE ci-dessous est
-- disponible dans l'historique de cette conversation si besoin de le
-- reproduire un jour à l'identique.
-- ============================================================================

-- audit_logs
--   INSERT (permissive, authenticated) : chacun peut insérer sa propre action (user_id = soi)
--   SELECT (permissive, authenticated) : admin uniquement
--   (aucune policy UPDATE/DELETE : personne ne peut modifier/supprimer une ligne)

-- comments
--   SELECT (permissive) : tout connecté   |   SELECT (RESTRICTIVE, visitor exclu si talent
--     Liste Rouge/dévalidé, voir fichier dédié)
--   INSERT (permissive) : auteur = soi, role admin/user
--   UPDATE (permissive) : admin, ou auteur si role user
--   DELETE (permissive) : admin, ou auteur si role user

-- evaluations
--   SELECT (permissive) : tout connecté   |   SELECT (RESTRICTIVE, même logique que comments)
--   INSERT (permissive) : author_id = soi, role admin/user
--   UPDATE (permissive) : admin, ou auteur si role user
--   DELETE (permissive) : admin, ou auteur si role user

-- missions
--   SELECT (permissive) : tout connecté
--   INSERT/UPDATE/DELETE (permissive) : role admin ou user

-- notification_preferences
--   SELECT/INSERT/UPDATE (permissive) : chacun sur sa propre ligne (user_id = soi)
--   (aucune policy DELETE : pas de suppression prévue depuis l'app)

-- pool_history
--   SELECT (permissive) : tout connecté
--   INSERT (permissive) : role admin ou user
--   (aucune policy UPDATE/DELETE : append-only voulu)

-- pools
--   SELECT (permissive) : tout connecté
--   INSERT/UPDATE/DELETE (permissive) : admin uniquement

-- share_tokens
--   SELECT (permissive) : admin (is_admin()), ou créateur du lien
--   INSERT (permissive) : créateur = soi, role admin/user
--   UPDATE (permissive) : admin (is_admin()), ou créateur du lien
--   DELETE (permissive) : admin (is_admin())

-- talents
--   SELECT (permissive) : tout connecté   |   SELECT (RESTRICTIVE) : visitor exclu si
--     Liste Rouge/dévalidé (talents_restrict_visitor.sql, 17/07/2026)
--   INSERT (permissive) : role admin ou user
--   UPDATE (permissive) : role admin ou user
--   DELETE (permissive) : admin uniquement

-- users
--   SELECT (permissive) : soi-même, ou admin (is_admin(), toutes les lignes)
--   UPDATE (permissive) : admin (is_admin()) uniquement
--   (aucune policy INSERT/DELETE : gérées côté serveur par manage-users, service_role)


-- ============================================================================
-- 5. GRANT — autorisations par table et par rôle (role_table_grants, 18/08/2026)
-- ----------------------------------------------------------------------------
-- Motif récurrent observé sur les 11 tables : postgres et service_role ont
-- tous les privilèges (SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/
-- TRUNCATE) ; anon et authenticated n'ont QUE REFERENCES/TRIGGER par défaut
-- (accordés automatiquement par Supabase à la création de toute table, sans
-- lien avec RLS) ; authenticated reçoit en plus SELECT/INSERT/UPDATE/DELETE
-- explicitement sur les tables où l'app doit pouvoir écrire (le filtrage
-- fin reste alors entièrement à la charge des policies RLS du §4).
--
-- Aucune anomalie trouvée : le motif attendu (règle 30 du Master Context)
-- est respecté partout, y compris sur rate_limit_log (service_role a bien
-- SELECT/INSERT/DELETE explicites, pas UPDATE — cohérent, la fonction ne
-- fait jamais de mise à jour sur cette table) et notification_preferences
-- (service_role n'a QUE REFERENCES/TRIGGER/TRUNCATE, ce qui est normal :
-- aucune Edge Function ne touche cette table, voir §8 note importante).
-- ============================================================================

-- Table                      | anon                | authenticated                          | service_role (au-delà des défauts)
-- ---------------------------|----------------------|------------------------------------------|-------------------------------------
-- audit_logs                 | REFERENCES, TRIGGER  | +INSERT, SELECT                          | +DELETE, INSERT, SELECT, UPDATE
-- comments                   | REFERENCES, TRIGGER  | +DELETE, INSERT, SELECT, UPDATE          | +DELETE, INSERT, SELECT, UPDATE
-- evaluations                | (aucun accès direct) | DELETE, INSERT, SELECT, UPDATE (+défauts)| +DELETE, INSERT, SELECT, UPDATE
-- missions                   | (aucun accès direct) | DELETE, INSERT, SELECT, UPDATE (+défauts)| +DELETE, INSERT, SELECT, UPDATE
-- notification_preferences   | REFERENCES, TRIGGER  | +INSERT, SELECT, UPDATE                  | aucun au-delà des défauts (voir note §8)
-- pool_history                | (aucun accès direct) | INSERT, SELECT (+défauts)                | +DELETE, INSERT, SELECT, UPDATE
-- pools                      | (aucun accès direct) | DELETE, INSERT, SELECT, UPDATE (+défauts)| +DELETE, INSERT, SELECT, UPDATE
-- rate_limit_log             | REFERENCES, TRIGGER  | REFERENCES, TRIGGER (aucun accès direct) | +DELETE, INSERT, SELECT (pas UPDATE)
-- share_tokens                | (aucun accès direct) | DELETE, INSERT, SELECT, UPDATE (+défauts)| +DELETE, INSERT, SELECT, UPDATE
-- talents                    | (aucun accès direct) | DELETE, INSERT, SELECT, UPDATE (+défauts)| +DELETE, INSERT, SELECT, UPDATE
-- users                      | (aucun accès direct) | SELECT, UPDATE (+défauts, pas INSERT/DELETE) | +DELETE, INSERT, SELECT, UPDATE

-- (postgres, propriétaire du schéma, a systématiquement tous les privilèges
-- sur les 11 tables — omis ligne par ligne ci-dessus pour la lisibilité.)


-- ============================================================================
-- 6. FONCTIONS DU SCHÉMA PUBLIC (pg_proc, 18/08/2026) — code source complet
-- ============================================================================

-- ---- is_admin() — SECURITY DEFINER -----------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND role = 'admin'
    );
$function$;

-- ---- get_shared_talent(p_token text) — SECURITY DEFINER --------------------
-- ⚠️ Confirme ici, sur le code réellement en base, les 2 points ouverts de
-- B1 (Master Context §7) : view_count est incrémenté (bloc UPDATE) AVANT le
-- contrôle Liste Rouge (qui n'a lieu que dans le SELECT suivant) ; la
-- sous-requête sur "missions" n'a pas de ORDER BY avant LIMIT 1. Les deux
-- comportements sont donc bien réels, pas juste rapportés au Master Context.
CREATE OR REPLACE FUNCTION public.get_shared_talent(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_link record;
    v_talent jsonb;
    v_mission jsonb;
BEGIN
    SELECT * INTO v_link
    FROM public.share_tokens
    WHERE token = p_token;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'invalid_token');
    END IF;

    IF v_link.is_revoked THEN
        RETURN jsonb_build_object('error', 'revoked');
    END IF;

    IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN
        RETURN jsonb_build_object('error', 'expired');
    END IF;

    UPDATE public.share_tokens
    SET view_count = COALESCE(view_count, 0) + 1,
        last_viewed_at = now()
    WHERE token = p_token;

    SELECT jsonb_build_object(
        'first_name', t.first_name,
        'last_name', t.last_name,
        'current_function', t.current_function,
        'status', t.status,
        'pool', t.pool,
        'email', t.email,
        'gender', t.gender,
        'nationality', t.nationality,
        'country_of_residence', t.country_of_residence,
        'has_visa', t.has_visa,
        'languages', t.languages,
        'education_level', t.education_level,
        'education_specialty', t.education_specialty,
        'pool_integration_date', t.pool_integration_date,
        'experience_months_alima', t.experience_months_alima,
        'experience_months_humanitarian', t.experience_months_humanitarian,
        'number_of_alima_missions', t.number_of_alima_missions,
        'key_skills', t.key_skills,
        'intervention_contexts', t.intervention_contexts,
        'intervention_zones', t.intervention_zones,
        'archived_position_passages', t.archived_position_passages
    ) INTO v_talent
    FROM public.talents t
    WHERE t.id = v_link.talent_id
      AND coalesce(t.is_red_listed, false) = false;

    IF v_talent IS NULL THEN
        RETURN jsonb_build_object('error', 'talent_not_found');
    END IF;

    SELECT jsonb_build_object(
        'title', m.title,
        'country', m.country,
        'contract_start_date', m.contract_start_date
    ) INTO v_mission
    FROM public.missions m
    WHERE m.occupant_id = v_link.talent_id
    AND m.status = 'occupied'
    LIMIT 1;

    RETURN jsonb_build_object('talent', v_talent, 'mission', v_mission);
END;
$function$;

-- ---- get_pool_talent_stats() — RPC, PAS SECURITY DEFINER -------------------
-- Voir note importante §8 : appelée directement par dashboard.html.
-- ⚠️ Seuil "à risque" = 24 mois, codé en dur ici (dupliqué avec
-- MONTHS_WITHOUT_MISSION_RISK_THRESHOLD dans dashboard.html).
CREATE OR REPLACE FUNCTION public.get_pool_talent_stats()
 RETURNS TABLE(pool_id text, active bigint, available bigint, at_risk bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    t.pool as pool_id,
    count(*) as active,
    count(*) filter (where t.status = 'En attente de poste') as available,
    count(*) filter (where coalesce(t.months_without_mission, 0) >= 24) as at_risk
  from talents t
  where t.pool is not null
    and t.is_valid is not false
    and t.is_red_listed is not true
  group by t.pool;
$function$;

-- ---- get_pool_mission_counts() — RPC, PAS SECURITY DEFINER -----------------
-- Voir note importante §8 : appelée directement par dashboard.html.
CREATE OR REPLACE FUNCTION public.get_pool_mission_counts()
 RETURNS TABLE(pool_id text, positions bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    coalesce(m.pool, m.pool_id) as pool_id,
    count(*) as positions
  from missions m
  where coalesce(m.pool, m.pool_id) is not null
  group by coalesce(m.pool, m.pool_id);
$function$;

-- ---- get_notification_alerts(p_pool_scope text[]) — RPC, PAS SECURITY DEFINER
-- Voir note importante §8 : appelée directement par dashboard.html.
-- ⚠️ Seuils codés en dur ici : fenêtre contrat 90 jours (paliers 30/60/90),
-- risque de dévalidation = 20 mois. Dupliqués avec NOTIF_CONTRACT_WINDOWS et
-- NOTIF_DEVALIDATION_RISK_MONTHS dans dashboard.html.
CREATE OR REPLACE FUNCTION public.get_notification_alerts(p_pool_scope text[] DEFAULT NULL::text[])
 RETURNS TABLE(alert_type text, pool_id text, days_left integer, contract_window integer, status text)
 LANGUAGE sql
 STABLE
AS $function$
  select
    'contract'::text as alert_type,
    coalesce(m.pool, m.pool_id) as pool_id,
    (m.contract_end_date::date - current_date)::int as days_left,
    case
      when (m.contract_end_date::date - current_date) <= 30 then 30
      when (m.contract_end_date::date - current_date) <= 60 then 60
      else 90
    end as contract_window,
    null::text as status
  from missions m
  where m.status = 'occupied'
    and m.contract_end_date is not null
    and (m.contract_end_date::date - current_date) between 0 and 90
    and (p_pool_scope is null or coalesce(m.pool, m.pool_id) = any(p_pool_scope))

  union all

  select
    'vacancy'::text,
    coalesce(m.pool, m.pool_id),
    null::int,
    null::int,
    m.status
  from missions m
  where m.status in ('vacant', 'recruiting')
    and coalesce(m.pool, m.pool_id) is not null
    and (p_pool_scope is null or coalesce(m.pool, m.pool_id) = any(p_pool_scope))

  union all

  select
    'available'::text,
    t.pool,
    null::int,
    null::int,
    null::text
  from talents t
  where t.is_valid is not false
    and t.is_red_listed is not true
    and t.pool is not null
    and (
      t.availability_type = 'asap'
      or (t.availability_type = 'date' and t.availability_date is not null and t.availability_date::date <= current_date)
    )
    and (p_pool_scope is null or t.pool = any(p_pool_scope))

  union all

  select
    'at_risk'::text,
    t.pool,
    null::int,
    null::int,
    null::text
  from talents t
  where t.is_valid is not false
    and t.is_red_listed is not true
    and t.pool is not null
    and coalesce(t.months_without_mission, 0) >= 20
    and (p_pool_scope is null or t.pool = any(p_pool_scope));
$function$;


-- ============================================================================
-- 7. TRIGGERS (information_schema.triggers, 18/08/2026)
-- ----------------------------------------------------------------------------
-- AUCUN trigger n'existe actuellement sur le schéma public. Confirme que
-- toute la journalisation d'audit (audit_logs) est aujourd'hui 100% côté
-- client (capHumaLogAudit()), sans filet serveur — c'est précisément le
-- point de départ du chantier A5 (Master Context §7).
-- ============================================================================


-- ============================================================================
-- 8. NOTE IMPORTANTE — écart découvert en produisant cet instantané
-- ----------------------------------------------------------------------------
-- Le Dossier technique §5.4 affirme que les 4 catégories d'alertes de la
-- cloche de notifications sont "calculées côté client à partir de requêtes
-- talents/missions dédiées". FAUX à la vérification du code réel de
-- dashboard.html (règle 23) : la page appelle bien 3 fonctions SQL
-- (get_pool_talent_stats, get_pool_mission_counts, get_notification_alerts)
-- via supabaseClient.rpc(...) — le calcul a été optimisé côté serveur à un
-- moment non documenté, sans mise à jour du Dossier ni du Master Context.
--
-- Conséquence concrète à noter (pas à corriger dans ce fichier, qui n'est
-- que de la documentation) : PLUSIEURS SEUILS MÉTIER SONT DUPLIQUÉS entre le
-- JS et le SQL, avec un commentaire dans dashboard.html qui le confirme et
-- avertit déjà : "si ce seuil change un jour, il faut le changer ICI ET
-- dans la fonction SQL." Trois seuils concernés :
--   - risque de dévalidation pour les cartes de pool : 24 mois (JS :
--     MONTHS_WITHOUT_MISSION_RISK_THRESHOLD ; SQL : get_pool_talent_stats())
--   - risque de dévalidation pour les notifications : 20 mois (JS :
--     NOTIF_DEVALIDATION_RISK_MONTHS ; SQL : get_notification_alerts())
--   - paliers de fenêtre contrat : 30/60/90 jours (JS :
--     NOTIF_CONTRACT_WINDOWS ; SQL : get_notification_alerts())
--
-- À reporter dans le Dossier technique §5.4/§4.3 lors de la mise à jour de
-- fin de session (règle 22), et éventuellement dans le backlog B (Master
-- Context §7) comme fragilité mineure de maintenance — décision à prendre
-- avec l'utilisateur, pas tranchée ici (règle 16).
-- ============================================================================


-- ============================================================================
-- 9. INDEX (pg_indexes, 18/08/2026) — 41 index au total sur les 11 tables
-- ----------------------------------------------------------------------------
-- audit_logs      : audit_logs_pkey(id), idx_audit_logs_created_at(created_at),
--                   idx_audit_logs_user_id(user_id)
-- comments        : comments_pkey(id), idx_comments_talent_id(talent_id),
--                   idx_comments_user_id(user_id)
-- evaluations     : evaluations_pkey(id), idx_evaluations_author_id(author_id),
--                   idx_evaluations_mission_id(mission_id), idx_evaluations_talent_id(talent_id)
-- missions        : missions_pkey(id), idx_missions_created_by(created_by),
--                   idx_missions_future_talent_id(future_talent_id),
--                   idx_missions_occupant_id(occupant_id), idx_missions_pool(pool),
--                   idx_missions_status(status)
-- notification_preferences : notification_preferences_pkey(id),
--                   notification_preferences_user_id_key(user_id, UNIQUE)
-- pool_history    : pool_history_pkey(id), idx_pool_history_changed_by(changed_by),
--                   pool_history_talent_id_idx(talent_id)
-- pools           : pools_pkey(id), pools_pool_id_key(pool_id, UNIQUE),
--                   idx_pools_pool_id(pool_id), idx_pools_is_archived(is_archived)
-- rate_limit_log  : rate_limit_log_pkey(id),
--                   rate_limit_log_lookup_idx(user_id, function_name, created_at)
-- share_tokens    : shared_links_pkey(id), shared_links_token_key(token, UNIQUE),
--                   idx_shared_links_token(token), idx_share_tokens_created_by(created_by),
--                   idx_share_tokens_talent_id(talent_id)
-- talents         : talents_pkey(id), idx_talents_pool(pool), idx_talents_is_valid(is_valid),
--                   idx_talents_is_red_listed(is_red_listed), idx_talents_status(status),
--                   idx_talents_pool_is_valid(pool, is_valid),
--                   idx_talents_months_without_mission(months_without_mission),
--                   idx_talents_devalidation_date(devalidation_date),
--                   idx_talents_red_list_added_by(red_list_added_by),
--                   talents_created_by_idx(created_by), talents_nationality_idx(nationality),
--                   talents_education_level_idx(education_level),
--                   talents_number_of_alima_missions_idx(number_of_alima_missions),
--                   talents_status_idx(status)
-- users           : users_pkey(id), users_email_key(email, UNIQUE), idx_users_email(email)


-- ============================================================================
-- 10. REQUÊTES UTILISÉES POUR PRODUIRE CET INSTANTANÉ (lecture seule)
-- ----------------------------------------------------------------------------
-- Reproduites ici pour pouvoir régénérer un futur instantané à l'identique,
-- sans avoir à les retrouver dans une conversation passée.
-- ============================================================================

-- 1) Colonnes de toutes les tables
-- select table_name, column_name, data_type, is_nullable, column_default, ordinal_position
-- from information_schema.columns
-- where table_schema = 'public'
-- order by table_name, ordinal_position;

-- 2) Contraintes (PK, FK, UNIQUE, CHECK)
-- select tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name,
--        ccu.table_name as references_table, ccu.column_name as references_column
-- from information_schema.table_constraints tc
-- left join information_schema.key_column_usage kcu
--     on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
-- left join information_schema.constraint_column_usage ccu
--     on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
-- where tc.table_schema = 'public' and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK')
-- order by tc.table_name, tc.constraint_type, kcu.ordinal_position;

-- 3) Policies RLS
-- select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- from pg_policies where schemaname = 'public' order by tablename, policyname;

-- 4) RLS activé/désactivé par table
-- select relname as table_name, relrowsecurity as rls_enabled
-- from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
-- order by relname;

-- 5) GRANT par table et par rôle
-- select table_name, grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public' order by table_name, grantee, privilege_type;

-- 6) Code source des fonctions
-- select p.proname as function_name, pg_get_functiondef(p.oid) as definition
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' order by p.proname;

-- 7) Triggers
-- select event_object_table as table_name, trigger_name, action_timing,
--        event_manipulation, action_statement
-- from information_schema.triggers where trigger_schema = 'public'
-- order by event_object_table, trigger_name;

-- 8) Index
-- select tablename, indexname, indexdef
-- from pg_indexes where schemaname = 'public' order by tablename, indexname;

-- 9) Complément possible non inclus dans cet instantané : texte exact des
--    contraintes CHECK nommées (voir limite notée au §2) :
-- select conrelid::regclass as table_name, conname as constraint_name,
--        pg_get_constraintdef(oid) as definition
-- from pg_constraint
-- where connamespace = 'public'::regnamespace and contype = 'c'
--   and conname not like '%\_not\_null'
-- order by table_name, conname;
