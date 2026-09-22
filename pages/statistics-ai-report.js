(() => {
        function computeGlobalPayload(selectorValue, talents, mData) {
            return {
                pool: selectorValue,
                totalTalents: talents.length,
                talentsActifs: talents.filter(t => t.isValid !== false && t.is_valid !== false).length,
                talentsDisponibles: talents.filter(t => {
                    const isVal = t.isValid !== false && t.is_valid !== false;
                    const isRed = t.isRedListed || t.is_red_listed;
                    return isVal && !isRed && t.status === 'En attente de poste';
                }).length,
                talentsARisque: talents.filter(t => {
                    const isVal = t.isValid !== false && t.is_valid !== false;
                    return isVal && calculateMonthsWithoutMission(t) >= DEVALIDATION_AT_RISK_MONTHS;
                }).length,
                totalMissions: mData.length,
                missionsOccupees: mData.filter(m => m.status === 'occupied').length,
                missionsEnRecrutement: mData.filter(m => m.status === 'recruiting').length,
                missionsVacantes: mData.filter(m => m.status === 'vacant').length,
                proportionExpat: mData.filter(m => (m.candidate_type || m.candidateType) === 'expat').length,
                proportionNational: mData.filter(m => (m.candidate_type || m.candidateType) === 'nat').length
            };
        }

        // Comptages seuls : ventiler genre/nationalités par pool contournerait AI_DIVERSITY_MIN_ACTIVE_TALENTS.
        function computePoolBreakdown() {
            return StatisticsPage.poolList.map(p => {
                const code = (p.pool_id || p.poolId || '').toUpperCase();
                if (!code) return null;

                const tPool = StatisticsPage.rawTalents.filter(t => (t.pool || '').toUpperCase() === code);
                const mPool = StatisticsPage.rawMissions.filter(m => {
                    const mp = (m.pool_id || m.poolId || m.pool || '').toUpperCase();
                    return mp === code;
                });

                return {
                    pool: code,
                    nom: p.full_name || p.name || code,
                    totalTalents: tPool.length,
                    talentsActifs: tPool.filter(t => t.isValid !== false && t.is_valid !== false).length,
                    talentsDisponibles: tPool.filter(t => {
                        const isVal = t.isValid !== false && t.is_valid !== false;
                        const isRed = t.isRedListed || t.is_red_listed;
                        return isVal && !isRed && t.status === 'En attente de poste';
                    }).length,
                    talentsARisque: tPool.filter(t => {
                        const isVal = t.isValid !== false && t.is_valid !== false;
                        return isVal && calculateMonthsWithoutMission(t) >= DEVALIDATION_AT_RISK_MONTHS;
                    }).length,
                    totalPostes: mPool.length,
                    postesOccupes: mPool.filter(m => m.status === 'occupied').length,
                    postesEnRecrutement: mPool.filter(m => m.status === 'recruiting').length,
                    postesVacants: mPool.filter(m => m.status === 'vacant').length
                };
            }).filter(Boolean);
        }

        function buildAnonymizedPayload() {
            const selectorValue = document.getElementById('pool-selector').value;

            let talents = [...StatisticsPage.rawTalents];
            let mData = [...StatisticsPage.rawMissions];

            if (selectorValue !== 'global') {
                talents = talents.filter(t => (t.pool || "").toUpperCase() === selectorValue.toUpperCase());
                mData = mData.filter(m => {
                    const mPool = (m.pool_id || m.poolId || m.pool || "").toUpperCase();
                    return mPool === selectorValue.toUpperCase();
                });
            }

            const payload = computeGlobalPayload(selectorValue, talents, mData);

            if (selectorValue === 'global') {
                const poolsVentiles = computePoolBreakdown();
                if (poolsVentiles.length > 0) {
                    payload.repartitionParPool = poolsVentiles;
                }

                const activeTalentsGlobal = StatisticsPage.computeActiveTalents(talents);
                if (activeTalentsGlobal.length >= StatisticsPage.AI_DIVERSITY_MIN_ACTIVE_TALENTS) {
                    const repartitionNationalites = {};
                    activeTalentsGlobal.forEach(t => {
                        if (!t.nationality_code) return;
                        const label = CapHumaCountries.getNationality(t.nationality_code) || t.nationality_code;
                        repartitionNationalites[label] = (repartitionNationalites[label] || 0) + 1;
                    });
                    payload.repartitionNationalites = repartitionNationalites;
                }
            }

            return payload;
        }

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

        function buildGlobalReportPrompt(statsSummary, finalQuery) {
            const systemContext = `Tu es l'analyste stratégique RH senior pour ALIMA.
Analyse les données statistiques consolidées suivantes de manière professionnelle, courte et structurée (puces et gras). Ne mentionne aucun nom ni e-mail individuel.

Données consolidées du pool (${statsSummary.pool}) :
- Total talents : ${statsSummary.totalTalents}
- Actifs : ${statsSummary.talentsActifs}
- Disponibles immédiatement : ${statsSummary.talentsDisponibles}
- Profils à risque de dévalidation (>=${DEVALIDATION_AT_RISK_MONTHS} mois sans mission) : ${statsSummary.talentsARisque}
- Total postes : ${statsSummary.totalMissions}
- Postes occupés : ${statsSummary.missionsOccupees}
- Postes vacants : ${statsSummary.missionsVacantes}
- Recrutements actifs en cours : ${statsSummary.missionsEnRecrutement}
- Postes Expatriés : ${statsSummary.proportionExpat}
- Postes Nationaux : ${statsSummary.proportionNational}`;

            let ventilationBloc = "";
            if (Array.isArray(statsSummary.repartitionParPool) && statsSummary.repartitionParPool.length > 0) {
                const lignes = statsSummary.repartitionParPool.map(p =>
                    `- ${p.pool} (${p.nom}) : ${p.totalTalents} talents dont ${p.talentsActifs} actifs, ` +
                    `${p.talentsDisponibles} disponibles, ${p.talentsARisque} à risque de dévalidation ; ` +
                    `${p.totalPostes} postes dont ${p.postesOccupes} occupés, ${p.postesVacants} vacants, ` +
                    `${p.postesEnRecrutement} en recrutement`
                ).join("\n");

                ventilationBloc = `\n\nDétail par pool (utilise ces noms de pool dans ta réponse ` +
                    `quand tu compares ou désignes un pool précis) :\n${lignes}`;
            }

            let nationalitesBloc = "";
            if (statsSummary.repartitionNationalites && Object.keys(statsSummary.repartitionNationalites).length > 0) {
                const lignesNat = Object.entries(statsSummary.repartitionNationalites)
                    .sort((a, b) => b[1] - a[1])
                    .map(([nat, count]) => `${nat} : ${count}`)
                    .join(", ");
                nationalitesBloc = `\n\nRépartition des nationalités (talents actifs, toute ` +
                    `l'organisation, jamais par pool pour préserver l'anonymat des petits ` +
                    `effectifs) : ${lignesNat}`;
            }

            const objectif = finalQuery
                ? `Question à traiter en priorité : ${finalQuery}\n\n` +
                  `Réponds à cette question en t'appuyant sur les données ci-dessous. ` +
                  `C'est l'objectif principal de ta réponse : n'aborde les autres aspects ` +
                  `que s'ils éclairent réellement la question posée.`
                : `Analyse la santé du pool et formule des recommandations, à partir des ` +
                  `données ci-dessous.`;

            return `${objectif}\n\n${systemContext}${ventilationBloc}${nationalitesBloc}\n\nRéponds en français, de manière structurée avec des puces et du gras.`;
        }

        async function generateAIReport(customQuery = "") {
            const promptInput = document.getElementById('ai-prompt-input');
            const generateBtn = document.getElementById('ai-generate-btn');
            const spinner = document.getElementById('ai-spinner');
            const resultBox = document.getElementById('ai-result-box');
            const resultContent = document.getElementById('ai-result-content');

            generateBtn.disabled = true;
            spinner.classList.remove('hidden');

            const statsSummary = buildAnonymizedPayload();
            const finalQuery = customQuery.trim() || promptInput.value.trim() || "";
            const fullPrompt = buildGlobalReportPrompt(statsSummary, finalQuery);

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
                    body: JSON.stringify({ prompt: fullPrompt })
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
