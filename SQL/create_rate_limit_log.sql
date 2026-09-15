-- ============================================================================
-- create_rate_limit_log.sql
-- ----------------------------------------------------------------------------
-- Table technique support de la limite de débit sur manage-users / ai-proxy
-- (fenêtre glissante de 10 minutes, seuil de 20 appels par utilisateur,
-- lignes de plus d'1h nettoyées à chaque appel). Ne contient aucune donnée
-- métier, uniquement des compteurs techniques — pas de clé étrangère vers
-- "users" par choix assumé (voir Dossier technique §4.1).
--
-- RLS activé mais SANS AUCUNE policy, sur aucune des 4 opérations : refus
-- total pour authenticated/anon, y compris admin. Seul service_role (utilisé
-- par les Edge Functions, qui bypass RLS par nature) peut y lire/écrire, via
-- des GRANT explicites — voir rate_limit_log_grant_service_role.sql.
--
-- Exécuté en base le : 14/08/2026
-- Versionné dans ce fichier le : 18/08/2026 (chantier A4) — reconstitué
-- fidèlement depuis information_schema.columns / pg_class (jamais sauvegardé
-- en fichier au moment de l'exécution, voir Dossier de passation, Annexe B,
-- écart noté honnêtement).
-- ============================================================================

create table public.rate_limit_log (
    id bigint generated always as identity primary key,
    user_id uuid not null,
    function_name text not null,
    created_at timestamp with time zone not null default now()
);

alter table public.rate_limit_log enable row level security;

-- ----------------------------------------------------------------------------
-- Rollback (règle 10) :
-- drop table public.rate_limit_log;
-- ----------------------------------------------------------------------------
