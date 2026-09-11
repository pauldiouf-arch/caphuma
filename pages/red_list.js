(() => {
        renderPageLayout({
            icon: CapHumaIcons.get('alertTriangle', 'w-5 h-5'),
            title: 'Liste Rouge',
            subtitle: 'Talents signalés — Cap Huma',
            iconGradient: 'from-red-500 to-red-600',
            variant: 'scroll-page',
            actionsHtml: `
                <button id="btn-header-add-redlist" class="hidden sm:flex items-center gap-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-semibold text-sm px-4 py-2 rounded-xl transition-all">
                    <span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/></svg></span> Ajouter à la liste rouge
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

        // Correspond à l'attribut accept="..." du champ de sélection dans
        // red_list.html — cet attribut n'est qu'indicatif côté navigateur,
        // contournable en glisser-déposer, d'où ce contrôle en plus côté JS.
        const REDLIST_ALLOWED_MIME_TYPES = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/png'
        ];
        const REDLIST_MAX_FILE_SIZE_MB = 10;
        const REDLIST_MAX_FILE_SIZE_BYTES = REDLIST_MAX_FILE_SIZE_MB * 1024 * 1024;

        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }

        const logAuditAction = capHumaMakeAuditLogger(
            () => supabaseClient,
            () => ({
                userId: currentUserId,
                userEmail: currentUserEmail,
                userName: typeof currentUserName !== 'undefined' ? currentUserName : null
            })
        );

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

        async function loadPoolsForSelect() {
            const selectPool = document.getElementById('modal-select-pool');
            try {
                const { data, error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('pools')
                        .select('pool_id, full_name, is_archived')
                        .eq('is_archived', false)
                        .order('pool_id', { ascending: true })
                );

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

        // Ni espaces ni caractères spéciaux, qui peuvent poser problème dans une
        // URL signée.
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
                    <span class="truncate max-w-[220px]"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/></svg> ${escapeHtml(file.name)} <span class="text-slate-500">(${(file.size / 1024).toFixed(1)} Ko)</span></span>
                    <button type="button" class="btn-remove-selected-file text-slate-500 hover:text-red-600 font-bold px-1.5" data-idx="${idx}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg></button>
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
                // Filtré avant l'envoi plutôt qu'au moment de l'upload — en complément
                // des policies du bucket, jamais en remplacement.
                const incoming = Array.from(e.target.files);
                const accepted = [];
                const rejected = [];
                incoming.forEach(file => {
                    if (!REDLIST_ALLOWED_MIME_TYPES.includes(file.type)) {
                        rejected.push(`${file.name} (type de fichier non autorisé)`);
                        return;
                    }
                    if (file.size > REDLIST_MAX_FILE_SIZE_BYTES) {
                        rejected.push(`${file.name} (dépasse ${REDLIST_MAX_FILE_SIZE_MB} Mo)`);
                        return;
                    }
                    accepted.push(file);
                });

                if (rejected.length > 0) {
                    toastMessage(`Fichier(s) refusé(s) : ${rejected.join(', ')}`, 'error');
                }

                selectedRedlistFiles = selectedRedlistFiles.concat(accepted);
                e.target.value = ''; // permet de resélectionner le même fichier si retiré par erreur
                renderSelectedFilesList();
                updateModalConfirmState();
            }
        });

        // Upload séquentiel, pas en parallèle : en cas d'échec, on s'arrête net
        // plutôt que de laisser une partie des documents orphelins sans savoir
        // lesquels ont réussi.
        async function uploadRedlistDocuments(talentId, files) {
            const paths = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                // Défense en profondeur, revérifié ici même si déjà filtré à la
                // sélection plus haut.
                if (!REDLIST_ALLOWED_MIME_TYPES.includes(file.type)) {
                    throw new Error(`Type de fichier non autorisé : "${file.name}".`);
                }
                if (file.size > REDLIST_MAX_FILE_SIZE_BYTES) {
                    throw new Error(`"${file.name}" dépasse la taille maximale autorisée (${REDLIST_MAX_FILE_SIZE_MB} Mo).`);
                }
                const path = `${talentId}/${Date.now()}_${i}_${sanitizeFileName(file.name)}`;
                // path calculé une seule fois (pas régénéré à chaque tentative) et
                // aucun { upsert: true } passé : une relance tombe proprement sur une
                // erreur "déjà existant" plutôt que d'écraser silencieusement.
                const { error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .storage
                        .from('red-list-documents')
                        .upload(path, file, { contentType: file.type || 'application/octet-stream' })
                );
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
                // is_red_listed est nullable : .is('is_red_listed', false) exclurait
                // les NULL, filtré côté client pour couvrir null et false.
                const { data, error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('talents')
                        .select('id, first_name, last_name, is_red_listed')
                        .eq('pool', poolCode)
                        .order('last_name', { ascending: true })
                );

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

        // Réinitialise l'état (pool/talent/motif/fichiers) à chaque ouverture.
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
                // Format ISO (pas toLocaleDateString) : la colonne est un timestamptz,
                // un format DD/MM/YYYY serait ambigu à la relecture.
                const { error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('talents')
                        .update({
                            is_red_listed: true,
                            red_list_date: new Date().toISOString(),
                            red_list_reason: reasonVal,
                            red_list_added_by: currentUserId,
                            red_list_added_by_name: document.getElementById('user-display-name').textContent,
                            red_list_documents: documentPaths
                        })
                        .eq('id', selectedTalentForRedlist.id)
                );

                if (error) throw error;

                // Pas d'appel à logAuditAction('add_to_red_list', ...) ici : couvert
                // par le trigger Postgres trg_audit_talents (reprend le motif via
                // red_list_reason).
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
                const result = await fetchSensitiveRead(supabaseClient, 'red_list', { page: redListPage });

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

                // encodeURIComponent(t.id) ci-dessous, pas escapeHtml() : ce lien
                // construit une URL, escapeHtml() protège du HTML, pas d'une URL.

                return `
                <tr class="text-slate-700">
                    <td class="py-3 pr-4 font-medium">${escapeHtml(fullName)}</td>
                    <td class="py-3 pr-4 text-slate-500">${escapeHtml(t.pool || '—')}</td>
                    <td class="py-3 pr-4 text-xs text-slate-500">${escapeHtml(t.status || '—')}</td>
                    <td class="py-3 pr-4 text-xs text-slate-500">${dateAdded}</td>
                    <td class="py-3 pr-4">
                        ${t.red_list_reason
                            ? `<button class="btn-view-reason text-xs text-primary hover:underline text-left" data-id="${escapeHtml(t.id)}">${escapeHtml(reasonPreview)}${docCount > 0 ? ` <span class="text-slate-500"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"/></svg>${docCount}</span>` : ''}</button>`
                            : '<span class="text-xs text-slate-500">—</span>'}
                    </td>
                    <td class="py-3 pr-4 text-xs text-slate-500">${escapeHtml(t.red_list_added_by_name || '—')}</td>
                    <td class="py-3 pr-4">
                        <div class="flex justify-end gap-1.5 flex-wrap">
                            <a href="id-card.html?id=${encodeURIComponent(t.id)}" class="text-xs font-semibold text-primary hover:bg-primary-light px-2.5 py-1.5 rounded-lg transition-all">Voir la fiche</a>
                            <button class="btn-remove-redlist text-xs font-semibold text-green-600 hover:bg-green-50 px-2.5 py-1.5 rounded-lg transition-all" data-id="${escapeHtml(t.id)}" data-name="${escapeHtml(fullName)}">
                                Retirer
                            </button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
            // .btn-view-reason/.btn-remove-redlist ne sont pas rebranchés ici : un
            // seul écouteur délégué s'en charge (voir plus bas).
        }

        async function showReasonModal(talentId) {
            const talent = redListTalents.find(t => t.id === talentId);
            document.getElementById('reason-content').textContent = (talent && talent.red_list_reason) || '—';
            const docsList = document.getElementById('reason-documents-list');
            const paths = (talent && Array.isArray(talent.red_list_documents)) ? talent.red_list_documents : [];

            if (paths.length === 0) {
                docsList.innerHTML = '<p class="text-xs text-slate-500">Aucun document.</p>';
            } else {
                docsList.innerHTML = '<p class="text-xs text-slate-500">Génération des liens...</p>';
            }
            document.getElementById('modal-reason').classList.remove('hidden');

            if (paths.length === 0) return;

            // Bucket privé : URLs générées à la demande (signées, expiration courte),
            // jamais stockées en clair ni rendues publiques.
            try {
                const links = await Promise.all(paths.map(async (path, idx) => {
                    const { data, error } = await capHumaWithRetry(() =>
                        supabaseClient
                            .storage
                            .from('red-list-documents')
                            .createSignedUrl(path, 300) // 5 minutes, largement suffisant pour un clic
                    );
                    if (error || !data) {
                        // console.error() par chemin en échec, pas un throw : les autres
                        // documents du même talent doivent continuer à s'afficher normalement.
                        console.error(`[Liste Rouge] createSignedUrl a échoué pour "${path}" :`, error || 'réponse vide, sans erreur explicite');
                        return null;
                    }
                    const label = path.split('/').pop() || `Document ${idx + 1}`;
                    return `<a href="${data.signedUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-1.5 text-primary hover:underline"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"/></svg> ${escapeHtml(label)}</a>`;
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

        // Client direct, pas besoin d'Edge Function : action réservée par les
        // policies RLS aux admins/recruteurs déjà authentifiés. Nettoyage Storage
        // fait en best-effort, avant le retrait effectif — sinon un talent réinscrit
        // plus tard depuis id-card.html hériterait d'une référence de documents
        // orpheline. Un échec ici ne doit jamais bloquer le retrait lui-même, donc
        // jamais de throw depuis ce bloc, seulement un log.
        async function onRemoveFromRedList(talentId, talentName) {
            openConfirmModal({
                title: "Retirer de la liste rouge",
                message: `"${talentName}" ne sera plus signalé. Cette action peut être annulée en le re-signalant depuis sa fiche.`,
                actionLabel: "Retirer",
                icon: CapHumaIcons.get('checkCircle', 'w-10 h-10 mx-auto text-emerald-500'),
                onConfirm: async () => {
                    const talent = redListTalents.find(t => t.id === talentId);
                    const existingPaths = (talent && Array.isArray(talent.red_list_documents)) ? talent.red_list_documents : [];

                    if (existingPaths.length > 0) {
                        try {
                            const { error: removeErr } = await supabaseClient.storage
                                .from('red-list-documents')
                                .remove(existingPaths);
                            if (removeErr) {
                                console.error('[Liste Rouge] Échec de la suppression des documents Storage (retrait maintenu) :', removeErr);
                            }
                        } catch (e) {
                            console.error('[Liste Rouge] Erreur pendant le nettoyage des documents Storage (retrait maintenu) :', e);
                        }
                    }

                    const { error } = await capHumaWithRetry(() =>
                        supabaseClient
                            .from('talents')
                            .update({
                                is_red_listed: false,
                                red_list_date: null,
                                red_list_reason: null,
                                red_list_added_by: null,
                                red_list_added_by_name: null,
                                red_list_documents: null
                            })
                            .eq('id', talentId)
                    );
                    if (error) throw error;
                    // Pas d'appel à logAuditAction('remove_from_red_list', ...) ici :
                    // couvert par le trigger Postgres trg_audit_talents.
                    toastMessage("Talent retiré de la liste rouge.");
                    await loadRedList();
                }
            });
        }

        function openConfirmModal({ title, message, actionLabel, icon, onConfirm }) {
            document.getElementById('confirm-title').textContent = title;
            document.getElementById('confirm-message').textContent = message;
            document.getElementById('confirm-action-label').textContent = actionLabel;
            document.getElementById('confirm-icon').innerHTML = icon || CapHumaIcons.get('alertTriangle', 'w-10 h-10 mx-auto text-amber-500');
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

        // Écouteur délégué posé une fois ici plutôt que ré-attaché à chaque rendu
        // de renderRedList() : #redlist-tbody est un élément statique du HTML,
        // jamais recréé.
        document.getElementById('redlist-tbody').addEventListener('click', (e) => {
            const reasonBtn = e.target.closest('.btn-view-reason');
            if (reasonBtn) { showReasonModal(reasonBtn.dataset.id); return; }

            const removeBtn = e.target.closest('.btn-remove-redlist');
            if (removeBtn) { onRemoveFromRedList(removeBtn.dataset.id, removeBtn.dataset.name); return; }
        });

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            if (supabaseClient) await supabaseClient.auth.signOut();
            window.location.replace('login.html');
        });

        window.addEventListener('DOMContentLoaded', () => { checkSession(); capHumaInitModalA11y(); });
})();
