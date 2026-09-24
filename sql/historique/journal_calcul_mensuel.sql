-- Journal d'audit des talents : une modification faite sans compte connecté qui ne touche que les compteurs
-- recalculés chaque mois (expérience ALIMA et humanitaire, mois sans mission, date du dernier calcul) n'est plus
-- journalisée ; monthly-maintenance écrit à la place une ligne récapitulative par passage.
-- Les modifications faites depuis le site, y compris une correction manuelle de ces compteurs, restent journalisées.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 24/09/2026.

do $$
begin
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
        if v_user_id is null
           and to_jsonb(NEW) - array['experience_months_alima', 'experience_months_humanitarian', 'months_without_mission', 'last_experience_update']
             = to_jsonb(OLD) - array['experience_months_alima', 'experience_months_humanitarian', 'months_without_mission', 'last_experience_update'] then
            return NEW;
        end if;

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
--     if v_user_id is null then
--         v_user_name := 'Système';
--     end if;
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
