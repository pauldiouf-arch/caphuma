-- Portes du visiteur pour la liste des talents et la fiche talent : le visiteur lit ces données par visitor_talents_page()
-- (20 talents par page, colonnes de la liste, 600 pages par heure) et visitor_talent_card() (une fiche, sans l'e-mail des
-- auteurs d'évaluations, 50 fiches par heure, chaque consultation journalisée avec l'action « view »).
-- Le visiteur garde pour l'instant sa lecture directe des tables : un script ultérieur la retirera.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 25/09/2026.

begin;

alter table public.audit_logs drop constraint if exists audit_logs_action_known;
alter table public.audit_logs add constraint audit_logs_action_known CHECK ((action = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text, 'login'::text, 'logout'::text, 'export'::text, 'add_to_red_list'::text, 'remove_from_red_list'::text, 'devalidate'::text, 'reintegrate'::text, 'view'::text])));

create or replace function public.visitor_talents_page(p_pool text, p_filters jsonb, p_page integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_uid uuid := auth.uid();
    v_f jsonb := coalesce(p_filters, '{}'::jsonb);
    v_pool text := nullif(left(p_pool, 50), '');
    v_page integer := least(greatest(coalesce(p_page, 0), 0), 100000);
    v_page_size constant integer := 20;
    v_search text := lower(nullif(left(v_f ->> 'search', 200), ''));
    v_keyword text := lower(nullif(left(v_f ->> 'keyword', 200), ''));
    v_status text := nullif(left(v_f ->> 'status', 100), '');
    v_validity text := nullif(v_f ->> 'validity', '');
    v_min_exp_alima integer := case when v_f ->> 'min_exp_alima' ~ '^[0-9]{1,4}$' then (v_f ->> 'min_exp_alima')::integer end;
    v_min_exp_hum integer := case when v_f ->> 'min_exp_humanitarian' ~ '^[0-9]{1,4}$' then (v_f ->> 'min_exp_humanitarian')::integer end;
    v_available_from timestamptz := case when v_f ->> 'available_from' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (v_f ->> 'available_from')::date::timestamptz end;
    v_available_to timestamptz := case when v_f ->> 'available_to' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (v_f ->> 'available_to')::date::timestamptz end;
    v_nationality_codes text[];
    v_country text := lower(nullif(left(v_f ->> 'country', 200), ''));
    v_language text := lower(nullif(left(v_f ->> 'language', 200), ''));
    v_visa text := nullif(v_f ->> 'has_visa', '');
    v_opening text := nullif(v_f ->> 'has_mission_opening', '');
    v_emergency text := nullif(v_f ->> 'has_emergency_mission', '');
    v_closure text := nullif(v_f ->> 'has_mission_closure', '');
    v_context text := lower(nullif(left(v_f ->> 'context', 200), ''));
    v_zone text := lower(nullif(left(v_f ->> 'zone', 200), ''));
    v_sort text := coalesce(nullif(v_f ->> 'sort_by', ''), 'integration');
    v_asc boolean := (v_f ->> 'sort_order') = 'asc';
    v_total integer;
    v_rows jsonb;
    v_tracked jsonb := '[]'::jsonb;
begin
    if v_uid is null or not public.has_active_role('visitor') then
        raise exception 'Accès refusé' using errcode = '42501';
    end if;

    if not public.check_and_record_rate_limit(v_uid, 'visitor_talents_page', 60, 600) then
        raise exception 'Limite de consultation atteinte (600 pages de liste par heure). Réessayez plus tard.' using errcode = '54000';
    end if;

    if jsonb_typeof(v_f -> 'nationality_codes') = 'array' then
        select coalesce(array_agg(left(c, 10)), '{}') into v_nationality_codes
        from jsonb_array_elements_text(v_f -> 'nationality_codes') c;
    end if;

    select count(*)::integer,
           coalesce(jsonb_agg(to_jsonb(r) - 'sort_rank' order by r.sort_rank)
                    filter (where r.sort_rank > v_page * v_page_size and r.sort_rank <= (v_page + 1) * v_page_size), '[]'::jsonb)
    into v_total, v_rows
    from (
        select t.id, t.first_name, t.last_name, t.current_function, t.status, t.pool, t.tracking_pool, t.staff_type,
               t.experience_months_alima, t.experience_months_humanitarian,
               t.availability_type, t.availability_months, t.availability_date,
               t.is_valid, t.is_red_listed, t.is_currently_on_mission, t.last_mission_end_date,
               t.pool_integration_date, t.months_without_mission, t.devalidation_extension_until,
               t.national_inactive_since, t.created_at,
               row_number() over (order by
                   case when v_sort = 'name' and v_asc then lower(t.last_name) end asc,
                   case when v_sort = 'name' and not v_asc then lower(t.last_name) end desc,
                   case when v_sort = 'name' and v_asc then lower(t.first_name) end asc,
                   case when v_sort = 'name' and not v_asc then lower(t.first_name) end desc,
                   case when v_sort = 'expAlima' and v_asc then coalesce(t.experience_months_alima, 0) end asc,
                   case when v_sort = 'expAlima' and not v_asc then coalesce(t.experience_months_alima, 0) end desc,
                   case when v_sort = 'expHumanitarian' and v_asc then coalesce(t.experience_months_humanitarian, 0) end asc,
                   case when v_sort = 'expHumanitarian' and not v_asc then coalesce(t.experience_months_humanitarian, 0) end desc,
                   case when v_sort = 'availability' and v_asc then a.available_at end asc,
                   case when v_sort = 'availability' and not v_asc then a.available_at end desc,
                   case when v_sort not in ('name', 'expAlima', 'expHumanitarian', 'availability') and v_asc then coalesce(t.pool_integration_date, 'epoch'::timestamptz) end asc,
                   case when v_sort not in ('name', 'expAlima', 'expHumanitarian', 'availability') and not v_asc then coalesce(t.pool_integration_date, 'epoch'::timestamptz) end desc,
                   t.id) as sort_rank
        from public.talents t
        cross join lateral (
            select case t.availability_type
                       when 'date' then t.availability_date::timestamptz
                       when 'notice' then case when coalesce(t.availability_months, 0) <> 0 then now() + t.availability_months * interval '30 days' end
                       when 'asap' then now()
                   end as available_at
        ) a
        where coalesce(t.is_valid, true)
          and not coalesce(t.is_red_listed, false)
          and v_validity is distinct from 'devalidated'
          and (case when v_pool is not null then t.pool = v_pool else t.staff_type = 'expat' end)
          and (v_status is null or t.status = v_status)
          and (v_search is null
               or position(v_search in lower(concat(coalesce(t.first_name, ''), ' ', coalesce(t.last_name, '')))) > 0
               or position(v_search in lower(coalesce(t.email, ''))) > 0
               or position(v_search in lower(coalesce(t.current_function, ''))) > 0)
          and (v_keyword is null
               or exists (select 1 from unnest(coalesce(t.key_skills, '{}')) s where position(v_keyword in lower(s)) > 0)
               or position(v_keyword in lower(coalesce(t.mission_opening_comments, ''))) > 0
               or position(v_keyword in lower(coalesce(t.emergency_mission_comments, ''))) > 0
               or position(v_keyword in lower(coalesce(t.closure_mission_comments, ''))) > 0
               or exists (
                   select 1
                   from jsonb_array_elements(case when jsonb_typeof(t.archived_position_passages) = 'array' then t.archived_position_passages else '[]'::jsonb end) p,
                        jsonb_array_elements(case when jsonb_typeof(p -> 'comments') = 'array' then p -> 'comments' else '[]'::jsonb end) c
                   where position(v_keyword in lower(coalesce(c ->> 'context', ''))) > 0
                      or position(v_keyword in lower(coalesce(nullif(c ->> 'positive_points', ''), c ->> 'positivePoints', ''))) > 0
                      or position(v_keyword in lower(coalesce(nullif(c ->> 'negative_points', ''), c ->> 'negativePoints', ''))) > 0
                      or position(v_keyword in lower(coalesce(c ->> 'content', ''))) > 0))
          and (v_min_exp_alima is null or coalesce(t.experience_months_alima, 0) >= v_min_exp_alima)
          and (v_min_exp_hum is null or coalesce(t.experience_months_humanitarian, 0) >= v_min_exp_hum)
          and (v_available_from is null or a.available_at >= v_available_from)
          and (v_available_to is null or a.available_at <= v_available_to)
          and (v_nationality_codes is null or t.nationality_code = any (v_nationality_codes))
          and (v_country is null or position(v_country in lower(coalesce(t.country_of_residence, ''))) > 0)
          and (v_language is null or exists (select 1 from unnest(coalesce(t.languages, '{}')) l where position(v_language in lower(l)) > 0))
          and (v_visa is null or coalesce(t.has_visa, false) = (v_visa = 'oui'))
          and (v_opening is null or coalesce(t.has_mission_opening, false) = (v_opening = 'oui'))
          and (v_emergency is null or coalesce(t.has_emergency_mission, false) = (v_emergency = 'oui'))
          and (v_closure is null or coalesce(t.has_mission_closure, false) = (v_closure = 'oui'))
          and (v_context is null or exists (select 1 from unnest(coalesce(t.intervention_contexts, '{}')) x where position(v_context in lower(x)) > 0))
          and (v_zone is null or exists (select 1 from unnest(coalesce(t.intervention_zones, '{}')) z where position(v_zone in lower(z)) > 0))
    ) r;

    if v_pool is not null then
        select coalesce(jsonb_agg(to_jsonb(r) order by lower(r.last_name), r.id), '[]'::jsonb) into v_tracked
        from (
            select t.id, t.first_name, t.last_name, t.current_function, t.status, t.pool, t.tracking_pool, t.staff_type,
                   t.is_valid, t.is_currently_on_mission, t.national_inactive_since, t.created_at
            from public.talents t
            where t.staff_type = 'national'
              and t.tracking_pool = v_pool
              and coalesce(t.is_valid, true)
              and not coalesce(t.is_red_listed, false)
        ) r;
    end if;

    return jsonb_build_object('total', v_total, 'page_size', v_page_size, 'rows', v_rows, 'tracked', v_tracked);
end;
$function$;

create or replace function public.visitor_talent_card(p_talent_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_uid uuid := auth.uid();
    v_talent public.talents%rowtype;
    v_passages jsonb;
    v_talent_json jsonb;
    v_missions jsonb;
    v_history jsonb;
    v_comments jsonb;
begin
    if v_uid is null or not public.has_active_role('visitor') then
        raise exception 'Accès refusé' using errcode = '42501';
    end if;

    if not public.check_and_record_rate_limit(v_uid, 'visitor_talent_card', 60, 50) then
        raise exception 'Limite de consultation atteinte (50 fiches par heure). Réessayez plus tard.' using errcode = '54000';
    end if;

    select * into v_talent
    from public.talents
    where id = p_talent_id
      and coalesce(is_valid, true)
      and not coalesce(is_red_listed, false);

    if not found then
        return jsonb_build_object('talent', null);
    end if;

    v_passages := v_talent.archived_position_passages;
    if jsonb_typeof(v_passages) = 'string' then
        begin
            v_passages := (v_passages #>> '{}')::jsonb;
        exception when others then
            v_passages := '[]'::jsonb;
        end;
    end if;
    if jsonb_typeof(v_passages) is distinct from 'array' then
        v_passages := '[]'::jsonb;
    end if;

    select coalesce(jsonb_agg(
               case when jsonb_typeof(p -> 'comments') = 'array'
                    then jsonb_set(p, '{comments}', (
                        select coalesce(jsonb_agg(c - 'author_email' order by n), '[]'::jsonb)
                        from jsonb_array_elements(p -> 'comments') with ordinality as e(c, n)))
                    else p
               end order by o), '[]'::jsonb)
    into v_passages
    from jsonb_array_elements(v_passages) with ordinality as x(p, o);

    v_talent_json := jsonb_build_object(
        'id', v_talent.id,
        'first_name', v_talent.first_name,
        'last_name', v_talent.last_name,
        'email', v_talent.email,
        'gender', v_talent.gender,
        'nationality_code', v_talent.nationality_code,
        'country_of_residence', v_talent.country_of_residence,
        'has_visa', v_talent.has_visa,
        'languages', v_talent.languages,
        'current_function', v_talent.current_function,
        'pool', v_talent.pool,
        'tracking_pool', v_talent.tracking_pool,
        'staff_type', v_talent.staff_type,
        'status', v_talent.status,
        'is_valid', v_talent.is_valid,
        'is_red_listed', v_talent.is_red_listed,
        'is_currently_on_mission', v_talent.is_currently_on_mission,
        'last_mission_end_date', v_talent.last_mission_end_date,
        'pool_integration_date', v_talent.pool_integration_date,
        'months_without_mission', v_talent.months_without_mission,
        'experience_months_alima', v_talent.experience_months_alima,
        'experience_months_humanitarian', v_talent.experience_months_humanitarian,
        'number_of_alima_missions', v_talent.number_of_alima_missions,
        'education_level', v_talent.education_level,
        'education_specialty', v_talent.education_specialty,
        'key_skills', v_talent.key_skills,
        'intervention_contexts', v_talent.intervention_contexts,
        'intervention_zones', v_talent.intervention_zones,
        'archived_position_passages', v_passages);

    select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into v_missions
    from (
        select id, title, pool, pool_id, country_code, candidate_type, contract_start_date
        from public.missions
        where occupant_id = p_talent_id
          and status = 'occupied'
    ) m;

    select coalesce(jsonb_agg(to_jsonb(h) order by h.changed_at desc), '[]'::jsonb) into v_history
    from (
        select from_pool, to_pool, changed_at, changed_by_name
        from public.pool_history
        where talent_id = p_talent_id
    ) h;

    select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb) into v_comments
    from (
        select id, content, author_email, created_at
        from public.comments
        where talent_id = p_talent_id
    ) c;

    insert into public.audit_logs (user_id, action, entity_type, entity_id, entity_name)
    values (v_uid, 'view', 'talent', p_talent_id::text,
            left(nullif(trim(concat(v_talent.first_name, ' ', v_talent.last_name)), ''), 1000));

    return jsonb_build_object(
        'talent', v_talent_json,
        'occupied_missions', v_missions,
        'pool_history', v_history,
        'comments', v_comments);
end;
$function$;

revoke all on function public.visitor_talents_page(text, jsonb, integer) from public, anon, authenticated, service_role;
grant execute on function public.visitor_talents_page(text, jsonb, integer) to authenticated;
revoke all on function public.visitor_talent_card(uuid) from public, anon, authenticated, service_role;
grant execute on function public.visitor_talent_card(uuid) to authenticated;

commit;

-- Rollback :
-- drop function if exists public.visitor_talents_page(text, jsonb, integer);
-- drop function if exists public.visitor_talent_card(uuid);
-- delete from public.audit_logs where action = 'view';
-- alter table public.audit_logs drop constraint if exists audit_logs_action_known;
-- alter table public.audit_logs add constraint audit_logs_action_known CHECK ((action = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text, 'login'::text, 'logout'::text, 'export'::text, 'add_to_red_list'::text, 'remove_from_red_list'::text, 'devalidate'::text, 'reintegrate'::text])));
