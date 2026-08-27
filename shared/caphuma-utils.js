/**
 * ============================================================================
 * caphuma-utils.js
 * ----------------------------------------------------------------------------
 * Fonctions utilitaires PARTAGÉES par toutes les pages de Cap Huma.
 * Aucune dépendance à Supabase ni à l'état d'une page précise : ce fichier
 * peut être inclus tel quel sur n'importe quelle page avec une simple balise
 * <script src="shared/caphuma-utils.js"></script> placée AVANT le <script>
 * de la page qui l'utilise.
 *
 * Contenu :
 *   1. escapeHtml()          — échappement HTML sûr (texte + attributs)
 *   2. Libellés communs      — STATUS_LABELS, DESK_LABELS, POOL ... etc.
 *   3. Pagination réelle     — helper générique paginateQuery()
 *   4. Seuils de validité pool — DEVALIDATION_AT_RISK_MONTHS/CRITICAL/MAX
 *   5. calculateMonthsWithoutMission()
 *
 * ⚠️ Règle de méthode n°12 (Master Context) : tout innerHTML qui injecte une
 * donnée venant de la base ou d'un formulaire DOIT être échappé, y compris en
 * contexte attribut. escapeHtml() ci-dessous couvre les deux cas.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. ÉCHAPPEMENT HTML
// ----------------------------------------------------------------------------
// Version retenue comme référence unique (c'était déjà la version utilisée par
// 9 pages sur 11 avant la refonte). Elle échappe aussi les guillemets simples
// et doubles, contrairement à la variante "div.textContent / div.innerHTML"
// qui traînait encore dans admin.html et red_list.html : cette dernière ne
// protégeait pas correctement un contexte attribut (ex. value="...", title="...")
// et a donc été corrigée au passage à cette version unique lors de la refonte.
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ----------------------------------------------------------------------------
// 2. LIBELLÉS COMMUNS
// ----------------------------------------------------------------------------
// Regroupés ici pour n'exister qu'à UN seul endroit dans tout le dépôt.
// Si un jour un nouveau statut/desk est ajouté en base, une seule modification
// ici suffit à le refléter partout (au lieu de devoir grep + éditer 3-4 fichiers).
const STATUS_LABELS = {
    occupied: '🟢 Occupé',
    recruiting: '🟡 En recrutement',
    vacant: '⚪ Vacant'
};

const DESK_LABELS = {
    desk1: 'Desk 1',
    desk2: 'Desk 2',
    desk3: 'Desk 3',
    suo: 'SUO'
};

const CANDIDATE_TYPE_LABELS = {
    expat: 'Expatrié',
    nat: 'National'
};

const CONTRACT_STATUS_LABELS = {
    ongoing: 'En cours',
    renewable: 'Renouvelable',
    ending: 'Se termine'
};

// ----------------------------------------------------------------------------
// 3. PAGINATION RÉELLE (générique)
// ----------------------------------------------------------------------------
/**
 * Charge une page de résultats depuis Supabase avec comptage exact.
 *
 * Ne fait AUCUNE hypothèse sur la table ou les filtres : la page appelante
 * construit sa requête (avec ses propres .eq()/.ilike()/.order()...) et la
 * passe ici sous forme de fonction "queryBuilderFn". Ce helper se contente
 * d'ajouter la fenêtre .range() et de retourner (données, total, hasMore).
 *
 * @param {Function} queryBuilderFn  (supabaseClient) => PostgrestFilterBuilder
 *        Doit retourner une requête Supabase déjà filtrée/triée, SANS .range().
 *        Exemple : (c) => c.from('talents').select('*', { count: 'exact' }).eq('pool_id', poolId).order('name')
 * @param {Object} supabaseClient
 * @param {number} page       Page courante, 1-indexée
 * @param {number} pageSize   Nombre de lignes par page
 * @returns {Promise<{data: Array, count: number, page: number, pageSize: number, totalPages: number}>}
 */
async function paginateQuery(queryBuilderFn, supabaseClient, page, pageSize) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const query = queryBuilderFn(supabaseClient).range(from, to);
    const { data, error, count } = await query;

    if (error) throw error;

    const totalPages = count ? Math.max(1, Math.ceil(count / pageSize)) : 1;

    return {
        data: data || [],
        count: count || 0,
        page,
        pageSize,
        totalPages
    };
}

/**
 * Génère le HTML des contrôles de pagination (◀ Page X / Y ▶).
 * Purement visuel — ne prend plus de callbacks onPrev/onNext en paramètres.
 *
 * ⚠️ Changement B3 (25/08/2026, prérequis CSP) : les deux boutons portaient
 * auparavant un attribut onclick="..." construit à partir de chaînes fournies
 * par l'appelant (ex. onclick="goToPage(currentPage - 1)") — incompatible
 * avec une Content-Security-Policy sans 'unsafe-inline' sur script-src.
 * Remplacé par des attributs data-page-nav="prev"/"next" : c'est désormais à
 * la page appelante de retrouver ces boutons dans le conteneur qu'elle vient
 * de remplir et d'y attacher ses propres addEventListener juste après
 * l'assignation de innerHTML (voir devalidated.js, missions.js, red_list.js
 * pour le patron à suivre — sans modules ES, règle 29).
 *
 * @param {number} page
 * @param {number} totalPages
 * @param {number} count
 * @returns {string} HTML prêt à injecter dans un conteneur
 */
function renderPaginationControls(page, totalPages, count) {
    const prevDisabled = page <= 1 ? 'disabled class="opacity-40 cursor-not-allowed"' : '';
    const nextDisabled = page >= totalPages ? 'disabled class="opacity-40 cursor-not-allowed"' : '';
    return `
        <div class="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500 px-1">
            <span>${count} résultat${count > 1 ? 's' : ''}</span>
            <div class="flex items-center gap-2">
                <button type="button" ${prevDisabled} data-page-nav="prev"
                    class="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">◀ Précédent</button>
                <span>Page ${page} / ${totalPages}</span>
                <button type="button" ${nextDisabled} data-page-nav="next"
                    class="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">Suivant ▶</button>
            </div>
        </div>`;
}

// ----------------------------------------------------------------------------
// 4. SEUILS DE VALIDITÉ POOL (centralisés le 18/08/2026)
// ----------------------------------------------------------------------------
// Ces 3 valeurs existaient auparavant copiées en dur à une quinzaine
// d'endroits (talents.html, id-card.html — ×2 chacune — et statistics.html
// ×4 pour la seule valeur 20), avec un vrai risque de divergence si l'une
// changeait un jour sans que les autres suivent. Un seul endroit désormais
// pour tout le JS du site.
//
// ⚠️ Exception assumée, PAS couverte par cette centralisation : les fonctions
// SQL get_pool_talent_stats() (seuil 24) et get_notification_alerts()
// (seuil 20) ont chacune leur propre copie figée côté base — le SQL ne peut
// pas lire une constante JS. Ce sont les 2 SEULES copies qui subsistent
// après cette centralisation (contre ~15 avant) ; à mettre à jour à la main
// si ces valeurs changent un jour (voir sql/schema_snapshot_2026-08-18.sql
// §8, qui documente ce point).
const DEVALIDATION_AT_RISK_MONTHS = 20;   // palier visuel "à risque" (orange)
const DEVALIDATION_CRITICAL_MONTHS = 22;  // palier visuel "critique" (rouge clair)
const DEVALIDATION_MAX_MONTHS = 24;       // seuil dur : éligible à l'arbitrage
                                           // dévalider/prolonger (talents.html,
                                           // isDevalidationEligible()) ; aussi le
                                           // dénominateur des barres de progression
                                           // ("X / 24 mois") sur talents.html et
                                           // id-card.html.

// ----------------------------------------------------------------------------
// 5. CALCUL MÉTIER : ANCIENNETÉ SANS MISSION
// ----------------------------------------------------------------------------
// Corrige le bug n°55 (MC13 §4) : cette fonction existait en 3 copies légèrement
// différentes (id-card.html, statistics.html, talents.html). Deux versions
// calculaient en MOIS CALENDAIRES (année×12 + mois, la méthode correcte),
// une troisième (talents.html) calculait en tranches de 30 jours, ce qui
// surestime légèrement le nombre de mois (une année de 30 jours = 12,17 mois).
//
// Version retenue ici : la méthode calendaire, avec la lecture la plus robuste
// des deux nommages de champs (snake_case ET camelCase) trouvée entre les
// 3 copies d'origine.
//
// ⚠️ Après cette correction, talents.html verra ses chiffres LÉGÈREMENT BAISSER
// par rapport à avant (c'était elle qui surestimait) — ce n'est pas une
// régression, voir MC13 Addendum §2 (U1).
/**
 * Calcule le nombre de mois calendaires écoulés depuis la fin de la dernière
 * mission (ou l'entrée en pool si aucune mission), pour un talent qui n'est
 * pas actuellement en poste.
 *
 * @param {Object} talent  Un enregistrement de la table `talents`
 * @returns {number} Nombre de mois (0 si en poste ALIMA ou si aucune date de référence)
 */
function calculateMonthsWithoutMission(talent) {
    const isCurrentlyOnMission = talent.is_currently_on_mission || talent.isCurrentlyOnAlimaMission;
    const status = talent.status;

    if (status === 'En poste ALIMA' || isCurrentlyOnMission) {
        return talent.months_without_mission || 0;
    }

    const refDateStr = talent.last_mission_end_date || talent.lastMissionEndDate || talent.pool_integration_date || talent.poolIntegrationDate;
    if (!refDateStr) return 0;

    // Correctif B1 (19/08/2026) : getFullYear()/getMonth() utilisent le fuseau
    // horaire LOCAL du navigateur de la personne qui consulte la page — un
    // talent proche d'un changement de mois pouvait donc afficher un chiffre
    // différent selon le fuseau de qui regarde. getUTCFullYear()/getUTCMonth()
    // fixent le calcul sur un référentiel unique, indépendant du visiteur.
    const refDate = new Date(refDateStr);
    const now = new Date();
    const diffMonths = (now.getUTCFullYear() - refDate.getUTCFullYear()) * 12 + (now.getUTCMonth() - refDate.getUTCMonth());
    return Math.max(0, diffMonths);
}

// ----------------------------------------------------------------------------
// 6. NOTIFICATION VISUELLE (toast)
// ----------------------------------------------------------------------------
// Existait en 3 versions divergentes sur 6 pages avant cette factorisation
// (z-index 50 vs 70, durée 3000 vs 3500 ms, et missions.html réutilisait un
// <div id="toast"> statique au lieu d'en créer un dynamiquement). Version
// retenue : création dynamique (comme 5 pages sur 6), z-index 70 (le plus sûr
// — un toast masqué par une modale serait pire qu'un défaut esthétique) et
// 3500 ms (déjà majoritaire). Choix validé avec l'utilisateur.
//
// missions.html gardait un <div id="toast"> devenu inutile dans son HTML :
// laissé en place (masqué, inoffensif) plutôt que retiré, pour limiter le
// risque de cette modification.
/**
 * Affiche une notification temporaire en bas à droite de l'écran.
 * @param {string} msg   Le texte à afficher
 * @param {string} [type="success"]  "success" (vert) ou toute autre valeur (rouge)
 */
function toastMessage(msg, type = "success") {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-5 right-5 px-6 py-3 rounded-2xl shadow-xl text-white font-semibold text-sm transition-all z-[70] transform translate-y-10 opacity-0 duration-300 ${
        type === 'success' ? 'bg-green-600' : 'bg-red-600'
    }`;
    // Correctif P3 (B18-A2, 27/08/2026) : sans ces deux attributs, un lecteur
    // d'écran ne remarque jamais l'apparition de ce toast (il n'a pas le focus
    // et n'est signalé par aucun rôle ARIA) — la confirmation ou l'erreur
    // d'une action reste invisible pour un utilisateur non-voyant.
    // aria-live="polite" : annoncé dès que possible, sans couper la parole
    // sur ce que le lecteur d'écran est déjà en train de lire.
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.remove('translate-y-10', 'opacity-0'), 100);
    setTimeout(() => {
        toast.classList.add('translate-y-10', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ----------------------------------------------------------------------------
// 7. BANNIÈRE D'ERREUR
// ----------------------------------------------------------------------------
// Existait en 4 versions sur les pages internes (admin, id-card, red_list,
// statistics) — 3 identiques, 1 (id-card) avec en plus un scroll vers le haut
// de la page pour garantir que l'erreur est vue. Version retenue : AVEC le
// scroll (choix validé avec l'utilisateur, meilleur pour l'expérience client).
//
// ⚠️ shared-talent.html a AUSSI une fonction showError(), mais ce n'est pas la
// même : signature différente (title + message), cible des éléments HTML
// différents (page d'erreur plein écran, pas une bannière). Volontairement
// NON factorisée ici — laissée locale à cette page.
/**
 * Affiche la bannière d'erreur générique (#error-banner / #error-message)
 * et fait remonter la page en haut pour garantir sa visibilité.
 * @param {string} msg  Le message d'erreur à afficher
 */
function showError(msg) {
    const banner = document.getElementById('error-banner');
    const txt = document.getElementById('error-message');
    // Correctif B1 (19/08/2026) : garde ajoutée — si une page appelante n'a pas
    // ces éléments (ou pas encore, selon le moment de l'appel), on ne plante
    // plus silencieusement ; l'erreur reste au moins tracée en console.
    if (!banner || !txt) {
        console.error("[showError] #error-banner/#error-message introuvable(s) sur cette page — message :", msg);
        return;
    }
    txt.textContent = msg;
    banner.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ----------------------------------------------------------------------------
// 8. INTERCEPTEUR GLOBAL D'ERREURS
// ----------------------------------------------------------------------------
// Backlog B16-O1 (priorité P2). À l'origine dans un fichier séparé
// shared/caphuma-error-monitor.js — regroupé ici le 27/08/2026 (décision
// utilisateur) : un fichier de plus à charger sur chaque page a un coût réseau
// fixe même pour un tout petit fichier (surtout perceptible sur une connexion
// terrain lente), et ce code ne dépend de rien d'autre que toastMessage()
// ci-dessus, déjà dans ce même fichier. Aucun changement de comportement,
// uniquement un déplacement.
//
// Avant ce code, une erreur JS inattendue (exception non interceptée, promesse
// rejetée sans .catch()) mourait silencieusement dans la console — aucun moyen
// de savoir qu'un collègue a rencontré un bug sans qu'il le décrive verbalement.
// Ne remplace ni audit_logs (actions métier volontaires) ni UptimeRobot/B6
// (disponibilité du site) : couvre un troisième cas, les erreurs JS
// inattendues côté navigateur d'un utilisateur déjà sur une page qui répond.
//
// CAP_HUMA_ERROR_BUFFER : les 20 dernières erreurs, en mémoire locale à
// l'onglet uniquement — rien n'est envoyé nulle part par ce code. Sert de
// socle à B16-O2 (bouton "Signaler un problème"), un chantier séparé, pas
// encore fait.
const CAP_HUMA_ERROR_BUFFER = [];

function captureError(kind, detail) {
    CAP_HUMA_ERROR_BUFFER.push({
        kind,
        detail: String(detail),
        page: location.pathname,
        at: new Date().toISOString()
    });
    if (CAP_HUMA_ERROR_BUFFER.length > 20) CAP_HUMA_ERROR_BUFFER.shift();

    console.error(`[${kind}]`, detail);

    if (typeof toastMessage === 'function') {
        toastMessage("Une erreur inattendue s'est produite. Rechargez la page si le problème persiste.", "error");
    }
}

window.addEventListener('error', (e) => captureError('Erreur JS', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => captureError('Promesse rejetée', e.reason));
