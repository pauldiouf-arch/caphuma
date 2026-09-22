-- Policies RESTRICTIVE : un visitor ne lit pas les commentaires et évaluations d'un talent
-- en Liste Rouge ou dévalidé. Une ligne sans talent_id reste visible.
-- Combinées en ET avec les policies existantes, sans les modifier.
-- Exécuté en base le 14/08/2026.

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

-- Rollback :
-- drop policy comments_select_restrict_visitor_sensitive_rows on public.comments;
-- drop policy evaluations_select_restrict_visitor_sensitive_rows on public.evaluations;
