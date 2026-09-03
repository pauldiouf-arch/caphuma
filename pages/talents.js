// talents.js est scindé en 2 fichiers par responsabilité — liste/recherche/
// export (ce fichier) et fiche/formulaire talent (talents-modal.js).
// Découpage en 2 plutôt que 3-4 (comme id-card.js ou missions.js) : les
// sections de l'ancien fichier (onglets, tags, champs conditionnels,
// validité, formations, brouillon, ouverture/enregistrement de la modale)
// sont fortement imbriquées entre elles — les séparer aurait démultiplié les
// échanges inter-fichiers pour un gain de lisibilité marginal. La limite
// entre "liste" et "fiche" est en revanche nette : très peu de dépendances
// croisées (voir ci-dessous).
//
// Ce fichier n'est pas enveloppé dans une IIFE, contrairement aux autres
// pages du site — même raison que missions.js/missions-render.js etc. : les 2
// fichiers de cette page doivent partager un état commun (session, pool
// courant), impossible entre 2 balises <script> classiques sans un point de
// partage explicite. TalentsPage est ce point unique, propre à cette page.
//
// Chargement requis dans talents.html, dans cet ordre :
//   1. pages/talents.js         (ce fichier — déclare TalentsPage)
//   2. pages/talents-modal.js
const TalentsPage = {};

(() => {
        // ============================================================================
        // HEADER COMMUN — injecté avant toute autre chose, y compris avant
        // checkSession() plus bas qui référence #newTalentBtn (masqué pour le rôle
        // visitor) et écrit dans #poolSubtitle une fois le pool chargé.
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
        // SUPABASE_URL / SUPABASE_ANON_KEY viennent de shared/caphuma-config.js
        // (chargé dans le head).
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) window.location.replace('index.html');

        const { createClient } = supabase;
        TalentsPage.supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const urlParams = new URLSearchParams(window.location.search);
        TalentsPage.currentPoolId = urlParams.get('pool');

        // Échappement HTML systématique de toute donnée venant de la base
        // avant injection via innerHTML — prévention XSS (audit sécurité).

        const appBody = document.getElementById('appBody');
        const talentForm = document.getElementById('talentForm');
        TalentsPage.currentUserId = null;
        TalentsPage.currentUserEmail = null;
        let currentUserRole = null;
        let currentUserName = null;

        // ============================================================================
        // JOURNAL D'AUDIT — voir id-card.html pour la logique détaillée. Ne bloque
        // jamais l'action métier si l'écriture du log échoue.
        // ============================================================================
        async function logAuditAction(action, entityType, entityId, entityName, details) {
            // Délègue à shared/caphuma-auth.js (fonction commune) — corrige au passage
            // le fait que user_name n'était jamais transmis sur certaines pages.
            const userName = typeof currentUserName !== 'undefined' ? currentUserName : null;
            await capHumaLogAudit(
                TalentsPage.supabaseClient,
                { userId: TalentsPage.currentUserId, userEmail: TalentsPage.currentUserEmail, userName: userName },
                action, entityType, entityId, entityName, details
            );
        }

        async function checkSession() {
            try {
                const s = await capHumaInitSession(TalentsPage.supabaseClient);
                TalentsPage.currentUserId = s.userId;
                TalentsPage.currentUserEmail = s.email;
                currentUserName = s.name;
                currentUserRole = s.role;

                document.getElementById('user-display-name').textContent = TalentsPage.currentUserEmail;
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
        capHumaInitModalA11y(); // définie dans shared/caphuma-utils.js

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', TalentsPage.currentUserId, TalentsPage.currentUserEmail, null);
            await TalentsPage.supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });

        // ============================================================================
        // 2. INFO POOL (titre de page)
        // ============================================================================
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

        // ============================================================================
        // 3. CHARGEMENT + RENDU DE LA LISTE (pagination réelle)
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

        // Affichage progressif en mode "liste complète" (recherche/filtre avancé),
        // pour éviter de créer d'un coup plusieurs centaines de nœuds DOM sur un
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

        // Chargement complet (une seule fois, mis en cache), utilisé uniquement en
        // mode liste complète.
        async function fetchAllTalents() {
            const listEl = document.getElementById('talentsList');
            const errorEl = document.getElementById('listError');
            try {
                // La construction de la requête est déplacée à l'intérieur de la
                // fonction passée à capHumaWithRetry(), pour qu'un retry reconstruise
                // un query builder tout neuf (avec les mêmes filtres) plutôt que de
                // réutiliser un objet déjà attendu une 1re fois.
                const { data, error } = await capHumaWithRetry(() => {
                    let query = TalentsPage.supabaseClient.from('talents').select('*').order('last_name', { ascending: true });
                    if (TalentsPage.currentPoolId) query = query.eq('pool', TalentsPage.currentPoolId);
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

        // Chargement paginé côté requête — ne demande à Supabase que les PAGE_SIZE
        // lignes de la page courante, filtrées par statut et triées côté serveur si
        // ces filtres simples sont actifs.
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

                // Même principe que fetchAllTalents() plus haut — la requête entière
                // (avec tous ses filtres conditionnels) est reconstruite à chaque
                // tentative de capHumaWithRetry().
                const { data, error, count } = await capHumaWithRetry(() => {
                    let query = TalentsPage.supabaseClient
                        .from('talents')
                        .select('*', { count: 'exact' })
                        .order(sortColumn, { ascending })
                        .range(from, to);

                    if (TalentsPage.currentPoolId) query = query.eq('pool', TalentsPage.currentPoolId);
                    if (searchFilters.statusFilter) query = query.eq('status', searchFilters.statusFilter);

                    // Le filtre "Validité" doit être répété ici, côté serveur, car ce
                    // mode paginé est celui utilisé par défaut (pas de recherche/filtre
                    // avancé actif) — le filtrage fait dans filterTalents() ne s'applique,
                    // lui, qu'au mode "liste complète". Tolère NULL comme le fait le
                    // filtre client (is_valid/is_red_listed ont un défaut mais une
                    // ancienne ligne pourrait ne pas l'avoir) : "actif" = is_valid pas
                    // explicitement false ET is_red_listed pas explicitement true.
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

        // Nommée différemment de renderPaginationControls() : ce nom collide
        // silencieusement avec la fonction partagée du même nom dans
        // shared/caphuma-utils.js (signature différente : celle-ci lit
        // totalCount/PAGE_SIZE/currentPage en globals de page et pilote des boutons
        // statiques prevPageBtn/nextPageBtn, la version partagée prend 5 paramètres
        // et génère du HTML avec onclick). Garder ce nom distinct évite de
        // réintroduire ce piège si la version partagée est modifiée un jour.
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

        // "Afficher plus" ajoute le lot suivant à la liste déjà affichée (append =
        // true), sans tout reconstruire — s'appuie sur currentFilteredTalents, le
        // tableau déjà en mémoire pour le mode "liste complète" (recherche/filtre
        // avancé).
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
        // HOVER CARD — aperçu rapide au survol du nom : fonction, statut,
        // disponibilité, expérience ALIMA/humanitaire. Un seul élément DOM réutilisé
        // et repositionné à chaque survol (voir formatAvailabilityLabel plus bas,
        // function déclarée donc "hoisted" — utilisable ici malgré l'ordre du fichier).
        // ============================================================================
        // La div #talentHoverCard est placée dans le HTML APRÈS la balise <script>,
        // donc une capture au chargement (const = ...) retournerait toujours null (le
        // parseur n'a pas encore atteint cette div au moment de l'exécution de cette
        // ligne). Récupération à la demande à la place — inoffensif en performance
        // (un seul élément, recherché seulement au survol/à la sortie, pas dans une
        // boucle).
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

            // Seul le prochain lot (RENDER_BATCH_SIZE éléments) est construit ici, pas
            // tout le tableau — le reste attend un clic sur "Afficher plus" (voir
            // updateShowMoreControls() et son écouteur plus bas). En mode paginé
            // normal, talents.length ≤ PAGE_SIZE (20) < 25, donc ce lot contient déjà
            // tout : aucun changement de comportement visible dans ce mode.
            const batch = talents.slice(renderedTalentsCount, renderedTalentsCount + RENDER_BATCH_SIZE);

            // Les lignes sont construites dans un DocumentFragment (hors DOM, aucun
            // reflow) puis ajoutées à listEl en un seul appendChild final — un
            // appendChild par ligne coûterait jusqu'à RENDER_BATCH_SIZE reflows par
            // lot. Les écouteurs par ligne (survol, focus, boutons) restent posés ici
            // sur chaque `row` avant son ajout au fragment — inutile que l'élément
            // soit déjà dans le DOM pour ça. Même pattern que
            // missions-render.js/renderMissions().
            const fragment = document.createDocumentFragment();

            batch.forEach(t => {
                const row = document.createElement('div');
                const eligible = TalentsPage.isDevalidationEligible(t);
                const isDevalidated = t.is_valid === false;
                // idKey est un UUID généré par Postgres, donc déjà propre — encodé par
                // précaution avant qu'un futur cas limite (import en masse, saisie
                // manuelle) n'introduise un caractère réservé qui casserait la
                // navigation. Calculé ici (avant innerHTML) pour servir de href au
                // lien du nom ci-dessous.
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

                const canManage = currentUserRole !== 'visitor';

                row.innerHTML = `
                    <div class="flex items-start gap-3 min-w-0 flex-1">
                        <div class="h-10 w-10 rounded-full bg-primary-light text-primary font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                            ${escapeHtml((t.first_name || '?')[0])}${escapeHtml((t.last_name || '?')[0])}
                        </div>
                        <div class="min-w-0 flex-1">
                            <!-- Nom du talent redirigeant vers la carte d'identité — lien
                                 réel, natif au clavier. -->
                            <a href="id-card.html?id=${encodeURIComponent(idKey)}" class="talent-name-hover block font-bold text-slate-800 hover:text-primary hover:underline truncate">
                                ${escapeHtml(t.first_name || '')} ${escapeHtml(t.last_name || '')} ${t.is_red_listed ? '🚩' : ''}
                            </a>
                            <!-- Ligne d'infos secondaires (fonction, expérience, disponibilité) -->
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

                        <!-- Bouton d'action Modifier dédié qui ouvre le modal — masqué pour visitor -->
                        ${canManage ? `
                        <button class="edit-btn p-2 hover:bg-slate-100 rounded-xl text-slate-500 hover:text-primary transition-all" title="Modifier">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                            </svg>
                        </button>` : ''}
                    </div>
                `;
                
                // Aperçu rapide au survol OU au focus clavier du nom, sans ouvrir la
                // fiche.
                const nameEl = row.querySelector('.talent-name-hover');
                if (nameEl) {
                    nameEl.addEventListener('mouseenter', () => showHoverCard(t, nameEl));
                    nameEl.addEventListener('mouseleave', hideHoverCard);
                    nameEl.addEventListener('focus', () => showHoverCard(t, nameEl));
                    nameEl.addEventListener('blur', hideHoverCard);
                }

                // Clic sur le bouton d'édition : ouvre le modal. Seul le nom (lien
                // ci-dessus) est cliquable sur la ligne, donc pas besoin de
                // e.stopPropagation() ici.
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

            renderedTalentsCount += batch.length;
            updateShowMoreControls(talents);
        }

        // Affiche/masque le bouton "Afficher plus" et le petit texte "X sur Y
        // affichés", selon qu'il reste ou non des talents non encore rendus dans le
        // tableau complet passé à renderTalents().
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
        // 3 BIS. RECHERCHE AVANCÉE — filtrage (filterTalents) et tri (sortTalents)
        //    appliqués en mémoire sur allTalents (déjà chargé pour ce pool), pas de
        //    nouvelle requête réseau.
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

            // Les 3 commentaires libres associés aux cases "A fait des ouvertures /
            // missions d'urgence / fermetures de projet" (mission_opening_comments,
            // emergency_mission_comments, closure_mission_comments) sont aussi
            // scannés ici, pas seulement les compétences clés et l'historique
            // archivé — un recruteur qui décrit cette expérience en texte libre sans
            // cocher la case correspondante reste ainsi visible à la recherche.
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

            // Par défaut ('active'), masque les talents dévalidés ET ceux en Liste
            // Rouge — les deux restent dans "talents" en base (choix volontaire du
            // site : ne pas les retirer facilite leur suivi), mais n'ont rien à faire
            // dans la liste courante d'un pool au quotidien. 'devalidated' isole les
            // dévalidés (Liste Rouge ou non). '' (Tous) désactive le filtre.
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

        // Point d'entrée utilisé par applyFiltersAndRender() ci-dessous : filtre
        // (17 critères indépendants) puis trie (5 modes), deux responsabilités
        // propres à filterTalents()/sortTalents() ci-dessus.
        function filterAndSortTalents(talents, f) {
            return sortTalents(filterTalents(talents, f), f);
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
            // avant d'exporter, pour ne jamais produire un fichier tronqué
            // silencieusement. En mode liste complète, currentFilteredTalents est déjà
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
                        let query = TalentsPage.supabaseClient.from('talents').select('*').order(sortColumn, { ascending });
                        if (TalentsPage.currentPoolId) query = query.eq('pool', TalentsPage.currentPoolId);
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
                const sheetName = `Talents ${TalentsPage.currentPoolId || 'pool'}`.substring(0, 31);
                XLSX.utils.book_append_sheet(wb, ws, sheetName);

                const today = new Date().toISOString().slice(0, 10);
                const fileSlug = (TalentsPage.currentPoolId || 'pool').toLowerCase();
                XLSX.writeFile(wb, `talents-${fileSlug}-${today}.xlsx`);
            } catch (err) {
                console.error(err);
                alert("Erreur lors de l'export : " + (err && err.message ? err.message : 'erreur inconnue.'));
            }
        });

        // Exposé sur TalentsPage pour appel depuis l'autre fichier de la page
        TalentsPage.loadTalents = loadTalents;
})();
