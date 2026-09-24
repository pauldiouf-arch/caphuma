-- Demandes de nouveau code d'accès, faites depuis la page de connexion et traitées par un admin.
-- request_access_code_reset() : seule entrée anonyme ; ne retient que les comptes @alima.ngo existants et non suspendus,
-- une demande en attente par adresse, 20 demandes au plus sur 24 h, et répond toujours de la même façon.
-- Les demandes traitées sont effacées après 90 jours. Seuls les admins actifs les lisent ou les ignorent ;
-- manage-users les classe après une réinitialisation.
-- Piège : l'éditeur SQL Supabase agit sur la table créée ici ; s'il refuse le script, l'exécuter avec psql.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 23/09/2026.

do $$
begin
    create table if not exists public.access_code_requests (
        id uuid primary key default gen_random_uuid(),
        email text not null,
        requested_at timestamptz not null default now(),
        resolved_at timestamptz,
        resolved_by uuid,
        constraint access_code_requests_email_length check (char_length(email) <= 254),
        constraint access_code_requests_resolved_by_fkey foreign key (resolved_by)
            references public.users(id) on delete set null
    );

    create unique index if not exists access_code_requests_one_pending_per_email
        on public.access_code_requests (lower(email)) where resolved_at is null;
    create index if not exists idx_access_code_requests_resolved_by
        on public.access_code_requests (resolved_by);

    alter table public.access_code_requests enable row level security;

    revoke all on public.access_code_requests from public, anon, authenticated, service_role;
    grant select on public.access_code_requests to authenticated;
    grant select, update, delete on public.access_code_requests to service_role;

    drop policy if exists access_code_requests_select_admin on public.access_code_requests;
    create policy access_code_requests_select_admin on public.access_code_requests
        for select to authenticated
        using ((select public.is_admin()));

    create or replace function public.request_access_code_reset(p_email text)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
        v_email text := lower(trim(p_email));
    begin
        delete from public.access_code_requests
        where resolved_at < now() - interval '90 days';

        if v_email is null
           or char_length(v_email) > 254
           or v_email !~ '^[^@\s]+@alima\.ngo$'
           or not exists (
               select 1 from public.users
               where lower(email) = v_email and is_active is not false
           )
           or (select count(*) from public.access_code_requests
               where requested_at > now() - interval '24 hours') >= 20 then
            return;
        end if;

        insert into public.access_code_requests (email)
        values (v_email)
        on conflict do nothing;
    end;
    $fn$;

    create or replace function public.dismiss_access_code_request(p_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
        if not public.is_admin() then
            raise exception 'Accès refusé' using errcode = '42501';
        end if;

        update public.access_code_requests
        set resolved_at = now(), resolved_by = auth.uid()
        where id = p_id and resolved_at is null;
    end;
    $fn$;

    revoke all on function public.request_access_code_reset(text) from public, anon, authenticated, service_role;
    revoke all on function public.dismiss_access_code_request(uuid) from public, anon, authenticated, service_role;
    grant execute on function public.request_access_code_reset(text) to anon, authenticated;
    grant execute on function public.dismiss_access_code_request(uuid) to authenticated;
end $$;

-- Rollback :
-- drop function if exists public.dismiss_access_code_request(uuid);
-- drop function if exists public.request_access_code_reset(text);
-- drop table if exists public.access_code_requests;
