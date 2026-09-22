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

            const poolInfo = StatisticsPage.poolList.find(p => (p.pool_id || p.poolId || "").toUpperCase() === selectorValue.toUpperCase());
            document.getElementById('pool-ai-analysis-pool-name').textContent = poolInfo ? (poolInfo.full_name || poolInfo.name) : selectorValue;
        }

        const AI_DIVERSITY_MIN_ACTIVE_TALENTS = 5;

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

            const expatPositions = mData.filter(m => (m.candidate_type || m.candidateType) === 'expat').length;
            const nationalPositions = mData.filter(m => (m.candidate_type || m.candidateType) === 'nat').length;

            const positionsByCountry = {};
            mData.forEach(m => {
                const c = CapHumaCountries.getCountryName(m.country_code) || 'Non précisé';
                positionsByCountry[c] = (positionsByCountry[c] || 0) + 1;
            });

            const DESK_LABELS_AI = { desk1: 'Desk 1', desk2: 'Desk 2', desk3: 'Desk 3', suo: 'SUO' };
            const positionsByDesk = {};
            mData.forEach(m => {
                if (!m.desk) return;
                const label = DESK_LABELS_AI[m.desk] || m.desk;
                positionsByDesk[label] = (positionsByDesk[label] || 0) + 1;
            });

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

        function computeActiveTalents(talentsForPool) {
            return talentsForPool.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                const isRed = t.isRedListed || t.is_red_listed;
                return isVal && !isRed;
            });
        }

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

        function computeRedListAndRiskStats(talentsForPool) {
            const redListedCount = talentsForPool.filter(t => t.is_red_listed || t.isRedListed).length;
            const atRiskCount = talentsForPool.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                return isVal && calculateMonthsWithoutMission(t) >= DEVALIDATION_AT_RISK_MONTHS;
            }).length;
            return { redListedCount, atRiskCount };
        }

        function computeDiversityStats(activeTalents) {
            const genderDistribution = { hommes: 0, femmes: 0, nonRenseigne: 0 };
            activeTalents.forEach(t => {
                if (t.gender === 'H') genderDistribution.hommes++;
                else if (t.gender === 'F') genderDistribution.femmes++;
                else genderDistribution.nonRenseigne++;
            });

            const nationalityDistribution = {};
            activeTalents.forEach(t => {
                if (!t.nationality_code) return;
                const label = CapHumaCountries.getNationality(t.nationality_code) || t.nationality_code;
                nationalityDistribution[label] = (nationalityDistribution[label] || 0) + 1;
            });

            const languageDistribution = {};
            activeTalents.forEach(t => {
                const langs = Array.isArray(t.languages) ? t.languages : (t.languages ? [t.languages] : []);
                langs.forEach(lang => {
                    languageDistribution[lang] = (languageDistribution[lang] || 0) + 1;
                });
            });

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

            const talentMatchRate = positionStats.totalPositions > 0
                ? Math.round((availabilityStats.availableSoon / positionStats.totalPositions) * 100)
                : 0;

            const stats = {
                ...positionStats,
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

            // Ne concerne que l'envoi à l'IA : les graphiques de diversité restent affichés quel que soit l'effectif.
            if (activeTalents.length < AI_DIVERSITY_MIN_ACTIVE_TALENTS) {
                delete stats.genderDistribution;
                delete stats.nationalityDistribution;
                delete stats.languageDistribution;
                stats.diversiteNonTransmise = `Effectif actif trop faible (${activeTalents.length}, seuil ${AI_DIVERSITY_MIN_ACTIVE_TALENTS}) : répartitions genre / nationalités / langues volontairement non transmises.`;
            }

            return stats;
        }

        function buildPoolAnalysisPrompt(poolLabel, stats, userQuestion) {
            const question = (userQuestion || '').trim();

            const donnees = `Voici un instantané agrégé et anonymisé du pool "${poolLabel}" ` +
                `(uniquement des comptages, aucune donnée nominative de talent) :\n\n` +
                `${JSON.stringify(stats, null, 2)}`;

            const format = `Réponds en français, en Markdown simple (titres avec ##, ` +
                `listes avec -), sans préambule ni formule de politesse.`;

            if (question) {
                return `Question à traiter en priorité : ${question}\n\n` +
                    `Réponds à cette question en t'appuyant sur les données ci-dessous. ` +
                    `C'est l'objectif principal de ta réponse : n'aborde les autres aspects ` +
                    `du pool que s'ils éclairent réellement la question posée. Structure ta ` +
                    `réponse librement, selon ce que la question appelle.\n\n` +
                    `${donnees}\n\n` +
                    `${format}`;
            }

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

        async function callPoolAiProxy(prompt) {
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
                body: JSON.stringify({ prompt })
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

        StatisticsPage.updatePoolAiAnalysisVisibility = updatePoolAiAnalysisVisibility;
        StatisticsPage.AI_DIVERSITY_MIN_ACTIVE_TALENTS = AI_DIVERSITY_MIN_ACTIVE_TALENTS;
        StatisticsPage.computeActiveTalents = computeActiveTalents;
})();
