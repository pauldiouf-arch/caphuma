(() => {
        const appBody = document.getElementById('appBody');
        const supabaseClient = capHumaGetSupabaseClient();

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
            capHumaDraftClearAll();
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
                const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) throw error;

                try {
                    const { error: auditError } = await supabaseClient.rpc('log_client_event', { p_action: 'login', p_entity_type: 'user' });
                    if (auditError) throw auditError;
                } catch (auditErr) {
                    console.warn("[Audit] Échec de l'enregistrement du log :", auditErr);
                }

                window.location.href = 'dashboard.html';
            } catch (err) {
                loginError.textContent = err && err.code === 'user_banned'
                    ? "Compte suspendu. Contactez un administrateur ALIMA."
                    : "Identifiants incorrects ou compte inexistant.";
                loginError.classList.remove('hidden');
                submitLoginBtn.disabled = false;
                submitLoginBtn.textContent = 'Se connecter';
            }
        });

        const loginEmail = document.getElementById('loginEmail');
        const resetRequestForm = document.getElementById('resetRequestForm');
        const resetRequestEmail = document.getElementById('resetRequestEmail');
        const resetRequestMessage = document.getElementById('resetRequestMessage');
        const submitResetRequestBtn = document.getElementById('submitResetRequestBtn');

        function showResetRequestMessage(text, isError) {
            resetRequestMessage.textContent = text;
            resetRequestMessage.classList.toggle('text-red-600', isError);
            resetRequestMessage.classList.toggle('bg-red-50', isError);
            resetRequestMessage.classList.toggle('text-emerald-700', !isError);
            resetRequestMessage.classList.toggle('bg-emerald-50', !isError);
            resetRequestMessage.classList.remove('hidden');
        }

        document.getElementById('showResetRequestBtn').addEventListener('click', function () {
            loginForm.classList.add('hidden');
            resetRequestForm.classList.remove('hidden');
            resetRequestMessage.classList.add('hidden');
            submitResetRequestBtn.disabled = false;
            resetRequestEmail.value = loginEmail.value.trim();
            resetRequestEmail.focus();
        });

        document.getElementById('backToLoginBtn').addEventListener('click', function () {
            resetRequestForm.classList.add('hidden');
            loginForm.classList.remove('hidden');
            loginEmail.focus();
        });

        resetRequestForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            resetRequestMessage.classList.add('hidden');
            submitResetRequestBtn.disabled = true;

            try {
                const { error } = await supabaseClient.rpc('request_access_code_reset', {
                    p_email: resetRequestEmail.value.trim()
                });
                if (error) throw error;
                showResetRequestMessage("Si ce compte existe, un administrateur a été prévenu et vous transmettra un nouveau mot de passe.", false);
            } catch (err) {
                console.warn('[Demande de mot de passe] Échec :', err && err.message);
                showResetRequestMessage("La demande n'a pas pu être envoyée. Réessayez dans quelques instants.", true);
                submitResetRequestBtn.disabled = false;
            }
        });
})();
