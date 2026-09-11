// Rendu de la liste des postes, barre de KPIs, statistiques détaillées des
// contrats. Voir missions.js (chargé AVANT ce fichier) pour l'explication de
// MissionsPage, l'objet d'état partagé entre les 4 fichiers de cette page.
(() => {
        // DOM propres à ce fichier : pas besoin de les faire transiter par
        // MissionsPage, contrairement à l'état métier mutable.
        const missionsGrid = document.getElementById('missionsGrid');
        const missionsEmpty = document.getElementById('missionsEmpty');
        const kpiBar = document.getElementById('kpiBar');

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

        // Calculées côté client à partir des postes déjà chargés
        // (MissionsPage.currentMissions) — pas de requête Supabase supplémentaire.
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

            // Cumulatif : "fin dans 3 mois" inclut ce qui finit dans le mois qui
            // vient, ce n'est pas une tranche exclusive 1-3 mois.
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
                    <div class="flex justify-between"><span class="text-slate-500">${escapeHtml(country)}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('');

            const byDesk = {};
            MissionsPage.currentMissions.forEach(m => {
                if (!m.desk) return;
                const label = DESK_LABELS[m.desk] || m.desk;
                byDesk[label] = (byDesk[label] || 0) + 1;
            });
            const deskEntries = Object.entries(byDesk);
            document.getElementById('statByDesk').innerHTML = deskEntries.length > 0
                ? deskEntries.sort((a, b) => b[1] - a[1]).map(([label, count]) => `
                    <div class="flex justify-between"><span class="text-slate-500">${escapeHtml(label)}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('')
                : '<p class="text-xs text-slate-500 italic">Aucun desk renseigné</p>';

            const distribution = {
                '0-6 mois': durations.filter(d => d <= 6).length,
                '7-12 mois': durations.filter(d => d > 6 && d <= 12).length,
                '13-18 mois': durations.filter(d => d > 12 && d <= 18).length,
                '19-24 mois': durations.filter(d => d > 18 && d <= 24).length,
                '25+ mois': durations.filter(d => d > 24).length,
            };
            document.getElementById('statDurationDistribution').innerHTML = Object.entries(distribution)
                .map(([range, count]) => `
                    <div class="flex justify-between"><span class="text-slate-500">${range}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('');
        }

        // Exposé sur MissionsPage pour appel depuis les autres fichiers de la page
        MissionsPage.updateDetailedContractStats = updateDetailedContractStats;

        function renderMissions() {
            missionsGrid.innerHTML = '';
            const paginationEl = document.getElementById('missionsPagination');

            if (MissionsPage.currentMissions.length === 0) {
                missionsEmpty.classList.remove('hidden');
                paginationEl.innerHTML = '';
                return;
            }
            missionsEmpty.classList.add('hidden');

            // Pagination côté affichage uniquement : le pool entier reste chargé en
            // mémoire (statistiques et rotation automatique des contrats en ont besoin),
            // ceci évite seulement de construire des centaines de cartes DOM d'un coup.
            const totalPages = Math.max(1, Math.ceil(MissionsPage.currentMissions.length / MissionsPage.MISSIONS_PAGE_SIZE));
            if (MissionsPage.currentPage > totalPages) MissionsPage.currentPage = totalPages;
            const start = (MissionsPage.currentPage - 1) * MissionsPage.MISSIONS_PAGE_SIZE;
            const pageMissions = MissionsPage.currentMissions.slice(start, start + MissionsPage.MISSIONS_PAGE_SIZE);

            const canEdit = MissionsPage.currentUserRole === 'admin' || MissionsPage.currentUserRole === 'user';

            // DocumentFragment (hors DOM) puis un seul appendChild final, plutôt
            // qu'un appendChild par carte.
            const fragment = document.createDocumentFragment();

            pageMissions.forEach(mission => {
                const statusLabel = STATUS_LABELS[mission.status] || mission.status || '—';
                const occupantName = mission.occupant_id ? (MissionsPage.talentNameById[mission.occupant_id] || 'Talent introuvable') : null;
                const futureName = mission.future_talent_id ? (MissionsPage.talentNameById[mission.future_talent_id] || 'Talent introuvable') : null;

                // Signalement visuel uniquement : processExpiredMissions() n'écrit
                // réellement que si contract_status === 'ending'.
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
                        <p class="text-xs text-slate-500 font-semibold">${escapeHtml(mission.location)}, ${escapeHtml(mission.country)}</p>
                        ${mission.project_name ? `<p class="text-xs text-slate-500 mt-0.5">${escapeHtml(mission.project_name)}</p>` : ''}
                        <div class="flex flex-wrap gap-1.5 mt-3">
                            ${mission.pool_level ? `<span class="text-[10px] font-bold px-2 py-1 rounded-full bg-blue-50 text-primary">${escapeHtml(MissionsPage.POOL_LEVEL_LABELS[mission.pool_level] || mission.pool_level)}</span>` : ''}
                            ${mission.desk ? `<span class="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600">${escapeHtml(DESK_LABELS[mission.desk] || mission.desk)}</span>` : ''}
                            ${mission.candidate_type ? `<span class="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600">${escapeHtml(CANDIDATE_TYPE_LABELS[mission.candidate_type] || mission.candidate_type)}</span>` : ''}
                        </div>
                        <div class="mt-3 text-xs text-slate-500 space-y-1">
                            ${occupantName ? `<p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"/></svg> Occupant : <span class="font-semibold text-slate-700">${escapeHtml(occupantName)}</span></p>` : ''}
                            ${(mission.status === 'occupied' && mission.contract_end_date) ? `<p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z"/></svg> Fin de contrat : <span class="font-semibold text-slate-700">${escapeHtml(formatDate(mission.contract_end_date))}</span></p>` : ''}
                            ${futureName ? `<p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg> Futur occupant : <span class="font-semibold text-slate-700">${escapeHtml(futureName)}</span></p>` : ''}
                        </div>
                    </div>
                    ${canEdit ? `
                    <div class="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                        <button type="button" class="editMissionBtn flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold transition-all" data-id="${escapeHtml(mission.id)}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"/></svg> Modifier</button>
                        <button type="button" class="deleteMissionBtn bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-lg text-xs font-bold transition-all" data-id="${escapeHtml(mission.id)}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg></button>
                    </div>` : ''}
                    ${mission.status === 'occupied' && mission.occupant_id ? `
                    <div class="mt-2">
                        <button type="button" class="evaluationsBtn w-full bg-primary-light hover:bg-blue-100 text-primary px-3 py-2 rounded-lg text-xs font-bold transition-all" data-id="${escapeHtml(mission.id)}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"/></svg> Évaluations de l'occupant</button>
                    </div>
                    ${canEdit ? `
                    <div class="mt-2">
                        <button type="button" class="resyncOccupantBtn w-full border border-slate-200 hover:bg-slate-50 text-slate-500 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all" data-id="${escapeHtml(mission.id)}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg> Resynchroniser le compteur du talent</button>
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
            // .editMissionBtn/.deleteMissionBtn/.evaluationsBtn/.resyncOccupantBtn ne
            // sont pas rebranchés ici : un seul écouteur délégué sur missionsGrid s'en charge.
        }

        // Remet à zéro le compteur de l'occupant actuel sans avoir besoin de
        // changer d'occupant pour déclencher la synchronisation automatique.
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
