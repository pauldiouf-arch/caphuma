(() => {
        renderDashboardLayout();

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            window.location.replace('index.html');
        }

        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const appBody = document.getElementById('appBody');
        const poolsGrid = document.getElementById('poolsGrid');
        const poolsError = document.getElementById('poolsError');
        const userSubtitle = document.getElementById('userSubtitle');
        const archivedToggleContainer = document.getElementById('archivedToggleContainer');
        const archivedToggleBtn = document.getElementById('archivedToggleBtn');
        let currentUserRole = null;

        archivedToggleBtn.addEventListener('click', function () {
            showArchivedPools = !showArchivedPools;
            renderPools();
        });

        // Ne sert plus que de tout dernier recours (aucun chargement Supabase
        // n'a jamais réussi sur ce navigateur) — voir getFallbackPools() ci-dessous,
        // qui privilégie un cache local mis à jour automatiquement.
        const FALLBACK_POOLS = [
            { pool_id: 'CDM', name: 'CDM', full_name: 'Chef de mission', is_archived: false },
            { pool_id: 'COFIN', name: 'COFIN', full_name: 'Coordinateur Financier', is_archived: false },
            { pool_id: 'COFIRH', name: 'COFIRH', full_name: 'Coordinateur RH et Financier', is_archived: false },
            { pool_id: 'COLOG', name: 'COLOG', full_name: 'Coordinateur Logistique', is_archived: false },
            { pool_id: 'COMED', name: 'COMED', full_name: 'Coordinateur Médical', is_archived: false },
            { pool_id: 'CORH', name: 'CORH', full_name: 'Coordinateur RH', is_archived: false },
            { pool_id: 'RRB', name: 'RRB', full_name: 'Responsable Relation Bailleurs', is_archived: false }
        ];

        // FALLBACK_POOLS ci-dessus est un tableau codé en dur, périmé dès qu'un pool
        // est créé/modifié depuis admin.html — ce cache mémorise dans le navigateur
        // la dernière liste réellement reçue de Supabase avec succès, et est utilisé
        // en priorité sur FALLBACK_POOLS si un chargement échoue.
        const FALLBACK_POOLS_CACHE_KEY = 'caphuma_pools_fallback_cache';

        /**
         * Retourne le meilleur fallback disponible : le cache local (dernière
         * liste réelle vue avec succès) s'il existe et n'est pas vide, sinon le
         * tableau codé en dur FALLBACK_POOLS en tout dernier recours.
         */
        function getFallbackPools() {
            try {
                const cached = localStorage.getItem(FALLBACK_POOLS_CACHE_KEY);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
                }
            } catch (err) {
                console.warn("[Pools] Échec de lecture du cache local :", err);
            }
            return FALLBACK_POOLS;
        }

        // Seuil "à risque" dupliqué côté base : la fonction SQL get_pool_talent_stats()
        // a sa propre copie figée (DEVALIDATION_MAX_MONTHS dans caphuma-utils.js côté JS) —
        // à changer aux deux endroits si ce seuil évolue.

        let currentPools = [];
        let poolStats = {};
        let showArchivedPools = false;
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserName = null;

        // Notifications dans l'app uniquement (aucun email). Jamais affiché pour un
        // visitor. pool_scope null = tous les pools de l'utilisateur.
        let notifPrefs = { enabled: true, pool_scope: null };
        // Seuil dupliqué côté base (get_notification_alerts() a sa propre copie figée) —
        // voir DEVALIDATION_AT_RISK_MONTHS dans caphuma-utils.js.
        const NOTIF_CONTRACT_WINDOWS = [30, 60, 90]; // jours

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
                const s = await capHumaInitSession(supabaseClient);
                currentUserId = s.userId;
                currentUserEmail = s.email;
                currentUserName = s.name;

                capHumaStartIdleTimeout(supabaseClient);

                if (s.role) {
                    currentUserRole = s.role;
                    userSubtitle.textContent = `Connecté en tant que ${s.role || 'utilisateur'}`;

                    if (s.role === 'admin') {
                        document.getElementById('adminNavGroup').classList.remove('hidden');
                        document.getElementById('adminNavGroup').classList.add('flex');
                    }
                    if (s.role === 'visitor') {
                        document.getElementById('navExtraction').classList.add('hidden');
                        document.getElementById('navRedList').classList.add('hidden');
                        document.getElementById('navDevalidated').classList.add('hidden');
                    } else {
                        document.getElementById('notifBellBtn').classList.remove('hidden');
                    }
                } else {
                    userSubtitle.textContent = 'Tableau de bord';
                }

                appBody.style.display = '';
                await loadPools();
                if (currentUserRole && currentUserRole !== 'visitor') {
                    await initNotifications();
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

        document.getElementById('logoutBtn').addEventListener('click', async function () {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            await supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });

        async function loadPools() {
            try {
                const { data: pools, error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('pools')
                        .select('pool_id, name, full_name, is_archived')
                        .order('name', { ascending: true })
                );

                if (error) throw error;

                if (pools && pools.length > 0) {
                    currentPools = pools;
                    // Chargement réussi : on mémorise cette liste comme référence
                    // pour un futur échec éventuel (voir getFallbackPools() ci-dessus).
                    try {
                        localStorage.setItem(FALLBACK_POOLS_CACHE_KEY, JSON.stringify(pools));
                    } catch (storageErr) {
                        console.warn("[Pools] Échec de la mise en cache locale :", storageErr);
                    }
                } else {
                    currentPools = getFallbackPools();
                }

            } catch (error) {
                console.error("Erreur de récupération des pools :", error);
                currentPools = getFallbackPools();
                poolsError.textContent = "Impossible de charger les pools depuis Supabase — affichage des derniers pools connus.";
                poolsError.classList.remove('hidden');
            }

            await loadPoolStats();
            renderPools();
        }

        async function loadPoolStats() {
            poolStats = {};

            // Calculé côté serveur par get_pool_talent_stats() plutôt que de rapatrier
            // tous les talents pour les compter ici.
            try {
                const { data: rows, error } = await capHumaWithRetry(() =>
                    supabaseClient.rpc('get_pool_talent_stats')
                );

                if (error) throw error;

                (rows || []).forEach(row => {
                    if (!row.pool_id) return;
                    if (!poolStats[row.pool_id]) {
                        poolStats[row.pool_id] = { active: 0, available: 0, atRisk: 0, positions: 0 };
                    }
                    poolStats[row.pool_id].active = row.active || 0;
                    poolStats[row.pool_id].available = row.available || 0;
                    poolStats[row.pool_id].atRisk = row.at_risk || 0;
                });

            } catch (error) {
                // Ne bloque jamais l'affichage des cartes de pool.
                console.error("Erreur de récupération des KPIs talents :", error);
            }

            // Calculé côté serveur par get_pool_mission_counts(), qui gère elle-même
            // l'incohérence "pool" vs "pool_id" (coalesce).
            try {
                const { data: rows, error } = await capHumaWithRetry(() =>
                    supabaseClient.rpc('get_pool_mission_counts')
                );

                if (error) throw error;

                (rows || []).forEach(row => {
                    if (!row.pool_id) return;
                    if (!poolStats[row.pool_id]) {
                        poolStats[row.pool_id] = { active: 0, available: 0, atRisk: 0, positions: 0 };
                    }
                    poolStats[row.pool_id].positions = row.positions || 0;
                });

            } catch (error) {
                console.error("Erreur de récupération des KPIs postes :", error);
            }
        }

        function notifToast(msg, type) {
            const toast = document.createElement('div');
            toast.className = `fixed bottom-5 right-5 px-5 py-3 rounded-2xl shadow-xl text-white font-semibold text-xs z-[100] transition-all transform translate-y-10 opacity-0 duration-300 ${
                type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
            }`;
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.remove('translate-y-10', 'opacity-0'), 50);
            setTimeout(() => {
                toast.classList.add('translate-y-10', 'opacity-0');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        async function loadNotificationPrefs() {
            try {
                const { data, error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('notification_preferences')
                        .select('enabled, pool_scope')
                        .eq('user_id', currentUserId)
                        .maybeSingle()
                );
                if (error) throw error;
                if (data) {
                    notifPrefs = { enabled: data.enabled !== false, pool_scope: data.pool_scope || null };
                }
                // Si aucune ligne n'existe encore, notifPrefs garde sa valeur par défaut
                // (activé, tous les pools) — pas d'insertion tant que l'utilisateur n'a
                // rien modifié lui-même.
            } catch (err) {
                console.warn('[Notifications] Préférences non chargées, valeurs par défaut utilisées :', err);
            }
        }

        async function saveNotificationPrefs() {
            try {
                // onConflict: 'user_id' (colonne UNIQUE, une ligne par utilisateur) :
                // une relance après perte de réponse réécrit la même ligne, jamais un
                // doublon — sûr à envelopper dans capHumaWithRetry().
                const { error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('notification_preferences')
                        .upsert({
                            user_id: currentUserId,
                            enabled: notifPrefs.enabled,
                            pool_scope: notifPrefs.pool_scope,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'user_id' })
                );
                if (error) throw error;
                notifToast('Préférences enregistrées.');
            } catch (err) {
                console.error('[Notifications] Échec de l\'enregistrement :', err);
                notifToast("Échec de l'enregistrement des préférences.", 'error');
            }
        }

        // Calculé et filtré par pool (poolScope) côté serveur par get_notification_alerts() —
        // pool_scope null = tous les pools, sinon tableau de pool_id à garder.
        async function loadNotificationAlerts(poolScope) {
            const alerts = { contracts: [], available: [], atRisk: [], vacancies: [] };
            try {
                const { data: rows, error } = await capHumaWithRetry(() =>
                    supabaseClient.rpc('get_notification_alerts', {
                        p_pool_scope: poolScope || null
                    })
                );
                if (error) throw error;

                (rows || []).forEach(row => {
                    if (row.alert_type === 'contract') {
                        alerts.contracts.push({ pool: row.pool_id, daysLeft: row.days_left, window: row.contract_window });
                    } else if (row.alert_type === 'vacancy') {
                        alerts.vacancies.push({ pool: row.pool_id, status: row.status });
                    } else if (row.alert_type === 'available') {
                        alerts.available.push({ pool: row.pool_id });
                    } else if (row.alert_type === 'at_risk') {
                        alerts.atRisk.push({ pool: row.pool_id });
                    }
                });
            } catch (err) {
                // Ne bloque jamais l'affichage du dashboard : la cloche reste vide.
                console.error('[Notifications] Erreur de récupération des alertes :', err);
            }
            return alerts;
        }

        function notifTotalCount(alerts) {
            return alerts.contracts.length + alerts.available.length + alerts.atRisk.length + alerts.vacancies.length;
        }

        function renderNotifBadgeAndList(alerts) {
            const badge = document.getElementById('notifBadge');
            const total = notifTotalCount(alerts);

            if (!notifPrefs.enabled || total === 0) {
                badge.classList.add('hidden');
            } else {
                badge.textContent = total > 99 ? '99+' : String(total);
                badge.classList.remove('hidden');
            }

            const listEl = document.getElementById('notifAlertsList');

            if (!notifPrefs.enabled) {
                listEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-4">Notifications désactivées — activez-les dans « Préférences ».</p>';
                return;
            }

            if (total === 0) {
                listEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-4">Aucune alerte pour le moment.</p>';
                return;
            }

            const sections = [
                { key: 'contracts', icon: CapHumaIcons.get('calendar', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0'), title: 'Contrats arrivant à échéance', render: a => `Pool ${escapeHtml(a.pool)} — fin dans ${a.daysLeft} jour${a.daysLeft > 1 ? 's' : ''} (≤ ${a.window}j)` },
                { key: 'available', icon: CapHumaIcons.get('checkCircle', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0'), title: 'Talents disponibles', render: a => `Pool ${escapeHtml(a.pool)} — talent disponible dès maintenant` },
                { key: 'atRisk', icon: CapHumaIcons.get('alertTriangle', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0'), title: 'Risque de dévalidation (≥20 mois)', render: a => `Pool ${escapeHtml(a.pool)} — talent à risque` },
                { key: 'vacancies', icon: CapHumaIcons.get('briefcase', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0'), title: 'Postes vacants / en recrutement', render: a => `Pool ${escapeHtml(a.pool)} — ${a.status === 'vacant' ? 'vacant' : 'en recrutement'}` }
            ];

            listEl.innerHTML = sections
                .filter(s => alerts[s.key].length > 0)
                .map(s => `
                    <div>
                        <p class="text-xs font-bold text-slate-700 mb-1.5">${s.icon} ${s.title} (${alerts[s.key].length})</p>
                        <ul class="space-y-1">
                            ${alerts[s.key].slice(0, 8).map(a => `<li class="text-[11px] text-slate-500 pl-1">${s.render(a)}</li>`).join('')}
                            ${alerts[s.key].length > 8 ? `<li class="text-[11px] text-slate-500 italic pl-1">+ ${alerts[s.key].length - 8} autre(s)</li>` : ''}
                        </ul>
                    </div>
                `).join('');
        }

        function renderNotifPoolChecklist() {
            const container = document.getElementById('notifPoolChecklist');
            const selected = notifPrefs.pool_scope || [];
            container.innerHTML = currentPools.map(p => `
                <label class="flex items-center gap-2 text-[11px] text-slate-600">
                    <input type="checkbox" class="notif-pool-checkbox rounded border-slate-300" value="${escapeHtml(p.pool_id)}" ${selected.includes(p.pool_id) ? 'checked' : ''}>
                    ${escapeHtml(p.name || p.pool_id)}
                </label>
            `).join('');
        }

        function applyNotifSettingsToForm() {
            document.getElementById('notifEnabledCheckbox').checked = notifPrefs.enabled;
            const isCustom = Array.isArray(notifPrefs.pool_scope);
            document.getElementById('notifScopeAll').checked = !isCustom;
            document.getElementById('notifScopeCustom').checked = isCustom;
            document.getElementById('notifPoolChecklist').classList.toggle('hidden', !isCustom);
            renderNotifPoolChecklist();
        }

        let notifAlertsCache = { contracts: [], available: [], atRisk: [], vacancies: [] };

        async function initNotifications() {
            await loadNotificationPrefs();
            applyNotifSettingsToForm();

            notifAlertsCache = await loadNotificationAlerts(notifPrefs.pool_scope);
            renderNotifBadgeAndList(notifAlertsCache);
        }

        // ---- Interactions du panneau ----
        const notifBellBtn = document.getElementById('notifBellBtn');
        const notifPanel = document.getElementById('notifPanel');
        const notifSettingsBlock = document.getElementById('notifSettingsBlock');

        // aria-expanded mis à jour aux deux endroits où le panneau change d'état :
        // ouverture/fermeture par clic sur la cloche, et fermeture en cliquant ailleurs.
        notifBellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notifPanel.classList.toggle('hidden');
            notifBellBtn.setAttribute('aria-expanded', String(!notifPanel.classList.contains('hidden')));
        });

        document.addEventListener('click', (e) => {
            if (!notifPanel.classList.contains('hidden') && !notifPanel.contains(e.target) && e.target !== notifBellBtn) {
                notifPanel.classList.add('hidden');
                notifBellBtn.setAttribute('aria-expanded', 'false');
            }
        });

        // notifPanel n'est pas un vrai modal (ne bloque pas le reste de la page) :
        // pas de piège complet du focus comme capHumaInitModalA11y() sur les vrais
        // modaux, seule la fermeture au clavier est ajoutée ici.
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !notifPanel.classList.contains('hidden')) {
                notifPanel.classList.add('hidden');
                notifBellBtn.setAttribute('aria-expanded', 'false');
                notifBellBtn.focus();
            }
        });

        document.getElementById('notifSettingsToggleBtn').addEventListener('click', () => {
            notifSettingsBlock.classList.toggle('hidden');
        });

        document.getElementById('notifScopeAll').addEventListener('change', () => {
            document.getElementById('notifPoolChecklist').classList.add('hidden');
        });
        document.getElementById('notifScopeCustom').addEventListener('change', () => {
            document.getElementById('notifPoolChecklist').classList.remove('hidden');
        });

        document.getElementById('notifSavePrefsBtn').addEventListener('click', async () => {
            const enabled = document.getElementById('notifEnabledCheckbox').checked;
            const isCustom = document.getElementById('notifScopeCustom').checked;
            let poolScope = null;
            if (isCustom) {
                poolScope = Array.from(document.querySelectorAll('.notif-pool-checkbox:checked')).map(cb => cb.value);
            }
            notifPrefs = { enabled, pool_scope: poolScope };
            await saveNotificationPrefs();
            notifAlertsCache = await loadNotificationAlerts(notifPrefs.pool_scope);
            renderNotifBadgeAndList(notifAlertsCache);
        });

        function poolIcon(poolId) {
            const icons = {
                COLOG: CapHumaIcons.get('truck', 'w-6 h-6'),
                COMED: CapHumaIcons.get('heart', 'w-6 h-6'),
                ADMIN: CapHumaIcons.get('folder', 'w-6 h-6')
            };
            return icons[poolId] || CapHumaIcons.get('globeAlt', 'w-6 h-6');
        }

        function renderPools() {
            poolsGrid.innerHTML = '';

            const activePools = currentPools.filter(pool => pool.is_archived !== true);
            const archivedPools = currentPools.filter(pool => pool.is_archived === true);

            if (archivedPools.length > 0) {
                archivedToggleContainer.classList.remove('hidden');
                archivedToggleBtn.innerHTML = showArchivedPools
                    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg> Masquer les pools archivés (${archivedPools.length})`
                    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg> Afficher les pools archivés (${archivedPools.length})`;
            } else {
                archivedToggleContainer.classList.add('hidden');
            }

            const poolsToRender = showArchivedPools ? currentPools : activePools;

            if (poolsToRender.length === 0) {
                poolsGrid.innerHTML = '<p class="col-span-full text-center text-sm text-slate-500 py-12">Aucun pool à afficher.</p>';
                return;
            }

            poolsToRender.forEach(pool => {
                const stats = poolStats[pool.pool_id] || { active: 0, available: 0, atRisk: 0, positions: 0 };
                const isArchived = pool.is_archived === true;

                const card = document.createElement('div');
                card.className = "bg-white border border-slate-200 rounded-3xl shadow-sm p-6 flex flex-col justify-between transition-all"
                    + (isArchived ? " opacity-60" : " hover:shadow-md");

                card.innerHTML = `
                    <div>
                        <div class="flex items-center justify-between mb-4">
                            <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-light text-2xl">
                                ${poolIcon(pool.pool_id)}
                            </div>
                            ${isArchived ? '<span class="text-[10px] font-bold uppercase tracking-wide text-slate-600 bg-slate-100 px-2 py-1 rounded-full">Archivé</span>' : ''}
                        </div>
                        <h3 class="text-lg font-extrabold text-slate-800">${escapeHtml(pool.name || pool.pool_id)}</h3>
                        <p class="text-xs text-slate-500 font-semibold mt-1">${escapeHtml(pool.full_name || '')}</p>

                        <div class="grid grid-cols-4 gap-1.5 mt-4">
                            <div class="bg-slate-50 rounded-xl px-1.5 py-2 text-center">
                                <p class="text-base font-extrabold text-slate-800">${stats.active}</p>
                                <p class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Effectif</p>
                            </div>
                            <div class="bg-emerald-50 rounded-xl px-1.5 py-2 text-center">
                                <p class="text-base font-extrabold text-emerald-700">${stats.available}</p>
                                <p class="text-[10px] font-semibold text-emerald-500 uppercase tracking-wide">Dispo</p>
                            </div>
                            <div class="bg-red-50 rounded-xl px-1.5 py-2 text-center">
                                <p class="text-base font-extrabold text-red-700">${stats.atRisk}</p>
                                <p class="text-[10px] font-semibold text-red-500 uppercase tracking-wide">À risque</p>
                            </div>
                            <div class="bg-blue-50 rounded-xl px-1.5 py-2 text-center">
                                <p class="text-base font-extrabold text-primary">${stats.positions}</p>
                                <p class="text-[10px] font-semibold text-blue-400 uppercase tracking-wide">Postes</p>
                            </div>
                        </div>
                    </div>
                    <div class="flex flex-col gap-2 mt-6">
                        <div class="grid grid-cols-2 gap-2">
                            <a href="talents.html?pool=${encodeURIComponent(pool.pool_id)}" class="bg-primary hover:bg-primary-dark text-white px-3 py-2.5 rounded-lg text-xs font-bold text-center transition-all shadow-xs">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"/></svg> Professionnels
                            </a>
                            <a href="missions.html?pool=${encodeURIComponent(pool.pool_id)}" class="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-3 py-2.5 rounded-lg text-xs font-bold text-center transition-all">
                                Postes
                            </a>
                        </div>
                        <a href="statistics.html?pool=${encodeURIComponent(pool.pool_id)}" class="bg-accent-light hover:bg-orange-100 text-accent-dark px-4 py-2.5 rounded-lg text-xs font-bold text-center transition-all">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/></svg> Statistiques du Pool
                        </a>
                    </div>
                `;

                poolsGrid.appendChild(card);
            });
        }
})();
