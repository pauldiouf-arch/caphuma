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

function capHumaStripControlChars(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
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
    nat: 'National',
    detache: 'Détachement'
};

const STAFF_TYPE_LABELS = {
    expat: 'Expatrié',
    national: 'National'
};

const CONTRACT_END_TYPE_LABELS = {
    date: 'Date fixe',
    cdi: 'CDI',
    ongoing: 'En cours'
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

// queryBuilderFn doit renvoyer une requête sans .range(), ajoutée ici.
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

// Boutons non câblés : la page appelante ajoute ses écouteurs après innerHTML.
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

function capHumaGetValidityStatus(talent) {
    const isInvalid = talent.is_valid === false || talent.isValid === false;
    const isCurrentlyOnMission = talent.is_currently_on_mission || talent.isCurrentlyOnAlimaMission;
    const isPaused = !isInvalid && (isCurrentlyOnMission || talent.status === 'En poste ALIMA');
    const totalMonths = isInvalid ? DEVALIDATION_MAX_MONTHS : calculateMonthsWithoutMission(talent);
    const cappedMonths = Math.min(totalMonths, DEVALIDATION_MAX_MONTHS);
    const progressPercent = (cappedMonths / DEVALIDATION_MAX_MONTHS) * 100;
    const remainingMonths = Math.max(0, DEVALIDATION_MAX_MONTHS - totalMonths);

    const refDate = talent.last_mission_end_date || talent.pool_integration_date || talent.poolIntegrationDate;
    const refLabel = talent.last_mission_end_date ? 'Fin dernière mission' : 'Intégration pool';

    return { isInvalid, isPaused, totalMonths, cappedMonths, progressPercent, remainingMonths, refDate, refLabel };
}

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

    persistErrorLog(kind, detail);
}

async function persistErrorLog(kind, detail) {
    try {
        const client = capHumaGetSupabaseClient();
        const { data: { session } } = await client.auth.getSession();
        if (!session) return;

        await client.from('client_error_logs').insert({
            kind,
            detail: String(detail).slice(0, 2000),
            page: location.pathname,
            user_id: session.user.id,
            user_email: session.user.email
        });
    } catch (_) {
        // Volontairement silencieux.
    }
}

window.addEventListener('error', (e) => captureError('Erreur JS', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => captureError('Promesse rejetée', e.reason));

window.addEventListener('offline', () => toastMessage("Connexion perdue — vos actions seront bloquées jusqu'au retour du réseau.", "error"));
window.addEventListener('online', () => toastMessage("Connexion rétablie.", "success"));

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
 * Retente uniquement sur échec réseau, jamais si l'appel renvoie un { error }.
 * @param {Function} callFn  () => Promise, qui doit reconstruire l'appel à chaque invocation
 * @param {Object} [options]
 * @param {number} [options.attempts=2]
 * @param {number} [options.delayMs=1500]
 */
function capHumaInitTabs(tabList, tabs, panelFor, onSelect) {
    tabList.setAttribute('role', 'tablist');

    function select(activeTab) {
        tabs.forEach(tab => {
            const isSelected = tab === activeTab;
            tab.setAttribute('aria-selected', String(isSelected));
            tab.tabIndex = isSelected ? 0 : -1;
            panelFor(tab).classList.toggle('hidden', !isSelected);
        });
        if (onSelect) onSelect(activeTab);
    }

    tabs.forEach((tab, index) => {
        const panel = panelFor(tab);
        tab.id = tab.id || `${tabList.id}-tab-${index + 1}`;
        panel.id = panel.id || `${tab.id}-panel`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', panel.id);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);

        tab.addEventListener('click', () => select(tab));
        tab.addEventListener('keydown', (event) => {
            const targetIndex = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
            if (targetIndex === undefined) return;
            event.preventDefault();
            const target = tabs[(targetIndex + tabs.length) % tabs.length];
            target.focus();
            select(target);
        });
    });

    return select;
}

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
