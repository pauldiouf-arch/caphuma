-- Trigger d'audit sur missions : une ligne dans audit_logs à chaque INSERT/UPDATE/DELETE, y compris hors du site.
-- Exécuté en base le 18/08/2026.

create or replace function public.audit_missions_changes()
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
begin
    select email, name into v_user_email, v_user_name
    from public.users where id = v_user_id;

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
$$;

create trigger trg_audit_missions
after insert or update or delete on public.missions
for each row execute function public.audit_missions_changes();

-- Rollback :
-- drop trigger trg_audit_missions on public.missions;
-- drop function public.audit_missions_changes();
