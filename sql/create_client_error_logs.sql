-- Erreurs JS non gérées côté navigateur (captureError() / persistErrorLog(), shared/caphuma-utils.js).
-- RLS calquée sur audit_logs : chacun n'insère que ses propres lignes, seul un admin lit,
-- aucune policy UPDATE/DELETE. Purge après 6 mois par monthly-maintenance (service_role).
-- Exécuté en base le 22/09/2026, reconstitué le même jour d'après la base réelle
-- (information_schema, pg_policies, pg_constraint, pg_indexes) : ne pas rejouer sur ce projet.
-- Aucun GRANT n'a été posé à la création : corrigé par client_error_logs_grants.sql (22/09/2026).

create table public.client_error_logs (
    id uuid not null default gen_random_uuid(),
    created_at timestamp with time zone default now(),
    kind text not null,
    detail text,
    page text,
    user_id uuid,
    user_email text,
    constraint client_error_logs_pkey primary key (id),
    constraint client_error_logs_user_id_fkey foreign key (user_id) references public.users(id)
);

create index idx_client_error_logs_created_at on public.client_error_logs using btree (created_at);
create index idx_client_error_logs_user_id on public.client_error_logs using btree (user_id);

alter table public.client_error_logs enable row level security;

create policy "Insert own error log" on public.client_error_logs
    for insert to authenticated
    with check (user_id = auth.uid());

create policy "Admin can read error logs" on public.client_error_logs
    for select to authenticated
    using (is_admin());

-- Rollback :
-- drop table if exists public.client_error_logs;
