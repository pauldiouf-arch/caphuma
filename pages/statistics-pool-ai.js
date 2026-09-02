// Correctif P26 (B13-Q2, Master Context §7) — 3/4 : analyse par IA d'un pool
// précis (construction des stats agrégées, du prompt, appel à l'Edge Function
// ai-proxy). Uniquement cette chaîne — les statistiques de contrats détaillées,
// bien que "par pool" elles aussi, vivent dans statistics-charts.js (aucun lien
// avec l'IA, voir note dans ce dernier fichier). Voir statistics.js (chargé
// AVANT ce fichier) pour l'explication de StatisticsPage.
(() => {
        // ============================================================================
        // ANALYSE IA PAR POOL (Étape E) — reconstruite depuis missions.html. Statistiques
        // agrégées calculées en mémoire (StatisticsPage.rawTalents/StatisticsPage.rawMissions déjà chargés pour tous les
        // pools, filtrage synchrone, pas de requête réseau supplémentaire).
        // ============================================================================
        function updatePoolAiAnalysisVisibility(selectorValue, talentsForPool, mData) {
            const card = document.getElementById('pool-ai-analysis-card');

            if (selectorValue === 'global') {
                card.classList.add('hidden');
                return;
            }
            card.classList.remove('hidden');

            // Changement de pool : on masque toute analyse précédente (celle d'un autre
            // pool) plutôt que de laisser un résultat obsolète visible à l'écran.
            document.getElementById('pool-ai-analysis-content').classList.add('hidden');
            document.getElementById('pool-ai-analysis-content').innerHTML = '';
            document.getElementById('pool-ai-analysis-error').classList.add('hidden');

            const poolInfo = StatisticsPage.poolList.find(p => (p.pool_id || p.poolId || "").toUpperCase() === selectorValue.toUpperCase());
            document.getElementById('pool-ai-analysis-pool-name').textContent = poolInfo ? (poolInfo.full_name || poolInfo.name) : selectorValue;
        }

        // Instantané agrégé et anonymisé (comptages uniquement, aucune donnée
        // nominative) — logique de disponibilité identique à celle d'avant l'Étape E
        // sur missions.html (adaptée de Hercules positions/analytics.ts, getRecommendations),
        // enrichie a posteriori avec d'autres KPI repérés dans Hercules
        // (getRecruitmentAnalytics / getTalentAnalytics) : genre, nationalité, langues,
        // tranches d'expérience, type de candidat, pays/desk des postes, taux
        // d'anticipation (postes avec un futur occupant identifié). Toujours uniquement
        // des comptages agrégés — jamais un nom, un email ou une évaluation individuelle.
        // Seuil d'anonymat pour les données envoyées à l'IA — voir le bloc explicatif
        // en fin de buildPoolAnalysisStats(). En dessous de ce nombre de talents actifs
        // dans le pool, les répartitions genre / nationalités / langues ne sont pas
        // transmises au modèle. Valeur fixée par l'utilisateur le 18/08/2026.
        const AI_DIVERSITY_MIN_ACTIVE_TALENTS = 5;

        // Correctif P27 (B13-Q3, Master Context §7) — buildPoolAnalysisStats()
        // décomposée en une fonction par famille de stats, assemblées dans l'objet
        // `stats` final par l'orchestrateur (buildPoolAnalysisStats elle-même) — même
        // pattern que exportTalentCardPDF()/bindButtonListeners(). `now` et les 3
        // horizons temporels sont calculés une seule fois par l'orchestrateur et
        // transmis en paramètre (au lieu d'un Date.now() par bloc) pour garantir un
        // instantané cohérent entre tous les blocs, comme avant. `activeTalents` est
        // calculé une seule fois (computeActiveTalents) et partagé entre les 2 blocs
        // qui en ont besoin, pour la même raison. Comportement strictement inchangé :
        // mêmes calculs, mêmes clés d'objet, même valeurs.

        // KPIs de postes du pool — cf. Hercules positions/analytics.ts et
        // getRecruitmentAnalytics (candidateTypeDistribution / countryDistribution /
        // deskDistribution / preparationRate).
        function computePositionStats(mData, now, oneMonthLater, threeMonthsLater, sixMonthsLater) {
            const total = mData.length;
            const occupied = mData.filter(m => m.status === 'occupied').length;
            const recruiting = mData.filter(m => m.status === 'recruiting').length;
            const vacant = mData.filter(m => m.status === 'vacant').length;

            const endingWithin = (maxDate) => mData.filter(m => {
                if (!m.contract_end_date) return false;
                const t = new Date(m.contract_end_date).getTime();
                return t > now && t <= maxDate;
            }).length;

            const renewableSoon = mData.filter(m => {
                if (m.contract_status !== 'renewable' || !m.contract_end_date) return false;
                const t = new Date(m.contract_end_date).getTime();
                return t > now && t <= sixMonthsLater;
            }).length;

            // Répartition par type de candidat, pays et desk (postes) — cf. Hercules
            // getRecruitmentAnalytics (candidateTypeDistribution / countryDistribution /
            // deskDistribution), pas encore envoyée à l'IA jusqu'ici.
            const expatPositions = mData.filter(m => (m.candidate_type || m.candidateType) === 'expat').length;
            const nationalPositions = mData.filter(m => (m.candidate_type || m.candidateType) === 'nat').length;

            const positionsByCountry = {};
            mData.forEach(m => {
                const c = m.country || 'Non précisé';
                positionsByCountry[c] = (positionsByCountry[c] || 0) + 1;
            });

            const DESK_LABELS_AI = { desk1: 'Desk 1', desk2: 'Desk 2', desk3: 'Desk 3', suo: 'SUO' };
            const positionsByDesk = {};
            mData.forEach(m => {
                if (!m.desk) return;
                const label = DESK_LABELS_AI[m.desk] || m.desk;
                positionsByDesk[label] = (positionsByDesk[label] || 0) + 1;
            });

            // Taux d'anticipation : proportion de postes pour lesquels un futur occupant
            // est déjà identifié (cf. Hercules getRecruitmentAnalytics, preparationRate).
            const positionsWithFutureTalent = mData.filter(m => !!m.future_talent_id).length;
            const preparationRate = total > 0 ? Math.round((positionsWithFutureTalent / total) * 100) : 0;

            return {
                totalPositions: total,
                occupiedPositions: occupied,
                recruitingPositions: recruiting,
                vacantPositions: vacant,
                endingIn1Month: endingWithin(oneMonthLater),
                endingIn3Months: endingWithin(threeMonthsLater),
                endingIn6Months: endingWithin(sixMonthsLater),
                renewableContractsSoon: renewableSoon,
                candidateTypeDistribution: { expatries: expatPositions, nationaux: nationalPositions },
                positionsByCountry,
                positionsByDesk,
                preparationRatePercent: preparationRate
            };
        }

        // Talents actifs du pool (valides, non Liste Rouge) — base commune aux blocs
        // disponibilité et diversité ci-dessous, calculée une seule fois.
        function computeActiveTalents(talentsForPool) {
            return talentsForPool.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                const isRed = t.isRedListed || t.is_red_listed;
                return isVal && !isRed;
            });
        }

        // Disponibilité des talents actifs — logique inchangée depuis avant l'Étape E
        // (adaptée de Hercules positions/analytics.ts, getRecommendations).
        function computeAvailabilityStats(activeTalents, now, sixMonthsLater) {
            let availableNow = 0, availableSoon = 0, experiencedAvailable = 0, juniorAvailable = 0;

            activeTalents.forEach(t => {
                if (t.status === 'En poste ALIMA') return;

                let availDate = null;
                if (t.availability_type === 'asap') availDate = now;
                else if (t.availability_type === 'date' && t.availability_date) availDate = new Date(t.availability_date).getTime();
                else if (t.availability_type === 'notice' && t.availability_months != null) availDate = now + t.availability_months * 30 * 24 * 60 * 60 * 1000;

                if (availDate !== null && availDate <= now) availableNow++;
                if (availDate !== null && availDate <= sixMonthsLater) {
                    availableSoon++;
                    if ((t.experience_months_alima || 0) >= 12) experiencedAvailable++;
                    if ((t.experience_months_alima || 0) < 6) juniorAvailable++;
                }
            });

            return { availableNow, availableSoon, experiencedAvailable, juniorAvailable };
        }

        // Liste Rouge et risque de dévalidation — sur l'ensemble du pool (pas
        // seulement activeTalents, contrairement aux blocs disponibilité/diversité).
        function computeRedListAndRiskStats(talentsForPool) {
            const redListedCount = talentsForPool.filter(t => t.is_red_listed || t.isRedListed).length;
            const atRiskCount = talentsForPool.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                return isVal && calculateMonthsWithoutMission(t) >= DEVALIDATION_AT_RISK_MONTHS;
            }).length;
            return { redListedCount, atRiskCount };
        }

        // Répartitions genre / nationalité / langue / expérience — comptages agrégés
        // uniquement (cf. décision utilisateur : acceptable à l'échelle moyenne d'un
        // pool ~30 personnes, jamais par individu), cf. Hercules getTalentAnalytics.
        function computeDiversityStats(activeTalents) {
            const genderDistribution = { hommes: 0, femmes: 0, nonRenseigne: 0 };
            activeTalents.forEach(t => {
                if (t.gender === 'H') genderDistribution.hommes++;
                else if (t.gender === 'F') genderDistribution.femmes++;
                else genderDistribution.nonRenseigne++;
            });

            const nationalityDistribution = {};
            activeTalents.forEach(t => {
                if (!t.nationality) return;
                nationalityDistribution[t.nationality] = (nationalityDistribution[t.nationality] || 0) + 1;
            });

            // `languages` est un tableau côté talents.
            const languageDistribution = {};
            activeTalents.forEach(t => {
                const langs = Array.isArray(t.languages) ? t.languages : (t.languages ? [t.languages] : []);
                langs.forEach(lang => {
                    languageDistribution[lang] = (languageDistribution[lang] || 0) + 1;
                });
            });

            // Tranches d'expérience ALIMA — cf. Hercules getTalentAnalytics,
            // experienceDistribution (junior/intermediate/senior/expert).
            const experienceDistribution = { junior: 0, intermediaire: 0, senior: 0, expert: 0 };
            activeTalents.forEach(t => {
                const exp = t.experience_months_alima || 0;
                if (exp < 6) experienceDistribution.junior++;
                else if (exp < 18) experienceDistribution.intermediaire++;
                else if (exp < 36) experienceDistribution.senior++;
                else experienceDistribution.expert++;
            });

            return { genderDistribution, nationalityDistribution, languageDistribution, experienceDistribution };
        }

        function buildPoolAnalysisStats(mData, talentsForPool) {
            const now = Date.now();
            const oneMonthLater = now + 30 * 24 * 60 * 60 * 1000;
            const threeMonthsLater = now + 3 * 30 * 24 * 60 * 60 * 1000;
            const sixMonthsLater = now + 6 * 30 * 24 * 60 * 60 * 1000;

            const positionStats = computePositionStats(mData, now, oneMonthLater, threeMonthsLater, sixMonthsLater);
            const activeTalents = computeActiveTalents(talentsForPool);
            const availabilityStats = computeAvailabilityStats(activeTalents, now, sixMonthsLater);
            const { redListedCount, atRiskCount } = computeRedListAndRiskStats(talentsForPool);
            const { genderDistribution, nationalityDistribution, languageDistribution, experienceDistribution } = computeDiversityStats(activeTalents);

            // Taux d'adéquation talents/postes — cf. Hercules getRecruitmentAnalytics,
            // talentMatchRate (talents disponibles sous 6 mois rapportés au nb de postes).
            const talentMatchRate = positionStats.totalPositions > 0
                ? Math.round((availabilityStats.availableSoon / positionStats.totalPositions) * 100)
                : 0;

            const stats = {
                // Postes
                ...positionStats,

                // Talents
                availableTalentsNow: availabilityStats.availableNow,
                availableTalentsWithin6Months: availabilityStats.availableSoon,
                experiencedAvailableTalents: availabilityStats.experiencedAvailable,
                juniorAvailableTalents: availabilityStats.juniorAvailable,
                redListedTalents: redListedCount,
                talentsAtRiskOfDevalidation: atRiskCount,
                genderDistribution,
                nationalityDistribution,
                languageDistribution,
                experienceDistributionMonthsAlima: experienceDistribution,
                talentMatchRatePercent: talentMatchRate
            };

            // ------------------------------------------------------------------
            // SEUIL D'ANONYMAT (18/08/2026, chantier A2)
            // ------------------------------------------------------------------
            // Sur un pool à très faible effectif, une "répartition" cesse d'être un
            // agrégat : "1 femme, nationalité X" dans un pool de 3 personnes est
            // reconstituable par quiconque connaît l'équipe. En dessous du seuil, ces
            // trois répartitions ne sont donc PAS transmises au modèle d'IA.
            //
            // ⚠️ Ne concerne QUE ce qui part vers l'IA. Les graphiques de diversité
            // (updateDiversityCharts) restent affichés normalement quel que soit
            // l'effectif : ils sont dessinés dans le navigateur de l'utilisateur, aucune
            // donnée ne sort du site. Ne pas "harmoniser" les deux par réflexe.
            //
            // Seuil fixé à 5 par l'utilisateur le 18/08/2026 (règle 16).
            if (activeTalents.length < AI_DIVERSITY_MIN_ACTIVE_TALENTS) {
                delete stats.genderDistribution;
                delete stats.nationalityDistribution;
                delete stats.languageDistribution;
                stats.diversiteNonTransmise = `Effectif actif trop faible (${activeTalents.length}, seuil ${AI_DIVERSITY_MIN_ACTIVE_TALENTS}) : répartitions genre / nationalités / langues volontairement non transmises.`;
            }

            return stats;
        }

        // Chantier A2 (18/08/2026) — la question de l'utilisateur passe désormais EN TÊTE
        // du prompt, formulée comme objectif principal. Avant ce changement, cette
        // fonction ne recevait aucune question et imposait 3 sections fixes : le prompt
        // était donc identique d'un clic à l'autre, et la réponse identique par
        // construction (c'est l'origine du symptôme "l'IA répond toujours la même chose").
        // Sans question saisie, l'ancien comportement est conservé À L'IDENTIQUE.
        function buildPoolAnalysisPrompt(poolLabel, stats, userQuestion) {
            const question = (userQuestion || '').trim();

            const donnees = `Voici un instantané agrégé et anonymisé du pool "${poolLabel}" ` +
                `(uniquement des comptages, aucune donnée nominative de talent) :\n\n` +
                `${JSON.stringify(stats, null, 2)}`;

            const format = `Réponds en français, en Markdown simple (titres avec ##, ` +
                `listes avec -), sans préambule ni formule de politesse.`;

            // Cas 1 — l'utilisateur a posé une question : elle prime sur tout le reste.
            if (question) {
                return `Question à traiter en priorité : ${question}\n\n` +
                    `Réponds à cette question en t'appuyant sur les données ci-dessous. ` +
                    `C'est l'objectif principal de ta réponse : n'aborde les autres aspects ` +
                    `du pool que s'ils éclairent réellement la question posée. Structure ta ` +
                    `réponse librement, selon ce que la question appelle.\n\n` +
                    `${donnees}\n\n` +
                    `${format}`;
            }

            // Cas 2 — aucune question : analyse générale, format inchangé depuis l'origine.
            return `Tu es un(e) analyste RH pour une organisation humanitaire (ALIMA). ` +
                `${donnees}\n\n` +
                `Structure ta réponse en exactement 3 sections avec des titres Markdown ## : ` +
                `"## Analyse des Talents", "## Analyse des Postes", "## Recommandations Stratégiques". ` +
                `Dans "Analyse des Talents", commente si pertinent la diversité du pool ` +
                `(répartition femmes/hommes, nationalités, langues, tranches d'expérience) ` +
                `en plus de la disponibilité et des risques de dévalidation. Dans "Analyse ` +
                `des Postes", commente si pertinent le taux d'anticipation (postes avec un ` +
                `futur occupant déjà identifié) et la répartition géographique/desk, en plus ` +
                `de l'occupation et des contrats. Les deux premières sections font 2 à 4 ` +
                `phrases chacune ; la dernière est une liste à puces de 3 recommandations ` +
                `concrètes et actionnables, classées par priorité. ${format}`;
        }

        // Appel dédié à l'analyse par pool — implémentation séparée de generateAIReport()
        // (Hub global, non modifié) plutôt que factorisée, pour ne prendre aucun risque
        // sur une fonctionnalité déjà jugée satisfaisante par l'utilisateur.
        async function callPoolAiProxy(prompt) {
            const { data: { session } } = await StatisticsPage.supabaseClient.auth.getSession();
            if (!session) {
                // Correctif complémentaire à P10 (28/08/2026) : voir
                // callManageUsers() (admin.js) pour la justification complète.
                window.location.href = 'login.html';
                throw new Error("Session expirée — reconnectez-vous.");
            }

            // ⚠️ Volontairement PAS enveloppé dans capHumaWithRetry() (P19, décision
            // n°15) : ai-proxy est hors périmètre — palier gratuit limité chez le
            // fournisseur d'IA (Dossier de passation §7.14), un retry sur faux négatif
            // réseau doublerait la consommation d'un quota rare pour une fonctionnalité
            // analytique non critique.
            const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': SUPABASE_ANON_KEY
                },
                body: JSON.stringify({ prompt })
            });

            // Correctif P10 (B14-I3, 28/08/2026) : voir callManageUsers()
            // (admin.js) pour la justification complète — un 401/403 ne doit
            // jamais rester un simple message d'erreur affiché dans le panneau
            // d'analyse, l'utilisateur doit être renvoyé se reconnecter.
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
            if (selectorValue === 'global') return; // bouton normalement masqué dans ce cas

            const btn = document.getElementById('pool-ai-analysis-btn');
            const spinner = document.getElementById('pool-ai-analysis-spinner');
            const errorEl = document.getElementById('pool-ai-analysis-error');
            const contentEl = document.getElementById('pool-ai-analysis-content');

            btn.disabled = true;
            spinner.classList.remove('hidden');
            errorEl.classList.add('hidden');
            contentEl.classList.add('hidden');

            try {
                const mData = StatisticsPage.rawMissions.filter(m => {
                    const mPool = (m.pool_id || m.poolId || m.pool || "").toUpperCase();
                    return mPool === selectorValue.toUpperCase();
                });
                const talentsForPool = StatisticsPage.rawTalents.filter(t => (t.pool || "").toUpperCase() === selectorValue.toUpperCase());

                const poolInfo = StatisticsPage.poolList.find(p => (p.pool_id || p.poolId || "").toUpperCase() === selectorValue.toUpperCase());
                const poolLabel = poolInfo ? (poolInfo.full_name || poolInfo.name) : selectorValue;

                const stats = buildPoolAnalysisStats(mData, talentsForPool);
                const questionInput = document.getElementById('pool-ai-question');
                const question = questionInput ? questionInput.value : '';
                const prompt = buildPoolAnalysisPrompt(poolLabel, stats, question);
                const analysis = await callPoolAiProxy(prompt);

                // renderMarkdownToHtml() vit dans statistics-ai-report.js (utilitaire
                // partagé entre les deux fonctionnalités IA de cette page) — appel via
                // StatisticsPage, chargé après ce fichier (voir ordre dans le HTML).
                contentEl.innerHTML = StatisticsPage.renderMarkdownToHtml(analysis);
                contentEl.classList.remove('hidden');
            } catch (error) {
                console.error("Erreur analyse IA du pool :", error);
                errorEl.textContent = "Impossible de générer l'analyse : " + (error && error.message ? error.message : 'erreur inconnue.');
                errorEl.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                spinner.classList.add('hidden');
            }
        });

        // Exposé sur StatisticsPage pour appel depuis statistics-charts.js
        StatisticsPage.updatePoolAiAnalysisVisibility = updatePoolAiAnalysisVisibility;
})();
