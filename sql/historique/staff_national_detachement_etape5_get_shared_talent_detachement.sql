-- get_shared_talent() : le poste « en cours » exclut désormais les détachements,
-- et une clé 'detachment' renvoie le détachement occupé en parallèle.
-- Exécuté en base le 18/09/2026.

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
    v_detachment jsonb;
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

    SELECT jsonb_build_object(
        'first_name', t.first_name,
        'last_name', t.last_name,
        'current_function', t.current_function,
        'status', t.status,
        'pool', t.pool,
        'email', t.email,
        'gender', t.gender,
        'nationality', t.nationality,
        'nationality_code', t.nationality_code,
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

    UPDATE public.share_tokens
    SET view_count = COALESCE(view_count, 0) + 1,
        last_viewed_at = now()
    WHERE token = p_token;

    SELECT jsonb_build_object(
        'title', m.title,
        'country', m.country,
        'country_code', m.country_code,
        'contract_start_date', m.contract_start_date
    ) INTO v_mission
    FROM public.missions m
    WHERE m.occupant_id = v_link.talent_id
    AND m.status = 'occupied'
    AND m.candidate_type IS DISTINCT FROM 'detache'
    ORDER BY m.contract_start_date DESC NULLS LAST
    LIMIT 1;

    SELECT jsonb_build_object(
        'title', m.title,
        'country', m.country,
        'country_code', m.country_code,
        'contract_start_date', m.contract_start_date
    ) INTO v_detachment
    FROM public.missions m
    WHERE m.occupant_id = v_link.talent_id
    AND m.status = 'occupied'
    AND m.candidate_type = 'detache'
    ORDER BY m.contract_start_date DESC NULLS LAST
    LIMIT 1;

    RETURN jsonb_build_object('talent', v_talent, 'mission', v_mission, 'detachment', v_detachment);
END;
$function$;

-- Rollback : recréer get_shared_talent() sans la clé 'detachment' ni le filtre sur candidate_type.
