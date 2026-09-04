// missions.js scindé en 4 fichiers par responsabilité — données/session (ce
// fichier), rendu (missions-render.js), CRUD postes (missions-crud.js),
// évaluations (missions-evaluations.js).
//
// Ce fichier N'EST PAS enveloppé dans une IIFE contrairement aux autres pages
// du site : les 4 fichiers de cette page doivent partager un état commun
// (session, postes chargés, pool courant...), impossible entre plusieurs
// balises <script> classiques sans un point de partage explicite — une IIFE
// isolerait totalement chaque fichier des 3 autres. MissionsPage est ce point
// unique : UN SEUL global, propre à cette page (jamais de window.xxx
// explicite ailleurs, jamais réutilisé par une autre page du site — vérifié).
// Décision utilisateur (option 1 proposée face à ce compromis) : préserve
// l'esprit de l'encapsulation en IIFE des autres pages (aucune fonction ni
// variable métier flottant dans le scope global un peu partout) tout en
// résolvant le partage inter-fichiers par un seul point nommé et documenté
// plutôt que plusieurs fuites implicites.
//
// Chaque fichier garde SA PROPRE IIFE pour ses déclarations locales (modales,
// helpers de formulaire...), et lit/écrit l'état partagé exclusivement via
// MissionsPage.xxx. Les fonctions appelées depuis un autre fichier sont
// exposées en fin de fichier via MissionsPage.nomDeFonction = nomDeFonction.
//
// Chargement requis dans missions.html, DANS CET ORDRE (scripts classiques,
// sans module) :
//   1. pages/missions.js               (ce fichier — déclare MissionsPage)
//   2. pages/missions-render.js
//   3. pages/missions-crud.js
//   4. pages/missions-evaluations.js
const MissionsPage = {};

(() => {
        // ============================================================================
        // HEADER COMMUN — injecté avant toute autre chose, y compris avant les
        // document.getElementById('pageTitle'/'userSubtitle'/'navTalents')
        // ci-dessous, puisqu'ils font partie du header injecté.
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
        // (chargé dans le head) — remplace l'ancien pont localStorage.

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

        // Un seul écouteur délégué, posé UNE FOIS ici plutôt que dans
        // MissionsPage.renderMissions() (voir plus bas), au lieu de re-sélectionner
        // et ré-attacher N écouteurs sur tout le conteneur à chaque rendu.
        // Comportement strictement identique — mêmes fonctions appelées avec le
        // même dataset.id, seul le mécanisme d'attachement change.
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

        // Échappement HTML systématique de toute donnée venant de la base
        // avant injection via innerHTML — prévention XSS.

        // toastMessage() retirée d'ici : vient désormais de shared/caphuma-utils.js.
        // Changement de mécanisme : cette page réutilisait un <div id="toast">
        // statique (toujours présent dans le HTML, désormais inutilisé mais
        // inoffensif) ; la version partagée crée son propre élément à chaque
        // appel, comme les autres pages.

        // Récupération du pool depuis l'URL (ex. missions.html?pool=COLOG)
        const urlParams = new URLSearchParams(window.location.search);
        MissionsPage.currentPoolId = (urlParams.get('pool') || urlParams.get('pool_id') || '').toUpperCase();

        if (!MissionsPage.currentPoolId) {
            poolSubheading.textContent = "Aucun pool sélectionné — retournez au tableau de bord.";
            missionsError.textContent = "Aucun pool indiqué dans l'URL. Accédez à cette page depuis le bouton « Postes » d'un pool sur le tableau de bord.";
            missionsError.classList.remove('hidden');
        }

        navTalents.href = 'talents.html?pool=' + encodeURIComponent(MissionsPage.currentPoolId);
        // L'analyse IA de ce pool a été déplacée sur statistics.html — lien
        // de redirection pour les habitués de l'ancien bouton "Analyser ce pool".
        document.getElementById('navPoolStats').href = 'statistics.html?pool=' + encodeURIComponent(MissionsPage.currentPoolId);

        // État en mémoire
        MissionsPage.currentUserId = null;
        MissionsPage.currentUserEmail = null;
        MissionsPage.currentUserRole = null;
        MissionsPage.currentUserName = null;
        MissionsPage.currentMissions = [];
        MissionsPage.currentPage = 1;
        MissionsPage.MISSIONS_PAGE_SIZE = 12;
        // Liste explicite des colonnes de "missions" réellement utilisées
        // dans ce fichier (vérifiée par grep exhaustif sur tout le fichier), utilisée à la
        // place de select('*') aux 2 endroits qui chargent la liste complète du pool
        // (loadMissions() + rafraîchissement après rotation automatique dans
        // processExpiredMissions()). Centralisée ici pour que les deux endroits restent
        // toujours synchronisés — si un jour un champ manque après l'ajout d'une nouvelle
        // fonctionnalité, il suffit de l'ajouter ICI, aux deux requêtes à la fois.
        MissionsPage.MISSIONS_COLUMNS = 'id, title, pool, pool_level, status, country, location, project_name, candidate_type, desk, occupant_id, contract_start_date, contract_end_date, contract_status, future_talent_id, future_contract_start_date, future_contract_end_date';
        MissionsPage.poolTalents = []; // talents du pool, pour les listes déroulantes occupant / futur occupant
        MissionsPage.talentNameById = {};

        // ============================================================================
        // JOURNAL D'AUDIT — voir id-card.html pour la logique détaillée.
        // Ne bloque jamais l'action métier si l'écriture du log échoue. Volontairement
        // pas d'instrumentation sur les évaluations individuelles (create/update/delete) :
        // trop bruyant pour peu de valeur RGPD, seules les actions sur les postes
        // eux-mêmes sont tracées ici.
        // ============================================================================
        // Fabriquée avec des getters (pas des valeurs) : relit MissionsPage.supabaseClient
        // et les MissionsPage.currentUser* à chaque appel de logAuditAction(), jamais
        // figée à la création.
        const logAuditAction = capHumaMakeAuditLogger(
            () => MissionsPage.supabaseClient,
            () => ({
                userId: MissionsPage.currentUserId,
                userEmail: MissionsPage.currentUserEmail,
                userName: typeof MissionsPage.currentUserName !== 'undefined' ? MissionsPage.currentUserName : null
            })
        );

        // Libellés d'affichage des valeurs stockées (jamais de valeur brute affichée à l'utilisateur)
        // STATUS_LABELS, DESK_LABELS, CANDIDATE_TYPE_LABELS, CONTRACT_STATUS_LABELS
        // sont désormais fournis par shared/caphuma-utils.js (valeurs identiques).
        MissionsPage.POOL_LEVEL_LABELS = { mission: 'Mission', project: 'Projet' };

        // ============================================================================
        // 2. GARDE DE SESSION (identique au pattern de dashboard.html)
        // ============================================================================
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

                // Édition réservée à admin + user (recruteur) ; visitor en lecture seule.
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
        capHumaInitModalA11y(); // voir shared/caphuma-utils.js

        document.getElementById('logoutBtn').addEventListener('click', async function () {
            await logAuditAction('logout', 'user', MissionsPage.currentUserId, MissionsPage.currentUserEmail, null);
            await MissionsPage.supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });

        // ============================================================================
        // 3. CHARGEMENT DU POOL, DES TALENTS DU POOL, ET DES POSTES
        // ============================================================================
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
                const { data: talents, error } = await capHumaWithRetry(() =>
                    MissionsPage.supabaseClient
                        .from('talents')
                        .select('id, first_name, last_name, pool')
                        .eq('pool', MissionsPage.currentPoolId)
                        .order('last_name', { ascending: true })
                );

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

                // Liste explicite de colonnes (MissionsPage.MISSIONS_COLUMNS ci-dessus)
                // au lieu de select('*') — la modale d'édition continue de se remplir
                // directement depuis cette liste (même logique qu'avant), juste avec
                // uniquement les colonnes qu'elle utilise réellement.
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
                // automatique. Les autres restent occupés, signalés visuellement dans
                // MissionsPage.renderMissions() (garde-fou explicite demandé par l'utilisateur).
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
        //         future_contract_start_date/end_date déjà saisies à l'avance) —
        //         jamais construit jusqu'ici ailleurs, cf. Hercules
        //         positions/mutations.ts : processExpiredContracts.
        //       • sinon → poste vacant (comportement inchangé).
        //   - tout autre cas (ongoing/renewable/non précisé) → aucune écriture
        //     automatique, seulement un signalement visuel (badge rouge) dans
        //     MissionsPage.renderMissions(), à charge de l'utilisateur de mettre à jour manuellement.
        //
        // Écart assumé par rapport à Hercules : le contract_status du poste est
        // explicitement remis à null lors d'une rotation (plutôt que silencieusement
        // hérité de l'ancien contrat, ce qui afficherait "Se termine" sur un contrat qui
        // vient de démarrer) — cohérent avec la philosophie du site : toute confirmation
        // de statut de contrat reste une décision humaine.
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

        // ============================================================================
        // 6 BIS. SORTIE / ENTRÉE D'UN OCCUPANT (suivi des compteurs)
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

                const { data: passageUpdateData, error: passageUpdateErr } = await capHumaWithRetry(() =>
                    MissionsPage.supabaseClient
                        .from('talents')
                        .update({ archived_position_passages: updatedPassages })
                        .eq('id', mission.occupant_id)
                        .select('id')
                );
                if (passageUpdateErr) throw passageUpdateErr;
                if (!passageUpdateData || passageUpdateData.length === 0) {
                    throw new Error("La mise à jour de l'historique du talent n'a affecté aucune ligne (policy RLS ?).");
                }

                // Enveloppé dans capHumaWithRetry() : suppression par mission_id,
                // aucun contrôle de lignes affectées ici — sûr à retenter (idempotent :
                // une 2e tentative ne trouve simplement plus rien à supprimer).
                const { error: deleteErr } = await capHumaWithRetry(() =>
                    MissionsPage.supabaseClient
                        .from('evaluations')
                        .delete()
                        .eq('mission_id', mission.id)
                );
                if (deleteErr) throw deleteErr;
            }

            // 2. Mise à jour du suivi de disponibilité du talent sortant (toujours faite,
            // même sans évaluation à archiver — c'est le point signalé par l'utilisateur).
            const { data: statusData, error: statusErr } = await capHumaWithRetry(() =>
                MissionsPage.supabaseClient
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
                MissionsPage.supabaseClient
                    .from('talents')
                    .select('number_of_alima_missions')
                    .eq('id', talentId)
                    .maybeSingle()
            );
            if (readErr) throw readErr;

            const currentCount = (currentTalent && currentTalent.number_of_alima_missions) || 'none';
            const newCount = currentCount === 'none' ? 'one' : (currentCount === 'one' ? 'two' : 'three_plus');

            const { data, error } = await capHumaWithRetry(() =>
                MissionsPage.supabaseClient
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

        // Exposé sur MissionsPage pour appel depuis les autres fichiers de la page
        MissionsPage.markIncomingOccupant = markIncomingOccupant;
        MissionsPage.archiveOutgoingOccupant = archiveOutgoingOccupant;
})();
