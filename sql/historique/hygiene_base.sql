-- Nettoyage de la base, sans changement pour le site :
-- commentaires d'historique retirés du code de audit_talents_changes() et get_notification_alerts() ;
-- droits maintain, references et trigger retirés à anon et authenticated, que le site n'utilise pas ;
-- fonctions de statistiques réservées aux comptes connectés ; 3 index et 1 contrainte en double supprimés ;
-- un pool encore rattaché à un talent ou à un poste ne peut plus être supprimé (ON DELETE RESTRICT) : il s'archive.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 23/09/2026.

do $$
begin
    create or replace function public.audit_talents_changes()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
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
$fn$;

    create or replace function public.get_notification_alerts(p_pool_scope text[] default null::text[])
    returns table(alert_type text, pool_id text, days_left integer, contract_window integer, status text)
    language sql
    stable
    as $fn$
  select
    'contract'::text as alert_type,
    coalesce(m.pool, m.pool_id) as pool_id,
    (m.contract_end_date::date - current_date)::int as days_left,
    case
      when (m.contract_end_date::date - current_date) <= 30 then 30
      when (m.contract_end_date::date - current_date) <= 60 then 60
      else 90
    end as contract_window,
    null::text as status
  from missions m
  where m.status = 'occupied'
    and m.contract_end_date is not null
    and (m.contract_end_date::date - current_date) between 0 and 90
    and (p_pool_scope is null or coalesce(m.pool, m.pool_id) = any(p_pool_scope))

  union all

  select
    'vacancy'::text,
    coalesce(m.pool, m.pool_id),
    null::int,
    null::int,
    m.status
  from missions m
  where m.status in ('vacant', 'recruiting')
    and coalesce(m.pool, m.pool_id) is not null
    and (p_pool_scope is null or coalesce(m.pool, m.pool_id) = any(p_pool_scope))

  union all

  select
    'available'::text,
    t.pool,
    null::int,
    null::int,
    null::text
  from talents t
  where t.is_valid is not false
    and t.is_red_listed is not true
    and t.pool is not null
    and (
      t.availability_type = 'asap'
      or (t.availability_type = 'date' and t.availability_date is not null and t.availability_date::date <= current_date)
    )
    and (p_pool_scope is null or t.pool = any(p_pool_scope))

  union all

  select
    'at_risk'::text,
    t.pool,
    null::int,
    null::int,
    null::text
  from talents t
  where t.is_valid is not false
    and t.is_red_listed is not true
    and t.pool is not null
    and coalesce(t.months_without_mission, 0) >= (select vt.at_risk_months from public.get_validity_thresholds() vt)
    and (p_pool_scope is null or t.pool = any(p_pool_scope));
$fn$;

    revoke maintain, references, trigger on public.audit_logs from anon, authenticated;
    revoke maintain, references, trigger on public.client_error_logs from anon, authenticated;
    revoke maintain, references, trigger on public.comments from anon, authenticated;
    revoke maintain, references, trigger on public.evaluations from anon, authenticated;
    revoke maintain, references, trigger on public.missions from anon, authenticated;
    revoke maintain, references, trigger on public.notification_preferences from anon, authenticated;
    revoke maintain, references, trigger on public.pool_history from anon, authenticated;
    revoke maintain, references, trigger on public.pools from anon, authenticated;
    revoke maintain, references, trigger on public.rate_limit_log from anon, authenticated;
    revoke maintain, references, trigger on public.share_tokens from anon, authenticated;
    revoke maintain, references, trigger on public.talents from anon, authenticated;
    revoke maintain, references, trigger on public.users from anon, authenticated;

    revoke all on function public.get_notification_alerts(text[]) from public, anon;
    grant execute on function public.get_notification_alerts(text[]) to authenticated, service_role;
    revoke all on function public.get_pool_mission_counts() from public, anon;
    grant execute on function public.get_pool_mission_counts() to authenticated, service_role;
    revoke all on function public.get_pool_talent_stats() from public, anon;
    grant execute on function public.get_pool_talent_stats() to authenticated, service_role;
    revoke all on function public.get_validity_thresholds() from public, anon;
    grant execute on function public.get_validity_thresholds() to authenticated, service_role;

    drop index if exists public.idx_shared_links_token;
    drop index if exists public.idx_pools_pool_id;
    drop index if exists public.idx_users_email;

    alter table public.talents drop constraint if exists talents_number_of_missions_check;

    alter table public.talents drop constraint if exists talents_pool_fkey;
    alter table public.talents add constraint talents_pool_fkey
        foreign key (pool) references public.pools(pool_id) on delete restrict;
    alter table public.talents drop constraint if exists talents_tracking_pool_fkey;
    alter table public.talents add constraint talents_tracking_pool_fkey
        foreign key (tracking_pool) references public.pools(pool_id) on delete restrict;
    alter table public.missions drop constraint if exists missions_pool_fkey;
    alter table public.missions add constraint missions_pool_fkey
        foreign key (pool) references public.pools(pool_id) on delete restrict;
end $$;

-- Rollback :
-- grant maintain, references, trigger on public.audit_logs to anon, authenticated;
-- grant maintain, references, trigger on public.client_error_logs to anon, authenticated;
-- grant maintain, references, trigger on public.comments to anon, authenticated;
-- grant maintain, references, trigger on public.evaluations to authenticated;
-- grant maintain, references, trigger on public.missions to authenticated;
-- grant maintain, references, trigger on public.notification_preferences to anon, authenticated;
-- grant maintain, references, trigger on public.pool_history to authenticated;
-- grant maintain, references, trigger on public.pools to authenticated;
-- grant maintain, references, trigger on public.rate_limit_log to anon, authenticated;
-- grant maintain, references, trigger on public.share_tokens to authenticated;
-- grant maintain, references, trigger on public.talents to authenticated;
-- grant maintain, references, trigger on public.users to authenticated;
-- grant execute on function public.get_notification_alerts(text[]) to public;
-- revoke execute on function public.get_notification_alerts(text[]) from service_role;
-- grant execute on function public.get_pool_mission_counts() to public;
-- revoke execute on function public.get_pool_mission_counts() from service_role;
-- grant execute on function public.get_pool_talent_stats() to public;
-- revoke execute on function public.get_pool_talent_stats() from service_role;
-- grant execute on function public.get_validity_thresholds() to public;
-- revoke execute on function public.get_validity_thresholds() from service_role;
-- revoke execute on function public.get_validity_thresholds() from authenticated;
-- create index idx_shared_links_token on public.share_tokens using btree (token);
-- create index idx_pools_pool_id on public.pools using btree (pool_id);
-- create index idx_users_email on public.users using btree (email);
-- alter table public.talents add constraint talents_number_of_missions_check check (((number_of_alima_missions is null) or (number_of_alima_missions = any (array['none'::text, 'one'::text, 'two'::text, 'three_plus'::text]))));
-- alter table public.talents drop constraint talents_pool_fkey;
-- alter table public.talents add constraint talents_pool_fkey foreign key (pool) references public.pools(pool_id) on delete set null;
-- alter table public.talents drop constraint talents_tracking_pool_fkey;
-- alter table public.talents add constraint talents_tracking_pool_fkey foreign key (tracking_pool) references public.pools(pool_id);
-- alter table public.missions drop constraint missions_pool_fkey;
-- alter table public.missions add constraint missions_pool_fkey foreign key (pool) references public.pools(pool_id) on delete set null;
-- Les deux fonctions nettoyées n'ont pas à être rétablies : seuls des commentaires ont été retirés.
