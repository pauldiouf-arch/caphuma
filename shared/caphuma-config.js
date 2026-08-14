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
