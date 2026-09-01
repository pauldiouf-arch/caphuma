// Correctif P23 (B13-Q1, Master Context §7) : script enveloppé dans une IIFE
// anonyme pour isoler sa portée — élimine tout risque qu'une déclaration
// top-level de cette page masque silencieusement une fonction/variable
// partagée (shared/caphuma-*.js) chargée avant elle, ou soit elle-même
// masquée par une autre page à l'avenir. Aucun changement de comportement :
// refactoring pur (règle de méthode citée en Master Context §0).
(() => {
        // ============================================================================
        // HEADER COMMUN (B4, Master Context §7) — injecté avant toute autre chose,
        // pour que #user-display-name et #logoutBtn existent dès la suite du script.
        // ============================================================================
        renderPageLayout({
            icon: '⛔',
            title: 'Dévalidés',
            actionsHtml: `
                <a href="red_list.html" class="border border-orange-200 hover:bg-orange-50 text-orange-700 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    ⚠️ Liste Rouge
                </a>
            `
        });

        // ============================================================================
        // 1. INITIALISATION SUPABASE (lecture dynamique localStorage, pont de compatibilité)
        // ============================================================================
        // SUPABASE_URL / SUPABASE_ANON_KEY viennent désormais de shared/caphuma-config.js
        // (chargé dans le head) — remplace l'ancien pont localStorage (MC13 Addendum U3).

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            window.location.replace('index.html');
        }

        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const appBody = document.getElementById('appBody');
        const poolsContainer = document.getElementById('poolsContainer');
        const pageError = document.getElementById('pageError');
        const emptyState = document.getElementById('emptyState');

        let currentUserId = null;
        let currentUserName = null;
        let currentUserRole = null;
        let currentUserEmail = null;

        // Échappement HTML systématique de toute donnée provenant de la base
        // avant injection via innerHTML — prévention XSS.

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

        // ============================================================================
        // 2. GARDE DE SESSION (identique au pattern de dashboard.html)
        // ============================================================================
        async function checkSession() {
            try {
                const s = await capHumaInitSession(supabaseClient);

                currentUserId = s.userId;
                currentUserEmail = s.email;
                document.getElementById('user-display-name').textContent = currentUserEmail;
                currentUserRole = s.role;
                currentUserName = s.name;

                // Page réservée admin + user (recruteur), bloquée pour visitor
                if (currentUserRole === 'visitor') {
                    throw new Error("Accès non autorisé pour ce rôle.");
                }

                appBody.style.display = '';
                await loadDevalidatedTalents();

            } catch (error) {
                console.warn("[Session Guard] Accès refusé, expulsion :", error.message);
                window.location.replace('dashboard.html');
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
        // 3. CHARGEMENT DES TALENTS DÉVALIDÉS
        // ============================================================================
        // Deux modes, sur le modèle déjà validé sur talents.html (Option A) :
        //  - Aucun filtre actif  → pagination réelle côté requête (20/page), liste
        //    plate triée par date de dévalidation, la plus simple et la plus rapide
        //    pour la navigation courante.
        //  - Un filtre actif (pool et/ou dates) → bascule vers le chargement complet
        //    des talents dévalidés, regroupés par pool comme avant la refonte (le
        //    filtrage par date n'est pas traduisible simplement en requête paginée
        //    combinée à un regroupement visuel par pool).
        let allPools = [];
        let allDevalidatedTalents = []; // uniquement rempli en mode "filtre actif"
        let devalidatedPage = 1;
        const DEVALIDATED_PAGE_SIZE = 20;

        // Correctif P7 (B17-L1, 27/08/2026, décision utilisateur) : affichage
        // progressif en mode FILTRÉ uniquement (pool/date) — le mode par défaut
        // ci-dessus est déjà paginé côté requête (20/page), pas concerné.
        // devalidatedPoolSections garde une référence à chaque section de pool
        // déjà construite, pour que "Afficher plus" y AJOUTE des lignes au lieu
        // de dupliquer le pool dans une nouvelle section plus bas (voir
        // renderGroupedByPool()).
        const RENDER_BATCH_SIZE = 25;
        let devalidatedFilteredTalents = [];
        let devalidatedRenderedCount = 0;
        let devalidatedPoolSections = {};

        const filterPoolSelect = document.getElementById('filterPool');
        const filterDateFrom = document.getElementById('filterDateFrom');
        const filterDateTo = document.getElementById('filterDateTo');
        const resetFiltersBtn = document.getElementById('resetFiltersBtn');
        const paginationContainer = document.createElement('div');
        paginationContainer.id = 'devalidatedPagination';
        paginationContainer.className = 'mt-4';
        poolsContainer.insertAdjacentElement('afterend', paginationContainer);

        function hasActiveFilters() {
            return !!(filterPoolSelect.value || filterDateFrom.value || filterDateTo.value);
        }

        function poolLabel(poolId) {
            const found = allPools.find(p => p.pool_id === poolId);
            return found ? (found.full_name || found.name) : (poolId || '—');
        }

        async function loadDevalidatedTalents(page) {
            try {
                // Liste des pools chargée une seule fois (sert au filtre + aux libellés).
                if (allPools.length === 0) {
                    const poolsRes = await capHumaWithRetry(() =>
                        supabaseClient.from('pools').select('pool_id, name, full_name').order('name', { ascending: true })
                    );
                    if (poolsRes.error) throw poolsRes.error;
                    allPools = poolsRes.data || [];
                    populatePoolFilterOptions();
                }

                if (hasActiveFilters()) {
                    paginationContainer.innerHTML = '';
                    await loadAndRenderFiltered();
                } else {
                    await loadAndRenderPaged(page || devalidatedPage);
                }
            } catch (error) {
                console.error("Erreur de chargement des dévalidés :", error);
                poolsContainer.innerHTML = '';
                pageError.textContent = "Impossible de charger les talents dévalidés : " + (error.message || 'erreur inconnue');
                pageError.classList.remove('hidden');
            }
        }

        // Mode par défaut (aucun filtre) : pagination réelle, liste plate.
        async function loadAndRenderPaged(page) {
            devalidatedPage = page;

            // Correctif P7 : ce mode a sa propre pagination (Précédent/Suivant),
            // pas de "Afficher plus" ici — on efface l'état du mode filtré pour
            // ne pas laisser un bouton/compteur d'une session de filtre précédente
            // affiché par erreur.
            devalidatedFilteredTalents = [];
            devalidatedRenderedCount = 0;
            updateDevalidatedShowMoreControls();

            // Note (P19) : paginateQuery() retente déjà automatiquement en interne
            // depuis la mise à jour de shared/caphuma-utils.js — rien à changer ici.
            const result = await paginateQuery(
                (c) => c.from('talents')
                    .select('id, first_name, last_name, pool, is_red_listed, devalidation_date, months_without_mission', { count: 'exact' })
                    .eq('is_valid', false)
                    .order('devalidation_date', { ascending: false }),
                supabaseClient,
                devalidatedPage,
                DEVALIDATED_PAGE_SIZE
            );

            poolsContainer.innerHTML = '';
            if (result.count === 0) {
                emptyState.classList.remove('hidden');
                emptyState.textContent = '✅ Aucun talent dévalidé actuellement.';
                paginationContainer.innerHTML = '';
                return;
            }
            emptyState.classList.add('hidden');

            const list = document.createElement('div');
            list.className = "bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden";
            result.data.forEach(t => list.appendChild(renderTalentRow(t, poolLabel(t.pool))));
            poolsContainer.appendChild(list);

            paginationContainer.innerHTML = renderPaginationControls(result.page, result.totalPages, result.count);
            paginationContainer.querySelector('[data-page-nav="prev"]')
                ?.addEventListener('click', () => loadDevalidatedTalents(devalidatedPage - 1));
            paginationContainer.querySelector('[data-page-nav="next"]')
                ?.addEventListener('click', () => loadDevalidatedTalents(devalidatedPage + 1));
        }

        // Mode filtré : comportement identique à avant la refonte (chargement complet,
        // regroupement par pool), simplement renommé pour plus de clarté.
        async function loadAndRenderFiltered() {
            const { data, error } = await capHumaWithRetry(() =>
                supabaseClient
                    .from('talents')
                    .select('id, first_name, last_name, pool, is_red_listed, devalidation_date, months_without_mission')
                    .eq('is_valid', false)
                    .order('devalidation_date', { ascending: false })
            );

            if (error) throw error;
            allDevalidatedTalents = data || [];
            applyFiltersAndRender();
        }

        // Peuple le filtre Pool à partir de l'ensemble des pools existants (et non plus
        // uniquement ceux représentés parmi les dévalidés, pour rester disponible même
        // en mode paginé où l'ensemble complet n'est pas chargé en mémoire).
        function populatePoolFilterOptions() {
            if (filterPoolSelect.dataset.populated === 'true') return;

            allPools.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.pool_id;
                opt.textContent = p.full_name || p.name;
                filterPoolSelect.appendChild(opt);
            });

            filterPoolSelect.dataset.populated = 'true';
        }

        // Applique les filtres actifs (pool, date début, date fin) sur les données
        // brutes en mémoire (mode filtré uniquement), puis (ré)affiche la liste
        // regroupée par pool.
        function applyFiltersAndRender() {
            const poolFilterVal = filterPoolSelect.value;
            const fromVal = filterDateFrom.value ? new Date(filterDateFrom.value + 'T00:00:00') : null;
            const toVal = filterDateTo.value ? new Date(filterDateTo.value + 'T23:59:59') : null;

            const filtered = allDevalidatedTalents.filter(t => {
                if (poolFilterVal && t.pool !== poolFilterVal) return false;

                if (fromVal || toVal) {
                    if (!t.devalidation_date) return false;
                    const dDate = new Date(t.devalidation_date);
                    if (fromVal && dDate < fromVal) return false;
                    if (toVal && dDate > toVal) return false;
                }

                return true;
            });

            if (filtered.length === 0) {
                poolsContainer.innerHTML = '';
                emptyState.classList.remove('hidden');
                emptyState.textContent = allDevalidatedTalents.length === 0
                    ? '✅ Aucun talent dévalidé actuellement.'
                    : '🔎 Aucun talent dévalidé ne correspond à ces filtres.';
                updateDevalidatedShowMoreControls();
                return;
            }

            emptyState.classList.add('hidden');

            // Correctif P7 : repart de zéro (nouveau filtre = nouveau résultat),
            // puis affiche le premier lot seulement.
            devalidatedFilteredTalents = filtered;
            devalidatedRenderedCount = 0;
            devalidatedPoolSections = {};
            poolsContainer.innerHTML = '';
            renderMoreDevalidated();
        }

        // Correctif P7 : affiche le prochain lot de devalidatedFilteredTalents,
        // en l'ajoutant aux sections de pool déjà à l'écran (append = true dès
        // le 2ᵉ lot) plutôt qu'en reconstruisant toute la page.
        function renderMoreDevalidated() {
            const isFirstBatch = devalidatedRenderedCount === 0;
            const batch = devalidatedFilteredTalents.slice(devalidatedRenderedCount, devalidatedRenderedCount + RENDER_BATCH_SIZE);
            renderGroupedByPool(allPools, batch, !isFirstBatch);
            devalidatedRenderedCount += batch.length;
            updateDevalidatedShowMoreControls();
        }

        // Correctif P7 : affiche/masque le bouton "Afficher plus" et le petit
        // texte "X sur Y affichés" du mode filtré.
        function updateDevalidatedShowMoreControls() {
            const showMoreBtn = document.getElementById('devalidatedShowMoreBtn');
            const countLabel = document.getElementById('devalidatedRenderedCountLabel');
            if (!showMoreBtn || !countLabel) return;

            if (!devalidatedFilteredTalents.length) {
                showMoreBtn.classList.add('hidden');
                countLabel.classList.add('hidden');
                return;
            }

            countLabel.classList.remove('hidden');
            const shown = Math.min(devalidatedRenderedCount, devalidatedFilteredTalents.length);
            countLabel.textContent = `${shown} sur ${devalidatedFilteredTalents.length} affiché${devalidatedFilteredTalents.length > 1 ? 's' : ''}`;

            showMoreBtn.classList.toggle('hidden', devalidatedRenderedCount >= devalidatedFilteredTalents.length);
        }

        document.getElementById('devalidatedShowMoreBtn')?.addEventListener('click', renderMoreDevalidated);

        filterPoolSelect.addEventListener('change', () => loadDevalidatedTalents());
        filterDateFrom.addEventListener('change', () => loadDevalidatedTalents());
        filterDateTo.addEventListener('change', () => loadDevalidatedTalents());

        resetFiltersBtn.addEventListener('click', () => {
            filterPoolSelect.value = '';
            filterDateFrom.value = '';
            filterDateTo.value = '';
            devalidatedPage = 1;
            loadDevalidatedTalents(1);
        });

        function renderGroupedByPool(pools, talents, append = false) {
            if (!append) {
                poolsContainer.innerHTML = '';
                devalidatedPoolSections = {};
            }

            // Regroupement par pool_id, en conservant l'ordre des pools connus
            const grouped = {};
            talents.forEach(t => {
                const key = t.pool || '—';
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(t);
            });

            Object.keys(grouped).forEach(poolId => {
                // Correctif P7 : si ce pool a déjà sa section (lot précédent), on
                // récupère sa liste existante pour y AJOUTER les nouvelles lignes,
                // au lieu de créer une 2ᵉ section dupliquée pour le même pool.
                let existing = devalidatedPoolSections[poolId];
                let list;
                let countBadge;

                if (existing) {
                    list = existing.list;
                    countBadge = existing.countBadge;
                } else {
                    const section = document.createElement('div');
                    section.className = "bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden";

                    const header = document.createElement('div');
                    header.className = "px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between";
                    header.innerHTML = `
                        <h3 class="text-sm font-extrabold text-slate-700">${escapeHtml(poolLabel(poolId))}</h3>
                        <span class="text-xs font-bold text-slate-400" data-pool-count>0 talent(s)</span>
                    `;
                    section.appendChild(header);

                    list = document.createElement('div');
                    list.className = "divide-y divide-slate-100";
                    section.appendChild(list);

                    countBadge = header.querySelector('[data-pool-count]');
                    poolsContainer.appendChild(section);
                    devalidatedPoolSections[poolId] = { list, countBadge, count: 0 };
                    existing = devalidatedPoolSections[poolId];
                }

                grouped[poolId].forEach(t => {
                    list.appendChild(renderTalentRow(t));
                    existing.count++;
                });
                countBadge.textContent = `${existing.count} talent(s)`;
            });
        }

        function renderTalentRow(t, poolLabelText) {
            const row = document.createElement('div');
            row.className = "px-5 py-4 flex flex-wrap items-center justify-between gap-3";

            const dateStr = t.devalidation_date
                ? new Date(t.devalidation_date).toLocaleDateString('fr-FR')
                : 'Date inconnue';

            const redListBadge = t.is_red_listed
                ? `<span class="ml-2 text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 rounded px-1.5 py-0.5">Déjà en Liste Rouge</span>`
                : '';

            const poolBadge = poolLabelText
                ? `<span class="ml-2 text-[10px] font-bold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">${escapeHtml(poolLabelText)}</span>`
                : '';

            row.innerHTML = `
                <div>
                    <a href="id-card.html?id=${encodeURIComponent(t.id)}" class="font-bold text-sm text-slate-800 hover:text-primary transition-all">
                        ${escapeHtml(t.first_name)} ${escapeHtml(t.last_name)}
                    </a>
                    ${poolBadge}
                    ${redListBadge}
                    <p class="text-xs text-slate-400 mt-0.5">
                        Dévalidé le ${dateStr}
                        ${t.months_without_mission !== null && t.months_without_mission !== undefined ? ` · ${escapeHtml(t.months_without_mission)} mois sans mission` : ''}
                    </p>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                    <button class="btn-reintegrer bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-lg text-xs font-bold transition-all">
                        ✅ Réintégrer
                    </button>
                    ${!t.is_red_listed ? `
                    <button class="btn-redlist bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 px-3 py-2 rounded-lg text-xs font-bold transition-all">
                        ⚠️ Liste Rouge
                    </button>` : ''}
                    ${currentUserRole === 'admin' ? `
                    <button class="btn-delete bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition-all">
                        🗑️ Supprimer définitivement
                    </button>` : ''}
                </div>
            `;

            row.querySelector('.btn-reintegrer').addEventListener('click', () => reintegrateTalent(t));
            const redListBtn = row.querySelector('.btn-redlist');
            if (redListBtn) redListBtn.addEventListener('click', () => openRedListModal(t));
            const deleteBtn = row.querySelector('.btn-delete');
            if (deleteBtn) deleteBtn.addEventListener('click', () => deleteTalentDefinitively(t));

            return row;
        }

        // ============================================================================
        // 4. ACTION : RÉINTÉGRER (identique à la logique de id-card.html, section 6.4)
        // ============================================================================
        async function reintegrateTalent(t) {
            const confirmed = confirm(`Réintégrer ${t.first_name} ${t.last_name} ?\n\nLe talent redeviendra valide et retrouvera son statut normal dans les listes.`);
            if (!confirmed) return;

            try {
                const { error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('talents')
                        // Correctif du 19/08/2026 : même logique que id-card.html — la jauge
                        // "mois sans mission" doit repartir de zéro à partir d'AUJOURD'HUI, pas
                        // de l'ancienne fin de mission (last_mission_end_date est prioritaire
                        // sur pool_integration_date dans calculateMonthsWithoutMission, donc la
                        // vider est nécessaire). months_without_mission ajouté aussi ici : cette
                        // page ne le remettait pas à zéro, contrairement à id-card.html — écart
                        // corrigé au passage.
                        .update({
                            is_valid: true,
                            devalidation_date: null,
                            devalidation_extension_until: null,
                            devalidation_extension_months: null,
                            devalidation_extension_granted_by: null,
                            devalidation_extension_granted_by_name: null,
                            devalidation_extension_granted_at: null,
                            months_without_mission: 0,
                            last_mission_end_date: null,
                            pool_integration_date: new Date().toISOString()
                        })
                        .eq('id', t.id)
                );

                if (error) throw error;

                // logAuditAction('reintegrate', ...) retiré le 19/08/2026 (A5) : couvert
                // désormais par le trigger Postgres trg_audit_talents.
                await loadDevalidatedTalents();

            } catch (error) {
                alert("Erreur lors de la réintégration : " + (error.message || 'erreur inconnue'));
            }
        }

        // ============================================================================
        // 5. ACTION : METTRE EN LISTE ROUGE (même dialogue que red_list.html / id-card.html)
        // ============================================================================
        let redListTargetTalent = null;
        const redListModal = document.getElementById('redListModal');
        const redListReasonInput = document.getElementById('redListReasonInput');
        const redListModalError = document.getElementById('redListModalError');
        const redListModalTalentName = document.getElementById('redListModalTalentName');

        // ----------------------------------------------------------------------------
        // BROUILLON LOCAL (backlog B15-R1, priorité P20) — un seul champ (motif), clé
        // par talent puisque cette modale s'ouvre toujours pour un talent précis (t.id,
        // paramètre de openRedListModal ci-dessous). Même schéma que talentForm/
        // evaluationForm : ouverture → offre de restauration + autosave ; Annuler/× →
        // arrêt seul (le brouillon reste, voir correctif du 01/09/2026 sur talentForm) ;
        // succès → effacement définitif.
        let currentRedListDraftKey = null;
        let currentRedListDraftBinding = null;

        function startRedListDraftTracking(talentId) {
            stopRedListDraftTracking();
            currentRedListDraftKey = `draft:redlist_devalidated:${talentId}`;
            capHumaOfferDraftRestore(currentRedListDraftKey, (data) => capHumaDefaultDraftRestore(redListModal, data));
            currentRedListDraftBinding = capHumaAttachDraftAutosave(redListModal, currentRedListDraftKey);
        }

        function stopRedListDraftTracking() {
            if (currentRedListDraftBinding) {
                currentRedListDraftBinding.stop();
                currentRedListDraftBinding = null;
            }
        }

        function discardRedListDraft() {
            stopRedListDraftTracking();
            if (currentRedListDraftKey) {
                capHumaDraftClear(currentRedListDraftKey);
                currentRedListDraftKey = null;
            }
        }

        function openRedListModal(t) {
            redListTargetTalent = t;
            redListReasonInput.value = '';
            redListModalError.classList.add('hidden');
            redListModalTalentName.textContent = `${t.first_name} ${t.last_name}`;
            redListModal.classList.remove('hidden');
            redListModal.classList.add('flex');
            startRedListDraftTracking(t.id);
        }

        function closeRedListModal() {
            redListModal.classList.add('hidden');
            redListModal.classList.remove('flex');
            redListTargetTalent = null;
        }

        document.getElementById('redListModalCancel').addEventListener('click', () => {
            closeRedListModal();
            stopRedListDraftTracking();
        });

        document.getElementById('redListModalConfirm').addEventListener('click', async () => {
            const reason = redListReasonInput.value.trim();
            if (!reason) {
                redListModalError.textContent = "Le motif est obligatoire.";
                redListModalError.classList.remove('hidden');
                return;
            }

            try {
                const { error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('talents')
                        .update({
                            is_red_listed: true,
                            red_list_date: new Date().toISOString(),
                            red_list_reason: reason,
                            red_list_added_by: currentUserId,
                            red_list_added_by_name: currentUserName
                        })
                        .eq('id', redListTargetTalent.id)
                );

                if (error) throw error;

                // logAuditAction('add_to_red_list', ...) retiré le 19/08/2026 (A5) :
                // couvert désormais par le trigger Postgres trg_audit_talents (reprend
                // le motif via red_list_reason).
                closeRedListModal();
                discardRedListDraft();
                await loadDevalidatedTalents();

            } catch (error) {
                redListModalError.textContent = "Erreur : " + (error.message || 'erreur inconnue');
                redListModalError.classList.remove('hidden');
            }
        });

        // ============================================================================
        // 6. ACTION : SUPPRESSION DÉFINITIVE
        // ============================================================================
        async function deleteTalentDefinitively(t) {
            const confirmed = confirm(
                `⚠️ SUPPRESSION DÉFINITIVE de ${t.first_name} ${t.last_name}.\n\n` +
                `Cette action est irréversible et efface toute la fiche du talent (historique compris).\n\n` +
                `Il n'existe aujourd'hui aucune suppression automatique des fiches talents : ` +
                `cette suppression manuelle est le seul moyen d'effacer définitivement cette fiche.\n\n` +
                `Confirmez-vous ?`
            );
            if (!confirmed) return;

            const doubleCheck = confirm("Dernière confirmation : voulez-vous vraiment supprimer définitivement cette fiche ?");
            if (!doubleCheck) return;

            try {
                // Nettoyage des données liées avant suppression du talent — la règle
                // ON DELETE de ces FK vers talents.id n'a jamais été vérifiée, donc
                // suppression défensive plutôt que de compter sur une cascade non confirmée
                // (même correctif que id-card.html, cf. Master Context règle de méthode n°19).
                await capHumaWithRetry(() => supabaseClient.from('evaluations').delete().eq('talent_id', t.id));
                await capHumaWithRetry(() => supabaseClient.from('comments').delete().eq('talent_id', t.id));
                await capHumaWithRetry(() => supabaseClient.from('share_tokens').delete().eq('talent_id', t.id));

                // ⚠️ Volontairement PAS enveloppé dans capHumaWithRetry() (P19) : le
                // contrôle juste en dessous (data.length === 0 → throw) sert à
                // détecter un DELETE bloqué silencieusement par une policy RLS
                // (règle de méthode n°15). Avec un retry automatique, ce même
                // signal ("0 ligne affectée") deviendrait ambigu : il pourrait
                // aussi bien vouloir dire "1re tentative en fait réussie, réponse
                // perdue, 2e tentative ne retrouve plus rien à supprimer" — ce qui
                // ferait afficher à tort une erreur RLS après une suppression en
                // réalité déjà effective. Un retry casserait ici la fiabilité d'un
                // contrôle conçu spécifiquement pour cette page.
                const { data, error } = await supabaseClient
                    .from('talents')
                    .delete()
                    .eq('id', t.id)
                    .select('id');

                if (error) throw error;

                // Un DELETE Supabase peut "réussir" sans erreur tout en n'affectant aucune
                // ligne si une policy RLS bloque silencieusement (cf. Master Context règle de
                // méthode n°15) — vérification explicite plutôt qu'un faux succès.
                if (!data || data.length === 0) {
                    throw new Error("La suppression n'a affecté aucune ligne (policy RLS ?).");
                }

                // logAuditAction('delete', ...) retiré le 19/08/2026 (A5) : couvert
                // désormais par le trigger Postgres trg_audit_talents (distingue
                // actif/dévalidé via is_valid au moment de la suppression).
                await loadDevalidatedTalents();

            } catch (error) {
                alert("Erreur lors de la suppression : " + (error.message || 'erreur inconnue') + "\n\nSi cette erreur persiste, il est possible qu'une policy RLS bloque la suppression directe pour votre rôle — à vérifier côté Supabase.");
            }
        }
})();
