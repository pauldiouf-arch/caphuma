        // ============================================================================
        // HEADER COMMUN (B4, Master Context §7) — injecté avant toute autre chose,
        // pour que #user-display-name et #logoutBtn existent dès la suite du script.
        // ============================================================================
        renderPageLayout({
            icon: '⚠️',
            title: 'Liste Rouge',
            subtitle: 'Talents signalés — Cap Huma',
            iconGradient: 'from-red-500 to-red-600',
            variant: 'scroll-page',
            actionsHtml: `
                <button id="btn-header-add-redlist" class="hidden sm:flex items-center gap-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-semibold text-sm px-4 py-2 rounded-xl transition-all">
                    <span>🚨</span> Ajouter à la liste rouge
                </button>
            `
        });

        const appBody = document.getElementById('appBody');
        let supabaseClient = null;
        let redListTalents = [];
        let redListPage = 1;
        const REDLIST_PAGE_SIZE = 20;
        let pendingConfirmAction = null;
        let currentUserRole = null;
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserName = null;
        let poolsForSelect = [];
        let talentsInSelectedPool = [];
        let selectedTalentForRedlist = null;
        let selectedRedlistFiles = [];

        // SUPABASE_URL / SUPABASE_ANON_KEY viennent désormais de shared/caphuma-config.js
        // (chargé dans le head) — remplace l'ancien pont localStorage (MC13 Addendum U3).

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

        // ============ SESSION & RÔLE ============

        async function checkSession() {
            if (!supabaseClient) {
                showError("Configuration Supabase introuvable dans le localStorage.");
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

                // Page réservée admin + user ("recruteur"), visitor exclu.
                const allowed = (s.role === 'admin' || s.role === 'user');
                if (!allowed) {
                    document.getElementById('access-denied-banner').classList.remove('hidden');
                    setTimeout(() => window.location.replace('dashboard.html'), 2500);
                    return;
                }

                document.getElementById('redlist-content').classList.remove('hidden');
                await Promise.all([loadRedList(), loadPoolsForSelect()]);
            } catch (e) {
                console.error(e);
                showError("Erreur d'authentification ou problème réseau.");
            }
        }

        // showError() retirée d'ici : vient désormais de shared/caphuma-utils.js.
        // ⚠️ Petit changement : fait maintenant remonter la page en haut en plus
        // d'afficher la bannière (harmonisé avec id-card.html — MC13 Addendum A3).

        // toastMessage() retirée d'ici : vient désormais de shared/caphuma-utils.js
        // (comportement identique — cette page avait déjà cette version).


        // ============ SIGNALEMENT D'UN NOUVEAU TALENT (Étape A : tout se passe
        // désormais dans le dialogue "redlist-add-modal", ouvert depuis le header
        // ou depuis l'état vide — plus de sélecteur pool/talent affiché en permanence
        // sur la page) ============

        async function loadPoolsForSelect() {
            const selectPool = document.getElementById('modal-select-pool');
            try {
                const { data, error } = await supabaseClient
                    .from('pools')
                    .select('pool_id, full_name, is_archived')
                    .eq('is_archived', false)
                    .order('pool_id', { ascending: true });

                if (error) throw error;
                poolsForSelect = data || [];

                selectPool.innerHTML = '<option value="">— Choisir un pool —</option>' +
                    poolsForSelect.map(p => `<option value="${escapeHtml(p.pool_id)}">${escapeHtml(p.pool_id)} - ${escapeHtml(p.full_name)}</option>`).join('');
            } catch (e) {
                console.error(e);
                showError("Impossible de charger la liste des pools : " + e.message);
            }
        }

        function updateModalConfirmState() {
            const reasonVal = document.getElementById('modal-redlist-add-reason').value.trim();
            const btn = document.getElementById('modal-redlist-add-confirm');
            btn.disabled = !(selectedTalentForRedlist && reasonVal && selectedRedlistFiles.length > 0);
        }

        // Nom de fichier assaini pour le chemin de stockage (pas d'espaces ni de
        // caractères spéciaux, qui peuvent poser problème dans une URL signée).
        function sanitizeFileName(name) {
            return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-zA-Z0-9.\-]/g, '_');
        }

        function renderSelectedFilesList() {
            const list = document.getElementById('modal-redlist-files-list');
            if (selectedRedlistFiles.length === 0) {
                list.innerHTML = '';
                return;
            }
            list.innerHTML = selectedRedlistFiles.map((file, idx) => `
                <div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">
                    <span class="truncate max-w-[220px]">📄 ${escapeHtml(file.name)} <span class="text-slate-400">(${(file.size / 1024).toFixed(1)} Ko)</span></span>
                    <button type="button" class="btn-remove-selected-file text-slate-400 hover:text-red-600 font-bold px-1.5" data-idx="${idx}">✕</button>
                </div>
            `).join('');
            document.querySelectorAll('.btn-remove-selected-file').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedRedlistFiles.splice(Number(btn.dataset.idx), 1);
                    renderSelectedFilesList();
                    updateModalConfirmState();
                });
            });
        }

        document.getElementById('modal-redlist-add-files').addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                selectedRedlistFiles = selectedRedlistFiles.concat(Array.from(e.target.files));
                e.target.value = ''; // permet de resélectionner le même fichier si retiré par erreur
                renderSelectedFilesList();
                updateModalConfirmState();
            }
        });

        // Upload séquentiel vers le bucket privé "red-list-documents". Séquentiel
        // plutôt qu'en parallèle : en cas d'échec, on s'arrête net et on informe
        // l'utilisateur, plutôt que de laisser une partie des documents orphelins
        // sans qu'on sache lesquels ont réussi.
        async function uploadRedlistDocuments(talentId, files) {
            const paths = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const path = `${talentId}/${Date.now()}_${i}_${sanitizeFileName(file.name)}`;
                const { error } = await supabaseClient
                    .storage
                    .from('red-list-documents')
                    .upload(path, file, { contentType: file.type || 'application/octet-stream' });
                if (error) throw new Error(`Échec de l'envoi de "${file.name}" : ${error.message}`);
                paths.push(path);
            }
            return paths;
        }

        async function onPoolSelected(poolCode) {
            const selectTalent = document.getElementById('modal-select-talent');
            const emptyMsg = document.getElementById('modal-select-talent-empty');

            selectedTalentForRedlist = null;
            emptyMsg.classList.add('hidden');
            updateModalConfirmState();

            if (!poolCode) {
                selectTalent.innerHTML = '<option value="">— Choisir d\'abord un pool —</option>';
                selectTalent.disabled = true;
                return;
            }

            selectTalent.innerHTML = '<option value="">Chargement...</option>';
            selectTalent.disabled = true;

            try {
                // is_red_listed est nullable : .is('is_red_listed', false) exclurait les
                // NULL, donc on filtre côté client pour couvrir null ET false.
                const { data, error } = await supabaseClient
                    .from('talents')
                    .select('id, first_name, last_name, is_red_listed')
                    .eq('pool', poolCode)
                    .order('last_name', { ascending: true });

                if (error) throw error;

                talentsInSelectedPool = (data || []).filter(t => !t.is_red_listed);

                if (talentsInSelectedPool.length === 0) {
                    selectTalent.innerHTML = '<option value="">— Aucun talent disponible —</option>';
                    selectTalent.disabled = true;
                    emptyMsg.classList.remove('hidden');
                    return;
                }

                selectTalent.innerHTML = '<option value="">— Choisir un talent —</option>' +
                    talentsInSelectedPool.map(t => `<option value="${t.id}">${escapeHtml(t.last_name)} ${escapeHtml(t.first_name)}</option>`).join('');
                selectTalent.disabled = false;
            } catch (e) {
                console.error(e);
                showError("Impossible de charger les talents de ce pool : " + e.message);
            }
        }

        function onTalentSelected(talentId) {
            selectedTalentForRedlist = talentsInSelectedPool.find(t => t.id === talentId) || null;
            updateModalConfirmState();
        }

        // Ouverture du dialogue : réinitialise l'état (pool/talent/motif/fichiers) à
        // chaque fois, qu'il soit déclenché depuis le header ou depuis l'état "liste vide".
        function openRedlistAddModal() {
            selectedTalentForRedlist = null;
            selectedRedlistFiles = [];
            document.getElementById('modal-select-pool').value = '';
            document.getElementById('modal-select-talent').innerHTML = '<option value="">— Choisir d\'abord un pool —</option>';
            document.getElementById('modal-select-talent').disabled = true;
            document.getElementById('modal-select-talent-empty').classList.add('hidden');
            document.getElementById('modal-redlist-add-reason').value = '';
            document.getElementById('modal-redlist-add-files').value = '';
            renderSelectedFilesList();
            updateModalConfirmState();
            document.getElementById('redlist-add-modal').classList.remove('hidden');
        }

        document.getElementById('modal-redlist-add-cancel').addEventListener('click', () => {
            document.getElementById('redlist-add-modal').classList.add('hidden');
        });

        document.getElementById('modal-redlist-add-confirm').addEventListener('click', async () => {
            const reasonVal = document.getElementById('modal-redlist-add-reason').value.trim();
            if (!selectedTalentForRedlist || !reasonVal || selectedRedlistFiles.length === 0) {
                toastMessage("Veuillez choisir un talent, indiquer le motif et joindre au moins un document.", "error");
                return;
            }

            const spinner = document.getElementById('redlist-add-spinner');
            const btn = document.getElementById('modal-redlist-add-confirm');
            const label = document.getElementById('modal-redlist-add-confirm-label');
            btn.disabled = true;
            spinner.classList.remove('hidden');

            try {
                label.textContent = 'Envoi des documents...';
                const documentPaths = await uploadRedlistDocuments(selectedTalentForRedlist.id, selectedRedlistFiles);

                label.textContent = 'Inscription...';
                // Format ISO (pas toLocaleDateString) : la colonne est un
                // timestamptz, un format DD/MM/YYYY serait ambigu à la relecture.
                const { error } = await supabaseClient
                    .from('talents')
                    .update({
                        is_red_listed: true,
                        red_list_date: new Date().toISOString(),
                        red_list_reason: reasonVal,
                        red_list_added_by: currentUserId,
                        red_list_added_by_name: document.getElementById('user-display-name').textContent,
                        red_list_documents: documentPaths
                    })
                    .eq('id', selectedTalentForRedlist.id);

                if (error) throw error;

                // logAuditAction('add_to_red_list', ...) retiré le 19/08/2026 (A5) :
                // couvert désormais par le trigger Postgres trg_audit_talents (reprend
                // le motif via red_list_reason).
                document.getElementById('redlist-add-modal').classList.add('hidden');
                toastMessage("Talent inscrit en Liste Rouge avec succès.");

                await loadRedList();
            } catch (e) {
                console.error(e);
                toastMessage("Échec de l'inscription : " + e.message, "error");
            } finally {
                btn.disabled = false;
                spinner.classList.add('hidden');
                label.textContent = 'Inscrire';
            }
        });

        document.getElementById('modal-select-pool').addEventListener('change', (e) => onPoolSelected(e.target.value));
        document.getElementById('modal-select-talent').addEventListener('change', (e) => onTalentSelected(e.target.value));
        document.getElementById('modal-redlist-add-reason').addEventListener('input', updateModalConfirmState);
        document.getElementById('btn-header-add-redlist').addEventListener('click', openRedlistAddModal);
        document.getElementById('btn-empty-add-redlist').addEventListener('click', openRedlistAddModal);

        // ============ CHARGEMENT DE LA LISTE ROUGE ============

        async function loadRedList(page) {
            if (typeof page === 'number') redListPage = page;

            const loading = document.getElementById('redlist-loading');
            const empty = document.getElementById('redlist-empty');
            const table = document.getElementById('redlist-table');
            const pagination = document.getElementById('redlist-pagination');
            loading.classList.remove('hidden');
            empty.classList.add('hidden');
            table.classList.add('hidden');
            pagination.classList.add('hidden');

            try {
                // Pagination réelle côté requête (.range() + count: exact), sur le
                // modèle déjà validé sur talents.html / audit_logs.html — évite de
                // charger l'intégralité de la Liste Rouge en mémoire à chaque visite.
                const result = await paginateQuery(
                    (c) => c.from('talents')
                        .select('id, first_name, last_name, pool, status, red_list_date, red_list_reason, red_list_added_by_name, red_list_documents', { count: 'exact' })
                        .eq('is_red_listed', true)
                        .order('red_list_date', { ascending: false }),
                    supabaseClient,
                    redListPage,
                    REDLIST_PAGE_SIZE
                );

                redListTalents = result.data;
                document.getElementById('redlist-count').textContent = result.count;
                renderRedList();

                if (result.count > 0) {
                    pagination.innerHTML = renderPaginationControls(result.page, result.totalPages, result.count);
                    pagination.querySelector('[data-page-nav="prev"]')
                        ?.addEventListener('click', () => goToRedListPage(redListPage - 1));
                    pagination.querySelector('[data-page-nav="next"]')
                        ?.addEventListener('click', () => goToRedListPage(redListPage + 1));
                    pagination.classList.remove('hidden');
                }
            } catch (e) {
                console.error(e);
                showError("Impossible de charger la liste rouge : " + e.message);
            } finally {
                loading.classList.add('hidden');
            }
        }

        function goToRedListPage(page) {
            if (page < 1) return;
            loadRedList(page);
        }

        function renderRedList() {
            const tbody = document.getElementById('redlist-tbody');
            const table = document.getElementById('redlist-table');
            const empty = document.getElementById('redlist-empty');

            if (redListTalents.length === 0) {
                empty.classList.remove('hidden');
                table.classList.add('hidden');
                return;
            }

            table.classList.remove('hidden');
            empty.classList.add('hidden');

            tbody.innerHTML = redListTalents.map(t => {
                const fullName = `${t.first_name || ''} ${t.last_name || ''}`.trim() || '—';
                const dateAdded = t.red_list_date ? new Date(t.red_list_date).toLocaleDateString('fr-FR') : '—';
                const reasonPreview = t.red_list_reason
                    ? (t.red_list_reason.length > 40 ? t.red_list_reason.slice(0, 40) + '…' : t.red_list_reason)
                    : '—';
                const docCount = Array.isArray(t.red_list_documents) ? t.red_list_documents.length : 0;

                return `
                <tr class="text-slate-700">
                    <td class="py-3 pr-4 font-medium">${escapeHtml(fullName)}</td>
                    <td class="py-3 pr-4 text-slate-500">${escapeHtml(t.pool || '—')}</td>
                    <td class="py-3 pr-4 text-xs text-slate-500">${escapeHtml(t.status || '—')}</td>
                    <td class="py-3 pr-4 text-xs text-slate-400">${dateAdded}</td>
                    <td class="py-3 pr-4">
                        ${t.red_list_reason
                            ? `<button class="btn-view-reason text-xs text-primary hover:underline text-left" data-id="${escapeHtml(t.id)}">${escapeHtml(reasonPreview)}${docCount > 0 ? ` <span class="text-slate-400">📎${docCount}</span>` : ''}</button>`
                            : '<span class="text-xs text-slate-400">—</span>'}
                    </td>
                    <td class="py-3 pr-4 text-xs text-slate-500">${escapeHtml(t.red_list_added_by_name || '—')}</td>
                    <td class="py-3 pr-4">
                        <div class="flex justify-end gap-1.5 flex-wrap">
                            <a href="id-card.html?id=${escapeHtml(t.id)}" class="text-xs font-semibold text-primary hover:bg-primary-light px-2.5 py-1.5 rounded-lg transition-all">Voir la fiche</a>
                            <button class="btn-remove-redlist text-xs font-semibold text-green-600 hover:bg-green-50 px-2.5 py-1.5 rounded-lg transition-all" data-id="${escapeHtml(t.id)}" data-name="${escapeHtml(fullName)}">
                                Retirer
                            </button>
                        </div>
                    </td>
                </tr>`;
            }).join('');

            document.querySelectorAll('.btn-view-reason').forEach(btn => {
                btn.addEventListener('click', () => showReasonModal(btn.dataset.id));
            });
            document.querySelectorAll('.btn-remove-redlist').forEach(btn => {
                btn.addEventListener('click', () => onRemoveFromRedList(btn.dataset.id, btn.dataset.name));
            });
        }

        async function showReasonModal(talentId) {
            const talent = redListTalents.find(t => t.id === talentId);
            document.getElementById('reason-content').textContent = (talent && talent.red_list_reason) || '—';
            const docsList = document.getElementById('reason-documents-list');
            const paths = (talent && Array.isArray(talent.red_list_documents)) ? talent.red_list_documents : [];

            if (paths.length === 0) {
                docsList.innerHTML = '<p class="text-xs text-slate-400">Aucun document.</p>';
            } else {
                docsList.innerHTML = '<p class="text-xs text-slate-400">Génération des liens...</p>';
            }
            document.getElementById('modal-reason').classList.remove('hidden');

            if (paths.length === 0) return;

            // Bucket privé : les URLs sont générées à la demande (signées, expiration
            // courte), jamais stockées en clair ni rendues publiques.
            try {
                const links = await Promise.all(paths.map(async (path, idx) => {
                    const { data, error } = await supabaseClient
                        .storage
                        .from('red-list-documents')
                        .createSignedUrl(path, 300); // 5 minutes, largement suffisant pour un clic
                    if (error || !data) return null;
                    const label = path.split('/').pop() || `Document ${idx + 1}`;
                    return `<a href="${data.signedUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-1.5 text-primary hover:underline">📎 ${escapeHtml(label)}</a>`;
                }));
                const validLinks = links.filter(Boolean);
                docsList.innerHTML = validLinks.length > 0
                    ? validLinks.join('')
                    : '<p class="text-xs text-red-500">Impossible de générer les liens des documents.</p>';
            } catch (e) {
                console.error(e);
                docsList.innerHTML = '<p class="text-xs text-red-500">Erreur lors du chargement des documents.</p>';
            }
        }
        document.getElementById('btn-close-reason').addEventListener('click', () => {
            document.getElementById('modal-reason').classList.add('hidden');
        });

        // Retrait de la liste rouge : remet les 4 champs liés à null/false (client direct,
        // pas besoin d'Edge Function — action réservée par les policies RLS aux
        // admins/recruteurs déjà authentifiés, cohérent avec le reste du site).
        async function onRemoveFromRedList(talentId, talentName) {
            openConfirmModal({
                title: "Retirer de la liste rouge",
                message: `"${talentName}" ne sera plus signalé. Cette action peut être annulée en le re-signalant depuis sa fiche.`,
                actionLabel: "Retirer",
                icon: "✅",
                onConfirm: async () => {
                    const { error } = await supabaseClient
                        .from('talents')
                        .update({
                            is_red_listed: false,
                            red_list_date: null,
                            red_list_reason: null,
                            red_list_added_by: null,
                            red_list_added_by_name: null
                        })
                        .eq('id', talentId);
                    if (error) throw error;
                    // logAuditAction('remove_from_red_list', ...) retiré le 19/08/2026 (A5) :
                    // couvert désormais par le trigger Postgres trg_audit_talents.
                    toastMessage("Talent retiré de la liste rouge.");
                    await loadRedList();
                }
            });
        }

        // ============ MODALE DE CONFIRMATION GÉNÉRIQUE ============

        function openConfirmModal({ title, message, actionLabel, icon, onConfirm }) {
            document.getElementById('confirm-title').textContent = title;
            document.getElementById('confirm-message').textContent = message;
            document.getElementById('confirm-action-label').textContent = actionLabel;
            document.getElementById('confirm-icon').textContent = icon || '⚠️';
            pendingConfirmAction = onConfirm;
            document.getElementById('modal-confirm').classList.remove('hidden');
        }

        document.getElementById('btn-cancel-confirm').addEventListener('click', () => {
            pendingConfirmAction = null;
            document.getElementById('modal-confirm').classList.add('hidden');
        });

        document.getElementById('btn-confirm-confirm').addEventListener('click', async () => {
            if (!pendingConfirmAction) return;
            const spinner = document.getElementById('confirm-spinner');
            const btn = document.getElementById('btn-confirm-confirm');
            btn.disabled = true;
            spinner.classList.remove('hidden');
            try {
                await pendingConfirmAction();
                document.getElementById('modal-confirm').classList.add('hidden');
            } catch (e) {
                console.error(e);
                toastMessage("Échec de l'action : " + e.message, "error");
            } finally {
                btn.disabled = false;
                spinner.classList.add('hidden');
                pendingConfirmAction = null;
            }
        });

        // ============ INITIALISATION ============

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            if (supabaseClient) await supabaseClient.auth.signOut();
            window.location.replace('login.html');
        });

        window.addEventListener('DOMContentLoaded', () => checkSession());
