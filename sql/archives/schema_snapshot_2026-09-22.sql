-- ============================================================================
-- schema_snapshot_2026-09-22.sql
-- ----------------------------------------------------------------------------
-- Instantané complet du schéma Postgres de Cap Huma (projet Supabase), généré le 22/09/2026
-- à partir de la requête combinée de sql/GUIDE_INSTANTANE_SCHEMA.md, exécutée par l'utilisateur
-- dans l'éditeur SQL Supabase. Remplace schema_snapshot_2026-09-19.sql comme référence.
--
-- Résumé : 12 tables (+1 : client_error_logs), RLS activé sur les 12, 39 policies (+2),
-- 12 fonctions applicatives dont 8 SECURITY DEFINER, 4 triggers (11 déclencheurs par événement),
-- 53 index (+3), 22 clés étrangères désormais relevées avec leur règle ON DELETE.
--
-- Écarts par rapport au 19/09/2026 (détail en §8) :
--   1. Nouvelle table client_error_logs, avec ses 2 policies, ses 2 index et ses droits
--      (sql/create_client_error_logs.sql, sql/client_error_logs_grants.sql).
--   2. Règles de suppression corrigées : client_error_logs.user_id, pool_history.changed_by et
--      comments.user_id passent en ON DELETE SET NULL ; comments.user_id devient nullable
--      (sql/users_fk_on_delete.sql).
--   3. Fonction get_validity_thresholds() présente en base, absente de l'instantané du 19/09
--      et de toute la documentation.
-- ============================================================================

-- ============================================================================
-- 1. TABLES ET COLONNES (information_schema.columns, 22/09/2026)
-- ============================================================================

-- ---- audit_logs (10 colonnes) --------------------------------------------------
--   id           uuid                      NOT NULL  default gen_random_uuid()
--   user_id      uuid                      NULL
--   user_email   text                      NULL
--   user_name    text                      NULL
--   action       text                      NOT NULL
--   entity_type  text                      NOT NULL
--   entity_id    text                      NULL
--   entity_name  text                      NULL
--   details      text                      NULL
--   created_at   timestamp with time zone  NULL      default now()

-- ---- client_error_logs (7 colonnes) -------------------------------------------
--   id          uuid                      NOT NULL  default gen_random_uuid()
--   created_at  timestamp with time zone  NULL      default now()
--   kind        text                      NOT NULL
--   detail      text                      NULL
--   page        text                      NULL
--   user_id     uuid                      NULL
--   user_email  text                      NULL

-- ---- comments (6 colonnes) ----------------------------------------------------
--   id            uuid                      NOT NULL  default gen_random_uuid()
--   talent_id     uuid                      NOT NULL
--   user_id       uuid                      NULL
--   content       text                      NOT NULL
--   created_at    timestamp with time zone  NULL      default now()
--   author_email  text                      NULL

-- ---- evaluations (15 colonnes) -------------------------------------------------
--   id                   uuid                      NOT NULL  default gen_random_uuid()
--   mission_id           uuid                      NOT NULL
--   talent_id            uuid                      NOT NULL
--   author_id            uuid                      NULL
--   context              text                      NOT NULL
--   positive_points      text                      NULL
--   negative_points      text                      NULL
--   rating               integer                   NULL
--   legacy_content       text                      NULL
--   is_archived          boolean                   NULL      default false
--   created_at           timestamp with time zone  NULL      default now()
--   author_email         text                      NULL
--   comment_text         text                      NULL
--   is_moderated         boolean                   NULL      default false
--   is_red_list_trigger  boolean                   NULL      default false

-- ---- missions (26 colonnes) ----------------------------------------------------
--   id                            uuid                      NOT NULL  default gen_random_uuid()
--   title                         text                      NOT NULL
--   pool                          text                      NULL
--   pool_level                    text                      NOT NULL
--   country                       text                      NULL
--   location                      text                      NOT NULL
--   project_name                  text                      NULL
--   candidate_type                text                      NULL
--   desk                          text                      NULL
--   status                        text                      NOT NULL  default 'vacant'::text
--   occupant_id                   uuid                      NULL
--   contract_start_date           timestamp with time zone  NULL
--   contract_end_date             timestamp with time zone  NULL
--   contract_status               text                      NULL
--   future_talent_id              uuid                      NULL
--   future_contract_start_date    timestamp with time zone  NULL
--   future_contract_end_date      timestamp with time zone  NULL
--   created_at                    timestamp with time zone  NULL      default now()
--   created_by                    uuid                      NULL
--   pool_id                       text                      NULL
--   is_expat                      boolean                   NULL      default true
--   current_occupant_id           uuid                      NULL
--   future_occupant_id            uuid                      NULL
--   contract_end_type             text                      NOT NULL  default 'date'::text
--   detachment_source_mission_id  uuid                      NULL
--   country_code                  text                      NULL

-- ---- notification_preferences (5 colonnes) ------------------------------------
--   id          uuid                      NOT NULL  default gen_random_uuid()
--   user_id     uuid                      NOT NULL
--   enabled     boolean                   NOT NULL  default true
--   pool_scope  ARRAY                     NULL
--   updated_at  timestamp with time zone  NOT NULL  default now()

-- ---- pool_history (7 colonnes) ------------------------------------------------
--   id               uuid                      NOT NULL  default gen_random_uuid()
--   talent_id        uuid                      NOT NULL
--   from_pool        text                      NULL
--   to_pool          text                      NOT NULL
--   changed_at       timestamp with time zone  NOT NULL  default now()
--   changed_by       uuid                      NULL
--   changed_by_name  text                      NULL

-- ---- pools (12 colonnes) -------------------------------------------------------
--   id                uuid                      NOT NULL  default gen_random_uuid()
--   pool_id           text                      NOT NULL
--   name              text                      NOT NULL
--   full_name         text                      NOT NULL
--   level             text                      NOT NULL
--   description       text                      NULL
--   color             text                      NULL
--   is_active         boolean                   NULL      default true
--   created_at        timestamp with time zone  NULL      default now()
--   is_archived       boolean                   NOT NULL  default false
--   archived_at       timestamp with time zone  NULL
--   archived_by_name  text                      NULL

-- ---- rate_limit_log (4 colonnes) ----------------------------------------------
--   id             bigint                    NOT NULL
--   user_id        uuid                      NOT NULL
--   function_name  text                      NOT NULL
--   created_at     timestamp with time zone  NOT NULL  default now()

-- ---- share_tokens (10 colonnes) ------------------------------------------------
--   id               uuid                      NOT NULL  default gen_random_uuid()
--   token            text                      NOT NULL
--   talent_id        uuid                      NOT NULL
--   created_by       uuid                      NOT NULL
--   expires_at       timestamp with time zone  NULL
--   is_revoked       boolean                   NULL      default false
--   view_count       integer                   NULL      default 0
--   last_viewed_at   timestamp with time zone  NULL
--   created_at       timestamp with time zone  NULL      default now()
--   created_by_name  text                      NULL

-- ---- talents (62 colonnes) -----------------------------------------------------
--   id                                      uuid                      NOT NULL  default gen_random_uuid()
--   first_name                              text                      NOT NULL
--   last_name                               text                      NOT NULL
--   email                                   text                      NULL
--   pool                                    text                      NULL
--   status                                  text                      NOT NULL  default 'En attente de poste'::text
--   is_valid                                boolean                   NULL      default true
--   is_red_listed                           boolean                   NULL      default false
--   experience_months_alima                 integer                   NULL      default 0
--   experience_months_humanitarian          integer                   NULL      default 0
--   number_of_alima_missions                text                      NULL      default 'none'::text
--   status_history                          jsonb                     NULL      default '[]'::jsonb
--   last_status_change_date                 timestamp with time zone  NULL
--   pool_integration_date                   timestamp with time zone  NULL      default now()
--   availability                            jsonb                     NULL      default '{"type": "none"}'::jsonb
--   has_emergency_mission                   boolean                   NULL      default false
--   emergency_mission_comments              text                      NULL
--   has_mission_opening                     boolean                   NULL      default false
--   mission_opening_comments                text                      NULL
--   has_mission_closure                     boolean                   NULL      default false
--   closure_mission_comments                text                      NULL
--   intervention_contexts                   ARRAY                     NULL
--   intervention_zones                      ARRAY                     NULL
--   key_skills                              ARRAY                     NULL
--   has_visa                                boolean                   NULL      default false
--   nationality                             text                      NULL
--   country_of_residence                    text                      NULL
--   education_level                         text                      NULL
--   education_specialty                     text                      NULL
--   alima_trainings                         jsonb                     NULL      default '[]'::jsonb
--   last_experience_update                  timestamp with time zone  NULL
--   red_list_date                           timestamp with time zone  NULL
--   red_list_reason                         text                      NULL
--   red_list_added_by                       uuid                      NULL
--   red_list_added_by_name                  text                      NULL
--   red_list_documents                      ARRAY                     NULL
--   last_mission_end_date                   timestamp with time zone  NULL
--   is_currently_on_mission                 boolean                   NULL      default false
--   months_without_mission                  integer                   NULL      default 0
--   created_at                              timestamp with time zone  NULL      default now()
--   created_by                              uuid                      NULL
--   gender                                  text                      NULL
--   languages                               ARRAY                     NULL
--   other_languages                         ARRAY                     NULL
--   current_function                        text                      NULL
--   availability_type                       text                      NULL
--   availability_months                     integer                   NULL
--   availability_date                       date                      NULL
--   project_status                          text                      NULL
--   had_alima_mission                       boolean                   NULL      default false
--   months_without_alima_mission            integer                   NULL      default 0
--   devalidation_date                       date                      NULL
--   archived_position_passages              jsonb                     NULL      default '[]'::jsonb
--   devalidation_extension_until            date                      NULL
--   devalidation_extension_months           integer                   NULL
--   devalidation_extension_granted_by       uuid                      NULL
--   devalidation_extension_granted_by_name  text                      NULL
--   devalidation_extension_granted_at       timestamp with time zone  NULL
--   staff_type                              text                      NOT NULL  default 'expat'::text
--   national_inactive_since                 date                      NULL
--   nationality_code                        text                      NULL
--   tracking_pool                           text                      NULL

-- ---- users (6 colonnes) -------------------------------------------------------
--   id          uuid                      NOT NULL
--   name        text                      NULL
--   email       text                      NULL
--   role        text                      NULL      default 'user'::text
--   is_active   boolean                   NULL      default true
--   created_at  timestamp with time zone  NULL      default now()


-- ============================================================================
-- 2. CONTRAINTES (pg_constraint, 22/09/2026)
-- ----------------------------------------------------------------------------
-- Contraintes NOT NULL automatiques omises (voir §1).
-- Clés étrangères reproduites avec leur texte exact, règle ON DELETE comprise.
-- ============================================================================

-- audit_logs
--   PK(id)
--   FK audit_logs_user_id_fkey : FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL

-- client_error_logs
--   PK(id)
--   FK client_error_logs_user_id_fkey : FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL

-- comments
--   PK(id)
--   FK comments_talent_id_fkey : FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE
--   FK comments_user_id_fkey : FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL

-- evaluations
--   PK(id)
--   FK evaluations_author_id_fkey : FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
--   FK evaluations_mission_id_fkey : FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
--   FK evaluations_talent_id_fkey : FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE
--   CHECK evaluations_rating_check : CHECK (((rating >= 0) AND (rating <= 10)))

-- missions
--   PK(id)
--   FK missions_created_by_fkey : FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
--   FK missions_detachment_source_mission_id_fkey : FOREIGN KEY (detachment_source_mission_id) REFERENCES missions(id) ON DELETE SET NULL
--   FK missions_future_talent_id_fkey : FOREIGN KEY (future_talent_id) REFERENCES talents(id) ON DELETE SET NULL
--   FK missions_occupant_id_fkey : FOREIGN KEY (occupant_id) REFERENCES talents(id) ON DELETE SET NULL
--   FK missions_pool_fkey : FOREIGN KEY (pool) REFERENCES pools(pool_id) ON DELETE SET NULL
--   CHECK missions_candidate_type_check : CHECK ((candidate_type = ANY (ARRAY['expat'::text, 'nat'::text, 'detache'::text])))
--   CHECK missions_contract_end_type_check : CHECK ((contract_end_type = ANY (ARRAY['date'::text, 'cdi'::text, 'ongoing'::text])))
--   CHECK missions_contract_status_check : CHECK ((contract_status = ANY (ARRAY['ongoing'::text, 'renewable'::text, 'ending'::text])))
--   CHECK missions_desk_check : CHECK ((desk = ANY (ARRAY['desk1'::text, 'desk2'::text, 'desk3'::text, 'suo'::text])))
--   CHECK missions_pool_level_check : CHECK ((pool_level = ANY (ARRAY['mission'::text, 'project'::text])))
--   CHECK missions_status_check : CHECK ((status = ANY (ARRAY['occupied'::text, 'recruiting'::text, 'vacant'::text])))

-- notification_preferences
--   PK(id)
--   UNIQUE(user_id)
--   FK notification_preferences_user_id_fkey : FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

-- pool_history
--   PK(id)
--   FK pool_history_changed_by_fkey : FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
--   FK pool_history_talent_id_fkey : FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE

-- pools
--   PK(id)
--   UNIQUE(pool_id)
--   CHECK pools_level_check : CHECK ((level = ANY (ARRAY['mission'::text, 'project'::text])))

-- rate_limit_log
--   PK(id)

-- share_tokens
--   PK(id)
--   UNIQUE(token)
--   FK shared_links_created_by_fkey : FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
--   FK shared_links_talent_id_fkey : FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE

-- talents
--   PK(id)
--   FK talents_created_by_fkey : FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
--   FK talents_pool_fkey : FOREIGN KEY (pool) REFERENCES pools(pool_id) ON DELETE SET NULL
--   FK talents_red_list_added_by_fkey : FOREIGN KEY (red_list_added_by) REFERENCES users(id) ON DELETE SET NULL
--   FK talents_tracking_pool_fkey : FOREIGN KEY (tracking_pool) REFERENCES pools(pool_id)
--   CHECK talents_availability_type_check : CHECK (((availability_type IS NULL) OR (availability_type = ANY (ARRAY['none'::text, 'notice'::text, 'date'::text, 'asap'::text]))))
--   CHECK talents_education_level_check : CHECK ((education_level = ANY (ARRAY['none'::text, 'bac'::text, 'bac+1'::text, 'bac+2'::text, 'bac+3'::text, 'bac+4'::text, 'bac+5'::text, 'bac+6'::text, 'bac+7'::text, 'bac+8+'::text])))
--   CHECK talents_number_of_alima_missions_check : CHECK ((number_of_alima_missions = ANY (ARRAY['none'::text, 'one'::text, 'two'::text, 'three_plus'::text])))
--   CHECK talents_number_of_missions_check : CHECK (((number_of_alima_missions IS NULL) OR (number_of_alima_missions = ANY (ARRAY['none'::text, 'one'::text, 'two'::text, 'three_plus'::text]))))
--   CHECK talents_project_status_check : CHECK (((project_status IS NULL) OR (project_status = ANY (ARRAY['none'::text, 'opening'::text, 'emergency'::text, 'closure'::text]))))
--   CHECK talents_staff_type_check : CHECK ((staff_type = ANY (ARRAY['expat'::text, 'national'::text])))
--   CHECK talents_status_check : CHECK ((status = ANY (ARRAY['En poste ALIMA'::text, 'En attente de poste'::text, 'En poste autre ONG'::text, 'En poste hors humanitaire'::text])))

-- users
--   PK(id)
--   UNIQUE(email)
--   FK users_id_fkey : FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
--   CHECK users_role_check : CHECK ((role = ANY (ARRAY['admin'::text, 'user'::text, 'visitor'::text])))


-- ============================================================================
-- 3. ROW LEVEL SECURITY (pg_class, 22/09/2026)
-- ============================================================================

--   audit_logs                 RLS activé
--   client_error_logs          RLS activé
--   comments                   RLS activé
--   evaluations                RLS activé
--   missions                   RLS activé
--   notification_preferences   RLS activé
--   pool_history               RLS activé
--   pools                      RLS activé
--   rate_limit_log             RLS activé
--   share_tokens               RLS activé
--   talents                    RLS activé
--   users                      RLS activé
--   rate_limit_log : RLS activé sans policy, volontairement (accès service_role uniquement).

-- ============================================================================
-- 4. POLICIES RLS (pg_policies, 22/09/2026) — texte exact
-- ============================================================================

-- audit_logs
--   audit_logs_insert_own_action : INSERT, PERMISSIVE, rôles authenticated
--     with check (( SELECT auth.uid() AS uid) = user_id)
--   audit_logs_select_admin_only : SELECT, PERMISSIVE, rôles authenticated
--     using      (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text))))

-- client_error_logs
--   Admin can read error logs : SELECT, PERMISSIVE, rôles authenticated
--     using      is_admin()
--   Insert own error log : INSERT, PERMISSIVE, rôles authenticated
--     with check (user_id = auth.uid())

-- comments
--   comments_delete_admin_or_owner : DELETE, PERMISSIVE, rôles authenticated
--     using      ((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))) OR ((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'user'::text))))))
--   comments_insert_admin_user : INSERT, PERMISSIVE, rôles authenticated
--     with check ((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::text, 'user'::text]))))))
--   comments_select_all_connected : SELECT, PERMISSIVE, rôles authenticated
--     using      true
--   comments_select_restrict_visitor_sensitive_rows : SELECT, RESTRICTIVE, rôles authenticated
--     using      ((( SELECT users.role FROM users WHERE (users.id = ( SELECT auth.uid() AS uid))) IS DISTINCT FROM 'visitor'::text) OR ((talent_id IS NULL) OR (EXISTS ( SELECT 1 FROM talents t WHERE ((t.id = comments.talent_id) AND (COALESCE(t.is_red_listed, false) = false) AND (COALESCE(t.is_valid, true) = true))))))
--   comments_update_admin_or_owner : UPDATE, PERMISSIVE, rôles authenticated
--     using      ((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))) OR ((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'user'::text))))))
--     with check ((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))) OR ((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'user'::text))))))

-- evaluations
--   evaluations_delete_own_or_admin : DELETE, PERMISSIVE, rôles authenticated
--     using      ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))) OR ((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'user'::text))))))
--   evaluations_insert_own : INSERT, PERMISSIVE, rôles authenticated
--     with check ((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text]))))))
--   evaluations_select_authenticated : SELECT, PERMISSIVE, rôles authenticated
--     using      true
--   evaluations_select_restrict_visitor_sensitive_rows : SELECT, RESTRICTIVE, rôles authenticated
--     using      ((( SELECT users.role FROM users WHERE (users.id = ( SELECT auth.uid() AS uid))) IS DISTINCT FROM 'visitor'::text) OR ((talent_id IS NULL) OR (EXISTS ( SELECT 1 FROM talents t WHERE ((t.id = evaluations.talent_id) AND (COALESCE(t.is_red_listed, false) = false) AND (COALESCE(t.is_valid, true) = true))))))
--   evaluations_update_own_or_admin : UPDATE, PERMISSIVE, rôles authenticated
--     using      ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))) OR ((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'user'::text))))))
--     with check ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))) OR ((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'user'::text))))))

-- missions
--   missions_delete_admin_user : DELETE, PERMISSIVE, rôles authenticated
--     using      (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text])))))
--   missions_insert_admin_user : INSERT, PERMISSIVE, rôles authenticated
--     with check (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text])))))
--   missions_select_authenticated : SELECT, PERMISSIVE, rôles authenticated
--     using      true
--   missions_update_admin_user : UPDATE, PERMISSIVE, rôles authenticated
--     using      (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text])))))
--     with check (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text])))))

-- notification_preferences
--   notification_preferences_insert_own : INSERT, PERMISSIVE, rôles authenticated
--     with check (user_id = ( SELECT auth.uid() AS uid))
--   notification_preferences_select_own : SELECT, PERMISSIVE, rôles authenticated
--     using      (user_id = ( SELECT auth.uid() AS uid))
--   notification_preferences_update_own : UPDATE, PERMISSIVE, rôles authenticated
--     using      (user_id = ( SELECT auth.uid() AS uid))
--     with check (user_id = ( SELECT auth.uid() AS uid))

-- pool_history
--   pool_history_insert_admin_user : INSERT, PERMISSIVE, rôles authenticated
--     with check (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text])))))
--   pool_history_select_authenticated : SELECT, PERMISSIVE, rôles authenticated
--     using      true

-- pools
--   pools_delete_admin : DELETE, PERMISSIVE, rôles authenticated
--     using      (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text))))
--   pools_insert_admin : INSERT, PERMISSIVE, rôles authenticated
--     with check (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text))))
--   pools_select_authenticated : SELECT, PERMISSIVE, rôles authenticated
--     using      true
--   pools_update_admin : UPDATE, PERMISSIVE, rôles authenticated
--     using      (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text))))
--     with check (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text))))

-- share_tokens
--   share_tokens_delete_admin : DELETE, PERMISSIVE, rôles authenticated
--     using      ( SELECT is_admin() AS is_admin)
--   share_tokens_insert_admin_user : INSERT, PERMISSIVE, rôles authenticated
--     with check ((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text]))))))
--   share_tokens_select_own_or_admin : SELECT, PERMISSIVE, rôles authenticated
--     using      (( SELECT is_admin() AS is_admin) OR (created_by = ( SELECT auth.uid() AS uid)))
--   share_tokens_update_admin_or_creator : UPDATE, PERMISSIVE, rôles authenticated
--     using      (is_admin() OR (created_by = ( SELECT auth.uid() AS uid)))
--     with check (is_admin() OR (created_by = ( SELECT auth.uid() AS uid)))

-- talents
--   talents_delete_admin_only : DELETE, PERMISSIVE, rôles authenticated
--     using      (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text))))
--   talents_insert_admin_user : INSERT, PERMISSIVE, rôles authenticated
--     with check (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::text, 'user'::text])))))
--   talents_select_all_connected : SELECT, PERMISSIVE, rôles authenticated
--     using      true
--   talents_select_restrict_visitor_sensitive_rows : SELECT, RESTRICTIVE, rôles authenticated
--     using      ((( SELECT users.role FROM users WHERE (users.id = ( SELECT auth.uid() AS uid))) IS DISTINCT FROM 'visitor'::text) OR ((COALESCE(is_red_listed, false) = false) AND (COALESCE(is_valid, true) = true)))
--   talents_update_admin_user : UPDATE, PERMISSIVE, rôles authenticated
--     using      (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::text, 'user'::text])))))
--     with check (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::text, 'user'::text])))))

-- users
--   users_can_read_own_profile : SELECT, PERMISSIVE, rôles authenticated
--     using      (( SELECT auth.uid() AS uid) = id)
--   users_select_admin_all : SELECT, PERMISSIVE, rôles authenticated
--     using      ( SELECT is_admin() AS is_admin)
--   users_update_admin_all : UPDATE, PERMISSIVE, rôles authenticated
--     using      ( SELECT is_admin() AS is_admin)
--     with check ( SELECT is_admin() AS is_admin)


-- ============================================================================
-- 5. GRANT (role_table_grants, 22/09/2026)
-- ----------------------------------------------------------------------------
-- postgres, propriétaire, a tous les privilèges sur toutes les tables : omis ci-dessous.
-- REFERENCES, TRIGGER et TRUNCATE, présents par défaut, sont omis pour la lisibilité.
-- ============================================================================

-- Table                      | anon                         | authenticated                | service_role
-- audit_logs                 | -                            | INSERT, SELECT               | DELETE, INSERT, SELECT, UPDATE
-- client_error_logs          | -                            | INSERT, SELECT               | DELETE, SELECT
-- comments                   | -                            | DELETE, INSERT, SELECT, UPDATE | DELETE, INSERT, SELECT, UPDATE
-- evaluations                | -                            | DELETE, INSERT, SELECT, UPDATE | DELETE, INSERT, SELECT, UPDATE
-- missions                   | -                            | DELETE, INSERT, SELECT, UPDATE | DELETE, INSERT, SELECT, UPDATE
-- notification_preferences   | -                            | INSERT, SELECT, UPDATE       | -
-- pool_history               | -                            | INSERT, SELECT               | DELETE, INSERT, SELECT, UPDATE
-- pools                      | -                            | DELETE, INSERT, SELECT, UPDATE | DELETE, INSERT, SELECT, UPDATE
-- rate_limit_log             | -                            | -                            | DELETE, INSERT, SELECT
-- share_tokens               | -                            | DELETE, INSERT, SELECT, UPDATE | DELETE, INSERT, SELECT, UPDATE
-- talents                    | -                            | DELETE, INSERT, SELECT, UPDATE | DELETE, INSERT, SELECT, UPDATE
-- users                      | -                            | SELECT, UPDATE               | DELETE, INSERT, SELECT, UPDATE

-- ============================================================================
-- 6. FONCTIONS DU SCHÉMA PUBLIC (pg_proc, 22/09/2026) — code source complet
-- ----------------------------------------------------------------------------
-- 12 fonctions applicatives. Les 4 fonctions de l'extension unaccent (standard PostgreSQL)
-- ne sont pas reproduites.
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
$function$

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
$function$

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
$function$

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
                      end;  -- ⬅ seule ligne changée

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
$function$

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
$function$

CREATE OR REPLACE FUNCTION public.enforce_missions_occupant_staff_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_staff_type text;
begin
    if NEW.occupant_id is null or NEW.candidate_type is null then
        return NEW;
    end if;

    select staff_type into v_staff_type from public.talents where id = NEW.occupant_id;

    if NEW.candidate_type = 'expat' and v_staff_type = 'national' then
        raise exception 'Un poste expatrié ne peut pas être occupé par un staff national (talent %)', NEW.occupant_id;
    end if;

    if NEW.candidate_type = 'detache' and NEW.pool_level = 'project' and v_staff_type = 'expat' then
        raise exception 'Un détachement de niveau projet ne peut être occupé que par un staff national (talent %)', NEW.occupant_id;
    end if;

    return NEW;
end;
$function$

CREATE OR REPLACE FUNCTION public.get_notification_alerts(p_pool_scope text[] DEFAULT NULL::text[])
 RETURNS TABLE(alert_type text, pool_id text, days_left integer, contract_window integer, status text)
 LANGUAGE sql
 STABLE
AS $function$
  -- Contrats arrivant à échéance (≤ 90 jours), postes occupés uniquement
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

  -- Postes vacants ou en recrutement
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

  -- Talents actifs disponibles dès maintenant
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

  -- Talents actifs à risque de dévalidation (>= seuil AT_RISK centralisé)
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
    and coalesce(t.months_without_mission, 0) >= (select vt.at_risk_months from public.get_validity_thresholds() vt)
    and (p_pool_scope is null or t.pool = any(p_pool_scope));
$function$

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
$function$

CREATE OR REPLACE FUNCTION public.get_pool_talent_stats()
 RETURNS TABLE(pool_id text, active bigint, available bigint, at_risk bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    t.pool as pool_id,
    count(*) as active,
    count(*) filter (where t.status = 'En attente de poste') as available,
    count(*) filter (
      where coalesce(t.months_without_mission, 0) >=
        (select vt.at_risk_months from public.get_validity_thresholds() vt)
    ) as at_risk
  from talents t
  where t.pool is not null
    and t.is_valid is not false
    and t.is_red_listed is not true
  group by t.pool;
$function$

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
    v_detachment jsonb;
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
        'nationality_code', t.nationality_code,
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
        'country_code', m.country_code,
        'contract_start_date', m.contract_start_date
    ) INTO v_mission
    FROM public.missions m
    WHERE m.occupant_id = v_link.talent_id
    AND m.status = 'occupied'
    AND m.candidate_type IS DISTINCT FROM 'detache'
    ORDER BY m.contract_start_date DESC NULLS LAST
    LIMIT 1;

    SELECT jsonb_build_object(
        'title', m.title,
        'country', m.country,
        'country_code', m.country_code,
        'contract_start_date', m.contract_start_date
    ) INTO v_detachment
    FROM public.missions m
    WHERE m.occupant_id = v_link.talent_id
    AND m.status = 'occupied'
    AND m.candidate_type = 'detache'
    ORDER BY m.contract_start_date DESC NULLS LAST
    LIMIT 1;

    RETURN jsonb_build_object('talent', v_talent, 'mission', v_mission, 'detachment', v_detachment);
END;
$function$

CREATE OR REPLACE FUNCTION public.get_validity_thresholds()
 RETURNS TABLE(at_risk_months integer, critical_months integer, max_months integer)
 LANGUAGE sql
 STABLE
AS $function$
  select 20, 22, 24;
$function$

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
$function$


-- ============================================================================
-- 7. TRIGGERS (information_schema.triggers, 22/09/2026)
-- ============================================================================

-- missions      -> trg_audit_missions                         (AFTER  DELETE/INSERT/UPDATE) -> audit_missions_changes()
-- missions      -> trg_enforce_missions_occupant_staff_type   (BEFORE INSERT/UPDATE) -> enforce_missions_occupant_staff_type()
-- share_tokens  -> trg_audit_share_tokens                     (AFTER  DELETE/INSERT/UPDATE) -> audit_share_tokens_changes()
-- talents       -> trg_audit_talents                          (AFTER  DELETE/INSERT/UPDATE) -> audit_talents_changes()

-- ============================================================================
-- 8. NOTE — écarts constatés par rapport à l'instantané du 19/09/2026
-- ----------------------------------------------------------------------------
-- 1) Table client_error_logs (22/09/2026) : créée sans aucun GRANT, ce qui rendait l'enregistrement
--    des erreurs et leur purge inopérants sans message d'erreur. Corrigé le jour même
--    (client_error_logs_grants.sql), avec sa clé étrangère vers users passée en SET NULL.
--
-- 2) pool_history.changed_by n'avait aucune règle ON DELETE : la suppression d'un compte ayant
--    changé un talent de pool était refusée. comments.user_id était en CASCADE : supprimer un
--    compte effaçait ses commentaires. Les deux passent en SET NULL (users_fk_on_delete.sql),
--    comme evaluations.author_id et audit_logs.user_id.
--
-- 3) get_validity_thresholds() (20 / 22 / 24 mois) est appelée par get_pool_talent_stats() et
--    get_notification_alerts(). Elle ne figure ni dans l'instantané du 19/09 ni dans la
--    documentation : date de création inconnue. Ses valeurs doivent rester alignées sur
--    DEVALIDATION_AT_RISK_MONTHS / CRITICAL_MONTHS / MAX_MONTHS (shared/caphuma-utils.js).
--
-- 4) Toujours présents, déjà connus : commentaire de travail oublié dans
--    audit_talents_changes() (cosmétique), double contrainte CHECK sur
--    talents.number_of_alima_missions, extension unaccent dans le schéma public.
--
-- 5) share_tokens.created_by est en CASCADE : les liens créés par un compte supprimé
--    disparaissent avec lui. Comportement conservé volontairement (sécurité).
-- ============================================================================


-- ============================================================================
-- 9. INDEX (pg_indexes, 22/09/2026) — 53 index sur les 12 tables
-- ============================================================================

-- audit_logs
--   audit_logs_pkey (UNIQUE, btree(id))
--   idx_audit_logs_created_at (btree(created_at))
--   idx_audit_logs_user_id (btree(user_id))

-- client_error_logs
--   client_error_logs_pkey (UNIQUE, btree(id))
--   idx_client_error_logs_created_at (btree(created_at))
--   idx_client_error_logs_user_id (btree(user_id))

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
--   idx_talents_tracking_pool (btree(tracking_pool))
--   idx_talents_tracking_pool_is_valid (btree(tracking_pool, is_valid))
--   talents_created_by_idx (btree(created_by))
--   talents_education_level_idx (btree(education_level))
--   talents_nationality_idx (btree(nationality))
--   talents_number_of_alima_missions_idx (btree(number_of_alima_missions))
--   talents_status_idx (btree(status))

-- users
--   users_email_key (UNIQUE, btree(email))
--   users_pkey (UNIQUE, btree(id))
--   idx_users_email (btree(email))


-- ============================================================================
-- 10. REQUÊTE UTILISÉE POUR PRODUIRE CET INSTANTANÉ (lecture seule)
-- ----------------------------------------------------------------------------
-- Requête combinée de sql/GUIDE_INSTANTANE_SCHEMA.md (10 rubriques), exécutée le 22/09/2026.
-- ============================================================================
