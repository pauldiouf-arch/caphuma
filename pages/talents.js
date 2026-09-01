        // ============================================================================
        // HEADER COMMUN (B4, Master Context §7) — injecté avant toute autre chose, y
        // compris avant checkSession() plus bas qui référence #newTalentBtn (masqué
        // pour le rôle visitor) et écrit dans #poolSubtitle une fois le pool chargé.
        // ============================================================================
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

        // ============================================================================
        // 1. INIT SUPABASE + GARDE DE SESSION
        // ============================================================================
        // SUPABASE_URL / SUPABASE_ANON_KEY viennent désormais de shared/caphuma-config.js
        // (chargé dans le head) — remplace l'ancien pont localStorage (MC13 Addendum U3).
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) window.location.replace('index.html');

        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const urlParams = new URLSearchParams(window.location.search);
        const currentPoolId = urlParams.get('pool');

        // Échappement HTML systématique de toute donnée venant de la base
        // avant injection via innerHTML — prévention XSS (audit sécurité).

        const appBody = document.getElementById('appBody');
        const talentForm = document.getElementById('talentForm');
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserRole = null;
        let currentUserName = null;

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

        async function checkSession() {
            try {
                const s = await capHumaInitSession(supabaseClient);
                currentUserId = s.userId;
                currentUserEmail = s.email;
                currentUserName = s.name;
                currentUserRole = s.role;

                document.getElementById('user-display-name').textContent = currentUserEmail;
                document.getElementById('newTalentBtn').classList.toggle('hidden', currentUserRole === 'visitor');

                appBody.style.display = '';
                await loadPoolInfo();
                await loadTalents();
            } catch (err) {
                console.warn("[Session Guard]", err.message);
                window.location.replace('login.html');
            }
        }
        checkSession();
        capHumaInitModalA11y(); // P15 (B18-A3) — voir shared/caphuma-utils.js

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            await supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });

        // ============================================================================
        // 2. INFO POOL (titre de page)
        // ============================================================================
        async function loadPoolInfo() {
            const subtitle = document.getElementById('poolSubtitle');
            if (!currentPoolId) { subtitle.textContent = 'Tous les pools'; return; }
            try {
                const { data } = await capHumaWithRetry(() =>
                    supabaseClient.from('pools').select('name, full_name').eq('pool_id', currentPoolId)
                );
                if (data && data.length > 0) {
                    subtitle.textContent = `${data[0].full_name || data[0].name} (${currentPoolId})`;
                } else {
                    subtitle.textContent = currentPoolId;
                }
            } catch (e) { subtitle.textContent = currentPoolId; }
            document.getElementById('modalPoolBadge').textContent = currentPoolId || '—';
        }

        // ============================================================================
        // 3. CHARGEMENT + RENDU DE LA LISTE (Étape D, Option A — pagination réelle)
        // ============================================================================
        // Deux modes, choisis à chaque appel de loadTalents() selon les filtres actifs :
        //   - Mode PAGINÉ (par défaut) : une seule page de PAGE_SIZE talents est demandée
        //     à Supabase (.range()), filtrée/triée côté serveur (statut + tri simple
        //     uniquement). C'est le mode normal de navigation.
        //   - Mode LISTE COMPLÈTE : dès qu'une recherche par mot-clé ou un filtre avancé
        //     est actif (voir computeIsFullListMode), on revient au comportement d'avant
        //     cette étape — tout le pool est chargé une fois (mis en cache dans
        //     allTalents) puis filtré/trié entièrement côté client. Nécessaire car la
        //     recherche par mot-clé fouille aussi l'historique de missions archivées,
        //     ce qui ne se traduit pas simplement en requête Supabase paginée.
        // ============================================================================
        let allTalents = null; // null = pas encore chargé (chargement paresseux, seulement si le mode liste complète est activé)
        const PAGE_SIZE = 20;
        let currentPage = 0;
        let totalCount = 0;
        let isFullListMode = false;

        // Correctif P7 (B17-L1, 27/08/2026, décision utilisateur) : affichage
        // progressif en mode "liste complète" (recherche/filtre avancé), pour
        // éviter de créer d'un coup plusieurs centaines de nœuds DOM sur un
        // pool qui grossirait beaucoup. Sans effet en mode paginé normal
        // (PAGE_SIZE = 20, déjà petit) — voir renderTalents() plus bas.
        const RENDER_BATCH_SIZE = 25;
        let renderedTalentsCount = 0;

        function computeIsFullListMode() {
            const f = searchFilters;
            if (f.searchQuery) return true;
            if (f.keywordFilter) return true;
            // Le tri "Disponibilité" est calculé à partir de 3 colonnes combinées
            // (availability_type/availability_date/availability_months) — pas
            // traduisible en un simple .order() Supabase, donc liste complète.
            if (f.sortBy === 'availability') return true;
            if (f.minExpAlima || f.minExpHumanitarian) return true;
            if (f.availableFrom || f.availableTo) return true;
            if (f.nationalityFilter || f.countryFilter || f.languagesFilter) return true;
            if (f.hasVisaFilter || f.hasMissionOpeningFilter || f.hasEmergencyMissionFilter) return true;
            if (f.interventionContextFilter || f.interventionZoneFilter) return true;
            return false;
        }

        async function loadTalents() {
            isFullListMode = computeIsFullListMode();

            if (isFullListMode) {
                document.getElementById('paginationControls').classList.add('hidden');
                if (allTalents === null) {
                    await fetchAllTalents();
                }
                applyFiltersAndRender();
            } else {
                await fetchPagedTalents();
            }
        }

        // Chargement complet (une seule fois, mis en cache) — comportement identique
        // à celui d'avant l'Étape D, utilisé uniquement en mode liste complète.
        async function fetchAllTalents() {
            const listEl = document.getElementById('talentsList');
            const errorEl = document.getElementById('listError');
            try {
                // capHumaWithRetry() (P19) : la construction de la requête est déplacée
                // À L'INTÉRIEUR de la fonction passée en paramètre, pour qu'un retry
                // reconstruise un query builder tout neuf (avec les mêmes filtres)
                // plutôt que de réutiliser un objet déjà attendu une 1re fois.
                const { data, error } = await capHumaWithRetry(() => {
                    let query = supabaseClient.from('talents').select('*').order('last_name', { ascending: true });
                    if (currentPoolId) query = query.eq('pool', currentPoolId);
                    return query;
                });
                if (error) throw error;
                allTalents = data || [];
            } catch (err) {
                console.error(err);
                listEl.innerHTML = '';
                errorEl.textContent = "Impossible de charger les talents : " + err.message;
                errorEl.classList.remove('hidden');
                allTalents = [];
            }
        }

        // Chargement paginé côté requête (Étape D, Option A) — ne demande à Supabase
        // que les PAGE_SIZE lignes de la page courante, filtrées par statut et triées
        // côté serveur si ces filtres simples sont actifs.
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
                const sortColumn = sortColumnMap[searchFilters.sortBy] || 'pool_integration_date';
                const ascending = searchFilters.sortOrder === 'asc';

                const from = currentPage * PAGE_SIZE;
                const to = from + PAGE_SIZE - 1;

                // capHumaWithRetry() (P19) : même principe que fetchAllTalents() plus
                // haut — la requête entière (avec tous ses filtres conditionnels) est
                // reconstruite à chaque tentative.
                const { data, error, count } = await capHumaWithRetry(() => {
                    let query = supabaseClient
                        .from('talents')
                        .select('*', { count: 'exact' })
                        .order(sortColumn, { ascending })
                        .range(from, to);

                    if (currentPoolId) query = query.eq('pool', currentPoolId);
                    if (searchFilters.statusFilter) query = query.eq('status', searchFilters.statusFilter);

                    // Filtre "Validité" (ajouté le 18/08/2026, corrigé le même jour) : doit
                    // être répété ici, côté serveur, car ce mode paginé est celui utilisé
                    // par défaut (pas de recherche/filtre avancé actif) — le filtrage fait
                    // dans filterAndSortTalents() ne s'applique, lui, qu'au mode "liste
                    // complète". Tolère NULL comme le fait le filtre client (is_valid/
                    // is_red_listed ont un défaut mais une ancienne ligne pourrait ne pas
                    // l'avoir) : "actif" = is_valid pas explicitement false ET is_red_listed
                    // pas explicitement true.
                    if (searchFilters.validityFilter === 'active') {
                        query = query.or('is_valid.is.null,is_valid.eq.true')
                                     .or('is_red_listed.is.null,is_red_listed.eq.false');
                    } else if (searchFilters.validityFilter === 'devalidated') {
                        query = query.eq('is_valid', false);
                    }

                    return query;
                });
                if (error) throw error;

                totalCount = count || 0;
                currentFilteredTalents = data || [];
                renderTalents(currentFilteredTalents);
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

        // Renommée depuis renderPaginationControls() — ce nom collidait silencieusement
        // avec la fonction partagée du même nom dans shared/caphuma-utils.js (signature
        // différente : celle-ci lit totalCount/PAGE_SIZE/currentPage en globals de page
        // et pilote des boutons statiques prevPageBtn/nextPageBtn, la version partagée
        // prend 5 paramètres et génère du HTML avec onclick). Aucun bug de comportement
        // (la déclaration de cette page écrasait silencieusement la version partagée,
        // jamais utilisée ici), mais un piège si quelqu'un modifie un jour la version
        // partagée en pensant qu'elle s'applique aussi ici. Même correctif que
        // audit_logs.js, trouvé via ESLint (no-redeclare) le 25/08/2026.
        function updateTalentsPaginationControls() {
            const controls = document.getElementById('paginationControls');
            const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

            if (totalCount === 0) {
                controls.classList.add('hidden');
                return;
            }
            controls.classList.remove('hidden');

            document.getElementById('paginationLabel').textContent = `Page ${currentPage + 1} sur ${totalPages}`;
            document.getElementById('prevPageBtn').disabled = currentPage === 0;
            document.getElementById('nextPageBtn').disabled = currentPage >= totalPages - 1;
        }

        document.getElementById('prevPageBtn').addEventListener('click', () => {
            if (currentPage > 0) {
                currentPage -= 1;
                loadTalents();
            }
        });

        document.getElementById('nextPageBtn').addEventListener('click', () => {
            const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
            if (currentPage < totalPages - 1) {
                currentPage += 1;
                loadTalents();
            }
        });

        // Correctif P7 : "Afficher plus" ajoute le lot suivant à la liste déjà
        // affichée (append = true), sans tout reconstruire — s'appuie sur
        // currentFilteredTalents, le tableau déjà en mémoire pour le mode
        // "liste complète" (recherche/filtre avancé).
        document.getElementById('talentsShowMoreBtn')?.addEventListener('click', () => {
            renderTalents(currentFilteredTalents, true);
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

        // ============================================================================
        // HOVER CARD (Étape D) — aperçu rapide au survol du nom : fonction, statut,
        // disponibilité, expérience ALIMA/humanitaire. Un seul élément DOM réutilisé
        // et repositionné à chaque survol (voir formatAvailabilityLabel plus bas,
        // function déclarée donc "hoisted" — utilisable ici malgré l'ordre du fichier).
        // ============================================================================
        // Correctif (19/08/2026) : la div #talentHoverCard est placée dans le HTML
        // APRÈS la balise <script>, donc une capture au chargement (const = ...)
        // retournait toujours null (le parseur n'avait pas encore atteint cette div
        // au moment de l'exécution de cette ligne). Récupération à la demande à la
        // place — inoffensif en performance (un seul élément, recherché seulement
        // au survol/à la sortie, pas dans une boucle).
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

        // La carte doit disparaître si la liste défile ou si la fenêtre est redimensionnée,
        // sinon elle resterait affichée au-dessus d'une ligne qui n'est plus la bonne.
        document.querySelector('main').addEventListener('scroll', hideHoverCard);
        window.addEventListener('resize', hideHoverCard);

        function renderTalents(talents, append = false) {
            const listEl = document.getElementById('talentsList');
            const emptyEl = document.getElementById('emptyState');

            if (!append) {
                listEl.innerHTML = '';
                renderedTalentsCount = 0;
            }

            if (!talents.length) {
                emptyEl.classList.remove('hidden');
                updateShowMoreControls(talents);
                return;
            }
            emptyEl.classList.add('hidden');

            // Correctif P7 : seul le prochain lot (RENDER_BATCH_SIZE éléments) est
            // construit ici, pas tout le tableau — le reste attend un clic sur
            // "Afficher plus" (voir updateShowMoreControls() et son écouteur plus
            // bas). En mode paginé normal, talents.length ≤ PAGE_SIZE (20) < 25,
            // donc ce lot contient déjà tout : aucun changement de comportement
            // visible dans ce mode.
            const batch = talents.slice(renderedTalentsCount, renderedTalentsCount + RENDER_BATCH_SIZE);

            batch.forEach(t => {
                const row = document.createElement('div');
                const eligible = isDevalidationEligible(t);
                const isDevalidated = t.is_valid === false;
                // Correctif P12 (B12-S3, 28/08/2026) : idKey est aujourd'hui un
                // UUID généré par Postgres, donc déjà propre — encodé par précaution
                // avant qu'un futur cas limite (import en masse, saisie manuelle)
                // n'introduise un caractère réservé qui casserait la navigation.
                // Calculé ici (avant innerHTML) depuis le correctif P16, pour servir
                // de href au lien du nom ci-dessous.
                const idKey = t.id || t._id;

                row.className = "bg-white border rounded-2xl p-4 flex items-start justify-between gap-4 hover:shadow-sm transition-all " +
                    (eligible ? "border-red-300 bg-red-50" : "border-slate-200");

                let extraBadge = '';
                if (isDevalidated) {
                    extraBadge = '<span class="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-200 text-slate-600">⛔ Dévalidé</span>';
                } else if (eligible) {
                    extraBadge = '<span class="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">⚠️ À arbitrer</span>';
                } else if (hasActiveExtension(t)) {
                    const untilLabel = new Date(t.devalidation_extension_until).toLocaleDateString('fr-FR');
                    extraBadge = `<span class="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">⏳ Prolongé jusqu'au ${untilLabel}</span>`;
                }

                const canManage = currentUserRole !== 'visitor';

                row.innerHTML = `
                    <div class="flex items-start gap-3 min-w-0 flex-1">
                        <div class="h-10 w-10 rounded-full bg-primary-light text-primary font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                            ${escapeHtml((t.first_name || '?')[0])}${escapeHtml((t.last_name || '?')[0])}
                        </div>
                        <div class="min-w-0 flex-1">
                            <!-- Nom du talent redirigeant vers la carte d'identité — lien réel
                                 (correctif P16, natif au clavier, plus besoin de gestionnaire
                                 de clic sur toute la carte) -->
                            <a href="id-card.html?id=${encodeURIComponent(idKey)}" class="talent-name-hover block font-bold text-slate-800 hover:text-primary hover:underline truncate">
                                ${escapeHtml(t.first_name || '')} ${escapeHtml(t.last_name || '')} ${t.is_red_listed ? '🚩' : ''}
                            </a>
                            <!-- Ligne d'infos secondaires (fonction, expérience, disponibilité) —
                                 sur le modèle Hercules talent-list.tsx, absente jusqu'ici de cette liste. -->
                            <p class="text-xs text-slate-500 truncate mt-0.5">
                                <span class="font-semibold text-slate-500">Fonction :</span> ${escapeHtml(t.current_function || '—')}
                                <span class="mx-1.5 text-slate-300">·</span>
                                <span class="font-semibold text-slate-500">Exp. ALIMA :</span> ${t.experience_months_alima || 0} mois
                                <span class="mx-1.5 text-slate-300">·</span>
                                <span class="font-semibold text-slate-500">Disponible :</span> ${escapeHtml(formatAvailabilityLabel(t))}
                            </p>
                            ${renderInlineValidityBar(t)}
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

                        <!-- Bouton d'action Modifier dédié qui ouvre le modal — masqué pour visitor -->
                        ${canManage ? `
                        <button class="edit-btn p-2 hover:bg-slate-100 rounded-xl text-slate-500 hover:text-primary transition-all" title="Modifier">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                            </svg>
                        </button>` : ''}
                    </div>
                `;
                
                // Hover card (Étape D) : aperçu rapide au survol OU au focus clavier du
                // nom (correctif P18 — avant, uniquement mouseenter/mouseleave, aucun
                // équivalent clavier), sans ouvrir la fiche.
                const nameEl = row.querySelector('.talent-name-hover');
                if (nameEl) {
                    nameEl.addEventListener('mouseenter', () => showHoverCard(t, nameEl));
                    nameEl.addEventListener('mouseleave', hideHoverCard);
                    nameEl.addEventListener('focus', () => showHoverCard(t, nameEl));
                    nameEl.addEventListener('blur', hideHoverCard);
                }

                // Clic sur le bouton d'édition : ouvre le modal. e.stopPropagation()
                // retiré (correctif P16) : n'était utile que pour bloquer le clic de
                // toute la ligne, qui n'existe plus — seul le nom (lien ci-dessus) est
                // désormais cliquable.
                const editBtn = row.querySelector('.edit-btn');
                if (editBtn) {
                    editBtn.addEventListener('click', () => {
                        openEditModal(t);
                    });
                }

                if (eligible && canManage) {
                    row.querySelector('.btn-prolong-talent').addEventListener('click', () => {
                        openProlongModal(t);
                    });
                    row.querySelector('.btn-devalidate-talent').addEventListener('click', () => {
                        devalidateTalentFromList(t);
                    });
                }

                listEl.appendChild(row);
            });

            renderedTalentsCount += batch.length;
            updateShowMoreControls(talents);
        }

        // Correctif P7 : affiche/masque le bouton "Afficher plus" et le petit
        // texte "X sur Y affichés", selon qu'il reste ou non des talents non
        // encore rendus dans le tableau complet passé à renderTalents().
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
            const shown = Math.min(renderedTalentsCount, talents.length);
            countLabel.textContent = `${shown} sur ${talents.length} affiché${talents.length > 1 ? 's' : ''}`;

            showMoreBtn.classList.toggle('hidden', renderedTalentsCount >= talents.length);
        }

        // ============================================================================
        // 3 BIS. RECHERCHE AVANCÉE (adaptée de AdvancedSearch / filterAndSortTalents,
        //    Mon_code_hercules.txt) — filtrage et tri appliqués en mémoire sur
        //    allTalents (déjà chargé pour ce pool), pas de nouvelle requête réseau.
        // ============================================================================
        const searchFilters = {
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
        const defaultSearchFilters = { ...searchFilters };

        // Estimation d'une date de disponibilité exploitable pour filtre/tri, à
        // partir de availability_type ('none' | 'asap' | 'notice' | 'date').
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

        // Recherche mots-clés dans les compétences clés + l'historique archivé
        // (compatible ancien format camelCase/epoch et nouveau format snake_case,
        // même logique que normalizePassageComment sur id-card.html).
        function keywordMatches(t, kw) {
            const skills = t.key_skills || [];
            if (skills.some(s => String(s).toLowerCase().includes(kw))) return true;

            // Correctif (21/08/2026) : les 3 commentaires libres associés aux cases
            // "A fait des ouvertures / missions d'urgence / fermetures de projet"
            // (mission_opening_comments, emergency_mission_comments,
            // closure_mission_comments) n'étaient jusqu'ici jamais scannés par la
            // recherche par mot-clé — seules les compétences clés et l'historique
            // archivé l'étaient. Un recruteur qui décrit cette expérience en texte
            // libre sans cocher la case correspondante restait invisible à la
            // recherche ; désormais couvert.
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

        function filterAndSortTalents(talents, f) {
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

            // Filtre ajouté le 18/08/2026, corrigé le même jour pour couvrir aussi la
            // Liste Rouge (pas seulement la dévalidation) : par défaut ('active'),
            // masque les talents dévalidés ET ceux en Liste Rouge — les deux restent
            // dans "talents" en base (choix volontaire du site : ne pas les retirer
            // facilite leur suivi), mais n'ont rien à faire dans la liste courante d'un
            // pool au quotidien. 'devalidated' isole les dévalidés (Liste Rouge ou non).
            // '' (Tous) désactive le filtre, comportement identique à avant son ajout.
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

            filtered.sort((a, b) => {
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

            return filtered;
        }

        let currentFilteredTalents = [];

        function applyFiltersAndRender() {
            currentFilteredTalents = filterAndSortTalents(allTalents, searchFilters);
            renderTalents(currentFilteredTalents);
            document.getElementById('paginationControls').classList.add('hidden');
            updateSearchSummary();
            updateResetButtonVisibility();
        }

        // Résumé du nombre de talents affichés — formulé différemment selon le mode
        // actif (liste complète filtrée en mémoire, ou page issue de Supabase).
        function updateSearchSummary() {
            const summary = document.getElementById('searchResultsSummary');
            if (isFullListMode) {
                if (currentFilteredTalents.length === allTalents.length) {
                    summary.textContent = `${allTalents.length} talent${allTalents.length > 1 ? 's' : ''} au total`;
                } else {
                    summary.textContent = `${currentFilteredTalents.length} talent${currentFilteredTalents.length > 1 ? 's' : ''} trouvé${currentFilteredTalents.length > 1 ? 's' : ''} sur ${allTalents.length} au total`;
                }
            } else {
                summary.textContent = `${totalCount} talent${totalCount > 1 ? 's' : ''} au total`;
            }
        }

        function updateResetButtonVisibility() {
            const hasAnyFilter = JSON.stringify(searchFilters) !== JSON.stringify(defaultSearchFilters);
            document.getElementById('resetFiltersBtn').classList.toggle('hidden', !hasAnyFilter);
        }

        // Toute modification de filtre repart de la page 1 et redéclenche loadTalents(),
        // qui décide lui-même du mode (paginé ou liste complète) à appliquer.
        function onFiltersChanged() {
            currentPage = 0;
            loadTalents();
        }

        document.getElementById('searchInput').addEventListener('input', e => {
            searchFilters.searchQuery = e.target.value.trim();
            onFiltersChanged();
        });

        document.getElementById('toggleAdvancedBtn').addEventListener('click', () => {
            document.getElementById('advancedFiltersPanel').classList.toggle('hidden');
        });

        document.getElementById('resetFiltersBtn').addEventListener('click', () => {
            Object.assign(searchFilters, defaultSearchFilters);
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
                searchFilters[filterKey] = e.target.value;
                onFiltersChanged();
            });
        });

        // ============================================================================
        // 3 TER. EXPORT EXCEL DU POOL FILTRÉ (colonnes RH enrichies, adapté de
        //    handleExportToExcel, Mon_code_hercules.txt)
        // ============================================================================
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
            // En mode paginé, currentFilteredTalents ne contient que la page affichée
            // (PAGE_SIZE lignes) — on récupère toujours l'intégralité du pool filtré
            // avant d'exporter, pour ne jamais produire un fichier tronqué silencieusement
            // (Étape D, Option A). En mode liste complète, currentFilteredTalents est déjà
            // le résultat complet filtré, rien à refaire.
            let rowsToExport;
            if (isFullListMode) {
                rowsToExport = currentFilteredTalents;
            } else {
                try {
                    const sortColumnMap = {
                        name: 'last_name',
                        integration: 'pool_integration_date',
                        expAlima: 'experience_months_alima',
                        expHumanitarian: 'experience_months_humanitarian'
                    };
                    const sortColumn = sortColumnMap[searchFilters.sortBy] || 'pool_integration_date';
                    const ascending = searchFilters.sortOrder === 'asc';
                    const { data, error } = await capHumaWithRetry(() => {
                        let query = supabaseClient.from('talents').select('*').order(sortColumn, { ascending });
                        if (currentPoolId) query = query.eq('pool', currentPoolId);
                        if (searchFilters.statusFilter) query = query.eq('status', searchFilters.statusFilter);
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
                const sheetName = `Talents ${currentPoolId || 'pool'}`.substring(0, 31);
                XLSX.utils.book_append_sheet(wb, ws, sheetName);

                const today = new Date().toISOString().slice(0, 10);
                const fileSlug = (currentPoolId || 'pool').toLowerCase();
                XLSX.writeFile(wb, `talents-${fileSlug}-${today}.xlsx`);
            } catch (err) {
                console.error(err);
                alert("Erreur lors de l'export : " + (err && err.message ? err.message : 'erreur inconnue.'));
            }
        });

        // ============================================================================
        // 4. GESTION DES ONGLETS DE LA MODALE
        // ============================================================================
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tabId = btn.dataset.tab;
                document.querySelectorAll('.tab-panel').forEach(p => {
                    p.classList.toggle('hidden', p.dataset.panel !== tabId);
                });
            });
        });

        function resetTabsToFirst() {
            document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== '1'));
        }

        // ============================================================================
        // 5. CHAMPS "TAGS" RÉUTILISABLES (langues, contextes, zones, compétences)
        // ============================================================================
        function createTagField(containerId, fieldName, label, maxTags) {
            const container = document.getElementById(containerId);
            // Correctif P14 (B18-A1, accessibilité) : id dérivé de fieldName (déjà un
            // identifiant simple sans espace, cf. les 5 appels de createTagField()) pour
            // associer le label généré à son champ via for=/id=, sur le même modèle
            // que les labels statiques des autres pages.
            const inputId = `tagfield-input-${fieldName.replace(/_/g, '-')}`;
            container.innerHTML = `
                <label class="text-xs font-bold text-slate-500 uppercase" for="${inputId}">${label}</label>
                <div class="tags-wrap flex flex-wrap gap-1.5 mt-1 mb-1.5" data-field="${fieldName}"></div>
                <input id="${inputId}" type="text" class="tag-input w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:border-primary" placeholder="Tape puis Entrée pour ajouter" data-field="${fieldName}" />
            `;
            const input = container.querySelector('.tag-input');
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = input.value.trim();
                    const wrap = container.querySelector('.tags-wrap');
                    const current = wrap.querySelectorAll('.tag-chip').length;
                    if (val && (!maxTags || current < maxTags)) {
                        addTagChip(wrap, val);
                        input.value = '';
                    }
                }
            });
        }

        function addTagChip(wrap, value) {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.dataset.value = value;
            chip.innerHTML = `${escapeHtml(value)} <button type="button">&times;</button>`;
            chip.querySelector('button').addEventListener('click', () => chip.remove());
            wrap.appendChild(chip);
        }

        function getTagValues(fieldName) {
            const wrap = document.querySelector(`.tags-wrap[data-field="${fieldName}"]`);
            return Array.from(wrap.querySelectorAll('.tag-chip')).map(c => c.dataset.value);
        }

        function setTagValues(fieldName, values) {
            const wrap = document.querySelector(`.tags-wrap[data-field="${fieldName}"]`);
            wrap.innerHTML = '';
            (values || []).forEach(v => addTagChip(wrap, v));
        }

        createTagField('tagfield_languages', 'languages', 'Langues parlées', null);
        createTagField('tagfield_other_languages', 'other_languages', 'Autres langues (non répertoriées)', null);
        createTagField('tagfield_intervention_contexts', 'intervention_contexts', "Contextes d'intervention", null);
        createTagField('tagfield_intervention_zones', 'intervention_zones', 'Zones géographiques', null);
        createTagField('tagfield_key_skills', 'key_skills', 'Compétences clés', 5);

        // ============================================================================
        // 6. AFFICHAGE CONDITIONNEL (disponibilité, commentaires missions)
        // ============================================================================
        document.getElementById('availabilityType').addEventListener('change', function () {
            document.getElementById('availabilityMonthsWrap').classList.toggle('hidden', this.value !== 'notice');
            document.getElementById('availabilityDateWrap').classList.toggle('hidden', this.value !== 'date');
        });

        // ── Cohérence "A effectué une mission ALIMA" / "Nombre de missions" / "Date de fin de dernière mission" ──
        const hadAlimaMissionCb = document.getElementById('hadAlimaMissionCb');
        const numberOfMissionsSelect = document.getElementById('numberOfMissionsSelect');
        const lastMissionEndDateWrap = document.getElementById('lastMissionEndDateWrap');
        const lastMissionEndDateInput = talentForm.querySelector('[name="last_mission_end_date"]');

        function syncMissionFields() {
            if (hadAlimaMissionCb.checked) {
                lastMissionEndDateWrap.classList.remove('hidden');
                lastMissionEndDateInput.required = true;
                numberOfMissionsSelect.querySelector('option[value="none"]').disabled = true;
                if (numberOfMissionsSelect.value === 'none') numberOfMissionsSelect.value = 'one';
            } else {
                lastMissionEndDateWrap.classList.add('hidden');
                lastMissionEndDateInput.required = false;
                lastMissionEndDateInput.value = '';
                numberOfMissionsSelect.querySelector('option[value="none"]').disabled = false;
                numberOfMissionsSelect.value = 'none';
            }
        }
        hadAlimaMissionCb.addEventListener('change', syncMissionFields);

        // ============================================================================
        // 7. COMPTEUR DE VALIDITÉ & BARRE DE PROGRESSION (DevalidationProgressBar)
        // ============================================================================
        // DEVALIDATION_MAX_MONTHS (et DEVALIDATION_AT_RISK_MONTHS/CRITICAL_MONTHS,
        // utilisées plus bas) ont été retirées d'ici le 18/08/2026 : cette page avait
        // sa propre copie locale, désormais fournie par shared/caphuma-utils.js
        // (chargé ligne 10) — seul endroit du site où ces 3 seuils sont définis.
        // Ne PAS les redéclarer ici : un second "const" du même nom dans une balise
        // <script> différente de la même page provoque une erreur de syntaxe qui
        // casse tout le script (constaté concrètement lors de cette centralisation).

        // calculateMonthsWithoutMission() a été retirée d'ici : cette page avait
        // l'ANCIENNE méthode (tranches de 30 jours, bug 55 MC13 §4). Elle vient
        // désormais de shared/caphuma-utils.js (chargé ligne 10), qui utilise la
        // méthode calendaire correcte — la même que statistics.html et id-card.html.
        // ⚠️ Les chiffres affichés sur cette page vont légèrement BAISSER par
        // rapport à avant (l'ancienne méthode surestimait). Ce n'est pas une
        // régression : c'était cette page qui avait tort.

        // Une prolongation est active tant que devalidation_extension_until est dans le futur.
        function hasActiveExtension(talent) {
            if (!talent.devalidation_extension_until) return false;
            return new Date(talent.devalidation_extension_until).getTime() > Date.now();
        }

        // Un talent est proposé à l'arbitrage (dévalider/prolonger) s'il n'est pas déjà
        // dévalidé, qu'il a atteint le seuil des 24 mois sans mission, et qu'aucune
        // prolongation active ne le couvre encore.
        function isDevalidationEligible(talent) {
            if (talent.is_valid === false) return false;
            if (hasActiveExtension(talent)) return false;
            return calculateMonthsWithoutMission(talent) >= DEVALIDATION_MAX_MONTHS;
        }

        // ============================================================================
        // 7bis. ARBITRAGE : PROLONGER OU DÉVALIDER DEPUIS LA LISTE
        // ============================================================================
        // toastMessage() retirée d'ici : vient désormais de shared/caphuma-utils.js
        // (comportement identique — cette page avait déjà cette version).

        let talentPendingArbitration = null;
        const prolongModal = document.getElementById('prolongModal');

        function openProlongModal(talent) {
            talentPendingArbitration = talent;
            document.getElementById('prolongTalentName').textContent = `${talent.first_name || ''} ${talent.last_name || ''}`.trim();
            document.getElementById('prolongMonths').value = '3';
            prolongModal.classList.remove('hidden');
        }

        document.getElementById('prolongCancelBtn').addEventListener('click', () => {
            prolongModal.classList.add('hidden');
            talentPendingArbitration = null;
        });

        document.getElementById('prolongConfirmBtn').addEventListener('click', async () => {
            if (!talentPendingArbitration) return;
            const months = parseInt(document.getElementById('prolongMonths').value, 10);

            const untilDate = new Date();
            untilDate.setMonth(untilDate.getMonth() + months);
            const untilStr = untilDate.toISOString().slice(0, 10); // colonne "date"

            try {
                const { error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('talents')
                        .update({
                            devalidation_extension_until: untilStr,
                            devalidation_extension_months: months,
                            devalidation_extension_granted_by: currentUserId,
                            devalidation_extension_granted_by_name: currentUserEmail,
                            devalidation_extension_granted_at: new Date().toISOString()
                        })
                        .eq('id', talentPendingArbitration.id)
                );

                if (error) throw error;

                // logAuditAction('update', ...) retiré le 19/08/2026 (A5) : couvert
                // désormais par le trigger Postgres trg_audit_talents (détecte la
                // prolongation via devalidation_extension_until et reproduit le même texte).
                prolongModal.classList.add('hidden');
                toastMessage(`Prolongation de ${months} mois accordée.`);
                talentPendingArbitration = null;
                await loadTalents();
            } catch (err) {
                console.error(err);
                toastMessage("Échec de la prolongation : " + err.message, "error");
            }
        });

        // Dévalidation directe depuis la liste : aucun email n'est envoyé
        // automatiquement (choix validé avec l'utilisateur) — le recruteur/admin
        // doit avoir contacté le talent lui-même avant de confirmer ici.
        async function devalidateTalentFromList(talent) {
            const fullName = `${talent.first_name || ''} ${talent.last_name || ''}`.trim();
            const confirmed = confirm(
                `Dévalider "${fullName}" ?\n\nAssurez-vous d'avoir déjà envoyé un email à ${talent.email || '(email non renseigné)'} avant de confirmer.\nCette action est réversible depuis la fiche du talent (bouton Réintégrer).`
            );
            if (!confirmed) return;

            try {
                const { error } = await capHumaWithRetry(() =>
                    supabaseClient
                        .from('talents')
                        .update({
                            is_valid: false,
                            devalidation_date: new Date().toISOString().slice(0, 10),
                            devalidation_extension_until: null,
                            devalidation_extension_months: null,
                            devalidation_extension_granted_by: null,
                            devalidation_extension_granted_by_name: null,
                            devalidation_extension_granted_at: null
                        })
                        .eq('id', talent.id)
                );

                if (error) throw error;

                // logAuditAction('devalidate', ...) retiré le 19/08/2026 (A5) : couvert
                // désormais par le trigger Postgres trg_audit_talents.
                toastMessage(`${fullName} a été dévalidé(e).`);
                await loadTalents();
            } catch (err) {
                console.error(err);
                toastMessage("Échec de la dévalidation : " + err.message, "error");
            }
        }

        function getValidityData(talent) {
            const isInvalid = talent.is_valid === false;
            const isCurrentlyOnMission = talent.is_currently_on_mission || talent.isCurrentlyOnAlimaMission;
            const isPaused = !isInvalid && (isCurrentlyOnMission || talent.status === 'En poste ALIMA');
            const totalMonths = isInvalid ? DEVALIDATION_MAX_MONTHS : calculateMonthsWithoutMission(talent);
            const cappedMonths = Math.min(totalMonths, DEVALIDATION_MAX_MONTHS);
            const progressPercent = (cappedMonths / DEVALIDATION_MAX_MONTHS) * 100;
            const remainingMonths = Math.max(0, DEVALIDATION_MAX_MONTHS - totalMonths);

            let barColor, textColor;
            if (isInvalid || totalMonths >= DEVALIDATION_MAX_MONTHS) { barColor = 'bg-red-600'; textColor = 'text-red-600'; }
            else if (totalMonths >= DEVALIDATION_CRITICAL_MONTHS) { barColor = 'bg-red-50'; textColor = 'text-red-600'; }
            else if (totalMonths >= DEVALIDATION_AT_RISK_MONTHS) { barColor = 'bg-orange-400'; textColor = 'text-orange-600'; }
            else { barColor = 'bg-green-500'; textColor = 'text-slate-500'; }

            const refDate = talent.last_mission_end_date || talent.pool_integration_date;
            const refLabel = talent.last_mission_end_date ? 'Fin dernière mission' : 'Intégration pool';

            return { isInvalid, isPaused, totalMonths, cappedMonths, progressPercent, remainingMonths, barColor, textColor, refDate, refLabel };
        }

        // Version "liste" de la jauge de validité — reprend le même contenu que
        // renderValidityIndicator() (libellé + explication contextuelle selon la
        // position du talent), mais retourne une chaîne HTML autonome au lieu
        // d'injecter dans un unique élément #validityIndicator, pour être utilisable
        // une fois par ligne dans la liste des talents (demande explicite de
        // l'utilisateur : ne pas se limiter à une barre nue, cf. Hercules
        // devalidation-progress-bar.tsx).
        function renderInlineValidityBar(talent) {
            const v = getValidityData(talent);
            let labelHtml, bottomHtml;

            if (v.isInvalid) {
                labelHtml = `<span class="text-red-600 font-bold flex items-center gap-1">⛔ Dévalidé</span><span class="text-red-600 font-bold">${DEVALIDATION_MAX_MONTHS} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                bottomHtml = '';
            } else if (v.isPaused) {
                labelHtml = `<span class="text-blue-600 font-bold flex items-center gap-1">⏸ Compteur suspendu</span><span class="font-bold ${v.textColor}">${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                bottomHtml = `<p class="text-[11px] text-blue-500 mt-0.5">⏸ En mission ALIMA — compteur en pause</p>`;
            } else {
                const riskLabel = v.totalMonths < DEVALIDATION_AT_RISK_MONTHS ? 'Validité pool' : (v.totalMonths >= DEVALIDATION_CRITICAL_MONTHS ? 'Critique' : 'À risque');
                const riskIcon = v.totalMonths < DEVALIDATION_AT_RISK_MONTHS ? '✅' : '⚠️';
                labelHtml = `<span class="font-bold ${v.textColor} flex items-center gap-1">${riskIcon} ${riskLabel}</span><span class="font-bold ${v.textColor}">${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                const remainingText = v.totalMonths >= DEVALIDATION_AT_RISK_MONTHS
                    ? (v.remainingMonths === 0 ? 'Dévalidation imminente !' : `${v.remainingMonths} mois restant${v.remainingMonths > 1 ? 's' : ''} avant éjection du pool`)
                    : '';
                bottomHtml = remainingText
                    ? `<p class="text-[11px] font-medium ${v.textColor} mt-0.5">${remainingText}</p>`
                    : '';
            }

            return `
                <div class="mt-2">
                    <div class="flex items-center justify-between text-[11px] mb-1">${labelHtml}</div>
                    <div class="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden"><div class="h-full rounded-full ${v.barColor} ${v.isPaused ? 'opacity-50' : ''}" style="width:${v.progressPercent}%"></div></div>
                    ${bottomHtml}
                </div>
            `;
        }

        function renderValidityIndicator(talent) {
            const box = document.getElementById('validityIndicator');
            const v = getValidityData(talent);
            box.classList.remove('hidden');

            let labelHtml, bottomHtml;

            if (v.isInvalid) {
                labelHtml = `<span class="text-red-600 font-bold flex items-center gap-1">⛔ Dévalidé</span><span class="text-red-600 font-bold">${DEVALIDATION_MAX_MONTHS} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                bottomHtml = '';
            } else if (v.isPaused) {
                labelHtml = `<span class="text-blue-600 font-bold flex items-center gap-1">⏸ Compteur suspendu</span><span class="font-bold ${v.textColor}">${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                bottomHtml = `<p class="text-xs text-blue-500 mt-1">⏸ En mission ALIMA — compteur en pause</p>`;
            } else {
                const riskLabel = v.totalMonths < DEVALIDATION_AT_RISK_MONTHS ? '✅ Validité pool' : (v.totalMonths >= DEVALIDATION_CRITICAL_MONTHS ? '⚠️ Critique' : '⚠️ À risque');
                labelHtml = `<span class="font-bold ${v.textColor}">${riskLabel}</span><span class="font-bold ${v.textColor}">${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                const remainingText = v.totalMonths >= DEVALIDATION_AT_RISK_MONTHS
                    ? (v.remainingMonths === 0 ? 'Dévalidation imminente !' : `${v.remainingMonths} mois restant${v.remainingMonths > 1 ? 's' : ''} avant éjection du pool`)
                    : '';
                bottomHtml = `<div class="flex items-center justify-between text-xs text-slate-500 mt-1">
                    <span class="font-medium ${v.textColor}">${remainingText}</span>
                    <span class="italic">${v.refLabel} : ${v.refDate ? new Date(v.refDate).toLocaleDateString('fr-FR') : 'N/A'}</span>
                </div>`;
            }

            box.innerHTML = `
                <div class="flex items-center justify-between text-xs mb-1.5">${labelHtml}</div>
                <div class="h-1.5 w-full rounded-full bg-white overflow-hidden"><div class="h-full rounded-full ${v.barColor} ${v.isPaused ? 'opacity-50' : ''}" style="width:${v.progressPercent}%"></div></div>
                ${bottomHtml}
            `;
        }

        document.querySelectorAll('.mission-checkbox').forEach(cb => {
            cb.addEventListener('change', function () {
                const target = document.querySelector(`textarea[name="${this.dataset.target}"]`);
                target.classList.toggle('hidden', !this.checked);
            });
        });

        // ============================================================================
        // 8. FORMATIONS ALIMA — LIGNES DYNAMIQUES
        // ============================================================================
        function addTrainingRow(training) {
            training = training || {};
            const row = document.createElement('div');
            row.className = 'training-row grid grid-cols-12 gap-2 items-center bg-slate-50 border border-slate-200 rounded-lg p-2';
            row.innerHTML = `
                <input class="training-name col-span-4 rounded border border-slate-200 p-1.5 text-xs" placeholder="Nom formation" value="${escapeHtml(training.name || '')}" />
                <input class="training-date col-span-3 rounded border border-slate-200 p-1.5 text-xs" type="date" value="${escapeHtml(training.date ? training.date.substring(0,10) : '')}" />
                <input class="training-duration col-span-2 rounded border border-slate-200 p-1.5 text-xs" placeholder="Durée" value="${escapeHtml(training.duration || '')}" />
                <input class="training-desc col-span-2 rounded border border-slate-200 p-1.5 text-xs" placeholder="Description" value="${escapeHtml(training.description || '')}" />
                <button type="button" class="removeTrainingBtn col-span-1 text-red-500 text-lg">&times;</button>
            `;
            row.querySelector('.removeTrainingBtn').addEventListener('click', () => row.remove());
            document.getElementById('trainingsList').appendChild(row);
        }

        document.getElementById('addTrainingBtn').addEventListener('click', () => addTrainingRow());

        function getTrainingsValues() {
            return Array.from(document.querySelectorAll('.training-row')).map(row => ({
                name: row.querySelector('.training-name').value,
                date: row.querySelector('.training-date').value ? new Date(row.querySelector('.training-date').value).toISOString() : null,
                duration: row.querySelector('.training-duration').value,
                description: row.querySelector('.training-desc').value
            })).filter(t => t.name);
        }

        // ============================================================================
        // 8bis. BROUILLON LOCAL (backlog B15-R1, priorité P20)
        // ============================================================================
        // Sauvegarde locale du contenu du formulaire en cours de saisie, pour ne pas
        // tout perdre en cas de fermeture d'onglet, crash, ou rechargement pendant une
        // erreur affichée — voir shared/caphuma-form-draft.js pour le mécanisme
        // générique et les décisions de périmètre (Master Context §7, P20).
        //
        // Portée : création ET édition. Clé propre à chaque cas (`draft:talent:new`
        // en création, `draft:talent:edit:<id>` en édition) pour qu'un brouillon ne
        // s'applique jamais par erreur à une autre fiche que celle visée.
        //
        // collectTalentDraft()/restoreTalentDraft() réutilisent volontairement les
        // fonctions déjà existantes (getTagValues()/setTagValues() §5,
        // getTrainingsValues()/addTrainingRow() ci-dessus) plutôt que de dupliquer la
        // logique de lecture/écriture des tags et formations — ces champs ne sont pas
        // couverts par la collecte par défaut de caphuma-form-draft.js (chips et
        // lignes dynamiques sans name=).
        let currentTalentDraftKey = null;
        let currentTalentDraftBinding = null;

        function collectTalentDraft() {
            const data = capHumaDefaultDraftCollect(talentForm);
            data.__tags = {
                languages: getTagValues('languages'),
                other_languages: getTagValues('other_languages'),
                intervention_contexts: getTagValues('intervention_contexts'),
                intervention_zones: getTagValues('intervention_zones'),
                key_skills: getTagValues('key_skills')
            };
            data.__trainings = getTrainingsValues();
            return data;
        }

        function restoreTalentDraft(data) {
            capHumaDefaultDraftRestore(talentForm, data);

            if (data.__tags) {
                Object.entries(data.__tags).forEach(([field, values]) => setTagValues(field, values));
            }
            if (data.__trainings) {
                document.getElementById('trainingsList').innerHTML = '';
                data.__trainings.forEach(tr => addTrainingRow(tr));
            }

            // Champs conditionnels pilotés par des écouteurs 'change' (jamais
            // déclenchés par une affectation .value/.checked programmatique) — même
            // logique que celle déjà appliquée par openEditModal() pour ces mêmes
            // champs, réappliquée ici après restauration des valeurs du brouillon.
            const availabilityTypeField = talentForm.querySelector('[name="availability_type"]');
            if (availabilityTypeField) {
                document.getElementById('availabilityMonthsWrap').classList.toggle('hidden', availabilityTypeField.value !== 'notice');
                document.getElementById('availabilityDateWrap').classList.toggle('hidden', availabilityTypeField.value !== 'date');
            }
            syncMissionFields();
            document.querySelectorAll('.mission-checkbox').forEach(cb => {
                document.querySelector(`textarea[name="${cb.dataset.target}"]`).classList.toggle('hidden', !cb.checked);
            });
        }

        // Démarre le suivi de brouillon pour la modale qui vient de s'ouvrir — appelé
        // en toute fin de openCreateModal()/openEditModal(), une fois le formulaire
        // entièrement rempli (données réelles du talent en édition), pour que l'offre
        // de restauration ne porte que sur ce que l'utilisateur avait tapé en plus.
        function startTalentDraftTracking(draftKey) {
            if (currentTalentDraftBinding) currentTalentDraftBinding.stop();
            currentTalentDraftKey = draftKey;
            capHumaOfferDraftRestore(draftKey, restoreTalentDraft);
            currentTalentDraftBinding = capHumaAttachDraftAutosave(talentForm, draftKey, { collect: collectTalentDraft });
        }

        // Sur Annuler/× : abandon volontaire du formulaire, le brouillon est effacé
        // tout de suite (décision utilisateur — R1 vise la perte ACCIDENTELLE, pas
        // l'abandon assumé). Sur enregistrement réussi : même fonction, appelée
        // plus bas en section 10.
        function discardTalentDraft() {
            if (currentTalentDraftBinding) {
                currentTalentDraftBinding.stop();
                currentTalentDraftBinding = null;
            }
            if (currentTalentDraftKey) {
                capHumaDraftClear(currentTalentDraftKey);
                currentTalentDraftKey = null;
            }
        }

        // ============================================================================
        // 9. OUVERTURE / FERMETURE DE LA MODALE
        // ============================================================================
        const talentModal = document.getElementById('talentModal');
        const formError = document.getElementById('formError');
        let editingTalentId = null;

        function openCreateModal() {
            editingTalentId = null;
            talentForm.reset();
            document.getElementById('modalTitle').textContent = 'Nouveau talent';
            document.querySelectorAll('.tags-wrap').forEach(w => w.innerHTML = '');
            document.getElementById('trainingsList').innerHTML = '';
            document.getElementById('availabilityMonthsWrap').classList.add('hidden');
            document.getElementById('availabilityDateWrap').classList.add('hidden');
            document.querySelectorAll('.mission-checkbox').forEach(cb => {
                document.querySelector(`textarea[name="${cb.dataset.target}"]`).classList.add('hidden');
            });
            document.getElementById('redListReadonly').innerHTML = "Ces informations apparaîtront ici une fois le profil créé. La gestion de la Liste Rouge se fait exclusivement depuis <strong>Admin</strong>.";
            document.getElementById('historyReadonly').innerHTML = "L'historique se construit automatiquement au fil du temps. Aucun historique pour un nouveau profil.";
            document.getElementById('validityIndicator').classList.add('hidden');
            syncMissionFields();
            formError.classList.add('hidden');
            resetTabsToFirst();
            startTalentDraftTracking('draft:talent:new');
            talentModal.classList.remove('hidden');
        }

        function openEditModal(talent) {
            editingTalentId = talent.id;
            talentForm.reset();
            document.getElementById('modalTitle').textContent = `${talent.first_name} ${talent.last_name}`;

            Object.keys(talent).forEach(key => {
                const field = talentForm.querySelector(`[name="${key}"]`);
                if (!field) return;
                if (field.type === 'checkbox') field.checked = !!talent[key];
                else if (field.type === 'date' && talent[key]) field.value = talent[key].substring(0, 10);
                else if (talent[key] !== null && talent[key] !== undefined) field.value = talent[key];
            });

            setTagValues('languages', talent.languages);
            setTagValues('other_languages', talent.other_languages);
            setTagValues('intervention_contexts', talent.intervention_contexts);
            setTagValues('intervention_zones', talent.intervention_zones);
            setTagValues('key_skills', talent.key_skills);

            document.getElementById('trainingsList').innerHTML = '';
            (talent.alima_trainings || []).forEach(tr => addTrainingRow(tr));

            document.getElementById('availabilityMonthsWrap').classList.toggle('hidden', talent.availability_type !== 'notice');
            document.getElementById('availabilityDateWrap').classList.toggle('hidden', talent.availability_type !== 'date');

            hadAlimaMissionCb.checked = !!talent.had_alima_mission;
            syncMissionFields();
            if (talent.last_mission_end_date) lastMissionEndDateInput.value = talent.last_mission_end_date.substring(0, 10);
            if (talent.number_of_alima_missions) numberOfMissionsSelect.value = talent.number_of_alima_missions;

            renderValidityIndicator(talent);

            document.querySelectorAll('.mission-checkbox').forEach(cb => {
                document.querySelector(`textarea[name="${cb.dataset.target}"]`).classList.toggle('hidden', !cb.checked);
            });

            // Onglet 5 — Liste Rouge (lecture seule)
            if (talent.is_red_listed) {
                document.getElementById('redListReadonly').innerHTML = `
                    <p class="font-bold text-red-600">🚩 Talent en Liste Rouge</p>
                    <p class="mt-2"><strong>Date :</strong> ${escapeHtml(talent.red_list_date || '—')}</p>
                    <p><strong>Raison :</strong> ${escapeHtml(talent.red_list_reason || '—')}</p>
                    <p><strong>Ajouté par :</strong> ${escapeHtml(talent.red_list_added_by_name || '—')}</p>
                    <p class="mt-2 text-xs">La réhabilitation se fait exclusivement depuis <strong>Admin</strong>.</p>
                `;
            } else {
                document.getElementById('redListReadonly').innerHTML = "Ce talent n'est pas en Liste Rouge.";
            }

            // Onglet 6 — Historique (lecture seule)
            const passages = talent.archived_position_passages || [];
            const history = talent.status_history || [];
            if (passages.length === 0 && history.length === 0) {
                document.getElementById('historyReadonly').innerHTML = "Aucun historique enregistré pour ce talent.";
            } else {
                let html = '';
                if (passages.length) {
                    html += '<p class="font-bold text-slate-700 mb-2">Missions passées</p>';
                    passages.forEach(p => {
                        html += `<div class="mb-2 pb-2 border-b border-slate-200"><p class="font-semibold">${escapeHtml(p.positionTitle || '')} — ${escapeHtml(p.country || '')}</p></div>`;
                    });
                }
                if (history.length) {
                    html += '<p class="font-bold text-slate-700 mt-3 mb-2">Changements</p>';
                    history.forEach(h => {
                        html += `<p class="text-xs">${escapeHtml(h.previousValue)} → ${escapeHtml(h.newValue)} <span class="text-slate-500">(${escapeHtml(h.changedByName || '')})</span></p>`;
                    });
                }
                document.getElementById('historyReadonly').innerHTML = html;
            }

            formError.classList.add('hidden');
            resetTabsToFirst();
            startTalentDraftTracking(`draft:talent:edit:${talent.id}`);
            talentModal.classList.remove('hidden');
        }

        document.getElementById('newTalentBtn').addEventListener('click', openCreateModal);
        document.getElementById('closeModalBtn').addEventListener('click', () => {
            talentModal.classList.add('hidden');
            discardTalentDraft();
        });
        document.getElementById('cancelBtn').addEventListener('click', () => {
            talentModal.classList.add('hidden');
            discardTalentDraft();
        });

        // ============================================================================
        // 10. ENREGISTREMENT (création ou mise à jour)
        // ============================================================================
        document.getElementById('saveTalentBtn').addEventListener('click', async function () {
            formError.classList.add('hidden');

            // Filet de sécurité (P20) : capture immédiate avant validation, sans
            // attendre le debounce de l'autosave — la fenêtre entre le clic et la
            // fin de l'enregistrement est justement le moment où un crash/une
            // fermeture accidentelle serait le plus coûteux à perdre.
            if (currentTalentDraftBinding) currentTalentDraftBinding.saveNow();

            const formData = new FormData(talentForm);
            const payload = {};
            for (const [key, value] of formData.entries()) {
                const field = talentForm.querySelector(`[name="${key}"]`);
                if (field.type === 'checkbox') continue;
                if (field.type === 'number') payload[key] = value ? Number(value) : null;
                else payload[key] = value || null;
            }
            
            ['has_visa', 'had_alima_mission', 'has_mission_opening', 'has_emergency_mission', 'has_mission_closure'].forEach(name => {
                const field = talentForm.querySelector(`[name="${name}"]`);
                if (field) payload[name] = field.checked;
            });

            payload.languages = getTagValues('languages');
            payload.other_languages = getTagValues('other_languages');
            payload.intervention_contexts = getTagValues('intervention_contexts');
            payload.intervention_zones = getTagValues('intervention_zones');
            payload.key_skills = getTagValues('key_skills');
            payload.alima_trainings = getTrainingsValues();

            if (!payload.first_name || !payload.last_name || !payload.status) {
                formError.textContent = "Merci de remplir au minimum Prénom, Nom et Statut (onglets 1 et 2).";
                formError.classList.remove('hidden');
                return;
            }

            const saveBtn = document.getElementById('saveTalentBtn');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Enregistrement...';

            try {
                if (editingTalentId) {
                    const { error } = await capHumaWithRetry(() =>
                        supabaseClient.from('talents').update(payload).eq('id', editingTalentId)
                    );
                    if (error) throw error;
                    // logAuditAction('update', ...) retiré le 19/08/2026 (A5) : couvert
                    // désormais par le trigger Postgres trg_audit_talents.
                } else {
                    payload.pool = currentPoolId;
                    payload.created_by = currentUserId;
                    payload.is_valid = true;
                    // ⚠️ Volontairement PAS enveloppé dans capHumaWithRetry() (P19,
                    // décision n°15) : talents n'a aucune contrainte UNIQUE (Dossier de
                    // passation §4.2) — une relance après perte de réponse dupliquerait
                    // silencieusement la fiche talent créée.
                    const { error } = await supabaseClient.from('talents').insert(payload);
                    if (error) throw error;
                    // logAuditAction('create', ...) retiré le 19/08/2026 (A5) : couvert
                    // désormais par le trigger Postgres trg_audit_talents (reproduit le
                    // même texte "Pool : X").
                }
                talentModal.classList.add('hidden');
                discardTalentDraft();
                await loadTalents();
            } catch (err) {
                console.error(err);
                formError.textContent = "Erreur lors de l'enregistrement : " + err.message;
                formError.classList.remove('hidden');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Enregistrer';
            }
        });
