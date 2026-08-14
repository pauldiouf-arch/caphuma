-- ============================================================================
-- functions_is_admin_get_shared_talent.sql
-- ----------------------------------------------------------------------------
-- Code source EXACT des 2 fonctions SECURITY DEFINER du projet Cap Huma, tel
-- qu'extrait en direct de la base le 14/08/2026 (via pg_get_functiondef).
--
-- ⚠️ CE FICHIER N'EST PAS DESTINÉ À ÊTRE EXÉCUTÉ. Il documente l'état actuel
-- des fonctions pour qu'il existe quelque part dans le dépôt Git (et pas
-- seulement dans DOSSIER_PASSATION_TECHNIQUE.md) — voir backlog point n°9,
-- Master Context §7. Le réexécuter recréerait les fonctions à l'identique
-- (CREATE OR REPLACE), donc sans danger si jamais fait par erreur, mais ce
-- n'est pas son usage prévu.
--
-- Si l'une de ces fonctions est modifiée un jour en base, PENSER À REGÉNÉRER
-- ce fichier avec la requête ci-dessous (ne jamais l'éditer à la main sans
-- revérifier contre la base réelle) :
--
--   SELECT p.proname, pg_get_functiondef(p.oid)
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('is_admin', 'get_shared_talent');
--
-- Historique des deux fonctions (résumé, détail complet dans
-- DOSSIER_PASSATION_TECHNIQUE.md §4.3) :
--   - is_admin() : auditée le 17/07/2026, aucun correctif nécessaire.
--   - get_shared_talent() : auditée et CORRIGÉE le 17/07/2026 — ajout de
--     "AND coalesce(t.is_red_listed, false) = false" pour qu'un talent mis en
--     Liste Rouge après la création d'un lien de partage cesse d'être exposé
--     via ce lien. Décision explicite de l'utilisateur : ne PAS appliquer la
--     même exclusion aux talents dévalidés (is_valid = false) — un profil
--     dévalidé reste légitimement partageable.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- is_admin()
-- Vérifie si l'utilisateur courant (auth.uid()) a le rôle 'admin'.
-- Exécutable par tout utilisateur connecté (normal : sert à se renseigner sur
-- son propre statut). search_path verrouillé (protection standard contre le
-- détournement de recherche de schéma sur une fonction SECURITY DEFINER).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND role = 'admin'
    );
$function$;


-- ----------------------------------------------------------------------------
-- get_shared_talent(p_token text)
-- Seule porte d'entrée NON authentifiée (exécutable par le rôle 'anon') vers
-- des données de talent — c'est ce qui permet à shared-talent.html de
-- fonctionner sans compte. Vérifie dans l'ordre : jeton existe → non révoqué
-- → non expiré → talent pas en Liste Rouge. Retourne volontairement le même
-- code d'erreur générique ('talent_not_found') pour un talent introuvable ET
-- pour un talent en Liste Rouge, afin de ne jamais révéler au détenteur d'un
-- lien de partage qu'une personne a été signalée.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_shared_talent(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_link record;
    v_talent jsonb;
    v_mission jsonb;
BEGIN
    SELECT * INTO v_link
    FROM public.share_tokens
    WHERE token = p_token;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'invalid_token');
    END IF;

    IF v_link.is_revoked THEN
        RETURN jsonb_build_object('error', 'revoked');
    END IF;

    IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN
        RETURN jsonb_build_object('error', 'expired');
    END IF;

    UPDATE public.share_tokens
    SET view_count = COALESCE(view_count, 0) + 1,
        last_viewed_at = now()
    WHERE token = p_token;

    -- Sous-ensemble volontairement restreint des colonnes de talents :
    -- informations "CV" uniquement, jamais les champs internes de gestion RH
    -- (Liste Rouge, compteur de validité, dévalidation, etc.)
    -- CORRECTIF DU 17/07/2026 : exclut désormais explicitement un talent en
    -- Liste Rouge, même si le lien de partage lui-même est encore valide.
    SELECT jsonb_build_object(
        'first_name', t.first_name,
        'last_name', t.last_name,
        'current_function', t.current_function,
        'status', t.status,
        'pool', t.pool,
        'email', t.email,
        'gender', t.gender,
        'nationality', t.nationality,
        'country_of_residence', t.country_of_residence,
        'has_visa', t.has_visa,
        'languages', t.languages,
        'education_level', t.education_level,
        'education_specialty', t.education_specialty,
        'pool_integration_date', t.pool_integration_date,
        'experience_months_alima', t.experience_months_alima,
        'experience_months_humanitarian', t.experience_months_humanitarian,
        'number_of_alima_missions', t.number_of_alima_missions,
        'key_skills', t.key_skills,
        'intervention_contexts', t.intervention_contexts,
        'intervention_zones', t.intervention_zones,
        'archived_position_passages', t.archived_position_passages
    ) INTO v_talent
    FROM public.talents t
    WHERE t.id = v_link.talent_id
      AND coalesce(t.is_red_listed, false) = false;

    IF v_talent IS NULL THEN
        RETURN jsonb_build_object('error', 'talent_not_found');
    END IF;

    SELECT jsonb_build_object(
        'title', m.title,
        'country', m.country,
        'contract_start_date', m.contract_start_date
    ) INTO v_mission
    FROM public.missions m
    WHERE m.occupant_id = v_link.talent_id
    AND m.status = 'occupied'
    LIMIT 1;

    RETURN jsonb_build_object('talent', v_talent, 'mission', v_mission);
END;
$function$;
