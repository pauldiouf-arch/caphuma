// ============================================================================
// shared/caphuma-layout.js — Cap Huma / ALIMA
// Chantier B4 (Master Context §7) : source unique pour le header "retour +
// titre + actions" partagé par les pages de gestion, à la place d'une copie
// quasi identique par page.
//
// HORS PÉRIMÈTRE (volontairement) :
//  - dashboard.html : nav complète + cloche de notifications, structure
//    différente. Traité à part, en 2ᵉ étape du même chantier B4.
//  - index.html / login.html / shared-talent.html : pas de header authentifié
//    (pas de session avant login, page publique sans nav pour shared-talent).
//
// Sans module ES (règle 29 du Master Context) : fichier chargé en <script>
// classique, comme caphuma-utils.js/caphuma-auth.js. La fonction vit donc en
// scope global, exactement comme escapeHtml() dont elle dépend (chargé avant,
// via shared/caphuma-utils.js).
//
// USAGE — dans le HTML de la page, juste après <body ...> :
//   <div id="layoutHeaderMount"></div>
// (remplace l'ancien bloc <header>...</header> copié-collé)
//
// USAGE — dans pages/<nom>.js, tout en haut du fichier, avant tout accès à
// #user-display-name / #logoutBtn et avant checkSession() :
//   renderPageLayout({
//       icon: '📖',
//       title: "Guide d'utilisation",
//       // subtitle par défaut : 'Cap Huma — ALIMA'
//   });
//
// Options complètes :
//   icon          (obligatoire) emoji affiché dans le badge coloré
//   title         (obligatoire) titre affiché à côté de l'icône
//   subtitle      (optionnel, défaut 'Cap Huma — ALIMA') sous-titre sous le titre
//   titleId       (optionnel) id à poser sur le <span> titre, pour les pages
//                 qui le réécrivent en JS au runtime (ex. missions.js réécrit
//                 #pageTitle une fois le pool chargé)
//   subtitleId    (optionnel) id à poser sur le <span> sous-titre, même usage
//                 (ex. #userSubtitle, #poolHeading, #poolSubtitle, #pageHeaderTitle
//                 selon la page)
//   backHref      (optionnel, défaut 'dashboard.html') cible du lien Retour
//   iconGradient  (optionnel, défaut 'from-primary to-accent') classes Tailwind
//                 du dégradé du badge icône — admin.html/statistics.html utilisent
//                 'from-primary to-primary-dark', red_list.html 'from-red-500 to-red-600'
//   variant       (optionnel, défaut 'app-shell')
//                 'app-shell'   : header non collant, conteneur 'container mx-auto px-6'
//                                 (pages à coquille flex-col hauteur fixe : audit_logs,
//                                 devalidated, extraction, guide, missions, talents)
//                 'scroll-page' : header collant (sticky top-0), conteneur
//                                 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'
//                                 (pages à scroll de page normal : admin, import,
//                                 red_list, statistics)
//   stickyZ       (optionnel, défaut 50) z-index du header en variante 'scroll-page'
//   maxWidth      (optionnel, défaut 'max-w-7xl') largeur max du conteneur en
//                 variante 'scroll-page' — import.html utilise 'max-w-5xl'
//   extraHeaderClass (optionnel, défaut '') classes Tailwind ajoutées telles
//                 quelles à la fin du className du <header> — id-card.html
//                 utilise 'shrink-0 no-print' (fiche imprimable)
//   backButton    (optionnel, défaut false) si true, génère un <button id="back-btn">
//                 <span id="back-btn-text">Retour</span></button> au lieu du <a href>
//                 statique habituel — pour les pages qui réassignent la cible en JS
//                 au runtime (id-card.js : dashboard.html par défaut, puis
//                 "talents.html?pool=X" une fois le talent chargé, via
//                 document.getElementById('back-btn').onclick = ...)
//   logoutBtnExtraClass (optionnel, défaut '') classes Tailwind ajoutées à la fin
//                 du className du bouton logout — id-card.html utilise 'no-print'
//   actionsHtml   (optionnel, défaut '') HTML des boutons spécifiques à la page,
//                 inséré juste avant le badge utilisateur + le bouton de déconnexion
// ============================================================================

function renderPageLayout(options) {
    const {
        icon,
        title,
        subtitle = 'Cap Huma — ALIMA',
        titleId = null,
        subtitleId = null,
        backHref = 'dashboard.html',
        iconGradient = 'from-primary to-accent',
        variant = 'app-shell',
        stickyZ = 50,
        maxWidth = 'max-w-7xl',
        extraHeaderClass = '',
        backButton = false,
        logoutBtnExtraClass = '',
        actionsHtml = ''
    } = options;

    const mount = document.getElementById('layoutHeaderMount');
    if (!mount) {
        console.error('[caphuma-layout] #layoutHeaderMount introuvable — le header ne peut pas être injecté sur cette page.');
        return;
    }

    const isScrollPage = variant === 'scroll-page';
    const headerClass = (isScrollPage
        ? `bg-white border-b border-slate-200 sticky top-0 z-${stickyZ}`
        : 'bg-white border-b border-slate-200 shrink-0 z-10') + (extraHeaderClass ? ` ${extraHeaderClass}` : '');
    const containerClass = isScrollPage
        ? `${maxWidth} mx-auto px-4 sm:px-6 lg:px-8`
        : 'container mx-auto px-6 min-h-16 py-2';
    const rowClass = isScrollPage
        ? 'flex justify-between h-16 items-center'
        : 'flex items-center justify-between gap-4 flex-wrap';

    const titleAttr = titleId ? ` id="${titleId}"` : '';
    const subtitleAttr = subtitleId ? ` id="${subtitleId}"` : '';
    const logoutClass = 'text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 px-3 py-1.5 rounded-full transition-all' + (logoutBtnExtraClass ? ` ${logoutBtnExtraClass}` : '');

    // backButton: true → <button id="back-btn"><span id="back-btn-text">...</span></button>,
    // pour les pages qui réassignent la cible en JS au runtime (id-card.js : cible par
    // défaut au chargement, puis "Retour au pool X" une fois le talent chargé). Sinon,
    // lien <a href> statique classique.
    const backElement = backButton
        ? `<button id="back-btn" class="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-primary transition-colors shrink-0">
                        <span aria-hidden="true">←</span> <span id="back-btn-text">Retour</span>
                    </button>`
        : `<a href="${escapeHtml(backHref)}" class="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-primary transition-colors shrink-0">
                        <span aria-hidden="true">←</span> Retour
                    </a>`;

    const header = document.createElement('header');
    header.className = headerClass;
    header.innerHTML = `
        <div class="${containerClass}">
            <div class="${rowClass}">
                <div class="flex items-center gap-4">
                    ${backElement}
                    <div class="hidden sm:block h-8 w-px bg-slate-200"></div>
                    <div class="flex items-center gap-3">
                        <div class="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br ${iconGradient} text-white shadow-md shrink-0">
                            <span class="text-xl">${icon}</span>
                        </div>
                        <div>
                            <span class="font-bold text-lg text-slate-800"${titleAttr}>${escapeHtml(title)}</span>
                            <span class="text-xs block text-slate-400"${subtitleAttr}>${escapeHtml(subtitle)}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-2 flex-wrap justify-end">
                    ${actionsHtml}
                    <span id="user-display-name" class="hidden md:inline text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">Chargement...</span>
                    <button id="logoutBtn" class="${logoutClass}">Déconnexion</button>
                </div>
            </div>
        </div>
    `;

    mount.replaceWith(header);
}

// ============================================================================
// renderDashboardLayout() — 2ᵉ étape de B4 (Master Context §7), dashboard.html
// uniquement. Nav complète (liens conditionnels par rôle) + cloche de
// notifications avec panneau déroulant — structure sans équivalent ailleurs
// sur le site, donc PAS de paramètres : le balisage exact de l'ancien
// <header> de dashboard.html est repris tel quel, aux mêmes id, pour que
// pages/dashboard.js (déjà écrit, non modifié pour B4) continue de
// fonctionner sans aucun changement de sa propre logique.
//
// USAGE — dans pages/dashboard.js, tout en haut du fichier, avant tout accès
// à #userSubtitle / #adminNavGroup / #notifBellBtn / #logoutBtn etc. :
//   renderDashboardLayout();
// ============================================================================
function renderDashboardLayout() {
    const mount = document.getElementById('layoutHeaderMount');
    if (!mount) {
        console.error('[caphuma-layout] #layoutHeaderMount introuvable — le header ne peut pas être injecté sur cette page.');
        return;
    }

    const header = document.createElement('header');
    header.className = 'border-b bg-white shadow-sm shrink-0 z-10';
    header.innerHTML = `
        <div class="container mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <div class="flex items-center gap-3">
                <div class="w-12 h-12 shrink-0 cap-logo-badge">
                    <style>
                        .cap-logo-badge .cap-logo-needle { transform-box: fill-box; transform-origin: center; animation: cap-logo-idle 4s ease-in-out infinite; }
                        .cap-logo-badge:hover .cap-logo-needle { animation: cap-logo-spin 1.1s cubic-bezier(.34,1.56,.64,1) 1; }
                        @keyframes cap-logo-idle { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
                        @keyframes cap-logo-spin { 0% { transform: rotate(0deg); } 70% { transform: rotate(390deg); } 100% { transform: rotate(360deg); } }
                    </style>
                    <svg viewBox="0 0 160 160" class="w-full h-full" role="img" aria-label="Cap Huma">
                        <defs>
                            <linearGradient id="capLogoGradDash" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stop-color="#1d4ed8"/>
                                <stop offset="100%" stop-color="#ea580c"/>
                            </linearGradient>
                        </defs>
                        <circle cx="80" cy="80" r="80" fill="url(#capLogoGradDash)"/>
                        <circle cx="80" cy="80" r="58" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>
                        <g stroke="rgba(255,255,255,0.55)" stroke-width="2" stroke-linecap="round">
                            <line x1="80" y1="16" x2="80" y2="26"/>
                            <line x1="80" y1="134" x2="80" y2="144"/>
                            <line x1="16" y1="80" x2="26" y2="80"/>
                            <line x1="134" y1="80" x2="144" y2="80"/>
                        </g>
                        <g class="cap-logo-needle">
                            <polygon points="80,28 90,80 80,80" fill="#ffffff"/>
                            <polygon points="80,28 70,80 80,80" fill="rgba(255,255,255,0.55)"/>
                            <polygon points="80,132 90,80 80,80" fill="rgba(255,255,255,0.3)"/>
                            <polygon points="80,132 70,80 80,80" fill="rgba(255,255,255,0.15)"/>
                            <circle cx="80" cy="80" r="5" fill="#ffffff"/>
                        </g>
                    </svg>
                </div>
                <div>
                    <h1 class="text-2xl font-extrabold text-slate-800 tracking-tight">Cap Huma</h1>
                    <p class="text-xs text-slate-400 font-semibold mt-1" id="userSubtitle">Tableau de bord</p>
                </div>
            </div>

            <nav class="flex items-center gap-2 flex-wrap justify-end">
                <a href="guide.html" class="border border-emerald-200 hover:bg-emerald-50 text-emerald-700 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    📖 Guide
                </a>
                <a href="extraction.html" id="navExtraction" class="border border-teal-200 hover:bg-teal-50 text-teal-700 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    📤 Extraction
                </a>
                <a href="red_list.html" id="navRedList" class="border border-orange-200 hover:bg-orange-50 text-orange-700 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    ⚠️ Liste Rouge
                </a>
                <a href="devalidated.html" id="navDevalidated" class="border border-red-200 hover:bg-red-50 text-red-700 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    ⛔ Dévalidés
                </a>
                <a href="statistics.html" class="bg-primary-light hover:bg-blue-100 text-primary px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    📊 Hub Statistique &amp; IA
                </a>

                <span id="adminNavGroup" class="hidden items-center gap-2">
                    <span class="h-6 w-px bg-slate-200 mx-1"></span>
                    <a href="admin.html" class="bg-slate-800 hover:bg-slate-900 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                        🛡️ Admin
                    </a>
                    <a href="import.html" class="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                        📥 Import
                    </a>
                    <a href="audit_logs.html" class="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                        📋 Audit
                    </a>
                </span>

                <!-- Correctif P4 (B18-A6, 27/08/2026) : ces deux boutons n'affichent
                     qu'une icône, sans texte visible. "title" seul ne suffit pas
                     pour un lecteur d'écran (pas systématiquement lu) — aria-label
                     fournit le vrai nom accessible du bouton, en plus de "title"
                     conservé pour l'infobulle au survol de la souris. -->
                <span class="relative">
                    <button id="notifBellBtn" type="button" class="hidden relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all shrink-0" title="Notifications" aria-label="Notifications" aria-expanded="false">
                        <span class="text-lg">🔔</span>
                        <span id="notifBadge" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center"></span>
                    </button>

                    <div id="notifPanel" class="hidden absolute right-0 top-12 w-96 max-h-[32rem] overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-xl z-50">
                        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 class="font-bold text-slate-800 text-sm">🔔 Mes notifications</h3>
                            <button id="notifSettingsToggleBtn" type="button" class="text-xs font-semibold text-primary hover:underline">Préférences</button>
                        </div>

                        <div id="notifSettingsBlock" class="hidden p-4 border-b border-slate-100 bg-slate-50 space-y-3">
                            <label class="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                <input type="checkbox" id="notifEnabledCheckbox" class="rounded border-slate-300">
                                Activer les notifications
                            </label>
                            <div id="notifPoolScopeBlock" class="space-y-2">
                                <label class="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                    <input type="radio" name="notifScope" id="notifScopeAll" value="all" checked>
                                    Tous mes pools
                                </label>
                                <label class="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                    <input type="radio" name="notifScope" id="notifScopeCustom" value="custom">
                                    Choisir les pools à suivre
                                </label>
                                <div id="notifPoolChecklist" class="hidden ml-5 space-y-1.5 max-h-32 overflow-y-auto"></div>
                            </div>
                            <button id="notifSavePrefsBtn" type="button" class="w-full bg-primary hover:bg-primary-dark text-white text-xs font-bold py-2 rounded-lg transition-all">
                                Enregistrer
                            </button>
                        </div>

                        <div id="notifAlertsList" class="p-4 space-y-4 text-sm text-slate-600">
                            <p class="text-xs text-slate-400 text-center py-4">Chargement...</p>
                        </div>
                    </div>
                </span>

                <button id="logoutBtn" class="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all shrink-0" title="Déconnexion" aria-label="Se déconnecter">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25" />
                    </svg>
                </button>
            </nav>
        </div>
    `;

    mount.replaceWith(header);
}
