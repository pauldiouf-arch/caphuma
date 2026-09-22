// sessionStorage volontaire : un brouillon ne doit pas survivre à l'onglet.

function capHumaDraftSave(draftKey, data) {
    try {
        sessionStorage.setItem(draftKey, JSON.stringify(data));
    } catch (e) {
        console.warn("[Draft] Échec de la sauvegarde locale :", e);
    }
}

function capHumaDraftLoad(draftKey) {
    try {
        const raw = sessionStorage.getItem(draftKey);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.warn("[Draft] Échec de la lecture du brouillon (ignoré) :", e);
        return null;
    }
}

// Après un enregistrement réussi ou un refus de restauration uniquement, jamais sur Annuler.
function capHumaDraftClear(draftKey) {
    try {
        sessionStorage.removeItem(draftKey);
    } catch (e) {
        console.warn("[Draft] Échec de la suppression du brouillon :", e);
    }
}

function capHumaDefaultDraftCollect(containerEl) {
    const data = {};
    containerEl.querySelectorAll('input[name], input[id], textarea[name], textarea[id], select[name], select[id]').forEach(el => {
        if (el.type === 'file') return;
        const key = el.name || el.id;
        data[key] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
    });
    return data;
}

function capHumaDefaultDraftRestore(containerEl, data) {
    Object.entries(data || {}).forEach(([key, value]) => {
        const el = containerEl.querySelector(`[name="${key}"]`) || document.getElementById(key);
        if (!el || !containerEl.contains(el)) return;
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!value;
        else el.value = value;
    });
}

// options.collect peut renvoyer undefined : rien n'est écrit, le brouillon existant reste intact.
function capHumaAttachDraftAutosave(containerEl, draftKey, options = {}) {
    const debounceMs = options.debounceMs != null ? options.debounceMs : 500;
    const collect = options.collect || (() => capHumaDefaultDraftCollect(containerEl));

    let timer = null;

    function saveNow() {
        clearTimeout(timer);
        try {
            const data = collect();
            if (data === undefined) return; // rien à sauvegarder cette fois
            capHumaDraftSave(draftKey, data);
        } catch (e) {
            console.warn("[Draft] Échec de la collecte du formulaire :", e);
        }
    }

    function scheduleSave() {
        clearTimeout(timer);
        timer = setTimeout(saveNow, debounceMs);
    }

    containerEl.addEventListener('input', scheduleSave);
    containerEl.addEventListener('change', scheduleSave);

    return {
        stop() {
            clearTimeout(timer);
            containerEl.removeEventListener('input', scheduleSave);
            containerEl.removeEventListener('change', scheduleSave);
        },
        saveNow
    };
}

function capHumaOfferDraftRestore(draftKey, restoreFn, message) {
    const data = capHumaDraftLoad(draftKey);
    if (!data) return false;

    const confirmMsg = message || "Un brouillon non enregistré a été trouvé pour ce formulaire. Le restaurer ?";

    if (window.confirm(confirmMsg)) {
        try {
            restoreFn(data);
            return true;
        } catch (e) {
            console.warn("[Draft] Échec de la restauration, brouillon écarté :", e);
            capHumaDraftClear(draftKey);
            return false;
        }
    }

    capHumaDraftClear(draftKey);
    return false;
}
