(() => {
        const appBody = document.getElementById('appBody');
        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

                // N'échoue jamais bruyamment : un problème de log ne doit pas bloquer la connexion.
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
