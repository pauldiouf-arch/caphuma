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

        MissionsPage.supabaseClient = capHumaGetSupabaseClient();

        const appBody = document.getElementById('appBody');
        const userSubtitle = document.getElementById('userSubtitle');
        const pageTitle = document.getElementById('pageTitle');
        const poolHeading = document.getElementById('poolHeading');
        const poolSubheading = document.getElementById('poolSubheading');
        const navTalents = document.getElementById('navTalents');
        const missionsGrid = document.getElementById('missionsGrid');

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
        MissionsPage.MISSIONS_COLUMNS = 'id, title, pool, pool_level, status, country, country_code, location, project_name, candidate_type, desk, occupant_id, contract_start_date, contract_end_date, contract_end_type, contract_status, future_talent_id, future_contract_start_date, future_contract_end_date';
        MissionsPage.poolTalents = [];
        MissionsPage.poolTalentsLoadFailed = false;
        MissionsPage.talentNameById = {};

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
                const [expatsRes, nationalRes] = await Promise.all([
                    CapHumaData.getTalents(MissionsPage.supabaseClient, {
                        select: 'id, first_name, last_name, pool, staff_type, nationality_code, is_red_listed, is_valid, status',
                        filters: { pool: MissionsPage.currentPoolId },
                        orderBy: 'last_name'
                    }),
                    CapHumaData.getTalents(MissionsPage.supabaseClient, {
                        select: 'id, first_name, last_name, pool, staff_type, nationality_code, is_red_listed, is_valid, status',
                        filters: { staff_type: 'national', tracking_pool: MissionsPage.currentPoolId },
                        orderBy: 'last_name'
                    })
                ]);

                if (expatsRes.error) throw expatsRes.error;
                if (nationalRes.error) throw nationalRes.error;

                // Filtré côté client : is_red_listed vaut souvent NULL, que .eq(false) exclurait.
                MissionsPage.poolTalents = [...(expatsRes.data || []), ...(nationalRes.data || [])]
                    .filter(t => !t.is_red_listed && t.is_valid !== false);
                MissionsPage.talentNameById = {};
                MissionsPage.poolTalents.forEach(t => {
                    MissionsPage.talentNameById[t.id] = `${t.first_name || ''} ${t.last_name || ''}`.trim();
                });

                populateTalentDropdown('fieldOccupant');
                populateTalentDropdown('fieldFutureOccupant');

            } catch (error) {
                console.error("Erreur de récupération des talents du pool :", error);
                MissionsPage.poolTalentsLoadFailed = true;
                toastMessage("Liste des talents du pool non chargée : rechargez la page.", 'error');
            }
        }

        function getEligibleTalents() {
            const all = MissionsPage.poolTalents || [];
            const candidateType = document.getElementById('fieldCandidateType').value;
            const poolLevel = document.getElementById('fieldPoolLevel').value;
            const countryCode = document.getElementById('fieldCountry').value;

            if (candidateType === 'expat' || !candidateType) {
                return all.filter(t => t.staff_type !== 'national' && t.nationality_code !== countryCode);
            }
            if (candidateType === 'nat') {
                return all.filter(t => t.nationality_code === countryCode);
            }
            if (candidateType === 'detache') {
                if (poolLevel === 'project') {
                    return all.filter(t => t.staff_type === 'national' && t.nationality_code !== countryCode && t.status === 'En poste ALIMA');
                }
                return all.filter(t => t.nationality_code !== countryCode);
            }
            return all;
        }

        function populateTalentDropdown(selectId) {
            const select = document.getElementById(selectId);
            const currentValue = select.value;
            const eligible = getEligibleTalents();
            select.innerHTML = '<option value="">— Aucun —</option>';
            eligible.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = `${t.first_name || ''} ${t.last_name || ''}`.trim() + (t.staff_type === 'national' ? ' (staff national)' : '');
                select.appendChild(opt);
            });
            select.value = eligible.some(t => t.id === currentValue) ? currentValue : '';
        }

        async function loadMissions() {
            try {
                missionsError.classList.add('hidden');

                const { data: missions, error } = await capHumaSelectAllPages(() =>
                    MissionsPage.supabaseClient
                        .from('missions')
                        .select(MissionsPage.MISSIONS_COLUMNS, { count: 'exact' })
                        .eq('pool', MissionsPage.currentPoolId)
                        .order('title', { ascending: true })
                        .order('id')
                );

                if (error) throw error;

                MissionsPage.currentMissions = missions || [];
                MissionsPage.currentPage = 1;

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

        function notifyExpiredMissionsProcessed(rotatedCount, vacatedCount) {
            const parts = [];
            if (rotatedCount > 0) parts.push(`${rotatedCount} poste(s) automatiquement transféré(s) au futur occupant prévu`);
            if (vacatedCount > 0) parts.push(`${vacatedCount} poste(s) automatiquement libéré(s)`);
            toastMessage(parts.join(' · ') + ' suite à une fin de contrat confirmée.', 'success');
        }

        async function refreshCurrentMissions() {
            const { data: refreshed, error } = await capHumaSelectAllPages(() =>
                MissionsPage.supabaseClient
                    .from('missions')
                    .select(MissionsPage.MISSIONS_COLUMNS, { count: 'exact' })
                    .eq('pool', MissionsPage.currentPoolId)
                    .order('title', { ascending: true })
                    .order('id')
            );
            if (!error) MissionsPage.currentMissions = refreshed || MissionsPage.currentMissions;
        }

        async function processExpiredMissions() {
            const { data, error } = await capHumaWithRetry(() =>
                MissionsPage.supabaseClient.rpc('process_expired_missions', { p_pool: MissionsPage.currentPoolId })
            );
            if (error) {
                console.error("Erreur de traitement automatique des contrats expirés :", error);
                return;
            }

            const { rotated_count: rotatedCount, vacated_count: vacatedCount } = (data && data[0]) || {};
            if (rotatedCount > 0 || vacatedCount > 0) {
                notifyExpiredMissionsProcessed(rotatedCount, vacatedCount);
                await refreshCurrentMissions();
            }
        }

        MissionsPage.loadMissions = loadMissions;

        MissionsPage.populateTalentDropdown = populateTalentDropdown;
})();
