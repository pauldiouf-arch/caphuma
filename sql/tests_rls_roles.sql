-- Test des policies RLS par role (visitor / user / admin, puis compte suspendu) sur talents, comments,
-- evaluations, share_tokens, audit_logs et users.
--
-- Execution : coller ce fichier en entier dans l'editeur SQL Supabase, sans rien ajouter autour,
-- puis Run. Tout tient dans un seul bloc do $$ : l'editeur ne garantit pas une connexion unique
-- entre deux instructions.
--
-- Lecture : le bloc finit TOUJOURS par une erreur rouge volontaire, qui annule toutes les
-- ecritures de test. Le bilan est dans ce message (l'editeur n'affiche pas les RAISE NOTICE) :
--   - "A3 BILAN : TOUS LES TESTS ONT REUSSI" : rien a faire ;
--   - "A3 BILAN : N ECHEC(S)" : chercher les lignes "A3-XX ECHEC" plus bas ;
--   - "A3-06 IGNORE" : test non executable, ni succes ni echec.
--
-- Prerequis : un compte actif de chaque role, dont un visitor, doit exister dans users.
-- Aucun identifiant reel n'est code en dur, les fiches de test sont factices.
-- Limites : insertion d'evaluation protegee (nullabilite de mission_id non confirmee) ;
-- pas de DELETE reel sur users (protection confirmee via pg_policies).

do $$
declare
    -- role de session (bypass RLS), pour revenir en admin technique entre deux simulations
    v_admin_role text;

    -- compteurs de bilan et rapport texte
    v_ok   int := 0;
    v_fail int := 0;
    v_skip int := 0;
    v_total int;
    v_report text := '';
    v_final_message text;

    -- comptes resolus dynamiquement en S0, jamais codes en dur
    v_admin_id      uuid;
    v_admin_email   text;
    v_user_id       uuid;
    v_user_email    text;
    v_visitor_id    uuid;
    v_visitor_email text;

    -- talents factices (S1/S2/S3)
    v_talent_redlisted_id   uuid;
    v_talent_devalidated_id uuid;
    v_talent_control_id     uuid;

    -- identifiants crees pendant le setup, reutilises dans les tests
    v_dummy_talent_id          uuid;
    v_comment_redlisted_id     uuid;
    v_comment_control_id       uuid;
    v_comment_owned_by_user_id uuid;
    v_eval_devalidated_id      uuid;
    v_eval_setup_ok            boolean := false;
    v_token_admin_id           uuid;
    v_token_user_id            uuid;

    -- variables de travail reutilisees test apres test
    v_count       int;
    v_rows        int;
    v_log_id      uuid;
    v_total_users int;
begin
    select session_user into v_admin_role;

    -- Setup, sous le role de session (bypass RLS)

    -- S0 : premier compte trouve pour chaque role
    select id, email into v_admin_id, v_admin_email
        from users where role = 'admin' and is_active is not false order by created_at limit 1;
    select id, email into v_user_id, v_user_email
        from users where role = 'user' and is_active is not false order by created_at limit 1;
    select id, email into v_visitor_id, v_visitor_email
        from users where role = 'visitor' and is_active is not false order by created_at limit 1;

    if v_admin_id is null or v_user_id is null or v_visitor_id is null then
        raise exception 'A3 SETUP IMPOSSIBLE : au moins un compte de chaque role (admin, user, visitor) doit exister dans la table users pour lancer ce test. Manquant -> admin:%, user:%, visitor:%',
            (v_admin_id is null), (v_user_id is null), (v_visitor_id is null);
    end if;

    -- S1/S2/S3 : talents factices, detruits par le rollback force final
    insert into talents (first_name, last_name, pool, is_red_listed, red_list_reason)
    values ('TEST-A3', 'REDLISTED', 'COLOG', true, 'TEST RLS temporaire (A3)')
    returning id into v_talent_redlisted_id;

    insert into talents (first_name, last_name, pool, is_valid)
    values ('TEST-A3', 'DEVALIDATED', 'COLOG', false)
    returning id into v_talent_devalidated_id;

    insert into talents (first_name, last_name, pool)
    values ('TEST-A3', 'CONTROL', 'COLOG')
    returning id into v_talent_control_id;

    -- S4 : talent factice dedie aux tests d'ecriture
    insert into talents (first_name, last_name, pool)
    values ('TEST-A3', 'DUMMY-ECRITURE', 'COLOG')
    returning id into v_dummy_talent_id;

    -- S5/S6/S7 : commentaires de test
    insert into comments (talent_id, user_id, content, author_email)
    values (v_talent_redlisted_id, v_admin_id,
            'TEST RLS temporaire - commentaire sur talent Liste Rouge', v_admin_email)
    returning id into v_comment_redlisted_id;

    insert into comments (talent_id, user_id, content, author_email)
    values (v_talent_control_id, v_admin_id,
            'TEST RLS temporaire - commentaire sur talent temoin', v_admin_email)
    returning id into v_comment_control_id;

    insert into comments (talent_id, user_id, content, author_email)
    values (v_talent_control_id, v_user_id,
            'TEST RLS temporaire - commentaire du user de test', v_user_email)
    returning id into v_comment_owned_by_user_id;

    -- S8 : evaluation de test, protegee (nullabilite de mission_id non confirmee)
    begin
        insert into evaluations (talent_id, author_id, context, author_email)
        values (v_talent_devalidated_id, v_admin_id,
                'TEST RLS temporaire - evaluation sur talent devalide', v_admin_email)
        returning id into v_eval_devalidated_id;
        v_eval_setup_ok := true;
    exception when others then
        v_eval_setup_ok := false;
        v_report := v_report || format('Setup evaluations ECHEC (%s) - le test A3-06 sera IGNORE', sqlerrm) || chr(10);
    end;

    -- S9/S10 : jetons de partage de test
    insert into share_tokens (token, talent_id, created_by, created_by_name, expires_at)
    values ('test-a3-admin-' || gen_random_uuid()::text, v_talent_control_id,
            v_admin_id, 'TEST A3 Admin', now() + interval '7 days')
    returning id into v_token_admin_id;

    insert into share_tokens (token, talent_id, created_by, created_by_name, expires_at)
    values ('test-a3-user-' || gen_random_uuid()::text, v_talent_control_id,
            v_user_id, 'TEST A3 User', now() + interval '7 days')
    returning id into v_token_user_id;

    v_report := v_report || 'Setup termine (comptes resolus par role, 3 talents factices, talent d''ecriture, 3 commentaires, jetons de partage, evaluation si possible)' || chr(10);

    -- Tests en tant que visitor
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_visitor_id), true);
    perform set_config('role', 'authenticated', true);

    -- talents : visibilite
    select count(*) into v_count from talents where id = v_talent_redlisted_id;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-01 OK - visitor ne voit pas le talent Liste Rouge' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-01 ECHEC - visitor voit %s ligne(s) du talent Liste Rouge (attendu 0)', v_count) || chr(10); end if;

    select count(*) into v_count from talents where id = v_talent_devalidated_id;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-02 OK - visitor ne voit pas le talent devalide' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-02 ECHEC - visitor voit %s ligne(s) du talent devalide (attendu 0)', v_count) || chr(10); end if;

    select count(*) into v_count from talents where id = v_talent_control_id;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-03 OK - visitor voit bien le talent temoin (sanity check)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-03 ECHEC - visitor voit %s ligne(s) du talent temoin (attendu 1)', v_count) || chr(10); end if;

    -- comments : visibilite
    select count(*) into v_count from comments where id = v_comment_redlisted_id;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-04 OK - visitor ne voit pas le commentaire lie au talent Liste Rouge' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-04 ECHEC - visitor voit %s ligne(s) (attendu 0)', v_count) || chr(10); end if;

    select count(*) into v_count from comments where id = v_comment_control_id;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-05 OK - visitor voit le commentaire lie au talent temoin' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-05 ECHEC - visitor voit %s ligne(s) (attendu 1)', v_count) || chr(10); end if;

    -- evaluations : visibilite
    if v_eval_setup_ok then
        select count(*) into v_count from evaluations where id = v_eval_devalidated_id;
        if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-06 OK - visitor ne voit pas l''evaluation liee au talent devalide' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-06 ECHEC - visitor voit %s ligne(s) (attendu 0)', v_count) || chr(10); end if;
    else
        v_skip := v_skip + 1;
        v_report := v_report || 'A3-06 IGNORE - insertion de test evaluations impossible au setup (voir message ci-dessus)' || chr(10);
    end if;

    -- talents : ecriture interdite
    begin
        insert into talents (first_name, last_name, pool) values ('TEST-A3', 'VISITOR INSERT', 'COLOG');
        v_fail := v_fail + 1; v_report := v_report || 'A3-07 ECHEC - visitor a reussi a inserer un talent' || chr(10);
    exception when others then
        v_ok := v_ok + 1; v_report := v_report || 'A3-07 OK - INSERT bloque comme attendu' || chr(10);
    end;

    begin
        update talents set current_function = 'TEST VISITOR UPDATE' where id = v_dummy_talent_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-08 OK - visitor a modifie 0 ligne (bloque par RLS)' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-08 ECHEC - visitor a modifie %s ligne(s) (attendu 0)', v_rows) || chr(10); end if;
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-08 OK - UPDATE bloque au niveau GRANT (permission denied)' || chr(10);
    end;

    begin
        delete from talents where id = v_dummy_talent_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-09 OK - visitor a supprime 0 ligne (bloque par RLS)' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-09 ECHEC - visitor a supprime %s ligne(s) (attendu 0)', v_rows) || chr(10); end if;
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-09 OK - DELETE bloque au niveau GRANT (permission denied)' || chr(10);
    end;

    -- comments : ecriture interdite
    begin
        insert into comments (talent_id, user_id, content, author_email)
        values (v_talent_control_id, v_visitor_id,
                'TEST visitor insert', v_visitor_email);
        v_fail := v_fail + 1; v_report := v_report || 'A3-10 ECHEC - visitor a reussi a inserer un commentaire' || chr(10);
    exception when others then
        v_ok := v_ok + 1; v_report := v_report || 'A3-10 OK - INSERT bloque comme attendu' || chr(10);
    end;

    begin
        delete from comments where id = v_comment_control_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-11 OK - visitor a supprime 0 ligne (bloque par RLS)' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-11 ECHEC - visitor a supprime %s ligne(s) (attendu 0)', v_rows) || chr(10); end if;
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-11 OK - DELETE bloque au niveau GRANT (permission denied)' || chr(10);
    end;

    -- share_tokens : visibilite et ecriture
    select count(*) into v_count from share_tokens where id in (v_token_admin_id, v_token_user_id);
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-12 OK - visitor ne voit aucun jeton de partage' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-12 ECHEC - visitor voit %s jeton(s) (attendu 0)', v_count) || chr(10); end if;

    begin
        update share_tokens set is_revoked = true where id = v_token_user_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-13 OK - visitor a revoque 0 jeton (bloque par RLS)' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-13 ECHEC - visitor a revoque %s jeton(s) (attendu 0)', v_rows) || chr(10); end if;
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-13 OK - UPDATE bloque au niveau GRANT (permission denied)' || chr(10);
    end;

    -- audit_logs : lecture interdite, insertion restreinte a soi-meme
    select count(*) into v_count from audit_logs;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-14 OK - visitor ne voit aucune ligne d''audit_logs' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-14 ECHEC - visitor voit %s ligne(s) (attendu 0)', v_count) || chr(10); end if;

    begin
        insert into audit_logs (user_id, user_email, action, entity_type, entity_name)
        values (v_visitor_id, v_visitor_email, 'test_a3', 'test', 'test');
        v_ok := v_ok + 1; v_report := v_report || 'A3-15 OK - visitor a bien pu journaliser sa propre action' || chr(10);
    exception when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-15 ECHEC - INSERT bloque alors qu''il devrait etre autorise (%s)', sqlerrm) || chr(10);
    end;

    begin
        insert into audit_logs (user_id, user_email, action, entity_type, entity_name)
        values (v_admin_id, v_admin_email, 'test_a3_usurpation', 'test', 'test');
        v_fail := v_fail + 1; v_report := v_report || 'A3-16 ECHEC - visitor a reussi a usurper un autre user_id' || chr(10);
    exception when others then
        v_ok := v_ok + 1; v_report := v_report || 'A3-16 OK - usurpation bloquee comme attendu' || chr(10);
    end;

    -- users : visibilite restreinte a soi-meme, ecriture interdite
    select count(*) into v_count from users;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-17 OK - visitor voit uniquement sa propre fiche' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-17 ECHEC - visitor voit %s ligne(s) (attendu 1)', v_count) || chr(10); end if;

    begin
        update users set role = 'admin' where id = v_visitor_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-18 OK - auto-promotion bloquee (0 ligne)' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-18 ECHEC - visitor a modifie son role sur %s ligne(s)', v_rows) || chr(10); end if;
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-18 OK - UPDATE bloque au niveau GRANT (permission denied)' || chr(10);
    end;

    begin
        insert into users (id, name, email, role) values (gen_random_uuid(), 'TEST', 'test-a3@example.com', 'admin');
        v_fail := v_fail + 1; v_report := v_report || 'A3-19 ECHEC - visitor a reussi a inserer directement dans users' || chr(10);
    exception when others then
        v_ok := v_ok + 1; v_report := v_report || 'A3-19 OK - INSERT bloque comme attendu' || chr(10);
    end;

    -- Tests en tant que user
    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_id), true);
    perform set_config('role', 'authenticated', true);

    select count(*) into v_count from talents where id = v_talent_redlisted_id;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-20 OK - user voit le talent Liste Rouge (restriction visitor uniquement)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-20 ECHEC - user voit %s ligne(s) (attendu 1)', v_count) || chr(10); end if;

    begin
        insert into talents (first_name, last_name, pool) values ('TEST-A3', 'USER INSERT', 'COLOG');
        v_ok := v_ok + 1; v_report := v_report || 'A3-21 OK - INSERT reussi comme attendu' || chr(10);
    exception when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-21 ECHEC - user devrait pouvoir inserer un talent mais a ete bloque (%s)', sqlerrm) || chr(10);
    end;

    begin
        delete from talents where id = v_dummy_talent_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-22 OK - user a supprime 0 ligne (DELETE admin uniquement)' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-22 ECHEC - user a supprime %s ligne(s) (attendu 0)', v_rows) || chr(10); end if;
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-22 OK - DELETE bloque au niveau GRANT (permission denied)' || chr(10);
    end;

    begin
        update comments set content = 'TEST user non-proprietaire' where id = v_comment_control_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-23 OK - user (non proprietaire) a modifie 0 ligne' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-23 ECHEC - user (non proprietaire) a modifie %s ligne(s) (attendu 0)', v_rows) || chr(10); end if;
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-23 OK - UPDATE bloque au niveau GRANT (permission denied)' || chr(10);
    end;

    update comments set content = 'TEST user proprietaire - modifie' where id = v_comment_owned_by_user_id;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-24 OK - user (proprietaire) a modifie son propre commentaire' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-24 ECHEC - user (proprietaire) a modifie %s ligne(s) (attendu 1)', v_rows) || chr(10); end if;

    select count(*) into v_count from share_tokens where id in (v_token_admin_id, v_token_user_id);
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-25 OK - user voit uniquement le jeton qu''il a cree' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-25 ECHEC - user voit %s jeton(s) (attendu 1)', v_count) || chr(10); end if;

    begin
        delete from share_tokens where id = v_token_user_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-26 OK - user (createur) a supprime 0 jeton (DELETE admin uniquement)' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-26 ECHEC - user a supprime %s jeton(s) (attendu 0)', v_rows) || chr(10); end if;
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-26 OK - DELETE bloque au niveau GRANT (permission denied)' || chr(10);
    end;

    select count(*) into v_count from audit_logs;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-27 OK - user ne voit aucune ligne d''audit_logs' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-27 ECHEC - user voit %s ligne(s) (attendu 0)', v_count) || chr(10); end if;

    begin
        update users set role = 'admin' where id = v_user_id;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-28 OK - auto-promotion bloquee (0 ligne)' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-28 ECHEC - user a modifie son role sur %s ligne(s)', v_rows) || chr(10); end if;
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-28 OK - UPDATE bloque au niveau GRANT (permission denied)' || chr(10);
    end;

    select count(*) into v_count from users;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-29 OK - user voit uniquement sa propre fiche' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-29 ECHEC - user voit %s ligne(s) (attendu 1)', v_count) || chr(10); end if;

    -- Tests en tant que admin
    perform set_config('role', v_admin_role, true);

    -- Vrai total actuel, mesure ici en bypass RLS (donc fiable quel que
    -- soit le nombre reel de comptes) plutot qu'un seuil fige a comparer.
    select count(*) into v_total_users from users;

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin_id), true);
    perform set_config('role', 'authenticated', true);

    select count(*) into v_count from audit_logs;
    if v_count >= 1 then v_ok := v_ok + 1; v_report := v_report || format('A3-30 OK - admin voit %s ligne(s) d''audit_logs', v_count) || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-30 ECHEC - admin voit 0 ligne (attendu >= 1)' || chr(10); end if;

    select count(*) into v_count from users;
    if v_count = v_total_users then v_ok := v_ok + 1; v_report := v_report || format('A3-31 OK - admin voit %s ligne(s) dans users (toutes les fiches)', v_count) || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-31 ECHEC - admin voit %s ligne(s) sur %s au total (devrait voir toutes les fiches)', v_count, v_total_users) || chr(10); end if;

    delete from talents where id = v_dummy_talent_id;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-32 OK - admin a supprime le talent factice' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-32 ECHEC - admin a supprime %s ligne(s) (attendu 1)', v_rows) || chr(10); end if;

    select id into v_log_id from audit_logs limit 1;
    if v_log_id is null then
        v_skip := v_skip + 1; v_report := v_report || 'A3-33 IGNORE - aucune ligne dans audit_logs pour tester UPDATE' || chr(10);
    else
        begin
            update audit_logs set details = 'TEST A3' where id = v_log_id;
            get diagnostics v_rows = row_count;
            if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-33 OK - admin a modifie 0 ligne d''audit_logs (aucune policy UPDATE)' || chr(10);
            else v_fail := v_fail + 1; v_report := v_report || format('A3-33 ECHEC - admin a modifie %s ligne(s) d''audit_logs (attendu 0)', v_rows) || chr(10); end if;
        exception when insufficient_privilege then
            v_ok := v_ok + 1; v_report := v_report || 'A3-33 OK - UPDATE bloque au niveau GRANT (permission denied), meme pour admin' || chr(10);
        end;
    end if;

    select id into v_log_id from audit_logs limit 1;
    if v_log_id is null then
        v_skip := v_skip + 1; v_report := v_report || 'A3-34 IGNORE - aucune ligne dans audit_logs pour tester DELETE' || chr(10);
    else
        begin
            delete from audit_logs where id = v_log_id;
            get diagnostics v_rows = row_count;
            if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-34 OK - admin a supprime 0 ligne d''audit_logs (aucune policy DELETE)' || chr(10);
            else v_fail := v_fail + 1; v_report := v_report || format('A3-34 ECHEC - admin a supprime %s ligne(s) d''audit_logs (attendu 0)', v_rows) || chr(10); end if;
        exception when insufficient_privilege then
            v_ok := v_ok + 1; v_report := v_report || 'A3-34 OK - DELETE bloque au niveau GRANT (permission denied), meme pour admin' || chr(10);
        end;
    end if;

    -- Tests en tant que user puis admin suspendus (suspension annulee par le rollback force)
    perform set_config('role', v_admin_role, true);
    update users set is_active = false where id in (v_user_id, v_admin_id);

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_id), true);
    perform set_config('role', 'authenticated', true);

    select count(*) into v_count from talents;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-35 OK - user suspendu ne voit aucun talent' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-35 ECHEC - user suspendu voit %s talent(s) (attendu 0)', v_count) || chr(10); end if;

    select count(*) into v_count from comments;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-36 OK - user suspendu ne voit aucun commentaire' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-36 ECHEC - user suspendu voit %s commentaire(s) (attendu 0)', v_count) || chr(10); end if;

    update talents set last_name = last_name where id = v_talent_control_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-37 OK - user suspendu ne modifie aucun talent' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-37 ECHEC - user suspendu a modifie %s talent(s) (attendu 0)', v_rows) || chr(10); end if;

    begin
        insert into talents (first_name, last_name) values ('TEST-A3', 'SUSPENDU');
        v_fail := v_fail + 1; v_report := v_report || 'A3-38 ECHEC - user suspendu a cree un talent' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-38 OK - user suspendu ne peut pas creer de talent' || chr(10);
    end;

    select count(*) into v_count from users;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-39 OK - user suspendu voit encore sa propre fiche (message Compte desactive)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-39 ECHEC - user suspendu voit %s ligne(s) dans users (attendu 1)', v_count) || chr(10); end if;

    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin_id), true);
    perform set_config('role', 'authenticated', true);

    select count(*) into v_count from audit_logs;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-40 OK - admin suspendu ne voit plus audit_logs' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-40 ECHEC - admin suspendu voit %s ligne(s) d''audit_logs (attendu 0)', v_count) || chr(10); end if;

    -- Bilan et rollback force
    perform set_config('role', v_admin_role, true);

    v_total := v_ok + v_fail + v_skip;

    if v_fail > 0 then
        v_final_message := format('A3 BILAN : %s ECHEC(S) sur %s tests (%s OK, %s IGNORE)', v_fail, v_total, v_ok, v_skip);
    else
        v_final_message := format('A3 BILAN : TOUS LES TESTS ONT REUSSI (%s/%s, %s IGNORE)', v_ok, v_total, v_skip);
    end if;

    -- Seul un RAISE EXCEPTION est affiche par l'editeur : bilan en premiere ligne, detail ensuite.
    raise exception E'%\n\n--- Detail des 40 tests ---\n%', v_final_message, v_report;
end $$;
