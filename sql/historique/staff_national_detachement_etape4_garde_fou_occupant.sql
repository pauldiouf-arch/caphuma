-- Barrière en base sur l'occupant d'un poste, à la création comme à la modification :
--   - poste 'expat' : jamais un staff national ;
--   - poste 'detache' niveau 'project' : uniquement un staff national.
-- Pas de blocage nationalité/pays sur un poste 'nat' : c'est volontairement une alerte non bloquante côté site.
-- Exécuté en base le 16/09/2026.

create or replace function public.enforce_missions_occupant_staff_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

drop trigger if exists trg_enforce_missions_occupant_staff_type on public.missions;
create trigger trg_enforce_missions_occupant_staff_type
    before insert or update on public.missions
    for each row execute function public.enforce_missions_occupant_staff_type();

-- Rollback :
-- drop trigger if exists trg_enforce_missions_occupant_staff_type on public.missions;
-- drop function if exists public.enforce_missions_occupant_staff_type();
