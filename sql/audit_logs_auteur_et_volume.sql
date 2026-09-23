-- Auteur et date des lignes du journal d'audit imposés par la base, d'après le compte connecté :
-- user_email, user_name et created_at ne peuvent plus être falsifiés ni antidatés depuis le site.
-- Au plus 200 lignes par compte et par heure écrites directement par le site ; au-delà, la ligne est ignorée
-- sans erreur. Les lignes écrites par les déclencheurs d'audit (pg_trigger_depth() > 1) ne sont jamais limitées.
-- action limitée aux 10 valeurs affichées par audit_logs.html ; longueurs maximales sur les champs texte libres.
-- Sans compte connecté (manage-users, éditeur SQL), rien n'est modifié.
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
        elsif tg_table_name = 'audit_logs' then
            new.created_at := now();
            new.user_email := v_email;
            new.user_name := v_name;
            if pg_trigger_depth() = 1
               and not public.check_and_record_rate_limit(v_uid, 'audit_logs', 60, 200) then
                return null;
            end if;
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

    drop trigger if exists trg_set_author_audit_logs on public.audit_logs;
    create trigger trg_set_author_audit_logs
        before insert on public.audit_logs
        for each row execute function public.set_author_from_session();

    alter table public.audit_logs drop constraint if exists audit_logs_action_known;
    alter table public.audit_logs drop constraint if exists audit_logs_entity_id_length;
    alter table public.audit_logs drop constraint if exists audit_logs_entity_name_length;
    alter table public.audit_logs drop constraint if exists audit_logs_details_length;
    alter table public.audit_logs add constraint audit_logs_action_known check (action in (
        'create', 'update', 'delete', 'login', 'logout', 'export',
        'add_to_red_list', 'remove_from_red_list', 'devalidate', 'reintegrate'
    ));
    alter table public.audit_logs add constraint audit_logs_entity_id_length check (char_length(entity_id) <= 100);
    alter table public.audit_logs add constraint audit_logs_entity_name_length check (char_length(entity_name) <= 1000);
    alter table public.audit_logs add constraint audit_logs_details_length check (char_length(details) <= 2000);
end $$;

-- Rollback, puis rejouer sql/author_fields_from_session.sql pour rétablir la fonction précédente :
-- drop trigger if exists trg_set_author_audit_logs on public.audit_logs;
-- alter table public.audit_logs drop constraint if exists audit_logs_action_known;
-- alter table public.audit_logs drop constraint if exists audit_logs_entity_id_length;
-- alter table public.audit_logs drop constraint if exists audit_logs_entity_name_length;
-- alter table public.audit_logs drop constraint if exists audit_logs_details_length;
