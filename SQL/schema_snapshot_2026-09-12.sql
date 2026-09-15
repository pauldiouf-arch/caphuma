-- ============================================================================
-- schema_snapshot_2026-09-12.sql
-- ----------------------------------------------------------------------------
-- Instantané complet du schéma Postgres de Cap Huma (projet Supabase),
-- généré le 12/09/2026.
--
-- Ce fichier N'EST PAS un script à exécuter : c'est une PHOTO fidèle de
-- l'état réel de la base à cette date (colonnes, contraintes, RLS, policies,
-- GRANT, fonctions, triggers, index), extraite directement depuis l'éditeur
-- SQL Supabase (information_schema / pg_catalog), via la requête combinée
-- unique reproduite en fin de fichier (§10) — voir aussi
-- sql/GUIDE_INSTANTANE_SCHEMA.md pour la procédure complète (sans CLI ni
-- build, copier-coller pur dans l'éditeur SQL Supabase).
--
-- Remplace schema_snapshot_2026-08-18.sql comme référence à jour. L'ancien
-- fichier reste dans l'historique Git, pas besoin de le supprimer.
--
-- Résumé : 11 tables, RLS activé sur les 11, 10 fonctions (7 SECURITY
-- DEFINER : is_admin, get_shared_talent, admin_revoke_user_sessions,
-- check_and_record_rate_limit, audit_missions_changes,
-- audit_share_tokens_changes, audit_talents_changes ; 3 fonctions RPC
-- "métier" STABLE non-DEFINER : get_notification_alerts,
-- get_pool_mission_counts, get_pool_talent_stats), 9 triggers (3 tables ×
-- 3 événements, audit fiable sur missions/share_tokens/talents), 45 index,
-- 4 dépendances CDN (hors sujet ici, voir Dossier §6).
--
-- Amélioration par rapport à l'instantané du 18/08/2026 : le texte exact
-- des contraintes CHECK nommées, alors non capturé (limite notée à
-- l'époque en §2), est désormais inclus ci-dessous grâce à une 9e requête
-- ajoutée à la procédure.
-- ============================================================================


-- ============================================================================
-- 1. TABLES ET COLONNES (information_schema.columns, 12/09/2026)
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
--   mission_id            uuid                       NOT NULL
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

-- ---- rate_limit_log (4 colonnes) -- déjà versionnée intégralement dans
--      create_rate_limit_log.sql — non répétée ici en détail.
--   id              bigint                     NOT NULL
--   user_id         uuid                       NOT NULL
--   function_name   text                       NOT NULL
--   created_at      timestamp with time zone   NOT NULL  default now()

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
--   id                                        uuid                       NOT NULL  default gen_random_uuid()
--   first_name                                text                       NOT NULL
--   last_name                                 text                       NOT NULL
--   email                                     text                       NULL
--   pool                                      text                       NULL      -- FK -> pools(pool_id)
--   status                                    text                       NOT NULL  default 'En attente de poste'
--   is_valid                                  boolean                    NULL      default true
--   is_red_listed                             boolean                    NULL      default false
--   experience_months_alima                   integer                    NULL      default 0
--   experience_months_humanitarian            integer                    NULL      default 0
--   number_of_alima_missions                  text                       NULL      default 'none'
--   status_history                            jsonb                      NULL      default '[]'
--   last_status_change_date                   timestamp with time zone   NULL
--   pool_integration_date                     timestamp with time zone   NULL      default now()
--   availability                              jsonb                      NULL      default '{"type": "none"}'
--   has_emergency_mission                     boolean                    NULL      default false
--   emergency_mission_comments                text                       NULL
--   has_mission_opening                       boolean                    NULL      default false
--   mission_opening_comments                  text                       NULL
--   has_mission_closure                       boolean                    NULL      default false
--   closure_mission_comments                  text                       NULL
--   intervention_contexts                     text[]                     NULL
--   intervention_zones                        text[]                     NULL
--   key_skills                                text[]                     NULL
--   has_visa                                  boolean                    NULL      default false
--   nationality                               text                       NULL
--   country_of_residence                      text                       NULL
--   education_level                           text                       NULL
--   education_specialty                       text                       NULL
--   alima_trainings                           jsonb                      NULL      default '[]'
--   last_experience_update                    timestamp with time zone   NULL
--   red_list_date                             timestamp with time zone   NULL
--   red_list_reason                           text                       NULL
--   red_list_added_by                         uuid                       NULL
--   red_list_added_by_name                    text                       NULL
--   red_list_documents                        text[]                     NULL
--   last_mission_end_date                     timestamp with time zone   NULL
--   is_currently_on_mission                   boolean                    NULL      default false
--   months_without_mission                    integer                    NULL      default 0
--   created_at                                timestamp with time zone   NULL      default now()
--   created_by                                uuid                       NULL
--   gender                                    text                       NULL
--   languages                                 text[]                     NULL
--   other_languages                           text[]                     NULL
--   current_function                          text                       NULL
--   availability_type                         text                       NULL
--   availability_months                       integer                    NULL
--   availability_date                         date                       NULL
--   project_status                            text                       NULL
--   had_alima_mission                         boolean                    NULL      default false
--   months_without_alima_mission              integer                    NULL      default 0
--   devalidation_date                         date                       NULL
--   archived_position_passages                jsonb                      NULL      default '[]'
--   devalidation_extension_until              date                       NULL
--   devalidation_extension_months             integer                    NULL
--   devalidation_extension_granted_by         uuid                       NULL
--   devalidation_extension_granted_by_name    text                       NULL
--   devalidation_extension_granted_at         timestamp with time zone   NULL

-- ---- users (6 colonnes) -----------------------------------------------------
--   id            uuid                       NOT NULL  -- FK -> auth.users(id), schéma Supabase Auth
--   name          text                       NULL
--   email         text                       NULL
--   role          text                       NULL      default 'user'  -- CHECK: 'admin'|'user'|'visitor' (texte confirmé en §2)
--   is_active     boolean                    NULL      default true
--   created_at    timestamp with time zone   NULL      default now()


-- ============================================================================
-- 2. CONTRAINTES (PK / FK / UNIQUE / CHECK) — information_schema + pg_constraint, 12/09/2026
-- ----------------------------------------------------------------------------
-- Les contraintes "NOT NULL" générées automatiquement par Postgres (noms du
-- type "2200_xxxxx_n_not_null") sont omises ici : elles font double emploi
-- avec la colonne "is_nullable" du §1, propre à chaque colonne.
--
-- Le texte exact des CHECK est désormais inclus (comble la limite notée
-- dans l'instantané du 18/08/2026).
-- ============================================================================

-- audit_logs      : PK(id) ; FK(user_id) -> users(id)
-- comments        : PK(id) ; FK(talent_id) -> talents(id) ; FK(user_id) -> users(id)
-- evaluations     : PK(id) ; FK(talent_id) -> talents(id) ; FK(mission_id) -> missions(id) ;
--                   FK(author_id) -> users(id) ;
--                   CHECK evaluations_rating_check : (rating >= 0 AND rating <= 10)
-- missions        : PK(id) ; FK(created_by) -> users(id) ; FK(occupant_id) -> talents(id) ;
--                   FK(pool) -> pools(pool_id) ; FK(future_talent_id) -> talents(id) ;
--                   CHECK missions_status_check : status IN ('occupied','recruiting','vacant')
--                   CHECK missions_contract_status_check : contract_status IN ('ongoing','renewable','ending')
--                   CHECK missions_desk_check : desk IN ('desk1','desk2','desk3','suo')
--                   CHECK missions_candidate_type_check : candidate_type IN ('expat','nat')
--                   CHECK missions_pool_level_check : pool_level IN ('mission','project')
-- notification_preferences : PK(id) ; FK(user_id) -> users(id) ; UNIQUE(user_id)
-- pool_history    : PK(id) ; FK(changed_by) -> users(id) ; FK(talent_id) -> talents(id)
-- pools           : PK(id) ; UNIQUE(pool_id) ;
--                   CHECK pools_level_check : level IN ('mission','project')
-- rate_limit_log  : PK(id) — aucune FK (choix assumé, voir create_rate_limit_log.sql)
-- share_tokens    : PK(id) ; FK(talent_id) -> talents(id) ; FK(created_by) -> users(id) ;
--                   UNIQUE(token)
-- talents         : PK(id) ; FK(red_list_added_by) -> users(id) ; FK(pool) -> pools(pool_id) ;
--                   FK(created_by) -> users(id) ;
--                   CHECK talents_status_check : status IN ('En poste ALIMA','En attente de poste',
--                     'En poste autre ONG','En poste hors humanitaire')
--                   CHECK talents_education_level_check : education_level IN ('none','bac','bac+1',
--                     'bac+2','bac+3','bac+4','bac+5','bac+6','bac+7','bac+8+')
--                   CHECK talents_availability_type_check : availability_type IS NULL OR
--                     availability_type IN ('none','notice','date','asap')
--                   CHECK talents_project_status_check : project_status IS NULL OR
--                     project_status IN ('none','opening','emergency','closure')
--                   CHECK talents_number_of_alima_missions_check : number_of_alima_missions IN
--                     ('none','one','two','three_plus')
--                   CHECK talents_number_of_missions_check : number_of_alima_missions IS NULL OR
--                     number_of_alima_missions IN ('none','one','two','three_plus')
--                   -- Toujours présentes, DEUX contraintes CHECK quasi identiques sur la même
--                   -- colonne (talents_number_of_missions_check et
--                   -- talents_number_of_alima_missions_check) — probable reliquat d'un
--                   -- renommage de colonne, non prioritaire (aucun symptôme observé).
-- users           : PK(id) ; UNIQUE(email) ; FK(id) -> auth.users(id) (schéma "auth" de
--                   Supabase, hors du schéma "public") ;
--                   CHECK users_role_check : role IN ('admin','user','visitor')


-- ============================================================================
-- 3. ROW LEVEL SECURITY — activé/désactivé par table (pg_class, 12/09/2026)
-- ============================================================================
-- Les 11 tables ont RLS ACTIVÉ, sans exception :
-- audit_logs, comments, evaluations, missions, notification_preferences,
-- pool_history, pools, rate_limit_log, share_tokens, talents, users.


-- ============================================================================
-- 4. POLICIES RLS — résumé par table (pg_policies, 12/09/2026)
-- ----------------------------------------------------------------------------
-- Inchangé dans son principe depuis le 18/08/2026 (37 policies au total,
-- même répartition). Résumé en langage clair ; texte SQL brut complet
-- disponible via la requête #3 du guide si besoin de le reproduire mot
-- pour mot.
-- ============================================================================

-- audit_logs
--   INSERT (permissive, authenticated) : chacun peut insérer sa propre action (user_id = soi)
--   SELECT (permissive, authenticated) : admin uniquement
--   (aucune policy UPDATE/DELETE : personne ne peut modifier/supprimer une ligne)

-- comments
--   SELECT (permissive) : tout connecté   |   SELECT (RESTRICTIVE, visitor exclu si talent
--     Liste Rouge/dévalidé)
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
--     Liste Rouge/dévalidé
--   INSERT (permissive) : role admin ou user
--   UPDATE (permissive) : role admin ou user
--   DELETE (permissive) : admin uniquement

-- users
--   SELECT (permissive) : soi-même, ou admin (is_admin(), toutes les lignes)
--   UPDATE (permissive) : admin (is_admin()) uniquement
--   (aucune policy INSERT/DELETE : gérées côté serveur par manage-users, service_role)


-- ============================================================================
-- 5. GRANT — autorisations par table et par rôle (role_table_grants, 12/09/2026)
-- ----------------------------------------------------------------------------
-- Motif recontrôlé aujourd'hui, inchangé depuis le 18/08/2026 : postgres et
-- service_role ont tous les privilèges ; anon et authenticated n'ont QUE
-- REFERENCES/TRIGGER par défaut ; authenticated reçoit en plus SELECT/
-- INSERT/UPDATE/DELETE explicitement là où l'app doit écrire (le filtrage
-- fin reste à la charge des policies RLS du §4). Aucune anomalie trouvée.
-- ============================================================================

-- Table                      | anon                | authenticated                          | service_role (au-delà des défauts)
-- ---------------------------|----------------------|------------------------------------------|-------------------------------------
-- audit_logs                 | REFERENCES, TRIGGER  | +INSERT, SELECT                          | +DELETE, INSERT, SELECT, UPDATE
-- comments                   | REFERENCES, TRIGGER  | +DELETE, INSERT, SELECT, UPDATE          | +DELETE, INSERT, SELECT, UPDATE
-- evaluations                | (aucun accès direct) | DELETE, INSERT, SELECT, UPDATE (+défauts)| +DELETE, INSERT, SELECT, UPDATE
-- missions                   | (aucun accès direct) | DELETE, INSERT, SELECT, UPDATE (+défauts)| +DELETE, INSERT, SELECT, UPDATE
-- notification_preferences   | REFERENCES, TRIGGER  | +INSERT, SELECT, UPDATE                  | aucun au-delà des défauts
-- pool_history                | (aucun accès direct) | INSERT, SELECT (+défauts)                | +DELETE, INSERT, SELECT, UPDATE
-- pools                      | (aucun accès direct) | DELETE, INSERT, SELECT, UPDATE (+défauts)| +DELETE, INSERT, SELECT, UPDATE
-- rate_limit_log             | REFERENCES, TRIGGER  | REFERENCES, TRIGGER (aucun accès direct) | +DELETE, INSERT, SELECT (pas UPDATE)
-- share_tokens                | (aucun accès direct) | DELETE, INSERT, SELECT, UPDATE (+défauts)| +DELETE, INSERT, SELECT, UPDATE
-- talents                    | (aucun accès direct) | DELETE, INSERT, SELECT, UPDATE (+défauts)| +DELETE, INSERT, SELECT, UPDATE
-- users                      | (aucun accès direct) | SELECT, UPDATE (+défauts, pas INSERT/DELETE) | +DELETE, INSERT, SELECT, UPDATE

-- (postgres, propriétaire du schéma, a systématiquement tous les privilèges
-- sur les 11 tables — omis ligne par ligne ci-dessus pour la lisibilité.)


-- ============================================================================
-- 6. FONCTIONS DU SCHÉMA PUBLIC (pg_proc, 12/09/2026) — code source complet
-- ----------------------------------------------------------------------------
-- 10 fonctions (5 de plus qu'au 18/08/2026 : les 3 triggers d'audit
-- versionnés séparément dans sql/, plus admin_revoke_user_sessions et
-- check_and_record_rate_limit, toutes déjà documentées dans le Dossier
-- technique §5.2/§5.4bis).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    delete from auth.refresh_tokens
    where user_id::text = target_user_id::text;

    delete from auth.sessions
    where user_id::text = target_user_id::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.audit_missions_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid := auth.uid();
    v_user_email text;
    v_user_name text;
    v_action text;
    v_entity_id text;
    v_entity_name text;
begin
    select email, name into v_user_email, v_user_name
    from public.users where id = v_user_id;

    if TG_OP = 'INSERT' then
        v_action := 'create';
        v_entity_id := NEW.id::text;
        v_entity_name := NEW.title;
    elsif TG_OP = 'UPDATE' then
        v_action := 'update';
        v_entity_id := NEW.id::text;
        v_entity_name := NEW.title;
    elsif TG_OP = 'DELETE' then
        v_action := 'delete';
        v_entity_id := OLD.id::text;
        v_entity_name := OLD.title;
    end if;

    insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
    values (v_user_id, v_user_email, v_user_name, v_action, 'mission', v_entity_id, v_entity_name, null);

    return coalesce(NEW, OLD);
end;
$function$;

CREATE OR REPLACE FUNCTION public.audit_share_tokens_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid := auth.uid();
    v_user_email text;
    v_user_name text;
    v_action text;
    v_entity_id text;
    v_entity_name text;
    v_details text;
begin
    select email, name into v_user_email, v_user_name
    from public.users where id = v_user_id;

    if TG_OP = 'INSERT' then
        v_action := 'create';
        v_entity_id := NEW.id::text;
        select first_name || ' ' || last_name into v_entity_name from public.talents where id = NEW.talent_id;
        v_details := null;
    elsif TG_OP = 'UPDATE' then
        v_action := 'update';
        v_entity_id := NEW.id::text;
        select first_name || ' ' || last_name into v_entity_name from public.talents where id = NEW.talent_id;
        if NEW.is_revoked = true and coalesce(OLD.is_revoked, false) = false then
            v_details := 'Révocation manuelle d''un lien de partage';
        else
            v_details := null;
        end if;
    elsif TG_OP = 'DELETE' then
        v_action := 'delete';
        v_entity_id := OLD.id::text;
        select first_name || ' ' || last_name into v_entity_name from public.talents where id = OLD.talent_id;
        v_details := null;
    end if;

    insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
    values (v_user_id, v_user_email, v_user_name, v_action, 'share_link', v_entity_id, v_entity_name, v_details);

    return coalesce(NEW, OLD);
end;
$function$;

CREATE OR REPLACE FUNCTION public.audit_talents_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid := auth.uid();
    v_user_email text;
    v_user_name text;
    v_action text;
    v_entity_id text;
    v_entity_name text;
    v_details text;
begin
    select email, name into v_user_email, v_user_name
    from public.users where id = v_user_id;

    if TG_OP = 'INSERT' then
        v_action := 'create';
        v_entity_id := NEW.id::text;
        v_entity_name := NEW.first_name || ' ' || NEW.last_name;
        v_details := 'Pool : ' || coalesce(NEW.pool, '');

    elsif TG_OP = 'DELETE' then
        v_action := 'delete';
        v_entity_id := OLD.id::text;
        v_entity_name := OLD.first_name || ' ' || OLD.last_name;
        v_details := case when coalesce(OLD.is_valid, true) = false
                           then 'Suppression RGPD (talent dévalidé)'
                           else 'Suppression RGPD (talent actif)'
                      end;

    elsif TG_OP = 'UPDATE' then
        v_entity_id := NEW.id::text;
        v_entity_name := NEW.first_name || ' ' || NEW.last_name;

        if NEW.is_red_listed = true and coalesce(OLD.is_red_listed, false) = false then
            v_action := 'add_to_red_list';
            v_details := NEW.red_list_reason;

        elsif coalesce(OLD.is_red_listed, false) = true and coalesce(NEW.is_red_listed, false) = false then
            v_action := 'remove_from_red_list';
            v_details := null;

        elsif NEW.is_valid = false and coalesce(OLD.is_valid, true) = true then
            v_action := 'devalidate';
            v_details := null;

        elsif coalesce(OLD.is_valid, true) = false and coalesce(NEW.is_valid, true) = true then
            v_action := 'reintegrate';
            v_details := null;

        elsif NEW.devalidation_extension_until is not null
              and NEW.devalidation_extension_until is distinct from OLD.devalidation_extension_until then
            v_action := 'update';
            v_details := 'Prolongation de validité accordée : ' || coalesce(NEW.devalidation_extension_months::text, '?') || ' mois';

        elsif NEW.pool is distinct from OLD.pool then
            v_action := 'update';
            v_details := 'Changement de pool : ' || coalesce(OLD.pool, '—') || ' → ' || coalesce(NEW.pool, '—');

        else
            v_action := 'update';
            v_details := null;
        end if;
    end if;

    insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
    values (v_user_id, v_user_email, v_user_name, v_action, 'talent', v_entity_id, v_entity_name, v_details);

    return coalesce(NEW, OLD);
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_and_record_rate_limit(p_user_id uuid, p_function_name text, p_window_minutes integer, p_max_calls integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_function_name));

  delete from public.rate_limit_log
  where created_at < now() - interval '1 hour';

  select count(*) into v_count
  from public.rate_limit_log
  where user_id = p_user_id
    and function_name = p_function_name
    and created_at >= now() - (p_window_minutes || ' minutes')::interval;

  if v_count >= p_max_calls then
    return false;
  end if;

  insert into public.rate_limit_log (user_id, function_name)
  values (p_user_id, p_function_name);

  return true;
end;
$function$;

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

    UPDATE public.share_tokens
    SET view_count = COALESCE(view_count, 0) + 1,
        last_viewed_at = now()
    WHERE token = p_token;

    SELECT jsonb_build_object(
        'title', m.title,
        'country', m.country,
        'contract_start_date', m.contract_start_date
    ) INTO v_mission
    FROM public.missions m
    WHERE m.occupant_id = v_link.talent_id
    AND m.status = 'occupied'
    ORDER BY m.contract_start_date DESC NULLS LAST
    LIMIT 1;

    RETURN jsonb_build_object('talent', v_talent, 'mission', v_mission);
END;
$function$;

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


-- ============================================================================
-- 7. TRIGGERS (information_schema.triggers, 12/09/2026)
-- ----------------------------------------------------------------------------
-- 9 triggers = 3 tables (missions, share_tokens, talents) × 3 événements
-- (INSERT/UPDATE/DELETE), chacun appelant sa fonction d'audit dédiée du §6.
-- ============================================================================

-- missions      -> trg_audit_missions      (AFTER INSERT/UPDATE/DELETE) -> audit_missions_changes()
-- share_tokens  -> trg_audit_share_tokens  (AFTER INSERT/UPDATE/DELETE) -> audit_share_tokens_changes()
-- talents       -> trg_audit_talents       (AFTER INSERT/UPDATE/DELETE) -> audit_talents_changes()


-- ============================================================================
-- 8. NOTE — pas d'anomalie trouvée en produisant cet instantané
-- ----------------------------------------------------------------------------
-- Contrairement à l'instantané du 18/08/2026 (qui avait relevé un écart de
-- documentation, voir Dossier technique §5.4), rien d'inattendu n'est
-- ressorti cette fois. Seul changement notable : le texte exact des CHECK
-- est désormais capturé (§2), fermant la limite connue signalée alors.
-- ============================================================================


-- ============================================================================
-- 9. INDEX (pg_indexes, 12/09/2026) — 45 index au total sur les 11 tables
-- ============================================================================

-- audit_logs
--   audit_logs_pkey (UNIQUE, btree(id))
--   idx_audit_logs_created_at (btree(created_at))
--   idx_audit_logs_user_id (btree(user_id))

-- comments
--   comments_pkey (UNIQUE, btree(id))
--   idx_comments_talent_id (btree(talent_id))
--   idx_comments_user_id (btree(user_id))

-- evaluations
--   evaluations_pkey (UNIQUE, btree(id))
--   idx_evaluations_author_id (btree(author_id))
--   idx_evaluations_mission_id (btree(mission_id))
--   idx_evaluations_talent_id (btree(talent_id))

-- missions
--   missions_pkey (UNIQUE, btree(id))
--   idx_missions_created_by (btree(created_by))
--   idx_missions_future_talent_id (btree(future_talent_id))
--   idx_missions_occupant_id (btree(occupant_id))
--   idx_missions_pool (btree(pool))
--   idx_missions_status (btree(status))

-- notification_preferences
--   notification_preferences_pkey (UNIQUE, btree(id))
--   notification_preferences_user_id_key (UNIQUE, btree(user_id))

-- pool_history
--   pool_history_pkey (UNIQUE, btree(id))
--   idx_pool_history_changed_by (btree(changed_by))
--   pool_history_talent_id_idx (btree(talent_id))

-- pools
--   pools_pkey (UNIQUE, btree(id))
--   pools_pool_id_key (UNIQUE, btree(pool_id))
--   idx_pools_is_archived (btree(is_archived))
--   idx_pools_pool_id (btree(pool_id))

-- rate_limit_log
--   rate_limit_log_pkey (UNIQUE, btree(id))
--   rate_limit_log_lookup_idx (btree(user_id, function_name, created_at))

-- share_tokens
--   shared_links_pkey (UNIQUE, btree(id))
--   shared_links_token_key (UNIQUE, btree(token))
--   idx_share_tokens_created_by (btree(created_by))
--   idx_share_tokens_talent_id (btree(talent_id))
--   idx_shared_links_token (btree(token))

-- talents
--   talents_pkey (UNIQUE, btree(id))
--   idx_talents_devalidation_date (btree(devalidation_date))
--   idx_talents_is_red_listed (btree(is_red_listed))
--   idx_talents_is_valid (btree(is_valid))
--   idx_talents_months_without_mission (btree(months_without_mission))
--   idx_talents_pool (btree(pool))
--   idx_talents_pool_is_valid (btree(pool, is_valid))
--   idx_talents_red_list_added_by (btree(red_list_added_by))
--   talents_created_by_idx (btree(created_by))
--   talents_education_level_idx (btree(education_level))
--   talents_nationality_idx (btree(nationality))
--   talents_number_of_alima_missions_idx (btree(number_of_alima_missions))
--   talents_status_idx (btree(status))

-- users
--   users_pkey (UNIQUE, btree(id))
--   users_email_key (UNIQUE, btree(email))
--   idx_users_email (btree(email))


-- ============================================================================
-- 10. REQUÊTE UTILISÉE POUR PRODUIRE CET INSTANTANÉ (lecture seule)
-- ----------------------------------------------------------------------------
-- Une seule requête combinée (JSON), voir sql/GUIDE_INSTANTANE_SCHEMA.md
-- pour son texte complet et pour les 9 requêtes séparées de repli.
-- ============================================================================
