-- Table technique de limite de débit des Edge Functions : compteurs uniquement, pas de clé étrangère vers users.
-- RLS activé sans aucune policy : seul service_role y accède (voir rate_limit_log_grant_service_role.sql).
-- Exécuté en base le 14/08/2026.

create table public.rate_limit_log (
    id bigint generated always as identity primary key,
    user_id uuid not null,
    function_name text not null,
    created_at timestamp with time zone not null default now()
);

alter table public.rate_limit_log enable row level security;

-- Rollback :
-- drop table public.rate_limit_log;
