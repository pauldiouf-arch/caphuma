-- ============================================================================
-- staff_national_detachement_etape2_country_nullable.sql
-- ----------------------------------------------------------------------------
-- Chantier « Staff national et détachement », étape 2 (référentiel pays/
-- nationalités) — retire une contrainte NOT NULL héritée qui bloquait la
-- création de poste depuis que le site n'écrit plus dans missions.country
-- (remplacée par missions.country_code, voir sql/staff_national_
-- detachement_socle_en_base.sql). Voir DOSSIER_PASSATION_TECHNIQUE.md §5.9
-- (étape 2) et §8 entrée 40. Reconstitué le 19/09/2026, faute d'avoir été
-- déposé au moment de son exécution réelle (règle 31) — voir Master Context
-- §2, session du 19/09/2026 (suite).
--
-- Ce script documente une migration DÉJÀ APPLIQUÉE en base (exécutée le
-- 17/09/2026). Il n'a pas besoin d'être rejoué sur ce projet Supabase.
-- L'instruction ci-dessous est sans effet si la colonne est déjà nullable
-- (Postgres ne lève pas d'erreur dans ce cas).
--
-- Rédigé le : 19/09/2026 (reconstitution a posteriori)
-- Exécuté en base le : 17/09/2026
-- ============================================================================

alter table public.missions
    alter column country drop not null;

-- ----------------------------------------------------------------------------
-- Rollback (règle 10) :
-- Nécessite d'abord de garantir qu'aucune ligne existante n'a country IS NULL,
-- sous peine d'échec de la contrainte :
-- alter table public.missions alter column country set not null;
-- ----------------------------------------------------------------------------
