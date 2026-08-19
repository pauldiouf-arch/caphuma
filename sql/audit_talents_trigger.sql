-- ============================================================================
-- audit_talents_trigger.sql
-- ----------------------------------------------------------------------------
-- Trigger d'audit fiable sur "talents" (chantier A5), le plus complexe des
-- 3 : détecte automatiquement l'intention métier (dévalidation, réintégration,
-- ajout/retrait Liste Rouge, prolongation, changement de pool) à partir des
-- colonnes qui changent, pour conserver les mêmes libellés qu'avant (dont
-- dépend le filtre d'audit_logs.html) et les mêmes textes explicatifs.
-- Remplace 14 appels logAuditAction('...', 'talent', ...) répartis sur
-- talents.html, id-card.html, red_list.html et devalidated.html, retirés le
-- même jour.
--
-- Testé sur les 9 scénarios réels (create, update classique, update
-- prolongation, devalidate, reintegrate, add_to_red_list avec motif,
-- remove_from_red_list, delete talent actif, delete talent dévalidé) — tous
-- confirmés identiques au comportement précédent.
--
-- Exécuté en base le : 18-19/08/2026 (session A5, avec 2 corrections après
-- tests le 19/08 : texte "Pool : X" manquant à la création, distinction
-- actif/dévalidé manquante à la suppression).
-- Versionné dans ce fichier le : 19/08/2026 — écart honnête, voir règle 31 et
-- audit_missions_trigger.sql.
-- ============================================================================

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

-- ----------------------------------------------------------------------------
-- Rollback (règle 10) :
-- drop trigger trg_audit_talents on public.talents;
-- drop function public.audit_talents_changes();
-- ----------------------------------------------------------------------------
