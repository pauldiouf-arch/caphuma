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
 * Purement visuel — la page appelante fournit les callbacks onPrev/onNext
 * via des attributs onclick ciblant des fonctions déjà globales sur la page
 * (ex. onclick="goToPage(currentPage - 1)"), pour rester compatible avec le
 * modèle "pas de framework" du projet.
 *
 * @param {number} page
 * @param {number} totalPages
 * @param {number} count
 * @param {string} prevOnclick  ex. "goToPage(currentPage - 1)"
 * @param {string} nextOnclick  ex. "goToPage(currentPage + 1)"
 * @returns {string} HTML prêt à injecter dans un conteneur
 */
function renderPaginationControls(page, totalPages, count, prevOnclick, nextOnclick) {
    const prevDisabled = page <= 1 ? 'disabled class="opacity-40 cursor-not-allowed"' : '';
    const nextDisabled = page >= totalPages ? 'disabled class="opacity-40 cursor-not-allowed"' : '';
    return `
        <div class="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500 px-1">
            <span>${count} résultat${count > 1 ? 's' : ''}</span>
            <div class="flex items-center gap-2">
                <button type="button" ${prevDisabled} onclick="${escapeHtml(prevOnclick)}"
                    class="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">◀ Précédent</button>
                <span>Page ${page} / ${totalPages}</span>
                <button type="button" ${nextDisabled} onclick="${escapeHtml(nextOnclick)}"
                    class="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">Suivant ▶</button>
            </div>
        </div>`;
}
