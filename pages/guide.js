(() => {
        renderPageLayout({
            icon: CapHumaIcons.get('bookOpen', 'w-5 h-5'),
            title: "Guide d'utilisation"
        });

        const supabaseClient = capHumaGetSupabaseClient();

        const appBody = document.getElementById('appBody');
        let currentUserEmail = null;
        let currentUserRole = null;

        const ROLE_SECTIONS = {
            visitor: { blockId: 'guideVisitor', label: 'Visiteur', icon: CapHumaIcons.get('eye', 'w-5 h-5') },
            user: { blockId: 'guideRecruteur', label: 'Recruteur', icon: CapHumaIcons.get('pencil', 'w-5 h-5') },
            admin: { blockId: 'guideAdmin', label: 'Administrateur', icon: CapHumaIcons.get('shield', 'w-5 h-5') }
        };

        function showRoleSection(role) {
            const config = ROLE_SECTIONS[role];
            if (!config) return;

            document.getElementById(config.blockId).classList.remove('hidden');

            document.getElementById('roleBadgeIcon').innerHTML = config.icon;
            document.getElementById('roleBadgeLabel').textContent = config.label;
            document.getElementById('roleBadge').classList.remove('hidden');
        }

        const logAuditAction = capHumaMakeAuditLogger(() => supabaseClient);

        async function checkSession() {
            try {
                const s = await capHumaInitSession(supabaseClient);
                currentUserEmail = s.email;
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
            await logAuditAction('logout', 'user');
            await supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });
})();
