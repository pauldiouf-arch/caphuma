-- Retire le NOT NULL hérité de missions.country : le site écrit désormais missions.country_code.
-- Migration déjà appliquée, sans effet si la colonne est déjà nullable.
-- Exécuté en base le 17/09/2026, reconstitué le 19/09/2026.

alter table public.missions
    alter column country drop not null;

-- Rollback (vérifier d'abord qu'aucune ligne n'a country à NULL) :
-- alter table public.missions alter column country set not null;
