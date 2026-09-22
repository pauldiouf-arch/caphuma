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

function capHumaMakeAuditLogger(getSupabaseClient, getCtx) {
    return async function logAuditAction(action, entityType, entityId, entityName, details) {
        await capHumaLogAudit(getSupabaseClient(), getCtx(), action, entityType, entityId, entityName, details);
    };
}

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
