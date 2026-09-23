-- Changement de pool d'un expat et passage d'un national en expat, chacun en une seule opération :
-- la ligne d'historique et la mise à jour du talent passent ensemble ou pas du tout.
-- Droits de l'appelant (security invoker) : les policies RLS actuelles s'appliquent telles quelles.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 23/09/2026.

do $$
begin
    create or replace function public.change_talent_pool(p_talent_id uuid, p_new_pool text)
    returns void
    language plpgsql
    security invoker
    set search_path = public
    as $fn$
    declare
        v_current_pool text;
        v_staff_type text;
    begin
        select pool, staff_type
        into v_current_pool, v_staff_type
        from public.talents
        where id = p_talent_id
        for update;

        if not found then
            raise exception 'Talent introuvable ou modification non autorisée' using errcode = '42501';
        end if;
        if v_staff_type = 'national' then
            raise exception 'Un staff national passe par le passage en expat' using errcode = '22023';
        end if;
        if v_current_pool is not distinct from p_new_pool then
            raise exception 'Le talent est déjà dans ce pool' using errcode = '22023';
        end if;

        insert into public.pool_history (talent_id, from_pool, to_pool)
        values (p_talent_id, v_current_pool, p_new_pool);

        update public.talents
        set pool = p_new_pool,
            months_without_mission = 0,
            last_mission_end_date = null,
            pool_integration_date = now()
        where id = p_talent_id;
    end;
    $fn$;

    create or replace function public.promote_national_to_expat(p_talent_id uuid, p_pool text)
    returns void
    language plpgsql
    security invoker
    set search_path = public
    as $fn$
    declare
        v_staff_type text;
    begin
        select staff_type
        into v_staff_type
        from public.talents
        where id = p_talent_id
        for update;

        if not found then
            raise exception 'Talent introuvable ou modification non autorisée' using errcode = '42501';
        end if;
        if v_staff_type <> 'national' then
            raise exception 'Le talent est déjà expat' using errcode = '22023';
        end if;

        insert into public.pool_history (talent_id, from_pool, to_pool)
        values (p_talent_id, null, p_pool);

        update public.talents
        set staff_type = 'expat',
            pool = p_pool,
            national_inactive_since = null,
            months_without_mission = 0,
            last_mission_end_date = null,
            pool_integration_date = now()
        where id = p_talent_id;
    end;
    $fn$;

    revoke all on function public.change_talent_pool(uuid, text) from public, anon, authenticated, service_role;
    revoke all on function public.promote_national_to_expat(uuid, text) from public, anon, authenticated, service_role;
    grant execute on function public.change_talent_pool(uuid, text) to authenticated;
    grant execute on function public.promote_national_to_expat(uuid, text) to authenticated;
end $$;

-- Rollback :
-- drop function if exists public.promote_national_to_expat(uuid, text);
-- drop function if exists public.change_talent_pool(uuid, text);
