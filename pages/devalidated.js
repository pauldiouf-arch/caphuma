(() => {
        renderPageLayout({
            icon: CapHumaIcons.get('ban', 'w-5 h-5'),
            title: 'Dévalidés',
            actionsHtml: `
                <a href="red_list.html" class="border border-orange-200 hover:bg-orange-50 text-orange-700 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    ${CapHumaIcons.get('alertTriangle', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0')} Liste Rouge
                </a>
            `
        });

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            window.location.replace('index.html');
        }

        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const appBody = document.getElementById('appBody');
        const poolsContainer = document.getElementById('poolsContainer');
        const pageError = document.getElementById('pageError');
        const emptyState = document.getElementById('emptyState');

        // Contrairement à TalentsPage/MissionsPage, cette page n'a jamais été
        // scindée en plusieurs fichiers : pas besoin de sortir cet état de l'IIFE.
        const pageState = {};

        pageState.currentUserId = null;
        pageState.currentUserName = null;
        pageState.currentUserRole = null;
        pageState.currentUserEmail = null;

        // Délègue à capHumaLogAudit() (shared/caphuma-auth.js) directement plutôt que
        // via capHumaMakeAuditLogger(), cette page n'ayant qu'un seul point d'appel.
        async function logAuditAction(action, entityType, entityId, entityName, details) {
            const userName = typeof pageState.currentUserName !== 'undefined' ? pageState.currentUserName : null;
            await capHumaLogAudit(
                supabaseClient,
                { userId: pageState.currentUserId, userEmail: pageState.currentUserEmail, userName: userName },
                action, entityType, entityId, entityName, details
            );
        }

        async function checkSession() {
            try {
                const s = await capHumaInitSession(supabaseClient);

                pageState.currentUserId = s.userId;
                pageState.currentUserEmail = s.email;
                document.getElementById('user-display-name').textContent = pageState.currentUserEmail;
                pageState.currentUserRole = s.role;
                pageState.currentUserName = s.name;

                if (pageState.currentUserRole === 'visitor') {
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
        capHumaInitModalA11y();

        document.getElementById('logoutBtn').addEventListener('click', async function () {
            await logAuditAction('logout', 'user', pageState.currentUserId, pageState.currentUserEmail, null);
            await supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });

        // Deux modes : aucun filtre actif → pagination réelle côté requête (20/page),
        // liste plate ; un filtre actif (pool et/ou dates) → chargement complet des
        // talents dévalidés, regroupés par pool (le filtrage par date n'est pas
        // traduisible simplement en requête paginée combinée à un regroupement visuel).
        pageState.allPools = [];
        pageState.allDevalidatedTalents = []; // uniquement rempli en mode "filtre actif"
        pageState.devalidatedPage = 1;
        const DEVALIDATED_PAGE_SIZE = 20;

        // pageState.devalidatedPoolSections garde une référence à chaque section de
        // pool déjà construite, pour que "Afficher plus" y ajoute des lignes au lieu
        // d'en dupliquer une pour le même pool (voir renderGroupedByPool()).
        const RENDER_BATCH_SIZE = 25;
        pageState.devalidatedFilteredTalents = [];
        pageState.devalidatedRenderedCount = 0;
        pageState.devalidatedPoolSections = {};

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
            const found = pageState.allPools.find(p => p.pool_id === poolId);
            return found ? (found.full_name || found.name) : (poolId || '—');
        }

        async function loadDevalidatedTalents(page) {
            try {
                // Liste des pools chargée une seule fois (sert au filtre + aux libellés).
                if (pageState.allPools.length === 0) {
                    const poolsRes = await CapHumaData.getPools(supabaseClient, { select: 'pool_id, name, full_name', orderBy: 'name' });
                    if (poolsRes.error) throw poolsRes.error;
                    pageState.allPools = poolsRes.data || [];
                    populatePoolFilterOptions();
                }

                if (hasActiveFilters()) {
                    paginationContainer.innerHTML = '';
                    await loadAndRenderFiltered();
                } else {
                    await loadAndRenderPaged(page || pageState.devalidatedPage);
                }
            } catch (error) {
                console.error("Erreur de chargement des dévalidés :", error);
                poolsContainer.innerHTML = '';
                pageError.textContent = "Impossible de charger les talents dévalidés : " + (error.message || 'erreur inconnue');
                pageError.classList.remove('hidden');
            }
        }

        async function loadAndRenderPaged(page) {
            pageState.devalidatedPage = page;

            // Efface l'état du mode filtré, pour ne pas laisser un bouton/compteur
            // d'une session de filtre précédente affiché par erreur.
            pageState.devalidatedFilteredTalents = [];
            pageState.devalidatedRenderedCount = 0;
            updateDevalidatedShowMoreControls();

            const result = await paginateQuery(
                (c) => c.from('talents')
                    .select('id, first_name, last_name, pool, is_red_listed, devalidation_date, months_without_mission, red_list_documents', { count: 'exact' })
                    .eq('is_valid', false)
                    .order('devalidation_date', { ascending: false }),
                supabaseClient,
                pageState.devalidatedPage,
                DEVALIDATED_PAGE_SIZE
            );

            poolsContainer.innerHTML = '';
            if (result.count === 0) {
                emptyState.classList.remove('hidden');
                emptyState.textContent = 'Aucun talent dévalidé actuellement.';
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
                ?.addEventListener('click', () => loadDevalidatedTalents(pageState.devalidatedPage - 1));
            paginationContainer.querySelector('[data-page-nav="next"]')
                ?.addEventListener('click', () => loadDevalidatedTalents(pageState.devalidatedPage + 1));
        }

        async function loadAndRenderFiltered() {
            const { data, error } = await CapHumaData.getTalents(supabaseClient, {
                select: 'id, first_name, last_name, pool, is_red_listed, devalidation_date, months_without_mission, red_list_documents',
                filters: { is_valid: false },
                orderBy: ['devalidation_date', false]
            });

            if (error) throw error;
            pageState.allDevalidatedTalents = data || [];
            applyFiltersAndRender();
        }

        // Ensemble des pools existants, pas seulement ceux représentés parmi les
        // dévalidés — reste disponible même en mode paginé, où l'ensemble complet
        // des talents dévalidés n'est pas chargé en mémoire.
        function populatePoolFilterOptions() {
            if (filterPoolSelect.dataset.populated === 'true') return;

            pageState.allPools.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.pool_id;
                opt.textContent = p.full_name || p.name;
                filterPoolSelect.appendChild(opt);
            });

            filterPoolSelect.dataset.populated = 'true';
        }

        function applyFiltersAndRender() {
            const poolFilterVal = filterPoolSelect.value;
            const fromVal = filterDateFrom.value ? new Date(filterDateFrom.value + 'T00:00:00') : null;
            const toVal = filterDateTo.value ? new Date(filterDateTo.value + 'T23:59:59') : null;

            const filtered = pageState.allDevalidatedTalents.filter(t => {
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
                emptyState.textContent = pageState.allDevalidatedTalents.length === 0
                    ? 'Aucun talent dévalidé actuellement.'
                    : 'Aucun talent dévalidé ne correspond à ces filtres.';
                updateDevalidatedShowMoreControls();
                return;
            }

            emptyState.classList.add('hidden');

            // Repart de zéro (nouveau filtre = nouveau résultat).
            pageState.devalidatedFilteredTalents = filtered;
            pageState.devalidatedRenderedCount = 0;
            pageState.devalidatedPoolSections = {};
            poolsContainer.innerHTML = '';
            renderMoreDevalidated();
        }

        // Ajoute le prochain lot aux sections de pool déjà à l'écran (append = true
        // dès le 2ᵉ lot) plutôt que de reconstruire toute la page.
        function renderMoreDevalidated() {
            const isFirstBatch = pageState.devalidatedRenderedCount === 0;
            const batch = pageState.devalidatedFilteredTalents.slice(pageState.devalidatedRenderedCount, pageState.devalidatedRenderedCount + RENDER_BATCH_SIZE);
            renderGroupedByPool(pageState.allPools, batch, !isFirstBatch);
            pageState.devalidatedRenderedCount += batch.length;
            updateDevalidatedShowMoreControls();
        }

        function updateDevalidatedShowMoreControls() {
            const showMoreBtn = document.getElementById('devalidatedShowMoreBtn');
            const countLabel = document.getElementById('devalidatedRenderedCountLabel');
            if (!showMoreBtn || !countLabel) return;

            if (!pageState.devalidatedFilteredTalents.length) {
                showMoreBtn.classList.add('hidden');
                countLabel.classList.add('hidden');
                return;
            }

            countLabel.classList.remove('hidden');
            const shown = Math.min(pageState.devalidatedRenderedCount, pageState.devalidatedFilteredTalents.length);
            countLabel.textContent = `${shown} sur ${pageState.devalidatedFilteredTalents.length} affiché${pageState.devalidatedFilteredTalents.length > 1 ? 's' : ''}`;

            showMoreBtn.classList.toggle('hidden', pageState.devalidatedRenderedCount >= pageState.devalidatedFilteredTalents.length);
        }

        document.getElementById('devalidatedShowMoreBtn')?.addEventListener('click', renderMoreDevalidated);

        filterPoolSelect.addEventListener('change', () => loadDevalidatedTalents());
        filterDateFrom.addEventListener('change', () => loadDevalidatedTalents());
        filterDateTo.addEventListener('change', () => loadDevalidatedTalents());

        resetFiltersBtn.addEventListener('click', () => {
            filterPoolSelect.value = '';
            filterDateFrom.value = '';
            filterDateTo.value = '';
            pageState.devalidatedPage = 1;
            loadDevalidatedTalents(1);
        });

        function renderGroupedByPool(pools, talents, append = false) {
            if (!append) {
                poolsContainer.innerHTML = '';
                pageState.devalidatedPoolSections = {};
            }

            const grouped = {};
            talents.forEach(t => {
                const key = t.pool || '—';
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(t);
            });

            Object.keys(grouped).forEach(poolId => {
                // Section déjà créée pour ce pool (lot précédent) ? On y ajoute les
                // nouvelles lignes plutôt que d'en créer une 2ᵉ dupliquée.
                let existing = pageState.devalidatedPoolSections[poolId];
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
                        <span class="text-xs font-bold text-slate-500" data-pool-count>0 talent(s)</span>
                    `;
                    section.appendChild(header);

                    list = document.createElement('div');
                    list.className = "divide-y divide-slate-100";
                    section.appendChild(list);

                    countBadge = header.querySelector('[data-pool-count]');
                    poolsContainer.appendChild(section);
                    pageState.devalidatedPoolSections[poolId] = { list, countBadge, count: 0 };
                    existing = pageState.devalidatedPoolSections[poolId];
                }

                // DocumentFragment (hors DOM) puis un seul appendChild final.
                const fragment = document.createDocumentFragment();
                grouped[poolId].forEach(t => {
                    fragment.appendChild(renderTalentRow(t));
                    existing.count++;
                });
                list.appendChild(fragment);
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
                    <p class="text-xs text-slate-500 mt-0.5">
                        Dévalidé le ${dateStr}
                        ${t.months_without_mission !== null && t.months_without_mission !== undefined ? ` · ${escapeHtml(t.months_without_mission)} mois sans mission` : ''}
                    </p>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                    <button class="btn-reintegrer bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-lg text-xs font-bold transition-all">
                        ${CapHumaIcons.get('checkCircle', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0')} Réintégrer
                    </button>
                    ${!t.is_red_listed ? `
                    <button class="btn-redlist bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 px-3 py-2 rounded-lg text-xs font-bold transition-all">
                        ${CapHumaIcons.get('alertTriangle', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0')} Liste Rouge
                    </button>` : ''}
                    ${pageState.currentUserRole === 'admin' ? `
                    <button class="btn-delete bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition-all">
                        ${CapHumaIcons.get('trash', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0')} Supprimer définitivement
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

        async function reintegrateTalent(t) {
            const confirmed = confirm(`Réintégrer ${t.first_name} ${t.last_name} ?\n\nLe talent redeviendra valide et retrouvera son statut normal dans les listes.`);
            if (!confirmed) return;

            try {
                // La jauge "mois sans mission" doit repartir de zéro à partir
                // d'aujourd'hui : last_mission_end_date est prioritaire sur
                // pool_integration_date dans calculateMonthsWithoutMission(), donc
                // la vider est nécessaire pour que ce soit bien le cas.
                const { error } = await CapHumaData.updateTalent(supabaseClient, t.id, {
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
                        });

                if (error) throw error;

                // Pas d'appel à logAuditAction('reintegrate', ...) : couvert par le
                // trigger Postgres trg_audit_talents.
                await loadDevalidatedTalents();

            } catch (error) {
                alert("Erreur lors de la réintégration : " + (error.message || 'erreur inconnue'));
            }
        }

        pageState.redListTargetTalent = null;
        const redListModal = document.getElementById('redListModal');
        const redListReasonInput = document.getElementById('redListReasonInput');
        const redListModalError = document.getElementById('redListModalError');
        const redListModalTalentName = document.getElementById('redListModalTalentName');

        // Un seul champ (motif), clé par talent (t.id).
        pageState.currentRedListDraftKey = null;
        pageState.currentRedListDraftBinding = null;

        function startRedListDraftTracking(talentId) {
            stopRedListDraftTracking();
            pageState.currentRedListDraftKey = `draft:redlist_devalidated:${talentId}`;
            capHumaOfferDraftRestore(pageState.currentRedListDraftKey, (data) => capHumaDefaultDraftRestore(redListModal, data));
            pageState.currentRedListDraftBinding = capHumaAttachDraftAutosave(redListModal, pageState.currentRedListDraftKey);
        }

        function stopRedListDraftTracking() {
            if (pageState.currentRedListDraftBinding) {
                pageState.currentRedListDraftBinding.stop();
                pageState.currentRedListDraftBinding = null;
            }
        }

        function discardRedListDraft() {
            stopRedListDraftTracking();
            if (pageState.currentRedListDraftKey) {
                capHumaDraftClear(pageState.currentRedListDraftKey);
                pageState.currentRedListDraftKey = null;
            }
        }

        function openRedListModal(t) {
            pageState.redListTargetTalent = t;
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
            pageState.redListTargetTalent = null;
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
                const { error } = await CapHumaData.updateTalent(supabaseClient, pageState.redListTargetTalent.id, {
                            is_red_listed: true,
                            red_list_date: new Date().toISOString(),
                            red_list_reason: reason,
                            red_list_added_by: pageState.currentUserId,
                            red_list_added_by_name: pageState.currentUserName
                        });

                if (error) throw error;

                // Pas d'appel à logAuditAction('add_to_red_list', ...) : couvert par le
                // trigger Postgres trg_audit_talents (reprend le motif via red_list_reason).
                closeRedListModal();
                discardRedListDraft();
                await loadDevalidatedTalents();

            } catch (error) {
                redListModalError.textContent = "Erreur : " + (error.message || 'erreur inconnue');
                redListModalError.classList.remove('hidden');
            }
        });

        async function deleteTalentDefinitively(t) {
            const confirmed = confirm(
                `SUPPRESSION DÉFINITIVE de ${t.first_name} ${t.last_name}.\n\n` +
                `Cette action est irréversible et efface toute la fiche du talent (historique compris).\n\n` +
                `Il n'existe aujourd'hui aucune suppression automatique des fiches talents : ` +
                `cette suppression manuelle est le seul moyen d'effacer définitivement cette fiche.\n\n` +
                `Confirmez-vous ?`
            );
            if (!confirmed) return;

            const doubleCheck = confirm("Dernière confirmation : voulez-vous vraiment supprimer définitivement cette fiche ?");
            if (!doubleCheck) return;

            try {
                // Nettoyage des documents Storage AVANT le reste : contrairement à
                // evaluations/comments/share_tokens (tables Postgres), il n'existe aucun
                // mécanisme de cascade entre talents et le bucket Storage — sans ce
                // nettoyage explicite les documents resteraient dans le bucket sans plus
                // aucune ligne pour savoir qu'ils appartenaient à quelqu'un. Best-effort :
                // un échec ici ne doit jamais bloquer la suppression elle-même.
                if (Array.isArray(t.red_list_documents) && t.red_list_documents.length > 0) {
                    try {
                        const { error: removeErr } = await supabaseClient.storage
                            .from('red-list-documents')
                            .remove(t.red_list_documents);
                        if (removeErr) {
                            console.error('[Suppression définitive] Échec de la suppression des documents Storage (suppression maintenue) :', removeErr);
                        }
                    } catch (e) {
                        console.error('[Suppression définitive] Erreur pendant le nettoyage des documents Storage (suppression maintenue) :', e);
                    }
                }

                // La règle ON DELETE de ces FK vers talents.id n'a jamais été vérifiée :
                // suppression défensive plutôt que de compter sur une cascade non confirmée.
                await capHumaWithRetry(() => supabaseClient.from('evaluations').delete().eq('talent_id', t.id));
                await capHumaWithRetry(() => supabaseClient.from('comments').delete().eq('talent_id', t.id));
                await capHumaWithRetry(() => supabaseClient.from('share_tokens').delete().eq('talent_id', t.id));

                // Pas de capHumaWithRetry() ici : le contrôle juste en dessous
                // (data.length === 0 → throw) détecte un DELETE bloqué par une policy
                // RLS. Avec un retry automatique, ce signal deviendrait ambigu — il
                // pourrait aussi vouloir dire "1re tentative réussie, réponse perdue,
                // 2e tentative ne retrouve plus rien à supprimer", et ferait afficher à
                // tort une erreur RLS après une suppression en réalité déjà effective.
                const { data, error } = await CapHumaData.deleteTalent(supabaseClient, t.id);

                if (error) throw error;

                if (!data || data.length === 0) {
                    throw new Error("La suppression n'a affecté aucune ligne (policy RLS ?).");
                }

                // Pas d'appel à logAuditAction('delete', ...) : couvert par le trigger
                // Postgres trg_audit_talents.
                await loadDevalidatedTalents();

            } catch (error) {
                alert("Erreur lors de la suppression : " + (error.message || 'erreur inconnue') + "\n\nSi cette erreur persiste, il est possible qu'une policy RLS bloque la suppression directe pour votre rôle — à vérifier côté Supabase.");
            }
        }
})();
