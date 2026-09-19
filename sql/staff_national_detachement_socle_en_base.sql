-- ============================================================================
-- staff_national_detachement_socle_en_base.sql
-- ----------------------------------------------------------------------------
-- Chantier « Staff national et détachement » (PLAN_STAFF_NATIONAL_ET_
-- DETACHEMENT.md), socle structurel en base — colonnes et contraintes dont
-- dépendent les étapes suivantes (référentiel pays, fiches staff national,
-- garde-fous d'occupant, automatismes). Reconstitué le 19/09/2026 par diff
-- entre sql/schema_snapshot_2026-09-12.sql et sql/schema_snapshot_2026-09-19.sql,
-- faute d'avoir été déposé au moment de son exécution réelle (autour du
-- 15-16/09/2026) — voir Master Context règle 31.
--
-- Ce script documente une migration DÉJÀ APPLIQUÉE en base. Il n'a pas besoin
-- d'être rejoué sur ce projet Supabase. Les ADD COLUMN sont protégés par
-- IF NOT EXISTS ; les ADD CONSTRAINT sont enveloppées dans des blocs qui
-- ignorent l'erreur si la contrainte existe déjà, pour rester rejouables sans
-- risque sur une base qui a déjà ce socle (utile en cas de restauration ou de
-- second projet Supabase, cf. Guide §2.6/B6).
--
-- talents (+4 colonnes) :
--   - staff_type : distingue un staff expatrié d'un staff national. NOT NULL,
--     défaut 'expat' pour que les lignes existantes restent valides sans
--     backfill manuel (tout le monde était expatrié avant ce chantier).
--   - national_inactive_since : date depuis laquelle un staff national n'a
--     plus de poste (alimentée par pages/missions.js — voir Guide §1.38).
--   - nationality_code : code pays ISO de la nationalité (référentiel
--     shared/caphuma-countries.js), distinct de la colonne nationality
--     (texte libre préexistant, non touchée).
--   - tracking_pool : pool de suivi d'un staff national une fois sans poste
--     (FK -> pools, indexée seule et combinée avec is_valid : la liste d'un
--     pool doit retrouver rapidement ses staffs nationaux suivis).
--
-- missions (+3 colonnes) :
--   - contract_end_type : nature de la fin de contrat (date fixe, CDI, sans
--     fin prévue). NOT NULL, défaut 'date' — comportement inchangé pour les
--     postes existants.
--   - detachment_source_mission_id : auto-référence vers le poste national
--     d'origine d'un détachement (renseignée seulement si pool_level =
--     'project' et candidate_type = 'detache').
--   - country_code : code pays ISO du poste (même référentiel que
--     nationality_code).
--
-- missions_candidate_type_check élargie pour autoriser 'detache' (troisième
-- valeur, à côté de 'expat'/'nat' déjà existantes).
--
-- Noms de contraintes/index non tracés au moment de l'exécution réelle :
-- ceux ci-dessous suivent la convention par défaut de Postgres
-- (<table>_<colonne>_fkey / _check) et correspondent à ceux observés dans
-- sql/schema_snapshot_2026-09-19.sql.
--
-- Rédigé le : 19/09/2026 (reconstitution a posteriori)
-- Exécuté en base le : ~15-16/09/2026 (date exacte non tracée)
-- ============================================================================

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

-- ----------------------------------------------------------------------------
-- Rollback (règle 10) :
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
-- ----------------------------------------------------------------------------
