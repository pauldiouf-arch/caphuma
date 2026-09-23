-- Droits d'appel retirés à anon et authenticated sur les 4 fonctions de déclencheur à droits étendus,
-- comme pour set_author_from_session(). Les déclencheurs continuent de s'exécuter.
-- Bucket red-list-documents : suppression ouverte aux recruteurs, sinon le retrait de la Liste Rouge
-- par un recruteur vidait la fiche sans supprimer les documents, refusés sans erreur par Storage.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 23/09/2026.

do $$
begin
    revoke execute on function public.audit_talents_changes() from public, anon, authenticated;
    revoke execute on function public.audit_missions_changes() from public, anon, authenticated;
    revoke execute on function public.audit_share_tokens_changes() from public, anon, authenticated;
    revoke execute on function public.enforce_missions_occupant_staff_type() from public, anon, authenticated;

    drop policy if exists red_list_docs_delete_admin on storage.objects;
    drop policy if exists red_list_docs_delete_admin_user on storage.objects;
    create policy red_list_docs_delete_admin_user on storage.objects
        for delete to authenticated
        using (
            bucket_id = 'red-list-documents'
            and exists (
                select 1
                from public.users u
                where u.id = auth.uid()
                  and u.role = any (array['admin', 'user'])
            )
        );
end $$;

-- Rollback :
-- grant execute on function public.audit_talents_changes() to public, anon, authenticated;
-- grant execute on function public.audit_missions_changes() to public, anon, authenticated;
-- grant execute on function public.audit_share_tokens_changes() to public, anon, authenticated;
-- grant execute on function public.enforce_missions_occupant_staff_type() to public, anon, authenticated;
-- drop policy if exists red_list_docs_delete_admin_user on storage.objects;
-- create policy red_list_docs_delete_admin on storage.objects for delete to authenticated
--     using (bucket_id = 'red-list-documents' and public.is_admin());
