const StatisticsPage = {};
(() => {
        renderPageLayout({
            icon: CapHumaIcons.get('barChart', 'w-5 h-5'),
            title: 'Hub Statistique & IA',
            iconGradient: 'from-primary to-primary-dark',
            variant: 'scroll-page'
        });

        const appBody = document.getElementById('appBody');
        StatisticsPage.supabaseClient = null;
        StatisticsPage.poolList = [];
        StatisticsPage.rawTalents = [];
        StatisticsPage.rawMissions = [];
        StatisticsPage.statusChartInstance = null;
        StatisticsPage.expatChartInstance = null;
        StatisticsPage.genderChartInstance = null;
        StatisticsPage.nationalityChartInstance = null;
        StatisticsPage.currentUserId = null;
        StatisticsPage.currentUserEmail = null;
        StatisticsPage.currentUserRole = null;
        StatisticsPage.currentUserName = null;

        // La clé IA ne vit jamais côté client (ni localStorage, ni variable visible
        // en console) : l'appel passe par l'Edge Function sécurisée ai-proxy, qui
        // détient seule la clé côté serveur.

        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            StatisticsPage.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }

        const logAuditAction = capHumaMakeAuditLogger(
            () => StatisticsPage.supabaseClient,
            () => ({
                userId: StatisticsPage.currentUserId,
                userEmail: StatisticsPage.currentUserEmail,
                userName: typeof StatisticsPage.currentUserName !== 'undefined' ? StatisticsPage.currentUserName : null
            })
        );

        async function checkSession() {
            if (!StatisticsPage.supabaseClient) {
                showError("Configuration Supabase introuvable (shared/caphuma-config.js manquant ou non chargé).");
                return;
            }
            try {
                let s;
                try {
                    s = await capHumaInitSession(StatisticsPage.supabaseClient);
                } catch (sessionErr) {
                    window.location.replace('login.html');
                    return;
                }

                document.getElementById('user-display-name').textContent = s.email;
                StatisticsPage.currentUserId = s.userId;
                StatisticsPage.currentUserEmail = s.email;
                StatisticsPage.currentUserName = s.name;

                capHumaStartIdleTimeout(StatisticsPage.supabaseClient);
                StatisticsPage.currentUserRole = s.role;

                // ai-proxy refuse déjà ce rôle côté serveur (403) — masquer ces blocs
                // évite qu'un visitor découvre l'erreur seulement après avoir cliqué.
                // updatePoolAiAnalysisVisibility() (statistics-pool-ai.js) porte le même
                // garde-fou pour la carte par pool.
                if (StatisticsPage.currentUserRole === 'visitor') {
                    document.getElementById('aiStrategicHub').classList.add('hidden');
                    document.getElementById('aiVisitorNotice').classList.remove('hidden');
                }

                appBody.style.display = '';
                await initHub();
            } catch (e) {
                console.error(e);
                showError("Erreur d'authentification ou problème réseau.");
            }
        }

        async function initHub() {
            try {
                const { data: pools, error: ep } = await CapHumaData.getPools({ select: 'pool_id, name, full_name' });
                if (ep) throw ep;
                StatisticsPage.poolList = pools || [];

                const selector = document.getElementById('pool-selector');
                StatisticsPage.poolList.forEach(p => {
                    const pCode = p.pool_id || p.poolId;
                    const opt = document.createElement('option');
                    opt.value = pCode;
                    opt.textContent = `${pCode} - ${p.full_name || p.fullName || p.name}`;
                    selector.appendChild(opt);
                });

                await loadRawData();

                // Détecter le paramètre d'URL (dashboard.html envoie ?pool=ID)
                const urlParams = new URLSearchParams(window.location.search);
                const queryPool = urlParams.get('pool') || urlParams.get('pool_id');

                if (queryPool) {
                    const normalizedQuery = queryPool.trim().toUpperCase();
                    const matchedPool = StatisticsPage.poolList.find(p => {
                        const code = (p.pool_id || p.poolId || p.name || "").toUpperCase();
                        return code === normalizedQuery;
                    });
                    if (matchedPool) {
                        selector.value = matchedPool.pool_id || matchedPool.poolId;
                    }
                }

                // updateStatistics() vit dans statistics-charts.js, chargé avant ce fichier.
                StatisticsPage.updateStatistics();

                selector.addEventListener('change', () => {
                    StatisticsPage.updateStatistics();
                });

            } catch (e) {
                console.error(e);
                showError("Échec du chargement des indicateurs analytiques.");
            }
        }

        async function loadRawData() {
            // Colonnes explicites plutôt que select('*') : uniquement celles utilisées
            // par les KPIs, les 4 graphiques, les stats de contrats et l'analyse IA.
            // `candidate_type` confirmé présent en base (colonne existante, jamais
            // absente) : la détection "colonne absente vs vide" plus bas
            // (hasCandidateTypeColumn) continue de fonctionner à l'identique.
            const { data: talents, error: et } = await CapHumaData.getTalents({
                select: 'pool, status, is_valid, is_red_listed, is_currently_on_mission, last_mission_end_date, months_without_mission, pool_integration_date, experience_months_alima, availability_type, availability_date, availability_months, gender, nationality, languages'
            });
            if (et) throw et;
            StatisticsPage.rawTalents = talents || [];

            const { data: mData, error: em } = await capHumaWithRetry(() =>
                StatisticsPage.supabaseClient
                    .from('missions')
                    .select('pool, pool_id, status, candidate_type, contract_start_date, contract_end_date, contract_status, country, desk, future_talent_id')
            );
            if (em) throw em;
            StatisticsPage.rawMissions = mData || [];
        }

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', StatisticsPage.currentUserId, StatisticsPage.currentUserEmail, null);
            if (StatisticsPage.supabaseClient) await StatisticsPage.supabaseClient.auth.signOut();
            window.location.replace('login.html');
        });

        window.addEventListener('DOMContentLoaded', () => checkSession());
})();
