-- Plus aucune modification de la table users depuis le site : suspension et réactivation passent par
-- l'Edge Function manage-users, seule à pouvoir aussi bloquer la connexion et couper les sessions.
-- À exécuter après le déploiement de manage-users et de pages/admin.js qui appellent les actions suspend/reactivate.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 23/09/2026.

do $$
begin
    drop policy if exists users_update_admin_all on public.users;
    revoke update on public.users from authenticated;
end $$;

-- Rollback :
-- create policy users_update_admin_all on public.users as permissive for update to authenticated
--     using (( SELECT is_admin() AS is_admin))
--     with check (( SELECT is_admin() AS is_admin));
-- grant update on public.users to authenticated;
