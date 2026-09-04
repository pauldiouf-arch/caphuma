// Script enveloppé dans une IIFE anonyme pour isoler sa portée — élimine tout
// risque qu'une déclaration top-level de cette page masque silencieusement
// une fonction/variable partagée (shared/caphuma-*.js) chargée avant elle, ou
// soit elle-même masquée par une autre page à l'avenir.
(() => {
        // ============================================================================
        // HEADER COMMUN — injecté avant toute autre chose, y compris avant les
        // document.getElementById('generateBtn'/'generateBtnLabel') ci-dessous,
        // puisque ces boutons font partie du header injecté.
        // ============================================================================
        renderPageLayout({
            icon: '📊',
            title: 'Extraction',
            subtitle: 'Export Excel multi-pool',
            actionsHtml: `
                <button id="generateBtn" disabled class="bg-accent hover:bg-accent-dark text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                    📥 <span id="generateBtnLabel">Générer le fichier Excel</span>
                </button>
            `
        });

        // ============================================================================
        // 1. INITIALISATION SUPABASE
        // ============================================================================
        // SUPABASE_URL / SUPABASE_ANON_KEY viennent désormais de shared/caphuma-config.js
        // (chargé dans le head) — remplace l'ancien pont localStorage.

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            window.location.replace('index.html');
        }

        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const appBody = document.getElementById('appBody');
        const pageError = document.getElementById('pageError');
        const exportStatus = document.getElementById('exportStatus');
        const generateBtn = document.getElementById('generateBtn');
        const generateBtnLabel = document.getElementById('generateBtnLabel');

        let currentUserRole = null;
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserName = null;
        let pools = [];               // [{ pool_id, name, full_name }]
        let allTalents = [];          // tous les talents (toutes colonnes)
        let allMissions = [];         // tous les postes (toutes colonnes)
        const talentPoolsSelected = new Set();
        const positionPoolsSelected = new Set();

        // ============================================================================
        // Journal d'audit — ne bloque jamais l'action si l'écriture échoue, sur le
        // même modèle que les autres pages du site.
        // ============================================================================
        // Fabriquée avec des getters (pas des valeurs) : relit supabaseClient et les
        // variables currentUser* à chaque appel de logAuditAction(), jamais figée à
        // la création.
        const logAuditAction = capHumaMakeAuditLogger(
            () => supabaseClient,
            () => ({
                userId: currentUserId,
                userEmail: currentUserEmail,
                userName: typeof currentUserName !== 'undefined' ? currentUserName : null
            })
        );

        // ============================================================================
        // 2. GARDE DE SESSION — réservée admin + user (recruteur), bloquée pour visitor
        // ============================================================================
        async function checkSession() {
            try {
                const s = await capHumaInitSession(supabaseClient);
                currentUserId = s.userId;
                currentUserEmail = s.email;
                currentUserName = s.name;

                capHumaStartIdleTimeout(supabaseClient);
                document.getElementById('user-display-name').textContent = currentUserEmail;
                currentUserRole = s.role;

                if (currentUserRole === 'visitor') {
                    throw new Error("Accès non autorisé pour ce rôle.");
                }

                appBody.style.display = '';
                await loadData();
            } catch (error) {
                console.warn("[Session Guard] Accès refusé, expulsion :", error.message);
                window.location.replace('dashboard.html');
            }
        }
        checkSession();

        document.getElementById('logoutBtn').addEventListener('click', async function () {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            await supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });

        // ============================================================================
        // 3. LIBELLÉS (identiques à missions.html / id-card.html)
        // ============================================================================
        // STATUS_LABELS, DESK_LABELS, CANDIDATE_TYPE_LABELS, CONTRACT_STATUS_LABELS,
        // EDU_LEVEL_LABELS, MISSION_COUNT_LABELS sont désormais tous fournis par
        // shared/caphuma-utils.js (valeurs identiques).
        const POOL_LEVEL_LABELS = { mission: 'Mission', project: 'Projet' };

        function fmtDate(value) {
            if (!value) return '';
            const d = new Date(value);
            return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR');
        }
        function yesNo(value) { return value ? 'Oui' : 'Non'; }
        function safeSheetName(name) {
            return String(name || 'Feuille').replace(/[:\\/?*\[\]]/g, '-').substring(0, 31);
        }

        // ============================================================================
        // 4. CHARGEMENT DES DONNÉES (une seule fois, filtrage/regroupement en mémoire)
        // ============================================================================
        async function loadData() {
            try {
                const [poolsRes, talentsRes, missionsRes] = await Promise.all([
                    capHumaWithRetry(() =>
                        supabaseClient.from('pools').select('pool_id, name, full_name, is_archived').order('name', { ascending: true })
                    ),
                    capHumaWithRetry(() => supabaseClient.from('talents').select('*')),
                    capHumaWithRetry(() => supabaseClient.from('missions').select('*'))
                ]);

                if (poolsRes.error) throw poolsRes.error;
                if (talentsRes.error) throw talentsRes.error;
                if (missionsRes.error) throw missionsRes.error;

                // Pools archivés exclus, cohérent avec ce qui est déjà masqué sur dashboard.html
                pools = (poolsRes.data || []).filter(p => !p.is_archived);
                allTalents = talentsRes.data || [];
                allMissions = missionsRes.data || [];

                renderPoolLists();
            } catch (err) {
                console.error(err);
                pageError.textContent = "Impossible de charger les données : " + (err && err.message ? err.message : 'erreur inconnue.');
                pageError.classList.remove('hidden');
            }
        }

        // ============================================================================
        // 5. RENDU DES DEUX LISTES DE POOLS (avec compteurs en direct)
        // ============================================================================
        function talentCountForPool(poolId) {
            return allTalents.filter(t => t.pool === poolId).length;
        }
        function missionCountForPool(poolId) {
            return allMissions.filter(m => m.pool === poolId).length;
        }

        function renderPoolLists() {
            renderPoolList('talentPoolsList', talentPoolsSelected, talentCountForPool, 'talent');
            renderPoolList('positionPoolsList', positionPoolsSelected, missionCountForPool, 'poste');
            updateSummary();
        }

        function renderPoolList(containerId, selectedSet, countFn, unitLabel) {
            const container = document.getElementById(containerId);
            container.innerHTML = '';

            if (pools.length === 0) {
                container.innerHTML = `<p class="text-xs text-slate-500 italic">Aucun pool actif trouvé.</p>`;
                return;
            }

            pools.forEach(pool => {
                const count = countFn(pool.pool_id);
                const checked = selectedSet.has(pool.pool_id);
                // <label> plutôt que <div> : une <div cursor-pointer> seule n'a pas
                // d'équivalent clavier (la
                // checkbox à l'intérieur n'était que visuelle, jamais atteignable au
                // Tab). Un <label> enveloppant une checkbox réelle relaie nativement
                // le clic ET la touche Espace vers la checkbox, qui redevient
                // focusable — aucune autre logique à dupliquer, le clic sur le label
                // (déclenché par la souris OU par la checkbox elle-même) continue de
                // basculer selectedSet exactement comme avant.
                const row = document.createElement('label');
                row.className = `pool-row flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-all ${checked ? 'selected border-primary bg-primary-light' : 'border-slate-200 hover:bg-slate-50'}`;
                row.innerHTML = `
                    <div class="flex items-center gap-3 min-w-0">
                        <input type="checkbox" class="pool-checkbox h-4 w-4 rounded border-slate-300 text-primary shrink-0" ${checked ? 'checked' : ''} />
                        <div class="min-w-0">
                            <p class="font-bold text-sm text-slate-800 truncate">${escapeHtml(pool.name || pool.pool_id)}</p>
                            <p class="text-xs text-slate-500 truncate">${escapeHtml(pool.full_name || '')}</p>
                        </div>
                    </div>
                    <span class="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full ${checked ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}">
                        ${count} ${unitLabel}${count > 1 ? 's' : ''}
                    </span>
                `;
                row.addEventListener('click', () => {
                    if (selectedSet.has(pool.pool_id)) selectedSet.delete(pool.pool_id);
                    else selectedSet.add(pool.pool_id);
                    renderPoolLists();
                });
                container.appendChild(row);
            });
        }

        document.getElementById('talentSelectAllBtn').addEventListener('click', () => {
            pools.forEach(p => talentPoolsSelected.add(p.pool_id));
            renderPoolLists();
        });
        document.getElementById('talentClearAllBtn').addEventListener('click', () => {
            talentPoolsSelected.clear();
            renderPoolLists();
        });
        document.getElementById('positionSelectAllBtn').addEventListener('click', () => {
            pools.forEach(p => positionPoolsSelected.add(p.pool_id));
            renderPoolLists();
        });
        document.getElementById('positionClearAllBtn').addEventListener('click', () => {
            positionPoolsSelected.clear();
            renderPoolLists();
        });

        // ============================================================================
        // 6. RÉCAPITULATIF EN DIRECT (cartes + légende + bouton générer)
        // ============================================================================
        function updateSummary() {
            const talentCount = allTalents.filter(t => talentPoolsSelected.has(t.pool)).length;
            const positionCount = allMissions.filter(m => positionPoolsSelected.has(m.pool)).length;
            const sheetCount = (talentPoolsSelected.size > 0 ? 1 : 0) + positionPoolsSelected.size;

            document.getElementById('statTalentPools').textContent = talentPoolsSelected.size;
            document.getElementById('statTalentCount').textContent = talentCount > 0
                ? `${talentCount} talent${talentCount > 1 ? 's' : ''} à exporter`
                : 'Aucun talent sélectionné';

            document.getElementById('statPositionPools').textContent = positionPoolsSelected.size;
            document.getElementById('statPositionCount').textContent = positionCount > 0
                ? `${positionCount} poste${positionCount > 1 ? 's' : ''} à exporter`
                : 'Aucun poste sélectionné';

            document.getElementById('statSheetCount').textContent = sheetCount;
            document.getElementById('statSheetLabel').textContent = sheetCount > 0
                ? `${talentPoolsSelected.size > 0 ? '1 feuille liste pros' : ''}${talentPoolsSelected.size > 0 && positionPoolsSelected.size > 0 ? ' + ' : ''}${positionPoolsSelected.size > 0 ? positionPoolsSelected.size + ' feuille' + (positionPoolsSelected.size > 1 ? 's' : '') + ' postes' : ''}`
                : 'Aucune sélection';

            const legend = document.getElementById('structureLegend');
            const legendBody = document.getElementById('structureLegendBody');
            if (sheetCount === 0) {
                legend.classList.add('hidden');
            } else {
                legend.classList.remove('hidden');
                let html = '';
                let sheetIndex = 1;
                if (talentPoolsSelected.size > 0) {
                    html += `<div class="flex items-center gap-2"><span class="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500 text-white shrink-0">Feuille ${sheetIndex}</span><span>Liste pros combinée — ${Array.from(talentPoolsSelected).join(', ')} (${talentCount} talents)</span></div>`;
                    sheetIndex++;
                }
                Array.from(positionPoolsSelected).forEach(poolId => {
                    const count = missionCountForPool(poolId);
                    html += `<div class="flex items-center gap-2"><span class="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-200 text-slate-700 shrink-0">Feuille ${sheetIndex}</span><span>Postes ${escapeHtml(poolId)} (${count} poste${count > 1 ? 's' : ''})</span></div>`;
                    sheetIndex++;
                });
                legendBody.innerHTML = html;
            }

            generateBtn.disabled = (talentPoolsSelected.size === 0 && positionPoolsSelected.size === 0);
        }

        // ============================================================================
        // 7. CONSTRUCTION DES LIGNES DE CHAQUE FEUILLE
        // ============================================================================
        function buildListesProsRows(talents) {
            return talents.map(t => ({
                'Pool': t.pool || '',
                'Prénom': t.first_name || '',
                'Nom': t.last_name || '',
                'Email': t.email || '',
                'Statut': t.status || '',
                'Validé': yesNo(t.is_valid !== false),
                'Liste rouge': yesNo(!!t.is_red_listed),
                'Fonction actuelle': t.current_function || '',
                'Nationalité': t.nationality || '',
                'Pays de résidence': t.country_of_residence || '',
                "Niveau d'études": EDU_LEVEL_LABELS[t.education_level] || t.education_level || '',
                'Expérience ALIMA (mois)': t.experience_months_alima || 0,
                'Expérience humanitaire (mois)': t.experience_months_humanitarian || 0,
                'Missions ALIMA antérieures': MISSION_COUNT_LABELS[t.number_of_alima_missions] || '',
                'En mission actuellement': yesNo(!!t.is_currently_on_mission),
                'Mois sans mission': t.months_without_mission || 0,
                "Date d'intégration pool": fmtDate(t.pool_integration_date)
            }));
        }

        function buildMissionRows(mission, talentsById) {
            const base = {
                'Titre': mission.title || '',
                'Niveau': POOL_LEVEL_LABELS[mission.pool_level] || mission.pool_level || '',
                'Projet': mission.project_name || '',
                'Pays': mission.country || '',
                'Lieu': mission.location || '',
                'Type de candidat': CANDIDATE_TYPE_LABELS[mission.candidate_type] || mission.candidate_type || '',
                'Desk': DESK_LABELS[mission.desk] || mission.desk || '',
                'Statut du poste': STATUS_LABELS[mission.status] || mission.status || '',
                'Statut du contrat': CONTRACT_STATUS_LABELS[mission.contract_status] || mission.contract_status || ''
            };
            const rows = [];

            if (mission.occupant_id && talentsById[mission.occupant_id]) {
                const occ = talentsById[mission.occupant_id];
                rows.push({
                    ...base, 'Rôle': 'Occupant actuel',
                    'Talent': `${occ.first_name || ''} ${occ.last_name || ''}`.trim(),
                    'Email talent': occ.email || '',
                    'Date début': fmtDate(mission.contract_start_date),
                    'Date fin': fmtDate(mission.contract_end_date)
                });
            }
            if (mission.future_talent_id && talentsById[mission.future_talent_id]) {
                const fut = talentsById[mission.future_talent_id];
                rows.push({
                    ...base, 'Rôle': 'Futur occupant',
                    'Talent': `${fut.first_name || ''} ${fut.last_name || ''}`.trim(),
                    'Email talent': fut.email || '',
                    'Date début': fmtDate(mission.future_contract_start_date),
                    'Date fin': fmtDate(mission.future_contract_end_date)
                });
            }
            if (rows.length === 0) {
                rows.push({ ...base, 'Rôle': '—', 'Talent': '—', 'Email talent': '', 'Date début': '', 'Date fin': '' });
            }
            return rows;
        }

        // ============================================================================
        // 8. GÉNÉRATION DU FICHIER (uniquement les pools cochés)
        // ============================================================================
        function setStatus(msg, isError) {
            exportStatus.textContent = msg;
            exportStatus.classList.remove('hidden', 'text-primary', 'bg-primary-light', 'text-red-600', 'bg-red-50');
            exportStatus.classList.add(isError ? 'text-red-600' : 'text-primary', isError ? 'bg-red-50' : 'bg-primary-light');
        }

        function generateExport() {
            if (talentPoolsSelected.size === 0 && positionPoolsSelected.size === 0) {
                setStatus("Sélectionnez au moins un pool (listes pros ou postes).", true);
                return;
            }

            generateBtn.disabled = true;
            generateBtnLabel.textContent = 'Génération...';

            try {
                const wb = XLSX.utils.book_new();

                // --- Feuille 1 : Listes pros combinée ---
                if (talentPoolsSelected.size > 0) {
                    const filteredTalents = allTalents.filter(t => talentPoolsSelected.has(t.pool));
                    const rows = filteredTalents.length > 0
                        ? buildListesProsRows(filteredTalents)
                        : [{ 'Info': 'Aucun talent trouvé pour les pools sélectionnés.' }];
                    const poolNames = Array.from(talentPoolsSelected).join('+');
                    const ws = XLSX.utils.json_to_sheet(rows);
                    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(`Listes pros (${poolNames})`));
                }

                // --- Une feuille par pool sélectionné pour les postes ---
                // Talents référencés (occupant/futur occupant) des postes concernés,
                // requête ciblée pour construire les noms/emails.
                const poolMissionsMap = {};
                Array.from(positionPoolsSelected).forEach(poolId => {
                    poolMissionsMap[poolId] = allMissions.filter(m => m.pool === poolId);
                });

                const referencedIds = new Set();
                Object.values(poolMissionsMap).flat().forEach(m => {
                    if (m.occupant_id) referencedIds.add(m.occupant_id);
                    if (m.future_talent_id) referencedIds.add(m.future_talent_id);
                });
                const talentsById = {};
                allTalents.forEach(t => {
                    if (referencedIds.has(t.id)) talentsById[t.id] = t;
                });

                Array.from(positionPoolsSelected).forEach(poolId => {
                    const poolMissions = poolMissionsMap[poolId] || [];
                    let rows = [];
                    poolMissions.forEach(m => { rows = rows.concat(buildMissionRows(m, talentsById)); });
                    if (rows.length === 0) rows = [{ 'Info': 'Aucun poste pour ce pool.' }];
                    const ws = XLSX.utils.json_to_sheet(rows);
                    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(`Postes ${poolId}`));
                });

                if (wb.SheetNames.length === 0) {
                    throw new Error("Aucune donnée à exporter.");
                }

                const today = new Date().toISOString().slice(0, 10);
                XLSX.writeFile(wb, `extraction-cap-huma-${today}.xlsx`);

                setStatus("✅ Fichier Excel généré et téléchargé avec succès.", false);
            } catch (err) {
                console.error("Erreur d'export :", err);
                setStatus("❌ Échec de la génération : " + (err && err.message ? err.message : 'erreur inconnue.'), true);
            } finally {
                generateBtn.disabled = (talentPoolsSelected.size === 0 && positionPoolsSelected.size === 0);
                generateBtnLabel.textContent = 'Générer le fichier Excel';
            }
        }

        generateBtn.addEventListener('click', generateExport);
})();
