-- Structure complète de la base Cap Huma telle qu'en production le 23/09/2026 : tables, contraintes, index,
-- fonctions, déclencheurs, RLS, policies, droits et buckets Storage. Produit par sql/generer_schema_reference.sql,
-- à régénérer après tout changement de schéma.
-- Sert à recréer la base sur un projet Supabase neuf ; les données se restaurent depuis le bucket backups.
-- Absents : comptes et réglages Auth, réglages du projet, secrets et code des Edge Functions.
-- Un seul bloc : sur une base existante, échoue dès la première table sans rien modifier.
-- Piège : l'éditeur SQL Supabase peut agir de lui-même sur les tables que ce script crée ; s'il refuse, exécuter avec psql.

begin;
set local check_function_bodies = off;

-- Extensions

create extension if not exists unaccent with schema public;

-- Tables

create table public.audit_logs (
    id uuid default gen_random_uuid() not null,
    user_id uuid,
    user_email text,
    user_name text,
    action text not null,
    entity_type text not null,
    entity_id text,
    entity_name text,
    details text,
    created_at timestamp with time zone default now()
);

create table public.client_error_logs (
    id uuid default gen_random_uuid() not null,
    created_at timestamp with time zone default now(),
    kind text not null,
    detail text,
    page text,
    user_id uuid,
    user_email text
);

create table public.comments (
    id uuid default gen_random_uuid() not null,
    talent_id uuid not null,
    user_id uuid,
    content text not null,
    created_at timestamp with time zone default now(),
    author_email text
);

create table public.evaluations (
    id uuid default gen_random_uuid() not null,
    mission_id uuid not null,
    talent_id uuid not null,
    author_id uuid,
    context text not null,
    positive_points text,
    negative_points text,
    rating integer,
    legacy_content text,
    is_archived boolean default false,
    created_at timestamp with time zone default now(),
    author_email text,
    comment_text text,
    is_moderated boolean default false,
    is_red_list_trigger boolean default false
);

create table public.missions (
    id uuid default gen_random_uuid() not null,
    title text not null,
    pool text,
    pool_level text not null,
    country text,
    location text not null,
    project_name text,
    candidate_type text,
    desk text,
    status text default 'vacant'::text not null,
    occupant_id uuid,
    contract_start_date timestamp with time zone,
    contract_end_date timestamp with time zone,
    contract_status text,
    future_talent_id uuid,
    future_contract_start_date timestamp with time zone,
    future_contract_end_date timestamp with time zone,
    created_at timestamp with time zone default now(),
    created_by uuid,
    pool_id text,
    is_expat boolean default true,
    current_occupant_id uuid,
    future_occupant_id uuid,
    contract_end_type text default 'date'::text not null,
    detachment_source_mission_id uuid,
    country_code text
);

create table public.notification_preferences (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    enabled boolean default true not null,
    pool_scope text[],
    updated_at timestamp with time zone default now() not null
);

create table public.pool_history (
    id uuid default gen_random_uuid() not null,
    talent_id uuid not null,
    from_pool text,
    to_pool text not null,
    changed_at timestamp with time zone default now() not null,
    changed_by uuid,
    changed_by_name text
);

create table public.pools (
    id uuid default gen_random_uuid() not null,
    pool_id text not null,
    name text not null,
    full_name text not null,
    level text not null,
    description text,
    color text,
    is_active boolean default true,
    created_at timestamp with time zone default now(),
    is_archived boolean default false not null,
    archived_at timestamp with time zone,
    archived_by_name text
);

create table public.rate_limit_log (
    id bigint generated always as identity not null,
    user_id uuid not null,
    function_name text not null,
    created_at timestamp with time zone default now() not null
);

create table public.share_tokens (
    id uuid default gen_random_uuid() not null,
    token text not null,
    talent_id uuid not null,
    created_by uuid not null,
    expires_at timestamp with time zone,
    is_revoked boolean default false,
    view_count integer default 0,
    last_viewed_at timestamp with time zone,
    created_at timestamp with time zone default now(),
    created_by_name text
);

create table public.talents (
    id uuid default gen_random_uuid() not null,
    first_name text not null,
    last_name text not null,
    email text,
    pool text,
    status text default 'En attente de poste'::text not null,
    is_valid boolean default true,
    is_red_listed boolean default false,
    experience_months_alima integer default 0,
    experience_months_humanitarian integer default 0,
    number_of_alima_missions text default 'none'::text,
    status_history jsonb default '[]'::jsonb,
    last_status_change_date timestamp with time zone,
    pool_integration_date timestamp with time zone default now(),
    availability jsonb default '{"type": "none"}'::jsonb,
    has_emergency_mission boolean default false,
    emergency_mission_comments text,
    has_mission_opening boolean default false,
    mission_opening_comments text,
    has_mission_closure boolean default false,
    closure_mission_comments text,
    intervention_contexts text[],
    intervention_zones text[],
    key_skills text[],
    has_visa boolean default false,
    nationality text,
    country_of_residence text,
    education_level text,
    education_specialty text,
    alima_trainings jsonb default '[]'::jsonb,
    last_experience_update timestamp with time zone,
    red_list_date timestamp with time zone,
    red_list_reason text,
    red_list_added_by uuid,
    red_list_added_by_name text,
    red_list_documents text[],
    last_mission_end_date timestamp with time zone,
    is_currently_on_mission boolean default false,
    months_without_mission integer default 0,
    created_at timestamp with time zone default now(),
    created_by uuid,
    gender text,
    languages text[],
    other_languages text[],
    current_function text,
    availability_type text,
    availability_months integer,
    availability_date date,
    project_status text,
    had_alima_mission boolean default false,
    months_without_alima_mission integer default 0,
    devalidation_date date,
    archived_position_passages jsonb default '[]'::jsonb,
    devalidation_extension_until date,
    devalidation_extension_months integer,
    devalidation_extension_granted_by uuid,
    devalidation_extension_granted_by_name text,
    devalidation_extension_granted_at timestamp with time zone,
    staff_type text default 'expat'::text not null,
    national_inactive_since date,
    nationality_code text,
    tracking_pool text
);

create table public.users (
    id uuid not null,
    name text,
    email text,
    role text default 'user'::text,
    is_active boolean default true,
    created_at timestamp with time zone default now()
);

-- Contraintes

alter table public.audit_logs add constraint audit_logs_pkey PRIMARY KEY (id);
alter table public.client_error_logs add constraint client_error_logs_pkey PRIMARY KEY (id);
alter table public.comments add constraint comments_pkey PRIMARY KEY (id);
alter table public.evaluations add constraint evaluations_pkey PRIMARY KEY (id);
alter table public.missions add constraint missions_pkey PRIMARY KEY (id);
alter table public.notification_preferences add constraint notification_preferences_pkey PRIMARY KEY (id);
alter table public.pool_history add constraint pool_history_pkey PRIMARY KEY (id);
alter table public.pools add constraint pools_pkey PRIMARY KEY (id);
alter table public.rate_limit_log add constraint rate_limit_log_pkey PRIMARY KEY (id);
alter table public.share_tokens add constraint shared_links_pkey PRIMARY KEY (id);
alter table public.talents add constraint talents_pkey PRIMARY KEY (id);
alter table public.users add constraint users_pkey PRIMARY KEY (id);
alter table public.notification_preferences add constraint notification_preferences_user_id_key UNIQUE (user_id);
alter table public.pools add constraint pools_pool_id_key UNIQUE (pool_id);
alter table public.share_tokens add constraint shared_links_token_key UNIQUE (token);
alter table public.users add constraint users_email_key UNIQUE (email);
alter table public.audit_logs add constraint audit_logs_action_known CHECK ((action = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text, 'login'::text, 'logout'::text, 'export'::text, 'add_to_red_list'::text, 'remove_from_red_list'::text, 'devalidate'::text, 'reintegrate'::text])));
alter table public.audit_logs add constraint audit_logs_details_length CHECK ((char_length(details) <= 2000));
alter table public.audit_logs add constraint audit_logs_entity_id_length CHECK ((char_length(entity_id) <= 100));
alter table public.audit_logs add constraint audit_logs_entity_name_length CHECK ((char_length(entity_name) <= 1000));
alter table public.client_error_logs add constraint client_error_logs_detail_length CHECK ((char_length(detail) <= 2000));
alter table public.client_error_logs add constraint client_error_logs_kind_length CHECK ((char_length(kind) <= 100));
alter table public.client_error_logs add constraint client_error_logs_page_length CHECK ((char_length(page) <= 500));
alter table public.evaluations add constraint evaluations_rating_check CHECK (((rating >= 0) AND (rating <= 10)));
alter table public.missions add constraint missions_candidate_type_check CHECK ((candidate_type = ANY (ARRAY['expat'::text, 'nat'::text, 'detache'::text])));
alter table public.missions add constraint missions_contract_end_type_check CHECK ((contract_end_type = ANY (ARRAY['date'::text, 'cdi'::text, 'ongoing'::text])));
alter table public.missions add constraint missions_contract_status_check CHECK ((contract_status = ANY (ARRAY['ongoing'::text, 'renewable'::text, 'ending'::text])));
alter table public.missions add constraint missions_desk_check CHECK ((desk = ANY (ARRAY['desk1'::text, 'desk2'::text, 'desk3'::text, 'suo'::text])));
alter table public.missions add constraint missions_pool_level_check CHECK ((pool_level = ANY (ARRAY['mission'::text, 'project'::text])));
alter table public.missions add constraint missions_status_check CHECK ((status = ANY (ARRAY['occupied'::text, 'recruiting'::text, 'vacant'::text])));
alter table public.pools add constraint pools_level_check CHECK ((level = ANY (ARRAY['mission'::text, 'project'::text])));
alter table public.talents add constraint talents_availability_type_check CHECK (((availability_type IS NULL) OR (availability_type = ANY (ARRAY['none'::text, 'notice'::text, 'date'::text, 'asap'::text]))));
alter table public.talents add constraint talents_education_level_check CHECK ((education_level = ANY (ARRAY['none'::text, 'bac'::text, 'bac+1'::text, 'bac+2'::text, 'bac+3'::text, 'bac+4'::text, 'bac+5'::text, 'bac+6'::text, 'bac+7'::text, 'bac+8+'::text])));
alter table public.talents add constraint talents_number_of_alima_missions_check CHECK ((number_of_alima_missions = ANY (ARRAY['none'::text, 'one'::text, 'two'::text, 'three_plus'::text])));
alter table public.talents add constraint talents_number_of_missions_check CHECK (((number_of_alima_missions IS NULL) OR (number_of_alima_missions = ANY (ARRAY['none'::text, 'one'::text, 'two'::text, 'three_plus'::text]))));
alter table public.talents add constraint talents_project_status_check CHECK (((project_status IS NULL) OR (project_status = ANY (ARRAY['none'::text, 'opening'::text, 'emergency'::text, 'closure'::text]))));
alter table public.talents add constraint talents_staff_type_check CHECK ((staff_type = ANY (ARRAY['expat'::text, 'national'::text])));
alter table public.talents add constraint talents_status_check CHECK ((status = ANY (ARRAY['En poste ALIMA'::text, 'En attente de poste'::text, 'En poste autre ONG'::text, 'En poste hors humanitaire'::text])));
alter table public.users add constraint users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'user'::text, 'visitor'::text])));
alter table public.audit_logs add constraint audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.client_error_logs add constraint client_error_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.comments add constraint comments_talent_id_fkey FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE;
alter table public.comments add constraint comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.evaluations add constraint evaluations_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.evaluations add constraint evaluations_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE;
alter table public.evaluations add constraint evaluations_talent_id_fkey FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE;
alter table public.missions add constraint missions_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.missions add constraint missions_detachment_source_mission_id_fkey FOREIGN KEY (detachment_source_mission_id) REFERENCES missions(id) ON DELETE SET NULL;
alter table public.missions add constraint missions_future_talent_id_fkey FOREIGN KEY (future_talent_id) REFERENCES talents(id) ON DELETE SET NULL;
alter table public.missions add constraint missions_occupant_id_fkey FOREIGN KEY (occupant_id) REFERENCES talents(id) ON DELETE SET NULL;
alter table public.missions add constraint missions_pool_fkey FOREIGN KEY (pool) REFERENCES pools(pool_id) ON DELETE SET NULL;
alter table public.notification_preferences add constraint notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.pool_history add constraint pool_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.pool_history add constraint pool_history_talent_id_fkey FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE;
alter table public.share_tokens add constraint shared_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
alter table public.share_tokens add constraint shared_links_talent_id_fkey FOREIGN KEY (talent_id) REFERENCES talents(id) ON DELETE CASCADE;
alter table public.talents add constraint talents_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.talents add constraint talents_pool_fkey FOREIGN KEY (pool) REFERENCES pools(pool_id) ON DELETE SET NULL;
alter table public.talents add constraint talents_red_list_added_by_fkey FOREIGN KEY (red_list_added_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.talents add constraint talents_tracking_pool_fkey FOREIGN KEY (tracking_pool) REFERENCES pools(pool_id);
alter table public.users add constraint users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Index

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at);
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);
CREATE INDEX idx_client_error_logs_created_at ON public.client_error_logs USING btree (created_at);
CREATE INDEX idx_client_error_logs_user_id ON public.client_error_logs USING btree (user_id);
CREATE INDEX idx_comments_talent_id ON public.comments USING btree (talent_id);
CREATE INDEX idx_comments_user_id ON public.comments USING btree (user_id);
CREATE INDEX idx_evaluations_author_id ON public.evaluations USING btree (author_id);
CREATE INDEX idx_evaluations_mission_id ON public.evaluations USING btree (mission_id);
CREATE INDEX idx_evaluations_talent_id ON public.evaluations USING btree (talent_id);
CREATE INDEX idx_missions_created_by ON public.missions USING btree (created_by);
CREATE INDEX idx_missions_future_talent_id ON public.missions USING btree (future_talent_id);
CREATE INDEX idx_missions_occupant_id ON public.missions USING btree (occupant_id);
CREATE INDEX idx_missions_pool ON public.missions USING btree (pool);
CREATE INDEX idx_missions_status ON public.missions USING btree (status);
CREATE INDEX idx_pool_history_changed_by ON public.pool_history USING btree (changed_by);
CREATE INDEX pool_history_talent_id_idx ON public.pool_history USING btree (talent_id);
CREATE INDEX idx_pools_is_archived ON public.pools USING btree (is_archived);
CREATE INDEX idx_pools_pool_id ON public.pools USING btree (pool_id);
CREATE INDEX rate_limit_log_lookup_idx ON public.rate_limit_log USING btree (user_id, function_name, created_at);
CREATE INDEX idx_share_tokens_created_by ON public.share_tokens USING btree (created_by);
CREATE INDEX idx_share_tokens_talent_id ON public.share_tokens USING btree (talent_id);
CREATE INDEX idx_shared_links_token ON public.share_tokens USING btree (token);
CREATE INDEX idx_talents_devalidation_date ON public.talents USING btree (devalidation_date);
CREATE INDEX idx_talents_is_red_listed ON public.talents USING btree (is_red_listed);
CREATE INDEX idx_talents_is_valid ON public.talents USING btree (is_valid);
CREATE INDEX idx_talents_months_without_mission ON public.talents USING btree (months_without_mission);
CREATE INDEX idx_talents_pool ON public.talents USING btree (pool);
CREATE INDEX idx_talents_pool_is_valid ON public.talents USING btree (pool, is_valid);
CREATE INDEX idx_talents_red_list_added_by ON public.talents USING btree (red_list_added_by);
CREATE INDEX idx_talents_tracking_pool ON public.talents USING btree (tracking_pool);
CREATE INDEX idx_talents_tracking_pool_is_valid ON public.talents USING btree (tracking_pool, is_valid);
CREATE INDEX talents_created_by_idx ON public.talents USING btree (created_by);
CREATE INDEX talents_education_level_idx ON public.talents USING btree (education_level);
CREATE INDEX talents_nationality_idx ON public.talents USING btree (nationality);
CREATE INDEX talents_number_of_alima_missions_idx ON public.talents USING btree (number_of_alima_missions);
CREATE INDEX talents_status_idx ON public.talents USING btree (status);
CREATE INDEX idx_users_email ON public.users USING btree (email);

-- Fonctions

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
;

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
;

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
;

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
;

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
;

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
;

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
;

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
;

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
;

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
;

CREATE OR REPLACE FUNCTION public.get_validity_thresholds()
 RETURNS TABLE(at_risk_months integer, critical_months integer, max_months integer)
 LANGUAGE sql
 STABLE
AS $function$
  select 20, 22, 24;
$function$
;

CREATE OR REPLACE FUNCTION public.has_active_role(VARIADIC p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
        select exists (
            select 1
            from public.users
            where id = auth.uid()
              and is_active is not false
              and role = any (p_roles)
        );
    $function$
;

CREATE OR REPLACE FUNCTION public.is_active_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
        select exists (
            select 1
            from public.users
            where id = auth.uid()
              and is_active is not false
        );
    $function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
        select public.has_active_role('admin');
    $function$
;

CREATE OR REPLACE FUNCTION public.set_author_from_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    declare
        v_uid uuid := auth.uid();
        v_email text;
        v_name text;
    begin
        if v_uid is null then
            return new;
        end if;

        if tg_op = 'UPDATE' then
            new.author_email := old.author_email;
            return new;
        end if;

        select email, coalesce(nullif(name, ''), email)
        into v_email, v_name
        from public.users
        where id = v_uid;

        if tg_table_name in ('comments', 'evaluations') then
            new.author_email := v_email;
        elsif tg_table_name = 'pool_history' then
            new.changed_by := v_uid;
            new.changed_by_name := v_name;
        elsif tg_table_name = 'audit_logs' then
            new.created_at := now();
            new.user_email := v_email;
            new.user_name := v_name;
            if pg_trigger_depth() = 1
               and not public.check_and_record_rate_limit(v_uid, 'audit_logs', 60, 200) then
                return null;
            end if;
        elsif tg_table_name = 'client_error_logs' then
            -- created_at imposé : une date passée contournerait le quota sur 24 h.
            new.created_at := now();
            new.user_email := v_email;
            if (select count(*) from public.client_error_logs
                where user_id = v_uid and created_at > now() - interval '24 hours') >= 100
               or (select count(*) from public.client_error_logs) >= 10000 then
                return null;
            end if;
        end if;

        return new;
    end;
    $function$
;

-- Déclencheurs

CREATE TRIGGER trg_set_author_audit_logs BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION set_author_from_session();
CREATE TRIGGER trg_set_author_client_error_logs BEFORE INSERT ON public.client_error_logs FOR EACH ROW EXECUTE FUNCTION set_author_from_session();
CREATE TRIGGER trg_set_author_comments BEFORE INSERT OR UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION set_author_from_session();
CREATE TRIGGER trg_set_author_evaluations BEFORE INSERT OR UPDATE ON public.evaluations FOR EACH ROW EXECUTE FUNCTION set_author_from_session();
CREATE TRIGGER trg_audit_missions AFTER INSERT OR DELETE OR UPDATE ON public.missions FOR EACH ROW EXECUTE FUNCTION audit_missions_changes();
CREATE TRIGGER trg_enforce_missions_occupant_staff_type BEFORE INSERT OR UPDATE ON public.missions FOR EACH ROW EXECUTE FUNCTION enforce_missions_occupant_staff_type();
CREATE TRIGGER trg_set_author_pool_history BEFORE INSERT ON public.pool_history FOR EACH ROW EXECUTE FUNCTION set_author_from_session();
CREATE TRIGGER trg_audit_share_tokens AFTER INSERT OR DELETE OR UPDATE ON public.share_tokens FOR EACH ROW EXECUTE FUNCTION audit_share_tokens_changes();
CREATE TRIGGER trg_audit_talents AFTER INSERT OR DELETE OR UPDATE ON public.talents FOR EACH ROW EXECUTE FUNCTION audit_talents_changes();

-- Row Level Security

alter table public.audit_logs enable row level security;
alter table public.client_error_logs enable row level security;
alter table public.comments enable row level security;
alter table public.evaluations enable row level security;
alter table public.missions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.pool_history enable row level security;
alter table public.pools enable row level security;
alter table public.rate_limit_log enable row level security;
alter table public.share_tokens enable row level security;
alter table public.talents enable row level security;
alter table public.users enable row level security;

-- Policies

create policy audit_logs_insert_own_action on public.audit_logs as permissive for insert to authenticated
    with check ((( SELECT auth.uid() AS uid) = user_id));

create policy audit_logs_select_admin_only on public.audit_logs as permissive for select to authenticated
    using (( SELECT is_admin() AS is_admin));

create policy "Admin can read error logs" on public.client_error_logs as permissive for select to authenticated
    using (is_admin());

create policy "Insert own error log" on public.client_error_logs as permissive for insert to authenticated
    with check ((user_id = auth.uid()));

create policy comments_delete_admin_or_owner on public.comments as permissive for delete to authenticated
    using ((( SELECT is_admin() AS is_admin) OR ((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT has_active_role(VARIADIC ARRAY['user'::text]) AS has_active_role))));

create policy comments_insert_admin_user on public.comments as permissive for insert to authenticated
    with check (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role)));

create policy comments_select_all_connected on public.comments as permissive for select to authenticated
    using (( SELECT is_active_user() AS is_active_user));

create policy comments_select_restrict_visitor_sensitive_rows on public.comments as restrictive for select to authenticated
    using (((( SELECT users.role
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid))) IS DISTINCT FROM 'visitor'::text) OR ((talent_id IS NULL) OR (EXISTS ( SELECT 1
   FROM talents t
  WHERE ((t.id = comments.talent_id) AND (COALESCE(t.is_red_listed, false) = false) AND (COALESCE(t.is_valid, true) = true)))))));

create policy comments_update_admin_or_owner on public.comments as permissive for update to authenticated
    using ((( SELECT is_admin() AS is_admin) OR ((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT has_active_role(VARIADIC ARRAY['user'::text]) AS has_active_role))))
    with check ((( SELECT is_admin() AS is_admin) OR ((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT has_active_role(VARIADIC ARRAY['user'::text]) AS has_active_role))));

create policy evaluations_delete_own_or_admin on public.evaluations as permissive for delete to authenticated
    using ((( SELECT is_admin() AS is_admin) OR ((author_id = ( SELECT auth.uid() AS uid)) AND ( SELECT has_active_role(VARIADIC ARRAY['user'::text]) AS has_active_role))));

create policy evaluations_insert_own on public.evaluations as permissive for insert to authenticated
    with check (((author_id = ( SELECT auth.uid() AS uid)) AND ( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role)));

create policy evaluations_select_authenticated on public.evaluations as permissive for select to authenticated
    using (( SELECT is_active_user() AS is_active_user));

create policy evaluations_select_restrict_visitor_sensitive_rows on public.evaluations as restrictive for select to authenticated
    using (((( SELECT users.role
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid))) IS DISTINCT FROM 'visitor'::text) OR ((talent_id IS NULL) OR (EXISTS ( SELECT 1
   FROM talents t
  WHERE ((t.id = evaluations.talent_id) AND (COALESCE(t.is_red_listed, false) = false) AND (COALESCE(t.is_valid, true) = true)))))));

create policy evaluations_update_own_or_admin on public.evaluations as permissive for update to authenticated
    using ((( SELECT is_admin() AS is_admin) OR ((author_id = ( SELECT auth.uid() AS uid)) AND ( SELECT has_active_role(VARIADIC ARRAY['user'::text]) AS has_active_role))))
    with check ((( SELECT is_admin() AS is_admin) OR ((author_id = ( SELECT auth.uid() AS uid)) AND ( SELECT has_active_role(VARIADIC ARRAY['user'::text]) AS has_active_role))));

create policy missions_delete_admin_user on public.missions as permissive for delete to authenticated
    using (( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role));

create policy missions_insert_admin_user on public.missions as permissive for insert to authenticated
    with check (( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role));

create policy missions_select_authenticated on public.missions as permissive for select to authenticated
    using (( SELECT is_active_user() AS is_active_user));

create policy missions_update_admin_user on public.missions as permissive for update to authenticated
    using (( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role))
    with check (( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role));

create policy notification_preferences_insert_own on public.notification_preferences as permissive for insert to authenticated
    with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy notification_preferences_select_own on public.notification_preferences as permissive for select to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)));

create policy notification_preferences_update_own on public.notification_preferences as permissive for update to authenticated
    using ((user_id = ( SELECT auth.uid() AS uid)))
    with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy pool_history_insert_admin_user on public.pool_history as permissive for insert to authenticated
    with check (( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role));

create policy pool_history_select_authenticated on public.pool_history as permissive for select to authenticated
    using (( SELECT is_active_user() AS is_active_user));

create policy pools_delete_admin on public.pools as permissive for delete to authenticated
    using (( SELECT is_admin() AS is_admin));

create policy pools_insert_admin on public.pools as permissive for insert to authenticated
    with check (( SELECT is_admin() AS is_admin));

create policy pools_select_authenticated on public.pools as permissive for select to authenticated
    using (( SELECT is_active_user() AS is_active_user));

create policy pools_update_admin on public.pools as permissive for update to authenticated
    using (( SELECT is_admin() AS is_admin))
    with check (( SELECT is_admin() AS is_admin));

create policy share_tokens_delete_admin on public.share_tokens as permissive for delete to authenticated
    using (( SELECT is_admin() AS is_admin));

create policy share_tokens_insert_admin_user on public.share_tokens as permissive for insert to authenticated
    with check (((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role)));

create policy share_tokens_select_own_or_admin on public.share_tokens as permissive for select to authenticated
    using ((( SELECT is_admin() AS is_admin) OR ((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT is_active_user() AS is_active_user))));

create policy share_tokens_update_admin_or_creator on public.share_tokens as permissive for update to authenticated
    using ((( SELECT is_admin() AS is_admin) OR ((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT is_active_user() AS is_active_user))))
    with check ((( SELECT is_admin() AS is_admin) OR ((created_by = ( SELECT auth.uid() AS uid)) AND ( SELECT is_active_user() AS is_active_user))));

create policy talents_delete_admin_only on public.talents as permissive for delete to authenticated
    using (( SELECT is_admin() AS is_admin));

create policy talents_insert_admin_user on public.talents as permissive for insert to authenticated
    with check (( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role));

create policy talents_select_all_connected on public.talents as permissive for select to authenticated
    using (( SELECT is_active_user() AS is_active_user));

create policy talents_select_restrict_visitor_sensitive_rows on public.talents as restrictive for select to authenticated
    using (((( SELECT users.role
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid))) IS DISTINCT FROM 'visitor'::text) OR ((COALESCE(is_red_listed, false) = false) AND (COALESCE(is_valid, true) = true))));

create policy talents_update_admin_user on public.talents as permissive for update to authenticated
    using (( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role))
    with check (( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role));

create policy users_can_read_own_profile on public.users as permissive for select to authenticated
    using ((( SELECT auth.uid() AS uid) = id));

create policy users_select_admin_all on public.users as permissive for select to authenticated
    using (( SELECT is_admin() AS is_admin));

create policy red_list_docs_delete_admin_user on storage.objects as permissive for delete to authenticated
    using (((bucket_id = 'red-list-documents'::text) AND ( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role)));

create policy red_list_docs_insert_admin_user on storage.objects as permissive for insert to authenticated
    with check (((bucket_id = 'red-list-documents'::text) AND ( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role)));

create policy red_list_docs_select_admin_user on storage.objects as permissive for select to authenticated
    using (((bucket_id = 'red-list-documents'::text) AND ( SELECT has_active_role(VARIADIC ARRAY['admin'::text, 'user'::text]) AS has_active_role)));

-- Droits sur les tables et séquences

revoke all on table public.audit_logs from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.audit_logs to service_role;
grant insert, maintain, references, select, trigger on table public.audit_logs to authenticated;
grant maintain, references, trigger on table public.audit_logs to anon;
revoke all on table public.client_error_logs from public, anon, authenticated, service_role;
grant delete, maintain, references, select, trigger, truncate on table public.client_error_logs to service_role;
grant insert, maintain, references, select, trigger on table public.client_error_logs to authenticated;
grant maintain, references, trigger on table public.client_error_logs to anon;
revoke all on table public.comments from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.comments to service_role;
grant delete, insert, maintain, references, select, trigger, update on table public.comments to authenticated;
grant maintain, references, trigger on table public.comments to anon;
revoke all on table public.evaluations from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.evaluations to service_role;
grant delete, insert, maintain, references, select, trigger, update on table public.evaluations to authenticated;
revoke all on table public.missions from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.missions to service_role;
grant delete, insert, maintain, references, select, trigger, update on table public.missions to authenticated;
revoke all on table public.notification_preferences from public, anon, authenticated, service_role;
grant insert, maintain, references, select, trigger, update on table public.notification_preferences to authenticated;
grant maintain, references, trigger on table public.notification_preferences to anon;
grant maintain, references, trigger, truncate on table public.notification_preferences to service_role;
revoke all on table public.pool_history from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.pool_history to service_role;
grant insert, maintain, references, select, trigger on table public.pool_history to authenticated;
revoke all on table public.pools from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.pools to service_role;
grant delete, insert, maintain, references, select, trigger, update on table public.pools to authenticated;
revoke all on table public.rate_limit_log from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate on table public.rate_limit_log to service_role;
grant maintain, references, trigger on table public.rate_limit_log to anon;
grant maintain, references, trigger on table public.rate_limit_log to authenticated;
revoke all on table public.share_tokens from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.share_tokens to service_role;
grant delete, insert, maintain, references, select, trigger, update on table public.share_tokens to authenticated;
revoke all on table public.talents from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.talents to service_role;
grant delete, insert, maintain, references, select, trigger, update on table public.talents to authenticated;
revoke all on table public.users from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.users to service_role;
grant maintain, references, select, trigger on table public.users to authenticated;

-- Droits d'exécution des fonctions

revoke all on function public.admin_revoke_user_sessions(target_user_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_revoke_user_sessions(target_user_id uuid) to service_role;
revoke all on function public.audit_missions_changes() from public, anon, authenticated, service_role;
revoke all on function public.audit_share_tokens_changes() from public, anon, authenticated, service_role;
revoke all on function public.audit_talents_changes() from public, anon, authenticated, service_role;
revoke all on function public.check_and_record_rate_limit(p_user_id uuid, p_function_name text, p_window_minutes integer, p_max_calls integer) from public, anon, authenticated, service_role;
grant execute on function public.check_and_record_rate_limit(p_user_id uuid, p_function_name text, p_window_minutes integer, p_max_calls integer) to service_role;
revoke all on function public.enforce_missions_occupant_staff_type() from public, anon, authenticated, service_role;
revoke all on function public.get_notification_alerts(p_pool_scope text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_notification_alerts(p_pool_scope text[]) to authenticated;
grant execute on function public.get_notification_alerts(p_pool_scope text[]) to public;
revoke all on function public.get_pool_mission_counts() from public, anon, authenticated, service_role;
grant execute on function public.get_pool_mission_counts() to authenticated;
grant execute on function public.get_pool_mission_counts() to public;
revoke all on function public.get_pool_talent_stats() from public, anon, authenticated, service_role;
grant execute on function public.get_pool_talent_stats() to authenticated;
grant execute on function public.get_pool_talent_stats() to public;
revoke all on function public.get_shared_talent(p_token text) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_talent(p_token text) to anon;
grant execute on function public.get_shared_talent(p_token text) to authenticated;
revoke all on function public.get_validity_thresholds() from public, anon, authenticated, service_role;
grant execute on function public.get_validity_thresholds() to public;
revoke all on function public.has_active_role(VARIADIC p_roles text[]) from public, anon, authenticated, service_role;
grant execute on function public.has_active_role(VARIADIC p_roles text[]) to authenticated;
revoke all on function public.is_active_user() from public, anon, authenticated, service_role;
grant execute on function public.is_active_user() to authenticated;
revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.set_author_from_session() from public, anon, authenticated, service_role;

-- Buckets Storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('backups', 'backups', false, null, null);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('red-list-documents', 'red-list-documents', false, 10485760, '{application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png}'::text[]);

-- Contrôle : objets non reproduits par ce script

-- Aucun.

commit;
