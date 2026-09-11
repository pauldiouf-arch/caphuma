const MissionsPage = {};

(() => {
        renderPageLayout({
            icon: CapHumaIcons.get('briefcase', 'w-5 h-5'),
            title: 'Postes',
            titleId: 'pageTitle',
            subtitle: 'Gestion des postes',
            subtitleId: 'userSubtitle',
            actionsHtml: `
                <a href="#" id="navTalents" class="border border-blue-200 hover:bg-blue-50 text-primary px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    ${CapHumaIcons.get('user', 'w-4 h-4 inline-block align-[-0.15em] shrink-0')} Professionnels du pool
                </a>
                <a href="#" id="navPoolStats" class="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    ${CapHumaIcons.get('barChart', 'w-4 h-4 inline-block align-[-0.15em] shrink-0')} Statistiques &amp; analyse IA
                </a>
            `
        });

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            window.location.replace('index.html');
        }

        const { createClient } = supabase;
        MissionsPage.supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const appBody = document.getElementById('appBody');
        const userSubtitle = document.getElementById('userSubtitle');
        const pageTitle = document.getElementById('pageTitle');
        const poolHeading = document.getElementById('poolHeading');
        const poolSubheading = document.getElementById('poolSubheading');
        const navTalents = document.getElementById('navTalents');
        const missionsGrid = document.getElementById('missionsGrid');

        // Un seul écouteur délégué ici plutôt que N écouteurs re-attachés à chaque
        // rendu dans MissionsPage.renderMissions().
        missionsGrid.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.editMissionBtn');
            if (editBtn) { MissionsPage.openEditModal(editBtn.dataset.id); return; }

            const deleteBtn = e.target.closest('.deleteMissionBtn');
            if (deleteBtn) { MissionsPage.deleteMission(deleteBtn.dataset.id); return; }

            const evalBtn = e.target.closest('.evaluationsBtn');
            if (evalBtn) { MissionsPage.openEvaluationsModal(evalBtn.dataset.id); return; }

            const resyncBtn = e.target.closest('.resyncOccupantBtn');
            if (resyncBtn) { MissionsPage.resyncOccupant(resyncBtn.dataset.id); return; }
        });
        const missionsError = document.getElementById('missionsError');
        const readOnlyNotice = document.getElementById('readOnlyNotice');
        const createMissionBtn = document.getElementById('createMissionBtn');

        // Récupération du pool depuis l'URL (ex. missions.html?pool=COLOG)
        const urlParams = new URLSearchParams(window.location.search);
        MissionsPage.currentPoolId = (urlParams.get('pool') || urlParams.get('pool_id') || '').toUpperCase();

        if (!MissionsPage.currentPoolId) {
            poolSubheading.textContent = "Aucun pool sélectionné — retournez au tableau de bord.";
            missionsError.textContent = "Aucun pool indiqué dans l'URL. Accédez à cette page depuis le bouton « Postes » d'un pool sur le tableau de bord.";
            missionsError.classList.remove('hidden');
        }

        navTalents.href = 'talents.html?pool=' + encodeURIComponent(MissionsPage.currentPoolId);
        document.getElementById('navPoolStats').href = 'statistics.html?pool=' + encodeURIComponent(MissionsPage.currentPoolId);

        MissionsPage.currentUserId = null;
        MissionsPage.currentUserEmail = null;
        MissionsPage.currentUserRole = null;
        MissionsPage.currentUserName = null;
        MissionsPage.currentMissions = [];
        MissionsPage.currentPage = 1;
        MissionsPage.MISSIONS_PAGE_SIZE = 12;
        // Utilisée par les 2 endroits qui chargent la liste complète du pool
        // (loadMissions() et le rafraîchissement dans processExpiredMissions()),
        // pour qu'ils restent synchronisés : un champ manquant s'ajoute ici, une
        // seule fois, plutôt que dans les deux requêtes séparément.
        MissionsPage.MISSIONS_COLUMNS = 'id, title, pool, pool_level, status, country, location, project_name, candidate_type, desk, occupant_id, contract_start_date, contract_end_date, contract_status, future_talent_id, future_contract_start_date, future_contract_end_date';
        MissionsPage.poolTalents = []; // talents du pool, pour les listes déroulantes occupant / futur occupant
        MissionsPage.talentNameById = {};

        // Pas d'instrumentation sur les évaluations individuelles (create/update/delete) :
        // trop bruyant pour peu de valeur RGPD, seules les actions sur les postes le sont.
        const logAuditAction = capHumaMakeAuditLogger(
            () => MissionsPage.supabaseClient,
            () => ({
                userId: MissionsPage.currentUserId,
                userEmail: MissionsPage.currentUserEmail,
                userName: typeof MissionsPage.currentUserName !== 'undefined' ? MissionsPage.currentUserName : null
            })
        );

        MissionsPage.POOL_LEVEL_LABELS = { mission: 'Mission', project: 'Projet' };

        async function checkSession() {
            try {
                const s = await capHumaInitSession(MissionsPage.supabaseClient);

                MissionsPage.currentUserId = s.userId;
                MissionsPage.currentUserEmail = s.email;
                MissionsPage.currentUserName = s.name;

                capHumaStartIdleTimeout(MissionsPage.supabaseClient);
                document.getElementById('user-display-name').textContent = MissionsPage.currentUserEmail;

                MissionsPage.currentUserRole = s.role;
                userSubtitle.textContent = s.role ? `Connecté en tant que ${s.role}` : 'Gestion des postes';

                if (MissionsPage.currentUserRole === 'admin' || MissionsPage.currentUserRole === 'user') {
                    createMissionBtn.classList.remove('hidden');
                } else {
                    readOnlyNotice.classList.remove('hidden');
                }

                appBody.style.display = '';

                if (MissionsPage.currentPoolId) {
                    await loadPoolInfo();
                    await loadPoolTalents();
                    await loadMissions();
                }

            } catch (error) {
                console.warn("[Session Guard] Accès refusé, expulsion :", error.message);
                try {
                    await MissionsPage.supabaseClient.auth.signOut();
                } catch (logoutErr) {}
                window.location.replace('login.html');
            }
        }

        checkSession();
        capHumaInitModalA11y();

        document.getElementById('logoutBtn').addEventListener('click', async function () {
            await logAuditAction('logout', 'user', MissionsPage.currentUserId, MissionsPage.currentUserEmail, null);
            await MissionsPage.supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });

        async function loadPoolInfo() {
            try {
                const { data: pool, error } = await capHumaWithRetry(() =>
                    MissionsPage.supabaseClient
                        .from('pools')
                        .select('pool_id, name, full_name')
                        .eq('pool_id', MissionsPage.currentPoolId)
                        .maybeSingle()
                );

                if (error) throw error;

                const displayName = pool ? (pool.full_name || pool.name || MissionsPage.currentPoolId) : MissionsPage.currentPoolId;
                pageTitle.textContent = 'Postes — ' + displayName;
                poolHeading.textContent = 'Postes du pool ' + displayName;
                poolSubheading.textContent = 'Liste des postes rattachés à ce pool.';

            } catch (error) {
                console.error("Erreur de récupération du pool :", error);
                poolHeading.textContent = 'Postes du pool ' + MissionsPage.currentPoolId;
                poolSubheading.textContent = 'Liste des postes rattachés à ce pool.';
            }
        }

        async function loadPoolTalents() {
            try {
                // Colonnes strictement nécessaires (pas de select('*'))
                const { data: talents, error } = await CapHumaData.getTalents(MissionsPage.supabaseClient, {
                    select: 'id, first_name, last_name, pool',
                    filters: { pool: MissionsPage.currentPoolId },
                    orderBy: 'last_name'
                });

                if (error) throw error;

                MissionsPage.poolTalents = talents || [];
                MissionsPage.talentNameById = {};
                MissionsPage.poolTalents.forEach(t => {
                    MissionsPage.talentNameById[t.id] = `${t.first_name || ''} ${t.last_name || ''}`.trim();
                });

                populateTalentDropdown('fieldOccupant', MissionsPage.poolTalents);
                populateTalentDropdown('fieldFutureOccupant', MissionsPage.poolTalents);

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

                const { data: missions, error } = await capHumaWithRetry(() =>
                    MissionsPage.supabaseClient
                        .from('missions')
                        .select(MissionsPage.MISSIONS_COLUMNS)
                        .eq('pool', MissionsPage.currentPoolId)
                        .order('title', { ascending: true })
                );

                if (error) throw error;

                MissionsPage.currentMissions = missions || [];
                MissionsPage.currentPage = 1;

                // Contrats expirés avec statut confirmé "Se termine" : traitement
                // automatique (voir processExpiredMissions ci-dessous). Les autres
                // restent occupés, simple signalement visuel dans MissionsPage.renderMissions().
                if (MissionsPage.currentUserRole === 'admin' || MissionsPage.currentUserRole === 'user') {
                    await processExpiredMissions();
                }

                MissionsPage.renderMissions();
                MissionsPage.updateKpiBar();
                MissionsPage.updateDetailedContractStats();

            } catch (error) {
                console.error("Erreur de récupération des postes :", error);
                missionsGrid.innerHTML = '';
                missionsError.textContent = "Impossible de charger les postes de ce pool depuis Supabase.";
                missionsError.classList.remove('hidden');
            }
        }

        // Un contrat expiré (contract_end_date dépassée) ne signifie pas forcément que
        // le talent est réellement sorti — il peut avoir été renouvelé sans que ce soit
        // encore saisi. Seul contract_status === 'ending' (confirmé "Se termine")
        // déclenche un traitement automatique : archivage, puis rotation vers le futur
        // occupant s'il y en a un (future_talent_id), sinon poste remis vacant. Tout
        // autre cas (ongoing/renewable/non précisé) reste inchangé, simple signalement
        // visuel dans MissionsPage.renderMissions(). Une rotation remet explicitement
        // contract_status à null plutôt que d'hériter silencieusement de l'ancien
        // contrat, pour ne jamais afficher "Se termine" sur un contrat qui démarre.
        async function processExpiredMissions() {
            const now = Date.now();
            const toProcess = MissionsPage.currentMissions.filter(m =>
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
                    await MissionsPage.archiveOutgoingOccupant(mission);

                    if (mission.future_talent_id) {
                        const { data, error } = await capHumaWithRetry(() =>
                            MissionsPage.supabaseClient
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
                            await MissionsPage.markIncomingOccupant(mission.future_talent_id);
                            rotatedCount++;
                        }
                    } else {
                        const { data, error } = await capHumaWithRetry(() =>
                            MissionsPage.supabaseClient
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
                    MissionsPage.supabaseClient
                        .from('missions')
                        .select(MissionsPage.MISSIONS_COLUMNS)
                        .eq('pool', MissionsPage.currentPoolId)
                        .order('title', { ascending: true })
                );
                if (!refreshErr) MissionsPage.currentMissions = refreshed || MissionsPage.currentMissions;
            }
        }

        // Exposé sur MissionsPage pour appel depuis les autres fichiers de la page
        MissionsPage.loadMissions = loadMissions;

        // À la sortie d'un occupant (changement d'occupant, passage à vacant/recruiting,
        // ou suppression du poste) : archive ses évaluations dans
        // talents.archived_position_passages, puis met à jour son suivi de
        // disponibilité (is_currently_on_mission, last_mission_end_date, status).
        async function archiveOutgoingOccupant(mission) {
            if (!mission.occupant_id) return;

            const exitDate = mission.contract_end_date || new Date().toISOString().substring(0, 10);

            // 1. Archivage des évaluations (uniquement si des évaluations existent)
            const { data: evals, error: evalErr } = await capHumaWithRetry(() =>
                MissionsPage.supabaseClient
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
                    MissionsPage.supabaseClient
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

                const { data: passageUpdateData, error: passageUpdateErr } = await CapHumaData.updateTalent(MissionsPage.supabaseClient, 
                    mission.occupant_id, { archived_position_passages: updatedPassages }, 'id'
                );
                if (passageUpdateErr) throw passageUpdateErr;
                if (!passageUpdateData || passageUpdateData.length === 0) {
                    throw new Error("La mise à jour de l'historique du talent n'a affecté aucune ligne (policy RLS ?).");
                }

                // Suppression par mission_id, aucun contrôle de lignes affectées après
                // coup ici — idempotent, sûr à envelopper dans capHumaWithRetry().
                const { error: deleteErr } = await capHumaWithRetry(() =>
                    MissionsPage.supabaseClient
                        .from('evaluations')
                        .delete()
                        .eq('mission_id', mission.id)
                );
                if (deleteErr) throw deleteErr;
            }

            // Mise à jour du suivi de disponibilité, toujours faite même sans
            // évaluation à archiver.
            const { data: statusData, error: statusErr } = await CapHumaData.updateTalent(MissionsPage.supabaseClient, mission.occupant_id, {
                        is_currently_on_mission: false,
                        last_mission_end_date: exitDate,
                        status: 'En attente de poste'
                    }, 'id');
            if (statusErr) throw statusErr;
            if (!statusData || statusData.length === 0) {
                throw new Error("La mise à jour du statut du talent sortant n'a affecté aucune ligne (policy RLS ?).");
            }
        }

        // À l'entrée d'un talent sur un poste (nouvelle affectation ou rotation) : ses
        // compteurs repartent à zéro et le décompte des mois sans mission est gelé tant
        // qu'il reste occupant.
        async function markIncomingOccupant(talentId) {
            if (!talentId) return;

            // number_of_alima_missions n'est pas un simple incrément numérique mais
            // une progression par palier : none → one → two → three_plus.
            const { data: currentTalent, error: readErr } = await capHumaWithRetry(() =>
                MissionsPage.supabaseClient
                    .from('talents')
                    .select('number_of_alima_missions')
                    .eq('id', talentId)
                    .maybeSingle()
            );
            if (readErr) throw readErr;

            const currentCount = (currentTalent && currentTalent.number_of_alima_missions) || 'none';
            const newCount = currentCount === 'none' ? 'one' : (currentCount === 'one' ? 'two' : 'three_plus');

            const { data, error } = await CapHumaData.updateTalent(MissionsPage.supabaseClient, talentId, {
                        is_currently_on_mission: true,
                        months_without_mission: 0,
                        last_mission_end_date: null,
                        status: 'En poste ALIMA',
                        number_of_alima_missions: newCount,
                        had_alima_mission: true
                    }, 'id');
            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error("La mise à jour du talent entrant n'a affecté aucune ligne (policy RLS ?).");
            }
        }

        // Exposé sur MissionsPage pour appel depuis les autres fichiers de la page
        MissionsPage.markIncomingOccupant = markIncomingOccupant;
        MissionsPage.archiveOutgoingOccupant = archiveOutgoingOccupant;
})();
