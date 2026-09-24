-- Suppression d'un compte (users) : conserver les données qui le citent au lieu de bloquer ou d'effacer.
--   - pool_history.changed_by : aucune règle, la suppression du compte était refusée par la base.
--     Passe en SET NULL ; le nom reste lisible dans changed_by_name.
--   - comments.user_id : CASCADE effaçait tous les commentaires de l'auteur. Passe en SET NULL,
--     comme evaluations.author_id ; l'auteur reste lisible dans author_email.
--     Un commentaire orphelin reste lisible et n'est plus modifiable que par un admin.
-- Les contraintes existantes sont retrouvées par leur colonne, quel que soit leur nom.
-- Un seul bloc : tout s'applique ou rien. Rejouable sans risque.
-- Exécuté en base le 22/09/2026.

do $$
declare
    v_name text;
begin
    for v_name in
        select c.conname from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.conrelid = 'public.pool_history'::regclass and a.attname = 'changed_by'
    loop
        execute format('alter table public.pool_history drop constraint %I', v_name);
    end loop;
    alter table public.pool_history
        add constraint pool_history_changed_by_fkey
        foreign key (changed_by) references public.users(id) on delete set null;

    for v_name in
        select c.conname from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.conrelid = 'public.comments'::regclass and a.attname = 'user_id'
    loop
        execute format('alter table public.comments drop constraint %I', v_name);
    end loop;
    alter table public.comments alter column user_id drop not null;
    alter table public.comments
        add constraint comments_user_id_fkey
        foreign key (user_id) references public.users(id) on delete set null;
end $$;

-- Rollback (à exécuter seulement si aucun commentaire n'a encore user_id à NULL) :
-- alter table public.pool_history drop constraint if exists pool_history_changed_by_fkey;
-- alter table public.pool_history add constraint pool_history_changed_by_fkey foreign key (changed_by) references public.users(id);
-- alter table public.comments drop constraint if exists comments_user_id_fkey;
-- alter table public.comments alter column user_id set not null;
-- alter table public.comments add constraint comments_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
