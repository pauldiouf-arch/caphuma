(() => {
        renderPageLayout({
            icon: '📖',
            title: "Guide d'utilisation"
        });

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            window.location.replace('index.html');
        }

        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const appBody = document.getElementById('appBody');
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserName = null;
        let currentUserRole = null;

        // Un seul des 3 blocs est affiché, celui qui correspond au rôle réel de la
        // personne connectée — pas de sélecteur manuel.
        const ROLE_SECTIONS = {
            visitor: { blockId: 'guideVisitor', label: 'Visiteur', icon: '👁️' },
            user: { blockId: 'guideRecruteur', label: 'Recruteur', icon: '🖊️' },
            admin: { blockId: 'guideAdmin', label: 'Administrateur', icon: '🛡️' }
        };

        function showRoleSection(role) {
            const config = ROLE_SECTIONS[role];
            if (!config) return;

            document.getElementById(config.blockId).classList.remove('hidden');

            document.getElementById('roleBadgeIcon').textContent = config.icon;
            document.getElementById('roleBadgeLabel').textContent = config.label;
            document.getElementById('roleBadge').classList.remove('hidden');
        }

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
                currentUserRole = s.role;

                capHumaStartIdleTimeout(supabaseClient);
                document.getElementById('user-display-name').textContent = currentUserEmail;

                showRoleSection(currentUserRole);

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
