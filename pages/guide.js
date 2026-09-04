// Correctif P23 (B13-Q1, Master Context §7) : script enveloppé dans une IIFE
// anonyme pour isoler sa portée — élimine tout risque qu'une déclaration
// top-level de cette page masque silencieusement une fonction/variable
// partagée (shared/caphuma-*.js) chargée avant elle, ou soit elle-même
// masquée par une autre page à l'avenir. Aucun changement de comportement :
// refactoring pur (règle de méthode citée en Master Context §0).
(() => {
        // ============================================================================
        // HEADER COMMUN (B4, Master Context §7) — injecté avant toute autre chose,
        // pour que #user-display-name et #logoutBtn existent dès la suite du script.
        // ============================================================================
        renderPageLayout({
            icon: '📖',
            title: "Guide d'utilisation"
        });

        // ============================================================================
        // INITIALISATION SUPABASE + GARDE DE SESSION
        // Page accessible à TOUS les rôles connectés (admin, recruteur, visiteur) —
        // aucune restriction de rôle, contrairement aux pages de gestion.
        // ============================================================================
        // SUPABASE_URL / SUPABASE_ANON_KEY viennent désormais de shared/caphuma-config.js
        // (chargé dans le head) — remplace l'ancien pont localStorage (MC13 Addendum U3).

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            window.location.replace('index.html');
        }

        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const appBody = document.getElementById('appBody');
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserName = null;

        // ============================================================================
        // JOURNAL D'AUDIT — la déconnexion depuis cette page est tracée aussi, par
        // cohérence avec toutes les autres pages (voir id-card.html pour le détail).
        // ============================================================================
        // Fabriquée avec des getters (pas des valeurs) : relit supabaseClient et les
        // variables currentUser* à chaque appel de logAuditAction(), jamais figée à
        // la création.
        const logAuditAction = capHumaMakeAuditLogger(
            () => supabaseClient,
            () => ({
                userId: currentUserId,
                userEmail: currentUserEmail,
                userName: typeof currentUserName !== 'undefined' ? currentUserName : null
            })
        );

        async function checkSession() {
            try {
                const s = await capHumaInitSession(supabaseClient);
                currentUserId = s.userId;
                currentUserEmail = s.email;
                currentUserName = s.name;

                capHumaStartIdleTimeout(supabaseClient);
                document.getElementById('user-display-name').textContent = currentUserEmail;

                appBody.style.display = '';
            } catch (error) {
                console.warn("[Session Guard] Accès refusé, expulsion :", error.message);
                window.location.replace('login.html');
            }
        }
        checkSession();

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            await supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });
})();
