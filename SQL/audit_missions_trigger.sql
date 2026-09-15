-- ============================================================================
-- audit_missions_trigger.sql
-- ----------------------------------------------------------------------------
-- Trigger d'audit fiable sur "missions" (chantier A5). Écrit automatiquement
-- une ligne dans audit_logs à chaque INSERT/UPDATE/DELETE — y compris un
-- accès direct à la base hors du site, ce qu'aucune journalisation côté
-- client ne peut garantir. Remplace les 3 appels logAuditAction('create'/
-- 'update'/'delete', 'mission', ...) qui existaient dans missions.html,
-- retirés le même jour (règle 15 : jamais de doublon laissé en place).
--
-- Exécuté en base le : 18/08/2026 (session A5)
-- Versionné dans ce fichier le : 19/08/2026 — écart honnête : exécuté avant
-- d'être sauvegardé, comblé en fin de session (voir règle 31).
-- ============================================================================

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

-- ----------------------------------------------------------------------------
-- Rollback (règle 10) :
-- drop trigger trg_audit_missions on public.missions;
-- drop function public.audit_missions_changes();
-- ----------------------------------------------------------------------------
