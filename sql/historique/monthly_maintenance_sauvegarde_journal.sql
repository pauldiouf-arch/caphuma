-- Sauvegarde mensuelle et journal d'audit des talents :
-- service_role peut lire notification_preferences, désormais sauvegardée par monthly-maintenance ;
-- une modification de talent sans compte connecté (monthly-maintenance, éditeur SQL) est journalisée
-- avec « Système » comme auteur au lieu d'un auteur vide.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Pas encore exécuté en base.

do $$
begin
    grant select on public.notification_preferences to service_role;

CREATE OR REPLACE FUNCTION public.audit_talents_changes()
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
        v_entity_name := NEW.first_name || ' ' || NEW.last_name;
        v_details := 'Pool : ' || coalesce(NEW.pool, '');

    elsif TG_OP = 'DELETE' then
        v_action := 'delete';
        v_entity_id := OLD.id::text;
        v_entity_name := OLD.first_name || ' ' || OLD.last_name;
        v_details := case when coalesce(OLD.is_valid, true) = false
                           then 'Suppression RGPD (talent dévalidé)'
                           else 'Suppression RGPD (talent actif)'
                      end;

    elsif TG_OP = 'UPDATE' then
        v_entity_id := NEW.id::text;
        v_entity_name := NEW.first_name || ' ' || NEW.last_name;

        if NEW.is_red_listed = true and coalesce(OLD.is_red_listed, false) = false then
            v_action := 'add_to_red_list';
            v_details := NEW.red_list_reason;

        elsif coalesce(OLD.is_red_listed, false) = true and coalesce(NEW.is_red_listed, false) = false then
            v_action := 'remove_from_red_list';
            v_details := null;

        elsif NEW.is_valid = false and coalesce(OLD.is_valid, true) = true then
            v_action := 'devalidate';
            v_details := null;

        elsif coalesce(OLD.is_valid, true) = false and coalesce(NEW.is_valid, true) = true then
            v_action := 'reintegrate';
            v_details := null;

        elsif NEW.devalidation_extension_until is not null
              and NEW.devalidation_extension_until is distinct from OLD.devalidation_extension_until then
            v_action := 'update';
            v_details := 'Prolongation de validité accordée : ' || coalesce(NEW.devalidation_extension_months::text, '?') || ' mois';

        elsif NEW.pool is distinct from OLD.pool then
            v_action := 'update';
            v_details := 'Changement de pool : ' || coalesce(OLD.pool, '—') || ' → ' || coalesce(NEW.pool, '—');

        else
            v_action := 'update';
            v_details := null;
        end if;
    end if;

    insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
    values (v_user_id, v_user_email, v_user_name, v_action, 'talent', v_entity_id, v_entity_name, v_details);

    return coalesce(NEW, OLD);
end;
$function$;

    revoke all on function public.audit_talents_changes() from public, anon, authenticated, service_role;
end $$;

-- Rollback :
-- revoke select on public.notification_preferences from service_role;
-- CREATE OR REPLACE FUNCTION public.audit_talents_changes()
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
--         v_entity_name := NEW.first_name || ' ' || NEW.last_name;
--         v_details := 'Pool : ' || coalesce(NEW.pool, '');
--
--     elsif TG_OP = 'DELETE' then
--         v_action := 'delete';
--         v_entity_id := OLD.id::text;
--         v_entity_name := OLD.first_name || ' ' || OLD.last_name;
--         v_details := case when coalesce(OLD.is_valid, true) = false
--                            then 'Suppression RGPD (talent dévalidé)'
--                            else 'Suppression RGPD (talent actif)'
--                       end;
--
--     elsif TG_OP = 'UPDATE' then
--         v_entity_id := NEW.id::text;
--         v_entity_name := NEW.first_name || ' ' || NEW.last_name;
--
--         if NEW.is_red_listed = true and coalesce(OLD.is_red_listed, false) = false then
--             v_action := 'add_to_red_list';
--             v_details := NEW.red_list_reason;
--
--         elsif coalesce(OLD.is_red_listed, false) = true and coalesce(NEW.is_red_listed, false) = false then
--             v_action := 'remove_from_red_list';
--             v_details := null;
--
--         elsif NEW.is_valid = false and coalesce(OLD.is_valid, true) = true then
--             v_action := 'devalidate';
--             v_details := null;
--
--         elsif coalesce(OLD.is_valid, true) = false and coalesce(NEW.is_valid, true) = true then
--             v_action := 'reintegrate';
--             v_details := null;
--
--         elsif NEW.devalidation_extension_until is not null
--               and NEW.devalidation_extension_until is distinct from OLD.devalidation_extension_until then
--             v_action := 'update';
--             v_details := 'Prolongation de validité accordée : ' || coalesce(NEW.devalidation_extension_months::text, '?') || ' mois';
--
--         elsif NEW.pool is distinct from OLD.pool then
--             v_action := 'update';
--             v_details := 'Changement de pool : ' || coalesce(OLD.pool, '—') || ' → ' || coalesce(NEW.pool, '—');
--
--         else
--             v_action := 'update';
--             v_details := null;
--         end if;
--     end if;
--
--     insert into public.audit_logs (user_id, user_email, user_name, action, entity_type, entity_id, entity_name, details)
--     values (v_user_id, v_user_email, v_user_name, v_action, 'talent', v_entity_id, v_entity_name, v_details);
--
--     return coalesce(NEW, OLD);
-- end;
-- $function$;
