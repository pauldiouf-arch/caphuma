-- Auteur affiché imposé par la base, d'après le compte connecté, au lieu de la valeur envoyée par le site :
-- comments.author_email, evaluations.author_email, pool_history.changed_by/changed_by_name,
-- client_error_logs.user_email. Une modification de commentaire ou d'évaluation conserve l'auteur d'origine.
-- client_error_logs : longueur limitée, 100 erreurs par compte sur 24 h, 10 000 lignes au total.
-- Sans compte connecté (éditeur SQL, service_role), rien n'est modifié.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 23/09/2026.

do $$
begin
    create or replace function public.set_author_from_session()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
        v_uid uuid := auth.uid();
        v_email text;
        v_name text;
    begin
        if v_uid is null then
            return new;
        end if;

        if tg_op = 'UPDATE' then
            new.author_email := old.author_email;
            return new;
        end if;

        select email, coalesce(nullif(name, ''), email)
        into v_email, v_name
        from public.users
        where id = v_uid;

        if tg_table_name in ('comments', 'evaluations') then
            new.author_email := v_email;
        elsif tg_table_name = 'pool_history' then
            new.changed_by := v_uid;
            new.changed_by_name := v_name;
        elsif tg_table_name = 'client_error_logs' then
            -- created_at imposé : une date passée contournerait le quota sur 24 h.
            new.created_at := now();
            new.user_email := v_email;
            if (select count(*) from public.client_error_logs
                where user_id = v_uid and created_at > now() - interval '24 hours') >= 100
               or (select count(*) from public.client_error_logs) >= 10000 then
                return null;
            end if;
        end if;

        return new;
    end;
    $fn$;

    revoke execute on function public.set_author_from_session() from public, anon, authenticated;

    drop trigger if exists trg_set_author_comments on public.comments;
    create trigger trg_set_author_comments
        before insert or update on public.comments
        for each row execute function public.set_author_from_session();

    drop trigger if exists trg_set_author_evaluations on public.evaluations;
    create trigger trg_set_author_evaluations
        before insert or update on public.evaluations
        for each row execute function public.set_author_from_session();

    drop trigger if exists trg_set_author_pool_history on public.pool_history;
    create trigger trg_set_author_pool_history
        before insert on public.pool_history
        for each row execute function public.set_author_from_session();

    drop trigger if exists trg_set_author_client_error_logs on public.client_error_logs;
    create trigger trg_set_author_client_error_logs
        before insert on public.client_error_logs
        for each row execute function public.set_author_from_session();

    alter table public.client_error_logs drop constraint if exists client_error_logs_kind_length;
    alter table public.client_error_logs drop constraint if exists client_error_logs_detail_length;
    alter table public.client_error_logs drop constraint if exists client_error_logs_page_length;
    alter table public.client_error_logs add constraint client_error_logs_kind_length check (char_length(kind) <= 100);
    alter table public.client_error_logs add constraint client_error_logs_detail_length check (char_length(detail) <= 2000);
    alter table public.client_error_logs add constraint client_error_logs_page_length check (char_length(page) <= 500);
end $$;

-- Rollback :
-- drop trigger if exists trg_set_author_comments on public.comments;
-- drop trigger if exists trg_set_author_evaluations on public.evaluations;
-- drop trigger if exists trg_set_author_pool_history on public.pool_history;
-- drop trigger if exists trg_set_author_client_error_logs on public.client_error_logs;
-- drop function if exists public.set_author_from_session();
-- alter table public.client_error_logs drop constraint if exists client_error_logs_kind_length;
-- alter table public.client_error_logs drop constraint if exists client_error_logs_detail_length;
-- alter table public.client_error_logs drop constraint if exists client_error_logs_page_length;
