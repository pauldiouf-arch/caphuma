-- =====================================================================
-- sql/tests_rls_roles.sql
-- Cap Huma — Test des policies RLS par role (visitor / user / admin)
-- Master Context §7, chantier A3
-- =====================================================================
--
-- OBJECTIF : simuler chaque role applicatif (visitor, user, admin) et
-- tenter les actions interdites sur talents, comments, evaluations,
-- share_tokens, audit_logs, users.
--
-- ARCHITECTURE (v2 — reecrite le 18/08/2026) : TOUT le test tient dans
-- UN SEUL bloc "do $$ ... $$;", c'est-a-dire UNE SEULE instruction SQL.
-- Ce choix n'est pas cosmetique : l'editeur SQL de Supabase ne garantit
-- pas qu'un script colle en une fois s'execute sur une seule connexion
-- continue a la base (verifie en conditions reelles le 18/08/2026 :
-- meme un script de 3 lignes triviales — CREATE TEMP TABLE / INSERT /
-- SELECT — echoue avec "relation does not exist" sur le SELECT). Un
-- bloc unique elimine ce risque : par definition, une seule instruction
-- ne peut pas etre coupee entre plusieurs connexions.
--
-- SECURITE / ROLLBACK : PostgreSQL enveloppe automatiquement toute
-- instruction unique dans sa propre transaction implicite. Ce bloc
-- provoque TOUJOURS une erreur volontaire a la toute fin (raise
-- exception), qu'il y ait des tests en echec ou non — c'est le seul
-- moyen fiable de forcer l'annulation de toutes les ecritures de test
-- (talents/commentaires/evaluations/jetons crees pour le test) sans
-- dependre d'un BEGIN/ROLLBACK ecrit comme instruction a part (qui
-- recreerait le probleme initial). CONSEQUENCE VISIBLE : le dernier
-- message affiche par l'editeur sera TOUJOURS une erreur rouge, meme
-- quand tout va bien. Ce n'est pas un bug.
--
-- COMMENT EXECUTER : coller ce fichier en entier (uniquement ce bloc,
-- rien avant ni apres — pas de "begin;"/"rollback;" ajoute autour) dans
-- l'editeur SQL Supabase et cliquer "Run".
--
-- COMMENT LIRE LE RESULTAT : l'editeur SQL Supabase n'affiche PAS de
-- facon fiable les RAISE NOTICE/WARNING (verifie le 18/08/2026, aucun
-- onglet "Messages" equivalent a pgAdmin) — donc TOUT le detail est
-- regroupe dans le texte du message d'erreur rouge final lui-meme.
-- Lire ce message en entier (pas juste sa premiere ligne) :
--   - 1ere ligne "A3 BILAN : TOUS LES TESTS ONT REUSSI (N/N, ...)"  →
--     tout est bon, le reste du message (detail des 34 tests) est
--     informatif mais rien a corriger.
--   - 1ere ligne "A3 BILAN : N ECHEC(S) sur T tests (...)" → chercher
--     plus bas dans le meme message les lignes "A3-XX ECHEC" pour voir
--     lesquels ont echoue.
--   - Une ligne "A3-06 IGNORE" est neutre (ni succes ni echec) : le
--     test n'a pas pu s'executer, voir le detail sur la ligne.
--
-- IDENTIFIANTS UTILISES (v3 — reecrit le 12/09/2026, chantier PII-1) :
-- Ce fichier ne contient plus aucun UUID, nom ou email reel. Au lieu de
-- cibler des comptes et des fiches talents specifiques codes en dur, le
-- bloc SETUP ci-dessous :
--   - retrouve dynamiquement le premier compte de chaque role (admin,
--     user, visitor) present dans la table users ;
--   - cree lui-meme 3 fiches talents factices (Liste Rouge / devalidee /
--     temoin) au lieu de basculer temporairement des fiches reelles.
-- Consequence pratique : un compte de test du role "visitor" doit
-- exister dans la base pour que ce script fonctionne (le role "visitor"
-- n'etant pas garanti d'avoir un titulaire reel en permanence). S'il
-- n'en existe pas, le script s'arrete proprement des le SETUP avec un
-- message explicite plutot que d'echouer plus loin de facon confuse.
--
-- LIMITES ASSUMEES :
--   - `evaluations` : insertion de test protegee par gestion d'erreur,
--     la nullabilite de mission_id n'etant pas confirmee ; en cas
--     d'echec, le test A3-06 associe passe en IGNORE plutot que de
--     faire echouer tout le bloc.
--   - `users` : aucune tentative de DELETE reelle, meme annulee (table
--     liee a auth.users) — la protection est deja confirmee sur pieces
--     via pg_policies (aucune policy DELETE = blocage total).
-- =====================================================================

do $$
declare
    -- role de la session qui execute ce bloc (typiquement 'postgres',
    -- bypass RLS par defaut) — utilise pour revenir en mode "admin
    -- technique" entre deux simulations de role applicatif
    v_admin_role text;

    -- compteurs de bilan et rapport texte (voir note plus haut : c'est
    -- le seul canal fiable pour faire remonter du texte dans l'editeur
    -- SQL Supabase, qui n'affiche pas RAISE NOTICE/WARNING)
    v_ok   int := 0;
    v_fail int := 0;
    v_skip int := 0;
    v_total int;
    v_report text := '';
    v_final_message text;

    -- comptes utilises pour simuler chaque role, resolus dynamiquement
    -- au debut du SETUP (voir bloc S0 ci-dessous) — jamais codes en dur
    v_admin_id      uuid;
    v_admin_email   text;
    v_user_id       uuid;
    v_user_email    text;
    v_visitor_id    uuid;
    v_visitor_email text;

    -- talents factices crees pour le test (voir S1/S2/S3) — jamais de
    -- fiche reelle manipulee
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

    -- =================================================================
    -- SETUP — execute sous le role de session (bypass RLS)
    -- =================================================================

    -- S0 : resolution dynamique d'un compte de chaque role. Le premier
    -- compte trouve par role est utilise ; peu importe qui il est,
    -- seul son role compte pour ce test.
    select id, email into v_admin_id, v_admin_email
        from users where role = 'admin' order by created_at limit 1;
    select id, email into v_user_id, v_user_email
        from users where role = 'user' order by created_at limit 1;
    select id, email into v_visitor_id, v_visitor_email
        from users where role = 'visitor' order by created_at limit 1;

    if v_admin_id is null or v_user_id is null or v_visitor_id is null then
        raise exception 'A3 SETUP IMPOSSIBLE : au moins un compte de chaque role (admin, user, visitor) doit exister dans la table users pour lancer ce test. Manquant -> admin:%, user:%, visitor:%',
            (v_admin_id is null), (v_user_id is null), (v_visitor_id is null);
    end if;

    -- S1/S2/S3 : trois talents factices dedies au test, crees ici et
    -- detruits par le rollback force en fin de bloc — jamais de fiche
    -- reelle manipulee, contrairement a la v2 de ce script.
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

    -- =================================================================
    -- TESTS EN TANT QUE VISITOR
    -- =================================================================
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_visitor_id), true);
    perform set_config('role', 'authenticated', true);

    -- --- talents : visibilite ---
    select count(*) into v_count from talents where id = v_talent_redlisted_id;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-01 OK - visitor ne voit pas le talent Liste Rouge' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-01 ECHEC - visitor voit %s ligne(s) du talent Liste Rouge (attendu 0)', v_count) || chr(10); end if;

    select count(*) into v_count from talents where id = v_talent_devalidated_id;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-02 OK - visitor ne voit pas le talent devalide' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-02 ECHEC - visitor voit %s ligne(s) du talent devalide (attendu 0)', v_count) || chr(10); end if;

    select count(*) into v_count from talents where id = v_talent_control_id;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-03 OK - visitor voit bien le talent temoin (sanity check)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-03 ECHEC - visitor voit %s ligne(s) du talent temoin (attendu 1)', v_count) || chr(10); end if;

    -- --- comments : visibilite ---
    select count(*) into v_count from comments where id = v_comment_redlisted_id;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-04 OK - visitor ne voit pas le commentaire lie au talent Liste Rouge' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-04 ECHEC - visitor voit %s ligne(s) (attendu 0)', v_count) || chr(10); end if;

    select count(*) into v_count from comments where id = v_comment_control_id;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-05 OK - visitor voit le commentaire lie au talent temoin' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-05 ECHEC - visitor voit %s ligne(s) (attendu 1)', v_count) || chr(10); end if;

    -- --- evaluations : visibilite ---
    if v_eval_setup_ok then
        select count(*) into v_count from evaluations where id = v_eval_devalidated_id;
        if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-06 OK - visitor ne voit pas l''evaluation liee au talent devalide' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-06 ECHEC - visitor voit %s ligne(s) (attendu 0)', v_count) || chr(10); end if;
    else
        v_skip := v_skip + 1;
        v_report := v_report || 'A3-06 IGNORE - insertion de test evaluations impossible au setup (voir message ci-dessus)' || chr(10);
    end if;

    -- --- talents : ecriture interdite ---
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

    -- --- comments : ecriture interdite ---
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

    -- --- share_tokens : visibilite et ecriture ---
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

    -- --- audit_logs : lecture interdite, insertion restreinte a soi-meme ---
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

    -- --- users : visibilite restreinte a soi-meme, ecriture interdite ---
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

    -- =================================================================
    -- TESTS EN TANT QUE USER
    -- =================================================================
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

    -- =================================================================
    -- TESTS EN TANT QUE ADMIN
    -- =================================================================
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

    -- =================================================================
    -- BILAN + ROLLBACK FORCE
    -- =================================================================
    perform set_config('role', v_admin_role, true);

    v_total := v_ok + v_fail + v_skip;

    if v_fail > 0 then
        v_final_message := format('A3 BILAN : %s ECHEC(S) sur %s tests (%s OK, %s IGNORE)', v_fail, v_total, v_ok, v_skip);
    else
        v_final_message := format('A3 BILAN : TOUS LES TESTS ONT REUSSI (%s/%s, %s IGNORE)', v_ok, v_total, v_skip);
    end if;

    -- Bilan en premiere ligne (le plus important, visible meme si le
    -- message est tronque quelque part), puis le detail complet des 34
    -- tests en dessous. C'est le SEUL canal qui fait remonter ce texte
    -- jusqu'a l'ecran : RAISE NOTICE/WARNING n'apparaissent nulle part
    -- dans l'editeur SQL Supabase (verifie le 18/08/2026), seul un
    -- message d'erreur (RAISE EXCEPTION) est affiche. D'ou le choix
    -- d'accumuler tout dans v_report et de le faire sortir ici, dans le
    -- rollback force qui doit de toute facon se produire a la fin.
    raise exception E'%\n\n--- Detail des 34 tests ---\n%', v_final_message, v_report;
end $$;
