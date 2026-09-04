// Rendu de la liste des postes, barre de KPIs, statistiques détaillées des
// contrats. Voir missions.js (chargé AVANT ce fichier) pour l'explication de
// MissionsPage, l'objet d'état partagé entre les 4 fichiers de cette page.
(() => {
        // DOM propres à ce fichier (re-sélectionnés localement — sans coût, ce
        // sont de simples document.getElementById() ; pas besoin de les faire
        // transiter par MissionsPage, contrairement à l'état métier mutable).
        const missionsGrid = document.getElementById('missionsGrid');
        const missionsEmpty = document.getElementById('missionsEmpty');
        const kpiBar = document.getElementById('kpiBar');

        // ============================================================================
        // 3 TER. BARRE DE KPIS DU POOL (cf. Hercules positions/stats.ts)
        // ============================================================================
        function updateKpiBar() {
            if (MissionsPage.currentMissions.length === 0) {
                kpiBar.classList.add('hidden');
                return;
            }
            kpiBar.classList.remove('hidden');

            const now = Date.now();
            const sixMonthsLater = now + 6 * 30 * 24 * 60 * 60 * 1000;

            const total = MissionsPage.currentMissions.length;
            const occupied = MissionsPage.currentMissions.filter(m => m.status === 'occupied').length;
            const recruiting = MissionsPage.currentMissions.filter(m => m.status === 'recruiting').length;
            const vacant = MissionsPage.currentMissions.filter(m => m.status === 'vacant').length;

            const endingSoon = MissionsPage.currentMissions.filter(m => {
                if (!m.contract_end_date) return false;
                const t = new Date(m.contract_end_date).getTime();
                return t > now && t <= sixMonthsLater;
            }).length;

            const withContracts = MissionsPage.currentMissions.filter(m => m.contract_start_date && m.contract_end_date);
            const durations = withContracts.map(m => {
                const start = new Date(m.contract_start_date).getTime();
                const end = new Date(m.contract_end_date).getTime();
                return Math.round((end - start) / (1000 * 60 * 60 * 24 * 30));
            });
            const avgDuration = durations.length > 0
                ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
                : 0;

            document.getElementById('kpiTotal').textContent = total;
            document.getElementById('kpiOccupied').textContent = occupied;
            document.getElementById('kpiRecruiting').textContent = recruiting;
            document.getElementById('kpiVacant').textContent = vacant;
            document.getElementById('kpiEndingSoon').textContent = endingSoon;
            document.getElementById('kpiAvgDuration').textContent = avgDuration;
        }

        // Exposé sur MissionsPage pour appel depuis les autres fichiers de la page
        MissionsPage.updateKpiBar = updateKpiBar;

        // ============================================================================
        // 3 QUATER. STATISTIQUES DÉTAILLÉES DES CONTRATS (cf. Hercules
        // positions/stats.ts : getDetailedPositionStats). Calculées côté client à
        // partir des postes du pool déjà chargés (MissionsPage.currentMissions), cohérent avec le
        // choix déjà fait pour MissionsPage.updateKpiBar() — pas de requête Supabase supplémentaire.
        // ============================================================================
        function updateDetailedContractStats() {
            const card = document.getElementById('detailedStatsCard');
            if (MissionsPage.currentMissions.length === 0) {
                card.classList.add('hidden');
                return;
            }
            card.classList.remove('hidden');

            const now = Date.now();
            const oneMonthLater = now + 30 * 24 * 60 * 60 * 1000;
            const threeMonthsLater = now + 3 * 30 * 24 * 60 * 60 * 1000;
            const sixMonthsLater = now + 6 * 30 * 24 * 60 * 60 * 1000;

            const withContracts = MissionsPage.currentMissions.filter(m => m.contract_start_date && m.contract_end_date);
            const durations = withContracts.map(m => {
                const start = new Date(m.contract_start_date).getTime();
                const end = new Date(m.contract_end_date).getTime();
                return Math.round((end - start) / (1000 * 60 * 60 * 24 * 30));
            });
            const avgDuration = durations.length > 0
                ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
                : 0;

            const ongoing = MissionsPage.currentMissions.filter(m => m.contract_status === 'ongoing').length;
            const renewable = MissionsPage.currentMissions.filter(m => m.contract_status === 'renewable').length;
            const renewalRate = withContracts.length > 0
                ? Math.round((renewable / withContracts.length) * 100)
                : 0;

            // Échéances cumulatives (comme Hercules : "fin dans 3 mois" inclut ce qui
            // finit dans le mois qui vient, pas une tranche exclusive 1-3 mois).
            const endsWithin = (maxDate) => MissionsPage.currentMissions.filter(m => {
                if (!m.contract_end_date) return false;
                const t = new Date(m.contract_end_date).getTime();
                return t > now && t <= maxDate;
            }).length;

            document.getElementById('statWithContracts').textContent = withContracts.length;
            document.getElementById('statAvgDuration').textContent = avgDuration + ' mois';
            document.getElementById('statOngoing').textContent = ongoing;
            document.getElementById('statRenewable').textContent = renewable;
            document.getElementById('statRenewalRate').textContent = renewalRate + '%';
            document.getElementById('statEnding1m').textContent = endsWithin(oneMonthLater);
            document.getElementById('statEnding3m').textContent = endsWithin(threeMonthsLater);
            document.getElementById('statEnding6m').textContent = endsWithin(sixMonthsLater);

            // Répartition par pays
            const byCountry = {};
            MissionsPage.currentMissions.forEach(m => {
                const c = m.country || 'Non précisé';
                byCountry[c] = (byCountry[c] || 0) + 1;
            });
            document.getElementById('statByCountry').innerHTML = Object.entries(byCountry)
                .sort((a, b) => b[1] - a[1])
                .map(([country, count]) => `
                    <div class="flex justify-between"><span class="text-slate-400">${escapeHtml(country)}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('');

            // Répartition par desk (ajouté par rapport à Hercules : Cap Huma trace
            // déjà le desk sur missions, donnée jugée utile en complément du pays).
            const byDesk = {};
            MissionsPage.currentMissions.forEach(m => {
                if (!m.desk) return;
                const label = DESK_LABELS[m.desk] || m.desk;
                byDesk[label] = (byDesk[label] || 0) + 1;
            });
            const deskEntries = Object.entries(byDesk);
            document.getElementById('statByDesk').innerHTML = deskEntries.length > 0
                ? deskEntries.sort((a, b) => b[1] - a[1]).map(([label, count]) => `
                    <div class="flex justify-between"><span class="text-slate-400">${escapeHtml(label)}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('')
                : '<p class="text-xs text-slate-400 italic">Aucun desk renseigné</p>';

            // Distribution des durées de contrat (tranches identiques à Hercules)
            const distribution = {
                '0-6 mois': durations.filter(d => d <= 6).length,
                '7-12 mois': durations.filter(d => d > 6 && d <= 12).length,
                '13-18 mois': durations.filter(d => d > 12 && d <= 18).length,
                '19-24 mois': durations.filter(d => d > 18 && d <= 24).length,
                '25+ mois': durations.filter(d => d > 24).length,
            };
            document.getElementById('statDurationDistribution').innerHTML = Object.entries(distribution)
                .map(([range, count]) => `
                    <div class="flex justify-between"><span class="text-slate-400">${range}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('');
        }

        // Exposé sur MissionsPage pour appel depuis les autres fichiers de la page
        MissionsPage.updateDetailedContractStats = updateDetailedContractStats;

        // ============================================================================
        // 4. RENDU DE LA LISTE DES POSTES
        // ============================================================================
        function renderMissions() {
            missionsGrid.innerHTML = '';
            const paginationEl = document.getElementById('missionsPagination');

            if (MissionsPage.currentMissions.length === 0) {
                missionsEmpty.classList.remove('hidden');
                paginationEl.innerHTML = '';
                return;
            }
            missionsEmpty.classList.add('hidden');

            // Pagination côté AFFICHAGE uniquement (le pool entier reste chargé en
            // mémoire pour les statistiques et la rotation automatique des contrats,
            // qui ont besoin de l'ensemble des postes du pool) — évite simplement de
            // construire des centaines de cartes DOM d'un coup sur un gros pool.
            const totalPages = Math.max(1, Math.ceil(MissionsPage.currentMissions.length / MissionsPage.MISSIONS_PAGE_SIZE));
            if (MissionsPage.currentPage > totalPages) MissionsPage.currentPage = totalPages;
            const start = (MissionsPage.currentPage - 1) * MissionsPage.MISSIONS_PAGE_SIZE;
            const pageMissions = MissionsPage.currentMissions.slice(start, start + MissionsPage.MISSIONS_PAGE_SIZE);

            const canEdit = MissionsPage.currentUserRole === 'admin' || MissionsPage.currentUserRole === 'user';

            // Les cartes sont construites dans un DocumentFragment (hors DOM, aucun
            // reflow) puis ajoutées à missionsGrid en un seul appendChild final, plutôt
            // qu'un appendChild par carte (jusqu'à MissionsPage.MISSIONS_PAGE_SIZE
            // reflows par rendu).
            // Comportement identique : mêmes cartes, même contenu, même ordre.
            const fragment = document.createDocumentFragment();

            pageMissions.forEach(mission => {
                const statusLabel = STATUS_LABELS[mission.status] || mission.status || '—';
                const occupantName = mission.occupant_id ? (MissionsPage.talentNameById[mission.occupant_id] || 'Talent introuvable') : null;
                const futureName = mission.future_talent_id ? (MissionsPage.talentNameById[mission.future_talent_id] || 'Talent introuvable') : null;

                // Contrat expiré mais statut non confirmé "Se termine" — traité par
                // processExpiredMissions() uniquement si contract_status === 'ending'.
                // Dans tous les autres cas, simple signalement visuel, aucune écriture.
                const isExpiredUnconfirmed = mission.status === 'occupied'
                    && mission.contract_end_date
                    && new Date(mission.contract_end_date).getTime() < Date.now()
                    && mission.contract_status !== 'ending';

                const card = document.createElement('div');
                card.className = "bg-white border rounded-2xl shadow-sm p-5 flex flex-col justify-between "
                    + (isExpiredUnconfirmed ? "border-red-300 ring-1 ring-red-200" : "border-slate-200");

                card.innerHTML = `
                    <div>
                        <div class="flex items-start justify-between gap-2 mb-2">
                            <h3 class="text-sm font-extrabold text-slate-800">${escapeHtml(mission.title)}</h3>
                            <span class="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-slate-100 text-slate-600 shrink-0">${escapeHtml(statusLabel)}</span>
                        </div>
                        ${isExpiredUnconfirmed ? `<p class="text-[11px] font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1 mb-2">🔴 Contrat expiré le ${escapeHtml(formatDate(mission.contract_end_date))} — statut à mettre à jour d'urgence</p>` : ''}
                        <p class="text-xs text-slate-400 font-semibold">${escapeHtml(mission.location)}, ${escapeHtml(mission.country)}</p>
                        ${mission.project_name ? `<p class="text-xs text-slate-400 mt-0.5">${escapeHtml(mission.project_name)}</p>` : ''}
                        <div class="flex flex-wrap gap-1.5 mt-3">
                            ${mission.pool_level ? `<span class="text-[10px] font-bold px-2 py-1 rounded-full bg-blue-50 text-primary">${escapeHtml(MissionsPage.POOL_LEVEL_LABELS[mission.pool_level] || mission.pool_level)}</span>` : ''}
                            ${mission.desk ? `<span class="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600">${escapeHtml(DESK_LABELS[mission.desk] || mission.desk)}</span>` : ''}
                            ${mission.candidate_type ? `<span class="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600">${escapeHtml(CANDIDATE_TYPE_LABELS[mission.candidate_type] || mission.candidate_type)}</span>` : ''}
                        </div>
                        <div class="mt-3 text-xs text-slate-500 space-y-1">
                            ${occupantName ? `<p>👤 Occupant : <span class="font-semibold text-slate-700">${escapeHtml(occupantName)}</span></p>` : ''}
                            ${(mission.status === 'occupied' && mission.contract_end_date) ? `<p>📅 Fin de contrat : <span class="font-semibold text-slate-700">${escapeHtml(formatDate(mission.contract_end_date))}</span></p>` : ''}
                            ${futureName ? `<p>🔄 Futur occupant : <span class="font-semibold text-slate-700">${escapeHtml(futureName)}</span></p>` : ''}
                        </div>
                    </div>
                    ${canEdit ? `
                    <div class="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                        <button type="button" class="editMissionBtn flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold transition-all" data-id="${escapeHtml(mission.id)}">✏️ Modifier</button>
                        <button type="button" class="deleteMissionBtn bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-lg text-xs font-bold transition-all" data-id="${escapeHtml(mission.id)}">🗑️</button>
                    </div>` : ''}
                    ${mission.status === 'occupied' && mission.occupant_id ? `
                    <div class="mt-2">
                        <button type="button" class="evaluationsBtn w-full bg-primary-light hover:bg-blue-100 text-primary px-3 py-2 rounded-lg text-xs font-bold transition-all" data-id="${escapeHtml(mission.id)}">💬 Évaluations de l'occupant</button>
                    </div>
                    ${canEdit ? `
                    <div class="mt-2">
                        <button type="button" class="resyncOccupantBtn w-full border border-slate-200 hover:bg-slate-50 text-slate-500 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all" data-id="${escapeHtml(mission.id)}">🔄 Resynchroniser le compteur du talent</button>
                    </div>` : ''}` : ''}
                `;

                fragment.appendChild(card);
            });

            missionsGrid.appendChild(fragment);

            paginationEl.innerHTML = renderPaginationControls(MissionsPage.currentPage, totalPages, MissionsPage.currentMissions.length);
            paginationEl.querySelector('[data-page-nav="prev"]')
                ?.addEventListener('click', () => goToMissionsPage(MissionsPage.currentPage - 1));
            paginationEl.querySelector('[data-page-nav="next"]')
                ?.addEventListener('click', () => goToMissionsPage(MissionsPage.currentPage + 1));
            // Les 4 boucles de ré-attachement (.editMissionBtn/.deleteMissionBtn/
            // .evaluationsBtn/.resyncOccupantBtn) sont remplacées par l'écouteur
            // délégué unique posé une seule fois sur missionsGrid, voir sa
            // déclaration plus haut.
        }

        // Pour les postes déjà occupés avant l'introduction de la synchronisation
        // automatique — remet à zéro le compteur de l'occupant actuel sans avoir
        // besoin de changer d'occupant pour déclencher la sync.
        async function resyncOccupant(missionId) {
            const mission = MissionsPage.currentMissions.find(m => m.id === missionId);
            if (!mission || !mission.occupant_id) return;

            try {
                await MissionsPage.markIncomingOccupant(mission.occupant_id);
                toastMessage('Compteur du talent resynchronisé.', 'success');
            } catch (error) {
                console.error("Erreur de resynchronisation :", error);
                toastMessage("Échec de la resynchronisation : " + (error && error.message ? error.message : 'erreur inconnue.'), 'error');
            }
        }

        function goToMissionsPage(page) {
            if (page < 1) return;
            MissionsPage.currentPage = page;
            renderMissions();
        }

        function formatDate(isoDate) {
            if (!isoDate) return '';
            const d = new Date(isoDate);
            if (isNaN(d.getTime())) return isoDate;
            return d.toLocaleDateString('fr-FR');
        }

        // Exposé sur MissionsPage pour appel depuis les autres fichiers de la page
        MissionsPage.renderMissions = renderMissions;
        MissionsPage.resyncOccupant = resyncOccupant;
        MissionsPage.formatDate = formatDate;
})();
