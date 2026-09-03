// id-card.js est scindé en 4 fichiers par responsabilité : session/données/
// rendu/actions admin (ce fichier), commentaires (id-card-comments.js),
// export PDF (id-card-pdf.js), liens de partage (id-card-share.js).
//
// Ce fichier n'est pas enveloppé dans une IIFE, contrairement aux autres
// pages du site — même raison que missions.js/talents.js : les 4 fichiers de
// cette page doivent partager un état commun (session, talent chargé...),
// impossible entre balises <script> classiques sans un point de partage
// explicite. IdCardPage est ce point unique, propre à cette page.
//
// Chargement requis dans id-card.html, dans cet ordre :
//   1. pages/id-card.js            (ce fichier — déclare IdCardPage)
//   2. pages/id-card-comments.js
//   3. pages/id-card-pdf.js
//   4. pages/id-card-share.js
const IdCardPage = {};

(() => {
        // ============================================================================
        // HEADER COMMUN — injecté avant toute autre chose, pour que
        // #user-display-name, #logoutBtn, #back-btn et #back-btn-text existent dès
        // la suite du script. backButton:true car cette page réassigne la cible du
        // bouton Retour en JS (dashboard.html par défaut dans checkSession(), puis
        // "talents.html?pool=X" une fois le talent chargé dans renderTalentCard()).
        // ============================================================================
        renderPageLayout({
            icon: '🧭',
            title: 'Fiche talent',
            backButton: true,
            variant: 'scroll-page',
            stickyZ: 40,
            extraHeaderClass: 'shrink-0 no-print',
            logoutBtnExtraClass: 'no-print'
        });

        const appBody = document.getElementById('appBody');
        IdCardPage.supabaseClient = null;
        IdCardPage.talentId = null;
        let talent = null;
        let activeMission = null;
        IdCardPage.currentUserId = null;
        let currentUserEmail = null;
        IdCardPage.currentUserRole = null;
        let currentUserName = null;
        IdCardPage.comments = [];

        // ============================================================================
        // JOURNAL D'AUDIT — enregistre une action métier sensible dans
        // public.audit_logs. Ne bloque JAMAIS l'action métier elle-même si
        // l'écriture du log échoue (le log est secondaire à l'action réelle) :
        // erreur avalée en console uniquement, jamais remontée à l'utilisateur.
        // ============================================================================
        async function logAuditAction(action, entityType, entityId, entityName, details) {
            // Délègue à shared/caphuma-auth.js (fonction commune) — corrige au passage
            // le fait que user_name n'était jamais transmis sur certaines pages.
            const userName = typeof currentUserName !== 'undefined' ? currentUserName : null;
            await capHumaLogAudit(
                IdCardPage.supabaseClient,
                { userId: IdCardPage.currentUserId, userEmail: currentUserEmail, userName: userName },
                action, entityType, entityId, entityName, details
            );
        }

        // ============================================================================
        // NORMALISATION DES PASSAGES ARCHIVÉS (compatibilité double format)
        // ============================================================================
        // Deux formats coexistent dans talents.archived_position_passages :
        //  - Ancien (créé par l'ex-mini-workflow de id-card.html, retiré depuis) :
        //    dates en nombre (epoch ms), commentaire unique par passage, champs
        //    camelCase (positivePoints, negativePoints, createdByName, createdAt).
        //  - Nouveau (créé par missions.html) : dates en texte ISO, plusieurs
        //    commentaires par passage possibles, champs snake_case
        //    (positive_points, negative_points, author_email, created_at).
        // Ces fonctions lisent les deux indifféremment pour l'affichage (Historique
        // + export PDF), sans jamais réécrire les anciennes entrées en base.
        function passageDateMs(value) {
            if (value === null || value === undefined || value === '') return null;
            if (typeof value === 'number') return value;
            const parsed = new Date(value).getTime();
            return isNaN(parsed) ? null : parsed;
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

        // Échappement HTML systématique de toute donnée venant de la base
        // avant injection via innerHTML — prévention XSS (audit sécurité).

        // SUPABASE_URL / SUPABASE_ANON_KEY viennent de shared/caphuma-config.js
        // (chargé dans le head).

        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            IdCardPage.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }

        async function checkSession() {
            if (!IdCardPage.supabaseClient) {
                showError("Configuration Supabase introuvable dans le localStorage.");
                return;
            }
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

                // Cible par défaut du bouton Retour, remplacée par "Retour au pool X"
                // une fois le talent chargé (voir loadTalentData / renderTalentData).
                document.getElementById('back-btn').onclick = () => {
                    window.location.href = 'dashboard.html';
                };
                
                // Récupérer l'ID du talent dans l'URL
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
                // talent (avec son repli _id) et poste occupé ne dépendent pas
                // l'un de l'autre — lancés en parallèle au lieu de 2 allers-retours
                // réseau séquentiels.
                const [talentResult, missionResult] = await Promise.all([
                    (async () => {
                        // Recherche croisée id ou _id pour robustesse absolue
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
                            const { data: tAlt, error: etAlt } = await capHumaWithRetry(() =>
                                IdCardPage.supabaseClient
                                    .from('talents')
                                    .select('*')
                                    .eq('_id', IdCardPage.talentId)
                                    .maybeSingle()
                            );

                            if (etAlt || !tAlt) {
                                throw new Error("Le professionnel demandé n'existe pas dans la base de données.");
                            }
                            return tAlt;
                        }
                        return t;
                    })(),
                    // Récupérer le poste actuellement occupé
                    capHumaWithRetry(() =>
                        IdCardPage.supabaseClient
                            .from('missions')
                            .select('*')
                            .eq('occupant_id', IdCardPage.talentId)
                            .eq('status', 'occupied')
                            .maybeSingle()
                    )
                ]);

                talent = talentResult;
                activeMission = missionResult.data;

                renderTalentCard();
                // Commentaires et historique des pools ne dépendent pas l'un de
                // l'autre non plus — même principe.
                await Promise.all([
                    IdCardPage.loadComments(),
                    loadPoolHistory()
                ]);
            } catch (err) {
                console.error("Erreur complète :", err);
                showError(err.message || "Erreur lors du chargement des données.");
            }
        }

        // ============================================================================
        // HISTORIQUE DES POOLS — changement de pool au fil du temps (carrière du talent)
        // ============================================================================
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
                container.innerHTML = '<p class="text-sm text-slate-400 italic">Historique indisponible pour le moment.</p>';
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
                            <span class="text-slate-400 mx-1">→</span>
                            <span class="font-semibold text-primary">${escapeHtml(e.to_pool)}</span>
                        </p>
                        <p class="text-xs text-slate-400 mt-0.5">
                            Le ${dateStr}${e.changed_by_name ? ` · par ${escapeHtml(e.changed_by_name)}` : ''}
                        </p>
                    </div>
                </div>`;
            }).join('');
        }


        // calculateMonthsWithoutMission() a été retirée d'ici : elle vient désormais
        // de shared/caphuma-utils.js (chargé ligne 12). Comportement strictement
        // identique — cette page utilisait déjà la méthode calendaire.


        function renderTalentCard() {
            // Lecture robuste et sécurisée des propriétés en snake_case et camelCase
            const fName = talent.first_name || talent.firstName || "";
            const lName = talent.last_name || talent.lastName || "";
            const fFunction = talent.current_function || talent.currentFunction || "N/A";
            const expAlima = talent.experience_months_alima || talent.experienceMonthsAlima || 0;
            const expHum = talent.experience_months_humanitarian || talent.experienceMonthsHumanitarian || 0;
            const eduLvl = talent.education_level || talent.educationLevel || "none";
            const eduSpec = talent.education_specialty || talent.educationSpecialty || "N/A";
            const intDate = talent.pool_integration_date || talent.poolIntegrationDate;
            const nbMissions = talent.number_of_alima_missions || talent.numberOfAlimaMissions || "none";
            const visaValid = talent.has_visa || talent.hasVisa;
            const cRes = talent.country_of_residence || talent.countryOfResidence || "N/A";

            document.getElementById('back-btn-text').textContent = `Retour au pool ${talent.pool}`;
            document.getElementById('back-btn').onclick = () => {
                // talent.pool est un code pool forcé en majuscules par admin.html,
                // donc déjà propre — encodé par précaution, même logique que talents.js.
                window.location.href = `talents.html?pool=${encodeURIComponent(talent.pool)}`;
            };

            document.getElementById('talent-fullname').textContent = `${fName} ${lName}`.trim() || "N/A";
            document.getElementById('talent-function').textContent = fFunction;
            document.getElementById('talent-pool-display').textContent = `Pool : ${talent.pool || '—'}`;
            
            const expAlimaYears = Math.floor(expAlima / 12);
            const expAlimaRem = expAlima % 12;
            document.getElementById('talent-experience-alima').textContent = `${expAlimaYears}a ${expAlimaRem}m`;

            const statusBadge = document.getElementById('talent-status-badge');
            statusBadge.textContent = talent.status || "N/A";
            statusBadge.className = "bg-white/20 text-white text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider";
            if (talent.status === 'En poste ALIMA') {
                statusBadge.classList.add('bg-green-600');
            }

            if (talent.is_red_listed || talent.isRedListed) {
                document.getElementById('redlist-banner').classList.remove('hidden');
                document.getElementById('redlist-reason').textContent = `Motif : ${talent.red_list_reason || talent.redListReason || "Non spécifié"}`;
            } else {
                document.getElementById('redlist-banner').classList.add('hidden');
            }

            // Progression validité
            const isInvalid = talent.isValid === false || talent.is_valid === false;
            const isCurrentlyOnMission = talent.is_currently_on_mission || talent.isCurrentlyOnAlimaMission;
            const isPaused = !isInvalid && (isCurrentlyOnMission || talent.status === 'En poste ALIMA');
            const totalMonths = isInvalid ? DEVALIDATION_MAX_MONTHS : calculateMonthsWithoutMission(talent);
            const cappedMonths = Math.min(totalMonths, DEVALIDATION_MAX_MONTHS);
            const percent = (cappedMonths / DEVALIDATION_MAX_MONTHS) * 100;

            const vCounter = document.getElementById('validity-counter');
            const vLabel = document.getElementById('validity-label');
            const vBar = document.getElementById('validity-bar');
            const vSub = document.getElementById('validity-subtext');

            vBar.style.width = `${percent}%`;

            if (isInvalid) {
                vLabel.textContent = "Statut : Dévalidé du pool";
                vLabel.className = "text-red-600 font-bold";
                vCounter.textContent = `${DEVALIDATION_MAX_MONTHS} / ${DEVALIDATION_MAX_MONTHS} mois`;
                vBar.className = "h-full bg-red-600 rounded-full";
                vSub.textContent = "Ce professionnel est inactif et doit faire l'objet d'une réintégration manuelle.";
            } else if (isPaused) {
                vLabel.textContent = "Compteur suspendu (Actif)";
                vLabel.className = "text-blue-600 font-bold";
                vCounter.textContent = `${totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois`;
                vBar.className = "h-full bg-blue-500 rounded-full opacity-60";
                vSub.textContent = "⏸ En cours de mission ALIMA — le compteur est gelé.";
            } else {
                vCounter.textContent = `${totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois`;
                if (totalMonths >= DEVALIDATION_CRITICAL_MONTHS) {
                    vLabel.textContent = "Validité pool : Critique (Action urgente)";
                    vLabel.className = "text-red-500 font-bold";
                    vBar.className = "h-full bg-red-500 rounded-full";
                } else if (totalMonths >= DEVALIDATION_AT_RISK_MONTHS) {
                    vLabel.textContent = "Validité pool : À risque";
                    vLabel.className = "text-orange-500 font-bold";
                    vBar.className = "h-full bg-orange-400 rounded-full";
                } else {
                    vLabel.textContent = "Validité pool : Stable";
                    vLabel.className = "text-green-600 font-bold";
                    vBar.className = "h-full bg-green-500 rounded-full";
                }
                const refDate = talent.last_mission_end_date || talent.pool_integration_date || talent.poolIntegrationDate;
                vSub.textContent = `Date de référence du calcul : ${refDate ? new Date(refDate).toLocaleDateString('fr-FR') : 'N/A'}`;
            }

            // Remplissage infos
            document.getElementById('info-email').textContent = talent.email || "N/A";
            document.getElementById('info-gender').textContent = talent.gender === "H" ? "Homme" : talent.gender === "F" ? "Femme" : "N/A";
            document.getElementById('info-nationality').textContent = talent.nationality || "N/A";
            document.getElementById('info-residence').textContent = cRes;
            document.getElementById('info-visa').textContent = visaValid ? "Valide" : "Non valide / N/A";
            
            const langs = Array.isArray(talent.languages) ? talent.languages.join(", ") : (talent.languages || "N/A");
            document.getElementById('info-languages').textContent = langs;

            // Parcours & éducation
            // EDU_LEVEL_LABELS / MISSION_COUNT_LABELS viennent de shared/caphuma-utils.js.
            document.getElementById('info-edu-level').textContent = EDU_LEVEL_LABELS[eduLvl] || "N/A";
            document.getElementById('info-edu-specialty').textContent = eduSpec;
            document.getElementById('info-integration-date').textContent = intDate ? new Date(intDate).toLocaleDateString('fr-FR') : "N/A";
            
            document.getElementById('info-exp-humanitarian').textContent = `${Math.floor(expHum / 12)}a ${expHum % 12}m`;
            
            document.getElementById('info-alima-missions').textContent = MISSION_COUNT_LABELS[nbMissions] || "0";

            // Rendu défensif de type liste
            renderBadges('skills-badges-container', talent.key_skills || talent.keySkills, 'bg-blue-50 text-blue-700 border-blue-200');
            renderBadges('contexts-badges-container', talent.intervention_contexts || talent.interventionContexts, 'bg-orange-50 text-accent border-orange-200');
            renderBadges('zones-badges-container', talent.intervention_zones || talent.interventionZones, 'bg-green-50 text-green-700 border-green-200');

            // Timeline
            const timeline = document.getElementById('timeline-container');
            let hasTimelineElements = false;

            // Les entrées de la timeline sont construites dans un DocumentFragment
            // (hors DOM, aucun reflow) puis ajoutées à `timeline` en un seul
            // appendChild final — une concaténation `innerHTML += ...` par entrée
            // ferait ré-analyser tout le HTML déjà affiché à chaque itération.
            const timelineFragment = document.createDocumentFragment();

            if (activeMission) {
                hasTimelineElements = true;
                const startStr = activeMission.contract_start_date || activeMission.contractStartDate
                    ? new Date(activeMission.contract_start_date || activeMission.contractStartDate).toLocaleDateString('fr-FR')
                    : "En cours";

                const activeEntry = document.createElement('div');
                activeEntry.innerHTML = `
                    <div class="relative pl-6 border-l-2 border-green-500">
                        <div class="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow"></div>
                        <div class="space-y-1">
                            <span class="inline-block text-[10px] uppercase font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded-full">En cours</span>
                            <h4 class="font-bold text-slate-900">${escapeHtml(activeMission.title)}</h4>
                            <p class="text-xs text-slate-500">${escapeHtml(activeMission.country)} • Prise de poste le ${startStr}</p>
                        </div>
                    </div>
                `;
                timelineFragment.appendChild(activeEntry.firstElementChild);
            }

            // Parsing sécurisé de l'historique
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
                                    <div class="flex justify-between items-center text-[10px] text-slate-400">
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
                                <span class="text-xs font-semibold text-slate-400">${startStr} – ${endStr}${durationMonths !== null ? ` (${durationMonths} m)` : ''}</span>
                                <h4 class="font-bold text-slate-800">${escapeHtml(p.positionTitle)}</h4>
                                <p class="text-xs text-slate-500">${escapeHtml(p.country || "Mission ALIMA")}</p>
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
                timeline.innerHTML = `<p class="text-sm text-slate-400 italic">Aucun parcours de mission ALIMA archivé.</p>`;
            }

            setupAdminActions(isInvalid);
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
                container.innerHTML = `<span class="text-xs text-slate-400 italic">Non spécifié</span>`;
                return;
            }
            items.forEach(item => {
                const badge = document.createElement('span');
                badge.className = `text-xs px-2.5 py-1 rounded-lg border font-medium ${colorClass}`;
                badge.textContent = item;
                container.appendChild(badge);
            });
        }


        function setupAdminActions(isInvalid) {
            const btnManageMissions = document.getElementById('btn-manage-missions');
            const btnDevalidate = document.getElementById('btn-devalidate');
            const btnRevalidate = document.getElementById('btn-revalidate');
            const btnRedlist = document.getElementById('btn-redlist');
            const btnDeleteTalent = document.getElementById('btn-delete-talent');

            // La gestion des postes (affectation, évaluations, fin de mission) se fait
            // entièrement depuis missions.html — ce lien y renvoie, filtré sur le pool
            // du talent.
            btnManageMissions.href = 'missions.html?pool=' + encodeURIComponent(talent.pool || '');

            if (isInvalid) {
                btnDevalidate.classList.add('hidden');
                btnRevalidate.classList.remove('hidden');
            } else {
                btnRevalidate.classList.add('hidden');
                btnDevalidate.classList.remove('hidden');
            }

            // Dévalider/Réintégrer/Liste Rouge sont des actions réservées admin/user
            // partout ailleurs sur le site — masquage supplémentaire par-dessus la
            // logique isInvalid ci-dessus, pour visitor.
            if (IdCardPage.currentUserRole === 'visitor') {
                btnDevalidate.classList.add('hidden');
                btnRevalidate.classList.add('hidden');
                btnRedlist.classList.add('hidden');
                document.getElementById('btn-change-pool').classList.add('hidden');
                document.getElementById('share-btn').classList.add('hidden');
            } else {
                btnRedlist.classList.remove('hidden');
                document.getElementById('btn-change-pool').classList.remove('hidden');
                document.getElementById('share-btn').classList.remove('hidden');
            }

            // Suppression définitive : réservée admin, et uniquement pour un talent ACTIF.
            // Un talent dévalidé se supprime depuis devalidated.html — deux chemins de
            // suppression différents selon l'état du talent, jamais les deux en même temps
            // sur la même fiche (décision utilisateur).
            if (IdCardPage.currentUserRole === 'admin' && !isInvalid) {
                btnDeleteTalent.classList.remove('hidden');
            } else {
                btnDeleteTalent.classList.add('hidden');
            }
        }

        // ============================================================================
        // LIAISON DES BOUTONS — une fonction par bouton/action, toutes appelées
        // depuis bindButtonListeners() (orchestrateur, tout en bas de ce bloc).
        // ============================================================================
        function bindShareButton() {
            // Ouvre la modale de gestion des liens (liste + génération + révocation)
            // plutôt que de créer un nouveau lien à chaque clic.
            document.getElementById('share-btn').onclick = () => {
                IdCardPage.openShareLinksModal();
            };
        }

        function bindPdfButton() {
            document.getElementById('pdf-btn').onclick = () => {
                try {
                    IdCardPage.exportTalentCardPDF(talent, activeMission);
                    toastMessage("Document PDF généré et téléchargé.", "success");
                } catch (err) {
                    console.error("Erreur génération PDF :", err);
                    toastMessage("Échec de la génération du PDF.", "error");
                }
            };
        }

        function bindPrintButton() {
            document.getElementById('print-btn').onclick = () => window.print();
        }

        function bindCommentButton() {
            // Brouillon local : pas de modale, le champ est visible en permanence sur
            // la fiche — le suivi démarre une seule fois au chargement de la page et
            // s'efface après un ajout réussi. Clé par talent (IdCardPage.talentId).
            let currentCommentDraftKey = null;

            function collectCommentDraft() {
                const val = document.getElementById('new-comment-input').value;
                if (!val || !val.trim()) return undefined; // rien à sauvegarder — évite que l'autosave différé ne réécrive un brouillon vide juste après le garde-fou ci-dessous
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

                // Garde-fou local, propre à ce champ : dès que le champ redevient vide
                // (l'utilisateur a tout effacé sans valider), on efface le brouillon tout
                // de suite plutôt que d'attendre l'autosave — sinon la prochaine visite
                // proposerait de restaurer... un champ vide.
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
                        // Volontairement pas enveloppé dans capHumaWithRetry() : comments
                        // n'a aucune contrainte UNIQUE — si la 1re tentative a en fait
                        // réussi côté serveur mais que sa réponse s'est perdue, une relance
                        // créerait un second commentaire identique, silencieusement.
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
                    const { error } = await capHumaWithRetry(() =>
                        IdCardPage.supabaseClient
                            .from('talents')
                            .update({
                                is_valid: false,
                                devalidation_date: new Date().toISOString(),
                                devalidation_extension_until: null,
                                devalidation_extension_months: null,
                                devalidation_extension_granted_by: null,
                                devalidation_extension_granted_by_name: null,
                                devalidation_extension_granted_at: null
                            })
                            .eq('id', IdCardPage.talentId)
                    );
                    
                    if (error) throw error;
                    toastMessage("Le talent a été dévalidé.", "success");
                    // Journalisé automatiquement par le trigger Postgres trg_audit_talents.
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
                    const { error } = await capHumaWithRetry(() =>
                        IdCardPage.supabaseClient
                            .from('talents')
                            // La réintégration doit faire repartir la jauge "mois sans
                            // mission" à zéro à partir d'aujourd'hui, pas depuis l'ancienne
                            // fin de mission (calculateMonthsWithoutMission priorise
                            // last_mission_end_date sur pool_integration_date — la vider est
                            // donc nécessaire, pas juste pool_integration_date).
                            // months_without_mission est gardé à jour aussi pour les stats
                            // SQL du tableau de bord, qui lisent cette colonne stockée
                            // plutôt que de la recalculer en direct.
                            .update({
                                is_valid: true,
                                devalidation_date: null,
                                months_without_mission: 0,
                                last_mission_end_date: null,
                                pool_integration_date: new Date().toISOString()
                            })
                            .eq('id', IdCardPage.talentId)
                    );
                    
                    if (error) throw error;
                    toastMessage("Le talent a été réintégré dans le pool.", "success");
                    // Journalisé automatiquement par le trigger Postgres trg_audit_talents.
                    await loadTalentData();
                } catch (err) {
                    console.error(err);
                    toastMessage("Échec de la réintégration.", "error");
                }
            };
        }

        function bindRedlistButton() {
            // Brouillon local : un seul champ (motif), clé par talent
            // (IdCardPage.talentId, connu dès le chargement de la page). À
            // l'ouverture : offre de restauration + autosave. Sur Annuler/fermeture :
            // arrêt du suivi seul, le brouillon reste en mémoire. Sur succès :
            // effacement définitif.
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
                    const { error } = await capHumaWithRetry(() =>
                        IdCardPage.supabaseClient
                            .from('talents')
                            .update({
                                is_red_listed: true,
                                red_list_date: new Date().toISOString(),
                                red_list_reason: reasonVal,
                                red_list_added_by: IdCardPage.currentUserId,
                                red_list_added_by_name: document.getElementById('user-display-name').textContent
                            })
                            .eq('id', IdCardPage.talentId)
                    );
                    
                    if (error) throw error;

                    redlistModal.classList.add('hidden');
                    discardRedListReasonDraft();
                    toastMessage("Le talent est inscrit en Liste Rouge.", "success");
                    // Journalisé automatiquement par le trigger Postgres trg_audit_talents.
                    await loadTalentData();
                } catch (err) {
                    console.error(err);
                    toastMessage("Échec de l'inscription.", "error");
                }
            };
        }

        function bindChangePoolButton() {
            // Enregistre le changement dans pool_history avant de mettre à jour
            // talents.pool, pour garder une trace "de X vers Y à telle date".
            const poolChangeModal = document.getElementById('pool-change-modal');
            document.getElementById('btn-change-pool').onclick = async () => {
                document.getElementById('pool-change-error').classList.add('hidden');
                document.getElementById('pool-change-current').textContent = talent.pool || '—';
                const select = document.getElementById('modal-pool-select');
                select.innerHTML = '<option value="">Chargement des pools...</option>';
                poolChangeModal.classList.remove('hidden');

                try {
                    const { data: pools, error } = await capHumaWithRetry(() =>
                        IdCardPage.supabaseClient
                            .from('pools')
                            .select('pool_id, name, full_name')
                            .order('name', { ascending: true })
                    );
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
                    errorEl.textContent = "Veuillez choisir un pool de destination.";
                    errorEl.classList.remove('hidden');
                    return;
                }
                const previousPool = talent.pool || null;

                try {
                    // Historique d'abord (source de vérité de "qui a changé quoi, quand"),
                    // puis mise à jour du talent — dans cet ordre, si l'étape 2 échoue on
                    // garde au moins une trace de la tentative plutôt que l'inverse.
                    // Volontairement pas enveloppé dans capHumaWithRetry() : pool_history
                    // n'a aucune contrainte UNIQUE et est une table "append-only" (aucune
                    // policy update/delete) — un doublon créé par une relance après perte
                    // de réponse serait silencieux et impossible à corriger depuis
                    // l'interface.
                    const { error: histError } = await IdCardPage.supabaseClient.from('pool_history').insert({
                        talent_id: IdCardPage.talentId,
                        from_pool: previousPool,
                        to_pool: newPool,
                        changed_by: IdCardPage.currentUserId,
                        changed_by_name: currentUserName || currentUserEmail
                    });
                    if (histError) throw histError;

                    // Enveloppé dans capHumaWithRetry() : UPDATE par id, sûr à retenter.
                    const { data, error } = await capHumaWithRetry(() =>
                        IdCardPage.supabaseClient
                            .from('talents')
                            .update({ pool: newPool })
                            .eq('id', IdCardPage.talentId)
                            .select('id')
                    );
                    if (error) throw error;
                    if (!data || data.length === 0) {
                        throw new Error("La mise à jour n'a affecté aucune ligne (policy RLS ?).");
                    }

                    poolChangeModal.classList.add('hidden');
                    toastMessage("Pool mis à jour.", "success");
                    // Journalisé automatiquement par le trigger Postgres trg_audit_talents.
                    await loadTalentData();
                } catch (err) {
                    console.error(err);
                    errorEl.textContent = "Échec du changement de pool : " + (err.message || 'erreur inconnue');
                    errorEl.classList.remove('hidden');
                }
            };
        }

        function bindDeleteTalentButton() {
            // Suppression définitive : réservée admin, et uniquement pour un talent
            // actif (visibilité du bouton déjà gérée par setupAdminActions).
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
                    // Nettoyage des données liées avant suppression du talent — la
                    // contrainte FK de ces tables vers talents.id n'a pas de règle ON
                    // DELETE confirmée, donc suppression explicite plutôt que de compter
                    // sur une cascade éventuelle.
                    await capHumaWithRetry(() => IdCardPage.supabaseClient.from('evaluations').delete().eq('talent_id', IdCardPage.talentId));
                    await capHumaWithRetry(() => IdCardPage.supabaseClient.from('comments').delete().eq('talent_id', IdCardPage.talentId));
                    await capHumaWithRetry(() => IdCardPage.supabaseClient.from('share_tokens').delete().eq('talent_id', IdCardPage.talentId));

                    // Volontairement pas enveloppé dans capHumaWithRetry() : un DELETE
                    // par id fait disparaître la ligne, donc une 2e tentative après une
                    // 1re en fait réussie (réponse perdue) ne trouverait plus rien et
                    // déclencherait à tort le contrôle "0 ligne affectée" juste en dessous.
                    const { data, error } = await IdCardPage.supabaseClient
                        .from('talents')
                        .delete()
                        .eq('id', IdCardPage.talentId)
                        .select('id');

                    if (error) throw error;
                    if (!data || data.length === 0) {
                        throw new Error("La suppression n'a affecté aucune ligne (policy RLS ?).");
                    }

                    toastMessage("Talent supprimé définitivement.", "success");
                    // Journalisé automatiquement par le trigger Postgres trg_audit_talents.
                    setTimeout(() => { window.location.href = 'talents.html'; }, 1200);
                } catch (err) {
                    console.error(err);
                    toastMessage("Échec de la suppression : " + (err && err.message ? err.message : 'erreur inconnue.'), "error");
                }
            };
        }

        // Orchestrateur : lie les 9 boutons/actions de la fiche, un appel par
        // fonction ci-dessus. Chaque fonction ne connaît que son propre bouton — état
        // de brouillon local à bindCommentButton()/bindRedlistButton(), rien de
        // partagé entre elles au-delà de talent/activeMission (fermeture de l'IIFE
        // englobante).
        function bindButtonListeners() {
            bindShareButton();
            bindPdfButton();
            bindPrintButton();
            bindCommentButton();
            bindDevalidateButton();
            bindRevalidateButton();
            bindRedlistButton();
            bindChangePoolButton();
            bindDeleteTalentButton();
        }


        // Exposé sur IdCardPage pour appel depuis les autres fichiers de la page
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
