// Correctif P23 (B13-Q1, Master Context §7) : script enveloppé dans une IIFE
// anonyme pour isoler sa portée — élimine tout risque qu'une déclaration
// top-level de cette page masque silencieusement une fonction/variable
// partagée (shared/caphuma-*.js) chargée avant elle, ou soit elle-même
// masquée par une autre page à l'avenir. Aucun changement de comportement :
// refactoring pur (règle de méthode citée en Master Context §0).
(() => {
        // ============================================================================
        // CONFIGURATION SUPABASE — vient désormais de shared/caphuma-config.js
        // (chargé dans le <head>), qui est la source unique pour les 15 pages.
        // Voir MC13 Addendum §1.5 (U3) : ceci remplace l'ancien pont localStorage.

        const appBody = document.getElementById('appBody');
        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // ============================================================================
        // GARDE DE SESSION : si déjà connecté, on saute directement au dashboard
        // ============================================================================
        async function checkExistingSession() {
            try {
                const { data } = await supabaseClient.auth.getSession();
                if (data && data.session) {
                    window.location.href = 'dashboard.html';
                    return;
                }
            } catch (err) {
                console.warn('[Session Check] Aucune session active :', err.message);
            }
            appBody.style.display = 'flex';
        }

        checkExistingSession();

        // ============================================================================
        // SOUMISSION DU FORMULAIRE DE CONNEXION
        // ============================================================================
        const loginForm = document.getElementById('loginForm');
        const loginError = document.getElementById('loginError');
        const submitLoginBtn = document.getElementById('submitLoginBtn');

        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            loginError.classList.add('hidden');

            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;

            submitLoginBtn.disabled = true;
            submitLoginBtn.textContent = 'Connexion...';

            try {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) throw error;

                // Journal d'audit (Étape 8) — ne bloque jamais la connexion si l'écriture
                // échoue, simple avalage d'erreur en console (voir id-card.html pour la
                // logique détaillée du helper, non dupliquée ici car usage unique).
                try {
                    await supabaseClient.from('audit_logs').insert({
                        user_id: data && data.user ? data.user.id : null,
                        user_email: email,
                        user_name: null,
                        action: 'login',
                        entity_type: 'user',
                        entity_id: data && data.user ? data.user.id : null,
                        entity_name: email,
                        details: null
                    });
                } catch (auditErr) {
                    console.warn("[Audit] Échec de l'enregistrement du log :", auditErr);
                }

                window.location.href = 'dashboard.html';
            } catch (err) {
                loginError.textContent = "Identifiants incorrects ou compte inexistant.";
                loginError.classList.remove('hidden');
                submitLoginBtn.disabled = false;
                submitLoginBtn.textContent = 'Se connecter';
            }
        });
})();
