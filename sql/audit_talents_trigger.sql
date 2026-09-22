-- Trigger d'audit sur talents : déduit l'action métier (dévalidation, réintégration, Liste Rouge,
-- prolongation, changement de pool) à partir des colonnes modifiées.
-- Les libellés d'action doivent rester stables : le filtre de audit_logs.html en dépend.
-- Exécuté en base les 18 et 19/08/2026.

create or replace function public.audit_talents_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

create trigger trg_audit_talents
after insert or update or delete on public.talents
for each row execute function public.audit_talents_changes();

-- Rollback :
-- drop trigger trg_audit_talents on public.talents;
-- drop function public.audit_talents_changes();
