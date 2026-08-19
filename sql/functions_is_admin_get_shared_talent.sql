-- ============================================================================
-- functions_is_admin_get_shared_talent.sql
-- ----------------------------------------------------------------------------
-- Fichier de référence des 2 fonctions SECURITY DEFINER du schéma public.
-- Ne bouge que si le code de l'une des deux change (créé le 14/08/2026, mis
-- à jour le 19/08/2026 — voir ci-dessous).
--
-- is_admin() : INCHANGÉE depuis sa création.
--
-- get_shared_talent() : corrigée le 19/08/2026 (chantier B1, points 3 et 4
-- identifiés le 18/08/2026 en construisant l'instantané du schéma) :
--   - view_count/last_viewed_at incrémentés désormais APRÈS la confirmation
--     que le talent existe et n'est pas en Liste Rouge (au lieu d'avant) —
--     une consultation qui échoue ensuite n'est plus comptée comme une vue.
--   - ORDER BY ajouté avant LIMIT 1 sur la mission affichée — déterministe
--     même si plusieurs lignes "occupied" existaient par anomalie de données.
-- ============================================================================

create or replace function public.is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND role = 'admin'
    );
$function$;

create or replace function public.get_shared_talent(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

    -- CORRECTIF DU 19/08/2026 (B1) : déplacé ici, après confirmation du
    -- talent, au lieu d'avant (juste après le contrôle d'expiration).
    UPDATE public.share_tokens
    SET view_count = COALESCE(view_count, 0) + 1,
        last_viewed_at = now()
    WHERE token = p_token;

    SELECT jsonb_build_object(
        'title', m.title,
        'country', m.country,
        'contract_start_date', m.contract_start_date
    ) INTO v_mission
    FROM public.missions m
    WHERE m.occupant_id = v_link.talent_id
    AND m.status = 'occupied'
    ORDER BY m.contract_start_date DESC NULLS LAST  -- CORRECTIF DU 19/08/2026 (B1)
    LIMIT 1;

    RETURN jsonb_build_object('talent', v_talent, 'mission', v_mission);
END;
$function$;
