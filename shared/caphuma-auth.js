/**
 * Factorise la session/authentification et le journal d'audit, utilisés par
 * les pages protégées du site.
 *
 * Ne déclare aucune variable globale (currentUserId, currentUserRole, etc.) :
 * chaque page garde les siennes et les remplit depuis la valeur retournée
 * par capHumaInitSession(), pour éviter tout conflit de nom entre scripts.
 *
 * Inclure après caphuma-utils.js et après l'initialisation de supabaseClient.
 */

/**
 * Récupère la session Supabase active et le profil (role/name/is_active)
 * associé. Ne fait aucune redirection et ne lève pas d'exception pour un
 * rôle refusé : la décision d'accès reste entièrement à la page.
 *
 * @param {Object} supabaseClient
 * @returns {Promise<{session: Object, userId: string, email: string, role: string, name: string, isActive: boolean}>}
 * @throws {Error} si aucune session active, si le profil est introuvable, ou
 *   si sa lecture échoue — à charge de la page d'appeler window.location.replace(...)
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
 * Écrit une ligne dans audit_logs. N'échoue jamais bruyamment : un problème
 * d'écriture du log ne doit jamais bloquer l'action métier réelle.
 *
 * Si cet appel est suivi d'une redirection, la page appelante doit faire
 * `await capHumaLogAudit(...)` avant de rediriger — ne jamais lancer
 * l'écriture "en tâche de fond" juste avant un window.location.href.
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
 * Fabrique une fonction logAuditAction(action, entityType, entityId,
 * entityName, details) déjà liée au client Supabase et à l'identité de
 * l'appelant.
 *
 * @param {() => Object} getSupabaseClient
 * @param {() => {userId: string, userEmail: string, userName?: string}} getCtx
 * @returns {(action: string, entityType: string, entityId: string|null, entityName: string|null, details: Object|null) => Promise<void>}
 */
function capHumaMakeAuditLogger(getSupabaseClient, getCtx) {
    return async function logAuditAction(action, entityType, entityId, entityName, details) {
        await capHumaLogAudit(getSupabaseClient(), getCtx(), action, entityType, entityId, entityName, details);
    };
}

/**
 * Démarre le chronomètre d'inactivité de la page. À appeler une seule fois
 * par page, juste après confirmation qu'une session valide existe (donc
 * après un appel réussi à capHumaInitSession() ci-dessus) — jamais avant.
 *
 * @param {Object} supabaseClient
 * @param {number} [idleMs=18000000] Délai d'inactivité en millisecondes
 *   avant déconnexion automatique. 5 heures par défaut — ne jamais coder une
 *   valeur différente en production, seulement pour des tests manuels.
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
