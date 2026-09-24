(() => {
        renderPageLayout({
            icon: CapHumaIcons.get('shield', 'w-5 h-5'),
            title: 'Administration',
            titleTag: 'span',
            iconGradient: 'from-primary to-primary-dark',
            variant: 'scroll-page'
        });

        const appBody = document.getElementById('appBody');
        const supabaseClient = capHumaGetSupabaseClient();
        let accountsList = [];
        let accessRequestsList = [];
        let poolsList = [];
        let pendingConfirmAction = null;
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserName = null;

        const logAuditAction = capHumaMakeAuditLogger(
            () => supabaseClient,
            () => ({
                userId: currentUserId,
                userEmail: currentUserEmail,
                userName: typeof currentUserName !== 'undefined' ? currentUserName : null
            })
        );

        async function checkSession() {
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
                appBody.style.display = '';

                if (s.role !== 'admin') {
                    document.getElementById('access-denied-banner').classList.remove('hidden');
                    setTimeout(() => window.location.replace('dashboard.html'), 2500);
                    return;
                }

                document.getElementById('admin-content').classList.remove('hidden');
                await Promise.all([loadAccounts(), loadAccessCodeRequests(), loadPools()]);
            } catch (e) {
                console.error(e);
                showError("Erreur d'authentification ou problème réseau.");
            }
        }

        // Le header apikey est obligatoire en plus d'Authorization, sinon 401 dès la passerelle.
        async function callManageUsers(action, payload = {}) {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) {
                window.location.href = 'login.html';
                throw new Error("Session expirée, veuillez vous reconnecter.");
            }

            const doFetch = () => fetch(`${SUPABASE_URL}/functions/v1/manage-users`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ action, ...payload })
            });

            // Pas de relance pour reset_password : un 2e appel générerait un second code d'accès.
            const response = action === 'reset_password'
                ? await doFetch()
                : await capHumaWithRetry(doFetch);

            if (response.status === 401 || response.status === 403) {
                await supabaseClient.auth.signOut();
                window.location.href = 'login.html';
                throw new Error('Session expirée ou accès refusé — redirection vers la connexion.');
            }

            const json = await response.json();
            if (!response.ok || json.error) {
                throw new Error(json.error || `Erreur inattendue (statut ${response.status})`);
            }
            return json;
        }

        async function loadAccounts() {
            const loading = document.getElementById('accounts-loading');
            const empty = document.getElementById('accounts-empty');
            const table = document.getElementById('accounts-table');
            loading.classList.remove('hidden');
            empty.classList.add('hidden');
            table.classList.add('hidden');

            try {
                const { data, error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('users')
                        .select('id, name, email, role, is_active, created_at')
                        .order('created_at', { ascending: false })
                );

                if (error) throw error;
                accountsList = data || [];
                renderAccounts();
                renderAccessRequests();
            } catch (e) {
                console.error(e);
                showError("Impossible de charger la liste des comptes : " + e.message);
            } finally {
                loading.classList.add('hidden');
            }
        }

        function renderAccounts() {
            const tbody = document.getElementById('accounts-tbody');
            const table = document.getElementById('accounts-table');
            const empty = document.getElementById('accounts-empty');

            if (accountsList.length === 0) {
                empty.classList.remove('hidden');
                table.classList.add('hidden');
                return;
            }

            table.classList.remove('hidden');
            empty.classList.add('hidden');

            const roleLabels = {
                admin: CapHumaIcons.get('shield', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0') + ' Admin',
                user: CapHumaIcons.get('user', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0') + ' Recruteur',
                visitor: CapHumaIcons.get('eye', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0') + ' Visiteur'
            };
            const roleColors = {
                admin: 'bg-primary-light text-primary',
                user: 'bg-green-50 text-green-700',
                visitor: 'bg-slate-100 text-slate-600'
            };

            tbody.innerHTML = accountsList.map(u => {
                const createdDate = u.created_at ? new Date(u.created_at).toLocaleDateString('fr-FR') : '—';
                const isOwnAccount = u.id === currentUserId;
                const statusBadge = u.is_active
                    ? '<span class="text-xs font-semibold bg-green-50 text-green-700 px-2.5 py-1 rounded-full">Actif</span>'
                    : '<span class="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">Suspendu</span>';
                const roleBadge = `<span class="text-xs font-semibold ${roleColors[u.role] || 'bg-slate-100 text-slate-600'} px-2.5 py-1 rounded-full">${roleLabels[u.role] || u.role}</span>`;

                return `
                <tr class="text-slate-700">
                    <td class="py-3 pr-4 font-medium">${escapeHtml(u.name || '—')}</td>
                    <td class="py-3 pr-4 text-slate-500">${escapeHtml(u.email || '—')}</td>
                    <td class="py-3 pr-4">${roleBadge}</td>
                    <td class="py-3 pr-4">${statusBadge}</td>
                    <td class="py-3 pr-4 text-slate-500 text-xs">${createdDate}</td>
                    <td class="py-3 pr-4">
                        <div class="flex justify-end gap-1.5 flex-wrap">
                            ${isOwnAccount ? '' : `<button class="btn-toggle-active text-xs font-semibold ${u.is_active ? 'text-amber-700 hover:bg-amber-50' : 'text-green-700 hover:bg-green-50'} px-2.5 py-1.5 rounded-lg transition-all" data-id="${u.id}" data-active="${u.is_active}">
                                ${u.is_active ? 'Suspendre' : 'Réactiver'}
                            </button>`}
                            <button class="btn-reset-password text-xs font-semibold text-primary hover:bg-primary-light px-2.5 py-1.5 rounded-lg transition-all" data-id="${u.id}">
                                Réinitialiser
                            </button>
                            ${isOwnAccount ? '' : `<button class="btn-delete-account text-xs font-semibold text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-all" data-id="${u.id}" data-email="${escapeHtml(u.email || '')}">
                                Supprimer
                            </button>`}
                        </div>
                    </td>
                </tr>`;
            }).join('');
        }

        async function loadAccessCodeRequests() {
            try {
                const { data, error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('access_code_requests')
                        .select('id, email, requested_at')
                        .is('resolved_at', null)
                        .order('requested_at', { ascending: true })
                );
                if (error) throw error;
                accessRequestsList = data || [];
                renderAccessRequests();
            } catch (e) {
                console.error(e);
                showError("Impossible de charger les demandes de nouveau code d'accès : " + e.message);
            }
        }

        function findAccountByEmail(email) {
            const normalized = (email || '').toLowerCase();
            return accountsList.find(u => (u.email || '').toLowerCase() === normalized) || null;
        }

        function renderAccessRequests() {
            const card = document.getElementById('access-requests-card');
            const list = document.getElementById('access-requests-list');

            card.classList.toggle('hidden', accessRequestsList.length === 0);

            list.innerHTML = accessRequestsList.map(r => {
                const account = findAccountByEmail(r.email);
                const requestedAt = new Date(r.requested_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

                return `
                <li class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div class="text-sm">
                        <span class="font-medium text-slate-800">${escapeHtml(account ? account.name || '—' : 'Compte introuvable')}</span>
                        <span class="text-slate-500">— ${escapeHtml(r.email)}</span>
                        <span class="block text-xs text-slate-500">Demandé le ${requestedAt}</span>
                    </div>
                    <div class="flex gap-1.5">
                        ${account ? `<button class="btn-reset-password text-xs font-semibold text-primary hover:bg-primary-light px-2.5 py-1.5 rounded-lg transition-all" data-id="${account.id}">
                            Réinitialiser
                        </button>` : ''}
                        <button class="btn-dismiss-request text-xs font-semibold text-slate-600 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-all" data-id="${r.id}">
                            Ignorer
                        </button>
                    </div>
                </li>`;
            }).join('');
        }

        async function onDismissAccessRequest(requestId) {
            const request = accessRequestsList.find(r => r.id === requestId);
            if (!request) return;
            const account = findAccountByEmail(request.email);

            openConfirmModal({
                title: "Ignorer la demande",
                message: `La demande de ${request.email} sera retirée de la liste, sans générer de nouveau code.`,
                actionLabel: "Ignorer",
                icon: CapHumaIcons.get('xCircle', 'w-10 h-10 mx-auto text-slate-400'),
                onConfirm: async () => {
                    const { error } = await supabaseClient.rpc('dismiss_access_code_request', { p_id: requestId });
                    if (error) throw error;
                    await logAuditAction('update', 'user', account ? account.id : null, request.email, "Demande de nouveau code d'accès ignorée");
                    toastMessage("Demande ignorée.");
                    await loadAccessCodeRequests();
                }
            });
        }

        async function onToggleActive(userId, currentlyActive) {
            const nextState = !currentlyActive;
            openConfirmModal({
                title: nextState ? "Réactiver le compte" : "Suspendre le compte",
                message: nextState
                    ? "L'utilisateur retrouvera immédiatement l'accès à la plateforme."
                    : "L'utilisateur perdra immédiatement l'accès à la plateforme.",
                actionLabel: nextState ? "Réactiver" : "Suspendre",
                icon: nextState ? CapHumaIcons.get('checkCircle', 'w-10 h-10 mx-auto text-emerald-500') : CapHumaIcons.get('pause', 'w-10 h-10 mx-auto text-amber-500'),
                onConfirm: async () => {
                    const result = await callManageUsers(nextState ? 'reactivate' : 'suspend', { userId });
                    if (result.warning) {
                        toastMessage(result.warning, "error");
                    } else {
                        toastMessage(nextState ? "Compte réactivé." : "Compte suspendu.");
                    }
                    await loadAccounts();
                }
            });
        }

        async function onResetPassword(userId) {
            openConfirmModal({
                title: "Réinitialiser le code d'accès",
                message: "Un nouveau code sera généré et l'ancien cessera immédiatement de fonctionner.",
                actionLabel: "Réinitialiser",
                icon: CapHumaIcons.get('key', 'w-10 h-10 mx-auto text-slate-400'),
                onConfirm: async () => {
                    const result = await callManageUsers('reset_password', { userId });
                    showAccessCodeModal(result.accessCode);
                    if (result.warning) {
                        toastMessage(result.warning, "error");
                    } else {
                        toastMessage("Code d'accès réinitialisé avec succès.");
                    }
                    await loadAccessCodeRequests();
                }
            });
        }

        async function onDeleteAccount(userId, email) {
            openConfirmModal({
                title: "Supprimer définitivement ce compte",
                message: `Cette action est irréversible. Le compte "${email}" et son accès seront définitivement supprimés.`,
                actionLabel: "Supprimer",
                icon: CapHumaIcons.get('trash', 'w-10 h-10 mx-auto text-red-500'),
                onConfirm: async () => {
                    const result = await callManageUsers('delete', { userId });
                    if (result.warning) {
                        toastMessage(result.warning, "error");
                    } else {
                        toastMessage("Compte supprimé avec succès.");
                    }
                    await loadAccounts();
                }
            });
        }

        document.getElementById('btn-open-create-account').addEventListener('click', () => {
            document.getElementById('input-new-name').value = '';
            document.getElementById('input-new-email').value = '';
            document.getElementById('input-new-role').value = 'user';
            document.getElementById('modal-create-account').classList.remove('hidden');
        });
        document.getElementById('btn-cancel-create-account').addEventListener('click', () => {
            document.getElementById('modal-create-account').classList.add('hidden');
        });
        document.getElementById('btn-confirm-create-account').addEventListener('click', async () => {
            const fullName = document.getElementById('input-new-name').value.trim();
            const email = document.getElementById('input-new-email').value.trim();
            const role = document.getElementById('input-new-role').value;
            const spinner = document.getElementById('create-account-spinner');
            const btn = document.getElementById('btn-confirm-create-account');

            if (!email || !role) {
                toastMessage("L'email et le rôle sont obligatoires.", "error");
                return;
            }

            btn.disabled = true;
            spinner.classList.remove('hidden');
            try {
                const result = await callManageUsers('create', { email, role, fullName });
                document.getElementById('modal-create-account').classList.add('hidden');
                showAccessCodeModal(result.accessCode);
                toastMessage("Compte créé avec succès.");
                await loadAccounts();
            } catch (e) {
                console.error(e);
                toastMessage("Échec de la création : " + e.message, "error");
            } finally {
                btn.disabled = false;
                spinner.classList.add('hidden');
            }
        });

        async function loadPools() {
            const loading = document.getElementById('pools-loading');
            const empty = document.getElementById('pools-empty');
            const table = document.getElementById('pools-table');
            loading.classList.remove('hidden');
            empty.classList.add('hidden');
            table.classList.add('hidden');

            try {
                const { data, error } = await CapHumaData.getPools(supabaseClient, { select: 'id, pool_id, full_name, level, description, is_archived' });
                if (error) throw error;
                poolsList = data || [];
                renderPools();
            } catch (e) {
                console.error(e);
                showError("Impossible de charger la liste des pools : " + e.message);
            } finally {
                loading.classList.add('hidden');
            }
        }

        function renderPools() {
            const tbody = document.getElementById('pools-tbody');
            const table = document.getElementById('pools-table');
            const empty = document.getElementById('pools-empty');

            if (poolsList.length === 0) {
                empty.classList.remove('hidden');
                table.classList.add('hidden');
                return;
            }

            table.classList.remove('hidden');
            empty.classList.add('hidden');

            const levelLabels = { mission: 'Mission', project: 'Projet' };

            tbody.innerHTML = poolsList.map(p => {
                const isArchived = !!p.is_archived;
                const statusBadge = isArchived
                    ? '<span class="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">Archivé</span>'
                    : '<span class="text-xs font-semibold bg-green-50 text-green-700 px-2.5 py-1 rounded-full">Actif</span>';
                const levelBadge = p.level
                    ? `<span class="text-xs font-semibold bg-primary-light text-primary px-2.5 py-1 rounded-full">${escapeHtml(levelLabels[p.level] || p.level)}</span>`
                    : '—';

                return `
                <tr class="text-slate-700">
                    <td class="py-3 pr-4 font-semibold">${escapeHtml(p.pool_id)}</td>
                    <td class="py-3 pr-4">${escapeHtml(p.full_name)}</td>
                    <td class="py-3 pr-4">${levelBadge}</td>
                    <td class="py-3 pr-4 text-slate-500 text-xs max-w-xs truncate">${escapeHtml(p.description || '—')}</td>
                    <td class="py-3 pr-4">${statusBadge}</td>
                    <td class="py-3 pr-4">
                        <div class="flex justify-end gap-1.5">
                            <button class="btn-toggle-pool-archive text-xs font-semibold ${isArchived ? 'text-green-700 hover:bg-green-50' : 'text-amber-700 hover:bg-amber-50'} px-2.5 py-1.5 rounded-lg transition-all" data-id="${p.id}" data-archived="${isArchived}" data-code="${escapeHtml(p.pool_id)}">
                                ${isArchived ? 'Désarchiver' : 'Archiver'}
                            </button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
        }

        async function onTogglePoolArchive(poolId, currentlyArchived, code) {
            const nextState = !currentlyArchived;
            openConfirmModal({
                title: nextState ? `Archiver le pool ${code}` : `Désarchiver le pool ${code}`,
                message: nextState
                    ? "Le pool n'apparaîtra plus dans les sélecteurs actifs (dashboard, statistiques)."
                    : "Le pool redeviendra visible et sélectionnable normalement.",
                actionLabel: nextState ? "Archiver" : "Désarchiver",
                icon: nextState ? CapHumaIcons.get('archiveBox', 'w-10 h-10 mx-auto text-slate-400') : CapHumaIcons.get('archiveOut', 'w-10 h-10 mx-auto text-slate-400'),
                onConfirm: async () => {
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    const updatePayload = nextState
                        ? { is_archived: true, archived_at: new Date().toISOString(), archived_by_name: session.user.email }
                        : { is_archived: false, archived_at: null, archived_by_name: null };

                    const { error } = await CapHumaData.updatePool(supabaseClient, poolId, updatePayload);
                    if (error) throw error;
                    toastMessage(nextState ? "Pool archivé." : "Pool désarchivé.");
                    await loadPools();
                }
            });
        }

        document.getElementById('btn-open-create-pool').addEventListener('click', () => {
            document.getElementById('input-pool-code').value = '';
            document.getElementById('input-pool-fullname').value = '';
            document.getElementById('input-pool-description').value = '';
            document.getElementById('modal-create-pool').classList.remove('hidden');
        });
        document.getElementById('btn-cancel-create-pool').addEventListener('click', () => {
            document.getElementById('modal-create-pool').classList.add('hidden');
        });
        document.getElementById('btn-confirm-create-pool').addEventListener('click', async () => {
            const code = document.getElementById('input-pool-code').value.trim().toUpperCase();
            const fullName = document.getElementById('input-pool-fullname').value.trim();
            const level = document.getElementById('input-pool-level').value;
            const description = document.getElementById('input-pool-description').value.trim();
            const spinner = document.getElementById('create-pool-spinner');
            const btn = document.getElementById('btn-confirm-create-pool');

            if (!code || !fullName) {
                toastMessage("Le code et le nom complet sont obligatoires.", "error");
                return;
            }

            btn.disabled = true;
            spinner.classList.remove('hidden');
            try {
                const { error } = await CapHumaData.createPool(supabaseClient, {
                    pool_id: code,
                    name: code,
                    full_name: fullName,
                    level: level,
                    description: description || null,
                    is_active: true,
                    is_archived: false
                });
                if (error) throw error;
                document.getElementById('modal-create-pool').classList.add('hidden');
                toastMessage("Pool créé avec succès.");
                await loadPools();
            } catch (e) {
                console.error(e);
                toastMessage("Échec de la création du pool : " + e.message, "error");
            } finally {
                btn.disabled = false;
                spinner.classList.add('hidden');
            }
        });

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

        function showAccessCodeModal(code) {
            document.getElementById('access-code-value').textContent = code;
            document.getElementById('modal-access-code').classList.remove('hidden');
        }
        document.getElementById('btn-close-access-code').addEventListener('click', () => {
            document.getElementById('access-code-value').textContent = '';
            document.getElementById('modal-access-code').classList.add('hidden');
        });
        document.getElementById('btn-copy-access-code').addEventListener('click', async () => {
            const code = document.getElementById('access-code-value').textContent;
            try {
                await navigator.clipboard.writeText(code);
                toastMessage("Code copié dans le presse-papiers.");
            } catch (e) {
                toastMessage("Impossible de copier automatiquement, copiez le code manuellement.", "error");
            }
        });

        const adminTabs = Array.from(document.querySelectorAll('.admin-tab-btn'));
        const selectAdminTab = capHumaInitTabs(
            document.getElementById('adminTabs'),
            adminTabs,
            tab => document.getElementById('tab-' + tab.dataset.tab),
            activeTab => adminTabs.forEach(tab => {
                const isActive = tab === activeTab;
                tab.classList.toggle('border-primary', isActive);
                tab.classList.toggle('text-primary', isActive);
                tab.classList.toggle('border-transparent', !isActive);
                tab.classList.toggle('text-slate-500', !isActive);
            })
        );
        selectAdminTab(adminTabs[0]);

        document.getElementById('accounts-tbody').addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('.btn-toggle-active');
            if (toggleBtn) { onToggleActive(toggleBtn.dataset.id, toggleBtn.dataset.active === 'true'); return; }

            const resetBtn = e.target.closest('.btn-reset-password');
            if (resetBtn) { onResetPassword(resetBtn.dataset.id); return; }

            const deleteBtn = e.target.closest('.btn-delete-account');
            if (deleteBtn) { onDeleteAccount(deleteBtn.dataset.id, deleteBtn.dataset.email); return; }
        });

        document.getElementById('access-requests-list').addEventListener('click', (e) => {
            const resetBtn = e.target.closest('.btn-reset-password');
            if (resetBtn) { onResetPassword(resetBtn.dataset.id); return; }

            const dismissBtn = e.target.closest('.btn-dismiss-request');
            if (dismissBtn) { onDismissAccessRequest(dismissBtn.dataset.id); return; }
        });

        document.getElementById('pools-tbody').addEventListener('click', (e) => {
            const archiveBtn = e.target.closest('.btn-toggle-pool-archive');
            if (archiveBtn) {
                onTogglePoolArchive(archiveBtn.dataset.id, archiveBtn.dataset.archived === 'true', archiveBtn.dataset.code);
            }
        });

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            await supabaseClient.auth.signOut();
            window.location.replace('login.html');
        });

        window.addEventListener('DOMContentLoaded', () => { checkSession(); capHumaInitModalA11y(); });
})();
