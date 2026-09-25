-- Portes du visiteur pour les postes, les évaluations d'un poste et les statistiques :
-- visitor_pool_missions() (postes d'un pool et noms des occupants, dans le quota de 600 pages de liste par heure),
-- visitor_mission_evaluations() (évaluations d'un poste sans auteur, dans le quota de 50 fiches par heure, consultation
-- journalisée avec l'action « view ») et visitor_statistics_rows() (lignes anonymes des statistiques, 60 chargements par heure).
-- Le visiteur garde pour l'instant sa lecture directe des tables : un script ultérieur la retirera.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 25/09/2026.

begin;

create or replace function public.visitor_pool_missions(p_pool text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_uid uuid := auth.uid();
    v_missions jsonb;
    v_names jsonb;
begin
    if v_uid is null or not public.has_active_role('visitor') then
        raise exception 'Accès refusé' using errcode = '42501';
    end if;

    if not public.check_and_record_rate_limit(v_uid, 'visitor_talents_page', 60, 600) then
        raise exception 'Limite de consultation atteinte (600 pages de liste par heure). Réessayez plus tard.' using errcode = '54000';
    end if;

    select coalesce(jsonb_agg(to_jsonb(m) order by m.title, m.id), '[]'::jsonb) into v_missions
    from (
        select id, title, pool, pool_level, status, country, country_code, location, project_name, candidate_type, desk,
               occupant_id, contract_start_date, contract_end_date, contract_end_type, contract_status,
               future_talent_id, future_contract_start_date, future_contract_end_date
        from public.missions
        where pool = p_pool
    ) m;

    select coalesce(jsonb_object_agg(t.id, trim(concat(coalesce(t.first_name, ''), ' ', coalesce(t.last_name, '')))), '{}'::jsonb)
    into v_names
    from public.talents t
    where (t.pool = p_pool or (t.staff_type = 'national' and t.tracking_pool = p_pool))
      and coalesce(t.is_valid, true)
      and not coalesce(t.is_red_listed, false)
      and exists (
          select 1 from public.missions m
          where m.pool = p_pool
            and t.id in (m.occupant_id, m.future_talent_id));

    return jsonb_build_object('missions', v_missions, 'talent_names', v_names);
end;
$function$;

create or replace function public.visitor_mission_evaluations(p_mission_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_uid uuid := auth.uid();
    v_title text;
    v_evaluations jsonb;
begin
    if v_uid is null or not public.has_active_role('visitor') then
        raise exception 'Accès refusé' using errcode = '42501';
    end if;

    if not public.check_and_record_rate_limit(v_uid, 'visitor_talent_card', 60, 50) then
        raise exception 'Limite de consultation atteinte (50 fiches par heure). Réessayez plus tard.' using errcode = '54000';
    end if;

    select title into v_title from public.missions where id = p_mission_id;
    if not found then
        return '[]'::jsonb;
    end if;

    select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) into v_evaluations
    from (
        select ev.id, ev.mission_id, ev.talent_id, ev.context, ev.positive_points, ev.negative_points, ev.rating, ev.created_at
        from public.evaluations ev
        where ev.mission_id = p_mission_id
          and (ev.talent_id is null or exists (
              select 1 from public.talents t
              where t.id = ev.talent_id
                and coalesce(t.is_valid, true)
                and not coalesce(t.is_red_listed, false)))
    ) e;

    insert into public.audit_logs (user_id, action, entity_type, entity_id, entity_name, details)
    values (v_uid, 'view', 'mission', p_mission_id::text, left(v_title, 1000), 'Évaluations du poste');

    return v_evaluations;
end;
$function$;

create or replace function public.visitor_statistics_rows()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_uid uuid := auth.uid();
    v_talents jsonb;
    v_missions jsonb;
begin
    if v_uid is null or not public.has_active_role('visitor') then
        raise exception 'Accès refusé' using errcode = '42501';
    end if;

    if not public.check_and_record_rate_limit(v_uid, 'visitor_statistics_rows', 60, 60) then
        raise exception 'Limite de consultation atteinte (60 chargements des statistiques par heure). Réessayez plus tard.' using errcode = '54000';
    end if;

    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_talents
    from (
        select pool, status, is_valid, is_red_listed, is_currently_on_mission, last_mission_end_date, months_without_mission,
               pool_integration_date, experience_months_alima, availability_type, availability_date, availability_months,
               gender, nationality_code, languages
        from public.talents
        where staff_type = 'expat'
          and coalesce(is_valid, true)
          and not coalesce(is_red_listed, false)
    ) t;

    select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into v_missions
    from (
        select pool, pool_id, status, candidate_type, contract_start_date, contract_end_date, contract_status, country_code, desk,
               case when future_talent_id is not null then true end as future_talent_id
        from public.missions
    ) m;

    return jsonb_build_object('talents', v_talents, 'missions', v_missions);
end;
$function$;

revoke all on function public.visitor_pool_missions(text) from public, anon, authenticated, service_role;
grant execute on function public.visitor_pool_missions(text) to authenticated;
revoke all on function public.visitor_mission_evaluations(uuid) from public, anon, authenticated, service_role;
grant execute on function public.visitor_mission_evaluations(uuid) to authenticated;
revoke all on function public.visitor_statistics_rows() from public, anon, authenticated, service_role;
grant execute on function public.visitor_statistics_rows() to authenticated;

commit;

-- Rollback :
-- drop function if exists public.visitor_pool_missions(text);
-- drop function if exists public.visitor_mission_evaluations(uuid);
-- drop function if exists public.visitor_statistics_rows();
-- delete from public.audit_logs where action = 'view' and entity_type = 'mission';
