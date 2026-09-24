-- Journal d'audit des postes et des liens de partage : une action faite sans compte connecté (traitement des
-- contrats échus, purge RGPD, éditeur SQL) est journalisée avec « Système » comme auteur au lieu d'un auteur vide,
-- comme pour les talents.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 24/09/2026.

do $$
begin
CREATE OR REPLACE FUNCTION public.audit_missions_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid := auth.uid();
    v_user_email text;
    v_user_name text;
    v_action text;
    v_entity_id text;
    v_entity_name text;
begin
    select email, name into v_user_email, v_user_name
    from public.users where id = v_user_id;
    if v_user_id is null then
        v_user_name := 'Système';
    end if;

    if TG_OP = 'INSERT' then
        v_action := 'create';
        v_entity_id := NEW.id::text;
        v_entity_name := NEW.title;
    elsif TG_OP = 'UPDATE' then
        v_action := 'update';
        v_entity_id := NEW.id::text;
        v_entity_name := NEW.title;
    elsif TG_OP = 'DELETE' then
        v_action := 'delete';
        v_entity_id := OLD.id::text;
        v_entity_name := OLD.title;
    end if;

    insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
    values (v_user_id, v_user_email, v_user_name, v_action, 'mission', v_entity_id, v_entity_name, null);

    return coalesce(NEW, OLD);
end;
$function$;

CREATE OR REPLACE FUNCTION public.audit_share_tokens_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid := auth.uid();
    v_user_email text;
    v_user_name text;
    v_action text;
    v_entity_id text;
    v_entity_name text;
    v_details text;
begin
    select email, name into v_user_email, v_user_name
    from public.users where id = v_user_id;
    if v_user_id is null then
        v_user_name := 'Système';
    end if;

    if TG_OP = 'INSERT' then
        v_action := 'create';
        v_entity_id := NEW.id::text;
        select first_name || ' ' || last_name into v_entity_name from public.talents where id = NEW.talent_id;
        v_details := null;
    elsif TG_OP = 'UPDATE' then
        v_action := 'update';
        v_entity_id := NEW.id::text;
        select first_name || ' ' || last_name into v_entity_name from public.talents where id = NEW.talent_id;
        if NEW.is_revoked = true and coalesce(OLD.is_revoked, false) = false then
            v_details := 'Révocation manuelle d''un lien de partage';
        else
            v_details := null;
        end if;
    elsif TG_OP = 'DELETE' then
        v_action := 'delete';
        v_entity_id := OLD.id::text;
        select first_name || ' ' || last_name into v_entity_name from public.talents where id = OLD.talent_id;
        v_details := null;
    end if;

    insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
    values (v_user_id, v_user_email, v_user_name, v_action, 'share_link', v_entity_id, v_entity_name, v_details);

    return coalesce(NEW, OLD);
end;
$function$;

    revoke all on function public.audit_missions_changes() from public, anon, authenticated, service_role;
    revoke all on function public.audit_share_tokens_changes() from public, anon, authenticated, service_role;
end $$;

-- Rollback :
-- CREATE OR REPLACE FUNCTION public.audit_missions_changes()
--  RETURNS trigger
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--     v_user_id uuid := auth.uid();
--     v_user_email text;
--     v_user_name text;
--     v_action text;
--     v_entity_id text;
--     v_entity_name text;
-- begin
--     select email, name into v_user_email, v_user_name
--     from public.users where id = v_user_id;
--
--     if TG_OP = 'INSERT' then
--         v_action := 'create';
--         v_entity_id := NEW.id::text;
--         v_entity_name := NEW.title;
--     elsif TG_OP = 'UPDATE' then
--         v_action := 'update';
--         v_entity_id := NEW.id::text;
--         v_entity_name := NEW.title;
--     elsif TG_OP = 'DELETE' then
--         v_action := 'delete';
--         v_entity_id := OLD.id::text;
--         v_entity_name := OLD.title;
--     end if;
--
--     insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
--     values (v_user_id, v_user_email, v_user_name, v_action, 'mission', v_entity_id, v_entity_name, null);
--
--     return coalesce(NEW, OLD);
-- end;
-- $function$;

-- CREATE OR REPLACE FUNCTION public.audit_share_tokens_changes()
--  RETURNS trigger
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--     v_user_id uuid := auth.uid();
--     v_user_email text;
--     v_user_name text;
--     v_action text;
--     v_entity_id text;
--     v_entity_name text;
--     v_details text;
-- begin
--     select email, name into v_user_email, v_user_name
--     from public.users where id = v_user_id;
--
--     if TG_OP = 'INSERT' then
--         v_action := 'create';
--         v_entity_id := NEW.id::text;
--         select first_name || ' ' || last_name into v_entity_name from public.talents where id = NEW.talent_id;
--         v_details := null;
--     elsif TG_OP = 'UPDATE' then
--         v_action := 'update';
--         v_entity_id := NEW.id::text;
--         select first_name || ' ' || last_name into v_entity_name from public.talents where id = NEW.talent_id;
--         if NEW.is_revoked = true and coalesce(OLD.is_revoked, false) = false then
--             v_details := 'Révocation manuelle d''un lien de partage';
--         else
--             v_details := null;
--         end if;
--     elsif TG_OP = 'DELETE' then
--         v_action := 'delete';
--         v_entity_id := OLD.id::text;
--         select first_name || ' ' || last_name into v_entity_name from public.talents where id = OLD.talent_id;
--         v_details := null;
--     end if;
--
--     insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
--     values (v_user_id, v_user_email, v_user_name, v_action, 'share_link', v_entity_id, v_entity_name, v_details);
--
--     return coalesce(NEW, OLD);
-- end;
-- $function$;
