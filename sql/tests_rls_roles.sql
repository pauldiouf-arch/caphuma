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
-- (bascule Liste Rouge/devalidation temporaire, INSERT/UPDATE/DELETE de
-- test) sans dependre d'un BEGIN/ROLLBACK ecrit comme instruction a
-- part (qui recreerait le probleme initial). CONSEQUENCE VISIBLE : le
-- dernier message affiche par l'editeur sera TOUJOURS une erreur rouge,
-- meme quand tout va bien. Ce n'est pas un bug.
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
-- IDENTIFIANTS UTILISES (comptes reels au 18/08/2026, jamais modifies
-- pour de vrai) :
--   admin   : 010e9996-cfed-4b32-880e-9a66c6b8f8f9 (paul.diouf@alima.ngo)
--   user    : cfe9e9ca-5cd3-403f-b66a-fc955acf8b14 (ibrahima.ciss@alima.ngo)
--   visitor : 2493fcae-b17b-4bd0-9af3-0f02b3d83898 (sdferto@gmail.com,
--             compte de test cree le 18/08/2026 specifiquement pour A3)
--
-- TALENTS UTILISES (comptes reels, bascules TEMPORAIREMENT le temps du
-- bloc, jamais modifies pour de vrai grace au rollback force) :
--   e4599905-5ffa-4b7f-a059-fb01b24ff5fb (Aissatou Ba)   -> Liste Rouge temporaire
--   13fa2e10-c98b-46fa-aee8-3d5100555b64 (Ibrahima FIRST) -> devalide temporaire
--   b83e9f6e-a43a-4fdc-9b9e-5c77663cc74e (Paul FIRST)     -> temoin, jamais touche
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
    v_count  int;
    v_rows   int;
    v_log_id uuid;
begin
    select session_user into v_admin_role;

    -- =================================================================
    -- SETUP — execute sous le role de session (bypass RLS)
    -- =================================================================

    -- S1/S2 : bascule temporaire des deux talents reels
    update talents set is_red_listed = true, red_list_reason = 'TEST RLS temporaire (A3)'
    where id = 'e4599905-5ffa-4b7f-a059-fb01b24ff5fb';

    update talents set is_valid = false
    where id = '13fa2e10-c98b-46fa-aee8-3d5100555b64';

    -- S3 : talent factice dedie aux tests d'ecriture
    insert into talents (first_name, last_name, pool)
    values ('TEST-A3', 'DUMMY-ECRITURE', 'COLOG')
    returning id into v_dummy_talent_id;

    -- S4/S5/S6 : commentaires de test
    insert into comments (talent_id, user_id, content, author_email)
    values ('e4599905-5ffa-4b7f-a059-fb01b24ff5fb', '010e9996-cfed-4b32-880e-9a66c6b8f8f9',
            'TEST RLS temporaire - commentaire sur talent Liste Rouge', 'paul.diouf@alima.ngo')
    returning id into v_comment_redlisted_id;

    insert into comments (talent_id, user_id, content, author_email)
    values ('b83e9f6e-a43a-4fdc-9b9e-5c77663cc74e', '010e9996-cfed-4b32-880e-9a66c6b8f8f9',
            'TEST RLS temporaire - commentaire sur talent temoin', 'paul.diouf@alima.ngo')
    returning id into v_comment_control_id;

    insert into comments (talent_id, user_id, content, author_email)
    values ('b83e9f6e-a43a-4fdc-9b9e-5c77663cc74e', 'cfe9e9ca-5cd3-403f-b66a-fc955acf8b14',
            'TEST RLS temporaire - commentaire du user de test', 'ibrahima.ciss@alima.ngo')
    returning id into v_comment_owned_by_user_id;

    -- S7 : evaluation de test, protegee (nullabilite de mission_id non confirmee)
    begin
        insert into evaluations (talent_id, author_id, context, author_email)
        values ('13fa2e10-c98b-46fa-aee8-3d5100555b64', '010e9996-cfed-4b32-880e-9a66c6b8f8f9',
                'TEST RLS temporaire - evaluation sur talent devalide', 'paul.diouf@alima.ngo')
        returning id into v_eval_devalidated_id;
        v_eval_setup_ok := true;
    exception when others then
        v_eval_setup_ok := false;
        v_report := v_report || format('Setup evaluations ECHEC (%s) - le test A3-06 sera IGNORE', sqlerrm) || chr(10);
    end;

    -- S8/S9 : jetons de partage de test
    insert into share_tokens (token, talent_id, created_by, created_by_name, expires_at)
    values ('test-a3-admin-' || gen_random_uuid()::text, 'b83e9f6e-a43a-4fdc-9b9e-5c77663cc74e',
            '010e9996-cfed-4b32-880e-9a66c6b8f8f9', 'TEST A3 Admin', now() + interval '7 days')
    returning id into v_token_admin_id;

    insert into share_tokens (token, talent_id, created_by, created_by_name, expires_at)
    values ('test-a3-user-' || gen_random_uuid()::text, 'b83e9f6e-a43a-4fdc-9b9e-5c77663cc74e',
            'cfe9e9ca-5cd3-403f-b66a-fc955acf8b14', 'TEST A3 User', now() + interval '7 days')
    returning id into v_token_user_id;

    v_report := v_report || 'Setup termine (talent factice, 3 commentaires, jetons de partage, evaluation si possible)' || chr(10);

    -- =================================================================
    -- TESTS EN TANT QUE VISITOR (2493fcae-b17b-4bd0-9af3-0f02b3d83898)
    -- =================================================================
    perform set_config('request.jwt.claims', '{"sub":"2493fcae-b17b-4bd0-9af3-0f02b3d83898","role":"authenticated"}', true);
    perform set_config('role', 'authenticated', true);

    -- --- talents : visibilite ---
    select count(*) into v_count from talents where id = 'e4599905-5ffa-4b7f-a059-fb01b24ff5fb';
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-01 OK - visitor ne voit pas le talent Liste Rouge' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-01 ECHEC - visitor voit %s ligne(s) du talent Liste Rouge (attendu 0)', v_count) || chr(10); end if;

    select count(*) into v_count from talents where id = '13fa2e10-c98b-46fa-aee8-3d5100555b64';
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-02 OK - visitor ne voit pas le talent devalide' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-02 ECHEC - visitor voit %s ligne(s) du talent devalide (attendu 0)', v_count) || chr(10); end if;

    select count(*) into v_count from talents where id = 'b83e9f6e-a43a-4fdc-9b9e-5c77663cc74e';
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
        values ('b83e9f6e-a43a-4fdc-9b9e-5c77663cc74e', '2493fcae-b17b-4bd0-9af3-0f02b3d83898',
                'TEST visitor insert', 'sdferto@gmail.com');
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
        values ('2493fcae-b17b-4bd0-9af3-0f02b3d83898', 'sdferto@gmail.com', 'test_a3', 'test', 'test');
        v_ok := v_ok + 1; v_report := v_report || 'A3-15 OK - visitor a bien pu journaliser sa propre action' || chr(10);
    exception when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-15 ECHEC - INSERT bloque alors qu''il devrait etre autorise (%s)', sqlerrm) || chr(10);
    end;

    begin
        insert into audit_logs (user_id, user_email, action, entity_type, entity_name)
        values ('010e9996-cfed-4b32-880e-9a66c6b8f8f9', 'paul.diouf@alima.ngo', 'test_a3_usurpation', 'test', 'test');
        v_fail := v_fail + 1; v_report := v_report || 'A3-16 ECHEC - visitor a reussi a usurper un autre user_id' || chr(10);
    exception when others then
        v_ok := v_ok + 1; v_report := v_report || 'A3-16 OK - usurpation bloquee comme attendu' || chr(10);
    end;

    -- --- users : visibilite restreinte a soi-meme, ecriture interdite ---
    select count(*) into v_count from users;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-17 OK - visitor voit uniquement sa propre fiche' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-17 ECHEC - visitor voit %s ligne(s) (attendu 1)', v_count) || chr(10); end if;

    begin
        update users set role = 'admin' where id = '2493fcae-b17b-4bd0-9af3-0f02b3d83898';
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
    -- TESTS EN TANT QUE USER (cfe9e9ca-5cd3-403f-b66a-fc955acf8b14 - Ibrahima Ciss)
    -- =================================================================
    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', '{"sub":"cfe9e9ca-5cd3-403f-b66a-fc955acf8b14","role":"authenticated"}', true);
    perform set_config('role', 'authenticated', true);

    select count(*) into v_count from talents where id = 'e4599905-5ffa-4b7f-a059-fb01b24ff5fb';
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
        update users set role = 'admin' where id = 'cfe9e9ca-5cd3-403f-b66a-fc955acf8b14';
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
    -- TESTS EN TANT QUE ADMIN (010e9996-cfed-4b32-880e-9a66c6b8f8f9 - Paul Diouf)
    -- =================================================================
    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', '{"sub":"010e9996-cfed-4b32-880e-9a66c6b8f8f9","role":"authenticated"}', true);
    perform set_config('role', 'authenticated', true);

    select count(*) into v_count from audit_logs;
    if v_count >= 1 then v_ok := v_ok + 1; v_report := v_report || format('A3-30 OK - admin voit %s ligne(s) d''audit_logs', v_count) || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-30 ECHEC - admin voit 0 ligne (attendu >= 1)' || chr(10); end if;

    select count(*) into v_count from users;
    if v_count >= 6 then v_ok := v_ok + 1; v_report := v_report || format('A3-31 OK - admin voit %s ligne(s) dans users (toutes les fiches)', v_count) || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-31 ECHEC - admin voit %s ligne(s) (attendu >= 6)', v_count) || chr(10); end if;

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
