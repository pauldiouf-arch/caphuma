-- Auteur et date imposés par la base, d'après le compte connecté, au lieu des valeurs envoyées par le site :
-- talents : ajout en Liste Rouge (auteur, nom, date, figés ensuite tant que le talent y reste), prolongation de
-- validité (auteur, nom, date), created_by ; missions : created_by ; share_tokens : created_by_name.
-- created_by et created_by_name ne changent plus après la création. Nom affiché : users.name, sinon l'e-mail.
-- Sans compte connecté (éditeur SQL, Edge Functions), rien n'est modifié.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Pas encore exécuté en base.

do $$
begin
    create or replace function public.set_attribution_from_session()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
        v_uid uuid := auth.uid();
        v_name text;
    begin
        if v_uid is null then
            return new;
        end if;

        select coalesce(nullif(name, ''), email) into v_name from public.users where id = v_uid;

        if tg_table_name = 'talents' then
            if tg_op = 'INSERT' then
                new.created_by := v_uid;
            else
                new.created_by := old.created_by;
            end if;

            if coalesce(new.is_red_listed, false) then
                if tg_op = 'INSERT' or not coalesce(old.is_red_listed, false) then
                    new.red_list_added_by := v_uid;
                    new.red_list_added_by_name := v_name;
                    new.red_list_date := now();
                else
                    new.red_list_added_by := old.red_list_added_by;
                    new.red_list_added_by_name := old.red_list_added_by_name;
                    new.red_list_date := old.red_list_date;
                end if;
            end if;

            if new.devalidation_extension_until is not null then
                if tg_op = 'INSERT'
                   or new.devalidation_extension_until is distinct from old.devalidation_extension_until
                   or new.devalidation_extension_months is distinct from old.devalidation_extension_months then
                    new.devalidation_extension_granted_by := v_uid;
                    new.devalidation_extension_granted_by_name := v_name;
                    new.devalidation_extension_granted_at := now();
                else
                    new.devalidation_extension_granted_by := old.devalidation_extension_granted_by;
                    new.devalidation_extension_granted_by_name := old.devalidation_extension_granted_by_name;
                    new.devalidation_extension_granted_at := old.devalidation_extension_granted_at;
                end if;
            end if;
        elsif tg_table_name = 'missions' then
            if tg_op = 'INSERT' then
                new.created_by := v_uid;
            else
                new.created_by := old.created_by;
            end if;
        elsif tg_table_name = 'share_tokens' then
            if tg_op = 'INSERT' then
                new.created_by_name := v_name;
            else
                new.created_by_name := old.created_by_name;
            end if;
        end if;

        return new;
    end;
    $fn$;

    revoke all on function public.set_attribution_from_session() from public, anon, authenticated, service_role;

    drop trigger if exists trg_set_attribution_talents on public.talents;
    drop trigger if exists trg_set_attribution_missions on public.missions;
    drop trigger if exists trg_set_attribution_share_tokens on public.share_tokens;
    create trigger trg_set_attribution_talents before insert or update on public.talents
        for each row execute function public.set_attribution_from_session();
    create trigger trg_set_attribution_missions before insert or update on public.missions
        for each row execute function public.set_attribution_from_session();
    create trigger trg_set_attribution_share_tokens before insert or update on public.share_tokens
        for each row execute function public.set_attribution_from_session();
end $$;

-- Rollback :
-- drop trigger if exists trg_set_attribution_share_tokens on public.share_tokens;
-- drop trigger if exists trg_set_attribution_missions on public.missions;
-- drop trigger if exists trg_set_attribution_talents on public.talents;
-- drop function if exists public.set_attribution_from_session();
