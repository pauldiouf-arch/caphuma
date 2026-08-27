/**
 * ============================================================================
 * caphuma-idle-timeout.js
 * ----------------------------------------------------------------------------
 * Déconnexion automatique après une période d'inactivité (backlog B14-I2,
 * Master Context §7, priorité P6). Sans ce fichier, une session reste active
 * indéfiniment tant que le rafraîchissement automatique du jeton réussit —
 * sur un poste partagé (contexte terrain plausible), un oubli de déconnexion
 * laisse un accès complet ouvert sans limite de temps.
 *
 * Durée retenue (décision utilisateur, 27/08/2026 — règle 16, jamais
 * tranchée seule par Claude) : 5 HEURES, pas les 30 minutes proposées par
 * défaut dans le sketch initial du Master Context. Motif explicite de
 * l'utilisateur : les recruteurs gardent le site ouvert toute la journée
 * sans y être en continu (recherche ponctuelle d'infos, mise à jour d'une
 * fiche), une déconnexion toutes les 30-60 min serait pénible en usage réel.
 * 5h couvre une journée de travail sans coupure ; la nuit (poste laissé sans
 * surveillance) reste couverte par la consigne de verrouillage manuel du
 * poste, déjà en vigueur côté utilisateurs — hors du périmètre technique de
 * ce fichier.
 *
 * ⚠️ Ce fichier NE DÉMARRE RIEN tout seul au chargement (contrairement au
 * sketch initial du Master Context, qui lançait resetIdle() en bas de
 * fichier). Il expose une seule fonction, capHumaStartIdleTimeout(), à
 * appeler EXPLICITEMENT par la page appelante — et seulement APRÈS que
 * capHumaInitSession() a confirmé une session valide. Démarrer le
 * chronomètre avant ce point (ou sur une page où la session peut ne jamais
 * exister, ex. login.html) n'aurait aucun sens.
 *
 * Portée : les 12 pages PROTÉGÉES du site (celles qui chargent déjà
 * caphuma-auth.js — voir l'en-tête de ce fichier pour la liste), pas
 * login.html/index.html/shared-talent.html (mêmes exclusions que P2/O1 et
 * pour la même raison : pas de session à protéger).
 *
 * Inclure APRÈS shared/caphuma-auth.js (dépendance logique, pas technique :
 * ce fichier n'appelle rien de caphuma-auth.js directement, mais n'a de sens
 * qu'utilisé après capHumaInitSession()).
 * ============================================================================
 */

/**
 * Démarre le chronomètre d'inactivité de la page. À appeler UNE SEULE FOIS
 * par page, juste après confirmation qu'une session valide existe — jamais
 * avant.
 *
 * @param {Object} supabaseClient
 * @param {number} [idleMs=18000000] Délai d'inactivité en millisecondes
 *   avant déconnexion automatique. Par défaut 18 000 000 ms = 5 heures
 *   (décision utilisateur du 27/08/2026). Paramètre exposé UNIQUEMENT pour
 *   permettre un délai raccourci pendant les tests manuels (page pilote) —
 *   ne jamais coder une valeur différente de 5h en production.
 */
function capHumaStartIdleTimeout(supabaseClient, idleMs = 5 * 60 * 60 * 1000) {
    let idleTimer;

    function resetIdle() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(async () => {
            console.warn('[Idle Timeout] Déconnexion automatique après inactivité.');
            await supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        }, idleMs);
    }

    // Toute activité de la personne (clic, frappe clavier, mouvement de
    // souris) relance le chronomètre à zéro — seule une inactivité continue
    // de idleMs déclenche la déconnexion.
    ['click', 'keydown', 'mousemove'].forEach(ev => document.addEventListener(ev, resetIdle));
    resetIdle();
}
