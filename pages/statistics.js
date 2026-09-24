const StatisticsPage = {};
(() => {
        renderPageLayout({
            icon: CapHumaIcons.get('barChart', 'w-5 h-5'),
            title: 'Hub Statistique & IA',
            titleTag: 'span',
            iconGradient: 'from-primary to-primary-dark',
            variant: 'scroll-page'
        });

        const appBody = document.getElementById('appBody');
        StatisticsPage.supabaseClient = capHumaGetSupabaseClient();
        StatisticsPage.poolList = [];
        StatisticsPage.rawTalents = [];
        StatisticsPage.rawMissions = [];
        StatisticsPage.statusChartInstance = null;
        StatisticsPage.expatChartInstance = null;
        StatisticsPage.genderChartInstance = null;
        StatisticsPage.nationalityChartInstance = null;
        StatisticsPage.currentUserRole = null;

        const logAuditAction = capHumaMakeAuditLogger(() => StatisticsPage.supabaseClient);

        async function checkSession() {
            try {
                let s;
                try {
                    s = await capHumaInitSession(StatisticsPage.supabaseClient);
                } catch (sessionErr) {
                    window.location.replace('login.html');
                    return;
                }

                document.getElementById('user-display-name').textContent = s.email;

                capHumaStartIdleTimeout(StatisticsPage.supabaseClient);
                StatisticsPage.currentUserRole = s.role;

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
                const { data: pools, error: ep } = await CapHumaData.getPools(StatisticsPage.supabaseClient, { select: 'pool_id, name, full_name' });
                if (ep) throw ep;
                StatisticsPage.poolList = pools || [];

                const selector = document.getElementById('pool-selector');
                StatisticsPage.poolList.forEach(p => {
                    const pCode = p.pool_id;
                    const opt = document.createElement('option');
                    opt.value = pCode;
                    opt.textContent = `${pCode} - ${p.full_name || p.fullName || p.name}`;
                    selector.appendChild(opt);
                });

                await loadRawData();

                const urlParams = new URLSearchParams(window.location.search);
                const queryPool = urlParams.get('pool') || urlParams.get('pool_id');

                if (queryPool) {
                    const normalizedQuery = queryPool.trim().toUpperCase();
                    const matchedPool = StatisticsPage.poolList.find(p => {
                        const code = (p.pool_id || p.name || "").toUpperCase();
                        return code === normalizedQuery;
                    });
                    if (matchedPool) {
                        selector.value = matchedPool.pool_id;
                    }
                }

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
            const { data: talents, error: et } = await CapHumaData.getTalents(StatisticsPage.supabaseClient, {
                select: 'pool, status, is_valid, is_red_listed, is_currently_on_mission, last_mission_end_date, months_without_mission, pool_integration_date, experience_months_alima, availability_type, availability_date, availability_months, gender, nationality_code, languages',
                filters: { staff_type: 'expat' }
            });
            if (et) throw et;
            StatisticsPage.rawTalents = talents || [];

            const { data: mData, error: em } = await capHumaSelectAllPages(() =>
                StatisticsPage.supabaseClient
                    .from('missions')
                    .select('pool, pool_id, status, candidate_type, contract_start_date, contract_end_date, contract_status, country_code, desk, future_talent_id', { count: 'exact' })
                    .order('id')
            );
            if (em) throw em;
            StatisticsPage.rawMissions = mData || [];
        }

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user');
            await StatisticsPage.supabaseClient.auth.signOut();
            window.location.replace('login.html');
        });

        window.addEventListener('DOMContentLoaded', () => checkSession());
})();
