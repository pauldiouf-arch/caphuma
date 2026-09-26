(() => {
        function updatePoolAiAnalysisVisibility(selectorValue) {
            const card = document.getElementById('pool-ai-analysis-card');

            if (StatisticsPage.currentUserRole === 'visitor') {
                card.classList.add('hidden');
                return;
            }

            if (selectorValue === 'global') {
                card.classList.add('hidden');
                return;
            }
            card.classList.remove('hidden');

            document.getElementById('pool-ai-analysis-content').classList.add('hidden');
            document.getElementById('pool-ai-analysis-content').innerHTML = '';
            document.getElementById('pool-ai-analysis-error').classList.add('hidden');

            const poolInfo = StatisticsPage.poolList.find(p => (p.pool_id || "").toUpperCase() === selectorValue.toUpperCase());
            document.getElementById('pool-ai-analysis-pool-name').textContent = poolInfo ? (poolInfo.full_name || poolInfo.name) : selectorValue;
        }

        async function callPoolAiProxy(request) {
            const { data: { session } } = await StatisticsPage.supabaseClient.auth.getSession();
            if (!session) {
                window.location.href = 'login.html';
                throw new Error("Session expirée — reconnectez-vous.");
            }

            // Pas de capHumaWithRetry() : quota IA limité.
            const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': SUPABASE_ANON_KEY
                },
                body: JSON.stringify(request)
            });

            if (response.status === 401 || response.status === 403) {
                await StatisticsPage.supabaseClient.auth.signOut();
                window.location.href = 'login.html';
                throw new Error('Session expirée ou accès refusé — redirection vers la connexion.');
            }

            const result = await response.json();
            if (!response.ok || result.error) {
                throw new Error(result.error || `Erreur serveur (${response.status})`);
            }
            return result.analysis;
        }

        document.getElementById('pool-ai-analysis-btn').addEventListener('click', async () => {
            const selectorValue = document.getElementById('pool-selector').value;
            if (selectorValue === 'global') return;

            const btn = document.getElementById('pool-ai-analysis-btn');
            const spinner = document.getElementById('pool-ai-analysis-spinner');
            const errorEl = document.getElementById('pool-ai-analysis-error');
            const contentEl = document.getElementById('pool-ai-analysis-content');

            btn.disabled = true;
            spinner.classList.remove('hidden');
            errorEl.classList.add('hidden');
            contentEl.classList.add('hidden');

            try {
                const questionInput = document.getElementById('pool-ai-question');
                const question = questionInput ? questionInput.value.trim() : '';
                const analysis = await callPoolAiProxy({ analysis: 'pool', pool: selectorValue, question });

                contentEl.innerHTML = StatisticsPage.renderMarkdownToHtml(analysis);
                contentEl.classList.remove('hidden');
            } catch (error) {
                console.error("Erreur analyse IA du pool :", error);
                capHumaShowInlineError(errorEl, "Impossible de générer l'analyse : " + (error && error.message ? error.message : 'erreur inconnue.'));
            } finally {
                btn.disabled = false;
                spinner.classList.add('hidden');
            }
        });

        StatisticsPage.updatePoolAiAnalysisVisibility = updatePoolAiAnalysisVisibility;
})();
