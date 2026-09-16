-- ============================================================================
-- staff_national_detachement_etape4_garde_fou_occupant.sql
-- ----------------------------------------------------------------------------
-- Étape 4, ajout demandé par l'utilisateur le 15/09/2026 : le filtrage des
-- listes déroulantes (missions.js) reste un confort d'usage, pas une
-- barrière — rien n'empêchait un accès direct à l'API Supabase d'affecter
-- n'importe quel talent à n'importe quel poste. Ce trigger pose une vraie
-- barrière en base, sur les 2 seules combinaisons réellement exclusives du
-- tableau §1.3 du plan (les 3 autres autorisent explicitement les deux
-- types de staff, rien à y bloquer) :
--   - poste candidate_type = 'expat' -> l'occupant ne peut pas être un staff
--     national ;
--   - poste candidate_type = 'detache' ET pool_level = 'project' -> l'occupant
--     ne peut être qu'un staff national (jamais un expatrié).
--
-- Volontairement PAS de blocage sur la correspondance nationalité/pays d'un
-- poste national (candidate_type = 'nat') : le plan la définit lui-même
-- comme une alerte non bloquante (§1.3, "contrôle supplémentaire"), pas
-- comme une règle stricte — un trigger plus strict que la règle métier
-- elle-même créerait une incohérence, pas une sécurité.
--
-- Se déclenche à la création ET à la modification d'un poste (un occupant
-- ou un type de poste peuvent changer après coup). Aucun effet sur un poste
-- sans occupant (occupant_id NULL) ni sur un poste sans candidate_type
-- précisé (NULL — aucune règle du tableau ne s'applique).
--
-- Rédigé le : 15/09/2026
-- Exécuté en base le : [16/09/2026]
-- ============================================================================

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

-- ----------------------------------------------------------------------------
-- Rollback (règle 10) :
-- drop trigger if exists trg_enforce_missions_occupant_staff_type on public.missions;
-- drop function if exists public.enforce_missions_occupant_staff_type();
-- ----------------------------------------------------------------------------
