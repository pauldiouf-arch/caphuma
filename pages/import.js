// Script enveloppé dans une IIFE anonyme pour isoler sa portée — élimine tout
// risque qu'une déclaration top-level de cette page masque silencieusement
// une fonction/variable partagée (shared/caphuma-*.js) chargée avant elle, ou
// soit elle-même masquée par une autre page à l'avenir.
(() => {
        // ============================================================================
        // HEADER COMMUN — injecté avant toute autre chose, pour que
        // #user-display-name et #logoutBtn existent dès la suite du script.
        // pageHeaderTitle garde son id pour rester réécrivable en JS selon l'onglet
        // actif (Talents/Postes, voir setImportMode() plus bas).
        // ============================================================================
        renderPageLayout({
            icon: '📥',
            title: 'Import en masse',
            titleId: 'pageHeaderTitle',
            iconGradient: 'from-primary to-primary-dark',
            variant: 'scroll-page',
            maxWidth: 'max-w-5xl'
        });

        const appBody = document.getElementById('appBody');

        // SUPABASE_URL / SUPABASE_ANON_KEY viennent de shared/caphuma-config.js
        // (chargé dans le head).
        let supabaseClient = null;
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserName = null;

        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }

        const logAuditAction = capHumaMakeAuditLogger(
            () => supabaseClient,
            () => ({ userId: currentUserId, userEmail: currentUserEmail, userName: currentUserName })
        );

        async function checkSession() {
            if (!supabaseClient) {
                window.location.replace('login.html');
                return;
            }
            try {
                const s = await capHumaInitSession(supabaseClient);
                currentUserId = s.userId;
                currentUserEmail = s.email;
                currentUserName = s.name;

                capHumaStartIdleTimeout(supabaseClient);

                if (s.role !== 'admin') {
                    document.getElementById('accessDeniedBanner').classList.remove('hidden');
                    appBody.style.display = '';
                    return;
                }

                document.getElementById('user-display-name').textContent = s.email;
                document.getElementById('pageContent').classList.remove('hidden');
                appBody.style.display = '';
                await loadReferenceData();

            } catch (err) {
                window.location.replace('login.html');
            }
        }

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await logAuditAction('logout', 'user', currentUserId, currentUserEmail, null);
            if (supabaseClient) await supabaseClient.auth.signOut();
            window.location.replace('login.html');
        });

        // ============================================================================
        // BASCULE ENTRE LES DEUX MODES D'IMPORT (Talents / Postes)
        // ============================================================================
        const tabBtnTalents = document.getElementById('tabBtnTalents');
        const tabBtnMissions = document.getElementById('tabBtnMissions');
        const talentImportSection = document.getElementById('talentImportSection');
        const missionImportSection = document.getElementById('missionImportSection');
        const pageHeaderTitle = document.getElementById('pageHeaderTitle');

        function setImportMode(mode) {
            const isTalents = mode === 'talents';
            talentImportSection.classList.toggle('hidden', !isTalents);
            missionImportSection.classList.toggle('hidden', isTalents);
            tabBtnTalents.className = 'import-tab-btn px-4 py-2 rounded-xl text-sm font-bold transition-all ' +
                (isTalents ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-50');
            tabBtnMissions.className = 'import-tab-btn px-4 py-2 rounded-xl text-sm font-bold transition-all ' +
                (!isTalents ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-50');
            pageHeaderTitle.textContent = isTalents ? 'Import de talents' : 'Import de postes';
        }
        tabBtnTalents.addEventListener('click', () => setImportMode('talents'));
        tabBtnMissions.addEventListener('click', () => setImportMode('missions'));

        // ============================================================================
        // LECTURE DU FICHIER — validation ligne par ligne, aperçu. Aucune écriture en
        // base à ce stade : l'insertion réelle est une étape distincte, déclenchée
        // par un clic sur le bouton d'import (voir plus bas).
        // ============================================================================
        let cachedPools = [];
        let cachedExistingEmails = new Set();
        let lastParsedRows = [];

        const EDU_LEVELS_VALID = new Set(['none','bac','bac+1','bac+2','bac+3','bac+4','bac+5','bac+6','bac+7','bac+8+']);
        const MISSIONS_LABEL_TO_ENUM = { '0 mission': 'none', '1 mission': 'one', '2 missions': 'two', '3 missions et +': 'three_plus' };
        const AVAILABILITY_LABEL_TO_ENUM = { 'Immédiate': 'asap', 'Date précise': 'date', 'Préavis': 'notice' };
        const HAS_VISA_LABEL_TO_BOOL = { 'Oui': true, 'Non': false };
        const EXAMPLE_ROW_EMAIL = 'awa.ndiaye@example.com';

        // Correspond exactement à la ligne 2 (noms techniques) du modèle livré —
        // ne pas modifier sans mettre à jour le modèle Excel en parallèle.
        const IMPORT_COLUMNS = [
            'first_name', 'last_name', 'email', 'pool', 'gender', 'nationality',
            'country_of_residence', 'current_function', 'education_level', 'education_specialty',
            'languages', 'other_languages', 'key_skills', 'intervention_contexts', 'intervention_zones',
            'has_visa', 'pool_integration_date', 'experience_months_alima', 'experience_months_humanitarian',
            'number_of_alima_missions', 'availability_type', 'availability_date', 'availability_months', 'status'
        ];

        async function loadReferenceData() {
            try {
                const { data, error } = await capHumaWithRetry(() =>
                    supabaseClient.from('pools').select('pool_id, name')
                );
                if (error) throw error;
                cachedPools = data || [];
            } catch (err) {
                console.error('[Import] Erreur de chargement des pools :', err);
            }
            try {
                const { data, error } = await capHumaWithRetry(() =>
                    supabaseClient.from('talents').select('email')
                );
                if (error) throw error;
                cachedExistingEmails = new Set((data || []).map(t => (t.email || '').trim().toLowerCase()).filter(Boolean));
            } catch (err) {
                console.error('[Import] Erreur de chargement des emails existants :', err);
            }
        }

        function splitMultiValue(raw) {
            if (!raw || typeof raw !== 'string') return [];
            return raw.split(',').map(s => s.trim()).filter(Boolean);
        }

        function parseDateCell(raw) {
            if (!raw) return null;
            if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
            const d = new Date(raw);
            return isNaN(d.getTime()) ? null : d;
        }

        function toISODate(d) {
            return d.toISOString().slice(0, 10);
        }

        // Aide partagée pour les champs "optionnel, valeur parmi une liste connue" :
        // absent → null, sans erreur ; présent et reconnu → valeur normalisée (le
        // libellé Excel tel quel pour un Set, la valeur mappée pour une table de
        // correspondance) ; présent et non reconnu → erreur, valeur = le libellé Excel
        // tel quel pour un Set (cohérent avec le comportement existant sur
        // gender/education_level, qui laissaient passer la valeur brute invalide),
        // valeur = null pour une table de correspondance (rien à quoi la mapper).
        function validateOptionalEnumField(rawValue, allowedValues, fieldLabel) {
            if (!rawValue) return { value: null, error: null };
            const isSet = allowedValues instanceof Set;
            const isValid = isSet ? allowedValues.has(rawValue) : (rawValue in allowedValues);
            if (!isValid) {
                return { value: isSet ? rawValue : null, error: `${fieldLabel} "${rawValue}" invalide` };
            }
            return { value: isSet ? rawValue : allowedValues[rawValue], error: null };
        }

        const TALENT_OPTIONAL_ENUM_FIELDS = [
            { key: 'education_level', label: "Niveau d'études", allowed: EDU_LEVELS_VALID },
            { key: 'has_visa', label: 'Visa', allowed: HAS_VISA_LABEL_TO_BOOL },
            { key: 'number_of_alima_missions', label: 'Missions', allowed: MISSIONS_LABEL_TO_ENUM },
            { key: 'availability_type', label: 'Disponibilité', allowed: AVAILABILITY_LABEL_TO_ENUM }
        ];

        function validateAndNormalizeRow(raw, rowNumber, seenEmailsInFile) {
            const errors = [];
            const get = (key) => {
                const v = raw[key];
                return typeof v === 'string' ? v.trim() : v;
            };

            const firstName = get('first_name');
            const lastName = get('last_name');
            const email = get('email');
            const pool = get('pool');

            if (!firstName) errors.push('Prénom manquant');
            if (!lastName) errors.push('Nom manquant');
            if (!email) errors.push('Email manquant');
            else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email au format invalide');
            if (!pool) errors.push('Code Pool manquant');
            else if (!cachedPools.some(p => (p.pool_id || '').toUpperCase() === String(pool).toUpperCase())) {
                errors.push(`Pool "${pool}" inconnu`);
            }

            const emailLower = (email || '').toString().toLowerCase();
            if (email) {
                if (seenEmailsInFile.has(emailLower)) errors.push('Email en double dans le fichier');
                else seenEmailsInFile.add(emailLower);
                if (cachedExistingEmails.has(emailLower)) errors.push('Un talent avec cet email existe déjà');
            }

            const gender = get('gender');
            if (gender && gender !== 'H' && gender !== 'F') errors.push(`Genre "${gender}" invalide`);

            // Les 4 valeurs valides sont celles du filtre "Statut" de talents.html (aucune
            // liste centralisée dans caphuma-utils.js pour ce champ précis, donc reprise
            // ici à l'identique).
            const TALENT_STATUS_VALID = new Set([
                'En poste ALIMA', 'En attente de poste', 'En poste autre ONG', 'En poste hors humanitaire'
            ]);
            const status = get('status');
            if (status && !TALENT_STATUS_VALID.has(status)) {
                errors.push(`Statut "${status}" invalide (attendu : ${Array.from(TALENT_STATUS_VALID).join(' / ')})`);
            }

            const enumResults = {};
            TALENT_OPTIONAL_ENUM_FIELDS.forEach(({ key, label, allowed }) => {
                const { value, error } = validateOptionalEnumField(get(key), allowed, label);
                if (error) errors.push(error);
                enumResults[key] = value;
            });

            let availDate = null;
            if (enumResults.availability_type === 'date') {
                availDate = parseDateCell(raw['availability_date']);
                if (!availDate) errors.push('Date de disponibilité requise (type = Date précise)');
            }

            let availMonths = null;
            const availMonthsRaw = get('availability_months');
            if (enumResults.availability_type === 'notice') {
                availMonths = Number(availMonthsRaw);
                if (availMonthsRaw === '' || availMonthsRaw == null || isNaN(availMonths)) errors.push('Préavis (mois) requis (type = Préavis)');
            } else if (availMonthsRaw !== '' && availMonthsRaw != null) {
                const n = Number(availMonthsRaw);
                if (isNaN(n)) errors.push('Préavis (mois) doit être numérique');
                else availMonths = n;
            }

            let poolIntegrationDate = null;
            if (raw['pool_integration_date']) {
                poolIntegrationDate = parseDateCell(raw['pool_integration_date']);
                if (!poolIntegrationDate) errors.push("Date d'intégration invalide");
            }

            let expAlima = null;
            const expAlimaRaw = get('experience_months_alima');
            if (expAlimaRaw !== '' && expAlimaRaw != null) {
                expAlima = Number(expAlimaRaw);
                if (isNaN(expAlima)) errors.push('Expérience ALIMA (mois) doit être numérique');
            }

            let expHum = null;
            const expHumRaw = get('experience_months_humanitarian');
            if (expHumRaw !== '' && expHumRaw != null) {
                expHum = Number(expHumRaw);
                if (isNaN(expHum)) errors.push('Expérience humanitaire (mois) doit être numérique');
            }

            const normalized = {
                first_name: firstName || null,
                last_name: lastName || null,
                email: email || null,
                pool: pool ? String(pool).toUpperCase() : null,
                gender: gender || null,
                nationality: get('nationality') || null,
                country_of_residence: get('country_of_residence') || null,
                current_function: get('current_function') || null,
                education_level: enumResults.education_level,
                education_specialty: get('education_specialty') || null,
                languages: splitMultiValue(get('languages')),
                other_languages: splitMultiValue(get('other_languages')),
                key_skills: splitMultiValue(get('key_skills')),
                intervention_contexts: splitMultiValue(get('intervention_contexts')),
                intervention_zones: splitMultiValue(get('intervention_zones')),
                has_visa: enumResults.has_visa,
                pool_integration_date: poolIntegrationDate ? toISODate(poolIntegrationDate) : null,
                experience_months_alima: expAlima,
                experience_months_humanitarian: expHum,
                number_of_alima_missions: enumResults.number_of_alima_missions,
                availability_type: enumResults.availability_type,
                availability_date: availDate ? toISODate(availDate) : null,
                availability_months: availMonths,
                status: status || null
            };

            return { rowNumber, errors, normalized };
        }

        function parseWorkbook(arrayBuffer) {
            const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
            const sheetName = wb.SheetNames.includes('Modèle Import Talents') ? 'Modèle Import Talents' : wb.SheetNames[wb.SheetNames.length - 1];
            const sheet = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

            if (rows.length < 2) return { error: 'Fichier vide ou format inattendu.' };

            const techHeaderRow = rows[1]; // ligne 2 = noms techniques
            const colIndex = {};
            IMPORT_COLUMNS.forEach(col => {
                const idx = techHeaderRow.findIndex(h => String(h).trim() === col);
                if (idx !== -1) colIndex[col] = idx;
            });

            if (colIndex.first_name === undefined || colIndex.email === undefined || colIndex.pool === undefined) {
                return { error: "Colonnes attendues introuvables — utilisez le modèle fourni sans modifier l'ordre des colonnes." };
            }

            const dataRows = rows.slice(2); // données à partir de la ligne 3 (index 2)
            const parsed = [];
            const seenEmailsInFile = new Set();
            let excelRowNum = 3;

            dataRows.forEach(r => {
                const isEmptyRow = r.every(cell => cell === '' || cell == null);
                if (isEmptyRow) { excelRowNum++; return; }

                const raw = {};
                IMPORT_COLUMNS.forEach(col => {
                    raw[col] = colIndex[col] !== undefined ? r[colIndex[col]] : '';
                });

                // Ignore silencieusement la ligne d'exemple si elle n'a pas été supprimée
                if (String(raw.email).trim().toLowerCase() === EXAMPLE_ROW_EMAIL) {
                    excelRowNum++;
                    return;
                }

                parsed.push(validateAndNormalizeRow(raw, excelRowNum, seenEmailsInFile));
                excelRowNum++;
            });

            return { rows: parsed };
        }

        function renderPreview(parsedRows) {
            const card = document.getElementById('previewCard');
            const content = document.getElementById('previewContent');
            card.classList.remove('hidden');

            const validRows = parsedRows.filter(r => r.errors.length === 0);
            const invalidRows = parsedRows.filter(r => r.errors.length > 0);

            content.innerHTML = `
                <div class="flex gap-4 mb-4">
                    <div class="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5">
                        <p class="text-lg font-extrabold text-emerald-700">${validRows.length}</p>
                        <p class="text-[10px] font-semibold text-emerald-500 uppercase">Ligne(s) valide(s)</p>
                    </div>
                    <div class="bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
                        <p class="text-lg font-extrabold text-red-700">${invalidRows.length}</p>
                        <p class="text-[10px] font-semibold text-red-500 uppercase">Ligne(s) en erreur</p>
                    </div>
                </div>
                <div class="max-h-96 overflow-y-auto border border-slate-100 rounded-xl">
                    <table class="w-full text-xs">
                        <thead class="bg-slate-50 sticky top-0">
                            <tr>
                                <th class="text-left px-3 py-2 font-bold text-slate-500">Ligne</th>
                                <th class="text-left px-3 py-2 font-bold text-slate-500">Nom</th>
                                <th class="text-left px-3 py-2 font-bold text-slate-500">Email</th>
                                <th class="text-left px-3 py-2 font-bold text-slate-500">Pool</th>
                                <th class="text-left px-3 py-2 font-bold text-slate-500">Statut</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${parsedRows.map(r => `
                                <tr class="border-t border-slate-100 ${r.errors.length > 0 ? 'bg-red-50/50' : ''}">
                                    <td class="px-3 py-2 text-slate-600">${r.rowNumber}</td>
                                    <td class="px-3 py-2">${escapeHtml(((r.normalized.first_name || '') + ' ' + (r.normalized.last_name || '')).trim())}</td>
                                    <td class="px-3 py-2">${escapeHtml(r.normalized.email || '')}</td>
                                    <td class="px-3 py-2">${escapeHtml(r.normalized.pool || '')}</td>
                                    <td class="px-3 py-2">
                                        ${r.errors.length === 0
                                            ? '<span class="text-emerald-600 font-semibold">✅ Valide</span>'
                                            : `<span class="text-red-600 font-semibold">❌ ${escapeHtml(r.errors.join(' · '))}</span>`}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <p class="text-xs text-slate-500 mt-4 italic">Seules les lignes valides seront importées — les lignes en erreur sont ignorées, rien n'est deviné à leur place.</p>

                ${validRows.length > 0 ? `
                    <div class="mt-4 pt-4 border-t border-slate-100 flex items-center gap-3">
                        <button id="importSubmitBtn" type="button" class="bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all">
                            Importer les ${validRows.length} ligne(s) valide(s)
                        </button>
                        <span id="importSubmitStatus" class="text-xs text-slate-500"></span>
                    </div>
                    <div id="importResultBox" class="hidden mt-4"></div>
                ` : ''}
            `;

            if (validRows.length > 0) {
                document.getElementById('importSubmitBtn').addEventListener('click', () => runImport(validRows));
            }
        }

        // ============================================================================
        // INSERTION EN BASE — par lots de 25 lignes, avec rapport détaillé. Les
        // lignes en erreur (déjà filtrées avant l'appel) ne sont jamais envoyées.
        // ============================================================================
        const IMPORT_BATCH_SIZE = 25;

        async function runImport(validRows) {
            const confirmed = confirm(
                `Vous allez importer ${validRows.length} talent(s) dans Cap Huma. ` +
                `Cette action crée de vraies fiches talent — vérifiez l'aperçu avant de continuer. Continuer ?`
            );
            if (!confirmed) return;

            const btn = document.getElementById('importSubmitBtn');
            const statusEl = document.getElementById('importSubmitStatus');
            const resultBox = document.getElementById('importResultBox');
            btn.disabled = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');

            let successCount = 0;
            const failures = []; // { rowNumber, name, message }

            for (let i = 0; i < validRows.length; i += IMPORT_BATCH_SIZE) {
                const batch = validRows.slice(i, i + IMPORT_BATCH_SIZE);
                statusEl.textContent = `Import en cours... ${Math.min(i + IMPORT_BATCH_SIZE, validRows.length)} / ${validRows.length}`;

                // talents.status est NOT NULL avec un défaut ('En attente de poste')
                // côté base — un défaut Postgres ne s'applique que si la colonne est
                // absente de l'INSERT, jamais si elle est envoyée explicitement à null.
                // Comme ce champ est volontairement laissé vide la plupart du temps
                // (voir modèle Excel), on retire la clé plutôt que d'envoyer null, pour
                // laisser Postgres appliquer son défaut.
                const payload = batch.map(r => {
                    const row = { ...r.normalized, created_by: currentUserId };
                    if (!row.status) delete row.status;
                    return row;
                });

                try {
                    // Volontairement pas enveloppé dans capHumaWithRetry() : c'est l'insert
                    // le plus risqué du site à retenter — un lot de jusqu'à
                    // IMPORT_BATCH_SIZE (25) talents à la fois, sans aucune contrainte
                    // UNIQUE sur talents. Si ce lot a en fait réussi côté serveur mais que
                    // sa réponse s'est perdue, une relance dupliquerait silencieusement
                    // jusqu'à 25 fiches talent d'un coup.
                    const { data, error } = await supabaseClient.from('talents').insert(payload).select('id');
                    if (error) throw error;
                    successCount += (data || []).length;
                } catch (err) {
                    console.error('[Import] Échec sur un lot :', err);
                    // Le lot entier a échoué (ex. contrainte violée) — on le journalise en
                    // bloc plutôt que de deviner quelle ligne précise a posé problème, un
                    // échec de lot ne permettant pas de le savoir sans le rejouer ligne par
                    // ligne (non fait ici pour rester simple — voir note ci-dessous).
                    batch.forEach(r => failures.push({
                        rowNumber: r.rowNumber,
                        name: `${r.normalized.first_name || ''} ${r.normalized.last_name || ''}`.trim(),
                        message: (err && err.message) || 'Erreur inconnue'
                    }));
                }
            }

            statusEl.textContent = '';
            btn.textContent = 'Import terminé';

            await logAuditAction(
                'create', 'talent', null, 'Import en masse',
                `${successCount} talent(s) importé(s), ${failures.length} échec(s) sur ${validRows.length} ligne(s) tentée(s)`
            );

            resultBox.classList.remove('hidden');
            resultBox.innerHTML = `
                <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-4 mb-2">
                    <p class="text-sm font-bold text-emerald-700">✅ ${successCount} talent(s) importé(s) avec succès.</p>
                </div>
                ${failures.length > 0 ? `
                    <div class="bg-red-50 border border-red-100 rounded-xl p-4">
                        <p class="text-sm font-bold text-red-700 mb-2">❌ ${failures.length} échec(s) :</p>
                        <ul class="text-xs text-red-600 space-y-1">
                            ${failures.map(f => `<li>Ligne ${f.rowNumber} (${escapeHtml(f.name)}) — ${escapeHtml(f.message)}</li>`).join('')}
                        </ul>
                        <p class="text-[11px] text-red-500 mt-2 italic">Ces lignes n'ont pas été importées — corrigez-les dans le fichier et réessayez uniquement pour celles-ci.</p>
                    </div>
                ` : ''}
                <a href="talents.html" class="inline-block mt-3 text-xs font-semibold text-primary hover:underline">Voir les talents →</a>
            `;
        }

        // ============================================================================
        // ═══════════════ MODULE IMPORT DE POSTES (masse) ═══════════════
        // Miroir du module talents ci-dessus (mêmes étapes : modèle → dépôt → aperçu →
        // insertion par lots), mais pour la table `missions`. Décision produit (voir
        // échange avec l'utilisateur) : un poste importé n'a JAMAIS d'occupant à ce
        // stade (occupant_id toujours null, statut limité à vacant/recruiting) — le
        // rattachement d'un talent à un poste reste une action manuelle volontaire
        // depuis missions.html, y compris pour un talent "En poste ALIMA" lui-même
        // importé au même moment. Colonnes canoniques confirmées dans pages/missions.js
        // (MISSIONS_COLUMNS) : `pool` (pas `pool_id`), `occupant_id`/`future_talent_id`
        // (pas les colonnes `current_occupant_id`/`future_occupant_id`).
        // ============================================================================

        const MISSION_IMPORT_COLUMNS = [
            'title', 'pool', 'pool_level', 'status', 'country', 'location',
            'project_name', 'candidate_type', 'desk',
            'contract_start_date', 'contract_end_date', 'contract_status'
        ];
        const EXAMPLE_ROW_TITLE = 'Exemple - Coordinateur Terrain';

        // Réutilise les libellés déjà centralisés dans shared/caphuma-utils.js (DESK_LABELS,
        // CANDIDATE_TYPE_LABELS, CONTRACT_STATUS_LABELS) plutôt que de les redéfinir en
        // dur ici — une seule source pour ces 3 énumérations, cohérent avec le reste du
        // site.
        function invertLabelMap(labelMap) {
            const inv = {};
            Object.keys(labelMap).forEach(k => { inv[labelMap[k]] = k; });
            return inv;
        }
        const DESK_LABEL_TO_ENUM = invertLabelMap(DESK_LABELS);
        const CANDIDATE_TYPE_LABEL_TO_ENUM = invertLabelMap(CANDIDATE_TYPE_LABELS);
        const CONTRACT_STATUS_LABEL_TO_ENUM = invertLabelMap(CONTRACT_STATUS_LABELS);

        // pool_level n'est pas centralisé dans caphuma-utils.js (déjà dupliqué localement
        // dans extraction.html/missions.html avant cette page — même logique reprise ici).
        const POOL_LEVEL_LABEL_TO_ENUM = { 'Mission': 'mission', 'Projet': 'project' };

        // Volontairement SANS "Occupé" — un poste importé ne peut être créé qu'en Vacant
        // ou En recrutement, voir bandeau d'avertissement affiché sur la page.
        const MISSION_STATUS_LABEL_TO_ENUM = { 'Vacant': 'vacant', 'En recrutement': 'recruiting' };

        let cachedMissionRows = [];

        const MISSION_OPTIONAL_ENUM_FIELDS = [
            { key: 'candidate_type', label: 'Type de candidat', allowed: CANDIDATE_TYPE_LABEL_TO_ENUM },
            { key: 'desk', label: 'Desk', allowed: DESK_LABEL_TO_ENUM },
            { key: 'contract_status', label: 'Statut du contrat', allowed: CONTRACT_STATUS_LABEL_TO_ENUM }
        ];

        function validateAndNormalizeMissionRow(raw, rowNumber) {
            const errors = [];
            const get = (key) => {
                const v = raw[key];
                return typeof v === 'string' ? v.trim() : v;
            };

            const title = get('title');
            const pool = get('pool');
            const country = get('country');
            const location = get('location');

            if (!title) errors.push('Titre manquant');
            if (!pool) errors.push('Code Pool manquant');
            else if (!cachedPools.some(p => (p.pool_id || '').toUpperCase() === String(pool).toUpperCase())) {
                errors.push(`Pool "${pool}" inconnu`);
            }
            if (!country) errors.push('Pays manquant');
            if (!location) errors.push('Lieu manquant');

            const poolLevelRaw = get('pool_level');
            let poolLevel = null;
            if (!poolLevelRaw) errors.push('Niveau manquant');
            else if (!(poolLevelRaw in POOL_LEVEL_LABEL_TO_ENUM)) errors.push(`Niveau "${poolLevelRaw}" invalide (attendu : Mission / Projet)`);
            else poolLevel = POOL_LEVEL_LABEL_TO_ENUM[poolLevelRaw];

            const statusRaw = get('status');
            let status = null;
            if (!statusRaw) errors.push('Statut manquant');
            else if (statusRaw === 'Occupé') errors.push(`Statut "Occupé" non autorisé à l'import — importez en Vacant ou En recrutement, puis affectez le talent depuis la page Postes`);
            else if (!(statusRaw in MISSION_STATUS_LABEL_TO_ENUM)) errors.push(`Statut "${statusRaw}" invalide (attendu : Vacant / En recrutement)`);
            else status = MISSION_STATUS_LABEL_TO_ENUM[statusRaw];

            // Mêmes 3 champs "optionnel, valeur parmi une liste connue" que côté talent
            // — réduits via validateOptionalEnumField() ci-dessus.
            const enumResults = {};
            MISSION_OPTIONAL_ENUM_FIELDS.forEach(({ key, label, allowed }) => {
                const { value, error } = validateOptionalEnumField(get(key), allowed, label);
                if (error) errors.push(error);
                enumResults[key] = value;
            });

            let contractStart = null;
            const contractStartRaw = get('contract_start_date');
            if (contractStartRaw) {
                contractStart = parseDateCell(contractStartRaw);
                if (!contractStart) errors.push('Date début contrat invalide');
            }
            let contractEnd = null;
            const contractEndRaw = get('contract_end_date');
            if (contractEndRaw) {
                contractEnd = parseDateCell(contractEndRaw);
                if (!contractEnd) errors.push('Date fin contrat invalide');
            }

            const normalized = {
                title: title || null,
                pool: pool ? String(pool).toUpperCase() : null,
                pool_level: poolLevel,
                status: status,
                country: country || null,
                location: location || null,
                project_name: get('project_name') || null,
                candidate_type: enumResults.candidate_type,
                // is_expat maintenue en cohérence avec candidate_type, comme le fait le
                // formulaire manuel de missions.html (évite une colonne fantôme jamais à jour).
                is_expat: enumResults.candidate_type ? enumResults.candidate_type === 'expat' : null,
                desk: enumResults.desk,
                // Toujours null à l'import — voir note en tête de module.
                occupant_id: null,
                contract_start_date: contractStart ? toISODate(contractStart) : null,
                contract_end_date: contractEnd ? toISODate(contractEnd) : null,
                contract_status: enumResults.contract_status
            };

            return { rowNumber, errors, normalized };
        }

        function parseMissionWorkbook(arrayBuffer) {
            const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
            const sheetName = wb.SheetNames.includes('Modèle Import Postes') ? 'Modèle Import Postes' : wb.SheetNames[wb.SheetNames.length - 1];
            const sheet = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

            if (rows.length < 2) return { error: 'Fichier vide ou format inattendu.' };

            const techHeaderRow = rows[1];
            const colIndex = {};
            MISSION_IMPORT_COLUMNS.forEach(col => {
                const idx = techHeaderRow.findIndex(h => String(h).trim() === col);
                if (idx !== -1) colIndex[col] = idx;
            });

            if (colIndex.title === undefined || colIndex.pool === undefined || colIndex.country === undefined) {
                return { error: "Colonnes attendues introuvables — utilisez le modèle fourni sans modifier l'ordre des colonnes." };
            }

            const dataRows = rows.slice(2);
            const parsed = [];
            let excelRowNum = 3;

            dataRows.forEach(r => {
                const isEmptyRow = r.every(cell => cell === '' || cell == null);
                if (isEmptyRow) { excelRowNum++; return; }

                const raw = {};
                MISSION_IMPORT_COLUMNS.forEach(col => {
                    raw[col] = colIndex[col] !== undefined ? r[colIndex[col]] : '';
                });

                if (String(raw.title).trim() === EXAMPLE_ROW_TITLE) {
                    excelRowNum++;
                    return;
                }

                parsed.push(validateAndNormalizeMissionRow(raw, excelRowNum));
                excelRowNum++;
            });

            return { rows: parsed };
        }

        function renderMissionPreview(parsedRows) {
            const card = document.getElementById('previewCardMissions');
            const content = document.getElementById('previewContentMissions');
            card.classList.remove('hidden');

            const validRows = parsedRows.filter(r => r.errors.length === 0);
            const invalidRows = parsedRows.filter(r => r.errors.length > 0);

            content.innerHTML = `
                <div class="flex gap-4 mb-4">
                    <div class="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5">
                        <p class="text-lg font-extrabold text-emerald-700">${validRows.length}</p>
                        <p class="text-[10px] font-semibold text-emerald-500 uppercase">Ligne(s) valide(s)</p>
                    </div>
                    <div class="bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
                        <p class="text-lg font-extrabold text-red-700">${invalidRows.length}</p>
                        <p class="text-[10px] font-semibold text-red-500 uppercase">Ligne(s) en erreur</p>
                    </div>
                </div>
                <div class="max-h-96 overflow-y-auto border border-slate-100 rounded-xl">
                    <table class="w-full text-xs">
                        <thead class="bg-slate-50 sticky top-0">
                            <tr>
                                <th class="text-left px-3 py-2 font-bold text-slate-500">Ligne</th>
                                <th class="text-left px-3 py-2 font-bold text-slate-500">Titre</th>
                                <th class="text-left px-3 py-2 font-bold text-slate-500">Pool</th>
                                <th class="text-left px-3 py-2 font-bold text-slate-500">Pays / Lieu</th>
                                <th class="text-left px-3 py-2 font-bold text-slate-500">Statut</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${parsedRows.map(r => `
                                <tr class="border-t border-slate-100 ${r.errors.length > 0 ? 'bg-red-50/50' : ''}">
                                    <td class="px-3 py-2 text-slate-600">${r.rowNumber}</td>
                                    <td class="px-3 py-2">${escapeHtml(r.normalized.title || '')}</td>
                                    <td class="px-3 py-2">${escapeHtml(r.normalized.pool || '')}</td>
                                    <td class="px-3 py-2">${escapeHtml(((r.normalized.location || '') + ' — ' + (r.normalized.country || '')))}</td>
                                    <td class="px-3 py-2">
                                        ${r.errors.length === 0
                                            ? '<span class="text-emerald-600 font-semibold">✅ Valide</span>'
                                            : `<span class="text-red-600 font-semibold">❌ ${escapeHtml(r.errors.join(' · '))}</span>`}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <p class="text-xs text-slate-500 mt-4 italic">Seules les lignes valides seront importées — les lignes en erreur sont ignorées, rien n'est deviné à leur place.</p>

                ${validRows.length > 0 ? `
                    <div class="mt-4 pt-4 border-t border-slate-100 flex items-center gap-3">
                        <button id="importMissionSubmitBtn" type="button" class="bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all">
                            Importer les ${validRows.length} ligne(s) valide(s)
                        </button>
                        <span id="importMissionSubmitStatus" class="text-xs text-slate-500"></span>
                    </div>
                    <div id="importMissionResultBox" class="hidden mt-4"></div>
                ` : ''}
            `;

            if (validRows.length > 0) {
                document.getElementById('importMissionSubmitBtn').addEventListener('click', () => runImportMissions(validRows));
            }
        }

        async function runImportMissions(validRows) {
            const confirmed = confirm(
                `Vous allez importer ${validRows.length} poste(s) dans Cap Huma, tous créés sans occupant. ` +
                `Vérifiez l'aperçu avant de continuer. Continuer ?`
            );
            if (!confirmed) return;

            const btn = document.getElementById('importMissionSubmitBtn');
            const statusEl = document.getElementById('importMissionSubmitStatus');
            const resultBox = document.getElementById('importMissionResultBox');
            btn.disabled = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');

            let successCount = 0;
            const failures = [];
            const poolsUsed = new Set();

            for (let i = 0; i < validRows.length; i += IMPORT_BATCH_SIZE) {
                const batch = validRows.slice(i, i + IMPORT_BATCH_SIZE);
                statusEl.textContent = `Import en cours... ${Math.min(i + IMPORT_BATCH_SIZE, validRows.length)} / ${validRows.length}`;

                const payload = batch.map(r => ({ ...r.normalized }));

                try {
                    // Volontairement pas enveloppé dans capHumaWithRetry() : même raison
                    // que l'import de talents ci-dessus — lot de jusqu'à IMPORT_BATCH_SIZE
                    // (25) postes à la fois, sans contrainte UNIQUE sur missions. Un retry
                    // après perte de réponse dupliquerait silencieusement jusqu'à 25 postes
                    // d'un coup.
                    const { data, error } = await supabaseClient.from('missions').insert(payload).select('id');
                    if (error) throw error;
                    successCount += (data || []).length;
                    batch.forEach(r => poolsUsed.add(r.normalized.pool));
                } catch (err) {
                    console.error('[Import] Échec sur un lot :', err);
                    batch.forEach(r => failures.push({
                        rowNumber: r.rowNumber,
                        name: r.normalized.title || '',
                        message: (err && err.message) || 'Erreur inconnue'
                    }));
                }
            }

            statusEl.textContent = '';
            btn.textContent = 'Import terminé';

            // Trigger Postgres trg_audit_missions (§5.4 bis du Dossier) : journalise
            // automatiquement chaque insertion avec l'auteur réel — pas d'appel client
            // supplémentaire nécessaire ici pour les lignes elles-mêmes. On garde un
            // log de synthèse de l'opération globale, cohérent avec l'import talents.
            await logAuditAction(
                'create', 'mission', null, 'Import en masse',
                `${successCount} poste(s) importé(s), ${failures.length} échec(s) sur ${validRows.length} ligne(s) tentée(s)`
            );

            const singlePool = poolsUsed.size === 1 ? Array.from(poolsUsed)[0] : null;

            resultBox.classList.remove('hidden');
            resultBox.innerHTML = `
                <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-4 mb-2">
                    <p class="text-sm font-bold text-emerald-700">✅ ${successCount} poste(s) importé(s) avec succès.</p>
                </div>
                ${failures.length > 0 ? `
                    <div class="bg-red-50 border border-red-100 rounded-xl p-4">
                        <p class="text-sm font-bold text-red-700 mb-2">❌ ${failures.length} échec(s) :</p>
                        <ul class="text-xs text-red-600 space-y-1">
                            ${failures.map(f => `<li>Ligne ${f.rowNumber} (${escapeHtml(f.name)}) — ${escapeHtml(f.message)}</li>`).join('')}
                        </ul>
                        <p class="text-[11px] text-red-500 mt-2 italic">Ces lignes n'ont pas été importées — corrigez-les dans le fichier et réessayez uniquement pour celles-ci.</p>
                    </div>
                ` : ''}
                ${singlePool ? `<a href="missions.html?pool=${encodeURIComponent(singlePool)}" class="inline-block mt-3 text-xs font-semibold text-primary hover:underline">Voir les postes du pool ${escapeHtml(singlePool)} →</a>` : ''}
            `;
        }

        document.getElementById('importMissionFileInput').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            const statusMsg = document.getElementById('fileStatusMsgMissions');
            document.getElementById('previewCardMissions').classList.add('hidden');
            if (!file) { statusMsg.textContent = ''; return; }

            statusMsg.textContent = 'Lecture du fichier en cours...';
            statusMsg.className = 'text-xs text-slate-500 mt-2';

            try {
                const buffer = await file.arrayBuffer();
                const result = parseMissionWorkbook(buffer);
                if (result.error) {
                    statusMsg.textContent = result.error;
                    statusMsg.className = 'text-xs text-red-600 font-semibold mt-2';
                    return;
                }
                cachedMissionRows = result.rows;
                if (cachedMissionRows.length === 0) {
                    statusMsg.textContent = 'Aucune ligne de données trouvée dans le fichier.';
                    statusMsg.className = 'text-xs text-amber-600 font-semibold mt-2';
                    return;
                }
                statusMsg.textContent = `${cachedMissionRows.length} ligne(s) lue(s) — voir l'aperçu ci-dessous.`;
                statusMsg.className = 'text-xs text-emerald-600 font-semibold mt-2';
                renderMissionPreview(cachedMissionRows);
            } catch (err) {
                console.error('[Import] Erreur de lecture du fichier :', err);
                statusMsg.textContent = "Impossible de lire ce fichier — vérifiez qu'il s'agit bien d'un .xlsx basé sur le modèle fourni.";
                statusMsg.className = 'text-xs text-red-600 font-semibold mt-2';
            }
        });

        document.getElementById('importFileInput').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            const statusMsg = document.getElementById('fileStatusMsg');
            document.getElementById('previewCard').classList.add('hidden');
            if (!file) { statusMsg.textContent = ''; return; }

            statusMsg.textContent = 'Lecture du fichier en cours...';
            statusMsg.className = 'text-xs text-slate-500 mt-2';

            try {
                const buffer = await file.arrayBuffer();
                const result = parseWorkbook(buffer);
                if (result.error) {
                    statusMsg.textContent = result.error;
                    statusMsg.className = 'text-xs text-red-600 font-semibold mt-2';
                    return;
                }
                lastParsedRows = result.rows;
                if (lastParsedRows.length === 0) {
                    statusMsg.textContent = 'Aucune ligne de données trouvée dans le fichier.';
                    statusMsg.className = 'text-xs text-amber-600 font-semibold mt-2';
                    return;
                }
                statusMsg.textContent = `${lastParsedRows.length} ligne(s) lue(s) — voir l'aperçu ci-dessous.`;
                statusMsg.className = 'text-xs text-emerald-600 font-semibold mt-2';
                renderPreview(lastParsedRows);
            } catch (err) {
                console.error('[Import] Erreur de lecture du fichier :', err);
                statusMsg.textContent = "Impossible de lire ce fichier — vérifiez qu'il s'agit bien d'un .xlsx basé sur le modèle fourni.";
                statusMsg.className = 'text-xs text-red-600 font-semibold mt-2';
            }
        });

        window.addEventListener('DOMContentLoaded', () => checkSession());
})();
