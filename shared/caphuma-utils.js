/**
 * Fonctions utilitaires partagées par toutes les pages de Cap Huma. Aucune
 * dépendance à Supabase ni à l'état d'une page précise : ce fichier peut
 * être inclus tel quel sur n'importe quelle page, avant le <script> de la
 * page qui l'utilise.
 */

// Échappe aussi le contexte attribut (data-id="${...}"), pas seulement le texte.
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

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

const EDU_LEVEL_LABELS = {
    none: "Néant", bac: "Bac", "bac+1": "Bac+1", "bac+2": "Bac+2",
    "bac+3": "Bac+3 (Licence)", "bac+4": "Bac+4", "bac+5": "Bac+5 (Master)",
    "bac+6": "Bac+6", "bac+7": "Bac+7", "bac+8+": "Bac+8+ (Doctorat)"
};

const MISSION_COUNT_LABELS = {
    none: "0 mission", one: "1 mission", two: "2 missions", three_plus: "3 missions et +"
};

/**
 * Charge une page de résultats depuis Supabase avec comptage exact.
 *
 * Ne fait aucune hypothèse sur la table ou les filtres : la page appelante
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

    const { data, error, count } = await capHumaWithRetry(() =>
        queryBuilderFn(supabaseClient).range(from, to)
    );

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
 * Génère le HTML des contrôles de pagination (◀ Page X / Y ▶). Purement
 * visuel : les boutons portent data-page-nav="prev"/"next" mais ne sont pas
 * câblés ici — à la page appelante de retrouver ces boutons dans le
 * conteneur qu'elle vient de remplir et d'y attacher ses propres
 * addEventListener juste après l'assignation de innerHTML.
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

const DEVALIDATION_AT_RISK_MONTHS = 20;   // seuil visuel "à risque" (orange)
const DEVALIDATION_CRITICAL_MONTHS = 22;  // seuil visuel "critique" (rouge clair)
const DEVALIDATION_MAX_MONTHS = 24;       // seuil dur : éligible à l'arbitrage dévalider/prolonger

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

    const refDate = new Date(refDateStr);
    const now = new Date();
    const diffMonths = (now.getUTCFullYear() - refDate.getUTCFullYear()) * 12 + (now.getUTCMonth() - refDate.getUTCMonth());
    return Math.max(0, diffMonths);
}

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

/**
 * Affiche la bannière d'erreur générique (#error-banner / #error-message)
 * et fait remonter la page en haut pour garantir sa visibilité.
 * @param {string} msg  Le message d'erreur à afficher
 */
function showError(msg) {
    const banner = document.getElementById('error-banner');
    const txt = document.getElementById('error-message');
    if (!banner || !txt) {
        console.error("[showError] #error-banner/#error-message introuvable(s) sur cette page — message :", msg);
        return;
    }
    txt.textContent = msg;
    banner.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

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

window.addEventListener('offline', () => toastMessage("Connexion perdue — vos actions seront bloquées jusqu'au retour du réseau.", "error"));
window.addEventListener('online', () => toastMessage("Connexion rétablie.", "success"));

/**
 * Rend les modaux (<div role="dialog">) accessibles au clavier : piège
 * Tab/Maj+Tab, ferme sur Échap, mémorise puis restitue le focus.
 * À appeler une seule fois par page, après le rendu du layout.
 */
function capHumaInitModalA11y() {
    const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    document.querySelectorAll('[role="dialog"]').forEach(modal => {
        let lastFocused = null;
        let isOpen = !modal.classList.contains('hidden');

        function getFocusable() {
            return Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR))
                .filter(el => el.offsetParent !== null);
        }

        function handleKeydown(e) {
            if (e.key === 'Escape') {
                e.stopPropagation();
                const dismissBtn = modal.querySelector('[data-modal-dismiss]');
                if (dismissBtn) {
                    dismissBtn.click();
                } else {
                    modal.classList.add('hidden');
                }
                return;
            }
            if (e.key === 'Tab') {
                const focusable = getFocusable();
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }

        function onOpen() {
            lastFocused = document.activeElement;
            const focusable = getFocusable();
            if (focusable.length > 0) focusable[0].focus();
            modal.addEventListener('keydown', handleKeydown);
        }

        function onClose() {
            modal.removeEventListener('keydown', handleKeydown);
            if (lastFocused && typeof lastFocused.focus === 'function') {
                lastFocused.focus();
            }
            lastFocused = null;
        }

        if (isOpen) onOpen();

        new MutationObserver(() => {
            const nowHidden = modal.classList.contains('hidden');
            if (isOpen && nowHidden) {
                isOpen = false;
                onClose();
            } else if (!isOpen && !nowHidden) {
                isOpen = true;
                onOpen();
            }
        }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    });
}

/**
 * Retente un appel Supabase/fetch() sur échec réseau uniquement — jamais si
 * l'appel se résout normalement avec un { error } rempli.
 *
 * @param {Function} callFn  () => Promise — DOIT reconstruire l'appel à
 *        chaque invocation (ne jamais passer une Promise déjà créée).
 * @param {Object} [options]
 * @param {number} [options.attempts=2]
 * @param {number} [options.delayMs=1500]
 * @returns {Promise} Le résultat de callFn() (données + erreur métier
 *        éventuelle, inchangés) — ou relance l'exception réseau d'origine
 *        si toutes les tentatives ont échoué.
 */
async function capHumaWithRetry(callFn, { attempts = 2, delayMs = 1500 } = {}) {
    for (let i = 0; i < attempts; i++) {
        try {
            return await callFn();
        } catch (networkErr) {
            if (i === attempts - 1) throw networkErr;
            console.warn(`[Retry] Tentative ${i + 1}/${attempts} échouée (réseau), nouvel essai dans ${delayMs} ms…`, networkErr);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
}

document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#reportIssueBtn');
    if (!btn) return;

    const report = {
        page: location.href,
        userAgent: navigator.userAgent,
        at: new Date().toISOString(),
        errors: CAP_HUMA_ERROR_BUFFER
    };
    const reportText = JSON.stringify(report, null, 2);

    try {
        await navigator.clipboard.writeText(reportText);
        toastMessage("Rapport copié — collez-le dans un message à l'administrateur.", "success");
    } catch (err) {
        console.warn("[Signaler un problème] Échec de la copie automatique :", err);
        window.prompt(
            "Impossible de copier automatiquement — sélectionnez ce texte (Ctrl/Cmd+C) puis collez-le dans un message à l'administrateur :",
            reportText
        );
    }
});

/**
 * Appelle l'Edge Function "sensitive-reads" plutôt que Supabase directement.
 *
 * @param {Object} supabaseClient
 * @param {string} resource  "red_list" | "extraction" | "audit_logs"
 * @param {Object} [extra]   Champs additionnels envoyés tels quels au corps
 *        de la requête (ex. { page } pour red_list/extraction, ou
 *        { mode, page, filters } pour audit_logs).
 * @returns {Promise<Object>} La réponse JSON de la fonction — sa forme
 *        dépend de la ressource demandée, voir le code de l'Edge Function.
 */
async function fetchSensitiveRead(supabaseClient, resource, extra = {}) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error("Session expirée, veuillez vous reconnecter.");

    const response = await capHumaWithRetry(() =>
        fetch(`${SUPABASE_URL}/functions/v1/sensitive-reads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ resource, ...extra })
        })
    );

    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Erreur lors du chargement des données.");
    return json;
}

/**
 * Injecte un <script src="..."> à la demande, une seule fois même appelée
 * plusieurs fois de suite. À utiliser uniquement pour une bibliothèque dont
 * l'usage est déclenché par une action explicite de la personne — jamais pour
 * un script dont dépend le rendu initial de la page.
 *
 * @param {string} src  Chemin relatif du script (ex. "shared/vendor/xlsx-0.18.5.js")
 * @returns {Promise<void>} Résolue une fois le script chargé et exécuté (ou
 *        immédiatement si déjà chargé) ; rejetée si le chargement échoue —
 *        à la charge de l'appelant d'afficher une erreur, cette fonction
 *        reste générique et ne le fait pas elle-même.
 */
const CAP_HUMA_SCRIPT_PROMISES = {};
function capHumaLoadScriptOnce(src) {
    if (CAP_HUMA_SCRIPT_PROMISES[src]) return CAP_HUMA_SCRIPT_PROMISES[src];

    CAP_HUMA_SCRIPT_PROMISES[src] = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => {
            delete CAP_HUMA_SCRIPT_PROMISES[src];
            reject(new Error(`Échec du chargement de ${src}`));
        };
        document.head.appendChild(script);
    });

    return CAP_HUMA_SCRIPT_PROMISES[src];
}
