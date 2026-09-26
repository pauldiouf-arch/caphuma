-- Test des policies RLS par role (visitor / user / admin, puis compte suspendu) sur talents, comments,
-- evaluations, share_tokens, audit_logs, users et access_code_requests, et des fonctions appelees par le site
-- (demandes de nouveau code, changement de pool, enregistrement des postes, contrats echus, portes du visiteur : talents, postes, evaluations, statistiques ; tables fermees au visiteur ; donnees de l'analyse IA), et des auteurs
-- imposes par la base (Liste Rouge, prolongation, created_by, liens de partage), des regles des liens de partage
-- (jeton, expiration, revocation, contenu public) et de la journalisation (log_client_event, declencheurs).
--
-- Execution : coller ce fichier en entier dans l'editeur SQL Supabase, sans rien ajouter autour,
-- puis Run. Tout tient dans un seul bloc do $$ : l'editeur ne garantit pas une connexion unique
-- entre deux instructions.
--
-- Lecture : le bloc finit TOUJOURS par une erreur rouge volontaire, qui annule toutes les
-- ecritures de test. Le bilan est dans ce message (l'editeur n'affiche pas les RAISE NOTICE) :
--   - "A3 BILAN : TOUS LES TESTS ONT REUSSI" : rien a faire ;
--   - "A3 BILAN : N ECHEC(S)" : chercher les lignes "A3-XX ECHEC" plus bas ;
--   - "A3-33 IGNORE" ou "A3-34 IGNORE" : audit_logs vide, test non executable, ni succes ni echec ;
--   - "A3-50 IGNORE" (et A3-51, A3-58) : adresse du user de test hors @alima.ngo, ou 18 demandes de
--     nouveau code ou plus sur 24 h.
--
-- Prerequis : un compte actif de chaque role, dont un visitor, doit exister dans users.
-- Aucun identifiant reel n'est code en dur, les fiches de test sont factices.
-- Limite : pas de DELETE reel sur users (protection confirmee via pg_policies).

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
    v_mission_id               uuid;
    v_eval_devalidated_id      uuid;
    v_token_admin_id           uuid;
    v_token_user_id            uuid;

    -- variables de travail reutilisees test apres test
    v_count       int;
    v_rows        int;
    v_log_id      uuid;
    v_total_users int;
    v_site_functions text[] := array[
        'public.request_access_code_reset(text)', 'public.dismiss_access_code_request(uuid)',
        'public.change_talent_pool(uuid,text)', 'public.promote_national_to_expat(uuid,text)',
        'public.save_mission(uuid,jsonb,uuid)', 'public.delete_mission(uuid)',
        'public.resync_mission_occupant(uuid)', 'public.process_expired_missions(text)',
        'public.log_client_event(text,text,text,text,text)',
        'public.visitor_talents_page(text,jsonb,integer)', 'public.visitor_talent_card(uuid)',
        'public.visitor_pool_missions(text)', 'public.visitor_mission_evaluations(uuid)', 'public.visitor_statistics_rows()'];
    v_request_testable     boolean;
    v_unknown_email        text;
    v_request_id           uuid;
    v_request_suspended_id uuid;
    v_expat_pool_id        uuid;
    v_national_id          uuid;
    v_occupant_a_id        uuid;
    v_occupant_b_id        uuid;
    v_mission_payload      jsonb;
    v_test_mission_1_id    uuid;
    v_test_mission_2_id    uuid;
    v_attr_talent_id       uuid;
    v_user_display_name    text;
    v_attr_ok              boolean;
    v_token_user_value     text;
    v_json                 jsonb;
    v_new_token_id         uuid;
    v_cascade_talent_id    uuid;
    v_state                text;
    v_eval_control_id      uuid;
    v_dashboard_visitor    jsonb;
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

    -- S8 : poste et evaluation de test (une evaluation exige un poste)
    insert into missions (title, pool_level, location, pool)
    values ('TEST RLS temporaire (A3)', 'mission', 'TEST', 'COLOG')
    returning id into v_mission_id;

    insert into evaluations (mission_id, talent_id, author_id, context, author_email)
    values (v_mission_id, v_talent_devalidated_id, v_admin_id,
            'TEST RLS temporaire - evaluation sur talent devalide', v_admin_email)
    returning id into v_eval_devalidated_id;

    -- S9/S10 : jetons de partage de test
    insert into share_tokens (token, talent_id, created_by, created_by_name, expires_at)
    values ('test-a3-admin-' || gen_random_uuid()::text, v_talent_control_id,
            v_admin_id, 'TEST A3 Admin', now() + interval '7 days')
    returning id into v_token_admin_id;

    insert into share_tokens (token, talent_id, created_by, created_by_name, expires_at)
    values ('test-a3-user-' || gen_random_uuid()::text, v_talent_control_id,
            v_user_id, 'TEST A3 User', now() + interval '7 days')
    returning id into v_token_user_id;

    select token into v_token_user_value from share_tokens where id = v_token_user_id;
    update talents
    set archived_position_passages = '[{"positionTitle":"TEST A3 poste archive","startDate":"2020-01-01","endDate":"2021-01-01","comments":[{"negative_points":"TEST A3 point negatif","rating":2,"author_email":"a3@example.com"}]}]'
    where id = v_talent_control_id;

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
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-03 OK - visitor ne lit plus directement la table talents (temoin compris)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-03 ECHEC - visitor lit directement %s ligne(s) du talent temoin (attendu 0)', v_count) || chr(10); end if;

    -- comments : visibilite
    select count(*) into v_count from comments where id = v_comment_redlisted_id;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-04 OK - visitor ne voit pas le commentaire lie au talent Liste Rouge' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-04 ECHEC - visitor voit %s ligne(s) (attendu 0)', v_count) || chr(10); end if;

    select count(*) into v_count from comments where id = v_comment_control_id;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-05 OK - visitor ne lit plus directement la table comments (temoin compris)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-05 ECHEC - visitor lit directement %s ligne(s) (attendu 0)', v_count) || chr(10); end if;

    select (select count(*) from missions) + (select count(*) from pool_history) + (select count(*) from evaluations) into v_count;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-115 OK - visitor ne lit plus directement missions, pool_history ni evaluations' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-115 ECHEC - visitor lit directement %s ligne(s) de missions, pool_history ou evaluations (attendu 0)', v_count) || chr(10); end if;

    -- evaluations : visibilite
    select count(*) into v_count from evaluations where id = v_eval_devalidated_id;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-06 OK - visitor ne voit pas l''evaluation liee au talent devalide' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-06 ECHEC - visitor voit %s ligne(s) (attendu 0)', v_count) || chr(10); end if;

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
        values (v_visitor_id, 'usurpation-a3@example.com', 'login', 'user', 'TEST-A3-AUTEUR');
        v_fail := v_fail + 1; v_report := v_report || 'A3-15 ECHEC - visitor a ecrit directement dans audit_logs' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-15 OK - aucune ecriture directe dans audit_logs' || chr(10);
    end;

    begin
        perform log_client_event('login', 'user', 'TEST-A3-FAUX-ID', 'TEST-A3-AUTEUR', 'TEST-A3');
        v_ok := v_ok + 1; v_report := v_report || 'A3-85 OK - visitor journalise sa connexion via log_client_event' || chr(10);
    exception when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-85 ECHEC - log_client_event refuse une connexion (%s)', sqlerrm) || chr(10);
    end;

    begin
        insert into audit_logs (user_id, user_email, action, entity_type, entity_name)
        values (v_admin_id, v_admin_email, 'login', 'user', 'TEST-A3-USURPATION');
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

    -- portes du visiteur : liste et fiche talent
    begin
        v_json := visitor_talents_page('COLOG', '{"search":"TEST-A3"}'::jsonb, 0);
        select count(*) filter (where r ->> 'id' = v_talent_control_id::text),
               count(*) filter (where r ->> 'id' in (v_talent_redlisted_id::text, v_talent_devalidated_id::text))
            into v_count, v_rows
            from jsonb_array_elements(v_json -> 'rows') r;
        if v_count = 1 and v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-101 OK - liste du visiteur : talent temoin present, Liste Rouge et devalide absents' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-101 ECHEC - liste du visiteur : temoin %s, Liste Rouge ou devalide %s (attendu 1 et 0)', v_count, v_rows) || chr(10); end if;

        select count(*) into v_count from jsonb_array_elements(v_json -> 'rows') r
            where r ? 'email' or r ? 'archived_position_passages' or r ? 'gender' or r ? 'nationality_code';
        if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-102 OK - liste du visiteur sans e-mail, genre, nationalite ni evaluations' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-102 ECHEC - %s ligne(s) de la liste du visiteur portent des donnees de la fiche', v_count) || chr(10); end if;
    exception when others then
        v_fail := v_fail + 2; v_report := v_report || format('A3-101/102 ECHEC - liste du visiteur indisponible (%s)', sqlerrm) || chr(10);
    end;

    begin
        v_json := visitor_talent_card(v_talent_control_id);
        if v_json -> 'talent' ->> 'id' = v_talent_control_id::text
           and v_json -> 'talent' ? 'email'
           and not (v_json -> 'talent' ? 'red_list_reason')
           and v_json::text like '%TEST A3 point negatif%'
           and v_json::text not like '%a3@example.com%'
           and jsonb_array_length(v_json -> 'comments') >= 1 then
            v_ok := v_ok + 1; v_report := v_report || 'A3-103 OK - fiche du visiteur complete, evaluations sans l''e-mail de leur auteur' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-103 ECHEC - fiche du visiteur inattendue : %s', left(v_json::text, 120)) || chr(10); end if;

        if visitor_talent_card(v_talent_redlisted_id) -> 'talent' = 'null'::jsonb
           and visitor_talent_card(v_talent_devalidated_id) -> 'talent' = 'null'::jsonb then
            v_ok := v_ok + 1; v_report := v_report || 'A3-104 OK - fiche du visiteur refusee pour un talent en Liste Rouge ou devalide' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || 'A3-104 ECHEC - le visiteur obtient la fiche d''un talent en Liste Rouge ou devalide' || chr(10); end if;
    exception when others then
        v_fail := v_fail + 2; v_report := v_report || format('A3-103/104 ECHEC - fiche du visiteur indisponible (%s)', sqlerrm) || chr(10);
    end;

    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from audit_logs
        where action = 'view' and entity_type = 'talent' and entity_id = v_talent_control_id::text
          and user_id = v_visitor_id and user_email = v_visitor_email;
    select count(*) into v_rows from audit_logs
        where action = 'view' and entity_id in (v_talent_redlisted_id::text, v_talent_devalidated_id::text);
    if v_count = 1 and v_rows = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-105 OK - consultation d''une fiche par le visiteur journalisee (et seulement les fiches obtenues)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-105 ECHEC - %s consultation(s) journalisee(s) pour le temoin, %s pour les fiches refusees (attendu 1 et 0)', v_count, v_rows) || chr(10); end if;

    insert into rate_limit_log (user_id, function_name)
        select v_visitor_id, 'visitor_talent_card' from generate_series(1, 50);
    insert into rate_limit_log (user_id, function_name)
        select v_visitor_id, 'visitor_talents_page' from generate_series(1, 600);
    perform set_config('role', 'authenticated', true);

    begin
        perform visitor_talent_card(v_talent_control_id);
        v_fail := v_fail + 1; v_report := v_report || 'A3-106 ECHEC - fiche obtenue au-dela de 50 consultations par heure' || chr(10);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if v_state = '54000' then v_ok := v_ok + 1; v_report := v_report || 'A3-106 OK - au-dela de 50 fiches par heure, la consultation est refusee' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-106 ECHEC - erreur inattendue (%s)', sqlerrm) || chr(10); end if;
    end;

    begin
        perform visitor_talents_page('COLOG', '{}'::jsonb, 0);
        v_fail := v_fail + 1; v_report := v_report || 'A3-107 ECHEC - liste obtenue au-dela de 600 pages par heure' || chr(10);
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if v_state = '54000' then v_ok := v_ok + 1; v_report := v_report || 'A3-107 OK - au-dela de 600 pages de liste par heure, la liste est refusee' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-107 ECHEC - erreur inattendue (%s)', sqlerrm) || chr(10); end if;
    end;

    perform set_config('role', v_admin_role, true);
    delete from rate_limit_log where user_id = v_visitor_id;
    perform set_config('role', 'authenticated', true);

    perform set_config('role', v_admin_role, true);
    insert into evaluations (mission_id, talent_id, author_id, context, negative_points, rating, author_email)
    values (v_mission_id, v_talent_control_id, v_admin_id, 'TEST RLS temporaire - evaluation du temoin', 'TEST A3 axe d''amelioration', 5, v_admin_email)
    returning id into v_eval_control_id;
    perform set_config('role', 'authenticated', true);

    begin
        v_json := visitor_pool_missions('COLOG');
        select count(*) into v_count from jsonb_array_elements(v_json -> 'missions') m where m ->> 'id' = v_mission_id::text;
        if v_count = 1 and not (v_json -> 'talent_names' ? v_talent_redlisted_id::text)
           and not (v_json -> 'talent_names' ? v_talent_devalidated_id::text) then
            v_ok := v_ok + 1; v_report := v_report || 'A3-110 OK - postes du visiteur servis par la base, sans nom de talent en Liste Rouge ou devalide' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-110 ECHEC - postes du visiteur inattendus : %s', left(v_json::text, 120)) || chr(10); end if;
    exception when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-110 ECHEC - postes du visiteur indisponibles (%s)', sqlerrm) || chr(10);
    end;

    begin
        v_json := visitor_mission_evaluations(v_mission_id);
        select count(*) into v_count from jsonb_array_elements(v_json) e where e ->> 'id' = v_eval_control_id::text;
        select count(*) into v_rows from jsonb_array_elements(v_json) e
            where e ->> 'id' = v_eval_devalidated_id::text or e ? 'author_email' or e ? 'author_id';
        if v_count = 1 and v_rows = 0 and v_json::text like '%TEST A3 axe d''amelioration%' then
            v_ok := v_ok + 1; v_report := v_report || 'A3-111 OK - evaluations d''un poste pour le visiteur : sans auteur, sans talent devalide' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-111 ECHEC - evaluations du visiteur inattendues : %s', left(v_json::text, 120)) || chr(10); end if;
    exception when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-111 ECHEC - evaluations du visiteur indisponibles (%s)', sqlerrm) || chr(10);
    end;

    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from audit_logs
        where action = 'view' and entity_type = 'mission' and entity_id = v_mission_id::text and user_id = v_visitor_id;
    select count(*) into v_rows from talents
        where staff_type = 'expat' and coalesce(is_valid, true) and not coalesce(is_red_listed, false);
    perform set_config('role', 'authenticated', true);
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-112 OK - consultation des evaluations d''un poste par le visiteur journalisee' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-112 ECHEC - %s consultation(s) des evaluations journalisee(s) (attendu 1)', v_count) || chr(10); end if;

    begin
        v_json := visitor_statistics_rows();
        select count(*) into v_count from jsonb_array_elements(v_json -> 'talents') t
            where t ? 'id' or t ? 'first_name' or t ? 'last_name' or t ? 'email';
        if v_count = 0 and jsonb_array_length(v_json -> 'talents') = v_rows
           and jsonb_array_length(v_json -> 'missions') >= 1 then
            v_ok := v_ok + 1; v_report := v_report || 'A3-113 OK - statistiques du visiteur : lignes anonymes, talents actifs seulement' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-113 ECHEC - statistiques du visiteur : %s ligne(s) nominative(s), %s talent(s) pour %s attendu(s)', v_count, jsonb_array_length(v_json -> 'talents'), v_rows) || chr(10); end if;
    exception when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-113 ECHEC - statistiques du visiteur indisponibles (%s)', sqlerrm) || chr(10);
    end;


    -- Tests en tant que user
    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_id), true);
    perform set_config('role', 'authenticated', true);

    begin
        perform visitor_talent_card(v_talent_control_id);
        v_fail := v_fail + 1; v_report := v_report || 'A3-108 ECHEC - un recruteur peut appeler la porte du visiteur' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-108 OK - les portes du visiteur sont reservees au visiteur' || chr(10);
    when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-108 ECHEC - erreur inattendue (%s)', sqlerrm) || chr(10);
    end;

    begin
        perform visitor_statistics_rows();
        v_fail := v_fail + 1; v_report := v_report || 'A3-114 ECHEC - un recruteur peut appeler les statistiques du visiteur' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-114 OK - statistiques du visiteur reservees au visiteur' || chr(10);
    when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-114 ECHEC - erreur inattendue (%s)', sqlerrm) || chr(10);
    end;


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
        perform log_client_event('delete', 'talent', null, 'TEST-A3-FAUX', 'TEST-A3');
        v_fail := v_fail + 1; v_report := v_report || 'A3-86 ECHEC - user a journalise une suppression inventee' || chr(10);
    exception when invalid_parameter_value then
        v_ok := v_ok + 1; v_report := v_report || 'A3-86 OK - log_client_event refuse les actions metier (suppression inventee)' || chr(10);
    when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-86 ECHEC - erreur inattendue (%s)', sqlerrm) || chr(10);
    end;

    insert into share_tokens (token, talent_id, created_by, expires_at)
    values ('choisi-par-le-client', v_talent_control_id, v_user_id, now() + interval '30 days')
    returning id into v_new_token_id;
    select count(*) into v_count from share_tokens
        where id = v_new_token_id and token like 'st\_%' and token <> 'choisi-par-le-client' and length(token) = 39;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-87 OK - jeton de partage genere par la base (valeur du client ignoree)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-87 ECHEC - jeton de partage choisi par le client' || chr(10); end if;

    begin
        insert into share_tokens (token, talent_id, created_by, expires_at)
        values ('test-a3-' || gen_random_uuid()::text, v_talent_control_id, v_user_id, now() + interval '120 days');
        v_fail := v_fail + 1; v_report := v_report || 'A3-88 ECHEC - lien de partage a plus de 90 jours accepte' || chr(10);
    exception when invalid_parameter_value then
        v_ok := v_ok + 1; v_report := v_report || 'A3-88 OK - expiration au-dela de 90 jours refusee' || chr(10);
    when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-88 ECHEC - erreur inattendue (%s)', sqlerrm) || chr(10);
    end;

    begin
        insert into share_tokens (token, talent_id, created_by, expires_at)
        values ('test-a3-' || gen_random_uuid()::text, v_talent_control_id, v_user_id, null);
        v_fail := v_fail + 1; v_report := v_report || 'A3-89 ECHEC - lien de partage sans expiration accepte' || chr(10);
    exception when invalid_parameter_value or not_null_violation then
        v_ok := v_ok + 1; v_report := v_report || 'A3-89 OK - lien de partage sans expiration refuse' || chr(10);
    when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-89 ECHEC - erreur inattendue (%s)', sqlerrm) || chr(10);
    end;

    begin
        update share_tokens set expires_at = now() + interval '5 years' where id = v_new_token_id;
        v_fail := v_fail + 1; v_report := v_report || 'A3-90 ECHEC - le createur a prolonge son lien' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-90 OK - seule la revocation est modifiable par le createur' || chr(10);
    when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-90 ECHEC - erreur inattendue (%s)', sqlerrm) || chr(10);
    end;

    update share_tokens set is_revoked = true where id = v_new_token_id;
    begin
        update share_tokens set is_revoked = false where id = v_new_token_id;
        v_fail := v_fail + 1; v_report := v_report || 'A3-91 ECHEC - un lien revoque a ete reactive' || chr(10);
    exception when invalid_parameter_value then
        v_ok := v_ok + 1; v_report := v_report || 'A3-91 OK - la revocation d''un lien est definitive' || chr(10);
    when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-91 ECHEC - erreur inattendue (%s)', sqlerrm) || chr(10);
    end;

    insert into comments (talent_id, user_id, content)
    values (v_talent_control_id, v_user_id, 'TEST RLS temporaire - journalisation par la base');
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from audit_logs
        where entity_type = 'comment' and action = 'create' and user_id = v_user_id
          and entity_name = 'TEST-A3 CONTROL' and created_at > now() - interval '1 minute';
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-92 OK - ajout de commentaire journalise par la base' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-92 ECHEC - %s ligne(s) de journal pour l''ajout de commentaire (attendu 1)', v_count) || chr(10); end if;

    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
    v_json := get_shared_talent(v_token_user_value);
    perform set_config('role', v_admin_role, true);
    if v_json #>> '{talent,archived_position_passages,0,positionTitle}' = 'TEST A3 poste archive'
       and v_json::text not like '%TEST A3 point negatif%' and v_json::text not like '%a3@example.com%' then
        v_ok := v_ok + 1; v_report := v_report || 'A3-93 OK - lien public : anciens postes sans aucune evaluation' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-93 ECHEC - lien public : evaluations internes exposees ou postes absents' || chr(10); end if;

    insert into talents (first_name, last_name, pool) values ('TEST-A3', 'CASCADE', 'COLOG') returning id into v_cascade_talent_id;
    insert into comments (talent_id, user_id, content) values (v_cascade_talent_id, v_admin_id, 'TEST RLS temporaire - cascade');
    delete from talents where id = v_cascade_talent_id;
    select count(*) into v_count from audit_logs where entity_type = 'comment' and action = 'delete' and created_at > now() - interval '1 minute';
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-100 OK - suppression d''un talent : ses commentaires ne sont pas journalises un par un' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-100 ECHEC - %s suppression(s) de commentaire journalisee(s) lors de la suppression du talent', v_count) || chr(10); end if;

    update share_tokens set talent_id = v_talent_devalidated_id where id = v_token_admin_id;
    select get_shared_talent(token) into v_json from share_tokens where id = v_token_admin_id;
    if v_json ->> 'error' = 'talent_not_found' then v_ok := v_ok + 1; v_report := v_report || 'A3-94 OK - lien public d''un talent devalide inactif' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-94 ECHEC - lien public d''un talent devalide : %s', left(v_json::text, 80)) || chr(10); end if;
    update share_tokens set talent_id = v_talent_control_id where id = v_token_admin_id;

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_id), true);
    perform set_config('role', 'authenticated', true);

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

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_visitor_id), true);
    perform set_config('role', 'authenticated', true);
    select jsonb_build_object(
        'talents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.pool_id), '[]'::jsonb) from get_pool_talent_stats() x),
        'missions', (select coalesce(jsonb_agg(to_jsonb(y) order by y.pool_id), '[]'::jsonb) from get_pool_mission_counts() y))
    into v_dashboard_visitor;
    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin_id), true);
    perform set_config('role', 'authenticated', true);
    select jsonb_build_object(
        'talents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.pool_id), '[]'::jsonb) from get_pool_talent_stats() x),
        'missions', (select coalesce(jsonb_agg(to_jsonb(y) order by y.pool_id), '[]'::jsonb) from get_pool_mission_counts() y))
    into v_json;
    perform set_config('role', v_admin_role, true);
    if v_json = v_dashboard_visitor and jsonb_array_length(v_json -> 'talents') > 0 and jsonb_array_length(v_json -> 'missions') > 0 then
        v_ok := v_ok + 1; v_report := v_report || 'A3-116 OK - tableau de bord : memes chiffres pour le visiteur et pour l''admin' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-116 ECHEC - tableau de bord du visiteur different : %s', left(v_dashboard_visitor::text, 120)) || chr(10); end if;

    -- Vrai total actuel, mesure ici en bypass RLS (donc fiable quel que
    -- soit le nombre reel de comptes) plutot qu'un seuil fige a comparer.
    select count(*) into v_total_users from users;

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin_id), true);
    perform set_config('role', 'authenticated', true);

    update pools set description = 'TEST A3 description' where pool_id = 'COLOG';
    select count(*) into v_count from audit_logs
        where entity_name = 'Pool COLOG' and action = 'update' and user_id = v_admin_id
          and details like '%Description : % → TEST A3 description%';
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-95 OK - modification de pool journalisee par la base, ancienne et nouvelle valeur' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-95 ECHEC - %s ligne(s) de journal pour la modification du pool (attendu 1)', v_count) || chr(10); end if;

    update talents set current_function = 'TEST A3 fonction' where id = v_talent_control_id;
    select count(*) into v_count from audit_logs
        where entity_id = v_talent_control_id::text and action = 'update' and details = 'Champs modifiés : current_function';
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-96 OK - modification de talent : champs modifies journalises, sans les valeurs' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-96 ECHEC - %s ligne(s) de journal detaillant les champs modifies (attendu 1)', v_count) || chr(10); end if;

    update talents set is_red_listed = true, red_list_reason = 'TEST A3 motif confidentiel' where id = v_talent_control_id;
    select count(*) into v_count from audit_logs
        where entity_id = v_talent_control_id::text and action = 'add_to_red_list' and details = 'Ajout en Liste Rouge';
    select v_count + count(*) * 100 into v_count from audit_logs where details like '%TEST A3 motif confidentiel%';
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-97 OK - ajout en Liste Rouge journalise sans le motif' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-97 ECHEC - motif de Liste Rouge recopie dans le journal ou ajout non journalise' || chr(10); end if;
    update talents set is_red_listed = false, red_list_reason = null where id = v_talent_control_id;

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

    perform set_config('role', v_admin_role, true);

    select count(*) filter (where to_regprocedure(sig) is null),
           count(*) filter (where to_regprocedure(sig) is not null and has_function_privilege('anon', to_regprocedure(sig), 'execute'))
        into v_count, v_rows
        from unnest(v_site_functions) sig;
    if v_count = 0 and v_rows = 1 and has_function_privilege('anon', 'public.request_access_code_reset(text)', 'execute') then
        v_ok := v_ok + 1; v_report := v_report || 'A3-45 OK - les 14 fonctions du site existent, anon n''execute que request_access_code_reset' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-45 ECHEC - %s fonction(s) absente(s), %s executable(s) par anon (attendu 0 et 1)', v_count, v_rows) || chr(10); end if;

    select count(*) into v_count from unnest(v_site_functions) sig
        where to_regprocedure(sig) is not null and has_function_privilege('authenticated', to_regprocedure(sig), 'execute');
    if v_count = 14 then v_ok := v_ok + 1; v_report := v_report || 'A3-46 OK - les 14 fonctions du site sont executables par un compte connecte' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-46 ECHEC - %s fonction(s) executable(s) par authenticated (attendu 14)', v_count) || chr(10); end if;

    select count(*) into v_count from unnest(array['public.ai_statistics_rows()', 'public.ai_question_mentions_person(text)']) sig
        where to_regprocedure(sig) is null
           or has_function_privilege('anon', to_regprocedure(sig), 'execute')
           or has_function_privilege('authenticated', to_regprocedure(sig), 'execute')
           or not has_function_privilege('service_role', to_regprocedure(sig), 'execute');
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-118 OK - fonctions de l''analyse IA reservees a la cle de service' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-118 ECHEC - %s fonction(s) de l''analyse IA absente(s) ou appelable(s) par le site', v_count) || chr(10); end if;

    begin
        if ai_question_mentions_person('Pourquoi test-a3 CONTROL n''a pas de poste ?')
           and ai_question_mentions_person('Et control test a3 ?')
           and not ai_question_mentions_person('Quels risques de penurie sur le pool COLOG ?')
           and not ai_question_mentions_person('Parle-moi de CONTROL') then
            v_ok := v_ok + 1; v_report := v_report || 'A3-119 OK - analyse IA : une question citant prenom et nom d''un talent est reconnue, une question ordinaire non' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || 'A3-119 ECHEC - detection des noms dans la question a l''IA incorrecte' || chr(10); end if;
    exception when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-119 ECHEC - detection des noms indisponible (%s)', sqlerrm) || chr(10);
    end;

    select count(*) into v_count from unnest(array['public.record_occupant_exit(public.missions,timestamptz)', 'public.record_occupant_entry(uuid,text)']) sig
        where to_regprocedure(sig) is null
           or has_function_privilege('anon', to_regprocedure(sig), 'execute')
           or has_function_privilege('authenticated', to_regprocedure(sig), 'execute');
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-47 OK - record_occupant_exit/entry existent et restent inaccessibles au site' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-47 ECHEC - %s brique(s) interne(s) absente(s) ou appelable(s) par le site', v_count) || chr(10); end if;

    if to_regprocedure('public.archive_mission_occupant(uuid,timestamptz)') is null then
        v_ok := v_ok + 1; v_report := v_report || 'A3-48 OK - archive_mission_occupant n''existe plus' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-48 ECHEC - archive_mission_occupant existe encore' || chr(10); end if;

    v_request_testable := lower(v_user_email) ~ '^[^@\s]+@alima\.ngo$'
        and (select count(*) from access_code_requests where requested_at > now() - interval '24 hours') < 18;
    v_unknown_email := 'inconnu-a3-' || substr(gen_random_uuid()::text, 1, 8) || '@alima.ngo';

    insert into access_code_requests (email) values ('test-a3-' || substr(gen_random_uuid()::text, 1, 8) || '@alima.ngo')
    returning id into v_request_id;
    insert into access_code_requests (email) values ('test-a3-' || substr(gen_random_uuid()::text, 1, 8) || '@alima.ngo')
    returning id into v_request_suspended_id;

    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);

    perform request_access_code_reset(v_unknown_email);
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from access_code_requests where lower(email) = v_unknown_email;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-49 OK - adresse inconnue : aucune demande enregistree' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-49 ECHEC - une demande a ete enregistree pour une adresse inconnue' || chr(10); end if;

    if not v_request_testable then
        v_skip := v_skip + 2;
        v_report := v_report || 'A3-50 IGNORE - adresse du user de test hors @alima.ngo ou limite de 20 demandes/24 h presque atteinte' || chr(10);
        v_report := v_report || 'A3-51 IGNORE - meme raison que A3-50' || chr(10);
    else
        perform set_config('role', 'anon', true);
        perform request_access_code_reset(upper(v_user_email));
        perform set_config('role', v_admin_role, true);
        select count(*) into v_count from access_code_requests where lower(email) = lower(v_user_email) and resolved_at is null;
        if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-50 OK - compte existant : une demande en attente' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-50 ECHEC - %s demande(s) en attente pour le user de test (attendu 1)', v_count) || chr(10); end if;

        perform set_config('role', 'anon', true);
        perform request_access_code_reset(v_user_email);
        perform set_config('role', v_admin_role, true);
        select count(*) into v_count from access_code_requests where lower(email) = lower(v_user_email) and resolved_at is null;
        if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-51 OK - nouvelle demande : toujours une seule en attente' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-51 ECHEC - %s demande(s) en attente apres une seconde demande (attendu 1)', v_count) || chr(10); end if;
    end if;

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_visitor_id), true);
    perform set_config('role', 'authenticated', true);
    select count(*) into v_count from access_code_requests;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-52 OK - visitor ne voit aucune demande de nouveau code' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-52 ECHEC - visitor voit %s demande(s) (attendu 0)', v_count) || chr(10); end if;

    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_id), true);
    perform set_config('role', 'authenticated', true);
    select count(*) into v_count from access_code_requests;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-53 OK - user ne voit aucune demande de nouveau code' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-53 ECHEC - user voit %s demande(s) (attendu 0)', v_count) || chr(10); end if;

    begin
        insert into access_code_requests (email) values ('ecriture-directe-a3@alima.ngo');
        v_fail := v_fail + 1; v_report := v_report || 'A3-55 ECHEC - user a ecrit directement dans access_code_requests' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-55 OK - aucune ecriture directe dans access_code_requests' || chr(10);
    end;

    begin
        perform dismiss_access_code_request(v_request_id);
        v_fail := v_fail + 1; v_report := v_report || 'A3-56 ECHEC - user a pu ignorer une demande' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-56 OK - user ne peut pas ignorer une demande' || chr(10);
    end;

    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin_id), true);
    perform set_config('role', 'authenticated', true);
    select count(*) into v_count from access_code_requests where id = v_request_id;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-54 OK - admin voit les demandes de nouveau code' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-54 ECHEC - admin ne voit pas la demande de test' || chr(10); end if;

    perform dismiss_access_code_request(v_request_id);
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from access_code_requests where id = v_request_id and resolved_at is not null and resolved_by = v_admin_id;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-57 OK - admin a ignore la demande (classee a son nom)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-57 ECHEC - la demande n''a pas ete classee par l''admin' || chr(10); end if;

    select count(*) into v_count from audit_logs
        where user_id = v_admin_id and action = 'update' and entity_type = 'user'
          and details = 'Demande de nouveau code d''accès ignorée'
          and entity_name = (select email from access_code_requests where id = v_request_id);
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-98 OK - demande ignoree journalisee par la base' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-98 ECHEC - %s ligne(s) de journal pour la demande ignoree (attendu 1)', v_count) || chr(10); end if;

    insert into pools (pool_id, name, full_name, level) values
        ('TESTA3P1', 'TESTA3P1', 'TEST RLS temporaire (A3) 1', 'mission'),
        ('TESTA3P2', 'TESTA3P2', 'TEST RLS temporaire (A3) 2', 'mission');
    insert into talents (first_name, last_name, pool, staff_type)
    values ('TEST-A3', 'EXPAT-POOL', 'TESTA3P1', 'expat') returning id into v_expat_pool_id;
    insert into talents (first_name, last_name, pool, staff_type, nationality_code)
    values ('TEST-A3', 'NATIONAL', 'TESTA3P1', 'national', 'ML') returning id into v_national_id;
    insert into talents (first_name, last_name, pool, staff_type, status, number_of_alima_missions)
    values ('TEST-A3', 'OCCUPANT-A', 'TESTA3P1', 'expat', 'En attente de poste', 'none') returning id into v_occupant_a_id;
    insert into talents (first_name, last_name, pool, staff_type, status, number_of_alima_missions)
    values ('TEST-A3', 'OCCUPANT-B', 'TESTA3P1', 'expat', 'En attente de poste', 'none') returning id into v_occupant_b_id;

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_visitor_id), true);
    perform set_config('role', 'authenticated', true);
    begin
        perform change_talent_pool(v_expat_pool_id, 'TESTA3P2');
    exception when others then
        null;
    end;
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from talents where id = v_expat_pool_id and pool = 'TESTA3P1';
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-60 OK - visitor ne peut pas changer le pool d''un talent' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-60 ECHEC - visitor a change le pool d''un talent' || chr(10); end if;

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_id), true);
    perform set_config('role', 'authenticated', true);
    perform change_talent_pool(v_expat_pool_id, 'TESTA3P2');
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from talents t
        where t.id = v_expat_pool_id and t.pool = 'TESTA3P2'
          and exists (select 1 from pool_history h where h.talent_id = t.id and h.from_pool = 'TESTA3P1'
                      and h.to_pool = 'TESTA3P2' and h.changed_by = v_user_id);
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-61 OK - user a change le pool, historique ecrit a son nom' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-61 ECHEC - changement de pool ou ligne d''historique manquant' || chr(10); end if;

    perform set_config('role', 'authenticated', true);
    begin
        perform change_talent_pool(v_expat_pool_id, 'TESTA3P2');
        v_fail := v_fail + 1; v_report := v_report || 'A3-62 ECHEC - changement vers le meme pool accepte' || chr(10);
    exception when invalid_parameter_value then
        v_ok := v_ok + 1; v_report := v_report || 'A3-62 OK - changement vers le meme pool refuse' || chr(10);
    end;

    begin
        perform change_talent_pool(v_national_id, 'TESTA3P2');
        v_fail := v_fail + 1; v_report := v_report || 'A3-63 ECHEC - changement de pool accepte pour un national' || chr(10);
    exception when invalid_parameter_value then
        v_ok := v_ok + 1; v_report := v_report || 'A3-63 OK - un national passe par le passage en expat' || chr(10);
    end;

    perform promote_national_to_expat(v_national_id, 'TESTA3P2');
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from talents where id = v_national_id and staff_type = 'expat' and pool = 'TESTA3P2';
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-64 OK - user a fait passer un national en expat' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-64 ECHEC - passage en expat non applique' || chr(10); end if;

    perform set_config('role', 'authenticated', true);
    begin
        perform promote_national_to_expat(v_national_id, 'TESTA3P1');
        v_fail := v_fail + 1; v_report := v_report || 'A3-65 ECHEC - passage en expat accepte pour un talent deja expat' || chr(10);
    exception when invalid_parameter_value then
        v_ok := v_ok + 1; v_report := v_report || 'A3-65 OK - passage en expat refuse pour un talent deja expat' || chr(10);
    end;

    v_mission_payload := jsonb_build_object('title', 'TEST RLS temporaire (A3) poste', 'pool', 'TESTA3P1',
        'pool_level', 'mission', 'status', 'occupied', 'country_code', 'ML', 'location', 'TEST',
        'candidate_type', 'expat', 'is_expat', true, 'occupant_id', v_occupant_a_id, 'contract_end_type', 'date');

    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_visitor_id), true);
    perform set_config('role', 'authenticated', true);
    begin
        perform save_mission(null, v_mission_payload, null);
        v_fail := v_fail + 1; v_report := v_report || 'A3-66 ECHEC - visitor a enregistre un poste' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-66 OK - visitor ne peut pas enregistrer de poste' || chr(10);
    end;

    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_id), true);
    perform set_config('role', 'authenticated', true);
    v_test_mission_1_id := save_mission(null, v_mission_payload || jsonb_build_object('created_by', v_admin_id), null);
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from missions m join talents t on t.id = m.occupant_id
        where m.id = v_test_mission_1_id and m.created_by = v_user_id
          and t.status = 'En poste ALIMA' and t.number_of_alima_missions = 'one';
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-67 OK - user a cree un poste occupe (auteur impose, talent en poste, 1 mission)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-67 ECHEC - poste, auteur ou talent entrant incorrect' || chr(10); end if;

    perform set_config('role', 'authenticated', true);
    begin
        perform save_mission(null, v_mission_payload, null);
        v_fail := v_fail + 1; v_report := v_report || 'A3-68 ECHEC - conflit d''occupant non annonce accepte' || chr(10);
    exception when raise_exception then
        if sqlerrm like '%liste des postes%' then v_ok := v_ok + 1; v_report := v_report || 'A3-68 OK - conflit d''occupant non annonce refuse (liste perimee)' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || format('A3-68 ECHEC - refus inattendu : %s', sqlerrm) || chr(10); end if;
    end;

    v_test_mission_2_id := save_mission(null, v_mission_payload, v_test_mission_1_id);
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from missions m
        where m.id = v_test_mission_1_id and m.status = 'vacant' and m.occupant_id is null
          and (select jsonb_array_length(archived_position_passages) from talents where id = v_occupant_a_id) = 1;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-69 OK - conflit annonce : ancien poste libere, passage archive' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-69 ECHEC - ancien poste non libere ou passage non archive' || chr(10); end if;

    insert into evaluations (mission_id, talent_id, author_id, context, author_email)
    values (v_test_mission_2_id, v_occupant_a_id, v_admin_id, 'TEST RLS temporaire - evaluation par l''admin', v_admin_email);
    perform set_config('role', 'authenticated', true);
    perform save_mission(v_test_mission_2_id, v_mission_payload || jsonb_build_object('occupant_id', v_occupant_b_id), null);
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from talents
        where id = v_occupant_a_id
          and jsonb_array_length(archived_position_passages -> -1 -> 'comments') = 1
          and not exists (select 1 from evaluations where mission_id = v_test_mission_2_id);
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-70 OK - remplacement par un user : evaluation de l''admin archivee puis retiree du poste' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-70 ECHEC - evaluation d''un autre auteur restee sur le poste ou non archivee' || chr(10); end if;

    update talents set status = 'En attente de poste', is_currently_on_mission = false where id = v_occupant_b_id;
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_visitor_id), true);
    perform set_config('role', 'authenticated', true);
    begin
        perform resync_mission_occupant(v_test_mission_2_id);
        v_fail := v_fail + 1; v_report := v_report || 'A3-71 ECHEC - visitor a resynchronise un occupant' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-71 OK - visitor ne peut pas resynchroniser un occupant' || chr(10);
    end;
    begin
        perform delete_mission(v_test_mission_2_id);
        v_fail := v_fail + 1; v_report := v_report || 'A3-72 ECHEC - visitor a supprime un poste' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-72 OK - visitor ne peut pas supprimer un poste' || chr(10);
    end;
    begin
        perform process_expired_missions('TESTA3P1');
        v_fail := v_fail + 1; v_report := v_report || 'A3-73 ECHEC - visitor a lance le traitement des contrats echus' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-73 OK - visitor ne peut pas lancer le traitement des contrats echus' || chr(10);
    end;

    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_id), true);
    perform set_config('role', 'authenticated', true);
    perform resync_mission_occupant(v_test_mission_2_id);
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from talents
        where id = v_occupant_b_id and status = 'En poste ALIMA' and is_currently_on_mission and number_of_alima_missions = 'one';
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-74 OK - user a resynchronise l''occupant (sans compter une mission de plus)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-74 ECHEC - resynchronisation incorrecte' || chr(10); end if;

    perform set_config('role', 'authenticated', true);
    perform delete_mission(v_test_mission_2_id);
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from talents
        where id = v_occupant_b_id and status = 'En attente de poste'
          and jsonb_array_length(archived_position_passages) = 1
          and not exists (select 1 from missions where id = v_test_mission_2_id);
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-75 OK - user a supprime un poste occupe (occupant sorti, passage archive)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-75 ECHEC - suppression du poste ou sortie de l''occupant incorrecte' || chr(10); end if;

    insert into missions (title, pool, pool_level, location, candidate_type, status, occupant_id,
                          contract_end_type, contract_end_date, contract_status, future_talent_id)
    values ('TEST RLS temporaire (A3) echu', 'TESTA3P1', 'mission', 'TEST', 'expat', 'occupied', v_occupant_a_id,
            'date', now() - interval '1 day', 'ending', v_occupant_b_id)
    returning id into v_test_mission_1_id;
    perform set_config('role', 'authenticated', true);
    select rotated_count into v_rows from process_expired_missions('TESTA3P1');
    perform set_config('role', v_admin_role, true);
    select count(*) into v_count from missions
        where id = v_test_mission_1_id and occupant_id = v_occupant_b_id and future_talent_id is null;
    if v_count = 1 and v_rows = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-76 OK - user : contrat echu du pool de test transfere au futur occupant' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-76 ECHEC - contrat echu non traite (%s poste(s) transfere(s))', v_rows) || chr(10); end if;

    perform set_config('role', v_admin_role, true);
    select coalesce(nullif(name, ''), email) into v_user_display_name from users where id = v_user_id;
    insert into talents (first_name, last_name, pool, staff_type)
    values ('TEST-A3', 'ATTRIBUTION', 'TESTA3P1', 'expat') returning id into v_attr_talent_id;

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_id), true);
    perform set_config('role', 'authenticated', true);
    update talents
    set is_red_listed = true, red_list_reason = 'TEST RLS temporaire (A3)', red_list_date = '2000-01-01',
        red_list_added_by = v_admin_id, red_list_added_by_name = 'FAUX AUTEUR A3'
    where id = v_attr_talent_id;
    perform set_config('role', v_admin_role, true);
    select red_list_added_by = v_user_id and red_list_added_by_name = v_user_display_name
           and red_list_date > now() - interval '1 hour'
    into v_attr_ok from talents where id = v_attr_talent_id;
    if v_attr_ok then v_ok := v_ok + 1; v_report := v_report || 'A3-78 OK - ajout en Liste Rouge : auteur, nom et date imposes par la base' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-78 ECHEC - auteur, nom ou date de Liste Rouge falsifiable' || chr(10); end if;

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin_id), true);
    perform set_config('role', 'authenticated', true);
    update talents set red_list_reason = 'TEST RLS temporaire (A3) bis', red_list_added_by_name = 'FAUX AUTEUR A3'
    where id = v_attr_talent_id;
    perform set_config('role', v_admin_role, true);
    select red_list_reason = 'TEST RLS temporaire (A3) bis' and red_list_added_by_name = v_user_display_name
    into v_attr_ok from talents where id = v_attr_talent_id;
    if v_attr_ok then v_ok := v_ok + 1; v_report := v_report || 'A3-79 OK - talent deja en Liste Rouge : motif modifiable, auteur fige' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-79 ECHEC - auteur de Liste Rouge reecrit apres coup' || chr(10); end if;

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_id), true);
    perform set_config('role', 'authenticated', true);
    update talents
    set devalidation_extension_until = current_date + 90, devalidation_extension_months = 3,
        devalidation_extension_granted_by = v_admin_id, devalidation_extension_granted_by_name = 'FAUX AUTEUR A3',
        devalidation_extension_granted_at = '2000-01-01'
    where id = v_attr_talent_id;
    insert into talents (first_name, last_name, pool, staff_type, created_by)
    values ('TEST-A3', 'CREATED-BY', 'TESTA3P1', 'expat', v_admin_id);
    insert into missions (title, pool, pool_level, location, created_by)
    values ('TEST RLS temporaire (A3) created_by', 'TESTA3P1', 'mission', 'TEST', v_admin_id);
    insert into share_tokens (token, talent_id, created_by, created_by_name, expires_at)
    values ('test-a3-attr-' || gen_random_uuid()::text, v_attr_talent_id, v_user_id, 'FAUX AUTEUR A3', now() + interval '1 day');
    perform set_config('role', v_admin_role, true);

    select devalidation_extension_granted_by = v_user_id and devalidation_extension_granted_by_name = v_user_display_name
           and devalidation_extension_granted_at > now() - interval '1 hour'
    into v_attr_ok from talents where id = v_attr_talent_id;
    if v_attr_ok then v_ok := v_ok + 1; v_report := v_report || 'A3-80 OK - prolongation de validite : auteur, nom et date imposes' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-80 ECHEC - auteur de prolongation falsifiable' || chr(10); end if;

    select count(*) into v_count from talents where last_name = 'CREATED-BY' and created_by = v_user_id;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-81 OK - talent cree : created_by impose par la base' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-81 ECHEC - created_by d''un talent falsifiable' || chr(10); end if;

    select count(*) into v_count from missions where title = 'TEST RLS temporaire (A3) created_by' and created_by = v_user_id;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-82 OK - poste cree hors site : created_by impose par la base' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-82 ECHEC - created_by d''un poste falsifiable' || chr(10); end if;

    select count(*) into v_count from share_tokens where talent_id = v_attr_talent_id and created_by_name = v_user_display_name;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-83 OK - lien de partage : nom de l''auteur impose' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-83 ECHEC - nom de l''auteur d''un lien falsifiable' || chr(10); end if;

    if to_regprocedure('public.set_attribution_from_session()') is not null
       and not has_function_privilege('anon', 'public.set_attribution_from_session()', 'execute')
       and not has_function_privilege('authenticated', 'public.set_attribution_from_session()', 'execute') then
        v_ok := v_ok + 1; v_report := v_report || 'A3-84 OK - set_attribution_from_session existe et reste inaccessible au site' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-84 ECHEC - set_attribution_from_session absente ou appelable par le site' || chr(10); end if;

    -- Tests en tant que user puis admin suspendus (suspension annulee par le rollback force)
    perform set_config('role', v_admin_role, true);
    update users set is_active = false where id = v_visitor_id;
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_visitor_id), true);
    perform set_config('role', 'authenticated', true);
    begin
        perform visitor_talents_page('COLOG', '{}'::jsonb, 0);
        v_fail := v_fail + 1; v_report := v_report || 'A3-109 ECHEC - un visiteur suspendu obtient encore la liste des talents' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-109 OK - visiteur suspendu : portes fermees' || chr(10);
    when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-109 ECHEC - erreur inattendue (%s)', sqlerrm) || chr(10);
    end;
    perform set_config('role', v_admin_role, true);

    update users set is_active = false where id in (v_user_id, v_admin_id);

    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_user_id), true);
    perform set_config('role', 'authenticated', true);

    select count(*) into v_count from talents;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-35 OK - user suspendu ne voit aucun talent' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-35 ECHEC - user suspendu voit %s talent(s) (attendu 0)', v_count) || chr(10); end if;

    select (select count(*) from get_pool_talent_stats()) + (select count(*) from get_pool_mission_counts()) into v_count;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-117 OK - user suspendu : tableau de bord vide' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-117 ECHEC - user suspendu obtient %s ligne(s) du tableau de bord (attendu 0)', v_count) || chr(10); end if;

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

    begin
        perform save_mission(null, v_mission_payload, null);
        v_fail := v_fail + 1; v_report := v_report || 'A3-77 ECHEC - user suspendu a enregistre un poste' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-77 OK - user suspendu ne peut pas enregistrer de poste' || chr(10);
    end;

    perform set_config('role', v_admin_role, true);
    if not v_request_testable then
        v_skip := v_skip + 1; v_report := v_report || 'A3-58 IGNORE - meme raison que A3-50' || chr(10);
    else
        delete from access_code_requests where lower(email) = lower(v_user_email) and resolved_at is null;
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        perform set_config('role', 'anon', true);
        perform request_access_code_reset(v_user_email);
        perform set_config('role', v_admin_role, true);
        select count(*) into v_count from access_code_requests where lower(email) = lower(v_user_email) and resolved_at is null;
        if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-58 OK - compte suspendu : aucune demande de nouveau code enregistree' || chr(10);
        else v_fail := v_fail + 1; v_report := v_report || 'A3-58 ECHEC - une demande a ete enregistree pour un compte suspendu' || chr(10); end if;
    end if;

    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_admin_id), true);
    perform set_config('role', 'authenticated', true);

    select count(*) into v_count from audit_logs;
    if v_count = 0 then v_ok := v_ok + 1; v_report := v_report || 'A3-40 OK - admin suspendu ne voit plus audit_logs' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-40 ECHEC - admin suspendu voit %s ligne(s) d''audit_logs (attendu 0)', v_count) || chr(10); end if;

    begin
        perform dismiss_access_code_request(v_request_suspended_id);
        v_fail := v_fail + 1; v_report := v_report || 'A3-59 ECHEC - admin suspendu a pu ignorer une demande' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-59 OK - admin suspendu ne peut pas ignorer une demande' || chr(10);
    end;

    begin
        perform log_client_event('logout', 'user');
        v_fail := v_fail + 1; v_report := v_report || 'A3-42 ECHEC - admin suspendu a ecrit dans le journal' || chr(10);
    exception when insufficient_privilege then
        v_ok := v_ok + 1; v_report := v_report || 'A3-42 OK - compte suspendu : aucune ecriture dans le journal' || chr(10);
    when others then
        v_fail := v_fail + 1; v_report := v_report || format('A3-42 ECHEC - erreur inattendue (%s)', sqlerrm) || chr(10);
    end;

    perform set_config('role', v_admin_role, true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
    v_json := get_shared_talent(v_token_user_value);
    perform set_config('role', v_admin_role, true);
    if v_json ->> 'error' = 'revoked' then v_ok := v_ok + 1; v_report := v_report || 'A3-99 OK - lien public d''un createur suspendu inactif' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-99 ECHEC - lien public d''un createur suspendu : %s', left(v_json::text, 80)) || chr(10); end if;

    -- Bilan et rollback force
    perform set_config('role', v_admin_role, true);

    begin
        delete from pools where pool_id = 'COLOG';
        v_fail := v_fail + 1; v_report := v_report || 'A3-43 ECHEC - un pool rattache a des talents a pu etre supprime' || chr(10);
    exception when foreign_key_violation or restrict_violation then
        v_ok := v_ok + 1; v_report := v_report || 'A3-43 OK - suppression d''un pool utilise refusee (il s''archive)' || chr(10);
    end;

    insert into pools (pool_id, name, full_name, level) values ('TESTA3', 'TESTA3', 'TEST RLS temporaire (A3)', 'mission');
    delete from pools where pool_id = 'TESTA3';
    get diagnostics v_rows = row_count;
    if v_rows = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-44 OK - un pool jamais utilise peut etre supprime' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || format('A3-44 ECHEC - %s pool supprime (attendu 1)', v_rows) || chr(10); end if;

    select count(*) into v_count from audit_logs
        where action = 'login' and user_id = v_visitor_id and user_email = v_visitor_email
          and entity_id = v_visitor_id::text and entity_name = v_visitor_email and details is null;
    if v_count = 1 then v_ok := v_ok + 1; v_report := v_report || 'A3-41 OK - connexion journalisee : auteur et compte imposes par la base (valeurs envoyees ignorees)' || chr(10);
    else v_fail := v_fail + 1; v_report := v_report || 'A3-41 ECHEC - log_client_event a conserve des valeurs envoyees par le client' || chr(10); end if;

    v_total := v_ok + v_fail + v_skip;

    if v_fail > 0 then
        v_final_message := format('A3 BILAN : %s ECHEC(S) sur %s tests (%s OK, %s IGNORE)', v_fail, v_total, v_ok, v_skip);
    else
        v_final_message := format('A3 BILAN : TOUS LES TESTS ONT REUSSI (%s/%s, %s IGNORE)', v_ok, v_total, v_skip);
    end if;

    -- Seul un RAISE EXCEPTION est affiche par l'editeur : bilan en premiere ligne, detail ensuite.
    raise exception E'%\n\n--- Detail des % tests ---\n%', v_final_message, v_total, v_report;
end $$;
