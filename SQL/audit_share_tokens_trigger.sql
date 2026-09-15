-- ============================================================================
-- audit_share_tokens_trigger.sql
-- ----------------------------------------------------------------------------
-- Trigger d'audit fiable sur "share_tokens" (chantier A5). Même principe que
-- audit_missions_trigger.sql. Comble aussi un trou qui existait avant : la
-- suppression en cascade des liens de partage (lors d'une suppression RGPD
-- d'un talent) n'était journalisée nulle part côté client — elle l'est
-- désormais automatiquement. Remplace les 2 appels logAuditAction('create'/
-- 'update', 'share_link', ...) qui existaient dans id-card.html, retirés le
-- même jour.
--
-- Exécuté en base le : 18/08/2026 (session A5)
-- Versionné dans ce fichier le : 19/08/2026 — écart honnête, voir règle 31 et
-- audit_missions_trigger.sql.
-- ============================================================================

create or replace function public.audit_share_tokens_changes()
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
$$;

create trigger trg_audit_share_tokens
after insert or update or delete on public.share_tokens
for each row execute function public.audit_share_tokens_changes();

-- ----------------------------------------------------------------------------
-- Rollback (règle 10) :
-- drop trigger trg_audit_share_tokens on public.share_tokens;
-- drop function public.audit_share_tokens_changes();
-- ----------------------------------------------------------------------------
