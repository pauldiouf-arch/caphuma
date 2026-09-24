-- Socle en base du chantier « Staff national et détachement » : colonnes et contraintes sur talents et missions.
-- Migration déjà appliquée, inutile de la rejouer sur ce projet. Rejouable sans risque sur une autre base
-- (IF NOT EXISTS, erreur de contrainte déjà existante ignorée).
-- Noms de contraintes et d'index : convention Postgres par défaut, identiques à schema_snapshot_2026-09-19.sql.
-- Exécuté en base vers le 15-16/09/2026 (date exacte non tracée), reconstitué le 19/09/2026.

alter table public.talents
    add column if not exists staff_type text not null default 'expat',
    add column if not exists national_inactive_since date,
    add column if not exists nationality_code text,
    add column if not exists tracking_pool text;

do $$
begin
    alter table public.talents
        add constraint talents_staff_type_check check (staff_type in ('expat', 'national'));
exception
    when duplicate_object then null;
end $$;

do $$
begin
    alter table public.talents
        add constraint talents_tracking_pool_fkey foreign key (tracking_pool) references public.pools(pool_id);
exception
    when duplicate_object then null;
end $$;

create index if not exists idx_talents_tracking_pool on public.talents (tracking_pool);
create index if not exists idx_talents_tracking_pool_is_valid on public.talents (tracking_pool, is_valid);

alter table public.missions
    add column if not exists contract_end_type text not null default 'date',
    add column if not exists detachment_source_mission_id uuid,
    add column if not exists country_code text;

do $$
begin
    alter table public.missions
        add constraint missions_contract_end_type_check check (contract_end_type in ('date', 'cdi', 'ongoing'));
exception
    when duplicate_object then null;
end $$;

do $$
begin
    alter table public.missions
        add constraint missions_detachment_source_mission_id_fkey foreign key (detachment_source_mission_id) references public.missions(id);
exception
    when duplicate_object then null;
end $$;

alter table public.missions
    drop constraint if exists missions_candidate_type_check;

alter table public.missions
    add constraint missions_candidate_type_check check (candidate_type in ('expat', 'nat', 'detache'));

-- Rollback :
-- alter table public.missions drop constraint if exists missions_candidate_type_check;
-- alter table public.missions add constraint missions_candidate_type_check check (candidate_type in ('expat', 'nat'));
-- alter table public.missions drop constraint if exists missions_detachment_source_mission_id_fkey;
-- alter table public.missions drop constraint if exists missions_contract_end_type_check;
-- alter table public.missions drop column if exists country_code;
-- alter table public.missions drop column if exists detachment_source_mission_id;
-- alter table public.missions drop column if exists contract_end_type;
-- drop index if exists idx_talents_tracking_pool_is_valid;
-- drop index if exists idx_talents_tracking_pool;
-- alter table public.talents drop constraint if exists talents_tracking_pool_fkey;
-- alter table public.talents drop constraint if exists talents_staff_type_check;
-- alter table public.talents drop column if exists tracking_pool;
-- alter table public.talents drop column if exists nationality_code;
-- alter table public.talents drop column if exists national_inactive_since;
-- alter table public.talents drop column if exists staff_type;
