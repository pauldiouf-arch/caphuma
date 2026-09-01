/**
 * ============================================================================
 * caphuma-config.js
 * ----------------------------------------------------------------------------
 * Source UNIQUE de la configuration Supabase publique (URL + clé "publishable").
 * Remplace 3 endroits qui existaient avant, séparément (MC13 Addendum §1.3/1.5) :
 *   - index.html / login.html, qui codaient la clé en dur puis la recopiaient
 *     dans localStorage ("le pont") ;
 *   - les 12 pages protégées, qui lisaient ce pont ;
 *   - shared-talent.html, qui avait sa PROPRE copie en dur (le pont ne
 *     fonctionne pas pour un visiteur arrivant par lien de partage).
 *
 * La clé "publishable" est conçue par Supabase pour être publique : la sécurité
 * réelle repose sur les policies RLS + les GRANT SQL côté serveur, pas sur le
 * secret de cette clé.
 *
 * Inclure en PREMIER dans le <head> de chaque page (avant tout script qui en
 * a besoin), à la manière de shared/caphuma-utils.js et shared/caphuma-auth.js.
 * ============================================================================
 */
const SUPABASE_URL = "https://bhjycotcmkqiumukkkih.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_mtQU2zMhbkCPZjgCX3Z4hw_POMFm_ml";

/**
 * ============================================================================
 * DÉCISION N°7 — STOCKAGE DE LA SESSION (backlog B14-I1, priorité P22)
 * ----------------------------------------------------------------------------
 * TRANCHÉ le 01/09/2026 (décision utilisateur) : on GARDE le comportement par
 * défaut de supabase-js (`persistSession: true`, implicite — chaque page
 * appelle `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` SANS surcharger
 * `auth.storage`/`persistSession`, et ce doit rester le cas). Les jetons
 * (access_token/refresh_token) restent donc dans `localStorage`, sous la clé
 * `sb-<ref>-auth-token`.
 *
 * Alternative écartée : stockage en mémoire JS + cookie httpOnly/Secure porté
 * par une Edge Function dédiée — refonte transverse de l'initialisation de
 * supabaseClient sur les 15 pages, réservée à la reprise IT ou à l'apparition
 * réelle d'un vecteur XSS, PAS à faire préventivement.
 *
 * Pourquoi (motifs utilisateur, 01/09/2026 — outil interne, priorité donnée à
 * la performance) :
 *   - Aucune faille XSS active trouvée sur 3 audits de sécurité successifs —
 *     le risque de `localStorage` (vol de jeton en cas de XSS) n'est
 *     aujourd'hui pas exploitable.
 *   - La Content-Security-Policy stricte déjà en place (`script-src 'self'`,
 *     sans `unsafe-inline` ni `unsafe-eval` — voir audit_logs.html pour le
 *     détail) mitige la CAUSE (l'injection de script) plutôt que le seul
 *     symptôme.
 *   - Outil interne, pas d'exposition publique large.
 *   - Un stockage en mémoire pure ne survit pas à un rechargement de page
 *     (F5) sans un aller-retour vers l'Edge Function à chaque chargement —
 *     nouveau point de défaillance au démarrage, coût de performance/
 *     résilience jugé disproportionné face à un risque non exploitable
 *     aujourd'hui.
 *
 * À réévaluer uniquement si un vecteur XSS apparaît un jour sur le site, ou
 * à la reprise IT — pas de raison de rouvrir cette décision sans élément
 * nouveau.
 * ============================================================================
 */
