        // ============================================================================
        // HEADER COMMUN (B4, Master Context §7, 2ᵉ étape) — injecté avant toute
        // autre chose, pour que #userSubtitle, #adminNavGroup, #navExtraction,
        // #notifBellBtn, #logoutBtn, etc. existent dès la suite du script.
        // ============================================================================
        renderDashboardLayout();

        // ============================================================================
        // 1. INITIALISATION SUPABASE (lecture dynamique localStorage, jamais en dur)
        // ============================================================================
        // SUPABASE_URL / SUPABASE_ANON_KEY viennent désormais de shared/caphuma-config.js
        // (chargé dans le head) — remplace l'ancien pont localStorage (MC13 Addendum U3).

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

        // Échappement HTML systématique de toute donnée venant de la base
        // avant injection via innerHTML — prévention XSS (audit sécurité).

        // Pools de secours si la table Supabase est vide ou inaccessible
        // CORRIGÉ le 14/08/2026 : ADMIN n'existe pas réellement (voir Dossier
        // technique §4.6), remplacé par les 7 vrais pools actuels (extraits en
        // direct de la table `pools` le 14/08/2026 — la doc de juillet n'en
        // listait que 4, incomplète/périmée depuis). Ce tableau ne sert
        // désormais plus que de tout dernier recours : voir getFallbackPools()
        // ci-dessous, qui privilégie un cache local mis à jour automatiquement.
        const FALLBACK_POOLS = [
            { pool_id: 'CDM', name: 'CDM', full_name: 'Chef de mission', is_archived: false },
            { pool_id: 'COFIN', name: 'COFIN', full_name: 'Coordinateur Financier', is_archived: false },
            { pool_id: 'COFIRH', name: 'COFIRH', full_name: 'Coordinateur RH et Financier', is_archived: false },
            { pool_id: 'COLOG', name: 'COLOG', full_name: 'Coordinateur Logistique', is_archived: false },
            { pool_id: 'COMED', name: 'COMED', full_name: 'Coordinateur Médical', is_archived: false },
            { pool_id: 'CORH', name: 'CORH', full_name: 'Coordinateur RH', is_archived: false },
            { pool_id: 'RRB', name: 'RRB', full_name: 'Responsable Relation Bailleurs', is_archived: false }
        ];

        // ============================================================================
        // AJOUT DU 14/08/2026 : cache local des pools (pérennise le fallback)
        // ----------------------------------------------------------------------------
        // Problème résolu : FALLBACK_POOLS ci-dessus est un tableau codé en dur —
        // il devient périmé dès qu'un pool est créé/modifié depuis admin.html
        // (c'est exactement ce qui s'est produit avec ADMIN/COFIN/CDM). Plutôt que
        // de compter sur une mise à jour manuelle de ce fichier à chaque nouveau
        // pool, on mémorise dans le navigateur (localStorage) la dernière liste
        // RÉELLEMENT reçue de Supabase avec succès, et on l'utilise en priorité si
        // un chargement échoue. FALLBACK_POOLS ne sert plus alors que de tout
        // dernier recours (aucun chargement jamais réussi sur ce navigateur).
        // ============================================================================
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

        // Seuil "à risque" (24 mois) : vient désormais de shared/caphuma-utils.js
        // (DEVALIDATION_MAX_MONTHS), au lieu d'une constante locale à cette page —
        // centralisation du 18/08/2026, voir cette même constante pour l'historique.
        // ⚠️ Reste néanmoins DUPLIQUÉ côté base : la fonction SQL
        // get_pool_talent_stats() a sa propre copie figée (le SQL ne peut pas lire
        // une constante JS) — si ce seuil change un jour, il faut le changer aux
        // DEUX endroits, ici (DEVALIDATION_MAX_MONTHS dans caphuma-utils.js) ET dans
        // la fonction SQL (voir sql/schema_snapshot_2026-08-18.sql §8).

        // État en mémoire : liste brute des pools, KPIs calculés par pool, affichage des archivés
        let currentPools = [];
        let poolStats = {};
        let showArchivedPools = false;
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserName = null;

        // ============================================================================
        // NOTIFICATIONS (dans l'app uniquement, aucun email) — préférences stockées
        // dans notification_preferences, alertes calculées à chaque ouverture du
        // tableau de bord. Jamais affiché pour un visitor (pas concerné par le
        // suivi RH). pool_scope null = tous les pools de l'utilisateur.
        // ============================================================================
        let notifPrefs = { enabled: true, pool_scope: null };
        // Seuil de risque de dévalidation (20 mois) : vient désormais de
        // shared/caphuma-utils.js (DEVALIDATION_AT_RISK_MONTHS) — centralisation du
        // 18/08/2026, avant dupliqué ici sous un autre nom (NOTIF_DEVALIDATION_RISK_MONTHS).
        // ⚠️ Reste DUPLIQUÉ côté base : get_notification_alerts() a sa propre copie
        // figée — si ce seuil change, changer aux DEUX endroits (voir
        // sql/schema_snapshot_2026-08-18.sql §8).
        //
        // NOTIF_CONTRACT_WINDOWS (fenêtres de contrat, en JOURS) n'est PAS concernée
        // par cette centralisation : famille de valeur différente (jours, pas mois),
        // non dupliquée ailleurs en JS — seule sa copie dans get_notification_alerts()
        // (SQL) reste une duplication résiduelle, mineure, non traitée ici.
        const NOTIF_CONTRACT_WINDOWS = [30, 60, 90]; // jours


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
        // 2. GARDE DE SESSION (identique au pattern de missions.html)
        // ============================================================================
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

                    // Affichage conditionnel des boutons réservés aux admins
                    if (s.role === 'admin') {
                        document.getElementById('adminNavGroup').classList.remove('hidden');
                        document.getElementById('adminNavGroup').classList.add('flex');
                    }
                    // Le bouton Extraction est réservé aux recruteurs et admins (pas aux visiteurs)
                    if (s.role === 'visitor') {
                        document.getElementById('navExtraction').classList.add('hidden');
                        document.getElementById('navRedList').classList.add('hidden');
                        document.getElementById('navDevalidated').classList.add('hidden');
                    } else {
                        // Notifications réservées à admin/user — jamais visitor, non concerné
                        // par le suivi RH (échéances, dévalidation, etc.)
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

        // ============================================================================
        // 3. CHARGEMENT DES POOLS ET RENDU DES CARTES
        // ============================================================================
        async function loadPools() {
            try {
                const { data: pools, error } = await supabaseClient
                    .from('pools')
                    .select('pool_id, name, full_name, is_archived')
                    .order('name', { ascending: true });

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

        // ============================================================================
        // 3 BIS. CALCUL DES MINI-KPIS PAR POOL (Étape 4 — effectifs / dispo / à risque)
        // ============================================================================
        async function loadPoolStats() {
            poolStats = {};

            // 1. KPIs talents (effectif / dispo / à risque)
            // ⚡ Optimisation : calcul fait côté serveur par la fonction SQL
            // get_pool_talent_stats() (au lieu de rapatrier tous les talents dans le
            // navigateur pour les compter ici). Le seuil "à risque" (24 mois) et le
            // statut "En attente de poste" sont désormais définis dans la fonction SQL —
            // voir DEVALIDATION_MAX_MONTHS (shared/caphuma-utils.js) si ce seuil doit un
            // jour être changé (il faudra le changer aux deux endroits, SQL et JS).
            try {
                const { data: rows, error } = await supabaseClient.rpc('get_pool_talent_stats');

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
                // Ne bloque jamais l'affichage des cartes de pool : les KPIs restent à 0 en cas d'échec
                console.error("Erreur de récupération des KPIs talents :", error);
            }

            // 2. KPI postes (nombre total de missions du pool, tous statuts confondus)
            // ⚡ Optimisation : calcul fait côté serveur par la fonction SQL
            // get_pool_mission_counts(), qui gère déjà elle-même l'incohérence
            // "pool" vs "pool_id" (coalesce), documentée précédemment ici même.
            try {
                const { data: rows, error } = await supabaseClient.rpc('get_pool_mission_counts');

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

        // ============================================================================
        // 3 TER. NOTIFICATIONS — préférences + calcul des alertes (dans l'app uniquement)
        // ============================================================================
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
                const { data, error } = await supabaseClient
                    .from('notification_preferences')
                    .select('enabled, pool_scope')
                    .eq('user_id', currentUserId)
                    .maybeSingle();
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
                const { error } = await supabaseClient
                    .from('notification_preferences')
                    .upsert({
                        user_id: currentUserId,
                        enabled: notifPrefs.enabled,
                        pool_scope: notifPrefs.pool_scope,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'user_id' });
                if (error) throw error;
                notifToast('Préférences enregistrées.');
            } catch (err) {
                console.error('[Notifications] Échec de l\'enregistrement :', err);
                notifToast("Échec de l'enregistrement des préférences.", 'error');
            }
        }

        // ⚡ Optimisation : calcul fait côté serveur par la fonction SQL
        // get_notification_alerts(), qui reprend exactement la même logique que
        // l'ancien computeNotificationAlerts() (mêmes seuils, mêmes fenêtres de
        // contrat, même gestion pool/pool_id) — voir DEVALIDATION_AT_RISK_MONTHS
        // (shared/caphuma-utils.js) et NOTIF_CONTRACT_WINDOWS ci-dessus si ces
        // valeurs doivent changer un jour.
        // Le filtre par pool (poolScope) est désormais fait par la base elle-même,
        // au lieu d'être fait après coup ici — la base ne renvoie que les alertes
        // qui concernent les pools suivis par l'utilisateur.
        //
        // pool_scope null = tous les pools ; sinon tableau de pool_id à garder.
        async function loadNotificationAlerts(poolScope) {
            const alerts = { contracts: [], available: [], atRisk: [], vacancies: [] };
            try {
                const { data: rows, error } = await supabaseClient.rpc('get_notification_alerts', {
                    p_pool_scope: poolScope || null
                });
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
                // Ne bloque jamais l'affichage du dashboard : la cloche reste vide en cas d'échec
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
                listEl.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Notifications désactivées — activez-les dans « Préférences ».</p>';
                return;
            }

            if (total === 0) {
                listEl.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Aucune alerte pour le moment 👍</p>';
                return;
            }

            const sections = [
                { key: 'contracts', icon: '📅', title: 'Contrats arrivant à échéance', render: a => `Pool ${escapeHtml(a.pool)} — fin dans ${a.daysLeft} jour${a.daysLeft > 1 ? 's' : ''} (≤ ${a.window}j)` },
                { key: 'available', icon: '✅', title: 'Talents disponibles', render: a => `Pool ${escapeHtml(a.pool)} — talent disponible dès maintenant` },
                { key: 'atRisk', icon: '⚠️', title: 'Risque de dévalidation (≥20 mois)', render: a => `Pool ${escapeHtml(a.pool)} — talent à risque` },
                { key: 'vacancies', icon: '🟡', title: 'Postes vacants / en recrutement', render: a => `Pool ${escapeHtml(a.pool)} — ${a.status === 'vacant' ? 'vacant' : 'en recrutement'}` }
            ];

            listEl.innerHTML = sections
                .filter(s => alerts[s.key].length > 0)
                .map(s => `
                    <div>
                        <p class="text-xs font-bold text-slate-700 mb-1.5">${s.icon} ${s.title} (${alerts[s.key].length})</p>
                        <ul class="space-y-1">
                            ${alerts[s.key].slice(0, 8).map(a => `<li class="text-[11px] text-slate-500 pl-1">${s.render(a)}</li>`).join('')}
                            ${alerts[s.key].length > 8 ? `<li class="text-[11px] text-slate-400 italic pl-1">+ ${alerts[s.key].length - 8} autre(s)</li>` : ''}
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

        // Correctif P5 (B18-A7, 27/08/2026) : notifBellBtn n'exposait jusqu'ici
        // aucun état (aria-expanded) — un lecteur d'écran ne pouvait pas savoir
        // si le panneau qu'il contrôle est ouvert ou fermé. Mis à jour aux deux
        // endroits où le panneau change d'état : l'ouverture/fermeture par clic
        // sur la cloche, ET la fermeture par clic en dehors du panneau.
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
                COLOG: '🚚',
                COMED: '🩺',
                ADMIN: '📁'
            };
            return icons[poolId] || '🌍';
        }

        function renderPools() {
            poolsGrid.innerHTML = '';

            const activePools = currentPools.filter(pool => pool.is_archived !== true);
            const archivedPools = currentPools.filter(pool => pool.is_archived === true);

            // Bouton de bascule visible uniquement s'il existe au moins un pool archivé
            if (archivedPools.length > 0) {
                archivedToggleContainer.classList.remove('hidden');
                archivedToggleBtn.textContent = showArchivedPools
                    ? `🔽 Masquer les pools archivés (${archivedPools.length})`
                    : `▶️ Afficher les pools archivés (${archivedPools.length})`;
            } else {
                archivedToggleContainer.classList.add('hidden');
            }

            const poolsToRender = showArchivedPools ? currentPools : activePools;

            if (poolsToRender.length === 0) {
                poolsGrid.innerHTML = '<p class="col-span-full text-center text-sm text-slate-400 py-12">Aucun pool à afficher.</p>';
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
                            ${isArchived ? '<span class="text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 px-2 py-1 rounded-full">Archivé</span>' : ''}
                        </div>
                        <h3 class="text-lg font-extrabold text-slate-800">${escapeHtml(pool.name || pool.pool_id)}</h3>
                        <p class="text-xs text-slate-400 font-semibold mt-1">${escapeHtml(pool.full_name || '')}</p>

                        <div class="grid grid-cols-4 gap-1.5 mt-4">
                            <div class="bg-slate-50 rounded-xl px-1.5 py-2 text-center">
                                <p class="text-base font-extrabold text-slate-800">${stats.active}</p>
                                <p class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Effectif</p>
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
                                👤 Professionnels
                            </a>
                            <a href="missions.html?pool=${encodeURIComponent(pool.pool_id)}" class="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-3 py-2.5 rounded-lg text-xs font-bold text-center transition-all">
                                Postes
                            </a>
                        </div>
                        <a href="statistics.html?pool=${encodeURIComponent(pool.pool_id)}" class="bg-accent-light hover:bg-orange-100 text-accent-dark px-4 py-2.5 rounded-lg text-xs font-bold text-center transition-all">
                            📊 Statistiques du Pool
                        </a>
                    </div>
                `;

                poolsGrid.appendChild(card);
            });
        }
