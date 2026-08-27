/**
 * ============================================================================
 * caphuma-auth.js
 * ----------------------------------------------------------------------------
 * Factorise la partie COMMUNE de la session/authentification et du journal
 * d'audit, utilisée par les 12 pages protégées du site.
 *
 * ⚠️ Choix de conception important : ce fichier NE déclare AUCUNE variable
 * globale de type "currentUserId" / "currentUserRole" etc. Chaque page garde
 * ses propres variables (déjà déclarées en haut de son <script>) et les
 * remplit à partir de la valeur retournée par capHumaInitSession(). Cela
 * évite tout conflit de nom entre scripts (deux `let currentUserId` dans deux
 * balises <script> différentes du même document provoquent une erreur de
 * syntaxe en JS classique) et ne change RIEN au comportement déjà en place
 * page par page (garde de rôle, redirections, actions post-connexion) —
 * conformément à la consigne « refactoring pur, aucune régression ».
 *
 * Inclure APRÈS caphuma-utils.js et APRÈS l'initialisation de supabaseClient.
 * ============================================================================
 */

/**
 * Récupère la session Supabase active + le profil (role/name/is_active)
 * associé, dans un seul appel factorisé.
 *
 * Ne fait AUCUNE redirection et ne lève PAS d'exception pour un rôle refusé :
 * la décision "qui a le droit de voir cette page" reste entièrement dans la
 * page elle-même (elle varie trop d'une page à l'autre pour être généralisée
 * sans risque — cf. Master Context §22).
 *
 * @param {Object} supabaseClient
 * @returns {Promise<{session: Object, userId: string, email: string, role: string, name: string, isActive: boolean}>}
 * @throws {Error} si aucune session active n'est trouvée, si le profil est
 *   introuvable dans `users`, ou si la lecture du profil échoue (à charge de
 *   la page d'appeler window.location.replace(...))
 */
async function capHumaInitSession(supabaseClient) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        throw new Error('Session absente ou expirée.');
    }

    const userId = session.user.id;
    const email = session.user.email || null;

    const { data: profiles, error: profileError } = await supabaseClient
        .from('users')
        .select('role, name, is_active')
        .eq('id', userId);

    // Correctif B1 (19/08/2026, décision utilisateur) : refus EXPLICITE plutôt
    // que de laisser entrer avec role=null. Avant ce correctif, une erreur de
    // lecture du profil OU un profil absent de `users` (compte auth existant
    // mais jamais rattaché à une ligne `users`, ou supprimé de `users` sans
    // supprimer le compte auth) faisait silencieusement passer role=null —
    // chaque page devait alors se débrouiller seule face à ce rôle inconnu.
    if (profileError) {
        throw new Error('Impossible de vérifier le profil utilisateur.');
    }
    if (!profiles || profiles.length === 0) {
        throw new Error('Profil introuvable. Contactez un administrateur ALIMA.');
    }

    const profile = profiles[0];
    const role = profile.role;
    const name = profile.name || email || 'Inconnu';
    const isActive = profile.is_active !== false;

    if (!isActive) {
        throw new Error('Compte désactivé.');
    }

    return { session, userId, email, role, name, isActive };
}

/**
 * Écrit une ligne dans audit_logs. N'échoue JAMAIS bruyamment : un problème
 * d'écriture du log ne doit jamais bloquer l'action métier réelle (cohérent
 * avec le comportement déjà en place sur toutes les pages avant la refonte).
 *
 * ⚠️ Règle de méthode n°23 : si cet appel est suivi d'une redirection/
 * changement de page, la page appelante DOIT faire `await capHumaLogAudit(...)`
 * avant de rediriger — ne jamais lancer l'écriture "en tâche de fond" juste
 * avant un window.location.href.
 *
 * @param {Object} supabaseClient
 * @param {{userId: string, userEmail: string, userName?: string}} ctx  Identité de l'auteur de l'action
 * @param {string} action       ex. 'create' | 'update' | 'delete' | 'login' | 'revoke_share'...
 * @param {string} entityType   ex. 'talent' | 'mission' | 'user' | 'share_token'...
 * @param {string|null} entityId
 * @param {string|null} entityName
 * @param {Object|null} details
 */
async function capHumaLogAudit(supabaseClient, ctx, action, entityType, entityId, entityName, details) {
    try {
        await supabaseClient.from('audit_logs').insert({
            user_id: ctx.userId || null,
            user_email: ctx.userEmail || null,
            user_name: ctx.userName || null,
            action: action,
            entity_type: entityType,
            entity_id: entityId || null,
            entity_name: entityName || null,
            details: details || null
        });
    } catch (err) {
        console.warn("[Audit] Échec de l'enregistrement du log :", err);
    }
}

/**
 * ============================================================================
 * DÉCONNEXION APRÈS INACTIVITÉ (backlog B14-I2, priorité P6)
 * ----------------------------------------------------------------------------
 * À l'origine dans un fichier séparé shared/caphuma-idle-timeout.js —
 * regroupé ici le 27/08/2026 (décision utilisateur, même motif que
 * captureError() dans caphuma-utils.js : éviter un fichier de plus à
 * charger sur chaque page pour un coût réseau évitable). Aucun changement
 * de comportement, uniquement un déplacement — sa place est de toute façon
 * cohérente ici, ce fichier gérant déjà tout ce qui touche à la session.
 *
 * Durée retenue (décision utilisateur, 27/08/2026 — règle 16) : 5 HEURES,
 * pas les 30 minutes du sketch initial du Master Context. Motif : les
 * recruteurs gardent le site ouvert toute la journée sans y être en continu ;
 * une déconnexion toutes les 30-60 min serait pénible en usage réel. La nuit
 * (poste laissé sans surveillance) reste couverte par la consigne de
 * verrouillage manuel du poste, déjà en vigueur côté utilisateurs.
 * ============================================================================
 */

/**
 * Démarre le chronomètre d'inactivité de la page. À appeler UNE SEULE FOIS
 * par page, juste après confirmation qu'une session valide existe (donc
 * après un appel réussi à capHumaInitSession() ci-dessus) — jamais avant.
 *
 * @param {Object} supabaseClient
 * @param {number} [idleMs=18000000] Délai d'inactivité en millisecondes
 *   avant déconnexion automatique. Par défaut 18 000 000 ms = 5 heures.
 *   Paramètre exposé UNIQUEMENT pour permettre un délai raccourci pendant
 *   des tests manuels — ne jamais coder une valeur différente de 5h en
 *   production.
 */
function capHumaStartIdleTimeout(supabaseClient, idleMs = 5 * 60 * 60 * 1000) {
    let idleTimer;

    function resetIdle() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(async () => {
            console.warn('[Idle Timeout] Déconnexion automatique après inactivité.');
            await supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        }, idleMs);
    }

    ['click', 'keydown', 'mousemove'].forEach(ev => document.addEventListener(ev, resetIdle));
    resetIdle();
}
