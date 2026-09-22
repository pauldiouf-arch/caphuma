const SUPABASE_URL = "https://bhjycotcmkqiumukkkih.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_mtQU2zMhbkCPZjgCX3Z4hw_POMFm_ml";

let _capHumaSupabaseClient = null;
function capHumaGetSupabaseClient() {
    if (!_capHumaSupabaseClient) {
        _capHumaSupabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return _capHumaSupabaseClient;
}
