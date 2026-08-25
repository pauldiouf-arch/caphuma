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
//  - id-card.html : bouton Retour dynamique (réassigné en JS selon le pool du
//    talent chargé, pas un simple lien statique) — nécessite une adaptation
//    de renderPageLayout() qui n'est pas encore faite. Ne pas l'utiliser sur
//    id-card.html tant que ce point n'a pas été traité explicitement.
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
        actionsHtml = ''
    } = options;

    const mount = document.getElementById('layoutHeaderMount');
    if (!mount) {
        console.error('[caphuma-layout] #layoutHeaderMount introuvable — le header ne peut pas être injecté sur cette page.');
        return;
    }

    const isScrollPage = variant === 'scroll-page';
    const headerClass = isScrollPage
        ? `bg-white border-b border-slate-200 sticky top-0 z-${stickyZ}`
        : 'bg-white border-b border-slate-200 shrink-0 z-10';
    const containerClass = isScrollPage
        ? 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'
        : 'container mx-auto px-6 min-h-16 py-2';
    const rowClass = isScrollPage
        ? 'flex justify-between h-16 items-center'
        : 'flex items-center justify-between gap-4 flex-wrap';

    const titleAttr = titleId ? ` id="${titleId}"` : '';
    const subtitleAttr = subtitleId ? ` id="${subtitleId}"` : '';

    const header = document.createElement('header');
    header.className = headerClass;
    header.innerHTML = `
        <div class="${containerClass}">
            <div class="${rowClass}">
                <div class="flex items-center gap-4">
                    <a href="${escapeHtml(backHref)}" class="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-primary transition-colors shrink-0">
                        <span aria-hidden="true">←</span> Retour
                    </a>
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
                    <button id="logoutBtn" class="text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 px-3 py-1.5 rounded-full transition-all">Déconnexion</button>
                </div>
            </div>
        </div>
    `;

    mount.replaceWith(header);
}
