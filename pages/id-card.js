const IdCardPage = {};

(() => {
        renderPageLayout({
            icon: CapHumaIcons.get('compass', 'w-5 h-5'),
            title: 'Fiche talent',
            titleTag: 'span',
            backButton: true,
            variant: 'scroll-page',
            stickyZ: 40,
            extraHeaderClass: 'shrink-0 no-print',
            logoutBtnExtraClass: 'no-print'
        });

        const appBody = document.getElementById('appBody');
        IdCardPage.supabaseClient = capHumaGetSupabaseClient();
        IdCardPage.talentId = null;
        let talent = null;
        let activeMission = null;
        let activeDetachment = null;
        IdCardPage.currentUserId = null;
        let currentUserEmail = null;
        IdCardPage.currentUserRole = null;
        let currentUserName = null;
        IdCardPage.comments = [];

        const logAuditAction = capHumaMakeAuditLogger(
            () => IdCardPage.supabaseClient,
            () => ({
                userId: IdCardPage.currentUserId,
                userEmail: currentUserEmail,
                userName: typeof currentUserName !== 'undefined' ? currentUserName : null
            })
        );

        // Deux formats coexistent dans archived_position_passages : ancien (camelCase, epoch ms) et nouveau (snake_case, ISO).
        function passageDateMs(value) {
            if (value === null || value === undefined || value === '') return null;
            if (typeof value === 'number') return value;
            const parsed = new Date(value).getTime();
            return isNaN(parsed) ? null : parsed;
        }

        function mostRecentByContractStart(missions) {
            if (missions.length === 0) return null;
            return missions.reduce((latest, m) => {
                const mStart = m.contract_start_date ? new Date(m.contract_start_date).getTime() : -Infinity;
                const latestStart = latest.contract_start_date ? new Date(latest.contract_start_date).getTime() : -Infinity;
                return mStart > latestStart ? m : latest;
            });
        }

        function normalizePassageComment(c) {
            return {
                context: c.context || null,
                positivePoints: c.positive_points || c.positivePoints || null,
                negativePoints: c.negative_points || c.negativePoints || null,
                rating: (c.rating !== undefined && c.rating !== null) ? c.rating : null,
                authorLabel: c.author_email || c.createdByName || null,
                legacyContent: (!c.context && c.content) ? c.content : null
            };
        }

        async function checkSession() {
            try {
                let s;
                try {
                    s = await capHumaInitSession(IdCardPage.supabaseClient);
                } catch (sessionErr) {
                    window.location.replace('login.html');
                    return;
                }

                document.getElementById('user-display-name').textContent = s.email;
                IdCardPage.currentUserId = s.userId;
                currentUserEmail = s.email;
                IdCardPage.currentUserRole = s.role;
                currentUserName = s.name;

                capHumaStartIdleTimeout(IdCardPage.supabaseClient);
                appBody.style.display = '';

                document.getElementById('back-btn').onclick = () => {
                    window.location.href = 'dashboard.html';
                };

                const urlParams = new URLSearchParams(window.location.search);
                IdCardPage.talentId = urlParams.get('id');
                if (!IdCardPage.talentId || IdCardPage.talentId === 'undefined' || IdCardPage.talentId === 'null') {
                    showError("ID du talent invalide ou non fourni dans l'URL.");
                    setTimeout(() => window.location.replace('dashboard.html'), 3000);
                    return;
                }

                await loadTalentData();
            } catch (e) {
                console.error(e);
                showError("Erreur d'authentification ou problème réseau.");
            }
        }

        async function loadTalentData() {
            try {
                const [talentResult, missionResult] = await Promise.all([
                    (async () => {
                        const { data: t, error: et } = await capHumaWithRetry(() =>
                            IdCardPage.supabaseClient
                                .from('talents')
                                .select('*')
                                .eq('id', IdCardPage.talentId)
                                .maybeSingle()
                        );

                        if (et) {
                            console.error("Échec Supabase :", et);
                            throw et;
                        }

                        if (!t) {
                            throw new Error("Le professionnel demandé n'existe pas dans la base de données.");
                        }
                        return t;
                    })(),
                    capHumaWithRetry(() =>
                        IdCardPage.supabaseClient
                            .from('missions')
                            .select('*')
                            .eq('occupant_id', IdCardPage.talentId)
                            .eq('status', 'occupied')
                    )
                ]);

                if (missionResult.error) {
                    console.error("Échec du chargement du poste occupé :", missionResult.error);
                    throw missionResult.error;
                }

                talent = talentResult;
                const occupiedMissions = missionResult.data || [];
                activeMission = mostRecentByContractStart(occupiedMissions.filter(m => m.candidate_type !== 'detache'));
                activeDetachment = mostRecentByContractStart(occupiedMissions.filter(m => m.candidate_type === 'detache'));

                renderTalentCard();
                await Promise.all([
                    IdCardPage.loadComments(),
                    loadPoolHistory()
                ]);
            } catch (err) {
                console.error("Erreur complète :", err);
                showError(err.message || "Erreur lors du chargement des données.");
            }
        }

        async function loadPoolHistory() {
            const container = document.getElementById('pool-history-container');
            try {
                const { data, error } = await capHumaWithRetry(() =>
                    IdCardPage.supabaseClient
                        .from('pool_history')
                        .select('from_pool, to_pool, changed_at, changed_by_name')
                        .eq('talent_id', IdCardPage.talentId)
                        .order('changed_at', { ascending: false })
                );

                if (error) throw error;
                renderPoolHistory(data || []);
            } catch (err) {
                console.error("Erreur de chargement de l'historique des pools :", err);
                container.innerHTML = '<p class="text-sm text-slate-500 italic">Historique indisponible pour le moment.</p>';
            }
        }

        function renderPoolHistory(entries) {
            const container = document.getElementById('pool-history-container');
            if (!entries || entries.length === 0) {
                container.innerHTML = '<p class="text-sm text-slate-500 italic">Aucun changement de pool enregistré pour le moment.</p>';
                return;
            }

            container.innerHTML = entries.map(e => {
                const dateStr = e.changed_at ? new Date(e.changed_at).toLocaleDateString('fr-FR') : '—';
                return `
                <div class="flex items-start gap-3 border-l-2 border-primary/30 pl-4">
                    <div class="flex-1">
                        <p class="text-sm text-slate-700">
                            <span class="font-semibold">${escapeHtml(e.from_pool || '—')}</span>
                            <span class="text-slate-500 mx-1">→</span>
                            <span class="font-semibold text-primary">${escapeHtml(e.to_pool)}</span>
                        </p>
                        <p class="text-xs text-slate-500 mt-0.5">
                            Le ${dateStr}${e.changed_by_name ? ` · par ${escapeHtml(e.changed_by_name)}` : ''}
                        </p>
                    </div>
                </div>`;
            }).join('');
        }

        function populateTalentIdentity() {
            const fName = talent.first_name || talent.firstName || "";
            const lName = talent.last_name || talent.lastName || "";
            const fFunction = talent.current_function || talent.currentFunction || "N/A";
            const expAlima = talent.experience_months_alima || talent.experienceMonthsAlima || 0;

            const effectivePool = talent.pool || talent.tracking_pool || null;
            const poolLabel = talent.pool ? talent.pool : (talent.tracking_pool ? `${talent.tracking_pool} (suivi)` : null);

            document.getElementById('back-btn-text').textContent = effectivePool ? `Retour au pool ${effectivePool}` : 'Retour';
            document.getElementById('back-btn').onclick = () => {
                window.location.href = effectivePool ? `talents.html?pool=${encodeURIComponent(effectivePool)}` : 'dashboard.html';
            };

            document.getElementById('talent-fullname').textContent = `${fName} ${lName}`.trim() || "N/A";
            document.getElementById('talent-function').textContent = fFunction;
            document.getElementById('talent-pool-display').textContent = `Pool : ${poolLabel || '—'}`;

            const expAlimaYears = Math.floor(expAlima / 12);
            const expAlimaRem = expAlima % 12;
            document.getElementById('talent-experience-alima').textContent = `${expAlimaYears}a ${expAlimaRem}m`;

            const statusBadge = document.getElementById('talent-status-badge');
            statusBadge.textContent = talent.status || "N/A";
            statusBadge.className = "bg-white/10 text-white text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider";
            if (talent.status === 'En poste ALIMA') {
                statusBadge.classList.add('bg-green-700');
            }

            if (talent.is_red_listed || talent.isRedListed) {
                document.getElementById('redlist-banner').classList.remove('hidden');
                document.getElementById('redlist-reason').textContent = `Motif : ${talent.red_list_reason || talent.redListReason || "Non spécifié"}`;
            } else {
                document.getElementById('redlist-banner').classList.add('hidden');
            }
        }

        function renderTalentValidityBar() {
            const v = capHumaGetValidityStatus(talent);

            const vCounter = document.getElementById('validity-counter');
            const vLabel = document.getElementById('validity-label');
            const vBar = document.getElementById('validity-bar');
            const vSub = document.getElementById('validity-subtext');

            vBar.style.width = `${v.progressPercent}%`;

            if (v.isInvalid) {
                vLabel.textContent = "Statut : Dévalidé du pool";
                vLabel.className = "text-red-600 font-bold";
                vCounter.textContent = `${DEVALIDATION_MAX_MONTHS} / ${DEVALIDATION_MAX_MONTHS} mois`;
                vBar.className = "h-full bg-red-600 rounded-full";
                vSub.textContent = "Ce professionnel est inactif et doit faire l'objet d'une réintégration manuelle.";
            } else if (v.isPaused) {
                vLabel.textContent = "Compteur suspendu (Actif)";
                vLabel.className = "text-blue-600 font-bold";
                vCounter.textContent = `${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois`;
                vBar.className = "h-full bg-blue-500 rounded-full opacity-60";
                vSub.textContent = "En cours de mission ALIMA — le compteur est gelé.";
            } else {
                vCounter.textContent = `${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois`;
                if (v.totalMonths >= DEVALIDATION_CRITICAL_MONTHS) {
                    vLabel.textContent = "Validité pool : Critique (Action urgente)";
                    vLabel.className = "text-red-700 font-bold";
                    vBar.className = "h-full bg-red-500 rounded-full";
                } else if (v.totalMonths >= DEVALIDATION_AT_RISK_MONTHS) {
                    vLabel.textContent = "Validité pool : À risque";
                    vLabel.className = "text-orange-700 font-bold";
                    vBar.className = "h-full bg-orange-400 rounded-full";
                } else {
                    vLabel.textContent = "Validité pool : Stable";
                    vLabel.className = "text-green-700 font-bold";
                    vBar.className = "h-full bg-green-500 rounded-full";
                }
                vSub.textContent = `Date de référence du calcul : ${v.refDate ? new Date(v.refDate).toLocaleDateString('fr-FR') : 'N/A'}`;
            }

            return v.isInvalid;
        }

        function populateTalentInfoFields() {
            const eduLvl = talent.education_level || talent.educationLevel || "none";
            const eduSpec = talent.education_specialty || talent.educationSpecialty || "N/A";
            const intDate = talent.pool_integration_date || talent.poolIntegrationDate;
            const nbMissions = talent.number_of_alima_missions || talent.numberOfAlimaMissions || "none";
            const visaValid = talent.has_visa || talent.hasVisa;
            const cRes = talent.country_of_residence || talent.countryOfResidence || "N/A";
            const expHum = talent.experience_months_humanitarian || talent.experienceMonthsHumanitarian || 0;

            document.getElementById('info-email').textContent = talent.email || "N/A";
            document.getElementById('info-gender').textContent = talent.gender === "H" ? "Homme" : talent.gender === "F" ? "Femme" : "N/A";
            document.getElementById('info-nationality').textContent = CapHumaCountries.getNationality(talent.nationality_code) || "N/A";
            document.getElementById('info-residence').textContent = cRes;
            document.getElementById('info-visa').textContent = visaValid ? "Valide" : "Non valide / N/A";

            const langs = Array.isArray(talent.languages) ? talent.languages.join(", ") : (talent.languages || "N/A");
            document.getElementById('info-languages').textContent = langs;

            document.getElementById('info-edu-level').textContent = EDU_LEVEL_LABELS[eduLvl] || "N/A";
            document.getElementById('info-edu-specialty').textContent = eduSpec;
            document.getElementById('info-integration-date').textContent = intDate ? new Date(intDate).toLocaleDateString('fr-FR') : "N/A";

            document.getElementById('info-exp-humanitarian').textContent = `${Math.floor(expHum / 12)}a ${expHum % 12}m`;

            document.getElementById('info-alima-missions').textContent = MISSION_COUNT_LABELS[nbMissions] || "0";

            renderBadges('skills-badges-container', talent.key_skills || talent.keySkills, 'bg-blue-50 text-blue-700 border-blue-200');
            renderBadges('contexts-badges-container', talent.intervention_contexts || talent.interventionContexts, 'bg-orange-50 text-accent-dark border-orange-200');
            renderBadges('zones-badges-container', talent.intervention_zones || talent.interventionZones, 'bg-green-50 text-green-700 border-green-200');
        }

        function buildActiveMissionEntry(mission) {
            const startStr = mission.contract_start_date || mission.contractStartDate
                ? new Date(mission.contract_start_date || mission.contractStartDate).toLocaleDateString('fr-FR')
                : "En cours";

            const entry = document.createElement('div');
            entry.innerHTML = `
                <div class="relative pl-6 border-l-2 border-green-500">
                    <div class="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow"></div>
                    <div class="space-y-1">
                        <span class="inline-block text-[10px] uppercase font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded-full">En cours</span>
                        <h4 class="font-bold text-slate-900">${escapeHtml(mission.title)}</h4>
                        <p class="text-xs text-slate-500">${escapeHtml(CapHumaCountries.getCountryName(mission.country_code) || '')} • Prise de poste le ${startStr}</p>
                    </div>
                </div>
            `;
            return entry.firstElementChild;
        }

        function renderTalentTimeline() {
            const timeline = document.getElementById('timeline-container');
            let hasTimelineElements = false;

            const timelineFragment = document.createDocumentFragment();

            [activeMission, activeDetachment].filter(Boolean).forEach(mission => {
                hasTimelineElements = true;
                timelineFragment.appendChild(buildActiveMissionEntry(mission));
            });

            let passages = [];
            try {
                const rawPassages = talent.archived_position_passages || talent.archivedPositionPassages;
                if (Array.isArray(rawPassages)) {
                    passages = rawPassages;
                } else if (typeof rawPassages === 'string' && rawPassages.trim()) {
                    passages = JSON.parse(rawPassages);
                }
            } catch (e) {
                console.error("Erreur de parsing des passages :", e);
            }

            if (passages.length > 0) {
                hasTimelineElements = true;
                const sortedPassages = [...passages].sort((a, b) => (passageDateMs(b.startDate) || 0) - (passageDateMs(a.startDate) || 0));
                sortedPassages.forEach(p => {
                    const startMs = passageDateMs(p.startDate);
                    const endMs = passageDateMs(p.endDate);
                    const durationMonths = (startMs !== null && endMs !== null)
                        ? Math.round((endMs - startMs) / (1000 * 60 * 60 * 24 * 30))
                        : null;
                    const startStr = startMs !== null ? new Date(startMs).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '?';
                    const endStr = endMs !== null ? new Date(endMs).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '?';

                    let evalHtml = "";
                    if (p.comments && p.comments.length > 0) {
                        p.comments.forEach(rawComment => {
                            const c = normalizePassageComment(rawComment);
                            evalHtml += `
                                <div class="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs space-y-1 mt-2">
                                    <div class="flex justify-between items-center text-[10px] text-slate-500">
                                        <span>${c.authorLabel ? 'Évalué par ' + escapeHtml(c.authorLabel) : 'Auteur inconnu'}</span>
                                        ${c.rating !== null ? `<span class="font-bold text-primary">★ ${escapeHtml(c.rating)}/10</span>` : ""}
                                    </div>
                                    ${c.context ? `<p class="italic text-slate-500">Contexte : ${escapeHtml(c.context)}</p>` : ""}
                                    ${c.positivePoints ? `<p class="text-green-700"><strong>Points forts :</strong> ${escapeHtml(c.positivePoints)}</p>` : ""}
                                    ${c.negativePoints ? `<p class="text-orange-700"><strong>Axes d'amélioration :</strong> ${escapeHtml(c.negativePoints)}</p>` : ""}
                                    ${c.legacyContent ? `<p class="text-slate-600">${escapeHtml(c.legacyContent)}</p>` : ""}
                                </div>
                            `;
                        });
                    }

                    const passageEntry = document.createElement('div');
                    passageEntry.innerHTML = `
                        <div class="relative pl-6 border-l-2 border-slate-200">
                            <div class="absolute -left-[6px] top-1 w-3 h-3 rounded-full bg-slate-300 border-2 border-white shadow"></div>
                            <div class="space-y-1">
                                <span class="text-xs font-semibold text-slate-500">${startStr} – ${endStr}${durationMonths !== null ? ` (${durationMonths} m)` : ''}</span>
                                <h4 class="font-bold text-slate-800">${escapeHtml(p.positionTitle)}</h4>
                                <p class="text-xs text-slate-500">${escapeHtml(CapHumaCountries.getPassageCountry(p) || "Mission ALIMA")}</p>
                                ${evalHtml}
                            </div>
                        </div>
                    `;
                    timelineFragment.appendChild(passageEntry.firstElementChild);
                });
            }

            if (hasTimelineElements) {
                timeline.innerHTML = '';
                timeline.appendChild(timelineFragment);
            } else {
                timeline.innerHTML = `<p class="text-sm text-slate-500 italic">Aucun parcours de mission ALIMA archivé.</p>`;
            }
        }

        function renderTalentCard() {
            populateTalentIdentity();
            const isNational = talent.staff_type === 'national';
            document.getElementById('validity-progress-container').classList.toggle('hidden', isNational);
            const isInvalid = isNational ? false : renderTalentValidityBar();
            populateTalentInfoFields();
            renderTalentTimeline();

            setupAdminActions(isInvalid, isNational);
            bindButtonListeners(); // après le rendu du profil : les éléments DOM doivent exister
        }

        function renderBadges(containerId, list, colorClass) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = "";

            let items = [];
            if (Array.isArray(list)) {
                items = list;
            } else if (typeof list === 'string' && list.trim()) {
                items = list.split(',').map(s => s.trim()).filter(Boolean);
            }

            if (items.length === 0) {
                container.innerHTML = `<span class="text-xs text-slate-500 italic">Non spécifié</span>`;
                return;
            }
            items.forEach(item => {
                const badge = document.createElement('span');
                badge.className = `text-xs px-2.5 py-1 rounded-lg border font-medium ${colorClass}`;
                badge.textContent = item;
                container.appendChild(badge);
            });
        }

        function setupAdminActions(isInvalid, isNational) {
            const btnManageMissions = document.getElementById('btn-manage-missions');
            const btnDevalidate = document.getElementById('btn-devalidate');
            const btnRevalidate = document.getElementById('btn-revalidate');
            const btnRedlist = document.getElementById('btn-redlist');
            const btnDeleteTalent = document.getElementById('btn-delete-talent');
            const btnPromote = document.getElementById('btn-promote-to-expat');

            btnManageMissions.href = 'missions.html?pool=' + encodeURIComponent(talent.pool || talent.tracking_pool || '');

            if (isNational) {
                btnDevalidate.classList.add('hidden');
                btnRevalidate.classList.add('hidden');
                document.getElementById('btn-change-pool').classList.add('hidden');
            } else {
                btnPromote.classList.add('hidden');
                if (isInvalid) {
                    btnDevalidate.classList.add('hidden');
                    btnRevalidate.classList.remove('hidden');
                } else {
                    btnRevalidate.classList.add('hidden');
                    btnDevalidate.classList.remove('hidden');
                }
            }

            if (IdCardPage.currentUserRole === 'visitor') {
                btnDevalidate.classList.add('hidden');
                btnRevalidate.classList.add('hidden');
                btnRedlist.classList.add('hidden');
                btnPromote.classList.add('hidden');
                document.getElementById('btn-change-pool').classList.add('hidden');
                document.getElementById('share-btn').classList.add('hidden');
            } else {
                btnRedlist.classList.remove('hidden');
                if (!isNational) document.getElementById('btn-change-pool').classList.remove('hidden');
                if (isNational) btnPromote.classList.remove('hidden');
                document.getElementById('share-btn').classList.remove('hidden');
            }

            if (IdCardPage.currentUserRole === 'admin' && !isInvalid) {
                btnDeleteTalent.classList.remove('hidden');
            } else {
                btnDeleteTalent.classList.add('hidden');
            }
        }

        function bindShareButton() {
            document.getElementById('share-btn').onclick = () => {
                IdCardPage.openShareLinksModal();
            };
        }

        function bindPdfButton() {
            bindPdfLangToggle();
            document.getElementById('pdf-btn').onclick = async () => {
                try {
                    const lang = capHumaGetExportLang();
                    await capHumaLoadScriptOnce('shared/vendor/jspdf-4.2.1.js');
                    await capHumaLoadScriptOnce('shared/vendor/jspdf-autotable-5.0.8.js');
                    IdCardPage.exportTalentCardPDF(talent, activeMission, activeDetachment, lang);
                    toastMessage(lang === 'en' ? "PDF document generated and downloaded." : "Document PDF généré et téléchargé.", "success");
                    const fullName = `${talent.first_name || ''} ${talent.last_name || ''}`.trim() || null;
                    await logAuditAction('export', 'talent', IdCardPage.talentId, fullName, `Export PDF de la fiche (${lang.toUpperCase()})`);
                } catch (err) {
                    console.error("Erreur génération PDF :", err);
                    toastMessage("Échec de la génération du PDF.", "error");
                }
            };
        }

        function bindPdfLangToggle() {
            const btnFr = document.getElementById('pdf-lang-fr');
            const btnEn = document.getElementById('pdf-lang-en');
            if (!btnFr || !btnEn) return;

            const activeClasses = ['bg-primary', 'text-white'];
            const inactiveClasses = ['bg-white', 'text-slate-600'];

            function applyState(lang) {
                const isFr = lang !== 'en';
                btnFr.classList.remove(...activeClasses, ...inactiveClasses);
                btnEn.classList.remove(...activeClasses, ...inactiveClasses);
                btnFr.classList.add(...(isFr ? activeClasses : inactiveClasses));
                btnEn.classList.add(...(isFr ? inactiveClasses : activeClasses));
                btnFr.setAttribute('aria-pressed', String(isFr));
                btnEn.setAttribute('aria-pressed', String(!isFr));
            }

            applyState(capHumaGetExportLang());

            [btnFr, btnEn].forEach(btn => {
                btn.addEventListener('click', () => {
                    capHumaSetExportLang(btn.dataset.lang);
                    applyState(btn.dataset.lang);
                });
            });
        }

        function bindPrintButton() {
            document.getElementById('print-btn').onclick = () => window.print();
        }

        function bindCommentButton() {
            let currentCommentDraftKey = null;

            function collectCommentDraft() {
                const val = document.getElementById('new-comment-input').value;
                if (!val || !val.trim()) return undefined;
                return { content: val };
            }

            function restoreCommentDraft(data) {
                if (data && typeof data.content === 'string') {
                    document.getElementById('new-comment-input').value = data.content;
                }
            }

            const btnAddComment = document.getElementById('btn-add-comment');
            const newCommentInput = document.getElementById('new-comment-input');
            if (btnAddComment && newCommentInput && IdCardPage.currentUserRole !== 'visitor') {
                currentCommentDraftKey = `draft:comment:${IdCardPage.talentId}`;
                capHumaOfferDraftRestore(currentCommentDraftKey, restoreCommentDraft);
                capHumaAttachDraftAutosave(newCommentInput, currentCommentDraftKey, { collect: collectCommentDraft });

                newCommentInput.addEventListener('input', () => {
                    if (!newCommentInput.value.trim() && currentCommentDraftKey) {
                        capHumaDraftClear(currentCommentDraftKey);
                    }
                });
            }

            if (btnAddComment) {
                btnAddComment.onclick = async () => {
                    const input = document.getElementById('new-comment-input');
                    const content = input.value.trim();
                    if (!content) {
                        alert("Veuillez saisir un commentaire avant de l'ajouter.");
                        return;
                    }

                    try {
                        const { data, error } = await IdCardPage.supabaseClient
                            .from('comments')
                            .insert({
                                talent_id: IdCardPage.talentId,
                                user_id: IdCardPage.currentUserId,
                                content: content,
                                author_email: document.getElementById('user-display-name').textContent
                            })
                            .select('id');

                        if (error) throw error;
                        if (!data || data.length === 0) {
                            throw new Error("L'ajout n'a affecté aucune ligne (policy RLS ?).");
                        }

                        input.value = '';
                        if (currentCommentDraftKey) capHumaDraftClear(currentCommentDraftKey);
                        toastMessage("Commentaire ajouté.", "success");
                        await logAuditAction('create', 'comment', data[0].id, null, `Sur talent ${IdCardPage.talentId}`);
                        await IdCardPage.loadComments();
                    } catch (err) {
                        console.error(err);
                        toastMessage("Échec de l'ajout du commentaire : " + (err && err.message ? err.message : 'erreur inconnue.'), "error");
                    }
                };
            }
        }

        function bindDevalidateButton() {
            document.getElementById('btn-devalidate').onclick = async () => {
                if (!confirm("Voulez-vous vraiment dévalider ce talent ?")) return;
                try {
                    const { error } = await CapHumaData.updateTalent(IdCardPage.supabaseClient, IdCardPage.talentId, {
                                is_valid: false,
                                devalidation_date: new Date().toISOString(),
                                devalidation_extension_until: null,
                                devalidation_extension_months: null,
                                devalidation_extension_granted_by: null,
                                devalidation_extension_granted_by_name: null,
                                devalidation_extension_granted_at: null
                            });

                    if (error) throw error;
                    toastMessage("Le talent a été dévalidé.", "success");
                    await loadTalentData();
                } catch (err) {
                    console.error(err);
                    toastMessage("Échec de la dévalidation.", "error");
                }
            };
        }

        function bindRevalidateButton() {
            document.getElementById('btn-revalidate').onclick = async () => {
                try {
                    const { error } = await CapHumaData.updateTalent(IdCardPage.supabaseClient, IdCardPage.talentId, {
                                is_valid: true,
                                devalidation_date: null,
                                months_without_mission: 0,
                                last_mission_end_date: null,
                                pool_integration_date: new Date().toISOString()
                            });

                    if (error) throw error;
                    toastMessage("Le talent a été réintégré dans le pool.", "success");
                    await loadTalentData();
                } catch (err) {
                    console.error(err);
                    toastMessage("Échec de la réintégration.", "error");
                }
            };
        }

        function bindRedlistButton() {
            let currentRedListReasonDraftKey = null;
            let currentRedListReasonDraftBinding = null;

            function stopRedListReasonDraftTracking() {
                if (currentRedListReasonDraftBinding) {
                    currentRedListReasonDraftBinding.stop();
                    currentRedListReasonDraftBinding = null;
                }
            }

            function discardRedListReasonDraft() {
                stopRedListReasonDraftTracking();
                if (currentRedListReasonDraftKey) {
                    capHumaDraftClear(currentRedListReasonDraftKey);
                    currentRedListReasonDraftKey = null;
                }
            }

            const redlistModal = document.getElementById('redlist-modal');
            document.getElementById('btn-redlist').onclick = () => {
                document.getElementById('modal-redlist-reason').value = "";
                redlistModal.classList.remove('hidden');
                currentRedListReasonDraftKey = `draft:redlist_reason:${IdCardPage.talentId}`;
                capHumaOfferDraftRestore(currentRedListReasonDraftKey, (data) => capHumaDefaultDraftRestore(redlistModal, data));
                currentRedListReasonDraftBinding = capHumaAttachDraftAutosave(redlistModal, currentRedListReasonDraftKey);
            };

            document.getElementById('modal-redlist-cancel').onclick = () => {
                redlistModal.classList.add('hidden');
                stopRedListReasonDraftTracking();
            };

            document.getElementById('modal-redlist-confirm').onclick = async () => {
                const reasonVal = document.getElementById('modal-redlist-reason').value.trim();
                if (!reasonVal) {
                    alert("Veuillez indiquer la raison d'inscription.");
                    return;
                }

                try {
                    const { error } = await CapHumaData.updateTalent(IdCardPage.supabaseClient, IdCardPage.talentId, {
                                is_red_listed: true,
                                red_list_date: new Date().toISOString(),
                                red_list_reason: reasonVal,
                                red_list_added_by: IdCardPage.currentUserId,
                                red_list_added_by_name: document.getElementById('user-display-name').textContent
                            });

                    if (error) throw error;

                    redlistModal.classList.add('hidden');
                    discardRedListReasonDraft();
                    toastMessage("Le talent est inscrit en Liste Rouge.", "success");
                    await loadTalentData();
                } catch (err) {
                    console.error(err);
                    toastMessage("Échec de l'inscription.", "error");
                }
            };
        }

        function bindChangePoolButton() {
            const poolChangeModal = document.getElementById('pool-change-modal');
            document.getElementById('btn-change-pool').onclick = async () => {
                document.getElementById('pool-change-error').classList.add('hidden');
                document.getElementById('pool-change-current').textContent = talent.pool || '—';
                const select = document.getElementById('modal-pool-select');
                select.innerHTML = '<option value="">Chargement des pools...</option>';
                poolChangeModal.classList.remove('hidden');

                try {
                    const { data: pools, error } = await CapHumaData.getPools(IdCardPage.supabaseClient, { select: 'pool_id, name, full_name', orderBy: 'name' });
                    if (error) throw error;

                    select.innerHTML = '<option value="">— Choisir un pool —</option>';
                    (pools || [])
                        .filter(p => p.pool_id !== talent.pool)
                        .forEach(p => {
                            const opt = document.createElement('option');
                            opt.value = p.pool_id;
                            opt.textContent = p.full_name || p.name;
                            select.appendChild(opt);
                        });
                } catch (err) {
                    console.error(err);
                    select.innerHTML = '<option value="">Erreur de chargement des pools</option>';
                }
            };

            document.getElementById('modal-pool-cancel').onclick = () => poolChangeModal.classList.add('hidden');

            document.getElementById('modal-pool-confirm').onclick = async () => {
                const errorEl = document.getElementById('pool-change-error');
                errorEl.classList.add('hidden');
                const newPool = document.getElementById('modal-pool-select').value;
                if (!newPool) {
                    capHumaShowInlineError(errorEl, "Veuillez choisir un pool de destination.");
                    return;
                }

                try {
                    const { error } = await IdCardPage.supabaseClient.rpc('change_talent_pool', {
                        p_talent_id: IdCardPage.talentId,
                        p_new_pool: newPool
                    });
                    if (error) throw error;

                    poolChangeModal.classList.add('hidden');
                    toastMessage("Pool mis à jour.", "success");
                    await loadTalentData();
                } catch (err) {
                    console.error(err);
                    capHumaShowInlineError(errorEl, "Échec du changement de pool : " + (err.message || 'erreur inconnue'));
                }
            };
        }

        function bindPromoteButton() {
            const promoteModal = document.getElementById('promote-modal');
            document.getElementById('btn-promote-to-expat').onclick = async () => {
                document.getElementById('promote-error').classList.add('hidden');
                const select = document.getElementById('modal-promote-pool-select');
                select.innerHTML = '<option value="">Chargement des pools...</option>';
                promoteModal.classList.remove('hidden');

                try {
                    const { data: pools, error } = await CapHumaData.getPools(IdCardPage.supabaseClient, { select: 'pool_id, name, full_name', orderBy: 'name' });
                    if (error) throw error;

                    select.innerHTML = '<option value="">— Choisir un pool —</option>';
                    (pools || []).forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = p.pool_id;
                        opt.textContent = p.full_name || p.name;
                        select.appendChild(opt);
                    });
                } catch (err) {
                    console.error(err);
                    select.innerHTML = '<option value="">Erreur de chargement des pools</option>';
                }
            };

            document.getElementById('modal-promote-cancel').onclick = () => promoteModal.classList.add('hidden');

            document.getElementById('modal-promote-confirm').onclick = async () => {
                const errorEl = document.getElementById('promote-error');
                errorEl.classList.add('hidden');
                const newPool = document.getElementById('modal-promote-pool-select').value;
                if (!newPool) {
                    capHumaShowInlineError(errorEl, "Veuillez choisir un pool d'intégration.");
                    return;
                }

                try {
                    const { error } = await IdCardPage.supabaseClient.rpc('promote_national_to_expat', {
                        p_talent_id: IdCardPage.talentId,
                        p_pool: newPool
                    });
                    if (error) throw error;

                    promoteModal.classList.add('hidden');
                    toastMessage("Le talent est passé en expat.", "success");
                    await loadTalentData();
                } catch (err) {
                    console.error(err);
                    capHumaShowInlineError(errorEl, "Échec du passage en expat : " + (err.message || 'erreur inconnue'));
                }
            };
        }

        function bindDeleteTalentButton() {
            document.getElementById('btn-delete-talent').onclick = async () => {
                const fullName = `${talent.first_name || talent.firstName || ''} ${talent.last_name || talent.lastName || ''}`.trim() || "ce talent";

                if (!confirm(
                    `Voulez-vous vraiment supprimer définitivement ${fullName} ?\n\n` +
                    `Cette action supprime aussi son historique d'évaluations et ses liens de ` +
                    `partage. Si ${fullName} occupe actuellement un poste, ce poste ne sera PAS ` +
                    `automatiquement remis en "Vacant" — pensez à le vérifier ensuite dans ` +
                    `missions.html. Cette action est irréversible.`
                )) return;

                if (!confirm(`Confirmation finale : ${fullName} sera supprimé(e) de façon permanente. Continuer ?`)) return;

                try {
                    const { documentsRemoved } = await CapHumaData.deleteTalentPermanently(IdCardPage.supabaseClient, IdCardPage.talentId);

                    if (documentsRemoved) {
                        toastMessage("Talent supprimé définitivement.", "success");
                        setTimeout(() => { window.location.href = 'talents.html'; }, 1200);
                    } else {
                        toastMessage(`Talent supprimé, mais ses documents de liste rouge sont restés dans le stockage (dossier ${IdCardPage.talentId}).`, "error");
                        setTimeout(() => { window.location.href = 'talents.html'; }, 6000);
                    }
                } catch (err) {
                    console.error(err);
                    toastMessage("Échec de la suppression : " + (err && err.message ? err.message : 'erreur inconnue.'), "error");
                }
            };
        }

        function bindButtonListeners() {
            bindShareButton();
            bindPdfButton();
            bindPrintButton();
            bindCommentButton();
            bindDevalidateButton();
            bindRevalidateButton();
            bindRedlistButton();
            bindChangePoolButton();
            bindPromoteButton();
            bindDeleteTalentButton();
        }

        IdCardPage.logAuditAction = logAuditAction;
        IdCardPage.passageDateMs = passageDateMs;
        IdCardPage.normalizePassageComment = normalizePassageComment;

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', IdCardPage.currentUserId, null, null);
            await IdCardPage.supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });

        window.addEventListener('DOMContentLoaded', () => { checkSession(); capHumaInitModalA11y(); });
})();
