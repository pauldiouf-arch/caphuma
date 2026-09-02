// Correctif P26 (B13-Q2, Master Context §7) — 1/4 : scission de statistics.js.
// Voir Guide d'architecture §1.22 pour le patron complet (objet d'état partagé
// <Nom>Page déclaré HORS IIFE, seule dérogation à l'encapsulation P23). Ce
// fichier déclare StatisticsPage et DOIT être chargé en premier, avant
// statistics-charts.js / statistics-pool-ai.js / statistics-ai-report.js.
// Contient : layout, état partagé, journal d'audit, session, chargement des
// données brutes, écouteur de déconnexion, démarrage de page (ces deux
// derniers points physiquement déplacés depuis la fin du fichier d'origine
// jusqu'ici — même piège que celui documenté pour id-card.js, évité ici).
const StatisticsPage = {};
(() => {
        // ============================================================================
        // HEADER COMMUN (B4, Master Context §7) — injecté avant toute autre chose,
        // pour que #user-display-name et #logoutBtn existent dès la suite du script.
        // ============================================================================
        renderPageLayout({
            icon: '📊',
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

        // Échappement HTML systématique de toute donnée venant de la base avant
        // injection via innerHTML — prévention XSS (Master Context, règle de méthode
        // n°12). Absente jusqu'ici sur cette page faute d'innerHTML utilisant des
        // données de la base ; ajoutée avec les statistiques de contrats (Étape C).

        // SUPABASE_URL / SUPABASE_ANON_KEY viennent désormais de shared/caphuma-config.js
        // (chargé dans le head) — remplace l'ancien pont localStorage (MC13 Addendum U3).
        // La clé IA ne vit plus jamais côté client (ni localStorage, ni variable
        // visible en console) — l'appel passe désormais par la Edge Function
        // sécurisée ai-proxy, qui détient seule la clé côté serveur.

        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            StatisticsPage.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }

        // ============================================================================
        // JOURNAL D'AUDIT (Étape 8) — voir id-card.html pour la logique détaillée.
        // Ne bloque jamais l'action métier si l'écriture du log échoue.
        // ============================================================================
        async function logAuditAction(action, entityType, entityId, entityName, details) {
            // Délègue à shared/caphuma-auth.js (fonction commune) — corrige au passage
            // le fait que user_name n'était jamais transmis sur certaines pages.
            const userName = typeof StatisticsPage.currentUserName !== 'undefined' ? StatisticsPage.currentUserName : null;
            await capHumaLogAudit(
                StatisticsPage.supabaseClient,
                { userId: StatisticsPage.currentUserId, userEmail: StatisticsPage.currentUserEmail, userName: userName },
                action, entityType, entityId, entityName, details
            );
        }

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
                appBody.style.display = '';
                await initHub();
            } catch (e) {
                console.error(e);
                showError("Erreur d'authentification ou problème réseau.");
            }
        }

        // showError() retirée d'ici : vient désormais de shared/caphuma-utils.js.
        // ⚠️ Petit changement : fait maintenant remonter la page en haut en plus
        // d'afficher la bannière (harmonisé avec id-card.html — MC13 Addendum A3).

        async function initHub() {
            try {
                // 1. Récupération des pools de la base (pools.pool_id)
                const { data: pools, error: ep } = await capHumaWithRetry(() =>
                    StatisticsPage.supabaseClient.from('pools').select('pool_id, name, full_name')
                );
                if (ep) throw ep;
                StatisticsPage.poolList = pools || [];

                // Remplir le sélecteur avec la clé pool_id du Master Context
                const selector = document.getElementById('pool-selector');
                StatisticsPage.poolList.forEach(p => {
                    const pCode = p.pool_id || p.poolId; // pool_id selon le schéma réel de la section 5
                    const opt = document.createElement('option');
                    opt.value = pCode;
                    opt.textContent = `${pCode} - ${p.full_name || p.fullName || p.name}`;
                    selector.appendChild(opt);
                });

                // 2. Charger les collections de base
                await loadRawData();

                // 3. Détecter le paramètre d'URL (dashboard.html envoie ?pool=ID)
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

                // 4. Calculer et afficher
                // updateStatistics() vit désormais dans statistics-charts.js (scission
                // P26) — appel via StatisticsPage, chargé avant ce fichier.
                StatisticsPage.updateStatistics();

                // Listener de changement du sélecteur
                selector.addEventListener('change', () => {
                    StatisticsPage.updateStatistics();
                });

            } catch (e) {
                console.error(e);
                showError("Échec du chargement des indicateurs analytiques.");
            }
        }

        async function loadRawData() {
            // ⚡ Optimisation (grep exhaustif du fichier pour vérifier que chaque colonne
            // ci-dessous est bien lue quelque part sur cette page avant de la retirer/garder) :
            // - talents : liste inchangée sauf `experience_months_humanitarian`, retirée
            //   car jamais utilisée nulle part dans ce fichier (vérifié par grep).
            // - missions : passage de select('*') à une liste explicite des colonnes
            //   réellement utilisées (KPIs, 4 graphiques, stats détaillées de contrats,
            //   analyse IA globale et par pool). `candidate_type` confirmé présent en
            //   base (vérifié en direct avant ce changement, cf. information_schema) —
            //   la détection "colonne absente vs vide" plus bas (hasCandidateTypeColumn)
            //   continue donc de fonctionner à l'identique.
            const { data: talents, error: et } = await capHumaWithRetry(() =>
                StatisticsPage.supabaseClient
                    .from('talents')
                    .select('pool, status, is_valid, is_red_listed, is_currently_on_mission, last_mission_end_date, months_without_mission, pool_integration_date, experience_months_alima, availability_type, availability_date, availability_months, gender, nationality, languages')
            );
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

        // Exposé sur StatisticsPage pour appel depuis les autres fichiers de la page
        // (aucune fonction de ce fichier n'a besoin d'être exposée : logAuditAction,
        // checkSession, initHub, loadRawData ne sont appelées que depuis ce fichier).

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', StatisticsPage.currentUserId, StatisticsPage.currentUserEmail, null);
            if (StatisticsPage.supabaseClient) await StatisticsPage.supabaseClient.auth.signOut();
            window.location.replace('login.html');
        });

        window.addEventListener('DOMContentLoaded', () => checkSession());
})();
