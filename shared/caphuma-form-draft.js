/**
 * Sauvegarde locale (brouillon) du contenu d'un formulaire en cours de
 * saisie, pour ne pas perdre une saisie longue en cas de fermeture d'onglet,
 * crash du navigateur, ou rechargement pendant une erreur affichée.
 *
 * Stockage en sessionStorage, pas localStorage : un brouillon ne doit
 * survivre qu'à l'onglet qui l'a écrit, jamais traverser vers un autre poste
 * ou un autre navigateur.
 *
 * Inclure après caphuma-utils.js.
 */

/**
 * Sauvegarde un brouillon. N'échoue jamais bruyamment : un problème
 * d'écriture locale ne doit jamais bloquer la saisie en cours.
 * @param {string} draftKey
 * @param {Object} data  Doit être sérialisable en JSON (pas de File/Blob).
 */
function capHumaDraftSave(draftKey, data) {
    try {
        sessionStorage.setItem(draftKey, JSON.stringify(data));
    } catch (e) {
        console.warn("[Draft] Échec de la sauvegarde locale :", e);
    }
}

/**
 * Relit un brouillon.
 * @param {string} draftKey
 * @returns {Object|null} null si absent, illisible, ou si sessionStorage
 *        n'est pas disponible (navigation privée stricte sur certains
 *        navigateurs) — jamais d'exception remontée à l'appelant.
 */
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

/**
 * Efface un brouillon — à appeler après un enregistrement réussi, ou sur un
 * refus explicite de restauration. Jamais sur un simple Annuler/×/Fermer
 * (voir capHumaAttachDraftAutosave ci-dessous).
 * @param {string} draftKey
 */
function capHumaDraftClear(draftKey) {
    try {
        sessionStorage.removeItem(draftKey);
    } catch (e) {
        console.warn("[Draft] Échec de la suppression du brouillon :", e);
    }
}

// Collecte par défaut : champs portant name= OU id= (certains formulaires
// n'ont que id=). Les champs "non standard" (tags en chips, lignes
// dynamiques sans name=) fournissent leur propre collect()/restore(), voir
// options.collect ci-dessous. Les <input type="file"> sont ignorés, jamais
// stockés en sessionStorage.
function capHumaDefaultDraftCollect(containerEl) {
    const data = {};
    containerEl.querySelectorAll('input[name], input[id], textarea[name], textarea[id], select[name], select[id]').forEach(el => {
        if (el.type === 'file') return;
        const key = el.name || el.id;
        data[key] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
    });
    return data;
}

/**
 * Restauration symétrique de capHumaDefaultDraftCollect() ci-dessus.
 * @param {HTMLElement} containerEl
 * @param {Object} data
 */
function capHumaDefaultDraftRestore(containerEl, data) {
    Object.entries(data || {}).forEach(([key, value]) => {
        const el = containerEl.querySelector(`[name="${key}"]`) || document.getElementById(key);
        if (!el || !containerEl.contains(el)) return;
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!value;
        else el.value = value;
    });
}

/**
 * Branche l'autosave d'un brouillon sur un conteneur de champs (un <form>,
 * ou une simple <div> englobante pour les modales sans balise <form> native).
 *
 * @param {HTMLElement} containerEl  Élément englobant les champs à surveiller
 * @param {string} draftKey          Propre au contexte, ex.
 *        `draft:talent:edit:${talentId}`.
 * @param {Object} [options]
 * @param {Function} [options.collect]  () => objet sérialisable, OU
 *        `undefined` pour signaler "rien à sauvegarder cette fois" (ex. un
 *        formulaire de création réutilisé pour éditer une entrée existante,
 *        le temps de cette édition). Un `undefined` explicite n'écrit RIEN
 *        en sessionStorage : le brouillon déjà présent, s'il y en a un,
 *        reste intact plutôt que d'être écrasé par un contenu qui n'a rien
 *        à voir. Par défaut capHumaDefaultDraftCollect(containerEl).
 * @param {number} [options.debounceMs=500]  Délai après la dernière frappe
 *        avant écriture en sessionStorage.
 * @returns {{ stop: Function, saveNow: Function }}
 *        stop() retire les écouteurs SANS effacer le brouillon — fermer une
 *        modale (Annuler/×) n'est pas forcément un abandon délibéré, effacer
 *        à ce moment-là irait à l'encontre du but même de ce module. Seuls
 *        un enregistrement réussi (capHumaDraftClear()) ou un refus explicite
 *        de restauration (voir capHumaOfferDraftRestore ci-dessous) effacent
 *        le brouillon. saveNow() force une sauvegarde immédiate, sans
 *        attendre le debounce.
 */
function capHumaAttachDraftAutosave(containerEl, draftKey, options = {}) {
    const debounceMs = options.debounceMs != null ? options.debounceMs : 500;
    const collect = options.collect || (() => capHumaDefaultDraftCollect(containerEl));

    let timer = null;

    function saveNow() {
        clearTimeout(timer);
        try {
            const data = collect();
            if (data === undefined) return; // rien à sauvegarder cette fois (voir JSDoc ci-dessus)
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

/**
 * Point d'entrée recommandé à l'ouverture d'un formulaire/modale. Si un
 * brouillon existe pour cette clé, demande confirmation via window.confirm()
 * puis :
 *   - accepté  : restaure via restoreFn(data)
 *   - refusé   : efface le brouillon (on ne redemande pas indéfiniment)
 *
 * @param {string} draftKey
 * @param {Function} restoreFn  (data) => void — remplit les champs concernés
 * @param {string} [message]
 * @returns {boolean} true si un brouillon a été restauré
 */
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
