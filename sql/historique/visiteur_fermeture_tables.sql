-- Le visiteur ne lit plus directement talents, missions, comments, evaluations et pool_history : il passe uniquement par
-- les fonctions visitor_*() ; il garde la lecture de pools et de son propre profil.
-- Les anciennes restrictions du visiteur sur les talents dévalidés ou en Liste Rouge sont remplacées par cette fermeture.
-- get_pool_talent_stats() et get_pool_mission_counts() (tableau de bord) s'exécutent désormais avec les droits de la base,
-- pour tout compte actif : mêmes chiffres qu'avant pour chaque rôle, aucun pour un compte suspendu.
-- À exécuter après visiteur_portes_talents.sql et visiteur_portes_postes_statistiques.sql, et une fois le site à jour.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 25/09/2026.

begin;

create or replace function public.get_pool_talent_stats()
 returns table(pool_id text, active bigint, available bigint, at_risk bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    t.pool as pool_id,
    count(*) as active,
    count(*) filter (where t.status = 'En attente de poste') as available,
    count(*) filter (
      where coalesce(t.months_without_mission, 0) >=
        (select vt.at_risk_months from public.get_validity_thresholds() vt)
    ) as at_risk
  from talents t
  where public.is_active_user()
    and t.pool is not null
    and t.is_valid is not false
    and t.is_red_listed is not true
  group by t.pool;
$function$;

create or replace function public.get_pool_mission_counts()
 returns table(pool_id text, positions bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    coalesce(m.pool, m.pool_id) as pool_id,
    count(*) as positions
  from missions m
  where public.is_active_user()
    and coalesce(m.pool, m.pool_id) is not null
  group by coalesce(m.pool, m.pool_id);
$function$;

drop policy if exists talents_select_restrict_visitor_sensitive_rows on public.talents;
drop policy if exists comments_select_restrict_visitor_sensitive_rows on public.comments;
drop policy if exists evaluations_select_restrict_visitor_sensitive_rows on public.evaluations;

drop policy if exists talents_select_not_visitor on public.talents;
create policy talents_select_not_visitor on public.talents as restrictive for select to authenticated
    using ((select not public.has_active_role('visitor')));

drop policy if exists missions_select_not_visitor on public.missions;
create policy missions_select_not_visitor on public.missions as restrictive for select to authenticated
    using ((select not public.has_active_role('visitor')));

drop policy if exists comments_select_not_visitor on public.comments;
create policy comments_select_not_visitor on public.comments as restrictive for select to authenticated
    using ((select not public.has_active_role('visitor')));

drop policy if exists evaluations_select_not_visitor on public.evaluations;
create policy evaluations_select_not_visitor on public.evaluations as restrictive for select to authenticated
    using ((select not public.has_active_role('visitor')));

drop policy if exists pool_history_select_not_visitor on public.pool_history;
create policy pool_history_select_not_visitor on public.pool_history as restrictive for select to authenticated
    using ((select not public.has_active_role('visitor')));

commit;

-- Rollback :
-- drop policy if exists talents_select_not_visitor on public.talents;
-- drop policy if exists missions_select_not_visitor on public.missions;
-- drop policy if exists comments_select_not_visitor on public.comments;
-- drop policy if exists evaluations_select_not_visitor on public.evaluations;
-- drop policy if exists pool_history_select_not_visitor on public.pool_history;
-- create policy talents_select_restrict_visitor_sensitive_rows on public.talents as restrictive for select to authenticated
--     using ((( select users.role from users where (users.id = ( select auth.uid() as uid))) is distinct from 'visitor'::text)
--            or ((coalesce(is_red_listed, false) = false) and (coalesce(is_valid, true) = true)));
-- create policy comments_select_restrict_visitor_sensitive_rows on public.comments as restrictive for select to authenticated
--     using ((( select users.role from users where (users.id = ( select auth.uid() as uid))) is distinct from 'visitor'::text)
--            or ((talent_id is null) or (exists ( select 1 from talents t where ((t.id = comments.talent_id)
--            and (coalesce(t.is_red_listed, false) = false) and (coalesce(t.is_valid, true) = true))))));
-- create policy evaluations_select_restrict_visitor_sensitive_rows on public.evaluations as restrictive for select to authenticated
--     using ((( select users.role from users where (users.id = ( select auth.uid() as uid))) is distinct from 'visitor'::text)
--            or ((talent_id is null) or (exists ( select 1 from talents t where ((t.id = evaluations.talent_id)
--            and (coalesce(t.is_red_listed, false) = false) and (coalesce(t.is_valid, true) = true))))));
-- puis réexécuter get_pool_talent_stats() et get_pool_mission_counts() depuis la version précédente de sql/schema_reference.sql
-- (sans security definer ni la condition is_active_user()).
