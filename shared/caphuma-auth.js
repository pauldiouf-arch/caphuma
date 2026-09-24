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

// À attendre (await) avant toute redirection, sinon l'écriture du log peut être perdue.
async function capHumaLogAudit(supabaseClient, action, entityType, entityId, entityName, details) {
    try {
        const { error } = await supabaseClient.rpc('log_client_event', {
            p_action: action,
            p_entity_type: entityType,
            p_entity_id: entityId || null,
            p_entity_name: entityName || null,
            p_details: details || null
        });
        if (error) throw error;
    } catch (err) {
        console.warn("[Audit] Échec de l'enregistrement du log :", err);
    }
}

function capHumaMakeAuditLogger(getSupabaseClient) {
    return async function logAuditAction(action, entityType, entityId, entityName, details) {
        await capHumaLogAudit(getSupabaseClient(), action, entityType, entityId, entityName, details);
    };
}

const CAPHUMA_LAST_ACTIVITY_KEY = 'caphuma:last-activity';
const CAPHUMA_ACTIVITY_WRITE_INTERVAL_MS = 30 * 1000;

function capHumaStartIdleTimeout(supabaseClient, idleMs = 5 * 60 * 60 * 1000) {
    let idleTimer;
    let lastLocalActivity = -Infinity;

    function lastActivityAcrossTabs() {
        try {
            return Math.max(lastLocalActivity, Number(localStorage.getItem(CAPHUMA_LAST_ACTIVITY_KEY)) || 0);
        } catch (e) {
            return lastLocalActivity;
        }
    }

    function scheduleIdleCheck(delayMs) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(async () => {
            const idleForMs = Date.now() - lastActivityAcrossTabs();
            if (idleForMs < idleMs) {
                scheduleIdleCheck(idleMs - idleForMs);
                return;
            }
            console.warn('[Idle Timeout] Déconnexion automatique après inactivité.');
            await supabaseClient.auth.signOut({ scope: 'local' });
            window.location.href = 'login.html';
        }, delayMs);
    }

    function recordActivity() {
        const now = Date.now();
        if (now - lastLocalActivity < CAPHUMA_ACTIVITY_WRITE_INTERVAL_MS) return;
        lastLocalActivity = now;
        try {
            localStorage.setItem(CAPHUMA_LAST_ACTIVITY_KEY, String(now));
        } catch (e) {
            console.warn('[Idle Timeout] Activité non partagée entre onglets :', e);
        }
        scheduleIdleCheck(idleMs);
    }

    ['click', 'keydown', 'mousemove'].forEach(ev => document.addEventListener(ev, recordActivity));
    recordActivity();
}
