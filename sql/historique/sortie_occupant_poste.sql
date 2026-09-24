-- Sortie et entrée d'un occupant de poste, et traitement en base des contrats échus : briques internes
-- record_occupant_exit() et record_occupant_entry() (aucun droit pour le site), archive_mission_occupant()
-- et process_expired_missions() (droits étendus, contrôle admin ou recruteur actif).
-- Exécuté en base le 23/09/2026, reconstitué le 24/09/2026 d'après le code en base (pg_get_functiondef) :
-- ne pas rejouer, archive_mission_occupant() a été supprimée depuis par enregistrement_poste_atomique.sql.

do $$
begin
CREATE OR REPLACE FUNCTION public.record_occupant_exit(p_mission missions, p_exit_date timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    declare
        v_passage jsonb;
        v_is_national boolean;
    begin
        v_passage := jsonb_build_object(
            'positionTitle', case when p_mission.candidate_type = 'detache' then 'Détachement — ' else '' end || p_mission.title,
            'pool', p_mission.pool,
            'countryCode', nullif(p_mission.country_code, ''),
            'desk', nullif(p_mission.desk, ''),
            'startDate', p_mission.contract_start_date,
            'endDate', p_exit_date,
            'comments', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'context', e.context,
                    'positive_points', e.positive_points,
                    'negative_points', e.negative_points,
                    'rating', e.rating,
                    'author_email', e.author_email,
                    'created_at', e.created_at
                ) order by e.created_at)
                from public.evaluations e
                where e.mission_id = p_mission.id
            ), '[]'::jsonb)
        );

        update public.talents
        set archived_position_passages = case
                when jsonb_typeof(archived_position_passages) = 'array' then archived_position_passages || jsonb_build_array(v_passage)
                else jsonb_build_array(v_passage)
            end
        where id = p_mission.occupant_id
        returning staff_type = 'national' into v_is_national;

        if not found then
            raise exception 'Occupant % du poste % introuvable', p_mission.occupant_id, p_mission.id;
        end if;

        delete from public.evaluations where mission_id = p_mission.id;

        if p_mission.candidate_type = 'detache' then
            return;
        end if;

        update public.talents
        set is_currently_on_mission = false,
            last_mission_end_date = p_exit_date,
            status = 'En attente de poste',
            national_inactive_since = case when v_is_national then p_exit_date::date else national_inactive_since end
        where id = p_mission.occupant_id;
    end;
    $function$;

CREATE OR REPLACE FUNCTION public.record_occupant_entry(p_talent_id uuid, p_candidate_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    begin
        if p_talent_id is null or p_candidate_type = 'detache' then
            return;
        end if;

        update public.talents
        set is_currently_on_mission = true,
            months_without_mission = 0,
            last_mission_end_date = null,
            national_inactive_since = null,
            status = 'En poste ALIMA',
            number_of_alima_missions = case
                when p_candidate_type <> 'expat' then number_of_alima_missions
                when coalesce(number_of_alima_missions, 'none') = 'none' then 'one'
                when number_of_alima_missions = 'one' then 'two'
                else 'three_plus'
            end,
            had_alima_mission = case when p_candidate_type = 'expat' then true else had_alima_mission end
        where id = p_talent_id;

        if not found then
            raise exception 'Talent entrant % introuvable', p_talent_id;
        end if;
    end;
    $function$;

CREATE OR REPLACE FUNCTION public.archive_mission_occupant(p_mission_id uuid, p_exit_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    declare
        v_mission public.missions;
    begin
        if not public.has_active_role('admin', 'user') then
            raise exception 'Accès refusé' using errcode = '42501';
        end if;

        select * into v_mission from public.missions where id = p_mission_id for update;
        if v_mission.occupant_id is null then
            return;
        end if;

        perform public.record_occupant_exit(v_mission, coalesce(p_exit_date, current_date::timestamptz));
    end;
    $function$;

CREATE OR REPLACE FUNCTION public.process_expired_missions(p_pool text)
 RETURNS TABLE(rotated_count integer, vacated_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    declare
        v_mission public.missions;
        v_detachment public.missions;
    begin
        if not public.has_active_role('admin', 'user') then
            raise exception 'Accès refusé' using errcode = '42501';
        end if;

        rotated_count := 0;
        vacated_count := 0;

        for v_mission in
            select * from public.missions
            where pool = p_pool
              and status = 'occupied'
              and contract_end_type = 'date'
              and contract_end_date < now()
              and contract_status = 'ending'
            order by contract_end_date
            for update skip locked
        loop
            begin
                if v_mission.occupant_id is not null then
                    perform public.record_occupant_exit(v_mission, v_mission.contract_end_date);
                end if;

                if v_mission.candidate_type = 'nat' and v_mission.occupant_id is not null then
                    for v_detachment in
                        select * from public.missions
                        where occupant_id = v_mission.occupant_id
                          and candidate_type = 'detache'
                          and status = 'occupied'
                        for update
                    loop
                        perform public.record_occupant_exit(v_detachment, v_mission.contract_end_date);
                        update public.missions
                        set status = 'vacant', occupant_id = null, contract_end_date = v_mission.contract_end_date
                        where id = v_detachment.id;
                    end loop;
                end if;

                if v_mission.future_talent_id is not null then
                    update public.missions
                    set status = 'occupied',
                        occupant_id = future_talent_id,
                        contract_start_date = future_contract_start_date,
                        contract_end_date = future_contract_end_date,
                        contract_status = null,
                        future_talent_id = null,
                        future_contract_start_date = null,
                        future_contract_end_date = null
                    where id = v_mission.id;
                    perform public.record_occupant_entry(v_mission.future_talent_id, v_mission.candidate_type);
                    rotated_count := rotated_count + 1;
                else
                    update public.missions
                    set status = 'vacant', occupant_id = null
                    where id = v_mission.id;
                    vacated_count := vacated_count + 1;
                end if;
            exception when others then
                raise warning 'Contrat échu du poste % non traité : %', v_mission.id, sqlerrm;
            end;
        end loop;

        return next;
    end;
    $function$;

    revoke all on function public.record_occupant_exit(public.missions, timestamptz) from public, anon, authenticated, service_role;
    revoke all on function public.record_occupant_entry(uuid, text) from public, anon, authenticated, service_role;
    revoke all on function public.archive_mission_occupant(uuid, timestamptz) from public, anon, authenticated, service_role;
    revoke all on function public.process_expired_missions(text) from public, anon, authenticated, service_role;
    grant execute on function public.archive_mission_occupant(uuid, timestamptz) to authenticated;
    grant execute on function public.process_expired_missions(text) to authenticated;
end $$;

-- Rollback (save_mission(), delete_mission() et resync_mission_occupant() dépendent des deux briques internes) :
-- drop function if exists public.process_expired_missions(text);
-- drop function if exists public.archive_mission_occupant(uuid, timestamptz);
-- drop function if exists public.record_occupant_entry(uuid, text);
-- drop function if exists public.record_occupant_exit(public.missions, timestamptz);
