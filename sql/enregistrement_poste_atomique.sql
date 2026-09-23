-- Enregistrement, suppression et resynchronisation d'un poste, chacun en une seule opération :
-- sortie de l'occupant, libération d'un poste en conflit, écriture du poste et entrée du nouvel occupant
-- passent ensemble ou pas du tout. Remplace archive_mission_occupant(), supprimée.
-- save_mission() refuse l'enregistrement si les postes en conflit ne sont plus ceux affichés à l'écran.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Pas encore exécuté en base.

do $$
begin
    create or replace function public.save_mission(p_mission_id uuid, p_payload jsonb, p_vacate_mission_id uuid default null)
    returns uuid
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
        v_new public.missions;
        v_old public.missions;
        v_conflict public.missions;
        v_conflict_ids uuid[] := '{}';
        v_mission_id uuid;
    begin
        if not public.has_active_role('admin', 'user') then
            raise exception 'Accès refusé' using errcode = '42501';
        end if;

        v_new := jsonb_populate_record(null::public.missions, p_payload);

        if p_mission_id is not null then
            select * into v_old from public.missions where id = p_mission_id for update;
            if not found then
                raise exception 'Ce poste n''existe plus. Rechargez la page.' using errcode = 'P0002';
            end if;
        end if;

        if v_new.status = 'occupied' and v_new.occupant_id is not null then
            -- Postes puis talent, dans l'ordre de process_expired_missions() : deux enregistrements du même occupant passent l'un après l'autre sans interblocage.
            perform 1 from public.missions m
            where m.pool is not distinct from v_new.pool
              and m.id is distinct from p_mission_id
              and m.occupant_id = v_new.occupant_id
              and m.status = 'occupied'
              and (coalesce(m.candidate_type, '') = 'detache') = (coalesce(v_new.candidate_type, '') = 'detache')
            order by m.id
            for update;
            perform 1 from public.talents where id = v_new.occupant_id for update;

            select coalesce(array_agg(m.id order by m.id), '{}') into v_conflict_ids
            from public.missions m
            where m.pool is not distinct from v_new.pool
              and m.id is distinct from p_mission_id
              and m.occupant_id = v_new.occupant_id
              and m.status = 'occupied'
              and (coalesce(m.candidate_type, '') = 'detache') = (coalesce(v_new.candidate_type, '') = 'detache');
        end if;

        if v_conflict_ids is distinct from (case when p_vacate_mission_id is null then '{}'::uuid[] else array[p_vacate_mission_id] end) then
            raise exception 'La liste des postes a changé depuis l''ouverture de la page. Rechargez la page puis recommencez.'
                using errcode = 'P0001';
        end if;

        if p_vacate_mission_id is not null then
            select * into v_conflict from public.missions where id = p_vacate_mission_id;
            perform public.record_occupant_exit(v_conflict, current_date::timestamptz);
            update public.missions
            set status = 'vacant', occupant_id = null
            where id = p_vacate_mission_id;
        end if;

        if p_mission_id is not null then
            if v_old.occupant_id is not null and v_old.occupant_id is distinct from v_new.occupant_id then
                perform public.record_occupant_exit(v_old, current_date::timestamptz);
            end if;

            update public.missions
            set title = v_new.title,
                pool = v_new.pool,
                pool_level = v_new.pool_level,
                status = v_new.status,
                country_code = v_new.country_code,
                location = v_new.location,
                project_name = v_new.project_name,
                candidate_type = v_new.candidate_type,
                is_expat = v_new.is_expat,
                desk = v_new.desk,
                occupant_id = v_new.occupant_id,
                contract_start_date = v_new.contract_start_date,
                contract_end_type = v_new.contract_end_type,
                contract_end_date = v_new.contract_end_date,
                contract_status = v_new.contract_status,
                future_talent_id = v_new.future_talent_id,
                future_contract_start_date = v_new.future_contract_start_date,
                future_contract_end_date = v_new.future_contract_end_date
            where id = p_mission_id;
            v_mission_id := p_mission_id;
        else
            insert into public.missions (
                title, pool, pool_level, status, country_code, location, project_name, candidate_type, is_expat, desk,
                occupant_id, contract_start_date, contract_end_type, contract_end_date, contract_status,
                future_talent_id, future_contract_start_date, future_contract_end_date, created_by
            ) values (
                v_new.title, v_new.pool, v_new.pool_level, v_new.status, v_new.country_code, v_new.location,
                v_new.project_name, v_new.candidate_type, v_new.is_expat, v_new.desk,
                v_new.occupant_id, v_new.contract_start_date, v_new.contract_end_type, v_new.contract_end_date,
                v_new.contract_status, v_new.future_talent_id, v_new.future_contract_start_date,
                v_new.future_contract_end_date, auth.uid()
            )
            returning id into v_mission_id;
        end if;

        if v_new.occupant_id is not null and v_new.occupant_id is distinct from v_old.occupant_id then
            perform public.record_occupant_entry(v_new.occupant_id, v_new.candidate_type);
        end if;

        return v_mission_id;
    end;
    $fn$;

    create or replace function public.delete_mission(p_mission_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
        v_mission public.missions;
    begin
        if not public.has_active_role('admin', 'user') then
            raise exception 'Accès refusé' using errcode = '42501';
        end if;

        select * into v_mission from public.missions where id = p_mission_id for update;
        if not found then
            return;
        end if;

        if v_mission.occupant_id is not null then
            perform public.record_occupant_exit(v_mission, current_date::timestamptz);
        end if;

        delete from public.missions where id = p_mission_id;
    end;
    $fn$;

    create or replace function public.resync_mission_occupant(p_mission_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
        v_occupant_id uuid;
    begin
        if not public.has_active_role('admin', 'user') then
            raise exception 'Accès refusé' using errcode = '42501';
        end if;

        select occupant_id into v_occupant_id from public.missions where id = p_mission_id;
        if v_occupant_id is null then
            return;
        end if;

        -- 'nat' : remet l'occupant en poste sans compter une nouvelle mission ALIMA.
        perform public.record_occupant_entry(v_occupant_id, 'nat');
    end;
    $fn$;

    drop function if exists public.archive_mission_occupant(uuid, timestamptz);

    revoke all on function public.save_mission(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
    revoke all on function public.delete_mission(uuid) from public, anon, authenticated, service_role;
    revoke all on function public.resync_mission_occupant(uuid) from public, anon, authenticated, service_role;
    grant execute on function public.save_mission(uuid, jsonb, uuid) to authenticated;
    grant execute on function public.delete_mission(uuid) to authenticated;
    grant execute on function public.resync_mission_occupant(uuid) to authenticated;
end $$;

-- Rollback (remettre aussi en place l'ancienne version de pages/missions.js, pages/missions-crud.js et pages/missions-render.js) :
-- drop function if exists public.resync_mission_occupant(uuid);
-- drop function if exists public.delete_mission(uuid);
-- drop function if exists public.save_mission(uuid, jsonb, uuid);
-- create or replace function public.archive_mission_occupant(p_mission_id uuid, p_exit_date timestamptz default null)
-- returns void language plpgsql security definer set search_path = public as $fn$
-- declare
--     v_mission public.missions;
-- begin
--     if not public.has_active_role('admin', 'user') then
--         raise exception 'Accès refusé' using errcode = '42501';
--     end if;
--     select * into v_mission from public.missions where id = p_mission_id for update;
--     if v_mission.occupant_id is null then
--         return;
--     end if;
--     perform public.record_occupant_exit(v_mission, coalesce(p_exit_date, current_date::timestamptz));
-- end;
-- $fn$;
-- revoke all on function public.archive_mission_occupant(uuid, timestamptz) from public, anon, authenticated, service_role;
-- grant execute on function public.archive_mission_occupant(uuid, timestamptz) to authenticated;
