-- Un même e-mail (casse et espaces ignorés) ne peut plus être porté par deux talents ; les talents sans e-mail ne sont pas concernés.
-- search_path fixé sur les 4 fonctions de statistiques du tableau de bord qui n'en avaient pas.
-- Si des doublons existent déjà, le script s'arrête sans rien modifier et affiche la liste : les corriger puis relancer.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 24/09/2026.

do $$
declare
    v_doublons text;
begin
    select string_agg(format('%s : %s', e, noms), E'\n' order by e)
      into v_doublons
      from (
          select lower(btrim(email)) as e,
                 string_agg(format('%s %s (%s)', first_name, last_name, id), ', ' order by created_at) as noms
            from public.talents
           where btrim(email) <> ''
           group by lower(btrim(email))
          having count(*) > 1
      ) d;

    if v_doublons is not null then
        raise exception E'E-mails portés par plusieurs talents, rien n''a été modifié :\n%', v_doublons;
    end if;

    create unique index if not exists talents_email_unique
        on public.talents (lower(btrim(email)))
        where btrim(email) <> '';

    alter function public.get_notification_alerts(text[]) set search_path = public;
    alter function public.get_pool_mission_counts() set search_path = public;
    alter function public.get_pool_talent_stats() set search_path = public;
    alter function public.get_validity_thresholds() set search_path = public;
end $$;

-- Rollback :
-- drop index if exists public.talents_email_unique;
-- alter function public.get_notification_alerts(text[]) reset search_path;
-- alter function public.get_pool_mission_counts() reset search_path;
-- alter function public.get_pool_talent_stats() reset search_path;
-- alter function public.get_validity_thresholds() reset search_path;
