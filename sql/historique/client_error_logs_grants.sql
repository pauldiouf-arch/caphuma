-- Correctif client_error_logs : GRANT absents à la création (règle 30) et clé étrangère vers users
-- sans règle ON DELETE, qui aurait bloqué la suppression d'un compte ayant déclenché une erreur.
-- Décision du 22/09/2026 : ON DELETE SET NULL, l'erreur reste consultable jusqu'à sa purge à 6 mois.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 22/09/2026.

do $$
begin
    grant insert, select on public.client_error_logs to authenticated;
    grant select, delete on public.client_error_logs to service_role;

    alter table public.client_error_logs drop constraint if exists client_error_logs_user_id_fkey;
    alter table public.client_error_logs
        add constraint client_error_logs_user_id_fkey
        foreign key (user_id) references public.users(id) on delete set null;
end $$;

-- Rollback :
-- revoke insert, select on public.client_error_logs from authenticated;
-- revoke select, delete on public.client_error_logs from service_role;
-- alter table public.client_error_logs drop constraint if exists client_error_logs_user_id_fkey;
-- alter table public.client_error_logs add constraint client_error_logs_user_id_fkey foreign key (user_id) references public.users(id);
