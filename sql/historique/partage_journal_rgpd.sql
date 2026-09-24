-- Lien de partage public : les anciens postes ne renvoient plus que titre et dates (plus aucune évaluation) ; talent dévalidé ou créateur suspendu = lien inactif.
-- Liens de partage : jeton généré par la base, expiration obligatoire et limitée à 90 jours, seule la révocation reste modifiable et elle est définitive.
-- Journal d'audit : plus d'écriture directe depuis le site ; connexion, déconnexion, exports et bilans d'import passent par log_client_event() ;
-- commentaires, pools et demandes de nouveau code ignorées sont journalisés par la base ; le motif de Liste Rouge n'est plus recopié.
-- Les liens existants sans expiration ou au-delà de 90 jours après leur création sont ramenés à création + 90 jours.
-- Le motif de Liste Rouge déjà recopié dans le journal est effacé : ce nettoyage ne s'annule pas.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 24/09/2026.

begin;

create or replace function public.get_shared_talent(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_link record;
    v_talent jsonb;
    v_mission jsonb;
    v_detachment jsonb;
begin
    select * into v_link
    from public.share_tokens
    where token = p_token;

    if not found then
        return jsonb_build_object('error', 'invalid_token');
    end if;

    if v_link.is_revoked
       or not exists (select 1 from public.users u where u.id = v_link.created_by and u.is_active is not false) then
        return jsonb_build_object('error', 'revoked');
    end if;

    if v_link.expires_at is null or v_link.expires_at < now() then
        return jsonb_build_object('error', 'expired');
    end if;

    select jsonb_build_object(
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
        'archived_position_passages', coalesce((
            select jsonb_agg(jsonb_build_object(
                'positionTitle', p.passage -> 'positionTitle',
                'startDate', p.passage -> 'startDate',
                'endDate', p.passage -> 'endDate'
            ) order by p.ordre)
            from jsonb_array_elements(
                case when jsonb_typeof(t.archived_position_passages) = 'array' then t.archived_position_passages else '[]'::jsonb end
            ) with ordinality as p(passage, ordre)
        ), '[]'::jsonb)
    ) into v_talent
    from public.talents t
    where t.id = v_link.talent_id
      and coalesce(t.is_red_listed, false) = false
      and coalesce(t.is_valid, true) = true;

    if v_talent is null then
        return jsonb_build_object('error', 'talent_not_found');
    end if;

    update public.share_tokens
    set view_count = coalesce(view_count, 0) + 1,
        last_viewed_at = now()
    where token = p_token;

    select jsonb_build_object(
        'title', m.title,
        'country', m.country,
        'country_code', m.country_code,
        'contract_start_date', m.contract_start_date
    ) into v_mission
    from public.missions m
    where m.occupant_id = v_link.talent_id
      and m.status = 'occupied'
      and m.candidate_type is distinct from 'detache'
    order by m.contract_start_date desc nulls last
    limit 1;

    select jsonb_build_object(
        'title', m.title,
        'country', m.country,
        'country_code', m.country_code,
        'contract_start_date', m.contract_start_date
    ) into v_detachment
    from public.missions m
    where m.occupant_id = v_link.talent_id
      and m.status = 'occupied'
      and m.candidate_type = 'detache'
    order by m.contract_start_date desc nulls last
    limit 1;

    return jsonb_build_object('talent', v_talent, 'mission', v_mission, 'detachment', v_detachment);
end;
$function$;

update public.share_tokens
set expires_at = coalesce(created_at, now()) + interval '90 days'
where expires_at is null
   or expires_at > coalesce(created_at, now()) + interval '91 days';

alter table public.share_tokens alter column expires_at set not null;

create or replace function public.enforce_share_token_rules()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
    if tg_op = 'INSERT' then
        new.token := 'st_' || gen_random_uuid()::text;
        new.is_revoked := false;
        new.view_count := 0;
        new.last_viewed_at := null;
        if new.expires_at is null or new.expires_at <= now() or new.expires_at > now() + interval '91 days' then
            raise exception 'La date d''expiration d''un lien de partage doit être dans le futur et à 90 jours au plus.'
                using errcode = '22023';
        end if;
    elsif coalesce(old.is_revoked, false) and not coalesce(new.is_revoked, false) then
        raise exception 'Un lien de partage révoqué ne peut pas être réactivé.' using errcode = '22023';
    end if;
    return new;
end;
$function$;

revoke all on function public.enforce_share_token_rules() from public, anon, authenticated, service_role;
drop trigger if exists trg_enforce_share_token_rules on public.share_tokens;
create trigger trg_enforce_share_token_rules before insert or update on public.share_tokens
    for each row execute function public.enforce_share_token_rules();

revoke update on table public.share_tokens from authenticated;
grant update (is_revoked) on table public.share_tokens to authenticated;

create or replace function public.log_client_event(
    p_action text,
    p_entity_type text,
    p_entity_id text default null,
    p_entity_name text default null,
    p_details text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_uid uuid := auth.uid();
    v_email text;
begin
    if v_uid is null or not public.is_active_user() then
        raise exception 'Accès refusé' using errcode = '42501';
    end if;

    if p_action in ('login', 'logout') and p_entity_type = 'user' then
        select email into v_email from public.users where id = v_uid;
        p_entity_id := v_uid::text;
        p_entity_name := v_email;
        p_details := null;
    elsif p_action = 'export' and p_entity_type in ('talent', 'system') then
        null;
    elsif p_action = 'create' and p_entity_type in ('talent', 'mission') then
        p_entity_id := null;
        p_entity_name := 'Import en masse';
    else
        raise exception 'Action non journalisable depuis le site : % / %', p_action, p_entity_type using errcode = '22023';
    end if;

    insert into public.audit_logs (user_id, action, entity_type, entity_id, entity_name, details)
    values (v_uid, p_action, p_entity_type, left(p_entity_id, 100), left(p_entity_name, 1000), left(p_details, 2000));
end;
$function$;

revoke all on function public.log_client_event(text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.log_client_event(text, text, text, text, text) to authenticated;

drop policy if exists audit_logs_insert_own_action on public.audit_logs;
revoke insert on table public.audit_logs from authenticated;

create or replace function public.audit_comments_changes()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_user_id uuid := auth.uid();
    v_user_email text;
    v_user_name text;
    v_row public.comments := coalesce(new, old);
    v_talent_name text;
begin
    select first_name || ' ' || last_name into v_talent_name from public.talents where id = v_row.talent_id;
    if not found then
        return v_row;
    end if;

    select email, name into v_user_email, v_user_name from public.users where id = v_user_id;
    if v_user_id is null then
        v_user_name := 'Système';
    end if;

    insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
    values (v_user_id, v_user_email, v_user_name,
            case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
            'comment', v_row.id::text, v_talent_name, null);

    return v_row;
end;
$function$;

revoke all on function public.audit_comments_changes() from public, anon, authenticated, service_role;
drop trigger if exists trg_audit_comments on public.comments;
create trigger trg_audit_comments after insert or delete or update of content on public.comments
    for each row execute function public.audit_comments_changes();

create or replace function public.audit_pools_changes()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_user_id uuid := auth.uid();
    v_user_email text;
    v_user_name text;
    v_row public.pools := coalesce(new, old);
    v_action text;
    v_details text;
    v_changes text[] := '{}';
    v_levels constant jsonb := '{"mission": "Mission", "project": "Projet"}';
begin
    if tg_op = 'INSERT' then
        v_action := 'create';
        v_details := new.full_name;
    elsif tg_op = 'DELETE' then
        v_action := 'delete';
        v_details := 'Pool supprimé';
    else
        v_action := 'update';
        if new.is_archived is distinct from old.is_archived then
            v_changes := v_changes || case when new.is_archived then 'Pool archivé' else 'Pool désarchivé' end;
        end if;
        if new.pool_id is distinct from old.pool_id then
            v_changes := v_changes || format('Code : %s → %s', old.pool_id, new.pool_id);
        end if;
        if new.full_name is distinct from old.full_name then
            v_changes := v_changes || format('Nom complet : %s → %s', old.full_name, new.full_name);
        end if;
        if new.level is distinct from old.level then
            v_changes := v_changes || format('Niveau : %s → %s',
                coalesce(v_levels ->> old.level, old.level), coalesce(v_levels ->> new.level, new.level));
        end if;
        if new.description is distinct from old.description then
            v_changes := v_changes || format('Description : %s → %s', coalesce(old.description, '—'), coalesce(new.description, '—'));
        end if;
        if cardinality(v_changes) = 0 then
            return new;
        end if;
        v_details := array_to_string(v_changes, ' ; ');
    end if;

    select email, name into v_user_email, v_user_name from public.users where id = v_user_id;
    if v_user_id is null then
        v_user_name := 'Système';
    end if;

    insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
    values (v_user_id, v_user_email, v_user_name, v_action, 'system', v_row.id::text, 'Pool ' || v_row.pool_id, left(v_details, 2000));

    return v_row;
end;
$function$;

revoke all on function public.audit_pools_changes() from public, anon, authenticated, service_role;
drop trigger if exists trg_audit_pools on public.pools;
create trigger trg_audit_pools after insert or delete or update on public.pools
    for each row execute function public.audit_pools_changes();

create or replace function public.dismiss_access_code_request(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_email text;
    v_account_id uuid;
begin
    if not public.is_admin() then
        raise exception 'Accès refusé' using errcode = '42501';
    end if;

    update public.access_code_requests
    set resolved_at = now(), resolved_by = auth.uid()
    where id = p_id and resolved_at is null
    returning email into v_email;

    if v_email is null then
        return;
    end if;

    select id into v_account_id from public.users where lower(email) = lower(v_email);

    insert into public.audit_logs (user_id, action, entity_type, entity_id, entity_name, details)
    values (auth.uid(), 'update', 'user', v_account_id::text, v_email, 'Demande de nouveau code d''accès ignorée');
end;
$function$;

create or replace function public.audit_talents_changes()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_user_id uuid := auth.uid();
    v_user_email text;
    v_user_name text;
    v_action text;
    v_entity_id text;
    v_entity_name text;
    v_details text;
    v_changed text;
begin
    select email, name into v_user_email, v_user_name
    from public.users where id = v_user_id;
    if v_user_id is null then
        v_user_name := 'Système';
    end if;

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
        if v_user_id is null
           and to_jsonb(NEW) - array['experience_months_alima', 'experience_months_humanitarian', 'months_without_mission', 'last_experience_update']
             = to_jsonb(OLD) - array['experience_months_alima', 'experience_months_humanitarian', 'months_without_mission', 'last_experience_update'] then
            return NEW;
        end if;

        v_entity_id := NEW.id::text;
        v_entity_name := NEW.first_name || ' ' || NEW.last_name;

        if NEW.is_red_listed = true and coalesce(OLD.is_red_listed, false) = false then
            v_action := 'add_to_red_list';
            v_details := 'Ajout en Liste Rouge';

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
            select string_agg(n.key, ', ' order by n.key) into v_changed
            from jsonb_each(to_jsonb(NEW)) n
            where n.value is distinct from to_jsonb(OLD) -> n.key;
            v_details := case when v_changed is not null then 'Champs modifiés : ' || v_changed end;
        end if;
    end if;

    insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
    values (v_user_id, v_user_email, v_user_name, v_action, 'talent', v_entity_id, v_entity_name, left(v_details, 2000));

    return coalesce(NEW, OLD);
end;
$function$;

update public.audit_logs
set details = 'Ajout en Liste Rouge'
where action = 'add_to_red_list'
  and details is distinct from 'Ajout en Liste Rouge';

commit;

-- Rollback (le nettoyage du motif de Liste Rouge dans le journal ne s'annule pas) :
-- réexécuter, depuis la version précédente de sql/schema_reference.sql dans l'historique Git,
-- les définitions de get_shared_talent(), dismiss_access_code_request() et audit_talents_changes(), puis :
-- drop trigger if exists trg_enforce_share_token_rules on public.share_tokens;
-- drop function if exists public.enforce_share_token_rules();
-- alter table public.share_tokens alter column expires_at drop not null;
-- revoke update (is_revoked) on table public.share_tokens from authenticated;
-- grant update on table public.share_tokens to authenticated;
-- drop trigger if exists trg_audit_comments on public.comments;
-- drop function if exists public.audit_comments_changes();
-- drop trigger if exists trg_audit_pools on public.pools;
-- drop function if exists public.audit_pools_changes();
-- drop function if exists public.log_client_event(text, text, text, text, text);
-- grant insert on table public.audit_logs to authenticated;
-- create policy audit_logs_insert_own_action on public.audit_logs as permissive for insert to authenticated
--     with check ((( select auth.uid() as uid) = user_id));
