// Correctif P23 (B13-Q1, Master Context §7) : script enveloppé dans une IIFE
// anonyme pour isoler sa portée — élimine tout risque qu'une déclaration
// top-level de cette page masque silencieusement une fonction/variable
// partagée (shared/caphuma-*.js) chargée avant elle, ou soit elle-même
// masquée par une autre page à l'avenir. Aucun changement de comportement :
// refactoring pur (règle de méthode citée en Master Context §0).
(() => {
        // ============================================================================
        // HEADER COMMUN (B4, Master Context §7) — injecté avant toute autre chose, y
        // compris avant les document.getElementById('pageTitle'/'userSubtitle'/
        // 'navTalents') ci-dessous, puisqu'ils font partie du header injecté.
        // pageTitle et userSubtitle gardent un id pour rester réécrivables en JS une
        // fois le pool chargé (ligne ~154 plus bas, comportement inchangé).
        // ============================================================================
        renderPageLayout({
            icon: '💼',
            title: 'Postes',
            titleId: 'pageTitle',
            subtitle: 'Gestion des postes',
            subtitleId: 'userSubtitle',
            actionsHtml: `
                <a href="#" id="navTalents" class="border border-blue-200 hover:bg-blue-50 text-primary px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    👤 Professionnels du pool
                </a>
                <a href="#" id="navPoolStats" class="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    📊 Statistiques &amp; analyse IA
                </a>
            `
        });

        // ============================================================================
        // 1. INITIALISATION SUPABASE (lecture dynamique localStorage, jamais en dur)
        // ============================================================================
        // SUPABASE_URL / SUPABASE_ANON_KEY viennent désormais de shared/caphuma-config.js
        // (chargé dans le head) — remplace l'ancien pont localStorage (MC13 Addendum U3).

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            window.location.replace('index.html');
        }

        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const appBody = document.getElementById('appBody');
        const userSubtitle = document.getElementById('userSubtitle');
        const pageTitle = document.getElementById('pageTitle');
        const poolHeading = document.getElementById('poolHeading');
        const poolSubheading = document.getElementById('poolSubheading');
        const navTalents = document.getElementById('navTalents');
        const missionsGrid = document.getElementById('missionsGrid');
        const missionsError = document.getElementById('missionsError');
        const missionsEmpty = document.getElementById('missionsEmpty');
        const readOnlyNotice = document.getElementById('readOnlyNotice');
        const createMissionBtn = document.getElementById('createMissionBtn');
        const kpiBar = document.getElementById('kpiBar');

        // Échappement HTML systématique de toute donnée venant de la base
        // avant injection via innerHTML — prévention XSS (audit sécurité, cf. Master Context section 7).

        // toastMessage() retirée d'ici : vient désormais de shared/caphuma-utils.js.
        // ⚠️ Changement de mécanisme : cette page réutilisait un <div id="toast">
        // statique (toujours présent dans le HTML, désormais inutilisé mais
        // inoffensif) ; la version partagée crée son propre élément à chaque
        // appel, comme les 5 autres pages (voir MC13 Addendum, point A3).

        // Récupération du pool depuis l'URL (ex. missions.html?pool=COLOG)
        const urlParams = new URLSearchParams(window.location.search);
        const currentPoolId = (urlParams.get('pool') || urlParams.get('pool_id') || '').toUpperCase();

        if (!currentPoolId) {
            poolSubheading.textContent = "Aucun pool sélectionné — retournez au tableau de bord.";
            missionsError.textContent = "Aucun pool indiqué dans l'URL. Accédez à cette page depuis le bouton « Postes » d'un pool sur le tableau de bord.";
            missionsError.classList.remove('hidden');
        }

        navTalents.href = 'talents.html?pool=' + encodeURIComponent(currentPoolId);
        // L'analyse IA de ce pool a été déplacée sur statistics.html (Étape E) — lien
        // de redirection pour les habitués de l'ancien bouton "Analyser ce pool".
        document.getElementById('navPoolStats').href = 'statistics.html?pool=' + encodeURIComponent(currentPoolId);

        // État en mémoire
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserRole = null;
        let currentUserName = null;
        let currentMissions = [];
        let missionsPage = 1;
        const MISSIONS_PAGE_SIZE = 12;
        // ⚡ Optimisation : liste explicite des colonnes de "missions" réellement utilisées
        // dans ce fichier (vérifiée par grep exhaustif sur tout le fichier), utilisée à la
        // place de select('*') aux 2 endroits qui chargent la liste complète du pool
        // (loadMissions() + rafraîchissement après rotation automatique dans
        // processExpiredMissions()). Centralisée ici pour que les deux endroits restent
        // toujours synchronisés — si un jour un champ manque après l'ajout d'une nouvelle
        // fonctionnalité, il suffit de l'ajouter ICI, aux deux requêtes à la fois.
        const MISSIONS_COLUMNS = 'id, title, pool, pool_level, status, country, location, project_name, candidate_type, desk, occupant_id, contract_start_date, contract_end_date, contract_status, future_talent_id, future_contract_start_date, future_contract_end_date';
        let poolTalents = []; // talents du pool, pour les listes déroulantes occupant / futur occupant
        let talentNameById = {};

        // ============================================================================
        // JOURNAL D'AUDIT (Étape 8) — voir id-card.html pour la logique détaillée.
        // Ne bloque jamais l'action métier si l'écriture du log échoue. Volontairement
        // pas d'instrumentation sur les évaluations individuelles (create/update/delete) :
        // trop bruyant pour peu de valeur RGPD, seules les actions sur les postes
        // eux-mêmes sont tracées ici.
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

        // Libellés d'affichage des valeurs stockées (jamais de valeur brute affichée à l'utilisateur)
        // STATUS_LABELS, DESK_LABELS, CANDIDATE_TYPE_LABELS, CONTRACT_STATUS_LABELS
        // sont désormais fournis par shared/caphuma-utils.js (valeurs identiques).
        const POOL_LEVEL_LABELS = { mission: 'Mission', project: 'Projet' };

        // ============================================================================
        // 2. GARDE DE SESSION (identique au pattern de dashboard.html)
        // ============================================================================
        async function checkSession() {
            try {
                const s = await capHumaInitSession(supabaseClient);

                currentUserId = s.userId;
                currentUserEmail = s.email;
                currentUserName = s.name;

                capHumaStartIdleTimeout(supabaseClient);
                document.getElementById('user-display-name').textContent = currentUserEmail;

                currentUserRole = s.role;
                userSubtitle.textContent = s.role ? `Connecté en tant que ${s.role}` : 'Gestion des postes';

                // Édition réservée à admin + user (recruteur) ; visitor en lecture seule.
                if (currentUserRole === 'admin' || currentUserRole === 'user') {
                    createMissionBtn.classList.remove('hidden');
                } else {
                    readOnlyNotice.classList.remove('hidden');
                }

                appBody.style.display = '';

                if (currentPoolId) {
                    await loadPoolInfo();
                    await loadPoolTalents();
                    await loadMissions();
                }

            } catch (error) {
                console.warn("[Session Guard] Accès refusé, expulsion :", error.message);
                try {
                    await supabaseClient.auth.signOut();
                } catch (logoutErr) {}
                window.location.replace('login.html');
            }
        }

        checkSession();
        capHumaInitModalA11y(); // P15 (B18-A3) — voir shared/caphuma-utils.js

        document.getElementById('logoutBtn').addEventListener('click', async function () {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            await supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });

        // ============================================================================
        // 3. CHARGEMENT DU POOL, DES TALENTS DU POOL, ET DES POSTES
        // ============================================================================
        async function loadPoolInfo() {
            try {
                const { data: pool, error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('pools')
                        .select('pool_id, name, full_name')
                        .eq('pool_id', currentPoolId)
                        .maybeSingle()
                );

                if (error) throw error;

                const displayName = pool ? (pool.full_name || pool.name || currentPoolId) : currentPoolId;
                pageTitle.textContent = 'Postes — ' + displayName;
                poolHeading.textContent = 'Postes du pool ' + displayName;
                poolSubheading.textContent = 'Liste des postes rattachés à ce pool.';

            } catch (error) {
                console.error("Erreur de récupération du pool :", error);
                poolHeading.textContent = 'Postes du pool ' + currentPoolId;
                poolSubheading.textContent = 'Liste des postes rattachés à ce pool.';
            }
        }

        async function loadPoolTalents() {
            try {
                // Colonnes strictement nécessaires (règle perf Master Context section 2 bis.2)
                const { data: talents, error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('talents')
                        .select('id, first_name, last_name, pool')
                        .eq('pool', currentPoolId)
                        .order('last_name', { ascending: true })
                );

                if (error) throw error;

                poolTalents = talents || [];
                talentNameById = {};
                poolTalents.forEach(t => {
                    talentNameById[t.id] = `${t.first_name || ''} ${t.last_name || ''}`.trim();
                });

                populateTalentDropdown('fieldOccupant', poolTalents);
                populateTalentDropdown('fieldFutureOccupant', poolTalents);

            } catch (error) {
                console.error("Erreur de récupération des talents du pool :", error);
            }
        }

        function populateTalentDropdown(selectId, talents) {
            const select = document.getElementById(selectId);
            const currentValue = select.value;
            select.innerHTML = '<option value="">— Aucun —</option>';
            talents.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${t.first_name || ''} ${t.last_name || ''}`.trim();
                select.appendChild(opt);
            });
            select.value = currentValue;
        }

        async function loadMissions() {
            try {
                missionsError.classList.add('hidden');

                // ⚡ Optimisation : liste explicite de colonnes (MISSIONS_COLUMNS ci-dessus)
                // au lieu de select('*') — la modale d'édition continue de se remplir
                // directement depuis cette liste (même logique qu'avant), juste avec
                // uniquement les colonnes qu'elle utilise réellement.
                const { data: missions, error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('missions')
                        .select(MISSIONS_COLUMNS)
                        .eq('pool', currentPoolId)
                        .order('title', { ascending: true })
                );

                if (error) throw error;

                currentMissions = missions || [];
                missionsPage = 1;

                // Contrats expirés avec statut confirmé "Se termine" : traitement
                // automatique. Les autres restent occupés, signalés visuellement dans
                // renderMissions() (garde-fou explicite demandé par l'utilisateur).
                if (currentUserRole === 'admin' || currentUserRole === 'user') {
                    await processExpiredMissions();
                }

                renderMissions();
                updateKpiBar();
                updateDetailedContractStats();

            } catch (error) {
                console.error("Erreur de récupération des postes :", error);
                missionsGrid.innerHTML = '';
                missionsError.textContent = "Impossible de charger les postes de ce pool depuis Supabase.";
                missionsError.classList.remove('hidden');
            }
        }

        // ============================================================================
        // 3 BIS. TRAITEMENT AUTOMATIQUE DES CONTRATS EXPIRÉS (nouveau)
        // ============================================================================
        // Un contrat expiré (contract_end_date dépassée) ne signifie pas forcément que
        // le talent est réellement sorti — il peut avoir été renouvelé sans que
        // l'information soit encore saisie. Décision explicite de l'utilisateur,
        // par analogie avec la règle "jamais de dévalidation automatique" :
        //   - contract_status === 'ending' (confirmé "Se termine") → sortie automatique
        //     (archivage), PUIS :
        //       • si un futur occupant est déjà identifié (future_talent_id) → rotation
        //         automatique : il devient l'occupant, avec son propre contrat (dates
        //         future_contract_start_date/end_date déjà saisies à l'avance) — point
        //         ouvert historique du Master Context ("rotation automatique du futur
        //         occupant"), jamais construit jusqu'ici, cf. Hercules
        //         positions/mutations.ts : processExpiredContracts.
        //       • sinon → poste vacant (comportement inchangé).
        //   - tout autre cas (ongoing/renewable/non précisé) → aucune écriture
        //     automatique, seulement un signalement visuel (badge rouge) dans
        //     renderMissions(), à charge de l'utilisateur de mettre à jour manuellement.
        //
        // Écart assumé par rapport à Hercules : le contract_status du poste est
        // explicitement remis à null lors d'une rotation (plutôt que silencieusement
        // hérité de l'ancien contrat, ce qui afficherait "Se termine" sur un contrat qui
        // vient de démarrer) — cohérent avec la philosophie du site : toute confirmation
        // de statut de contrat reste une décision humaine.
        async function processExpiredMissions() {
            const now = Date.now();
            const toProcess = currentMissions.filter(m =>
                m.status === 'occupied' &&
                m.contract_end_date &&
                new Date(m.contract_end_date).getTime() < now &&
                m.contract_status === 'ending'
            );

            if (toProcess.length === 0) return;

            let rotatedCount = 0;
            let vacatedCount = 0;
            for (const mission of toProcess) {
                try {
                    await archiveOutgoingOccupant(mission);

                    if (mission.future_talent_id) {
                        const { data, error } = await capHumaWithRetry(() =>
                            supabaseClient
                                .from('missions')
                                .update({
                                    status: 'occupied',
                                    occupant_id: mission.future_talent_id,
                                    contract_start_date: mission.future_contract_start_date || null,
                                    contract_end_date: mission.future_contract_end_date || null,
                                    contract_status: null,
                                    future_talent_id: null,
                                    future_contract_start_date: null,
                                    future_contract_end_date: null
                                })
                                .eq('id', mission.id)
                                .select('id')
                        );
                        if (error) throw error;
                        if (data && data.length > 0) {
                            await markIncomingOccupant(mission.future_talent_id);
                            rotatedCount++;
                        }
                    } else {
                        const { data, error } = await capHumaWithRetry(() =>
                            supabaseClient
                                .from('missions')
                                .update({ status: 'vacant', occupant_id: null })
                                .eq('id', mission.id)
                                .select('id')
                        );
                        if (error) throw error;
                        if (data && data.length > 0) vacatedCount++;
                    }
                } catch (error) {
                    console.error("Erreur de traitement automatique du contrat expiré :", mission.id, error);
                }
            }

            if (rotatedCount > 0 || vacatedCount > 0) {
                const parts = [];
                if (rotatedCount > 0) parts.push(`${rotatedCount} poste(s) automatiquement transféré(s) au futur occupant prévu`);
                if (vacatedCount > 0) parts.push(`${vacatedCount} poste(s) automatiquement libéré(s)`);
                toastMessage(parts.join(' · ') + ' suite à une fin de contrat confirmée.', 'success');
                const { data: refreshed, error: refreshErr } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('missions')
                        .select(MISSIONS_COLUMNS)
                        .eq('pool', currentPoolId)
                        .order('title', { ascending: true })
                );
                if (!refreshErr) currentMissions = refreshed || currentMissions;
            }
        }

        // ============================================================================
        // 3 TER. BARRE DE KPIS DU POOL (cf. Hercules positions/stats.ts)
        // ============================================================================
        function updateKpiBar() {
            if (currentMissions.length === 0) {
                kpiBar.classList.add('hidden');
                return;
            }
            kpiBar.classList.remove('hidden');

            const now = Date.now();
            const sixMonthsLater = now + 6 * 30 * 24 * 60 * 60 * 1000;

            const total = currentMissions.length;
            const occupied = currentMissions.filter(m => m.status === 'occupied').length;
            const recruiting = currentMissions.filter(m => m.status === 'recruiting').length;
            const vacant = currentMissions.filter(m => m.status === 'vacant').length;

            const endingSoon = currentMissions.filter(m => {
                if (!m.contract_end_date) return false;
                const t = new Date(m.contract_end_date).getTime();
                return t > now && t <= sixMonthsLater;
            }).length;

            const withContracts = currentMissions.filter(m => m.contract_start_date && m.contract_end_date);
            const durations = withContracts.map(m => {
                const start = new Date(m.contract_start_date).getTime();
                const end = new Date(m.contract_end_date).getTime();
                return Math.round((end - start) / (1000 * 60 * 60 * 24 * 30));
            });
            const avgDuration = durations.length > 0
                ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
                : 0;

            document.getElementById('kpiTotal').textContent = total;
            document.getElementById('kpiOccupied').textContent = occupied;
            document.getElementById('kpiRecruiting').textContent = recruiting;
            document.getElementById('kpiVacant').textContent = vacant;
            document.getElementById('kpiEndingSoon').textContent = endingSoon;
            document.getElementById('kpiAvgDuration').textContent = avgDuration;
        }

        // ============================================================================
        // 3 QUATER. STATISTIQUES DÉTAILLÉES DES CONTRATS (Étape C, cf. Hercules
        // positions/stats.ts : getDetailedPositionStats). Calculées côté client à
        // partir des postes du pool déjà chargés (currentMissions), cohérent avec le
        // choix déjà fait pour updateKpiBar() — pas de requête Supabase supplémentaire.
        // ============================================================================
        function updateDetailedContractStats() {
            const card = document.getElementById('detailedStatsCard');
            if (currentMissions.length === 0) {
                card.classList.add('hidden');
                return;
            }
            card.classList.remove('hidden');

            const now = Date.now();
            const oneMonthLater = now + 30 * 24 * 60 * 60 * 1000;
            const threeMonthsLater = now + 3 * 30 * 24 * 60 * 60 * 1000;
            const sixMonthsLater = now + 6 * 30 * 24 * 60 * 60 * 1000;

            const withContracts = currentMissions.filter(m => m.contract_start_date && m.contract_end_date);
            const durations = withContracts.map(m => {
                const start = new Date(m.contract_start_date).getTime();
                const end = new Date(m.contract_end_date).getTime();
                return Math.round((end - start) / (1000 * 60 * 60 * 24 * 30));
            });
            const avgDuration = durations.length > 0
                ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
                : 0;

            const ongoing = currentMissions.filter(m => m.contract_status === 'ongoing').length;
            const renewable = currentMissions.filter(m => m.contract_status === 'renewable').length;
            const renewalRate = withContracts.length > 0
                ? Math.round((renewable / withContracts.length) * 100)
                : 0;

            // Échéances cumulatives (comme Hercules : "fin dans 3 mois" inclut ce qui
            // finit dans le mois qui vient, pas une tranche exclusive 1-3 mois).
            const endsWithin = (maxDate) => currentMissions.filter(m => {
                if (!m.contract_end_date) return false;
                const t = new Date(m.contract_end_date).getTime();
                return t > now && t <= maxDate;
            }).length;

            document.getElementById('statWithContracts').textContent = withContracts.length;
            document.getElementById('statAvgDuration').textContent = avgDuration + ' mois';
            document.getElementById('statOngoing').textContent = ongoing;
            document.getElementById('statRenewable').textContent = renewable;
            document.getElementById('statRenewalRate').textContent = renewalRate + '%';
            document.getElementById('statEnding1m').textContent = endsWithin(oneMonthLater);
            document.getElementById('statEnding3m').textContent = endsWithin(threeMonthsLater);
            document.getElementById('statEnding6m').textContent = endsWithin(sixMonthsLater);

            // Répartition par pays
            const byCountry = {};
            currentMissions.forEach(m => {
                const c = m.country || 'Non précisé';
                byCountry[c] = (byCountry[c] || 0) + 1;
            });
            document.getElementById('statByCountry').innerHTML = Object.entries(byCountry)
                .sort((a, b) => b[1] - a[1])
                .map(([country, count]) => `
                    <div class="flex justify-between"><span class="text-slate-400">${escapeHtml(country)}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('');

            // Répartition par desk (ajouté par rapport à Hercules : Cap Huma trace
            // déjà le desk sur missions, donnée jugée utile en complément du pays).
            const byDesk = {};
            currentMissions.forEach(m => {
                if (!m.desk) return;
                const label = DESK_LABELS[m.desk] || m.desk;
                byDesk[label] = (byDesk[label] || 0) + 1;
            });
            const deskEntries = Object.entries(byDesk);
            document.getElementById('statByDesk').innerHTML = deskEntries.length > 0
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
            document.getElementById('statDurationDistribution').innerHTML = Object.entries(distribution)
                .map(([range, count]) => `
                    <div class="flex justify-between"><span class="text-slate-400">${range}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('');
        }

        // ============================================================================
        // 4. RENDU DE LA LISTE DES POSTES
        // ============================================================================
        function renderMissions() {
            missionsGrid.innerHTML = '';
            const paginationEl = document.getElementById('missionsPagination');

            if (currentMissions.length === 0) {
                missionsEmpty.classList.remove('hidden');
                paginationEl.innerHTML = '';
                return;
            }
            missionsEmpty.classList.add('hidden');

            // Pagination côté AFFICHAGE uniquement (le pool entier reste chargé en
            // mémoire pour les statistiques et la rotation automatique des contrats,
            // qui ont besoin de l'ensemble des postes du pool) — évite simplement de
            // construire des centaines de cartes DOM d'un coup sur un gros pool.
            const totalPages = Math.max(1, Math.ceil(currentMissions.length / MISSIONS_PAGE_SIZE));
            if (missionsPage > totalPages) missionsPage = totalPages;
            const start = (missionsPage - 1) * MISSIONS_PAGE_SIZE;
            const pageMissions = currentMissions.slice(start, start + MISSIONS_PAGE_SIZE);

            const canEdit = currentUserRole === 'admin' || currentUserRole === 'user';

            pageMissions.forEach(mission => {
                const statusLabel = STATUS_LABELS[mission.status] || mission.status || '—';
                const occupantName = mission.occupant_id ? (talentNameById[mission.occupant_id] || 'Talent introuvable') : null;
                const futureName = mission.future_talent_id ? (talentNameById[mission.future_talent_id] || 'Talent introuvable') : null;

                // Contrat expiré mais statut non confirmé "Se termine" — traité par
                // processExpiredMissions() uniquement si contract_status === 'ending'.
                // Dans tous les autres cas, simple signalement visuel, aucune écriture.
                const isExpiredUnconfirmed = mission.status === 'occupied'
                    && mission.contract_end_date
                    && new Date(mission.contract_end_date).getTime() < Date.now()
                    && mission.contract_status !== 'ending';

                const card = document.createElement('div');
                card.className = "bg-white border rounded-2xl shadow-sm p-5 flex flex-col justify-between "
                    + (isExpiredUnconfirmed ? "border-red-300 ring-1 ring-red-200" : "border-slate-200");

                card.innerHTML = `
                    <div>
                        <div class="flex items-start justify-between gap-2 mb-2">
                            <h3 class="text-sm font-extrabold text-slate-800">${escapeHtml(mission.title)}</h3>
                            <span class="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-slate-100 text-slate-600 shrink-0">${escapeHtml(statusLabel)}</span>
                        </div>
                        ${isExpiredUnconfirmed ? `<p class="text-[11px] font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1 mb-2">🔴 Contrat expiré le ${escapeHtml(formatDate(mission.contract_end_date))} — statut à mettre à jour d'urgence</p>` : ''}
                        <p class="text-xs text-slate-400 font-semibold">${escapeHtml(mission.location)}, ${escapeHtml(mission.country)}</p>
                        ${mission.project_name ? `<p class="text-xs text-slate-400 mt-0.5">${escapeHtml(mission.project_name)}</p>` : ''}
                        <div class="flex flex-wrap gap-1.5 mt-3">
                            ${mission.pool_level ? `<span class="text-[10px] font-bold px-2 py-1 rounded-full bg-blue-50 text-primary">${escapeHtml(POOL_LEVEL_LABELS[mission.pool_level] || mission.pool_level)}</span>` : ''}
                            ${mission.desk ? `<span class="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600">${escapeHtml(DESK_LABELS[mission.desk] || mission.desk)}</span>` : ''}
                            ${mission.candidate_type ? `<span class="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600">${escapeHtml(CANDIDATE_TYPE_LABELS[mission.candidate_type] || mission.candidate_type)}</span>` : ''}
                        </div>
                        <div class="mt-3 text-xs text-slate-500 space-y-1">
                            ${occupantName ? `<p>👤 Occupant : <span class="font-semibold text-slate-700">${escapeHtml(occupantName)}</span></p>` : ''}
                            ${(mission.status === 'occupied' && mission.contract_end_date) ? `<p>📅 Fin de contrat : <span class="font-semibold text-slate-700">${escapeHtml(formatDate(mission.contract_end_date))}</span></p>` : ''}
                            ${futureName ? `<p>🔄 Futur occupant : <span class="font-semibold text-slate-700">${escapeHtml(futureName)}</span></p>` : ''}
                        </div>
                    </div>
                    ${canEdit ? `
                    <div class="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                        <button type="button" class="editMissionBtn flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold transition-all" data-id="${escapeHtml(mission.id)}">✏️ Modifier</button>
                        <button type="button" class="deleteMissionBtn bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-lg text-xs font-bold transition-all" data-id="${escapeHtml(mission.id)}">🗑️</button>
                    </div>` : ''}
                    ${mission.status === 'occupied' && mission.occupant_id ? `
                    <div class="mt-2">
                        <button type="button" class="evaluationsBtn w-full bg-primary-light hover:bg-blue-100 text-primary px-3 py-2 rounded-lg text-xs font-bold transition-all" data-id="${escapeHtml(mission.id)}">💬 Évaluations de l'occupant</button>
                    </div>
                    ${canEdit ? `
                    <div class="mt-2">
                        <button type="button" class="resyncOccupantBtn w-full border border-slate-200 hover:bg-slate-50 text-slate-500 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all" data-id="${escapeHtml(mission.id)}">🔄 Resynchroniser le compteur du talent</button>
                    </div>` : ''}` : ''}
                `;

                missionsGrid.appendChild(card);
            });

            paginationEl.innerHTML = renderPaginationControls(missionsPage, totalPages, currentMissions.length);
            paginationEl.querySelector('[data-page-nav="prev"]')
                ?.addEventListener('click', () => goToMissionsPage(missionsPage - 1));
            paginationEl.querySelector('[data-page-nav="next"]')
                ?.addEventListener('click', () => goToMissionsPage(missionsPage + 1));

            document.querySelectorAll('.editMissionBtn').forEach(btn => {
                btn.addEventListener('click', () => openEditModal(btn.dataset.id));
            });
            document.querySelectorAll('.deleteMissionBtn').forEach(btn => {
                btn.addEventListener('click', () => deleteMission(btn.dataset.id));
            });
            document.querySelectorAll('.evaluationsBtn').forEach(btn => {
                btn.addEventListener('click', () => openEvaluationsModal(btn.dataset.id));
            });
            document.querySelectorAll('.resyncOccupantBtn').forEach(btn => {
                btn.addEventListener('click', () => resyncOccupant(btn.dataset.id));
            });
        }

        // Correction ponctuelle pour les postes déjà occupés avant l'introduction de la
        // synchronisation automatique (Étape 5, point 9.3 étendu) — remet à zéro le compteur
        // de l'occupant actuel sans avoir besoin de changer d'occupant pour déclencher la sync.
        async function resyncOccupant(missionId) {
            const mission = currentMissions.find(m => m.id === missionId);
            if (!mission || !mission.occupant_id) return;

            try {
                await markIncomingOccupant(mission.occupant_id);
                toastMessage('Compteur du talent resynchronisé.', 'success');
            } catch (error) {
                console.error("Erreur de resynchronisation :", error);
                toastMessage("Échec de la resynchronisation : " + (error && error.message ? error.message : 'erreur inconnue.'), 'error');
            }
        }

        function goToMissionsPage(page) {
            if (page < 1) return;
            missionsPage = page;
            renderMissions();
        }

        function formatDate(isoDate) {
            if (!isoDate) return '';
            const d = new Date(isoDate);
            if (isNaN(d.getTime())) return isoDate;
            return d.toLocaleDateString('fr-FR');
        }

        // ============================================================================
        // 5. MODALE CRÉATION / MODIFICATION
        // ============================================================================
        const missionModal = document.getElementById('missionModal');
        const missionForm = document.getElementById('missionForm');
        const modalTitle = document.getElementById('modalTitle');
        const formError = document.getElementById('formError');

        createMissionBtn.addEventListener('click', openCreateModal);
        document.getElementById('closeModalBtn').addEventListener('click', closeModal);
        document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

        // Le champ "Nom du projet" n'a de sens que pour un poste de niveau "Projet" —
        // masqué et vidé automatiquement pour un poste de niveau "Mission".
        const fieldPoolLevel = document.getElementById('fieldPoolLevel');
        const projectNameField = document.getElementById('projectNameField');
        const fieldProjectName = document.getElementById('fieldProjectName');

        function toggleProjectNameField() {
            if (fieldPoolLevel.value === 'project') {
                projectNameField.classList.remove('hidden');
            } else {
                projectNameField.classList.add('hidden');
                fieldProjectName.value = '';
            }
        }

        fieldPoolLevel.addEventListener('change', toggleProjectNameField);

        // Le champ "Occupant" n'a de sens que si le statut est "Occupé" — masqué sinon,
        // en cohérence avec le garde-fou appliqué à l'enregistrement (occupant_id forcé à null).
        const fieldStatus = document.getElementById('fieldStatus');
        const occupantField = document.getElementById('occupantField');
        const currentContractFields = document.getElementById('currentContractFields');

        function toggleOccupantField() {
            if (fieldStatus.value === 'occupied') {
                occupantField.classList.remove('hidden');
                currentContractFields.classList.remove('hidden');
            } else {
                occupantField.classList.add('hidden');
                currentContractFields.classList.add('hidden');
            }
        }

        fieldStatus.addEventListener('change', toggleOccupantField);

        function openCreateModal() {
            modalTitle.textContent = 'Nouveau poste';
            missionForm.reset();
            document.getElementById('missionId').value = '';
            document.getElementById('fieldPoolLevel').value = 'mission';
            document.getElementById('fieldStatus').value = 'vacant';
            toggleProjectNameField();
            toggleOccupantField();
            formError.classList.add('hidden');
            missionModal.classList.remove('hidden');
        }

        function openEditModal(missionId) {
            const mission = currentMissions.find(m => m.id === missionId);
            if (!mission) return;

            modalTitle.textContent = 'Modifier le poste';
            document.getElementById('missionId').value = mission.id;
            document.getElementById('fieldTitle').value = mission.title || '';
            document.getElementById('fieldPoolLevel').value = mission.pool_level || 'mission';
            document.getElementById('fieldStatus').value = mission.status || 'vacant';
            document.getElementById('fieldCountry').value = mission.country || '';
            document.getElementById('fieldLocation').value = mission.location || '';
            document.getElementById('fieldProjectName').value = mission.project_name || '';
            document.getElementById('fieldCandidateType').value = mission.candidate_type || '';
            document.getElementById('fieldDesk').value = mission.desk || '';
            document.getElementById('fieldOccupant').value = mission.occupant_id || '';
            document.getElementById('fieldContractStart').value = toDateInputValue(mission.contract_start_date);
            document.getElementById('fieldContractEnd').value = toDateInputValue(mission.contract_end_date);
            document.getElementById('fieldContractStatus').value = mission.contract_status || '';
            document.getElementById('fieldFutureOccupant').value = mission.future_talent_id || '';
            document.getElementById('fieldFutureContractStart').value = toDateInputValue(mission.future_contract_start_date);
            document.getElementById('fieldFutureContractEnd').value = toDateInputValue(mission.future_contract_end_date);

            toggleProjectNameField();
            toggleOccupantField();
            formError.classList.add('hidden');
            missionModal.classList.remove('hidden');
        }

        function toDateInputValue(isoDate) {
            if (!isoDate) return '';
            return String(isoDate).substring(0, 10);
        }

        function closeModal() {
            missionModal.classList.add('hidden');
        }

        missionForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            formError.classList.add('hidden');

            const missionId = document.getElementById('missionId').value;
            const candidateType = document.getElementById('fieldCandidateType').value || null;
            const selectedStatus = document.getElementById('fieldStatus').value;
            const selectedOccupantId = document.getElementById('fieldOccupant').value || null;

            const payload = {
                title: document.getElementById('fieldTitle').value.trim(),
                pool: currentPoolId,
                pool_level: document.getElementById('fieldPoolLevel').value,
                status: selectedStatus,
                country: document.getElementById('fieldCountry').value.trim(),
                location: document.getElementById('fieldLocation').value.trim(),
                project_name: document.getElementById('fieldProjectName').value.trim() || null,
                candidate_type: candidateType,
                // is_expat maintenue en cohérence automatique avec candidate_type pour éviter
                // qu'elle devienne une colonne fantôme jamais alimentée (cf. Master Context
                // section 0 point 14 sur les colonnes redondantes non tenues à jour).
                is_expat: candidateType ? candidateType === 'expat' : null,
                desk: document.getElementById('fieldDesk').value || null,
                // Garde-fou : un poste qui n'est plus "occupied" ne peut pas conserver d'occupant affiché.
                occupant_id: selectedStatus === 'occupied' ? selectedOccupantId : null,
                contract_start_date: document.getElementById('fieldContractStart').value || null,
                contract_end_date: document.getElementById('fieldContractEnd').value || null,
                contract_status: document.getElementById('fieldContractStatus').value || null,
                future_talent_id: document.getElementById('fieldFutureOccupant').value || null,
                future_contract_start_date: document.getElementById('fieldFutureContractStart').value || null,
                future_contract_end_date: document.getElementById('fieldFutureContractEnd').value || null,
            };

            if (!payload.title || !payload.country || !payload.location) {
                formError.textContent = "Le titre, le pays et le lieu sont obligatoires.";
                formError.classList.remove('hidden');
                return;
            }

            // ────────────────────────────────────────────────────────────────
            // GARDE-FOU 1 : l'occupant choisi est-il déjà occupant d'un AUTRE poste ?
            // (recherché dans les postes déjà chargés pour ce pool — un talent
            // n'appartenant qu'à un seul pool, un conflit ne peut exister qu'ici)
            // ────────────────────────────────────────────────────────────────
            let conflictMissionToVacate = null;
            if (payload.status === 'occupied' && payload.occupant_id) {
                const conflict = currentMissions.find(m =>
                    m.id !== missionId &&
                    m.occupant_id === payload.occupant_id &&
                    m.status === 'occupied'
                );
                if (conflict) {
                    const talentLabel = talentNameById[payload.occupant_id] || 'Ce talent';
                    const confirmed = window.confirm(
                        `${talentLabel} occupe déjà le poste « ${conflict.title} ».\n\n` +
                        `Confirmer le changement de poste ? L'ancien poste sera automatiquement libéré ` +
                        `(remis en Vacant) et ses évaluations archivées dans l'historique du talent.`
                    );
                    if (!confirmed) return;
                    conflictMissionToVacate = conflict;
                }
            }

            // ────────────────────────────────────────────────────────────────
            // GARDE-FOU 2 : le futur occupant choisi est-il occupant ailleurs, avec un
            // chevauchement de dates (début prévu ici < date de sortie de son poste actuel) ?
            // Purement informatif — pas d'action automatique, contrairement au garde-fou 1.
            // ────────────────────────────────────────────────────────────────
            if (payload.future_talent_id) {
                const futureConflict = currentMissions.find(m =>
                    m.id !== missionId &&
                    m.occupant_id === payload.future_talent_id &&
                    m.status === 'occupied'
                );
                if (futureConflict && payload.future_contract_start_date && futureConflict.contract_end_date
                    && payload.future_contract_start_date < futureConflict.contract_end_date) {
                    const talentLabel = talentNameById[payload.future_talent_id] || 'Ce talent';
                    const confirmed = window.confirm(
                        `${talentLabel} est actuellement occupant de « ${futureConflict.title} » jusqu'au ` +
                        `${formatDate(futureConflict.contract_end_date)}.\n\n` +
                        `La date de début prévue ici (${formatDate(payload.future_contract_start_date)}) est ` +
                        `antérieure à cette date de sortie — chevauchement. Continuer quand même ?`
                    );
                    if (!confirmed) return;
                }
            }

            const saveBtn = document.getElementById('saveMissionBtn');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Enregistrement…';

            try {
                // Libération de l'ancien poste si un conflit a été confirmé (garde-fou 1) :
                // même traitement qu'une sortie normale (archivage des évaluations + poste vacant).
                if (conflictMissionToVacate) {
                    await archiveOutgoingOccupant(conflictMissionToVacate);

                    const { data: vacateData, error: vacateErr } = await capHumaWithRetry(() =>
                        supabaseClient
                            .from('missions')
                            .update({ status: 'vacant', occupant_id: null })
                            .eq('id', conflictMissionToVacate.id)
                            .select('id')
                    );
                    if (vacateErr) throw vacateErr;
                    if (!vacateData || vacateData.length === 0) {
                        throw new Error("La libération de l'ancien poste n'a affecté aucune ligne (policy RLS ?).");
                    }
                }

                if (missionId) {
                    const originalMission = currentMissions.find(m => m.id === missionId);
                    const previousOccupantId = originalMission ? originalMission.occupant_id : null;

                    // L'occupant sort si : il y avait un occupant avant ET (il change, OU le poste
                    // n'est plus "occupied") — cf. Master Context section 9.3.
                    if (originalMission && previousOccupantId && previousOccupantId !== payload.occupant_id) {
                        await archiveOutgoingOccupant(originalMission);
                    }

                    const { error } = await capHumaWithRetry(() =>
                        supabaseClient
                            .from('missions')
                            .update(payload)
                            .eq('id', missionId)
                    );
                    if (error) throw error;

                    // logAuditAction('update', ...) retiré le 18/08/2026 (A5) : couvert
                    // désormais par le trigger Postgres trg_audit_missions, fiable même
                    // pour une modification faite hors de cette page.

                    // Nouvel occupant entrant (affectation ou rotation) : compteurs remis à zéro.
                    if (payload.occupant_id && payload.occupant_id !== previousOccupantId) {
                        await markIncomingOccupant(payload.occupant_id);
                    }

                    toastMessage('Poste mis à jour.', 'success');
                } else {
                    payload.created_by = currentUserId;
                    // ⚠️ Volontairement PAS enveloppé dans capHumaWithRetry() (P19) :
                    // missions n'a aucune contrainte UNIQUE (Dossier de passation §4.2)
                    // — une relance après perte de réponse dupliquerait silencieusement
                    // le poste créé.
                    const { error } = await supabaseClient
                        .from('missions')
                        .insert(payload);
                    if (error) throw error;

                    // logAuditAction('create', ...) retiré le 18/08/2026 (A5) : couvert
                    // désormais par le trigger Postgres trg_audit_missions.

                    if (payload.occupant_id) {
                        await markIncomingOccupant(payload.occupant_id);
                    }

                    toastMessage('Poste créé.', 'success');
                }

                closeModal();
                await loadMissions();

            } catch (error) {
                console.error("Erreur d'enregistrement du poste :", error);
                // PostgrestError n'est pas une instance native d'Error — on teste .message directement
                formError.textContent = "Erreur lors de l'enregistrement : " + (error && error.message ? error.message : 'erreur inconnue.');
                formError.classList.remove('hidden');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Enregistrer';
            }
        });

        // ============================================================================
        // 6. SUPPRESSION D'UN POSTE
        // ============================================================================
        async function deleteMission(missionId) {
            const mission = currentMissions.find(m => m.id === missionId);
            const label = mission ? mission.title : 'ce poste';

            if (!window.confirm(`Supprimer définitivement « ${label} » ? Cette action est irréversible.`)) {
                return;
            }

            try {
                // La suppression d'un poste occupé fait sortir l'occupant au même titre qu'un
                // changement de statut — on archive avant de supprimer (Master Context section 9.3).
                if (mission && mission.occupant_id) {
                    await archiveOutgoingOccupant(mission);
                }

                // Enveloppé dans capHumaWithRetry() (P19) : sûr à retenter — contrairement
                // aux suppressions ailleurs sur le site, cette page ne vérifie pas le
                // nombre de lignes affectées après coup, donc pas de contrôle RLS à
                // rendre ambigu par une relance.
                const { error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('missions')
                        .delete()
                        .eq('id', missionId)
                );

                if (error) throw error;

                // logAuditAction('delete', ...) retiré le 18/08/2026 (A5) : couvert
                // désormais par le trigger Postgres trg_audit_missions.
                toastMessage('Poste supprimé.', 'success');
                await loadMissions();

            } catch (error) {
                console.error("Erreur de suppression du poste :", error);
                toastMessage("Échec de la suppression : " + (error && error.message ? error.message : 'erreur inconnue.'), 'error');
            }
        }
        // ============================================================================
        // 6 BIS. SORTIE / ENTRÉE D'UN OCCUPANT (Étape 5, point 9.3 + suivi des compteurs)
        // ============================================================================
        // À la SORTIE d'un occupant (changement d'occupant, passage à vacant/recruiting,
        // ou suppression du poste) :
        //   1. Archive ses évaluations en un "passage" dans talents.archived_position_passages
        //      (si des évaluations existent — sinon rien à archiver).
        //   2. Remet à jour son suivi de disponibilité : is_currently_on_mission = false,
        //      last_mission_end_date = date de sortie (le décompte des mois sans mission
        //      repart de cette date au prochain passage du Cron mensuel monthly-maintenance),
        //      status = 'En attente de poste'.
        // Point signalé par l'utilisateur : avant ce correctif, ces deux mises à jour
        // n'étaient jamais faites depuis missions.html, laissant les compteurs du talent
        // désynchronisés de son affectation réelle.
        async function archiveOutgoingOccupant(mission) {
            if (!mission.occupant_id) return;

            const exitDate = mission.contract_end_date || new Date().toISOString().substring(0, 10);

            // 1. Archivage des évaluations (uniquement si des évaluations existent)
            const { data: evals, error: evalErr } = await capHumaWithRetry(() =>
                supabaseClient
                    .from('evaluations')
                    .select('context, positive_points, negative_points, rating, author_email, created_at')
                    .eq('mission_id', mission.id)
            );
            if (evalErr) throw evalErr;

            if (evals && evals.length > 0) {
                const passage = {
                    positionTitle: mission.title,
                    pool: mission.pool,
                    country: mission.country,
                    desk: mission.desk || null,
                    startDate: mission.contract_start_date || null,
                    endDate: exitDate,
                    comments: evals.map(e => ({
                        context: e.context,
                        positive_points: e.positive_points,
                        negative_points: e.negative_points,
                        rating: e.rating,
                        author_email: e.author_email,
                        created_at: e.created_at
                    }))
                };

                const { data: talent, error: talentErr } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('talents')
                        .select('archived_position_passages')
                        .eq('id', mission.occupant_id)
                        .maybeSingle()
                );
                if (talentErr) throw talentErr;

                const existingPassages = (talent && Array.isArray(talent.archived_position_passages))
                    ? talent.archived_position_passages
                    : [];
                const updatedPassages = existingPassages.concat([passage]);

                const { data: passageUpdateData, error: passageUpdateErr } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('talents')
                        .update({ archived_position_passages: updatedPassages })
                        .eq('id', mission.occupant_id)
                        .select('id')
                );
                if (passageUpdateErr) throw passageUpdateErr;
                if (!passageUpdateData || passageUpdateData.length === 0) {
                    throw new Error("La mise à jour de l'historique du talent n'a affecté aucune ligne (policy RLS ?).");
                }

                // Enveloppé dans capHumaWithRetry() (P19) : suppression par mission_id,
                // aucun contrôle de lignes affectées ici — sûr à retenter (idempotent :
                // une 2e tentative ne trouve simplement plus rien à supprimer).
                const { error: deleteErr } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('evaluations')
                        .delete()
                        .eq('mission_id', mission.id)
                );
                if (deleteErr) throw deleteErr;
            }

            // 2. Mise à jour du suivi de disponibilité du talent sortant (toujours faite,
            // même sans évaluation à archiver — c'est le point signalé par l'utilisateur).
            const { data: statusData, error: statusErr } = await capHumaWithRetry(() =>
                supabaseClient
                    .from('talents')
                    .update({
                        is_currently_on_mission: false,
                        last_mission_end_date: exitDate,
                        status: 'En attente de poste'
                    })
                    .eq('id', mission.occupant_id)
                    .select('id')
            );
            if (statusErr) throw statusErr;
            if (!statusData || statusData.length === 0) {
                throw new Error("La mise à jour du statut du talent sortant n'a affecté aucune ligne (policy RLS ?).");
            }
        }

        // À l'ENTRÉE d'un talent sur un poste (nouvelle affectation ou rotation) : ses
        // compteurs repartent à zéro et le décompte des mois sans mission est gelé tant
        // qu'il reste occupant (is_currently_on_mission = true).
        async function markIncomingOccupant(talentId) {
            if (!talentId) return;

            // Lecture de l'état actuel : number_of_alima_missions n'est pas un simple
            // incrément numérique mais une progression par palier (none → one → two →
            // three_plus), logique reprise de Hercules startAlimaMission.
            const { data: currentTalent, error: readErr } = await capHumaWithRetry(() =>
                supabaseClient
                    .from('talents')
                    .select('number_of_alima_missions')
                    .eq('id', talentId)
                    .maybeSingle()
            );
            if (readErr) throw readErr;

            const currentCount = (currentTalent && currentTalent.number_of_alima_missions) || 'none';
            const newCount = currentCount === 'none' ? 'one' : (currentCount === 'one' ? 'two' : 'three_plus');

            const { data, error } = await capHumaWithRetry(() =>
                supabaseClient
                    .from('talents')
                    .update({
                        is_currently_on_mission: true,
                        months_without_mission: 0,
                        last_mission_end_date: null,
                        status: 'En poste ALIMA',
                        number_of_alima_missions: newCount,
                        had_alima_mission: true
                    })
                    .eq('id', talentId)
                    .select('id')
            );
            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error("La mise à jour du talent entrant n'a affecté aucune ligne (policy RLS ?).");
            }
        }

        // ============================================================================
        // 7. ÉVALUATIONS DE L'OCCUPANT COURANT (Étape 5, point 9.2)
        // ============================================================================
        const evaluationsModal = document.getElementById('evaluationsModal');
        const evaluationsList = document.getElementById('evaluationsList');
        const evaluationsEmpty = document.getElementById('evaluationsEmpty');
        const evaluationsError = document.getElementById('evaluationsError');
        const evaluationsSubtitle = document.getElementById('evaluationsSubtitle');
        const evaluationForm = document.getElementById('evaluationForm');
        const evaluationFormError = document.getElementById('evaluationFormError');

        let currentEvaluationMission = null;

        // ============================================================================
        // BROUILLON LOCAL (backlog B15-R1, priorité P20) — evaluationForm
        // ----------------------------------------------------------------------------
        // Portée décidée avec l'utilisateur : CRÉATION uniquement, jamais en édition
        // d'une évaluation existante (ce même <form> sert aux deux cas via
        // startEditEvaluation()/resetEvaluationForm() — voir plus bas). Une clé par
        // mission (`draft:evaluation:<missionId>`), le formulaire ne concernant
        // qu'une mission/occupant à la fois (currentEvaluationMission).
        //
        // Garde-fou mode édition : collectEvaluationDraft() retourne `undefined` tant
        // que #evaluationId n'est pas vide — capHumaAttachDraftAutosave() (voir
        // shared/caphuma-form-draft.js) n'écrit alors RIEN, pour ne jamais écraser un
        // éventuel brouillon de création avec du contenu d'édition. Solution retenue
        // après discussion avec l'utilisateur (moins de points de branchement qu'un
        // détachement/rattachement à chaque bascule création↔édition, donc moins de
        // risque d'oubli, et aucune confirmation intempestive pour le recruteur en
        // dehors de l'ouverture du panneau).
        let currentEvaluationDraftKey = null;
        let currentEvaluationDraftBinding = null;

        function collectEvaluationDraft() {
            if (document.getElementById('evaluationId').value) return undefined; // en édition : rien à sauvegarder
            return capHumaDefaultDraftCollect(evaluationForm);
        }

        function restoreEvaluationDraft(data) {
            capHumaDefaultDraftRestore(evaluationForm, data);
        }

        // Démarre le suivi pour la mission dont le panneau vient de s'ouvrir — appelé
        // en fin de openEvaluationsModal(), juste après resetEvaluationForm() (donc
        // #evaluationId est garanti vide à ce moment, contexte création).
        function startEvaluationDraftTracking(missionId) {
            stopEvaluationDraftTracking();
            currentEvaluationDraftKey = `draft:evaluation:${missionId}`;
            capHumaOfferDraftRestore(currentEvaluationDraftKey, restoreEvaluationDraft);
            currentEvaluationDraftBinding = capHumaAttachDraftAutosave(evaluationForm, currentEvaluationDraftKey, { collect: collectEvaluationDraft });
        }

        // Fermeture du panneau (croix/Échap) : on arrête juste l'autosave, sans
        // effacer le brouillon — même règle que talentForm (P20/Lot 2, correctif du
        // 01/09/2026) : fermer sert aussi à sortir provisoirement, pas forcément à
        // abandonner délibérément une saisie en cours.
        function stopEvaluationDraftTracking() {
            if (currentEvaluationDraftBinding) {
                currentEvaluationDraftBinding.stop();
                currentEvaluationDraftBinding = null;
            }
        }

        // Effacement DÉFINITIF — appelé UNIQUEMENT après une CRÉATION réussie (jamais
        // après une modification d'évaluation existante, qui n'a rien à voir avec un
        // éventuel brouillon de création en attente pour cette mission).
        function discardEvaluationDraft() {
            stopEvaluationDraftTracking();
            if (currentEvaluationDraftKey) {
                capHumaDraftClear(currentEvaluationDraftKey);
                currentEvaluationDraftKey = null;
            }
        }

        document.getElementById('closeEvaluationsModalBtn').addEventListener('click', () => {
            evaluationsModal.classList.add('hidden');
            stopEvaluationDraftTracking();
        });

        async function openEvaluationsModal(missionId) {
            const mission = currentMissions.find(m => m.id === missionId);
            if (!mission || !mission.occupant_id) return;

            currentEvaluationMission = mission;
            const occupantName = talentNameById[mission.occupant_id] || 'Talent introuvable';
            evaluationsSubtitle.textContent = `${occupantName} — ${mission.title}`;

            evaluationsList.innerHTML = '';
            evaluationsEmpty.classList.add('hidden');
            evaluationsError.classList.add('hidden');
            resetEvaluationForm();

            // Ajout réservé admin + user, lecture ouverte à tous (même pattern que le reste de la page)
            const canEdit = currentUserRole === 'admin' || currentUserRole === 'user';
            evaluationForm.classList.toggle('hidden', !canEdit);
            if (canEdit) {
                startEvaluationDraftTracking(mission.id);
            } else {
                stopEvaluationDraftTracking();
            }

            evaluationsModal.classList.remove('hidden');
            await loadEvaluations(mission.id);
        }

        async function loadEvaluations(missionId) {
            try {
                // Colonnes restreintes à celles réellement utilisées (règle perf section 2 bis.2).
                // is_moderated / is_red_list_trigger / legacy_content / comment_text volontairement
                // ignorées — usage non documenté, à traiter plus tard si besoin (cf. échange avec l'utilisateur).
                const { data: evaluations, error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('evaluations')
                        .select('id, mission_id, talent_id, author_id, author_email, context, positive_points, negative_points, rating, created_at')
                        .eq('mission_id', missionId)
                        .order('created_at', { ascending: false })
                );

                if (error) throw error;

                currentEvaluationsCache = evaluations || [];
                renderEvaluations(currentEvaluationsCache);

            } catch (error) {
                console.error("Erreur de récupération des évaluations :", error);
                evaluationsError.textContent = "Impossible de charger les évaluations depuis Supabase.";
                evaluationsError.classList.remove('hidden');
            }
        }

        function renderEvaluations(evaluations) {
            evaluationsList.innerHTML = '';

            if (evaluations.length === 0) {
                evaluationsEmpty.classList.remove('hidden');
                return;
            }
            evaluationsEmpty.classList.add('hidden');

            evaluations.forEach(evaluation => {
                // Admin : peut modifier/supprimer n'importe quelle évaluation.
                // User : uniquement les siennes (comparaison author_id).
                // Visitor : aucune action (cf. évaluationForm masqué pour ce rôle).
                const canManage = currentUserRole === 'admin'
                    || (currentUserRole === 'user' && evaluation.author_id === currentUserId);

                const item = document.createElement('div');
                item.className = 'bg-slate-50 border border-slate-200 rounded-xl p-4';

                item.innerHTML = `
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-xs font-bold text-slate-600">${escapeHtml(evaluation.author_email || 'Auteur inconnu')}</span>
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-extrabold text-primary bg-primary-light px-2 py-0.5 rounded-full">${escapeHtml(evaluation.rating != null ? evaluation.rating + '/10' : '—')}</span>
                            <span class="text-[10px] text-slate-400">${escapeHtml(formatDate(evaluation.created_at))}</span>
                        </div>
                    </div>
                    <p class="text-sm text-slate-700 mb-2">${escapeHtml(evaluation.context)}</p>
                    ${evaluation.positive_points ? `<p class="text-xs text-emerald-700 mb-1">✅ ${escapeHtml(evaluation.positive_points)}</p>` : ''}
                    ${evaluation.negative_points ? `<p class="text-xs text-amber-700 mb-1">⚠️ ${escapeHtml(evaluation.negative_points)}</p>` : ''}
                    ${canManage ? `
                    <div class="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200">
                        <button type="button" class="editEvaluationBtn text-xs font-bold text-primary hover:underline" data-id="${escapeHtml(evaluation.id)}">✏️ Modifier</button>
                        <button type="button" class="deleteEvaluationBtn text-xs font-bold text-red-600 hover:underline" data-id="${escapeHtml(evaluation.id)}">🗑️ Supprimer</button>
                    </div>` : ''}
                `;

                evaluationsList.appendChild(item);
            });

            document.querySelectorAll('.editEvaluationBtn').forEach(btn => {
                btn.addEventListener('click', () => startEditEvaluation(btn.dataset.id));
            });
            document.querySelectorAll('.deleteEvaluationBtn').forEach(btn => {
                btn.addEventListener('click', () => deleteEvaluation(btn.dataset.id));
            });
        }

        // Cache locale des évaluations actuellement affichées (pour retrouver les valeurs à éditer
        // sans refaire une requête réseau) — remplie à chaque loadEvaluations().
        let currentEvaluationsCache = [];

        function startEditEvaluation(evaluationId) {
            const evaluation = currentEvaluationsCache.find(e => e.id === evaluationId);
            if (!evaluation) return;

            document.getElementById('evaluationId').value = evaluation.id;
            document.getElementById('fieldContext').value = evaluation.context || '';
            document.getElementById('fieldPositivePoints').value = evaluation.positive_points || '';
            document.getElementById('fieldNegativePoints').value = evaluation.negative_points || '';
            document.getElementById('fieldRating').value = evaluation.rating != null ? evaluation.rating : '';

            document.getElementById('evaluationFormLabel').textContent = "Modifier l'évaluation";
            document.getElementById('saveEvaluationBtn').textContent = 'Enregistrer les modifications';
            document.getElementById('cancelEvaluationEditBtn').classList.remove('hidden');
            evaluationFormError.classList.add('hidden');

            evaluationForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function resetEvaluationForm() {
            evaluationForm.reset();
            document.getElementById('evaluationId').value = '';
            document.getElementById('evaluationFormLabel').textContent = 'Ajouter une évaluation';
            document.getElementById('saveEvaluationBtn').textContent = "Ajouter l'évaluation";
            document.getElementById('cancelEvaluationEditBtn').classList.add('hidden');
            evaluationFormError.classList.add('hidden');
        }

        document.getElementById('cancelEvaluationEditBtn').addEventListener('click', resetEvaluationForm);

        async function deleteEvaluation(evaluationId) {
            if (!window.confirm("Supprimer définitivement cette évaluation ? Cette action est irréversible.")) {
                return;
            }

            try {
                const { error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('evaluations')
                        .delete()
                        .eq('id', evaluationId)
                );

                if (error) throw error;

                toastMessage('Évaluation supprimée.', 'success');
                await loadEvaluations(currentEvaluationMission.id);

            } catch (error) {
                console.error("Erreur de suppression de l'évaluation :", error);
                toastMessage("Échec de la suppression : " + (error && error.message ? error.message : 'erreur inconnue.'), 'error');
            }
        }

        evaluationForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            evaluationFormError.classList.add('hidden');

            if (!currentEvaluationMission) return;

            // Filet de sécurité (P20) : capture immédiate avant validation, sans
            // attendre le debounce — ignorée si on est en édition (collectEvaluationDraft
            // renvoie undefined dans ce cas, voir plus haut).
            if (currentEvaluationDraftBinding) currentEvaluationDraftBinding.saveNow();

            const evaluationId = document.getElementById('evaluationId').value;

            const payload = {
                context: document.getElementById('fieldContext').value.trim(),
                positive_points: document.getElementById('fieldPositivePoints').value.trim() || null,
                negative_points: document.getElementById('fieldNegativePoints').value.trim() || null,
                rating: parseInt(document.getElementById('fieldRating').value, 10),
            };

            if (!payload.context || !payload.rating || payload.rating < 1 || payload.rating > 10) {
                evaluationFormError.textContent = "Le contexte et une note entre 1 et 10 sont obligatoires.";
                evaluationFormError.classList.remove('hidden');
                return;
            }

            const saveBtn = document.getElementById('saveEvaluationBtn');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Enregistrement…';

            try {
                if (evaluationId) {
                    // Modification : mission_id/talent_id/author_id/author_email ne changent jamais
                    const { error } = await capHumaWithRetry(() =>
                        supabaseClient
                            .from('evaluations')
                            .update(payload)
                            .eq('id', evaluationId)
                    );
                    if (error) throw error;
                    toastMessage('Évaluation modifiée.', 'success');
                } else {
                    payload.mission_id = currentEvaluationMission.id;
                    payload.talent_id = currentEvaluationMission.occupant_id;
                    payload.author_id = currentUserId;
                    payload.author_email = currentUserEmail;
                    // ⚠️ Volontairement PAS enveloppé dans capHumaWithRetry() (P19) :
                    // evaluations n'a aucune contrainte UNIQUE (Dossier de passation
                    // §4.2) — une relance après perte de réponse dupliquerait
                    // silencieusement l'évaluation ajoutée.
                    const { error } = await supabaseClient
                        .from('evaluations')
                        .insert(payload);
                    if (error) throw error;
                    toastMessage('Évaluation ajoutée.', 'success');
                    discardEvaluationDraft(); // création réussie : le brouillon n'a plus lieu d'être
                }

                resetEvaluationForm();
                await loadEvaluations(currentEvaluationMission.id);

            } catch (error) {
                console.error("Erreur d'enregistrement de l'évaluation :", error);
                evaluationFormError.textContent = "Erreur lors de l'enregistrement : " + (error && error.message ? error.message : 'erreur inconnue.');
                evaluationFormError.classList.remove('hidden');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = evaluationId ? 'Enregistrer les modifications' : "Ajouter l'évaluation";
            }
        });
})();
