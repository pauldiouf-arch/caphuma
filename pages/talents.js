const TalentsPage = {};

(() => {
        renderPageLayout({
            icon: '👤',
            title: 'Professionnels',
            iconGradient: 'from-primary to-primary-dark',
            subtitleId: 'poolSubtitle',
            subtitle: 'Chargement du pool...',
            actionsHtml: `
                <button id="newTalentBtn" class="bg-primary hover:bg-primary-dark text-white px-4 py-2.5 rounded-lg text-sm font-bold shadow-md transition-all flex items-center gap-2">
                    ＋ Nouveau talent
                </button>
            `
        });

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) window.location.replace('index.html');

        const { createClient } = supabase;
        TalentsPage.supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const urlParams = new URLSearchParams(window.location.search);
        TalentsPage.currentPoolId = urlParams.get('pool');

        const appBody = document.getElementById('appBody');
        const talentForm = document.getElementById('talentForm');
        TalentsPage.currentUserId = null;
        TalentsPage.currentUserEmail = null;
        TalentsPage.currentUserRole = null;
        TalentsPage.currentUserName = null;

        const logAuditAction = capHumaMakeAuditLogger(
            () => TalentsPage.supabaseClient,
            () => ({
                userId: TalentsPage.currentUserId,
                userEmail: TalentsPage.currentUserEmail,
                userName: typeof TalentsPage.currentUserName !== 'undefined' ? TalentsPage.currentUserName : null
            })
        );

        async function checkSession() {
            try {
                const s = await capHumaInitSession(TalentsPage.supabaseClient);
                TalentsPage.currentUserId = s.userId;
                TalentsPage.currentUserEmail = s.email;
                TalentsPage.currentUserName = s.name;
                TalentsPage.currentUserRole = s.role;

                document.getElementById('user-display-name').textContent = TalentsPage.currentUserEmail;
                // Confort d'affichage : la policy RLS sur talents (insert) est la vraie
                // barrière.
                document.getElementById('newTalentBtn').classList.toggle('hidden', TalentsPage.currentUserRole === 'visitor');

                appBody.style.display = '';
                await loadPoolInfo();
                await loadTalents();
            } catch (err) {
                console.warn("[Session Guard]", err.message);
                window.location.replace('login.html');
            }
        }
        checkSession();
        capHumaInitModalA11y();

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', TalentsPage.currentUserId, TalentsPage.currentUserEmail, null);
            await TalentsPage.supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });

        async function loadPoolInfo() {
            const subtitle = document.getElementById('poolSubtitle');
            if (!TalentsPage.currentPoolId) { subtitle.textContent = 'Tous les pools'; return; }
            try {
                const { data } = await capHumaWithRetry(() =>
                    TalentsPage.supabaseClient.from('pools').select('name, full_name').eq('pool_id', TalentsPage.currentPoolId)
                );
                if (data && data.length > 0) {
                    subtitle.textContent = `${data[0].full_name || data[0].name} (${TalentsPage.currentPoolId})`;
                } else {
                    subtitle.textContent = TalentsPage.currentPoolId;
                }
            } catch (e) { subtitle.textContent = TalentsPage.currentPoolId; }
            document.getElementById('modalPoolBadge').textContent = TalentsPage.currentPoolId || '—';
        }

        // Deux modes, choisis à chaque appel de loadTalents() selon les filtres actifs :
        //   - Paginé (par défaut) : une seule page de PAGE_SIZE talents demandée à
        //     Supabase (.range()), filtrée/triée côté serveur (statut + tri simple).
        //   - Liste complète : dès qu'une recherche par mot-clé ou un filtre avancé est
        //     actif (voir computeIsFullListMode), tout le pool est chargé une fois (mis
        //     en cache dans TalentsPage.allTalents) puis filtré/trié côté client —
        //     nécessaire car la recherche par mot-clé fouille aussi l'historique de
        //     missions archivées, non traduisible en requête Supabase paginée.
        TalentsPage.allTalents = null; // null = pas encore chargé (chargement paresseux)
        const PAGE_SIZE = 20;
        TalentsPage.currentPage = 0;
        TalentsPage.totalCount = 0;
        TalentsPage.isFullListMode = false;

        // Affichage progressif en mode "liste complète" (recherche/filtre avancé),
        // pour éviter de créer d'un coup plusieurs centaines de nœuds DOM sur un
        // pool qui grossirait beaucoup. Sans effet en mode paginé normal
        // (PAGE_SIZE = 20, déjà petit) — voir renderTalents() plus bas.
        const RENDER_BATCH_SIZE = 25;
        TalentsPage.renderedTalentsCount = 0;

        function computeIsFullListMode() {
            const f = TalentsPage.searchFilters;
            if (f.searchQuery) return true;
            if (f.keywordFilter) return true;
            // Le tri "Disponibilité" combine 3 colonnes (availability_type/
            // availability_date/availability_months), pas traduisible en un simple
            // .order() Supabase.
            if (f.sortBy === 'availability') return true;
            if (f.minExpAlima || f.minExpHumanitarian) return true;
            if (f.availableFrom || f.availableTo) return true;
            if (f.nationalityFilter || f.countryFilter || f.languagesFilter) return true;
            if (f.hasVisaFilter || f.hasMissionOpeningFilter || f.hasEmergencyMissionFilter) return true;
            if (f.interventionContextFilter || f.interventionZoneFilter) return true;
            return false;
        }

        async function loadTalents() {
            TalentsPage.isFullListMode = computeIsFullListMode();

            if (TalentsPage.isFullListMode) {
                document.getElementById('paginationControls').classList.add('hidden');
                if (TalentsPage.allTalents === null) {
                    await fetchAllTalents();
                }
                applyFiltersAndRender();
            } else {
                await fetchPagedTalents();
            }
        }

        async function fetchAllTalents() {
            const listEl = document.getElementById('talentsList');
            const errorEl = document.getElementById('listError');
            try {
                // La construction de la requête est déplacée dans la fonction passée à
                // capHumaWithRetry(), pour qu'un retry reconstruise un query builder tout
                // neuf plutôt que de réutiliser un objet déjà attendu une 1re fois.
                const { data, error } = await capHumaWithRetry(() => {
                    // Volontairement select('*'), pas resserré comme statistics.js/
                    // missions.js : ces lignes alimentent TalentsPage.openEditModal()
                    // (talents-modal.js) via Object.keys(talent) — une colonne absente
                    // du select resterait silencieusement vide à l'édition.
                    let query = TalentsPage.supabaseClient.from('talents').select('*').order('last_name', { ascending: true });
                    if (TalentsPage.currentPoolId) query = query.eq('pool', TalentsPage.currentPoolId);
                    return query;
                });
                if (error) throw error;
                TalentsPage.allTalents = data || [];
            } catch (err) {
                console.error(err);
                listEl.innerHTML = '';
                errorEl.textContent = "Impossible de charger les talents : " + err.message;
                errorEl.classList.remove('hidden');
                TalentsPage.allTalents = [];
            }
        }

        async function fetchPagedTalents() {
            const listEl = document.getElementById('talentsList');
            const errorEl = document.getElementById('listError');
            try {
                const sortColumnMap = {
                    name: 'last_name',
                    integration: 'pool_integration_date',
                    expAlima: 'experience_months_alima',
                    expHumanitarian: 'experience_months_humanitarian'
                };
                const sortColumn = sortColumnMap[TalentsPage.searchFilters.sortBy] || 'pool_integration_date';
                const ascending = TalentsPage.searchFilters.sortOrder === 'asc';

                const from = TalentsPage.currentPage * PAGE_SIZE;
                const to = from + PAGE_SIZE - 1;

                // Même principe que fetchAllTalents() : la requête entière est
                // reconstruite à chaque tentative de capHumaWithRetry().
                const { data, error, count } = await capHumaWithRetry(() => {
                    // Même raison que fetchAllTalents() : ces lignes alimentent aussi
                    // TalentsPage.openEditModal() en mode paginé par défaut.
                    let query = TalentsPage.supabaseClient
                        .from('talents')
                        .select('*', { count: 'exact' })
                        .order(sortColumn, { ascending })
                        .range(from, to);

                    if (TalentsPage.currentPoolId) query = query.eq('pool', TalentsPage.currentPoolId);
                    if (TalentsPage.searchFilters.statusFilter) query = query.eq('status', TalentsPage.searchFilters.statusFilter);

                    // Répété ici côté serveur (filterTalents() ne couvre que le mode
                    // "liste complète") : "actif" = is_valid pas explicitement false et
                    // is_red_listed pas explicitement true, tolérant NULL comme le fait
                    // le filtre client.
                    if (TalentsPage.searchFilters.validityFilter === 'active') {
                        query = query.or('is_valid.is.null,is_valid.eq.true')
                                     .or('is_red_listed.is.null,is_red_listed.eq.false');
                    } else if (TalentsPage.searchFilters.validityFilter === 'devalidated') {
                        query = query.eq('is_valid', false);
                    }

                    return query;
                });
                if (error) throw error;

                TalentsPage.totalCount = count || 0;
                TalentsPage.currentFilteredTalents = data || [];
                renderTalents(TalentsPage.currentFilteredTalents);
                updateSearchSummary();
                updateResetButtonVisibility();
                updateTalentsPaginationControls();

            } catch (err) {
                console.error(err);
                listEl.innerHTML = '';
                errorEl.textContent = "Impossible de charger les talents : " + err.message;
                errorEl.classList.remove('hidden');
            }
        }

        // Nom volontairement différent de renderPaginationControls() (shared/caphuma-utils.js) :
        // signature et logique différentes, un même nom écraserait silencieusement l'une des deux.
        function updateTalentsPaginationControls() {
            const controls = document.getElementById('paginationControls');
            const totalPages = Math.max(1, Math.ceil(TalentsPage.totalCount / PAGE_SIZE));

            if (TalentsPage.totalCount === 0) {
                controls.classList.add('hidden');
                return;
            }
            controls.classList.remove('hidden');

            document.getElementById('paginationLabel').textContent = `Page ${TalentsPage.currentPage + 1} sur ${totalPages}`;
            document.getElementById('prevPageBtn').disabled = TalentsPage.currentPage === 0;
            document.getElementById('nextPageBtn').disabled = TalentsPage.currentPage >= totalPages - 1;
        }

        document.getElementById('prevPageBtn').addEventListener('click', () => {
            if (TalentsPage.currentPage > 0) {
                TalentsPage.currentPage -= 1;
                loadTalents();
            }
        });

        document.getElementById('nextPageBtn').addEventListener('click', () => {
            const totalPages = Math.max(1, Math.ceil(TalentsPage.totalCount / PAGE_SIZE));
            if (TalentsPage.currentPage < totalPages - 1) {
                TalentsPage.currentPage += 1;
                loadTalents();
            }
        });

        // Ajoute le lot suivant à la liste déjà affichée (append = true), sans tout
        // reconstruire.
        document.getElementById('talentsShowMoreBtn')?.addEventListener('click', () => {
            renderTalents(TalentsPage.currentFilteredTalents, true);
        });

        function statusBadge(status) {
            const map = {
                'En poste ALIMA': 'bg-emerald-50 text-emerald-700 border-emerald-200',
                'En attente de poste': 'bg-blue-50 text-blue-700 border-blue-200',
                'En poste autre ONG': 'bg-amber-50 text-amber-700 border-amber-200',
                'En poste hors humanitaire': 'bg-slate-100 text-slate-500 border-slate-200'
            };
            return map[status] || 'bg-slate-100 text-slate-500 border-slate-200';
        }

        // Un seul élément DOM réutilisé et repositionné à chaque survol. #talentHoverCard
        // est placé dans le HTML après la balise <script> : une capture au chargement
        // (const = ...) retournerait toujours null, d'où cette récupération à la demande.
        function getHoverCardEl() {
            return document.getElementById('talentHoverCard');
        }

        function showHoverCard(t, targetEl) {
            document.getElementById('hoverCardName').textContent = `${t.first_name || ''} ${t.last_name || ''}`.trim() || '—';
            document.getElementById('hoverCardFunction').textContent = t.current_function || '—';
            document.getElementById('hoverCardStatus').textContent = t.status || '—';
            document.getElementById('hoverCardAvailability').textContent = formatAvailabilityLabel(t);
            document.getElementById('hoverCardExpAlima').textContent = `${t.experience_months_alima || 0} mois`;
            document.getElementById('hoverCardExpHum').textContent = `${t.experience_months_humanitarian || 0} mois`;

            const rect = targetEl.getBoundingClientRect();
            const cardWidth = 288; // correspond à w-72
            let left = rect.left;
            if (left + cardWidth > window.innerWidth - 8) {
                left = window.innerWidth - cardWidth - 8;
            }
            const talentHoverCard = getHoverCardEl();
            talentHoverCard.style.left = Math.max(8, left) + 'px';
            talentHoverCard.style.top = (rect.bottom + 6) + 'px';
            talentHoverCard.classList.remove('hidden');
        }

        function hideHoverCard() {
            getHoverCardEl().classList.add('hidden');
        }

        // Sinon la carte resterait affichée au-dessus d'une ligne qui n'est plus la bonne.
        document.querySelector('main').addEventListener('scroll', hideHoverCard);
        window.addEventListener('resize', hideHoverCard);

        function renderTalents(talents, append = false) {
            const listEl = document.getElementById('talentsList');
            const emptyEl = document.getElementById('emptyState');

            if (!append) {
                listEl.innerHTML = '';
                TalentsPage.renderedTalentsCount = 0;
            }

            if (!talents.length) {
                emptyEl.classList.remove('hidden');
                updateShowMoreControls(talents);
                return;
            }
            emptyEl.classList.add('hidden');

            // Seul le prochain lot (RENDER_BATCH_SIZE éléments) est construit ici, pas
            // tout le tableau — le reste attend un clic sur "Afficher plus".
            const batch = talents.slice(TalentsPage.renderedTalentsCount, TalentsPage.renderedTalentsCount + RENDER_BATCH_SIZE);

            // DocumentFragment plutôt qu'un appendChild par ligne. Les écouteurs par
            // ligne restent posés sur chaque `row` avant son ajout au fragment —
            // inutile que l'élément soit déjà dans le DOM pour ça.
            const fragment = document.createDocumentFragment();

            batch.forEach(t => {
                const row = document.createElement('div');
                const eligible = TalentsPage.isDevalidationEligible(t);
                const isDevalidated = t.is_valid === false;
                // idKey déjà propre (UUID Postgres), encodé par précaution.
                const idKey = t.id || t._id;

                row.className = "bg-white border rounded-2xl p-4 flex items-start justify-between gap-4 hover:shadow-sm transition-all " +
                    (eligible ? "border-red-300 bg-red-50" : "border-slate-200");

                let extraBadge = '';
                if (isDevalidated) {
                    extraBadge = '<span class="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-200 text-slate-600">⛔ Dévalidé</span>';
                } else if (eligible) {
                    extraBadge = '<span class="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">⚠️ À arbitrer</span>';
                } else if (TalentsPage.hasActiveExtension(t)) {
                    const untilLabel = new Date(t.devalidation_extension_until).toLocaleDateString('fr-FR');
                    extraBadge = `<span class="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">⏳ Prolongé jusqu'au ${untilLabel}</span>`;
                }

                // Confort d'affichage : la vraie barrière est la policy RLS côté Postgres.
                const canManage = TalentsPage.currentUserRole !== 'visitor';

                row.innerHTML = `
                    <div class="flex items-start gap-3 min-w-0 flex-1">
                        <div class="h-10 w-10 rounded-full bg-primary-light text-primary font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                            ${escapeHtml((t.first_name || '?')[0])}${escapeHtml((t.last_name || '?')[0])}
                        </div>
                        <div class="min-w-0 flex-1">
                            <!-- Lien réel (pas un onclick), natif au clavier. -->
                            <a href="id-card.html?id=${encodeURIComponent(idKey)}" class="talent-name-hover block font-bold text-slate-800 hover:text-primary hover:underline truncate">
                                ${escapeHtml(t.first_name || '')} ${escapeHtml(t.last_name || '')} ${t.is_red_listed ? '🚩' : ''}
                            </a>
                            <p class="text-xs text-slate-500 truncate mt-0.5">
                                <span class="font-semibold text-slate-500">Fonction :</span> ${escapeHtml(t.current_function || '—')}
                                <span class="mx-1.5 text-slate-300">·</span>
                                <span class="font-semibold text-slate-500">Exp. ALIMA :</span> ${t.experience_months_alima || 0} mois
                                <span class="mx-1.5 text-slate-300">·</span>
                                <span class="font-semibold text-slate-500">Disponible :</span> ${escapeHtml(formatAvailabilityLabel(t))}
                            </p>
                            ${TalentsPage.renderInlineValidityBar(t)}
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        ${extraBadge}
                        <span class="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border ${statusBadge(t.status)}">${escapeHtml(t.status || '—')}</span>

                        ${(eligible && canManage) ? `
                        <button class="btn-prolong-talent text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all" title="Prolonger">
                            ⏳ Prolonger
                        </button>
                        <button class="btn-devalidate-talent text-xs font-semibold text-red-700 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg transition-all" title="Dévalider">
                            ⛔ Dévalider
                        </button>` : ''}

                        ${canManage ? `
                        <button class="edit-btn p-2 hover:bg-slate-100 rounded-xl text-slate-500 hover:text-primary transition-all" title="Modifier">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                            </svg>
                        </button>` : ''}
                    </div>
                `;

                // Au survol ou au focus clavier du nom, sans ouvrir la fiche.
                const nameEl = row.querySelector('.talent-name-hover');
                if (nameEl) {
                    nameEl.addEventListener('mouseenter', () => showHoverCard(t, nameEl));
                    nameEl.addEventListener('mouseleave', hideHoverCard);
                    nameEl.addEventListener('focus', () => showHoverCard(t, nameEl));
                    nameEl.addEventListener('blur', hideHoverCard);
                }

                // Seul le nom (lien ci-dessus) est aussi cliquable sur la ligne, donc
                // pas besoin de e.stopPropagation() ici.
                const editBtn = row.querySelector('.edit-btn');
                if (editBtn) {
                    editBtn.addEventListener('click', () => {
                        TalentsPage.openEditModal(t);
                    });
                }

                if (eligible && canManage) {
                    row.querySelector('.btn-prolong-talent').addEventListener('click', () => {
                        TalentsPage.openProlongModal(t);
                    });
                    row.querySelector('.btn-devalidate-talent').addEventListener('click', () => {
                        TalentsPage.devalidateTalentFromList(t);
                    });
                }

                fragment.appendChild(row);
            });

            listEl.appendChild(fragment);

            TalentsPage.renderedTalentsCount += batch.length;
            updateShowMoreControls(talents);
        }

        function updateShowMoreControls(talents) {
            const showMoreBtn = document.getElementById('talentsShowMoreBtn');
            const countLabel = document.getElementById('talentsRenderedCountLabel');
            if (!showMoreBtn || !countLabel) return;

            if (!talents.length) {
                showMoreBtn.classList.add('hidden');
                countLabel.classList.add('hidden');
                return;
            }

            countLabel.classList.remove('hidden');
            const shown = Math.min(TalentsPage.renderedTalentsCount, talents.length);
            countLabel.textContent = `${shown} sur ${talents.length} affiché${talents.length > 1 ? 's' : ''}`;

            showMoreBtn.classList.toggle('hidden', TalentsPage.renderedTalentsCount >= talents.length);
        }

        // Filtrage (filterTalents) et tri (sortTalents) appliqués en mémoire sur
        // TalentsPage.allTalents (déjà chargé pour ce pool), pas de nouvelle requête réseau.
        TalentsPage.searchFilters = {
            searchQuery: '',
            keywordFilter: '',
            statusFilter: '',
            validityFilter: 'active',
            sortBy: 'integration',
            sortOrder: 'desc',
            minExpAlima: '',
            minExpHumanitarian: '',
            availableFrom: '',
            availableTo: '',
            nationalityFilter: '',
            countryFilter: '',
            languagesFilter: '',
            hasVisaFilter: '',
            hasMissionOpeningFilter: '',
            hasEmergencyMissionFilter: '',
            hasMissionClosureFilter: '',
            interventionContextFilter: '',
            interventionZoneFilter: ''
        };
        const defaultSearchFilters = { ...TalentsPage.searchFilters };

        // À partir de availability_type ('none' | 'asap' | 'notice' | 'date').
        function getAvailabilityTimestamp(t) {
            const type = t.availability_type;
            if (type === 'date' && t.availability_date) {
                return new Date(t.availability_date).getTime();
            }
            if (type === 'notice' && t.availability_months) {
                return Date.now() + Number(t.availability_months) * 30 * 24 * 60 * 60 * 1000;
            }
            if (type === 'asap') {
                return Date.now();
            }
            return null;
        }

        // Compatible ancien format camelCase/epoch et nouveau format snake_case
        // (même logique que normalizePassageComment sur id-card.html).
        function keywordMatches(t, kw) {
            const skills = t.key_skills || [];
            if (skills.some(s => String(s).toLowerCase().includes(kw))) return true;

            // Un recruteur qui décrit cette expérience en texte libre sans cocher la
            // case correspondante reste ainsi visible à la recherche.
            const freeTextFields = [
                t.mission_opening_comments,
                t.emergency_mission_comments,
                t.closure_mission_comments
            ];
            if (freeTextFields.some(v => String(v || '').toLowerCase().includes(kw))) return true;

            const passages = t.archived_position_passages || [];
            return passages.some(p => {
                const comments = p.comments || [];
                return comments.some(c => {
                    const context = c.context || '';
                    const positive = c.positive_points || c.positivePoints || '';
                    const negative = c.negative_points || c.negativePoints || '';
                    const legacy = c.content || '';
                    return [context, positive, negative, legacy].some(v => String(v).toLowerCase().includes(kw));
                });
            });
        }

        function filterTalents(talents, f) {
            let filtered = [...talents];

            if (f.searchQuery) {
                const q = f.searchQuery.toLowerCase();
                filtered = filtered.filter(t =>
                    `${t.first_name || ''} ${t.last_name || ''}`.toLowerCase().includes(q) ||
                    (t.email || '').toLowerCase().includes(q) ||
                    (t.current_function || '').toLowerCase().includes(q)
                );
            }

            if (f.keywordFilter) {
                const kw = f.keywordFilter.toLowerCase();
                filtered = filtered.filter(t => keywordMatches(t, kw));
            }

            if (f.statusFilter) {
                filtered = filtered.filter(t => t.status === f.statusFilter);
            }

            // 'active' masque dévalidés ET Liste Rouge (les deux restent en base pour
            // faciliter leur suivi). 'devalidated' isole les dévalidés (Liste Rouge ou
            // non). '' (Tous) désactive le filtre.
            if (f.validityFilter === 'active') {
                filtered = filtered.filter(t => t.is_valid !== false && !t.is_red_listed);
            } else if (f.validityFilter === 'devalidated') {
                filtered = filtered.filter(t => t.is_valid === false);
            }

            if (f.minExpAlima) {
                const min = parseInt(f.minExpAlima, 10);
                if (!isNaN(min)) filtered = filtered.filter(t => (t.experience_months_alima || 0) >= min);
            }

            if (f.minExpHumanitarian) {
                const min = parseInt(f.minExpHumanitarian, 10);
                if (!isNaN(min)) filtered = filtered.filter(t => (t.experience_months_humanitarian || 0) >= min);
            }

            if (f.availableFrom) {
                const fromTs = new Date(f.availableFrom).getTime();
                filtered = filtered.filter(t => {
                    const ts = getAvailabilityTimestamp(t);
                    return ts !== null && ts >= fromTs;
                });
            }

            if (f.availableTo) {
                const toTs = new Date(f.availableTo).getTime();
                filtered = filtered.filter(t => {
                    const ts = getAvailabilityTimestamp(t);
                    return ts !== null && ts <= toTs;
                });
            }

            if (f.nationalityFilter) {
                const q = f.nationalityFilter.toLowerCase();
                filtered = filtered.filter(t => (t.nationality || '').toLowerCase().includes(q));
            }

            if (f.countryFilter) {
                const q = f.countryFilter.toLowerCase();
                filtered = filtered.filter(t => (t.country_of_residence || '').toLowerCase().includes(q));
            }

            if (f.languagesFilter) {
                const q = f.languagesFilter.toLowerCase();
                filtered = filtered.filter(t => {
                    const langs = Array.isArray(t.languages) ? t.languages : (t.languages ? [t.languages] : []);
                    return langs.some(l => String(l).toLowerCase().includes(q));
                });
            }

            if (f.hasVisaFilter) {
                const want = f.hasVisaFilter === 'oui';
                filtered = filtered.filter(t => !!t.has_visa === want);
            }

            if (f.hasMissionOpeningFilter) {
                const want = f.hasMissionOpeningFilter === 'oui';
                filtered = filtered.filter(t => !!t.has_mission_opening === want);
            }

            if (f.hasEmergencyMissionFilter) {
                const want = f.hasEmergencyMissionFilter === 'oui';
                filtered = filtered.filter(t => !!t.has_emergency_mission === want);
            }

            if (f.hasMissionClosureFilter) {
                const want = f.hasMissionClosureFilter === 'oui';
                filtered = filtered.filter(t => !!t.has_mission_closure === want);
            }

            if (f.interventionContextFilter) {
                const q = f.interventionContextFilter.toLowerCase();
                filtered = filtered.filter(t => (t.intervention_contexts || []).some(c => String(c).toLowerCase().includes(q)));
            }

            if (f.interventionZoneFilter) {
                const q = f.interventionZoneFilter.toLowerCase();
                filtered = filtered.filter(t => (t.intervention_zones || []).some(z => String(z).toLowerCase().includes(q)));
            }

            return filtered;
        }

        function sortTalents(talents, f) {
            talents.sort((a, b) => {
                let cmp = 0;
                switch (f.sortBy) {
                    case 'name': {
                        const nameA = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
                        const nameB = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase();
                        cmp = nameA.localeCompare(nameB);
                        break;
                    }
                    case 'availability': {
                        const tsA = getAvailabilityTimestamp(a);
                        const tsB = getAvailabilityTimestamp(b);
                        cmp = (tsA === null ? Infinity : tsA) - (tsB === null ? Infinity : tsB);
                        break;
                    }
                    case 'expAlima':
                        cmp = (a.experience_months_alima || 0) - (b.experience_months_alima || 0);
                        break;
                    case 'expHumanitarian':
                        cmp = (a.experience_months_humanitarian || 0) - (b.experience_months_humanitarian || 0);
                        break;
                    case 'integration':
                    default: {
                        const dA = a.pool_integration_date ? new Date(a.pool_integration_date).getTime() : 0;
                        const dB = b.pool_integration_date ? new Date(b.pool_integration_date).getTime() : 0;
                        cmp = dA - dB;
                        break;
                    }
                }
                return f.sortOrder === 'asc' ? cmp : -cmp;
            });

            return talents;
        }

        function filterAndSortTalents(talents, f) {
            return sortTalents(filterTalents(talents, f), f);
        }

        TalentsPage.currentFilteredTalents = [];

        function applyFiltersAndRender() {
            TalentsPage.currentFilteredTalents = filterAndSortTalents(TalentsPage.allTalents, TalentsPage.searchFilters);
            renderTalents(TalentsPage.currentFilteredTalents);
            document.getElementById('paginationControls').classList.add('hidden');
            updateSearchSummary();
            updateResetButtonVisibility();
        }

        function updateSearchSummary() {
            const summary = document.getElementById('searchResultsSummary');
            if (TalentsPage.isFullListMode) {
                if (TalentsPage.currentFilteredTalents.length === TalentsPage.allTalents.length) {
                    summary.textContent = `${TalentsPage.allTalents.length} talent${TalentsPage.allTalents.length > 1 ? 's' : ''} au total`;
                } else {
                    summary.textContent = `${TalentsPage.currentFilteredTalents.length} talent${TalentsPage.currentFilteredTalents.length > 1 ? 's' : ''} trouvé${TalentsPage.currentFilteredTalents.length > 1 ? 's' : ''} sur ${TalentsPage.allTalents.length} au total`;
                }
            } else {
                summary.textContent = `${TalentsPage.totalCount} talent${TalentsPage.totalCount > 1 ? 's' : ''} au total`;
            }
        }

        function updateResetButtonVisibility() {
            const hasAnyFilter = JSON.stringify(TalentsPage.searchFilters) !== JSON.stringify(defaultSearchFilters);
            document.getElementById('resetFiltersBtn').classList.toggle('hidden', !hasAnyFilter);
        }

        // Repart de la page 1 ; loadTalents() décide lui-même du mode (paginé ou
        // liste complète) à appliquer.
        function onFiltersChanged() {
            TalentsPage.currentPage = 0;
            loadTalents();
        }

        document.getElementById('searchInput').addEventListener('input', e => {
            TalentsPage.searchFilters.searchQuery = e.target.value.trim();
            onFiltersChanged();
        });

        document.getElementById('toggleAdvancedBtn').addEventListener('click', () => {
            document.getElementById('advancedFiltersPanel').classList.toggle('hidden');
        });

        document.getElementById('resetFiltersBtn').addEventListener('click', () => {
            Object.assign(TalentsPage.searchFilters, defaultSearchFilters);
            document.getElementById('searchInput').value = '';
            document.getElementById('filterStatus').value = '';
            document.getElementById('filterValidity').value = 'active';
            document.getElementById('filterSortBy').value = 'integration';
            document.getElementById('filterSortOrder').value = 'desc';
            document.getElementById('filterKeyword').value = '';
            document.getElementById('filterMinExpAlima').value = '';
            document.getElementById('filterMinExpHum').value = '';
            document.getElementById('filterAvailFrom').value = '';
            document.getElementById('filterAvailTo').value = '';
            document.getElementById('filterNationality').value = '';
            document.getElementById('filterCountry').value = '';
            document.getElementById('filterLanguage').value = '';
            document.getElementById('filterVisa').value = '';
            document.getElementById('filterMissionOpening').value = '';
            document.getElementById('filterEmergencyMission').value = '';
            document.getElementById('filterContext').value = '';
            document.getElementById('filterZone').value = '';
            onFiltersChanged();
        });

        const filterFieldBindings = [
            ['filterStatus', 'statusFilter'], ['filterValidity', 'validityFilter'], ['filterSortBy', 'sortBy'], ['filterSortOrder', 'sortOrder'],
            ['filterKeyword', 'keywordFilter'], ['filterMinExpAlima', 'minExpAlima'], ['filterMinExpHum', 'minExpHumanitarian'],
            ['filterAvailFrom', 'availableFrom'], ['filterAvailTo', 'availableTo'], ['filterNationality', 'nationalityFilter'],
            ['filterCountry', 'countryFilter'], ['filterLanguage', 'languagesFilter'], ['filterVisa', 'hasVisaFilter'],
            ['filterMissionOpening', 'hasMissionOpeningFilter'], ['filterEmergencyMission', 'hasEmergencyMissionFilter'],
            ['filterMissionClosure', 'hasMissionClosureFilter'],
            ['filterContext', 'interventionContextFilter'], ['filterZone', 'interventionZoneFilter']
        ];
        filterFieldBindings.forEach(([elId, filterKey]) => {
            const el = document.getElementById(elId);
            const evt = (el.tagName === 'SELECT') ? 'change' : 'input';
            el.addEventListener(evt, e => {
                TalentsPage.searchFilters[filterKey] = e.target.value;
                onFiltersChanged();
            });
        });

        const MISSION_COUNT_LABELS_XLS = { none: "0", one: "1", two: "2", three_plus: "3+" };

        function formatAvailabilityLabel(t) {
            const type = t.availability_type;
            if (!type || type === 'none') return "Néant (pas de visibilité)";
            if (type === 'notice') return `Avec préavis (${t.availability_months || '?'} mois)`;
            if (type === 'asap') return "ASAP (immédiatement)";
            if (type === 'date' && t.availability_date) return new Date(t.availability_date).toLocaleDateString('fr-FR');
            return "Non définie";
        }

        document.getElementById('exportPoolExcelBtn').addEventListener('click', async () => {
            // Chargée à la demande : la bibliothèque ne sert qu'à ce bouton, inutile
            // de la charger à chaque visite. capHumaLoadScriptOnce() dédoublonne les
            // clics rapprochés.
            try {
                await capHumaLoadScriptOnce('shared/vendor/xlsx-0.18.5.js');
            } catch (err) {
                alert("Impossible de charger le module d'export Excel (vérifiez la connexion réseau) et réessayez.");
                return;
            }

            // En mode paginé, TalentsPage.currentFilteredTalents ne contient que la page
            // affichée — on récupère toujours l'intégralité du pool filtré avant
            // d'exporter, pour ne jamais produire un fichier tronqué silencieusement.
            let rowsToExport;
            if (TalentsPage.isFullListMode) {
                rowsToExport = TalentsPage.currentFilteredTalents;
            } else {
                try {
                    const sortColumnMap = {
                        name: 'last_name',
                        integration: 'pool_integration_date',
                        expAlima: 'experience_months_alima',
                        expHumanitarian: 'experience_months_humanitarian'
                    };
                    const sortColumn = sortColumnMap[TalentsPage.searchFilters.sortBy] || 'pool_integration_date';
                    const ascending = TalentsPage.searchFilters.sortOrder === 'asc';
                    const { data, error } = await capHumaWithRetry(() => {
                        // Resserré à la liste exacte des colonnes lues par le mapping
                        // d'export (rows.map) et formatAvailabilityLabel() — sûr ici,
                        // contrairement aux deux select('*') de fetchAllTalents/
                        // fetchPagedTalents : ces lignes ne servent qu'au mapping Excel,
                        // jamais à TalentsPage.openEditModal() qui a besoin de la ligne
                        // complète via Object.keys(talent).
                        let query = TalentsPage.supabaseClient.from('talents').select('first_name, last_name, gender, email, nationality, pool, last_mission_end_date, experience_months_alima, experience_months_humanitarian, pool_integration_date, availability_type, availability_months, availability_date, has_emergency_mission, emergency_mission_comments, has_mission_opening, mission_opening_comments, intervention_contexts, intervention_zones, number_of_alima_missions, has_visa').order(sortColumn, { ascending });
                        if (TalentsPage.currentPoolId) query = query.eq('pool', TalentsPage.currentPoolId);
                        if (TalentsPage.searchFilters.statusFilter) query = query.eq('status', TalentsPage.searchFilters.statusFilter);
                        return query;
                    });
                    if (error) throw error;
                    rowsToExport = data || [];
                } catch (err) {
                    alert("Erreur lors de la récupération des données à exporter : " + (err.message || 'erreur inconnue'));
                    return;
                }
            }

            if (!rowsToExport.length) {
                alert("Aucun talent à exporter avec les filtres actuels.");
                return;
            }
            try {
                const rows = rowsToExport.map(t => {
                    const contexts = (t.intervention_contexts || []).join(', ');
                    const zones = (t.intervention_zones || []).join(', ');
                    const typesProjet = [contexts, zones].filter(Boolean).join(' | ') || 'N/A';

                    return {
                        'Prénom(s) et Nom': `${t.first_name || ''} ${t.last_name || ''}`.trim(),
                        'Genre': t.gender === 'H' ? 'Homme' : t.gender === 'F' ? 'Femme' : 'N/A',
                        'Adresse mail': t.email || 'N/A',
                        'Nationalité': t.nationality || 'N/A',
                        'Pool': t.pool || '',
                        'Date fin dernière mission ALIMA': t.last_mission_end_date ? new Date(t.last_mission_end_date).toLocaleDateString('fr-FR') : 'N/A',
                        'Expérience ALIMA (mois)': t.experience_months_alima || 0,
                        'Expérience humanitaire (mois)': t.experience_months_humanitarian || 0,
                        "Date d'entrée dans le pool": t.pool_integration_date ? new Date(t.pool_integration_date).toLocaleDateString('fr-FR') : 'N/A',
                        'Prochaine disponibilité': formatAvailabilityLabel(t),
                        "Missions d'urgence": t.has_emergency_mission ? 'Oui' : 'Non',
                        'Commentaire urgence': t.has_emergency_mission ? (t.emergency_mission_comments || '') : '',
                        'Ouvertures de mission/projet': t.has_mission_opening ? 'Oui' : 'Non',
                        'Commentaire ouvertures': t.has_mission_opening ? (t.mission_opening_comments || '') : '',
                        'Types de projets (contextes & zones)': typesProjet,
                        'Nombre de missions ALIMA': MISSION_COUNT_LABELS_XLS[t.number_of_alima_missions] || 'N/A',
                        'Visa Schengen': t.has_visa ? 'Oui' : 'Non'
                    };
                });

                const ws = XLSX.utils.json_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                const sheetName = `Talents ${TalentsPage.currentPoolId || 'pool'}`.substring(0, 31);
                XLSX.utils.book_append_sheet(wb, ws, sheetName);

                const today = new Date().toISOString().slice(0, 10);
                const fileSlug = (TalentsPage.currentPoolId || 'pool').toLowerCase();
                XLSX.writeFile(wb, `talents-${fileSlug}-${today}.xlsx`);

                // Traçabilité RGPD des exports. rowsToExport.length reflète le nombre
                // réel de lignes exportées, filtres compris.
                await logAuditAction('export', 'talent', null, `Pool ${TalentsPage.currentPoolId || '—'}`,
                    `${rowsToExport.length} talent(s) exporté(s)`);
            } catch (err) {
                console.error(err);
                alert("Erreur lors de l'export : " + (err && err.message ? err.message : 'erreur inconnue.'));
            }
        });

        // Exposé sur TalentsPage pour appel depuis l'autre fichier de la page
        TalentsPage.loadTalents = loadTalents;
})();
