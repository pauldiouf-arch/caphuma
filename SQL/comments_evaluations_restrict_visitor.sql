-- ============================================================================
-- comments_evaluations_restrict_visitor.sql
-- ----------------------------------------------------------------------------
-- Policies RESTRICTIVE empêchant le rôle "visitor" de lire, via l'API, les
-- commentaires et évaluations rattachés à un talent en Liste Rouge ou
-- dévalidé. Même logique que talents_restrict_visitor.sql (juillet 2026),
-- étendue à ces deux tables (ancien backlog n°2, traité le 14/08/2026).
--
-- Une ligne reste visible pour "visitor" si talent_id est vide (rien de
-- sensible à protéger derrière), ou si le talent lié n'est ni en Liste Rouge
-- ni dévalidé. Combinée en ET logique avec les policies PERMISSIVE
-- existantes (comments_select_all_connected / evaluations_select_authenticated)
-- sans les modifier.
--
-- Exécuté en base le : 14/08/2026
-- Versionné dans ce fichier le : 18/08/2026 (chantier A4) — reconstitué
-- fidèlement depuis pg_policies (jamais sauvegardé en fichier au moment de
-- l'exécution, voir Dossier de passation, Annexe B, écart noté honnêtement).
-- ============================================================================

create policy comments_select_restrict_visitor_sensitive_rows
on public.comments
as restrictive
for select
to authenticated
using (
    (select users.role from users where users.id = (select auth.uid())) is distinct from 'visitor'
    or (
        talent_id is null
        or exists (
            select 1 from talents t
            where t.id = comments.talent_id
              and coalesce(t.is_red_listed, false) = false
              and coalesce(t.is_valid, true) = true
        )
    )
);

create policy evaluations_select_restrict_visitor_sensitive_rows
on public.evaluations
as restrictive
for select
to authenticated
using (
    (select users.role from users where users.id = (select auth.uid())) is distinct from 'visitor'
    or (
        talent_id is null
        or exists (
            select 1 from talents t
            where t.id = evaluations.talent_id
              and coalesce(t.is_red_listed, false) = false
              and coalesce(t.is_valid, true) = true
        )
    )
);

-- ----------------------------------------------------------------------------
-- Rollback (règle 10) :
-- drop policy comments_select_restrict_visitor_sensitive_rows on public.comments;
-- drop policy evaluations_select_restrict_visitor_sensitive_rows on public.evaluations;
-- ----------------------------------------------------------------------------
