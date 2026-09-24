-- Un compte suspendu (users.is_active = false) perd tout accès aux données dès sa requête suivante,
-- même avec une session encore ouverte : toutes les policies qui donnent un accès passent par
-- is_active_user(), has_active_role() ou is_admin(), qui exigent un compte actif.
-- Les policies qui ne portent que sur ses propres lignes (profil, préférences, journal, erreurs) sont inchangées.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 23/09/2026.

do $$
begin
    create or replace function public.is_active_user()
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $fn$
        select exists (
            select 1
            from public.users
            where id = auth.uid()
              and is_active is not false
        );
    $fn$;

    create or replace function public.has_active_role(variadic p_roles text[])
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $fn$
        select exists (
            select 1
            from public.users
            where id = auth.uid()
              and is_active is not false
              and role = any (p_roles)
        );
    $fn$;

    create or replace function public.is_admin()
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $fn$
        select public.has_active_role('admin');
    $fn$;

    revoke all on function public.is_active_user() from public, anon, authenticated, service_role;
    revoke all on function public.has_active_role(text[]) from public, anon, authenticated, service_role;
    grant execute on function public.is_active_user() to authenticated;
    grant execute on function public.has_active_role(text[]) to authenticated;

    alter policy audit_logs_select_admin_only on public.audit_logs
        using ((select public.is_admin()));

    alter policy comments_select_all_connected on public.comments
        using ((select public.is_active_user()));
    alter policy comments_insert_admin_user on public.comments
        with check ((select auth.uid()) = user_id and (select public.has_active_role('admin', 'user')));
    alter policy comments_update_admin_or_owner on public.comments
        using ((select public.is_admin()) or ((select auth.uid()) = user_id and (select public.has_active_role('user'))))
        with check ((select public.is_admin()) or ((select auth.uid()) = user_id and (select public.has_active_role('user'))));
    alter policy comments_delete_admin_or_owner on public.comments
        using ((select public.is_admin()) or ((select auth.uid()) = user_id and (select public.has_active_role('user'))));

    alter policy evaluations_select_authenticated on public.evaluations
        using ((select public.is_active_user()));
    alter policy evaluations_insert_own on public.evaluations
        with check (author_id = (select auth.uid()) and (select public.has_active_role('admin', 'user')));
    alter policy evaluations_update_own_or_admin on public.evaluations
        using ((select public.is_admin()) or (author_id = (select auth.uid()) and (select public.has_active_role('user'))))
        with check ((select public.is_admin()) or (author_id = (select auth.uid()) and (select public.has_active_role('user'))));
    alter policy evaluations_delete_own_or_admin on public.evaluations
        using ((select public.is_admin()) or (author_id = (select auth.uid()) and (select public.has_active_role('user'))));

    alter policy missions_select_authenticated on public.missions
        using ((select public.is_active_user()));
    alter policy missions_insert_admin_user on public.missions
        with check ((select public.has_active_role('admin', 'user')));
    alter policy missions_update_admin_user on public.missions
        using ((select public.has_active_role('admin', 'user')))
        with check ((select public.has_active_role('admin', 'user')));
    alter policy missions_delete_admin_user on public.missions
        using ((select public.has_active_role('admin', 'user')));

    alter policy pool_history_select_authenticated on public.pool_history
        using ((select public.is_active_user()));
    alter policy pool_history_insert_admin_user on public.pool_history
        with check ((select public.has_active_role('admin', 'user')));

    alter policy pools_select_authenticated on public.pools
        using ((select public.is_active_user()));
    alter policy pools_insert_admin on public.pools
        with check ((select public.is_admin()));
    alter policy pools_update_admin on public.pools
        using ((select public.is_admin()))
        with check ((select public.is_admin()));
    alter policy pools_delete_admin on public.pools
        using ((select public.is_admin()));

    alter policy share_tokens_select_own_or_admin on public.share_tokens
        using ((select public.is_admin()) or (created_by = (select auth.uid()) and (select public.is_active_user())));
    alter policy share_tokens_insert_admin_user on public.share_tokens
        with check (created_by = (select auth.uid()) and (select public.has_active_role('admin', 'user')));
    alter policy share_tokens_update_admin_or_creator on public.share_tokens
        using ((select public.is_admin()) or (created_by = (select auth.uid()) and (select public.is_active_user())))
        with check ((select public.is_admin()) or (created_by = (select auth.uid()) and (select public.is_active_user())));

    alter policy talents_select_all_connected on public.talents
        using ((select public.is_active_user()));
    alter policy talents_insert_admin_user on public.talents
        with check ((select public.has_active_role('admin', 'user')));
    alter policy talents_update_admin_user on public.talents
        using ((select public.has_active_role('admin', 'user')))
        with check ((select public.has_active_role('admin', 'user')));
    alter policy talents_delete_admin_only on public.talents
        using ((select public.is_admin()));

    alter policy red_list_docs_select_admin_user on storage.objects
        using (bucket_id = 'red-list-documents' and (select public.has_active_role('admin', 'user')));
    alter policy red_list_docs_insert_admin_user on storage.objects
        with check (bucket_id = 'red-list-documents' and (select public.has_active_role('admin', 'user')));
    alter policy red_list_docs_delete_admin_user on storage.objects
        using (bucket_id = 'red-list-documents' and (select public.has_active_role('admin', 'user')));
end $$;

-- Rollback :
-- alter policy audit_logs_select_admin_only on public.audit_logs using ((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))));
-- alter policy comments_delete_admin_or_owner on public.comments using (((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))) OR ((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'user'::text)))))));
-- alter policy comments_insert_admin_user on public.comments with check (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::text, 'user'::text])))))));
-- alter policy comments_select_all_connected on public.comments using (true);
-- alter policy comments_update_admin_or_owner on public.comments using (((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))) OR ((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'user'::text))))))) with check (((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))) OR ((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'user'::text)))))));
-- alter policy evaluations_delete_own_or_admin on public.evaluations using (((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))) OR ((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'user'::text)))))));
-- alter policy evaluations_insert_own on public.evaluations with check (((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text])))))));
-- alter policy evaluations_select_authenticated on public.evaluations using (true);
-- alter policy evaluations_update_own_or_admin on public.evaluations using (((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))) OR ((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'user'::text))))))) with check (((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))) OR ((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'user'::text)))))));
-- alter policy missions_delete_admin_user on public.missions using ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text]))))));
-- alter policy missions_insert_admin_user on public.missions with check ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text]))))));
-- alter policy missions_select_authenticated on public.missions using (true);
-- alter policy missions_update_admin_user on public.missions using ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text])))))) with check ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text]))))));
-- alter policy pool_history_insert_admin_user on public.pool_history with check ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text]))))));
-- alter policy pool_history_select_authenticated on public.pool_history using (true);
-- alter policy pools_delete_admin on public.pools using ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))));
-- alter policy pools_insert_admin on public.pools with check ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))));
-- alter policy pools_select_authenticated on public.pools using (true);
-- alter policy pools_update_admin on public.pools using ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text))))) with check ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = 'admin'::text)))));
-- alter policy share_tokens_insert_admin_user on public.share_tokens with check (((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'user'::text])))))));
-- alter policy share_tokens_select_own_or_admin on public.share_tokens using ((( SELECT is_admin() AS is_admin) OR (created_by = ( SELECT auth.uid() AS uid))));
-- alter policy share_tokens_update_admin_or_creator on public.share_tokens using ((is_admin() OR (created_by = ( SELECT auth.uid() AS uid)))) with check ((is_admin() OR (created_by = ( SELECT auth.uid() AS uid))));
-- alter policy talents_delete_admin_only on public.talents using ((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::text)))));
-- alter policy talents_insert_admin_user on public.talents with check ((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::text, 'user'::text]))))));
-- alter policy talents_select_all_connected on public.talents using (true);
-- alter policy talents_update_admin_user on public.talents using ((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::text, 'user'::text])))))) with check ((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::text, 'user'::text]))))));
-- alter policy red_list_docs_delete_admin_user on storage.objects using (((bucket_id = 'red-list-documents'::text) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['admin'::text, 'user'::text])))))));
-- alter policy red_list_docs_insert_admin_user on storage.objects with check (((bucket_id = 'red-list-documents'::text) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['admin'::text, 'user'::text])))))));
-- alter policy red_list_docs_select_admin_user on storage.objects using (((bucket_id = 'red-list-documents'::text) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['admin'::text, 'user'::text])))))));
-- CREATE OR REPLACE FUNCTION public.is_admin()
--  RETURNS boolean
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
--     SELECT EXISTS (
--         SELECT 1 FROM public.users
--         WHERE id = auth.uid()
--         AND role = 'admin'
--     );
-- $function$
-- ;
-- drop function if exists public.has_active_role(text[]);
-- drop function if exists public.is_active_user();
