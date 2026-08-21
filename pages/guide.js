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
        async function logAuditAction(action, entityType, entityId, entityName, details) {
            // Délègue à shared/caphuma-auth.js (fonction commune) — corrige au passage
            // le fait que user_name n'était jamais transmis sur certaines pages.
            const userName = typeof currentUserName !== 'undefined' ? currentUserName : null;
            await capHumaLogAudit(
                supabaseClient,
                { userId: currentUserId, userEmail: currentUserEmail, userName: userName },
                action, entityType, entityId, entityName, details
            );
        }

        async function checkSession() {
            try {
                const s = await capHumaInitSession(supabaseClient);
                currentUserId = s.userId;
                currentUserEmail = s.email;
                currentUserName = s.name;
                document.getElementById('user-display-name').textContent = currentUserEmail;

                appBody.style.display = 'flex';
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
