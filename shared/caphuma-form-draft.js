/**
 * ============================================================================
 * caphuma-form-draft.js
 * ----------------------------------------------------------------------------
 * Sauvegarde locale (brouillon) du contenu d'un formulaire en cours de
 * saisie — backlog B15-R1, priorité P20 du tableau P1-P30 (Master Context §7).
 *
 * Problème corrigé : aucune perte de saisie tant qu'un formulaire reste
 * ouvert (confirmé, voir Master Context §2), mais rien ne protège contre une
 * fermeture d'onglet, un crash du navigateur, ou un rechargement pendant une
 * erreur affichée — tout le texte saisi est alors perdu sans recours. Le
 * plus pénalisant sur les formulaires à saisie longue (fiche talent,
 * évaluations, motifs Liste Rouge, commentaires).
 *
 * Portée tranchée avec l'utilisateur (échange du 01/09/2026, avant tout
 * code — règle 34) :
 *   - talentForm (talents.js) — création ET édition
 *   - evaluationForm (missions.js) — CRÉATION uniquement. Pas en édition
 *     d'une évaluation existante : le formulaire est pré-rempli depuis le
 *     cache local à l'édition, restaurer un brouillon par-dessus risquerait
 *     d'écraser cette pré-lecture avec un brouillon d'un autre contexte.
 *   - les 3 implémentations indépendantes du motif "Ajouter à la Liste
 *     Rouge" (red_list.js, devalidated.js, id-card.js — fichiers joints
 *     exclus, jamais stockés ici)
 *   - new-comment-input (id-card.js)
 * Explicitement HORS PÉRIMÈTRE (décision utilisateur) : missionForm (postes)
 * — champs courts, risque de perte faible — et l'édition inline d'un
 * commentaire existant (id-card.js) — le contenu original est déjà en base,
 * risque bien moindre qu'une création.
 *
 * Stockage : sessionStorage, PAS localStorage (déjà utilisé ailleurs pour le
 * cache de secours des pools dans dashboard.js, sans rapport) — un brouillon
 * ne doit survivre qu'à l'onglet qui l'a écrit, jamais traverser vers un
 * autre poste ou un autre navigateur.
 *
 * Effacement du brouillon — décision RÉVISÉE après test en conditions
 * réelles (01/09/2026, Lot 2 / talentForm — même méthode que pour affiner
 * P19 sur manage-users, voir Master Context §7 B15-R2) : la version initiale
 * prévoyait un effacement immédiat sur Annuler/×, en assimilant ce clic à un
 * abandon délibéré. En pratique, fermer la boîte de cette façon sert aussi
 * simplement à « sortir provisoirement » sans avoir tranché — effacer
 * immédiatement dans ce cas va à l'encontre du but même de R1 (aucun moyen
 * de sortir sans soit enregistrer, soit perdre la saisie pour de bon).
 *
 * Règle retenue, pour TOUTES les pages qui utilisent ce module :
 *   - Annuler/×/Fermer  → arrêter seulement l'autosave (stop() sur la valeur
 *     retournée par capHumaAttachDraftAutosave), NE PAS appeler
 *     capHumaDraftClear() ici.
 *   - Enregistrement réussi → capHumaDraftClear().
 *   - Refus EXPLICITE de restauration à la réouverture (répondre « non » au
 *     confirm()) → déjà effacé automatiquement par capHumaOfferDraftRestore()
 *     ci-dessous (§4) : on ne redemande pas indéfiniment, mais ça reste un
 *     choix explicite de l'utilisateur, pas une fermeture accidentelle.
 *
 * Inclure APRÈS caphuma-utils.js (aucune dépendance stricte à ce jour, mais
 * cohérent avec l'ordre déjà en place dans le <head> des pages).
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. STOCKAGE BAS NIVEAU (sessionStorage, essai/attrape comme le reste du site)
// ----------------------------------------------------------------------------
/**
 * Sauvegarde un brouillon. N'échoue jamais bruyamment (même logique que
 * capHumaLogAudit() dans caphuma-auth.js) : un problème d'écriture locale ne
 * doit jamais bloquer la saisie en cours.
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
 * Efface un brouillon — à appeler après un enregistrement réussi ET sur un
 * abandon volontaire (Annuler/×/Fermer), voir note d'en-tête.
 * @param {string} draftKey
 */
function capHumaDraftClear(draftKey) {
    try {
        sessionStorage.removeItem(draftKey);
    } catch (e) {
        console.warn("[Draft] Échec de la suppression du brouillon :", e);
    }
}

// ----------------------------------------------------------------------------
// 2. COLLECTE / RESTAURATION PAR DÉFAUT
// ----------------------------------------------------------------------------
// Couvre le cas simple : des champs <input>/<textarea>/<select> portant
// name= OU id= (evaluationForm, les 3 motifs Liste Rouge et new-comment-input
// n'ont que id=, voir Dossier de passation — la version [name] seule du
// sketch initial du backlog aurait silencieusement capté zéro champ sur ces
// 4 formulaires). Les fichiers (<input type="file">) sont ignorés : jamais
// stockés en sessionStorage.
//
// Ne couvre PAS les champs "non standard" (tags en chips, lignes dynamiques
// sans name= — voir talentForm) : ces cas fournissent leur propre collect()/
// restore() en réutilisant les fonctions déjà existantes de leur page
// (getTagValues()/setTagValues(), getTrainingsValues()) plutôt que de
// dupliquer cette logique ici.
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

// ----------------------------------------------------------------------------
// 3. BRANCHEMENT DE L'AUTOSAVE
// ----------------------------------------------------------------------------
/**
 * Branche l'autosave d'un brouillon sur un conteneur de champs (un <form>,
 * ou une simple <div> englobante pour les modales sans balise <form> native
 * — cas des 3 motifs Liste Rouge).
 *
 * @param {HTMLElement} containerEl  Élément englobant les champs à surveiller
 * @param {string} draftKey          Propre au contexte, ex.
 *        `draft:talent:edit:${talentId}` — voir chaque page pour son schéma
 *        de clé complet.
 * @param {Object} [options]
 * @param {Function} [options.collect]  () => objet sérialisable, OU
 *        `undefined` pour signaler "rien à sauvegarder cette fois" (ex. un
 *        formulaire de création réutilisé pour éditer une entrée existante,
 *        le temps de cette édition — voir missions.js/evaluationForm, P21).
 *        Un `undefined` explicite n'écrit RIEN en sessionStorage : le
 *        brouillon déjà présent, s'il y en a un, reste intact plutôt que
 *        d'être écrasé par un contenu qui n'a rien à voir. Par défaut
 *        capHumaDefaultDraftCollect(containerEl) — à fournir explicitement
 *        dès que le formulaire a des champs non standard (voir §2).
 * @param {number} [options.debounceMs=500]  Délai après la dernière frappe
 *        avant écriture en sessionStorage (même ordre de grandeur que le
 *        délai de retry P19 — évite d'écrire à chaque caractère tapé).
 * @returns {{ stop: Function, saveNow: Function }}
 *        stop() retire les écouteurs (rarement nécessaire : les modaux du
 *        site ne sont jamais détruits, exposé par cohérence avec le reste
 *        de l'API). saveNow() force une sauvegarde immédiate, sans attendre
 *        le debounce (utile juste avant un changement d'onglet de la
 *        modale talent, par exemple).
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

// ----------------------------------------------------------------------------
// 4. OFFRE DE RESTAURATION (à l'ouverture d'un formulaire/modale)
// ----------------------------------------------------------------------------
/**
 * Point d'entrée recommandé à l'ouverture d'un formulaire/modale. Si un
 * brouillon existe pour cette clé, demande confirmation via window.confirm()
 * — cohérent avec les confirmations déjà utilisées ailleurs sur le site (ex.
 * suppression d'un commentaire, id-card.js) — puis :
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
