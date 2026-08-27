/**
 * ============================================================================
 * caphuma-error-monitor.js
 * ----------------------------------------------------------------------------
 * Intercepteur global d'erreurs JS (backlog B16-O1, Master Context §7,
 * priorité P2 de l'ordre de traitement B12→B18). Avant ce fichier, une
 * erreur JS inattendue (exception non interceptée, promesse rejetée sans
 * .catch()) mourait silencieusement dans la console du navigateur — aucun
 * moyen de savoir qu'un collègue a rencontré un bug sans qu'il le décrive
 * verbalement.
 *
 * Ne remplace ni audit_logs (actions métier volontaires et tracées) ni
 * UptimeRobot/B6 (disponibilité du site vu de l'extérieur) : couvre un
 * troisième cas, les erreurs JS inattendues côté navigateur d'un utilisateur
 * déjà sur une page qui répond.
 *
 * Ce que ce fichier fait :
 *   - capture toute erreur JS non interceptée (window.onerror) et toute
 *     promesse rejetée sans .catch() (unhandledrejection) ;
 *   - garde les 20 dernières en mémoire (CAP_HUMA_ERROR_BUFFER, purement
 *     local à l'onglet — rien n'est envoyé nulle part par ce fichier) ;
 *   - affiche un toast générique si toastMessage() est déjà chargé (donc
 *     dépend de shared/caphuma-utils.js, voir inclusion ci-dessous).
 *
 * Ce que ce fichier NE fait PAS (portée P2 volontairement stricte) :
 *   - aucun envoi réseau, aucun service tiers, aucun coût ;
 *   - aucune tentative de "retry" ou de récupération de l'action en cours
 *     (ça, c'est B15-R2, un chantier séparé) ;
 *   - pas de bouton "Signaler un problème" — ce sera B16-O2 (P21), après ce
 *     fichier, qui réutilisera CAP_HUMA_ERROR_BUFFER défini ici.
 *
 * Portée retenue (précision technique, pas une décision métier — règle 16) :
 * les 12 pages PROTÉGÉES du site, celles qui chargent déjà caphuma-auth.js
 * (admin, audit_logs, dashboard, devalidated, extraction, guide, id-card,
 * import, missions, red_list, statistics, talents). Le sketch initial du
 * Master Context parlait de "15 pages authentifiées" par réutilisation du
 * chiffre générique du site (comme pour I2/idle-timeout) — imprécis : seules
 * 12 pages chargent une session (cf. en-tête de caphuma-auth.js, "12 pages
 * protégées"). Non couvertes, par cohérence avec ce même choix déjà fait
 * pour I2 : login.html/index.html (déjà dotées de leur propre gestion
 * d'erreur de démarrage, pas de session à protéger) et shared-talent.html
 * (page publique sans session, hors périmètre de cet audit identité/session).
 *
 * Inclure APRÈS shared/caphuma-utils.js (dépendance directe : toastMessage()).
 * L'ordre avec shared/caphuma-auth.js n'a pas d'importance ici (aucune
 * dépendance à la session) — inséré avant lui par simple convention de
 * lecture (config → utils → error-monitor → auth → layout).
 * ============================================================================
 */
const CAP_HUMA_ERROR_BUFFER = [];

function captureError(kind, detail) {
    CAP_HUMA_ERROR_BUFFER.push({
        kind,
        detail: String(detail),
        page: location.pathname,
        at: new Date().toISOString()
    });
    if (CAP_HUMA_ERROR_BUFFER.length > 20) CAP_HUMA_ERROR_BUFFER.shift();

    console.error(`[${kind}]`, detail);

    // Garde : toastMessage() vient de caphuma-utils.js, censé être déjà chargé
    // (voir consigne d'inclusion ci-dessus) — vérifié quand même par prudence,
    // dans le même esprit que la garde ajoutée à showError() en B1.
    if (typeof toastMessage === 'function') {
        toastMessage("Une erreur inattendue s'est produite. Rechargez la page si le problème persiste.", "error");
    }
}

window.addEventListener('error', (e) => captureError('Erreur JS', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => captureError('Promesse rejetée', e.reason));
