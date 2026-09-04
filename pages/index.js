// Script enveloppé dans une IIFE anonyme pour isoler sa portée — élimine tout
// risque qu'une déclaration top-level de cette page masque silencieusement
// une fonction/variable partagée (shared/caphuma-*.js) chargée avant elle, ou
// soit elle-même masquée par une autre page à l'avenir.
(() => {
        // ============================================================================
        // CONFIGURATION SUPABASE — vient désormais de shared/caphuma-config.js
        // (chargé dans le <head>), qui est la source unique pour les 15 pages.
        // Remplace l'ancien pont localStorage.

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
})();
