(() => {
        renderPageLayout({
            icon: CapHumaIcons.get('clipboard', 'w-5 h-5'),
            title: "Journal d'audit",
            actionsHtml: `
                <button id="exportBtn" class="bg-accent hover:bg-accent-dark text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-1.5">
                    ${CapHumaIcons.get('inboxDown', 'w-4 h-4 inline-block align-[-0.15em] shrink-0')} Exporter Excel
                </button>
            `
        });

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            window.location.replace('index.html');
        }

        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const appBody = document.getElementById('appBody');
        const pageError = document.getElementById('pageError');

        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserName = null;

        const PAGE_SIZE = 50;
        let currentPage = 0;
        let currentPageLogs = [];       // lignes de la page actuellement affichée
        let currentFilteredCount = 0;   // nombre total de lignes correspondant aux filtres actifs (toutes pages confondues)

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
                document.getElementById('user-display-name').textContent = currentUserEmail;

                if (s.role !== 'admin') {
                    throw new Error("Accès réservé aux administrateurs.");
                }

                appBody.style.display = '';
                await loadLogs();
            } catch (error) {
                console.warn("[Session Guard] Accès refusé, expulsion :", error.message);
                window.location.replace('dashboard.html');
            }
        }
        checkSession();

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            await supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });

        const ACTION_LABELS = {
            create: 'Création', update: 'Modification', delete: 'Suppression',
            devalidate: 'Dévalidation', reintegrate: 'Réintégration',
            add_to_red_list: 'Ajout liste rouge', remove_from_red_list: 'Retrait liste rouge',
            login: 'Connexion', logout: 'Déconnexion', export: 'Export'
        };
        const ACTION_BADGE_CLASS = {
            create: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            update: 'bg-blue-50 text-blue-700 border-blue-200',
            delete: 'bg-red-50 text-red-700 border-red-200',
            devalidate: 'bg-orange-50 text-orange-700 border-orange-200',
            reintegrate: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            add_to_red_list: 'bg-red-50 text-red-700 border-red-200',
            remove_from_red_list: 'bg-slate-100 text-slate-600 border-slate-200',
            login: 'bg-slate-100 text-slate-600 border-slate-200',
            logout: 'bg-slate-100 text-slate-600 border-slate-200',
            export: 'bg-indigo-50 text-indigo-700 border-indigo-200'
        };
        const ENTITY_TYPE_LABELS = {
            talent: 'Talent', mission: 'Poste', comment: 'Commentaire',
            user: 'Utilisateur', system: 'Système'
        };

        function fmtDateTime(value) {
            if (!value) return '—';
            const d = new Date(value);
            return isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR');
        }

        async function loadLogs() {
            await Promise.all([loadHeaderStats(), fetchPage()]);
        }

        // "Utilisateurs actifs"/"Types d'actions" sont calculés sur une fenêtre bornée
        // des 7 derniers jours, indépendamment des filtres du tableau ci-dessous — des
        // KPI stables, pas un résumé de la vue filtrée actuelle.
        async function loadHeaderStats() {
            try {
                const { count: totalCount, error: totalErr } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('audit_logs')
                        .select('*', { count: 'exact', head: true })
                );
                if (totalErr) throw totalErr;
                document.getElementById('statTotal').textContent = totalCount || 0;

                const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
                const { data: recentLogs, error: recentErr } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('audit_logs')
                        .select('user_email, user_id, action')
                        .gte('created_at', sevenDaysAgoIso)
                );
                if (recentErr) throw recentErr;

                const recent = recentLogs || [];
                document.getElementById('statRecent').textContent = recent.length;
                document.getElementById('statUsers').textContent = new Set(recent.map(l => l.user_email || l.user_id).filter(Boolean)).size;
                document.getElementById('statTypes').textContent = new Set(recent.map(l => l.action).filter(Boolean)).size;
            } catch (err) {
                console.error("Erreur de chargement des statistiques d'audit :", err);
                // Non bloquant : un échec des cartes KPI n'empêche pas la consultation du tableau.
            }
        }

        // Cette page est réservée admin uniquement (contrairement à red_list/extraction,
        // admin+user) : service_role contourne RLS, un simple "visitor exclu" comme sur
        // les 2 autres ressources sensibles n'aurait pas suffi ici — contrôle appliqué
        // côté serveur, dans l'Edge Function.

        // Objet de filtres réutilisé pour la page courante ET l'export Excel, pour ne
        // jamais avoir deux logiques de filtre à maintenir en parallèle.
        function buildLogsFilterParams() {
            const actionFilter = document.getElementById('filterAction').value;
            const entityTypeFilter = document.getElementById('filterEntityType').value;
            const periodFilter = document.getElementById('filterPeriod').value;
            const exactDateFilter = document.getElementById('filterExactDate').value;
            const exactBounds = exactDateBounds(exactDateFilter);
            const periodStart = exactBounds ? null : periodStartDate(periodFilter);

            // Le filtre "Jour précis" prend le pas sur "Période" s'il est renseigné.
            document.getElementById('exactDateHint').classList.toggle('hidden', !exactBounds);
            document.getElementById('filterPeriod').disabled = !!exactBounds;

            const params = {};
            if (actionFilter) params.action = actionFilter;
            if (entityTypeFilter) params.entityType = entityTypeFilter;
            if (exactBounds) {
                params.gte = new Date(exactBounds.start).toISOString();
                params.lte = new Date(exactBounds.end).toISOString();
            } else if (periodStart !== null) {
                params.gte = new Date(periodStart).toISOString();
            }
            return params;
        }

        async function fetchPage() {
            const loadingState = document.getElementById('tableLoadingState');
            loadingState.classList.remove('hidden');
            document.getElementById('logsTableBody').innerHTML = '';

            try {
                const filters = buildLogsFilterParams();

                // page courante 0-indexée (currentPage) → convertie en 1-indexée pour
                // l'Edge Function, même convention que red_list/extraction.
                const result = await fetchSensitiveRead(supabaseClient, 'audit_logs', { mode: 'page', page: currentPage + 1, filters });

                currentPageLogs = result.data;
                currentFilteredCount = result.count;

                renderTable();
                updateAuditLogsPaginationControls();

                const hasFilter = !!(
                    document.getElementById('filterAction').value ||
                    document.getElementById('filterEntityType').value ||
                    document.getElementById('filterPeriod').value ||
                    document.getElementById('filterExactDate').value
                );
                document.getElementById('resetFiltersBtn').classList.toggle('hidden', !hasFilter);

            } catch (err) {
                console.error(err);
                pageError.textContent = "Impossible de charger le journal d'audit : " + (err && err.message ? err.message : 'erreur inconnue.');
                pageError.classList.remove('hidden');
                loadingState.classList.add('hidden');
            }
        }

        function periodStartDate(period) {
            const now = new Date();
            if (period === 'today') {
                return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            }
            if (period === 'week') {
                return now.getTime() - 7 * 24 * 60 * 60 * 1000;
            }
            if (period === 'month') {
                return now.getTime() - 30 * 24 * 60 * 60 * 1000;
            }
            return null;
        }

        // "Jour précis" : bornes [00:00, 23:59:59.999] du jour choisi, en heure locale
        // du navigateur — cohérent avec l'affichage des dates (toLocaleString('fr-FR')).
        function exactDateBounds(dateStr) {
            if (!dateStr) return null;
            const [year, month, day] = dateStr.split('-').map(Number);
            const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
            const end = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
            return { start, end };
        }

        // Nom volontairement différent de renderPaginationControls() (shared/caphuma-utils.js) :
        // signature et logique différentes, un même nom écraserait silencieusement l'une des deux.
        function updateAuditLogsPaginationControls() {
            const controls = document.getElementById('logsPaginationControls');
            const totalPages = Math.max(1, Math.ceil(currentFilteredCount / PAGE_SIZE));

            if (currentFilteredCount === 0) {
                controls.classList.add('hidden');
                return;
            }
            controls.classList.remove('hidden');
            document.getElementById('logsPaginationLabel').textContent = `Page ${currentPage + 1} sur ${totalPages}`;
            document.getElementById('logsPrevPageBtn').disabled = currentPage === 0;
            document.getElementById('logsNextPageBtn').disabled = currentPage >= totalPages - 1;
        }

        document.getElementById('logsPrevPageBtn').addEventListener('click', () => {
            if (currentPage > 0) {
                currentPage -= 1;
                fetchPage();
            }
        });

        document.getElementById('logsNextPageBtn').addEventListener('click', () => {
            const totalPages = Math.max(1, Math.ceil(currentFilteredCount / PAGE_SIZE));
            if (currentPage < totalPages - 1) {
                currentPage += 1;
                fetchPage();
            }
        });

        function renderTable() {
            const tbody = document.getElementById('logsTableBody');
            const emptyState = document.getElementById('tableEmptyState');
            const loadingState = document.getElementById('tableLoadingState');
            const countLabel = document.getElementById('tableCountLabel');

            loadingState.classList.add('hidden');
            tbody.innerHTML = '';

            countLabel.textContent = `${currentFilteredCount} action${currentFilteredCount > 1 ? 's' : ''} correspondant aux filtres`;

            if (currentPageLogs.length === 0) {
                emptyState.classList.remove('hidden');
                return;
            }
            emptyState.classList.add('hidden');

            currentPageLogs.forEach(log => {
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-slate-50 transition-colors';
                const badgeClass = ACTION_BADGE_CLASS[log.action] || 'bg-slate-100 text-slate-600 border-slate-200';
                tr.innerHTML = `
                    <td class="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">${escapeHtml(fmtDateTime(log.created_at))}</td>
                    <td class="px-4 py-2.5 text-xs text-slate-700">${escapeHtml(log.user_name || log.user_email || 'Inconnu')}</td>
                    <td class="px-4 py-2.5"><span class="text-[10px] font-bold px-2 py-1 rounded-full border ${badgeClass}">${escapeHtml(ACTION_LABELS[log.action] || log.action)}</span></td>
                    <td class="px-4 py-2.5 text-xs text-slate-500">${escapeHtml(ENTITY_TYPE_LABELS[log.entity_type] || log.entity_type)}</td>
                    <td class="px-4 py-2.5 text-xs text-slate-700">${escapeHtml(log.entity_name || log.entity_id || '—')}</td>
                    <td class="px-4 py-2.5 text-xs text-slate-500 max-w-xs truncate" title="${escapeHtml(log.details || '')}">${escapeHtml(log.details || '—')}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        ['filterAction', 'filterEntityType', 'filterPeriod', 'filterExactDate'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                currentPage = 0;
                fetchPage();
            });
        });

        document.getElementById('resetFiltersBtn').addEventListener('click', () => {
            document.getElementById('filterAction').value = '';
            document.getElementById('filterEntityType').value = '';
            document.getElementById('filterPeriod').value = '';
            document.getElementById('filterExactDate').value = '';
            currentPage = 0;
            fetchPage();
        });

        document.getElementById('exportBtn').addEventListener('click', async () => {
            if (currentFilteredCount === 0) {
                alert("Aucune action à exporter avec les filtres actuels.");
                return;
            }
            if (currentFilteredCount > 5000) {
                const proceed = confirm(`Cet export contient ${currentFilteredCount} lignes et peut prendre du temps à générer. Continuer ?`);
                if (!proceed) return;
            }

            try {
                const filters = buildLogsFilterParams();
                const result = await fetchSensitiveRead(supabaseClient, 'audit_logs', { mode: 'export', filters });
                const filtered = result.data || [];

                if (filtered.length === 0) {
                    alert("Aucune action à exporter avec les filtres actuels.");
                    return;
                }

                const rows = filtered.map(log => ({
                    'Date': fmtDateTime(log.created_at),
                    'Utilisateur': log.user_name || log.user_email || 'Inconnu',
                    'Email': log.user_email || '',
                    'Action': ACTION_LABELS[log.action] || log.action,
                    "Type d'entité": ENTITY_TYPE_LABELS[log.entity_type] || log.entity_type,
                    'Entité': log.entity_name || log.entity_id || '-',
                    'Détails': log.details || '-'
                }));

                const ws = XLSX.utils.json_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Logs d'audit");

                const now = new Date();
                const stamp = now.toISOString().slice(0, 16).replace('T', '_').replace(':', 'h');
                XLSX.writeFile(wb, `logs_audit_${stamp}.xlsx`);

                // Traçabilité RGPD des exports : savoir qui a extrait des données, pas
                // seulement qui les a créées/modifiées.
                await logAuditAction('export', 'system', null, `Journal d'audit (${filtered.length} ligne(s))`,
                    Object.keys(filters).length > 0 ? 'Filtres actifs : ' + JSON.stringify(filters) : 'Aucun filtre');
            } catch (err) {
                console.error(err);
                alert("Erreur lors de l'export : " + (err && err.message ? err.message : 'erreur inconnue.'));
            }
        });
})();
