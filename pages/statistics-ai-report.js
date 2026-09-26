(() => {
        function renderMarkdownToHtml(text) {
            if (!text) return "";
            let html = text;

            html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

            html = html.replace(/^### (.*$)/gim, '<h4 class="text-sm font-bold text-slate-900 mt-4 mb-2 flex items-center gap-1.5">🔸 $1</h4>');
            html = html.replace(/^## (.*$)/gim, '<h3 class="text-base font-bold text-primary mt-6 mb-3 border-b border-slate-200 pb-1">$1</h3>');
            html = html.replace(/^# (.*$)/gim, '<h2 class="text-lg font-bold text-slate-900 mt-8 mb-4">$1</h2>');

            html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-slate-900">$1</strong>');

            html = html.replace(/^\s*[\*\-]\s+(.*$)/gim, '<li class="list-disc ml-5 mt-1.5 text-slate-700">$1</li>');

            html = html.replace(/\n/g, '<br>');

            return html;
        }

        async function generateAIReport(customQuery = "") {
            const promptInput = document.getElementById('ai-prompt-input');
            const generateBtn = document.getElementById('ai-generate-btn');
            const spinner = document.getElementById('ai-spinner');
            const resultBox = document.getElementById('ai-result-box');
            const resultContent = document.getElementById('ai-result-content');

            generateBtn.disabled = true;
            spinner.classList.remove('hidden');

            const finalQuery = customQuery.trim() || promptInput.value.trim() || "";

            try {
                const { data: { session } } = await StatisticsPage.supabaseClient.auth.getSession();
                if (!session) {
                    window.location.href = 'login.html';
                    return;
                }

                // Pas de capHumaWithRetry() : quota IA limité.
                const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                        'apikey': SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify({ analysis: 'report', pool: document.getElementById('pool-selector').value, question: finalQuery })
                });

                if (response.status === 401 || response.status === 403) {
                    await StatisticsPage.supabaseClient.auth.signOut();
                    window.location.href = 'login.html';
                    return;
                }

                const result = await response.json();
                if (!response.ok || result.error) {
                    throw new Error(result.error || `Erreur serveur (${response.status})`);
                }

                resultContent.innerHTML = renderMarkdownToHtml(result.analysis);
                resultBox.classList.remove('hidden');
                toastMessage("Analyse stratégique générée avec succès.", "success");
            } catch (err) {
                console.error(err);
                toastMessage("Échec de la communication avec l'IA : " + (err && err.message ? err.message : 'erreur inconnue.'), "error");
            } finally {
                generateBtn.disabled = false;
                spinner.classList.add('hidden');
            }
        }

        document.getElementById('ai-generate-btn').addEventListener('click', () => generateAIReport());
        document.getElementById('ai-clear-btn').addEventListener('click', () => {
            document.getElementById('ai-result-box').classList.add('hidden');
            document.getElementById('ai-result-content').textContent = "";
        });

        document.querySelectorAll('.ai-quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const queryText = e.target.textContent;
                document.getElementById('ai-prompt-input').value = queryText;
                generateAIReport(queryText);
            });
        });

        StatisticsPage.renderMarkdownToHtml = renderMarkdownToHtml;
})();
