// Statistiques et graphiques "simples" (KPIs, statut/expat, diversité, contrats
// détaillés par pool) — tout ce qui est calculé et rendu 100% côté client, sans
// appel réseau IA. Voir statistics.js (chargé AVANT ce fichier) pour
// l'explication de StatisticsPage.
(() => {
        // calculateMonthsWithoutMission() a été retirée d'ici : elle vient désormais
        // de shared/caphuma-utils.js (chargé ligne 23), qui est l'unique source pour
        // les 3 pages concernées. Comportement strictement identique — cette page
        // utilisait déjà la méthode calendaire.

        function updateStatistics() {
            const selectorValue = document.getElementById('pool-selector').value;
            
            let talents = [...StatisticsPage.rawTalents];
            let mData = [...StatisticsPage.rawMissions];

            // Application des colonnes réelles (pool pour talents, pool_id pour missions)
            if (selectorValue !== 'global') {
                talents = talents.filter(t => (t.pool || "").toUpperCase() === selectorValue.toUpperCase());
                mData = mData.filter(m => {
                    const mPool = (m.pool_id || m.poolId || m.pool || "").toUpperCase();
                    return mPool === selectorValue.toUpperCase();
                });
            }

            // Calculs KPIs
            const totalPositions = mData.length;
            const occupiedPositions = mData.filter(m => m.status === 'occupied').length;
            const vacantPositions = mData.filter(m => m.status === 'vacant').length;
            const recruitingPositions = mData.filter(m => m.status === 'recruiting').length;

            const occupancyRate = totalPositions > 0 ? Math.round((occupiedPositions / totalPositions) * 100) : 0;
            const activeTalents = talents.filter(t => t.isValid !== false && t.is_valid !== false).length;
            
            const availableTalents = talents.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                const isRed = t.isRedListed || t.is_red_listed;
                return isVal && !isRed && t.status === 'En attente de poste';
            }).length;

            const talentsAtRisk = talents.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                return isVal && calculateMonthsWithoutMission(t) >= DEVALIDATION_AT_RISK_MONTHS;
            }).length;

            // Remplissage DOM
            document.getElementById('kpi-occupancy-rate').textContent = `${occupancyRate}%`;
            document.getElementById('kpi-occupancy-sub').textContent = `${occupiedPositions} de ${totalPositions} postes occupés`;
            document.getElementById('kpi-vacancies').textContent = vacantPositions;
            document.getElementById('kpi-vacancies-sub').textContent = `Recrutements en cours : ${recruitingPositions}`;
            document.getElementById('kpi-talents-active').textContent = activeTalents;
            document.getElementById('kpi-talents-sub').textContent = `Disponibles : ${availableTalents}`;
            document.getElementById('kpi-talents-risk').textContent = talentsAtRisk;

            // Rendu graphiques
            renderStatusChart([occupiedPositions, recruitingPositions, vacantPositions]);

            // La colonne candidate_type n'est pas garantie présente dans le schéma
            // réel de `missions`. On distingue donc "colonne absente" (aucun poste
            // n'a la clé, quelle que soit sa casse) de "colonne présente mais vide",
            // pour ne jamais afficher un graphique silencieusement faux (100% "Non
            // défini" sans avertissement).
            const hasCandidateTypeColumn = mData.some(m => 'candidate_type' in m || 'candidateType' in m);

            if (!hasCandidateTypeColumn) {
                document.getElementById('expatChart').classList.add('hidden');
                document.getElementById('expatChartEmptyState').classList.remove('hidden');
                if (StatisticsPage.expatChartInstance) {
                    StatisticsPage.expatChartInstance.destroy();
                    StatisticsPage.expatChartInstance = null;
                }
            } else {
                document.getElementById('expatChart').classList.remove('hidden');
                document.getElementById('expatChartEmptyState').classList.add('hidden');
                const expatCount = mData.filter(m => (m.candidate_type || m.candidateType) === 'expat').length;
                const nationalCount = mData.filter(m => (m.candidate_type || m.candidateType) === 'nat').length;
                const unclassifiedCount = totalPositions - (expatCount + nationalCount);
                renderExpatChart([expatCount, nationalCount, unclassifiedCount]);
            }

            // Graphiques de diversité (genre / nationalité) — cf. section 3.4 de la
            // présentation générale. Calculés sur les "talents actifs" (valides, non
            // Liste Rouge) uniquement, comme buildPoolAnalysisStats() plus bas, pour que
            // le graphique et le texte de l'analyse IA du même pool racontent toujours la
            // même chose. `talents` est déjà filtré par pool/global en tête de fonction.
            const activeTalentsForDiversity = talents.filter(t => {
                const isVal = t.isValid !== false && t.is_valid !== false;
                const isRed = t.isRedListed || t.is_red_listed;
                return isVal && !isRed;
            });
            updateDiversityCharts(activeTalentsForDiversity);

            updateDetailedContractStats(selectorValue, mData);
            // updatePoolAiAnalysisVisibility() vit dans statistics-pool-ai.js — appel
            // via StatisticsPage, chargé après ce fichier (voir ordre dans le HTML).
            StatisticsPage.updatePoolAiAnalysisVisibility(selectorValue, talents, mData);
        }

        // ============================================================================
        // STATISTIQUES DÉTAILLÉES DES CONTRATS PAR POOL (cf. Hercules
        // positions/stats.ts : getDetailedPositionStats). N'apparaît jamais sur la vue
        // globale — seulement quand un pool précis est sélectionné, pour ne pas toucher
        // au Hub Statistique global (décision explicite de l'utilisateur).
        // Placée ici plutôt qu'avec le bloc "analyse IA par pool" d'origine :
        // fonction purement client-side, sans appel réseau ni lien avec
        // buildPoolAnalysisStats() — seule sa position textuelle dans l'ancien fichier
        // monolithique la faisait voisiner avec l'IA, pas sa responsabilité réelle.
        // Voir statistics-pool-ai.js pour la vraie chaîne d'analyse par IA.
        // ============================================================================
        function updateDetailedContractStats(selectorValue, mData) {
            const card = document.getElementById('detailed-stats-card');

            if (selectorValue === 'global' || mData.length === 0) {
                card.classList.add('hidden');
                return;
            }
            card.classList.remove('hidden');

            const poolInfo = StatisticsPage.poolList.find(p => (p.pool_id || p.poolId || "").toUpperCase() === selectorValue.toUpperCase());
            document.getElementById('detailed-stats-pool-name').textContent = poolInfo ? (poolInfo.full_name || poolInfo.name) : selectorValue;

            const now = Date.now();
            const oneMonthLater = now + 30 * 24 * 60 * 60 * 1000;
            const threeMonthsLater = now + 3 * 30 * 24 * 60 * 60 * 1000;
            const sixMonthsLater = now + 6 * 30 * 24 * 60 * 60 * 1000;

            const withContracts = mData.filter(m => m.contract_start_date && m.contract_end_date);
            const durations = withContracts.map(m => {
                const start = new Date(m.contract_start_date).getTime();
                const end = new Date(m.contract_end_date).getTime();
                return Math.round((end - start) / (1000 * 60 * 60 * 24 * 30));
            });
            const avgDuration = durations.length > 0
                ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
                : 0;

            const ongoing = mData.filter(m => m.contract_status === 'ongoing').length;
            const renewable = mData.filter(m => m.contract_status === 'renewable').length;
            const renewalRate = withContracts.length > 0
                ? Math.round((renewable / withContracts.length) * 100)
                : 0;

            // Échéances cumulatives (identique à la logique de missions.html/Hercules :
            // "fin dans 3 mois" inclut ce qui finit dans le mois qui vient).
            const endsWithin = (maxDate) => mData.filter(m => {
                if (!m.contract_end_date) return false;
                const t = new Date(m.contract_end_date).getTime();
                return t > now && t <= maxDate;
            }).length;

            document.getElementById('stat-with-contracts').textContent = withContracts.length;
            document.getElementById('stat-avg-duration').textContent = avgDuration + ' mois';
            document.getElementById('stat-ongoing').textContent = ongoing;
            document.getElementById('stat-renewable').textContent = renewable;
            document.getElementById('stat-renewal-rate').textContent = renewalRate + '%';
            document.getElementById('stat-ending-1m').textContent = endsWithin(oneMonthLater);
            document.getElementById('stat-ending-3m').textContent = endsWithin(threeMonthsLater);
            document.getElementById('stat-ending-6m').textContent = endsWithin(sixMonthsLater);

            // Répartition par pays
            const byCountry = {};
            mData.forEach(m => {
                const c = m.country || 'Non précisé';
                byCountry[c] = (byCountry[c] || 0) + 1;
            });
            document.getElementById('stat-by-country').innerHTML = Object.entries(byCountry)
                .sort((a, b) => b[1] - a[1])
                .map(([country, count]) => `
                    <div class="flex justify-between"><span class="text-slate-500">${escapeHtml(country)}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('');

            // Répartition par desk (ajouté par rapport à Hercules — donnée déjà tracée
            // dans Cap Huma, jugée utile en complément du pays)
            const DESK_LABELS_LOCAL = { desk1: 'Desk 1', desk2: 'Desk 2', desk3: 'Desk 3', suo: 'SUO' };
            const byDesk = {};
            mData.forEach(m => {
                if (!m.desk) return;
                const label = DESK_LABELS_LOCAL[m.desk] || m.desk;
                byDesk[label] = (byDesk[label] || 0) + 1;
            });
            const deskEntries = Object.entries(byDesk);
            document.getElementById('stat-by-desk').innerHTML = deskEntries.length > 0
                ? deskEntries.sort((a, b) => b[1] - a[1]).map(([label, count]) => `
                    <div class="flex justify-between"><span class="text-slate-500">${escapeHtml(label)}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('')
                : '<p class="text-xs text-slate-500 italic">Aucun desk renseigné</p>';

            // Distribution des durées de contrat (tranches identiques à Hercules)
            const distribution = {
                '0-6 mois': durations.filter(d => d <= 6).length,
                '7-12 mois': durations.filter(d => d > 6 && d <= 12).length,
                '13-18 mois': durations.filter(d => d > 12 && d <= 18).length,
                '19-24 mois': durations.filter(d => d > 18 && d <= 24).length,
                '25+ mois': durations.filter(d => d > 24).length,
            };
            document.getElementById('stat-duration-distribution').innerHTML = Object.entries(distribution)
                .map(([range, count]) => `
                    <div class="flex justify-between"><span class="text-slate-500">${range}</span><span class="font-semibold text-slate-800">${count}</span></div>
                `).join('');
        }

        function renderStatusChart(dataValues) {
            if (StatisticsPage.statusChartInstance) StatisticsPage.statusChartInstance.destroy();
            const ctx = document.getElementById('statusChart').getContext('2d');
            StatisticsPage.statusChartInstance = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Occupé', 'En recrutement', 'Vacant'],
                    datasets: [{
                        data: dataValues,
                        backgroundColor: ['#10b981', '#ea580c', '#94a3b8'],
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        }

        function renderExpatChart(dataValues) {
            if (StatisticsPage.expatChartInstance) StatisticsPage.expatChartInstance.destroy();
            const ctx = document.getElementById('expatChart').getContext('2d');
            StatisticsPage.expatChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['Expatrié', 'Staff national', 'Non défini'],
                    datasets: [{
                        label: 'Postes',
                        data: dataValues,
                        backgroundColor: ['#1d4ed8', '#10b981', '#cbd5e1'],
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
                }
            });
        }

        // ============================================================================
        // GRAPHIQUES DE DIVERSITÉ (genre / nationalité) — comptages agrégés uniquement,
        // jamais une ligne "talent par talent" affichée : cohérent avec le choix déjà
        // fait pour l'analyse IA (buildPoolAnalysisStats, genderDistribution /
        // nationalityDistribution) et avec la décision utilisateur de ne jamais exposer
        // de donnée nominative sur cette page.
        // ============================================================================
        const NATIONALITY_CHART_TOP_N = 8;

        function updateDiversityCharts(activeTalents) {
            if (activeTalents.length === 0) {
                document.getElementById('genderChart').classList.add('hidden');
                document.getElementById('genderChartEmptyState').classList.remove('hidden');
                if (StatisticsPage.genderChartInstance) { StatisticsPage.genderChartInstance.destroy(); StatisticsPage.genderChartInstance = null; }

                document.getElementById('nationalityChart').classList.add('hidden');
                document.getElementById('nationalityChartEmptyState').classList.remove('hidden');
                if (StatisticsPage.nationalityChartInstance) { StatisticsPage.nationalityChartInstance.destroy(); StatisticsPage.nationalityChartInstance = null; }
                return;
            }

            document.getElementById('genderChart').classList.remove('hidden');
            document.getElementById('genderChartEmptyState').classList.add('hidden');
            document.getElementById('nationalityChart').classList.remove('hidden');
            document.getElementById('nationalityChartEmptyState').classList.add('hidden');

            // Genre — mêmes 3 catégories que buildPoolAnalysisStats (H / F / non renseigné),
            // 'gender' ne portant que ces valeurs dans le schéma réel (§4.2 du dossier de
            // passation technique).
            const genderDist = { hommes: 0, femmes: 0, nonRenseigne: 0 };
            activeTalents.forEach(t => {
                if (t.gender === 'H') genderDist.hommes++;
                else if (t.gender === 'F') genderDist.femmes++;
                else genderDist.nonRenseigne++;
            });
            renderGenderChart(genderDist);

            // Nationalité — pas de nombre de valeurs distinctes borné (texte libre en base),
            // donc jamais un camembert/une barre par nationalité sans limite : on garde les
            // NATIONALITY_CHART_TOP_N plus représentées et on regroupe le reste sous "Autres",
            // plus un bucket "Non renseigné" séparé et explicite (jamais fondu silencieusement
            // dans une autre catégorie).
            const counts = {};
            let nonRenseigne = 0;
            activeTalents.forEach(t => {
                if (!t.nationality) { nonRenseigne++; return; }
                counts[t.nationality] = (counts[t.nationality] || 0) + 1;
            });
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            const top = sorted.slice(0, NATIONALITY_CHART_TOP_N);
            const othersTotal = sorted.slice(NATIONALITY_CHART_TOP_N).reduce((sum, [, c]) => sum + c, 0);
            renderNationalityChart(top, othersTotal, nonRenseigne);

            const subEl = document.getElementById('nationalityChartSub');
            subEl.textContent = sorted.length > NATIONALITY_CHART_TOP_N
                ? `Top ${NATIONALITY_CHART_TOP_N} nationalités du pool (${sorted.length - NATIONALITY_CHART_TOP_N} autres regroupées sous « Autres »)`
                : 'Nationalités du pool';
        }

        function renderGenderChart(dist) {
            if (StatisticsPage.genderChartInstance) StatisticsPage.genderChartInstance.destroy();
            const ctx = document.getElementById('genderChart').getContext('2d');
            StatisticsPage.genderChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Femmes', 'Hommes', 'Non renseigné'],
                    datasets: [{
                        data: [dist.femmes, dist.hommes, dist.nonRenseigne],
                        backgroundColor: ['#ea580c', '#1d4ed8', '#cbd5e1'],
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        }

        function renderNationalityChart(topEntries, othersTotal, nonRenseigne) {
            if (StatisticsPage.nationalityChartInstance) StatisticsPage.nationalityChartInstance.destroy();
            const ctx = document.getElementById('nationalityChart').getContext('2d');

            const labels = topEntries.map(([nat]) => nat);
            const values = topEntries.map(([, count]) => count);
            if (othersTotal > 0) { labels.push('Autres'); values.push(othersTotal); }
            if (nonRenseigne > 0) { labels.push('Non renseigné'); values.push(nonRenseigne); }

            StatisticsPage.nationalityChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    // Pas d'escapeHtml() ici : Chart.js dessine le texte directement sur un
                    // <canvas> (pas d'innerHTML), donc aucun risque XSS — et escapeHtml()
                    // afficherait à tort des entités littérales (ex. "Côte d&#039;Ivoire").
                    labels: labels,
                    datasets: [{
                        label: 'Talents',
                        data: values,
                        backgroundColor: labels.map(l => (l === 'Autres' || l === 'Non renseigné') ? '#cbd5e1' : '#1d4ed8'),
                        borderRadius: 6
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
                }
            });
        }


        // Exposé sur StatisticsPage pour appel depuis statistics.js
        StatisticsPage.updateStatistics = updateStatistics;
})();
