        // ============================================================================
        // HEADER COMMUN (B4, Master Context §7) — injecté avant toute autre chose,
        // pour que #user-display-name et #logoutBtn existent dès la suite du script.
        // ============================================================================
        renderPageLayout({
            icon: '📊',
            title: 'Hub Statistique & IA',
            iconGradient: 'from-primary to-primary-dark',
            variant: 'scroll-page'
        });

        const appBody = document.getElementById('appBody');
        let supabaseClient = null;
        let poolList = [];
        let rawTalents = [];
        let rawMissions = [];
        let statusChartInstance = null;
        let expatChartInstance = null;
        let genderChartInstance = null;
        let nationalityChartInstance = null;
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserRole = null;
        let currentUserName = null;

        // Échappement HTML systématique de toute donnée venant de la base avant
        // injection via innerHTML — prévention XSS (Master Context, règle de méthode
        // n°12). Absente jusqu'ici sur cette page faute d'innerHTML utilisant des
        // données de la base ; ajoutée avec les statistiques de contrats (Étape C).

        // SUPABASE_URL / SUPABASE_ANON_KEY viennent désormais de shared/caphuma-config.js
        // (chargé dans le head) — remplace l'ancien pont localStorage (MC13 Addendum U3).
        // La clé IA ne vit plus jamais côté client (ni localStorage, ni variable
        // visible en console) — l'appel passe désormais par la Edge Function
        // sécurisée ai-proxy, qui détient seule la clé côté serveur.

        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }

        // ============================================================================
        // JOURNAL D'AUDIT (Étape 8) — voir id-card.html pour la logique détaillée.
        // Ne bloque jamais l'action métier si l'écriture du log échoue.
        // ============================================================================
        async function logAuditAction(action, entityType, entityId, entityName, details) {
            // Délègue à shared/caphuma-auth.js (fonction commune) — corrige au passage
            // le fait que user_name n'était jamais transmis sur certaines pages.
            const userName = typeof currentUserName !== 'undefined' ? currentUserName : null;
            await capHumaLogAudit(
                supabaseClient,
                { userId: currentUserId, userEmail: currentUserEmail, userName: userName },
                action, entityType, entityId, entityName, details
            );
        }

        async function checkSession() {
            if (!supabaseClient) {
                showError("Configuration Supabase introuvable (shared/caphuma-config.js manquant ou non chargé).");
                return;
            }
            try {
                let s;
                try {
                    s = await capHumaInitSession(supabaseClient);
                } catch (sessionErr) {
                    window.location.replace('login.html');
                    return;
                }

                document.getElementById('user-display-name').textContent = s.email;
                currentUserId = s.userId;
                currentUserEmail = s.email;
                currentUserName = s.name;

                capHumaStartIdleTimeout(supabaseClient);
                currentUserRole = s.role;
                appBody.style.display = '';
                await initHub();
            } catch (e) {
                console.error(e);
                showError("Erreur d'authentification ou problème réseau.");
            }
        }

        // showError() retirée d'ici : vient désormais de shared/caphuma-utils.js.
        // ⚠️ Petit changement : fait maintenant remonter la page en haut en plus
        // d'afficher la bannière (harmonisé avec id-card.html — MC13 Addendum A3).

        async function initHub() {
            try {
                // 1. Récupération des pools de la base (pools.pool_id)
                const { data: pools, error: ep } = await supabaseClient.from('pools').select('pool_id, name, full_name');
                if (ep) throw ep;
                poolList = pools || [];

                // Remplir le sélecteur avec la clé pool_id du Master Context
                const selector = document.getElementById('pool-selector');
                poolList.forEach(p => {
                    const pCode = p.pool_id || p.poolId; // pool_id selon le schéma réel de la section 5
                    const opt = document.createElement('option');
                    opt.value = pCode;
                    opt.textContent = `${pCode} - ${p.full_name || p.fullName || p.name}`;
                    selector.appendChild(opt);
                });

                // 2. Charger les collections de base
                await loadRawData();

                // 3. Détecter le paramètre d'URL (dashboard.html envoie ?pool=ID)
                const urlParams = new URLSearchParams(window.location.search);
                const queryPool = urlParams.get('pool') || urlParams.get('pool_id');
                
                if (queryPool) {
                    const normalizedQuery = queryPool.trim().toUpperCase();
                    const matchedPool = poolList.find(p => {
                        const code = (p.pool_id || p.poolId || p.name || "").toUpperCase();
                        return code === normalizedQuery;
                    });
                    if (matchedPool) {
                        selector.value = matchedPool.pool_id || matchedPool.poolId;
                    }
                }

                // 4. Calculer et afficher
                updateStatistics();

                // Listener de changement du sélecteur
                selector.addEventListener('change', () => {
                    updateStatistics();
                });

            } catch (e) {
                console.error(e);
                showError("Échec du chargement des indicateurs analytiques.");
            }
        }

        async function loadRawData() {
            // ⚡ Optimisation (grep exhaustif du fichier pour vérifier que chaque colonne
            // ci-dessous est bien lue quelque part sur cette page avant de la retirer/garder) :
            // - talents : liste inchangée sauf `experience_months_humanitarian`, retirée
            //   car jamais utilisée nulle part dans ce fichier (vérifié par grep).
            // - missions : passage de select('*') à une liste explicite des colonnes
            //   réellement utilisées (KPIs, 4 graphiques, stats détaillées de contrats,
            //   analyse IA globale et par pool). `candidate_type` confirmé présent en
            //   base (vérifié en direct avant ce changement, cf. information_schema) —
            //   la détection "colonne absente vs vide" plus bas (hasCandidateTypeColumn)
            //   continue donc de fonctionner à l'identique.
            const { data: talents, error: et } = await supabaseClient
                .from('talents')
                .select('pool, status, is_valid, is_red_listed, is_currently_on_mission, last_mission_end_date, months_without_mission, pool_integration_date, experience_months_alima, availability_type, availability_date, availability_months, gender, nationality, languages');
            if (et) throw et;
            rawTalents = talents || [];

            const { data: mData, error: em } = await supabaseClient
                .from('missions')
                .select('pool, pool_id, status, candidate_type, contract_start_date, contract_end_date, contract_status, country, desk, future_talent_id');
            if (em) throw em;
            rawMissions = mData || [];
        }

        // calculateMonthsWithoutMission() a été retirée d'ici : elle vient désormais
        // de shared/caphuma-utils.js (chargé ligne 23), qui est l'unique source pour
        // les 3 pages concernées (bug 55, MC13 Addendum §2 U1). Comportement
        // strictement identique — cette page utilisait déjà la méthode calendaire.

        function updateStatistics() {
            const selectorValue = document.getElementById('pool-selector').value;
            
            let talents = [...rawTalents];
            let mData = [...rawMissions];

            // Application des colonnes réelles (pool pour talents, pool_id pour missions)
            if (selectorValue !== 'global') {
                talents = talents.filter(t => (t.pool || "").toUpperCase() === selectorValue.toUpperCase());
                mData = mData.filter(m => {
                    const mPool = (m.pool_id || m.poolId || m.pool || "").toUpperCase();
                    return mPool === selectorValue.toUpperCase();
                });
            }

            // Calculs KPIs
            const totalPositions = mData.length;
            const occupiedPositions = mData.filter(m => m.status === 'occupied').length;
            const vacantPositions = mData.filter(m => m.status === 'vacant').length;
            const recruitingPositions = mData.filter(m => m.status === 'recruiting').length;

            const occupancyRate = totalPositions > 0 ? Math.round((occupiedPositions / totalPositions) * 100) : 0;
            const activeTalents = talents.filter(t => t.isValid !== false && t.is_valid !== false).length;
            
            const availableTalents = talents.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                const isRed = t.isRedListed || t.is_red_listed;
                return isVal && !isRed && t.status === 'En attente de poste';
            }).length;

            const talentsAtRisk = talents.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                return isVal && calculateMonthsWithoutMission(t) >= DEVALIDATION_AT_RISK_MONTHS;
            }).length;

            // Remplissage DOM
            document.getElementById('kpi-occupancy-rate').textContent = `${occupancyRate}%`;
            document.getElementById('kpi-occupancy-sub').textContent = `${occupiedPositions} de ${totalPositions} postes occupés`;
            document.getElementById('kpi-vacancies').textContent = vacantPositions;
            document.getElementById('kpi-vacancies-sub').textContent = `Recrutements en cours : ${recruitingPositions}`;
            document.getElementById('kpi-talents-active').textContent = activeTalents;
            document.getElementById('kpi-talents-sub').textContent = `Disponibles : ${availableTalents}`;
            document.getElementById('kpi-talents-risk').textContent = talentsAtRisk;

            // Rendu graphiques
            renderStatusChart([occupiedPositions, recruitingPositions, vacantPositions]);

            // La colonne candidate_type n'est pas confirmée dans le schéma réel de
            // `missions` (section 5 du Master Context). On distingue donc "colonne
            // absente" (aucun poste n'a la clé, quelle que soit sa casse) de
            // "colonne présente mais vide", pour ne jamais afficher un graphique
            // silencieusement faux (100% "Non défini" sans avertissement).
            const hasCandidateTypeColumn = mData.some(m => 'candidate_type' in m || 'candidateType' in m);

            if (!hasCandidateTypeColumn) {
                document.getElementById('expatChart').classList.add('hidden');
                document.getElementById('expatChartEmptyState').classList.remove('hidden');
                if (expatChartInstance) {
                    expatChartInstance.destroy();
                    expatChartInstance = null;
                }
            } else {
                document.getElementById('expatChart').classList.remove('hidden');
                document.getElementById('expatChartEmptyState').classList.add('hidden');
                const expatCount = mData.filter(m => (m.candidate_type || m.candidateType) === 'expat').length;
                const nationalCount = mData.filter(m => (m.candidate_type || m.candidateType) === 'nat').length;
                const unclassifiedCount = totalPositions - (expatCount + nationalCount);
                renderExpatChart([expatCount, nationalCount, unclassifiedCount]);
            }

            // Graphiques de diversité (genre / nationalité) — cf. section 3.4 de la
            // présentation générale. Calculés sur les "talents actifs" (valides, non
            // Liste Rouge) uniquement, comme buildPoolAnalysisStats() plus bas, pour que
            // le graphique et le texte de l'analyse IA du même pool racontent toujours la
            // même chose. `talents` est déjà filtré par pool/global en tête de fonction.
            const activeTalentsForDiversity = talents.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                const isRed = t.isRedListed || t.is_red_listed;
                return isVal && !isRed;
            });
            updateDiversityCharts(activeTalentsForDiversity);

            updateDetailedContractStats(selectorValue, mData);
            updatePoolAiAnalysisVisibility(selectorValue, talents, mData);
        }

        // ============================================================================
        // ANALYSE IA PAR POOL (Étape E) — reconstruite depuis missions.html. Statistiques
        // agrégées calculées en mémoire (rawTalents/rawMissions déjà chargés pour tous les
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

            const poolInfo = poolList.find(p => (p.pool_id || p.poolId || "").toUpperCase() === selectorValue.toUpperCase());
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

        function buildPoolAnalysisStats(mData, talentsForPool) {
            const now = Date.now();
            const oneMonthLater = now + 30 * 24 * 60 * 60 * 1000;
            const threeMonthsLater = now + 3 * 30 * 24 * 60 * 60 * 1000;
            const sixMonthsLater = now + 6 * 30 * 24 * 60 * 60 * 1000;

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

            let availableNow = 0, availableSoon = 0, experiencedAvailable = 0, juniorAvailable = 0;
            const activeTalents = talentsForPool.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                const isRed = t.isRedListed || t.is_red_listed;
                return isVal && !isRed;
            });

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

            const redListedCount = talentsForPool.filter(t => t.is_red_listed || t.isRedListed).length;
            const atRiskCount = talentsForPool.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                return isVal && calculateMonthsWithoutMission(t) >= DEVALIDATION_AT_RISK_MONTHS;
            }).length;

            // Répartition Homme/Femme — comptage agrégé uniquement (cf. décision utilisateur :
            // acceptable à l'échelle moyenne d'un pool ~30 personnes, jamais par individu).
            const genderDistribution = { hommes: 0, femmes: 0, nonRenseigne: 0 };
            activeTalents.forEach(t => {
                if (t.gender === 'H') genderDistribution.hommes++;
                else if (t.gender === 'F') genderDistribution.femmes++;
                else genderDistribution.nonRenseigne++;
            });

            // Répartition par nationalité — comptage agrégé (cf. Hercules getTalentAnalytics,
            // nationalityDistribution).
            const nationalityDistribution = {};
            activeTalents.forEach(t => {
                if (!t.nationality) return;
                nationalityDistribution[t.nationality] = (nationalityDistribution[t.nationality] || 0) + 1;
            });

            // Répartition par langue parlée — comptage agrégé (cf. Hercules getTalentAnalytics,
            // languageDistribution). `languages` est un tableau côté talents.
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

            // Taux d'adéquation talents/postes — cf. Hercules getRecruitmentAnalytics,
            // talentMatchRate (talents disponibles sous 6 mois rapportés au nb de postes).
            const talentMatchRate = total > 0 ? Math.round((availableSoon / total) * 100) : 0;

            const stats = {
                // Postes
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
                preparationRatePercent: preparationRate,

                // Talents
                availableTalentsNow: availableNow,
                availableTalentsWithin6Months: availableSoon,
                experiencedAvailableTalents: experiencedAvailable,
                juniorAvailableTalents: juniorAvailable,
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
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) {
                // Correctif complémentaire à P10 (28/08/2026) : voir
                // callManageUsers() (admin.js) pour la justification complète.
                window.location.href = 'login.html';
                throw new Error("Session expirée — reconnectez-vous.");
            }

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
                await supabaseClient.auth.signOut();
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
                const mData = rawMissions.filter(m => {
                    const mPool = (m.pool_id || m.poolId || m.pool || "").toUpperCase();
                    return mPool === selectorValue.toUpperCase();
                });
                const talentsForPool = rawTalents.filter(t => (t.pool || "").toUpperCase() === selectorValue.toUpperCase());

                const poolInfo = poolList.find(p => (p.pool_id || p.poolId || "").toUpperCase() === selectorValue.toUpperCase());
                const poolLabel = poolInfo ? (poolInfo.full_name || poolInfo.name) : selectorValue;

                const stats = buildPoolAnalysisStats(mData, talentsForPool);
                const questionInput = document.getElementById('pool-ai-question');
                const question = questionInput ? questionInput.value : '';
                const prompt = buildPoolAnalysisPrompt(poolLabel, stats, question);
                const analysis = await callPoolAiProxy(prompt);

                contentEl.innerHTML = renderMarkdownToHtml(analysis);
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

        // ============================================================================
        // STATISTIQUES DÉTAILLÉES DES CONTRATS PAR POOL (Étape C, cf. Hercules
        // positions/stats.ts : getDetailedPositionStats). N'apparaît jamais sur la vue
        // globale — seulement quand un pool précis est sélectionné, pour ne pas toucher
        // au Hub Statistique global (décision explicite de l'utilisateur, Étape E).
        // ============================================================================
        function updateDetailedContractStats(selectorValue, mData) {
            const card = document.getElementById('detailed-stats-card');

            if (selectorValue === 'global' || mData.length === 0) {
                card.classList.add('hidden');
                return;
            }
            card.classList.remove('hidden');

            const poolInfo = poolList.find(p => (p.pool_id || p.poolId || "").toUpperCase() === selectorValue.toUpperCase());
            document.getElementById('detailed-stats-pool-name').textContent = poolInfo ? (poolInfo.full_name || poolInfo.name) : selectorValue;

            const now = Date.now();
            const oneMonthLater = now + 30 * 24 * 60 * 60 * 1000;
            const threeMonthsLater = now + 3 * 30 * 24 * 60 * 60 * 1000;
            const sixMonthsLater = now + 6 * 30 * 24 * 60 * 60 * 1000;

            const withContracts = mData.filter(m => m.contract_start_date && m.contract_end_date);
            const durations = withContracts.map(m => {
                const start = new Date(m.contract_start_date).getTime();
                const end = new Date(m.contract_end_date).getTime();
                return Math.round((end - start) / (1000 * 60 * 60 * 24 * 30));
            });
            const avgDuration = durations.length > 0
                ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
                : 0;

            const ongoing = mData.filter(m => m.contract_status === 'ongoing').length;
            const renewable = mData.filter(m => m.contract_status === 'renewable').length;
            const renewalRate = withContracts.length > 0
                ? Math.round((renewable / withContracts.length) * 100)
                : 0;

            // Échéances cumulatives (identique à la logique de missions.html/Hercules :
            // "fin dans 3 mois" inclut ce qui finit dans le mois qui vient).
            const endsWithin = (maxDate) => mData.filter(m => {
                if (!m.contract_end_date) return false;
                const t = new Date(m.contract_end_date).getTime();
                return t > now && t <= maxDate;
            }).length;

            document.getElementById('stat-with-contracts').textContent = withContracts.length;
            document.getElementById('stat-avg-duration').textContent = avgDuration + ' mois';
            document.getElementById('stat-ongoing').textContent = ongoing;
            document.getElementById('stat-renewable').textContent = renewable;
            document.getElementById('stat-renewal-rate').textContent = renewalRate + '%';
            document.getElementById('stat-ending-1m').textContent = endsWithin(oneMonthLater);
            document.getElementById('stat-ending-3m').textContent = endsWithin(threeMonthsLater);
            document.getElementById('stat-ending-6m').textContent = endsWithin(sixMonthsLater);

            // Répartition par pays
            const byCountry = {};
            mData.forEach(m => {
                const c = m.country || 'Non précisé';
                byCountry[c] = (byCountry[c] || 0) + 1;
            });
            document.getElementById('stat-by-country').innerHTML = Object.entries(byCountry)
                .sort((a, b) => b[1] - a[1])
                .map(([country, count]) => `
                    <div class="flex justify-between"><span class="text-slate-400">${escapeHtml(country)}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('');

            // Répartition par desk (ajouté par rapport à Hercules — donnée déjà tracée
            // dans Cap Huma, jugée utile en complément du pays)
            const DESK_LABELS_LOCAL = { desk1: 'Desk 1', desk2: 'Desk 2', desk3: 'Desk 3', suo: 'SUO' };
            const byDesk = {};
            mData.forEach(m => {
                if (!m.desk) return;
                const label = DESK_LABELS_LOCAL[m.desk] || m.desk;
                byDesk[label] = (byDesk[label] || 0) + 1;
            });
            const deskEntries = Object.entries(byDesk);
            document.getElementById('stat-by-desk').innerHTML = deskEntries.length > 0
                ? deskEntries.sort((a, b) => b[1] - a[1]).map(([label, count]) => `
                    <div class="flex justify-between"><span class="text-slate-400">${escapeHtml(label)}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('')
                : '<p class="text-xs text-slate-400 italic">Aucun desk renseigné</p>';

            // Distribution des durées de contrat (tranches identiques à Hercules)
            const distribution = {
                '0-6 mois': durations.filter(d => d <= 6).length,
                '7-12 mois': durations.filter(d => d > 6 && d <= 12).length,
                '13-18 mois': durations.filter(d => d > 12 && d <= 18).length,
                '19-24 mois': durations.filter(d => d > 18 && d <= 24).length,
                '25+ mois': durations.filter(d => d > 24).length,
            };
            document.getElementById('stat-duration-distribution').innerHTML = Object.entries(distribution)
                .map(([range, count]) => `
                    <div class="flex justify-between"><span class="text-slate-400">${range}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('');
        }

        function renderStatusChart(dataValues) {
            if (statusChartInstance) statusChartInstance.destroy();
            const ctx = document.getElementById('statusChart').getContext('2d');
            statusChartInstance = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Occupé', 'En recrutement', 'Vacant'],
                    datasets: [{
                        data: dataValues,
                        backgroundColor: ['#10b981', '#ea580c', '#94a3b8'],
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        }

        function renderExpatChart(dataValues) {
            if (expatChartInstance) expatChartInstance.destroy();
            const ctx = document.getElementById('expatChart').getContext('2d');
            expatChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['Expatrié', 'Staff national', 'Non défini'],
                    datasets: [{
                        label: 'Postes',
                        data: dataValues,
                        backgroundColor: ['#1d4ed8', '#10b981', '#cbd5e1'],
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
                }
            });
        }

        // ============================================================================
        // GRAPHIQUES DE DIVERSITÉ (genre / nationalité) — comptages agrégés uniquement,
        // jamais une ligne "talent par talent" affichée : cohérent avec le choix déjà
        // fait pour l'analyse IA (buildPoolAnalysisStats, genderDistribution /
        // nationalityDistribution) et avec la décision utilisateur de ne jamais exposer
        // de donnée nominative sur cette page.
        // ============================================================================
        const NATIONALITY_CHART_TOP_N = 8;

        function updateDiversityCharts(activeTalents) {
            if (activeTalents.length === 0) {
                document.getElementById('genderChart').classList.add('hidden');
                document.getElementById('genderChartEmptyState').classList.remove('hidden');
                if (genderChartInstance) { genderChartInstance.destroy(); genderChartInstance = null; }

                document.getElementById('nationalityChart').classList.add('hidden');
                document.getElementById('nationalityChartEmptyState').classList.remove('hidden');
                if (nationalityChartInstance) { nationalityChartInstance.destroy(); nationalityChartInstance = null; }
                return;
            }

            document.getElementById('genderChart').classList.remove('hidden');
            document.getElementById('genderChartEmptyState').classList.add('hidden');
            document.getElementById('nationalityChart').classList.remove('hidden');
            document.getElementById('nationalityChartEmptyState').classList.add('hidden');

            // Genre — mêmes 3 catégories que buildPoolAnalysisStats (H / F / non renseigné),
            // 'gender' ne portant que ces valeurs dans le schéma réel (§4.2 du dossier de
            // passation technique).
            const genderDist = { hommes: 0, femmes: 0, nonRenseigne: 0 };
            activeTalents.forEach(t => {
                if (t.gender === 'H') genderDist.hommes++;
                else if (t.gender === 'F') genderDist.femmes++;
                else genderDist.nonRenseigne++;
            });
            renderGenderChart(genderDist);

            // Nationalité — pas de nombre de valeurs distinctes borné (texte libre en base),
            // donc jamais un camembert/une barre par nationalité sans limite : on garde les
            // NATIONALITY_CHART_TOP_N plus représentées et on regroupe le reste sous "Autres",
            // plus un bucket "Non renseigné" séparé et explicite (jamais fondu silencieusement
            // dans une autre catégorie).
            const counts = {};
            let nonRenseigne = 0;
            activeTalents.forEach(t => {
                if (!t.nationality) { nonRenseigne++; return; }
                counts[t.nationality] = (counts[t.nationality] || 0) + 1;
            });
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            const top = sorted.slice(0, NATIONALITY_CHART_TOP_N);
            const othersTotal = sorted.slice(NATIONALITY_CHART_TOP_N).reduce((sum, [, c]) => sum + c, 0);
            renderNationalityChart(top, othersTotal, nonRenseigne);

            const subEl = document.getElementById('nationalityChartSub');
            subEl.textContent = sorted.length > NATIONALITY_CHART_TOP_N
                ? `Top ${NATIONALITY_CHART_TOP_N} nationalités du pool (${sorted.length - NATIONALITY_CHART_TOP_N} autres regroupées sous « Autres »)`
                : 'Nationalités du pool';
        }

        function renderGenderChart(dist) {
            if (genderChartInstance) genderChartInstance.destroy();
            const ctx = document.getElementById('genderChart').getContext('2d');
            genderChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Femmes', 'Hommes', 'Non renseigné'],
                    datasets: [{
                        data: [dist.femmes, dist.hommes, dist.nonRenseigne],
                        backgroundColor: ['#ea580c', '#1d4ed8', '#cbd5e1'],
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        }

        function renderNationalityChart(topEntries, othersTotal, nonRenseigne) {
            if (nationalityChartInstance) nationalityChartInstance.destroy();
            const ctx = document.getElementById('nationalityChart').getContext('2d');

            const labels = topEntries.map(([nat]) => nat);
            const values = topEntries.map(([, count]) => count);
            if (othersTotal > 0) { labels.push('Autres'); values.push(othersTotal); }
            if (nonRenseigne > 0) { labels.push('Non renseigné'); values.push(nonRenseigne); }

            nationalityChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    // Pas d'escapeHtml() ici : Chart.js dessine le texte directement sur un
                    // <canvas> (pas d'innerHTML), donc aucun risque XSS — et escapeHtml()
                    // afficherait à tort des entités littérales (ex. "Côte d&#039;Ivoire").
                    labels: labels,
                    datasets: [{
                        label: 'Talents',
                        data: values,
                        backgroundColor: labels.map(l => (l === 'Autres' || l === 'Non renseigné') ? '#cbd5e1' : '#1d4ed8'),
                        borderRadius: 6
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
                }
            });
        }

        function buildAnonymizedPayload() {
            const selectorValue = document.getElementById('pool-selector').value;
            
            let talents = [...rawTalents];
            let mData = [...rawMissions];

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
                const poolsVentiles = poolList.map(p => {
                    const code = (p.pool_id || p.poolId || '').toUpperCase();
                    if (!code) return null;

                    const tPool = rawTalents.filter(t => (t.pool || '').toUpperCase() === code);
                    const mPool = rawMissions.filter(m => {
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
                const { data: { session } } = await supabaseClient.auth.getSession();
                if (!session) {
                    // Correctif complémentaire à P10 (28/08/2026) : voir
                    // callManageUsers() (admin.js) pour la justification complète.
                    window.location.href = 'login.html';
                    return;
                }

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
                    await supabaseClient.auth.signOut();
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

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            if (supabaseClient) await supabaseClient.auth.signOut();
            window.location.replace('login.html');
        });

        window.addEventListener('DOMContentLoaded', () => checkSession());
