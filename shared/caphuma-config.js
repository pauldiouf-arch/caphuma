const SUPABASE_URL = "https://bhjycotcmkqiumukkkih.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_mtQU2zMhbkCPZjgCX3Z4hw_POMFm_ml";

// Un seul client réutilisé par page plutôt qu'un appel createClient() recopié
// dans chaque pages/*.js — même URL/clé partout, aucune option différente
// entre pages. Placé ici (pas caphuma-utils.js) : c'est le seul fichier
// partagé chargé sur toutes les pages, y compris login.html/index.html.
let _capHumaSupabaseClient = null;
function capHumaGetSupabaseClient() {
    if (!_capHumaSupabaseClient) {
        _capHumaSupabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return _capHumaSupabaseClient;
}
