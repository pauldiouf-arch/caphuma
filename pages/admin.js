        // ============================================================================
        // HEADER COMMUN (B4, Master Context §7) — injecté avant toute autre chose,
        // pour que #user-display-name et #logoutBtn existent dès la suite du script.
        // ============================================================================
        renderPageLayout({
            icon: '🛡️',
            title: 'Administration',
            iconGradient: 'from-primary to-primary-dark',
            variant: 'scroll-page'
        });

        const appBody = document.getElementById('appBody');
        let supabaseClient = null;
        let accountsList = [];
        let poolsList = [];
        let pendingConfirmAction = null;
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserName = null;

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
                appBody.style.display = '';

                if (s.role !== 'admin') {
                    document.getElementById('access-denied-banner').classList.remove('hidden');
                    setTimeout(() => window.location.replace('dashboard.html'), 2500);
                    return;
                }

                document.getElementById('admin-content').classList.remove('hidden');
                await Promise.all([loadAccounts(), loadPools()]);
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

        // ============ APPEL SÉCURISÉ À manage-users ============
        // Rappel section 2 du Master Context : le header 'apikey' est
        // OBLIGATOIRE en plus de 'Authorization', sinon 401 systématique
        // côté gateway avant même d'atteindre le code de la fonction.
        async function callManageUsers(action, payload = {}) {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) {
                // Correctif complémentaire à P10 (28/08/2026, décision utilisateur,
                // trouvé en testant P10) : même traitement que le 401/403 plus bas
                // — si le navigateur n'a plus AUCUNE session locale (déconnexion
                // depuis un autre onglet, stockage local vidé...), rester sur place
                // avec un simple message d'erreur n'aide personne : chaque nouvelle
                // action échouerait de la même façon jusqu'à un rechargement manuel.
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

            // Correctif P19 (B15-R2, 31/08/2026, décision n°15) : retry
            // UNIQUEMENT sur "create" et "delete", jamais sur
            // "reset_password" — tranché après un test en conditions réelles
            // le 31/08/2026 (Master Context §7 B15-R2) : create/delete
            // échouent proprement à un 2e appel (email déjà utilisé, compte
            // déjà supprimé), alors que reset_password réussit deux fois de
            // suite sans protection — un double appel génère un second code
            // d'accès ET une seconde ligne dans audit_logs pour une seule
            // action voulue par l'admin (confirmé par le test).
            const response = (action === 'create' || action === 'delete')
                ? await capHumaWithRetry(doFetch)
                : await doFetch();

            // Correctif P10 (B14-I3, 28/08/2026) : un token expiré/refusé (401/403)
            // remontait jusqu'ici comme une erreur générique ("Échec de l'action :
            // ..."), sans jamais déconnecter ni rediriger vers login.html —
            // l'utilisateur restait sur une page qui semblait fonctionner mais
            // dont chaque nouvelle action échouerait de la même façon jusqu'à un
            // rechargement manuel. Déconnexion + redirection explicites dès la
            // détection, avant même de tenter de lire le corps de la réponse.
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

        // ============ GESTION DES COMPTES ============

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

            // Rôles réels autorisés par la contrainte CHECK "users_role_check"
            // vérifiée en base : admin / user / visitor. "user" est libellé
            // "Recruteur" côté métier (le Master Context affirmait à tort
            // "recruteur" comme valeur stockée — même type d'erreur que
            // tokenIdentifier, corrigé après vérification directe).
            const roleLabels = { admin: '🛡️ Admin', user: '👤 Recruteur', visitor: '👁️ Visiteur' };
            const roleColors = {
                admin: 'bg-primary-light text-primary',
                user: 'bg-green-50 text-green-700',
                visitor: 'bg-slate-100 text-slate-600'
            };

            tbody.innerHTML = accountsList.map(u => {
                const createdDate = u.created_at ? new Date(u.created_at).toLocaleDateString('fr-FR') : '—';
                const statusBadge = u.is_active
                    ? '<span class="text-xs font-semibold bg-green-50 text-green-700 px-2.5 py-1 rounded-full">Actif</span>'
                    : '<span class="text-xs font-semibold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full">Suspendu</span>';
                const roleBadge = `<span class="text-xs font-semibold ${roleColors[u.role] || 'bg-slate-100 text-slate-600'} px-2.5 py-1 rounded-full">${roleLabels[u.role] || u.role}</span>`;

                return `
                <tr class="text-slate-700">
                    <td class="py-3 pr-4 font-medium">${escapeHtml(u.name || '—')}</td>
                    <td class="py-3 pr-4 text-slate-500">${escapeHtml(u.email || '—')}</td>
                    <td class="py-3 pr-4">${roleBadge}</td>
                    <td class="py-3 pr-4">${statusBadge}</td>
                    <td class="py-3 pr-4 text-slate-400 text-xs">${createdDate}</td>
                    <td class="py-3 pr-4">
                        <div class="flex justify-end gap-1.5 flex-wrap">
                            <button class="btn-toggle-active text-xs font-semibold ${u.is_active ? 'text-amber-600 hover:bg-amber-50' : 'text-green-600 hover:bg-green-50'} px-2.5 py-1.5 rounded-lg transition-all" data-id="${u.id}" data-active="${u.is_active}">
                                ${u.is_active ? 'Suspendre' : 'Réactiver'}
                            </button>
                            <button class="btn-reset-password text-xs font-semibold text-primary hover:bg-primary-light px-2.5 py-1.5 rounded-lg transition-all" data-id="${u.id}">
                                Réinitialiser
                            </button>
                            <button class="btn-delete-account text-xs font-semibold text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-all" data-id="${u.id}" data-email="${escapeHtml(u.email || '')}">
                                Supprimer
                            </button>
                        </div>
                    </td>
                </tr>`;
            }).join('');

            attachAccountRowListeners();
        }

        function attachAccountRowListeners() {
            document.querySelectorAll('.btn-toggle-active').forEach(btn => {
                btn.addEventListener('click', () => onToggleActive(btn.dataset.id, btn.dataset.active === 'true'));
            });
            document.querySelectorAll('.btn-reset-password').forEach(btn => {
                btn.addEventListener('click', () => onResetPassword(btn.dataset.id));
            });
            document.querySelectorAll('.btn-delete-account').forEach(btn => {
                btn.addEventListener('click', () => onDeleteAccount(btn.dataset.id, btn.dataset.email));
            });
        }

        // Suspension / réactivation : client direct sur is_active (pas besoin d'Edge Function, section 8)
        async function onToggleActive(userId, currentlyActive) {
            const nextState = !currentlyActive;
            openConfirmModal({
                title: nextState ? "Réactiver le compte" : "Suspendre le compte",
                message: nextState
                    ? "L'utilisateur retrouvera immédiatement l'accès à la plateforme."
                    : "L'utilisateur perdra immédiatement l'accès à la plateforme.",
                actionLabel: nextState ? "Réactiver" : "Suspendre",
                icon: nextState ? "✅" : "⏸️",
                onConfirm: async () => {
                    const { error } = await capHumaWithRetry(() =>
                        supabaseClient
                            .from('users')
                            .update({ is_active: nextState })
                            .eq('id', userId)
                    );
                    if (error) throw error;
                    const targetAccount = accountsList.find(a => a.id === userId);
                    await logAuditAction('update', 'user', userId, targetAccount ? (targetAccount.name || targetAccount.email) : userId, nextState ? "Réactivation du compte" : "Suspension du compte");
                    toastMessage(nextState ? "Compte réactivé." : "Compte suspendu.");
                    await loadAccounts();
                }
            });
        }

        async function onResetPassword(userId) {
            openConfirmModal({
                title: "Réinitialiser le code d'accès",
                message: "Un nouveau code sera généré et l'ancien cessera immédiatement de fonctionner.",
                actionLabel: "Réinitialiser",
                icon: "🔑",
                onConfirm: async () => {
                    const result = await callManageUsers('reset_password', { userId });
                    // Journalisation retirée d'ici le 17/07/2026 : manage-users l'écrit
                    // désormais lui-même côté serveur (garanti, quel que soit le chemin
                    // d'appel) — la laisser ici aurait créé une ligne en double.
                    showAccessCodeModal(result.accessCode);
                    // Correctif P9 (B12-S2, 28/08/2026) : manage-users peut renvoyer un
                    // avertissement même en cas de succès (ex. révocation des sessions
                    // actives échouée) — jusqu'ici silencieusement ignoré ici, alors que
                    // ce champ existait déjà pour l'action delete ci-dessous (même angle
                    // mort, corrigé pour les deux actions en même temps).
                    if (result.warning) {
                        toastMessage(result.warning, "error");
                    } else {
                        toastMessage("Code d'accès réinitialisé avec succès.");
                    }
                }
            });
        }

        async function onDeleteAccount(userId, email) {
            openConfirmModal({
                title: "Supprimer définitivement ce compte",
                message: `Cette action est irréversible. Le compte "${email}" et son accès seront définitivement supprimés.`,
                actionLabel: "Supprimer",
                icon: "🗑️",
                onConfirm: async () => {
                    const result = await callManageUsers('delete', { userId });
                    // Journalisation retirée d'ici le 17/07/2026 : manage-users l'écrit
                    // désormais lui-même côté serveur, avant même la suppression de la
                    // ligne 'users' — la laisser ici aurait créé une ligne en double.
                    // Correctif P9 (B12-S2, 28/08/2026) : voir onResetPassword()
                    // ci-dessus, même angle mort (champ "warning" ignoré) corrigé pour
                    // les deux actions en même temps.
                    if (result.warning) {
                        toastMessage(result.warning, "error");
                    } else {
                        toastMessage("Compte supprimé avec succès.");
                    }
                    await loadAccounts();
                }
            });
        }

        // Création de compte
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
                // Paramètre envoyé à l'Edge Function : fullName, mappé sur la
                // colonne 'name' en base (voir section 8 du Master Context).
                const result = await callManageUsers('create', { email, role, fullName });
                // Journalisation retirée d'ici le 17/07/2026 : manage-users l'écrit
                // désormais lui-même côté serveur — la laisser ici aurait créé une
                // ligne en double.
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

        // ============ GESTION DES POOLS ============

        async function loadPools() {
            const loading = document.getElementById('pools-loading');
            const empty = document.getElementById('pools-empty');
            const table = document.getElementById('pools-table');
            loading.classList.remove('hidden');
            empty.classList.add('hidden');
            table.classList.add('hidden');

            try {
                const { data, error } = await capHumaWithRetry(() =>
                    supabaseClient.from('pools').select('id, pool_id, full_name, level, description, is_archived')
                );
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
                    ? '<span class="text-xs font-semibold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full">Archivé</span>'
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
                            <button class="btn-toggle-pool-archive text-xs font-semibold ${isArchived ? 'text-green-600 hover:bg-green-50' : 'text-amber-600 hover:bg-amber-50'} px-2.5 py-1.5 rounded-lg transition-all" data-id="${p.id}" data-archived="${isArchived}" data-code="${escapeHtml(p.pool_id)}">
                                ${isArchived ? 'Désarchiver' : 'Archiver'}
                            </button>
                        </div>
                    </td>
                </tr>`;
            }).join('');

            document.querySelectorAll('.btn-toggle-pool-archive').forEach(btn => {
                btn.addEventListener('click', () => onTogglePoolArchive(btn.dataset.id, btn.dataset.archived === 'true', btn.dataset.code));
            });
        }

        async function onTogglePoolArchive(poolId, currentlyArchived, code) {
            const nextState = !currentlyArchived;
            openConfirmModal({
                title: nextState ? `Archiver le pool ${code}` : `Désarchiver le pool ${code}`,
                message: nextState
                    ? "Le pool n'apparaîtra plus dans les sélecteurs actifs (dashboard, statistiques)."
                    : "Le pool redeviendra visible et sélectionnable normalement.",
                actionLabel: nextState ? "Archiver" : "Désarchiver",
                icon: nextState ? "📦" : "📤",
                onConfirm: async () => {
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    const updatePayload = nextState
                        ? { is_archived: true, archived_at: new Date().toISOString(), archived_by_name: session.user.email }
                        : { is_archived: false, archived_at: null, archived_by_name: null };

                    const { error } = await capHumaWithRetry(() =>
                        supabaseClient.from('pools').update(updatePayload).eq('id', poolId)
                    );
                    if (error) throw error;
                    toastMessage(nextState ? "Pool archivé." : "Pool désarchivé.");
                    await loadPools();
                }
            });
        }

        // Création de pool (insert direct, pas besoin d'Edge Function — section 8)
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
                // Schéma réel vérifié via information_schema.columns (name, level,
                // full_name, pool_id sont NOT NULL) : name reçoit le code court,
                // cohérent avec le pattern déjà observé côté Convex de référence.
                //
                // Enveloppé dans capHumaWithRetry() (P19, décision n°15, affiné
                // le 31/08/2026) : contrairement aux 10 autres insert() du site,
                // celui-ci est sûr à retenter — pools.pool_id porte une
                // contrainte UNIQUE (Dossier de passation §4.2) et "code" est lu
                // une seule fois, avant l'appel, donc un retry retente EXACTEMENT
                // le même pool_id. En cas de doublon (1re tentative en fait
                // réussie côté serveur, réponse perdue), la 2e tentative tombe
                // proprement sur une violation de contrainte plutôt que de
                // créer un second pool silencieux.
                const { error } = await capHumaWithRetry(() =>
                    supabaseClient.from('pools').insert({
                        pool_id: code,
                        name: code,
                        full_name: fullName,
                        level: level,
                        description: description || null,
                        is_active: true,
                        is_archived: false
                    })
                );
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

        // ============ MODALES GÉNÉRIQUES ============

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

        // ============ ONGLETS ============

        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.admin-tab-btn').forEach(b => {
                    b.classList.remove('border-primary', 'text-primary');
                    b.classList.add('border-transparent', 'text-slate-500');
                });
                btn.classList.add('border-primary', 'text-primary');
                btn.classList.remove('border-transparent', 'text-slate-500');

                document.getElementById('tab-accounts').classList.add('hidden');
                document.getElementById('tab-pools').classList.add('hidden');
                document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
            });
        });

        // ============ UTILITAIRES ============


        // ============ INITIALISATION ============

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            if (supabaseClient) await supabaseClient.auth.signOut();
            window.location.replace('login.html');
        });

        window.addEventListener('DOMContentLoaded', () => { checkSession(); capHumaInitModalA11y(); }); // P15 (B18-A3)
