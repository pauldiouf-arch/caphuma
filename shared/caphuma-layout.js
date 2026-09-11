/**
 * Source unique pour le header "retour + titre + actions" partagé par les
 * pages de gestion. Fichier chargé en <script> classique (pas de module ES),
 * la fonction vit donc en scope global, comme escapeHtml() dont elle dépend
 * (chargé avant, via shared/caphuma-utils.js).
 *
 * Hors périmètre : dashboard.html a sa propre fonction ci-dessous
 * (structure sans équivalent ailleurs) ; index.html / login.html /
 * shared-talent.html n'ont pas de header authentifié.
 *
 * Usage — dans le HTML de la page, juste après <body ...> :
 *   <div id="layoutHeaderMount"></div>
 *
 * Usage — dans pages/<nom>.js, tout en haut du fichier, avant tout accès à
 * #user-display-name / #logoutBtn et avant checkSession() :
 *   renderPageLayout({ icon: CapHumaIcons.get('bookOpen', 'w-5 h-5'), title: "Guide d'utilisation" });
 */

/**
 * Pose un lien d'évitement ("Aller au contenu principal") comme tout premier
 * enfant de <body>, ciblant le <main> de la page. tabindex="-1" posé sur
 * <main> pour qu'il devienne une cible de focus programmatique valide sans
 * entrer dans l'ordre de tabulation normal.
 *
 * Appelé une fois par renderPageLayout() et renderDashboardLayout().
 * index.html/login.html (hors périmètre) ont leur propre lien statique posé
 * directement dans leur HTML.
 */
function capHumaEnsureSkipLink() {
    if (document.getElementById('skipToMainLink')) return;

    const main = document.querySelector('main');
    if (!main) {
        console.error('[caphuma-layout] <main> introuvable — lien d\'évitement non posé sur cette page.');
        return;
    }
    if (!main.id) {
        main.id = 'main-content';
    }
    main.setAttribute('tabindex', '-1');

    const skipLink = document.createElement('a');
    skipLink.id = 'skipToMainLink';
    skipLink.href = `#${main.id}`;
    skipLink.className = 'sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:bg-white focus:text-primary focus:font-bold focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:outline focus:outline-2 focus:outline-primary';
    skipLink.textContent = 'Aller au contenu principal';

    document.body.insertBefore(skipLink, document.body.firstChild);
}

/**
 * @param {Object} options
 * @param {string} options.icon          (obligatoire) emoji affiché dans le badge coloré
 * @param {string} options.title         (obligatoire) titre affiché à côté de l'icône
 * @param {string} [options.subtitle='Cap Huma — ALIMA']
 * @param {string} [options.titleId]     id à poser sur le <span> titre, pour les pages
 *        qui le réécrivent en JS au runtime (ex. missions.js une fois le pool chargé)
 * @param {string} [options.subtitleId]  id à poser sur le <span> sous-titre, même usage
 * @param {string} [options.backHref='dashboard.html']
 * @param {string} [options.iconGradient='from-primary to-accent']  classes Tailwind du dégradé du badge icône
 * @param {string} [options.variant='app-shell']
 *        'app-shell'   : header non collant, pages à coquille flex-col hauteur fixe
 *        'scroll-page' : header collant (sticky top-0), pages à scroll de page normal
 * @param {number} [options.stickyZ=50]  z-index du header en variante 'scroll-page'
 * @param {string} [options.maxWidth='max-w-7xl']  largeur max du conteneur en variante 'scroll-page'
 * @param {string} [options.extraHeaderClass='']  classes ajoutées à la fin du className du <header>
 * @param {boolean} [options.backButton=false]  si true, génère un <button id="back-btn">
 *        au lieu du <a href> statique habituel, pour les pages qui réassignent la
 *        cible en JS au runtime (ex. id-card.js selon le contexte de la fiche)
 * @param {string} [options.logoutBtnExtraClass='']  classes ajoutées au bouton logout
 * @param {string} [options.actionsHtml='']  HTML des boutons spécifiques à la page,
 *        inséré juste avant le badge utilisateur + le bouton de déconnexion
 */
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

    capHumaEnsureSkipLink();

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
                            <span class="text-xs block text-slate-500"${subtitleAttr}>${escapeHtml(subtitle)}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-2 flex-wrap justify-end">
                    ${actionsHtml}
                    <button id="reportIssueBtn" type="button" title="Copier un rapport technique à transmettre à l'administrateur" class="hidden md:inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-600 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/></svg> Signaler un problème
                    </button>
                    <span id="user-display-name" class="hidden md:inline text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">Chargement...</span>
                    <button id="logoutBtn" class="${logoutClass}">Déconnexion</button>
                </div>
            </div>
        </div>
    `;

    mount.replaceWith(header);
}

/**
 * Header de dashboard.html uniquement : nav complète (liens conditionnels
 * par rôle) + cloche de notifications avec panneau déroulant, structure sans
 * équivalent ailleurs sur le site — pas de paramètres, le balisage reprend
 * exactement les mêmes id que l'ancien <header> pour que pages/dashboard.js
 * continue de fonctionner sans changement.
 *
 * Usage — dans pages/dashboard.js, tout en haut du fichier, avant tout accès
 * à #userSubtitle / #adminNavGroup / #notifBellBtn / #logoutBtn etc. :
 *   renderDashboardLayout();
 */
function renderDashboardLayout() {
    const mount = document.getElementById('layoutHeaderMount');
    if (!mount) {
        console.error('[caphuma-layout] #layoutHeaderMount introuvable — le header ne peut pas être injecté sur cette page.');
        return;
    }

    capHumaEnsureSkipLink();

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
                    <p class="text-xs text-slate-500 font-semibold mt-1" id="userSubtitle">Tableau de bord</p>
                </div>
            </div>

            <nav class="flex items-center gap-2 flex-wrap justify-end">
                <a href="guide.html" class="border border-emerald-200 hover:bg-emerald-50 text-emerald-700 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"/></svg> Guide
                </a>
                <a href="extraction.html" id="navExtraction" class="border border-teal-200 hover:bg-teal-50 text-teal-700 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"/></svg> Extraction
                </a>
                <a href="red_list.html" id="navRedList" class="border border-orange-200 hover:bg-orange-50 text-orange-700 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg> Liste Rouge
                </a>
                <a href="devalidated.html" id="navDevalidated" class="border border-red-200 hover:bg-red-50 text-red-700 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"/></svg> Dévalidés
                </a>
                <a href="statistics.html" class="bg-primary-light hover:bg-blue-100 text-primary px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/></svg> Hub Statistique &amp; IA
                </a>

                <span id="adminNavGroup" class="hidden items-center gap-2">
                    <span class="h-6 w-px bg-slate-200 mx-1"></span>
                    <a href="admin.html" class="bg-slate-800 hover:bg-slate-900 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"/></svg> Admin
                    </a>
                    <a href="import.html" class="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3.75H6.912a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H15M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859M12 3v8.25m0 0-3-3m3 3 3-3"/></svg> Import
                    </a>
                    <a href="audit_logs.html" class="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z"/></svg> Audit
                    </a>
                </span>

                <!-- title seul ne suffit pas pour un lecteur d'écran : aria-label
                     fournit le nom accessible de ces boutons icône-seule, en plus
                     de title pour l'infobulle au survol de la souris. -->
                <span class="relative">
                    <button id="notifBellBtn" type="button" class="hidden relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all shrink-0" title="Notifications" aria-label="Notifications" aria-expanded="false">
                        <span class="text-lg"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/></svg></span>
                        <span id="notifBadge" aria-live="polite" class="hidden absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center"></span>
                    </button>

                    <div id="notifPanel" class="hidden absolute right-0 top-12 w-96 max-h-[32rem] overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-xl z-50">
                        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 class="font-bold text-slate-800 text-sm"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/></svg> Mes notifications</h3>
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
                            <p class="text-xs text-slate-500 text-center py-4">Chargement...</p>
                        </div>
                    </div>
                </span>

                <button id="reportIssueBtn" type="button" title="Copier un rapport technique à transmettre à l'administrateur" class="hidden md:inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-600 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/></svg> Signaler un problème
                </button>

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
