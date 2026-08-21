        // ============================================================================
        // CONFIGURATION SUPABASE — vient désormais de shared/caphuma-config.js
        // (chargé dans le <head>), qui est la source unique pour les 15 pages.
        // Voir MC13 Addendum §1.5 (U3) : ceci remplace l'ancien pont localStorage.

        const bootError = document.getElementById('bootError');

        async function boot() {
            try {
                const { createClient } = supabase;
                const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
                const { data, error } = await client.auth.getSession();
                if (error) throw error;

                if (data && data.session) {
                    window.location.href = 'dashboard.html';
                } else {
                    window.location.href = 'login.html';
                }
            } catch (err) {
                console.error('[Boot] Erreur de connexion à Supabase :', err.message);
                bootError.textContent = "Impossible de contacter le serveur. Vérifiez votre connexion internet ou réessayez plus tard.";
                bootError.classList.remove('hidden');
            }
        }

        boot();
