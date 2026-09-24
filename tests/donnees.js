const PIEGE = '"\'><b data-xss="1">XSS</b>';

const ID_COMPTES = {
    admin: '00000000-0000-0000-0000-0000000000a1',
    user: '00000000-0000-0000-0000-0000000000a2',
    visitor: '00000000-0000-0000-0000-0000000000a3',
};

const ID = {
    expat: '11111111-1111-1111-1111-111111111111',
    aRisque: '11111111-1111-1111-1111-111111111112',
    national: '11111111-1111-1111-1111-111111111113',
    devalide: '11111111-1111-1111-1111-111111111114',
    listeRouge: '11111111-1111-1111-1111-111111111115',
    aArbitrer: '11111111-1111-1111-1111-111111111116',
    posteNational: '33333333-3333-3333-3333-333333333331',
    posteVacant: '33333333-3333-3333-3333-333333333332',
    detachement: '33333333-3333-3333-3333-333333333333',
    posteExpat: '33333333-3333-3333-3333-333333333334',
};

const ilYa = (mois) => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - mois);
    return d.toISOString().slice(0, 10);
};
const dansJours = (jours) => new Date(Date.now() + jours * 864e5).toISOString().slice(0, 10);

const talentBase = {
    email: null, pool: 'P1', status: 'En attente de poste', is_valid: true, is_red_listed: false,
    experience_months_alima: 30, experience_months_humanitarian: 60, number_of_alima_missions: 'two',
    pool_integration_date: ilYa(40), availability: null, has_emergency_mission: false, has_mission_opening: false,
    has_mission_closure: false, intervention_contexts: ['Urgence'], intervention_zones: ['Sahel'], key_skills: ['Coordination'],
    has_visa: true, nationality: 'Mali', nationality_code: 'ML', country_of_residence: 'Mali', education_level: 'bac+5',
    education_specialty: 'Santé publique', alima_trainings: [], languages: ['Français'], other_languages: [],
    last_mission_end_date: ilYa(6), is_currently_on_mission: false, months_without_mission: 6, gender: 'F',
    current_function: 'Coordinatrice médicale', staff_type: 'expat', tracking_pool: null, archived_position_passages: [],
    red_list_documents: null, created_at: '2025-01-01T00:00:00Z',
};

const talents = [
    { ...talentBase, id: ID.expat, first_name: `Awa ${PIEGE}`, last_name: `Diallo ${PIEGE}`, email: 'awa@exemple.org',
        current_function: `Coordinatrice ${PIEGE}`, archived_position_passages: [{ positionTitle: `Ancien poste ${PIEGE}`, countryCode: 'NE', startDate: '2020-01-01', endDate: '2021-06-30', comments: [{ context: `Contexte ${PIEGE}`, positive_points: PIEGE, rating: 8, author_email: 'reco@alima.ngo' }] }] },
    { ...talentBase, id: ID.aRisque, first_name: 'Binta', last_name: 'Koné', email: 'binta@exemple.org', last_mission_end_date: ilYa(23), months_without_mission: 23 },
    { ...talentBase, id: ID.national, first_name: 'Cheick', last_name: 'Traoré', staff_type: 'national', pool: null, tracking_pool: 'P1', status: 'En poste ALIMA', is_currently_on_mission: true, months_without_mission: 0 },
    { ...talentBase, id: ID.devalide, first_name: `Dado ${PIEGE}`, last_name: 'Sow', is_valid: false, devalidation_date: ilYa(2) },
    { ...talentBase, id: ID.aArbitrer, first_name: 'Fanta', last_name: 'Camara', email: 'fanta@exemple.org', last_mission_end_date: ilYa(25), months_without_mission: 25, languages: ['Anglais'], has_visa: false },
    { ...talentBase, id: ID.listeRouge, first_name: `Eli ${PIEGE}`, last_name: 'Ba', is_red_listed: true, red_list_date: ilYa(1) + 'T10:00:00Z',
        red_list_reason: `Motif ${PIEGE}`, red_list_added_by: ID_COMPTES.user, red_list_added_by_name: `Recruteur ${PIEGE}`, red_list_documents: [] },
];

const missionBase = {
    pool: 'P1', pool_level: 'mission', country: null, country_code: 'ML', location: 'Bamako', project_name: null, desk: null,
    status: 'vacant', occupant_id: null, candidate_type: 'expat', contract_start_date: null, contract_end_date: null, contract_status: null,
    contract_end_type: 'date', future_talent_id: null, future_contract_start_date: null, future_contract_end_date: null, created_at: '2025-01-01T00:00:00Z',
};

const missions = [
    { ...missionBase, id: ID.posteNational, title: `Coordinateur national ${PIEGE}`, location: `Bamako ${PIEGE}`, status: 'occupied', occupant_id: ID.national, candidate_type: 'nat', contract_start_date: ilYa(8), contract_end_date: dansJours(25) },
    { ...missionBase, id: ID.posteVacant, title: 'Médecin référent', status: 'vacant' },
    { ...missionBase, id: ID.detachement, title: 'Détachement Kayes', pool_level: 'projet', project_name: `Projet ${PIEGE}`, status: 'occupied', occupant_id: ID.national, candidate_type: 'detache', contract_start_date: ilYa(2), contract_end_date: dansJours(60) },
    { ...missionBase, id: ID.posteExpat, title: 'Coordinateur médical', status: 'recruiting', candidate_type: 'expat' },
];

const DONNEES = {
    users: [
        { id: ID_COMPTES.admin, name: `Admin ${PIEGE}`, email: 'admin@alima.ngo', role: 'admin', is_active: true, created_at: '2025-01-01T00:00:00Z' },
        { id: ID_COMPTES.user, name: 'Recruteur Un', email: 'reco@alima.ngo', role: 'user', is_active: true, created_at: '2025-01-01T00:00:00Z' },
        { id: ID_COMPTES.visitor, name: 'Visiteur Un', email: 'visit@alima.ngo', role: 'visitor', is_active: true, created_at: '2025-01-01T00:00:00Z' },
    ],
    pools: [
        { id: 1, pool_id: 'P1', name: 'P1', full_name: `Pool Un ${PIEGE}`, level: 'mission', is_active: true, is_archived: false },
        { id: 2, pool_id: 'P2', name: 'P2', full_name: 'Pool Deux', level: 'mission', is_active: true, is_archived: false },
        { id: 3, pool_id: 'P9', name: 'P9', full_name: 'Pool archivé', level: 'mission', is_active: false, is_archived: true, archived_at: '2026-01-01T00:00:00Z', archived_by_name: 'Admin' },
    ],
    talents,
    missions,
    comments: [
        { id: 'c1', talent_id: ID.expat, user_id: ID_COMPTES.user, content: `Commentaire ${PIEGE}`, created_at: '2026-05-01T10:00:00Z', author_email: 'reco@alima.ngo' },
    ],
    evaluations: [
        { id: 'e1', mission_id: ID.posteNational, talent_id: ID.national, author_id: ID_COMPTES.user, context: `Évaluation ${PIEGE}`, positive_points: PIEGE, negative_points: PIEGE, rating: 7, is_archived: false, created_at: '2026-05-01T10:00:00Z', author_email: 'reco@alima.ngo' },
    ],
    share_tokens: [
        { id: 's1', token: 'st_jeton-de-test-actif', talent_id: ID.expat, created_by: ID_COMPTES.user, expires_at: dansJours(20) + 'T00:00:00Z', is_revoked: false, view_count: 3, created_at: '2026-09-01T10:00:00Z', created_by_name: `Recruteur ${PIEGE}` },
    ],
    pool_history: [
        { id: 'h1', talent_id: ID.expat, from_pool: 'P2', to_pool: 'P1', changed_at: '2025-06-01T10:00:00Z', changed_by: ID_COMPTES.admin, changed_by_name: `Admin ${PIEGE}` },
    ],
    access_code_requests: [
        { id: 'r1', email: 'reco@alima.ngo', requested_at: '2026-09-20T08:00:00Z', resolved_at: null, resolved_by: null },
    ],
    notification_preferences: [],
    audit_logs: [
        { id: 'a1', user_id: ID_COMPTES.user, user_email: 'reco@alima.ngo', user_name: `Recruteur ${PIEGE}`, action: 'update', entity_type: 'talent', entity_id: ID.expat, entity_name: `Awa ${PIEGE}`, details: `Détail ${PIEGE}`, created_at: new Date().toISOString() },
        { id: 'a2', user_id: null, user_email: null, user_name: 'Système', action: 'update', entity_type: 'system', entity_id: null, entity_name: 'Calcul mensuel', details: '12 talent(s) mis à jour', created_at: new Date().toISOString() },
    ],
    stats_talents: [{ pool_id: 'P1', active: 4, available: 2, at_risk: 1 }, { pool_id: 'P2', active: 0, available: 0, at_risk: 0 }],
    stats_postes: [{ pool_id: 'P1', positions: 4 }],
    alertes: [
        { alert_type: 'contract', pool_id: 'P1', days_left: 25, contract_window: 30, status: null },
        { alert_type: 'at_risk', pool_id: 'P1', days_left: null, contract_window: null, status: null },
    ],
    talent_partage: {
        talent: { ...talents[0] },
        mission: { title: `Poste ${PIEGE}`, country_code: 'ML', contract_start_date: ilYa(3) },
        detachment: null,
    },
};

module.exports = { DONNEES, ID, ID_COMPTES, PIEGE };
