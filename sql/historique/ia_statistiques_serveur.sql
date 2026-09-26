-- Analyse IA : ai-proxy lit lui-même les données des statistiques (ai_statistics_rows(), lignes sans nom ni e-mail) et vérifie
-- qu'une question ne cite pas une personne connue de la base (ai_question_mentions_person(), prénom et nom d'un talent ou nom
-- d'un compte, accents et majuscules ignorés). Les deux fonctions ne sont exécutables qu'avec la clé de service.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 26/09/2026.

begin;

create or replace function public.ai_statistics_rows()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
    select jsonb_build_object(
        'talents', (
            select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
            from (
                select pool, status, is_valid, is_red_listed, is_currently_on_mission, last_mission_end_date, months_without_mission,
                       pool_integration_date, experience_months_alima, availability_type, availability_date, availability_months,
                       gender, nationality_code, languages
                from public.talents
                where staff_type = 'expat'
            ) t),
        'missions', (
            select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
            from (
                select pool, pool_id, status, candidate_type, contract_start_date, contract_end_date, contract_status, country_code, desk,
                       case when future_talent_id is not null then true end as future_talent_id
                from public.missions
            ) m),
        'pools', (
            select coalesce(jsonb_agg(to_jsonb(p) order by p.pool_id), '[]'::jsonb)
            from (select pool_id, name, full_name from public.pools) p),
        'at_risk_months', (select at_risk_months from public.get_validity_thresholds()));
$function$;

create or replace function public.ai_question_mentions_person(p_question text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
    with question as (
        select ' ' || regexp_replace(lower(public.unaccent(coalesce(p_question, ''))), '[^a-z0-9]+', ' ', 'g') || ' ' as texte
    ),
    noms as (
        select regexp_replace(lower(public.unaccent(trim(first_name) || ' ' || trim(last_name))), '[^a-z0-9]+', ' ', 'g') as nom
        from public.talents
        where length(trim(first_name)) >= 2 and length(trim(last_name)) >= 2
        union all
        select regexp_replace(lower(public.unaccent(trim(last_name) || ' ' || trim(first_name))), '[^a-z0-9]+', ' ', 'g')
        from public.talents
        where length(trim(first_name)) >= 2 and length(trim(last_name)) >= 2
        union all
        select regexp_replace(lower(public.unaccent(trim(name))), '[^a-z0-9]+', ' ', 'g')
        from public.users
        where trim(name) like '% %' and length(trim(name)) >= 5
    )
    select exists (
        select 1
        from noms, question
        where length(trim(noms.nom)) >= 5
          and position(' ' || trim(noms.nom) || ' ' in question.texte) > 0);
$function$;

revoke all on function public.ai_statistics_rows() from public, anon, authenticated, service_role;
grant execute on function public.ai_statistics_rows() to service_role;
revoke all on function public.ai_question_mentions_person(text) from public, anon, authenticated, service_role;
grant execute on function public.ai_question_mentions_person(text) to service_role;

commit;

-- Rollback :
-- drop function if exists public.ai_statistics_rows();
-- drop function if exists public.ai_question_mentions_person(text);
