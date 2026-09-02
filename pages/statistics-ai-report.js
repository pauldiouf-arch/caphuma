// Correctif P26 (B13-Q2, Master Context §7) — 4/4 : rapport IA global du Hub
// (payload anonymisé consolidé, rendu Markdown, appel à l'Edge Function
// ai-proxy). renderMarkdownToHtml() est un utilitaire de rendu générique,
// réutilisé tel quel par statistics-pool-ai.js (analyse d'un pool précis) —
// d'où son exposition sur StatisticsPage ci-dessous, bien qu'interne à ce
// fichier par ailleurs. Voir statistics.js (chargé AVANT ce fichier) pour
// l'explication de StatisticsPage.
(() => {
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

            const payload = {
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

            // ------------------------------------------------------------------
            // VENTILATION PAR POOL — vue globale uniquement (18/08/2026, A2 étape 3)
            // ------------------------------------------------------------------
            // Motif : en vue globale, cette fonction ne renvoyait QUE des totaux
            // fusionnés (pool: "global"). L'IA n'avait donc aucune donnée par pool et
            // ne pouvait ni les nommer, ni les comparer, ni désigner le plus à risque —
            // constat de l'utilisateur le 18/08/2026, confirmé dans le code. Ce n'était
            // pas un défaut de formulation du prompt : la donnée était absente.
            //
            // Ce qui est ajouté : uniquement des COMPTAGES par pool, plus le nom du
            // pool. Un pool est une catégorie de poste (Coordinateur Logistique, Chef
            // de mission...), pas une personne — aucune donnée à caractère personnel.
            //
            // Ce qui n'est PAS ajouté, volontairement : genre, nationalités et langues
            // par pool. Ces répartitions restent réservées à l'analyse d'un pool
            // précis, où elles sont soumises au seuil AI_DIVERSITY_MIN_ACTIVE_TALENTS.
            // Les ajouter ici reviendrait à contourner ce seuil pour les 7 pools d'un
            // seul appel. Ne pas "compléter" ce bloc par symétrie sans repasser par la
            // décision de l'utilisateur (règle 16).
            if (selectorValue === 'global') {
                const poolsVentiles = StatisticsPage.poolList.map(p => {
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

                if (poolsVentiles.length > 0) {
                    payload.repartitionParPool = poolsVentiles;
                }
            }

            return payload;
        }

        // Convertisseur basique Markdown pour rendu premium de l'analyse IA
        function renderMarkdownToHtml(text) {
            if (!text) return "";
            let html = text;
            
            // Échappement basique contre les injections
            html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            
            // Formatage des titres (###)
            html = html.replace(/^### (.*$)/gim, '<h4 class="text-sm font-bold text-slate-900 mt-4 mb-2 flex items-center gap-1.5">🔸 $1</h4>');
            html = html.replace(/^## (.*$)/gim, '<h3 class="text-base font-bold text-primary mt-6 mb-3 border-b border-slate-200 pb-1">$1</h3>');
            html = html.replace(/^# (.*$)/gim, '<h2 class="text-lg font-bold text-slate-900 mt-8 mb-4">$1</h2>');
            
            // Formatage du gras (**)
            html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-slate-900">$1</strong>');
            
            // Liste à puces (* ou -)
            html = html.replace(/^\s*[\*\-]\s+(.*$)/gim, '<li class="list-disc ml-5 mt-1.5 text-slate-700">$1</li>');
            
            // Retours chariots
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

            const statsSummary = buildAnonymizedPayload();

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

            const finalQuery = customQuery.trim() || promptInput.value.trim() || "";

            // Ventilation par pool — vue globale uniquement (18/08/2026, A2 étape 3).
            // Sans ce bloc, l'IA ne dispose que de totaux fusionnés et ne peut ni citer
            // un pool par son nom ni en comparer deux. Rendue sous forme de tableau
            // lisible plutôt qu'en JSON brut : le reste de ce prompt est déjà en texte,
            // et un format homogène donne de meilleures réponses qu'un mélange des deux.
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

            // Chantier A2 (18/08/2026) — la question passe EN TÊTE du prompt.
            // Avant : 30 lignes de cadrage + 10 chiffres identiques d'un clic à l'autre,
            // puis la question en dernier — elle pesait trop peu face au reste, d'où des
            // réponses très proches quelle que soit la question posée.
            // Sans question saisie, la consigne générale d'origine est utilisée telle quelle.
            const objectif = finalQuery
                ? `Question à traiter en priorité : ${finalQuery}\n\n` +
                  `Réponds à cette question en t'appuyant sur les données ci-dessous. ` +
                  `C'est l'objectif principal de ta réponse : n'aborde les autres aspects ` +
                  `que s'ils éclairent réellement la question posée.`
                : `Analyse la santé du pool et formule des recommandations, à partir des ` +
                  `données ci-dessous.`;

            const fullPrompt = `${objectif}\n\n${systemContext}${ventilationBloc}\n\nRéponds en français, de manière structurée avec des puces et du gras.`;

            try {
                // Appel à la Edge Function générique ai-proxy (partagée avec missions.html) —
                // vérifie le rôle côté serveur (visitor exclu) et détient seule la clé IA.
                const { data: { session } } = await StatisticsPage.supabaseClient.auth.getSession();
                if (!session) {
                    // Correctif complémentaire à P10 (28/08/2026) : voir
                    // callManageUsers() (admin.js) pour la justification complète.
                    window.location.href = 'login.html';
                    return;
                }

                // ⚠️ Volontairement PAS enveloppé dans capHumaWithRetry() (P19,
                // décision n°15) : même raison que callPoolAiProxy() plus haut dans
                // ce fichier — palier gratuit limité chez le fournisseur d'IA.
                const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                        'apikey': SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify({ prompt: fullPrompt })
                });

                // Correctif P10 (B14-I3, 28/08/2026) : voir callManageUsers()
                // (admin.js) pour la justification complète. Ce bloc reste
                // volontairement séparé de callPoolAiProxy() (voir commentaire
                // plus haut sur ce choix) — même correctif appliqué aux deux
                // implémentations plutôt que de les fusionner maintenant.
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

        // toastMessage() retirée d'ici : vient désormais de shared/caphuma-utils.js.
        // ⚠️ Petit changement : z-index 50→70 et durée 3000→3500ms (harmonisé
        // avec la majorité des pages — voir MC13 Addendum, point A3).

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

        // Exposé sur StatisticsPage : réutilisé par statistics-pool-ai.js
        StatisticsPage.renderMarkdownToHtml = renderMarkdownToHtml;
})();
