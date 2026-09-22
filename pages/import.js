(() => {
        // pageHeaderTitle garde son id pour rester réécrivable en JS selon l'onglet
        // actif (voir setImportMode() plus bas).
        renderPageLayout({
            icon: CapHumaIcons.get('inboxDown', 'w-5 h-5'),
            title: 'Import en masse',
            titleId: 'pageHeaderTitle',
            iconGradient: 'from-primary to-primary-dark',
            variant: 'scroll-page',
            maxWidth: 'max-w-5xl'
        });

        const appBody = document.getElementById('appBody');
        let supabaseClient = null;
        let currentUserId = null;
        let currentUserEmail = null;
        let currentUserName = null;

        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            supabaseClient = capHumaGetSupabaseClient();
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

        // Cette section ne fait que lire et valider le fichier — aucune écriture en
        // base : l'insertion réelle est une étape distincte, déclenchée par un clic
        // sur le bouton d'import (voir runImport() plus bas).
        let cachedPools = [];
        let cachedExistingEmails = new Set();
        let lastParsedRows = [];

        const EDU_LEVELS_VALID = new Set(['none','bac','bac+1','bac+2','bac+3','bac+4','bac+5','bac+6','bac+7','bac+8+']);
        const MISSIONS_LABEL_TO_ENUM = { '0 mission': 'none', '1 mission': 'one', '2 missions': 'two', '3 missions et +': 'three_plus' };
        const AVAILABILITY_LABEL_TO_ENUM = { 'Immédiate': 'asap', 'Date précise': 'date', 'Préavis': 'notice' };
        const HAS_VISA_LABEL_TO_BOOL = { 'Oui': true, 'Non': false };
        const EXAMPLE_ROW_EMAIL = 'awa.ndiaye@example.com';

        const IMPORT_ALLOWED_EXTENSION = '.xlsx';
        const IMPORT_MAX_FILE_SIZE_MB = 10;
        const IMPORT_MAX_FILE_SIZE_BYTES = IMPORT_MAX_FILE_SIZE_MB * 1024 * 1024;
        const IMPORT_MAX_ROWS = 300;
        const IMPORT_MAX_TEXT_LENGTH = 200;
        const IMPORT_MAX_LIST_ITEM_LENGTH = 300;
        const IMPORT_MIN_YEAR = 1950;
        const IMPORT_MAX_YEAR = new Date().getFullYear() + 15;

        // Le sélecteur (accept=".xlsx") ne bloque qu'à la sélection dans
        // l'explorateur de fichiers — un fichier renommé le contourne. Revérifié
        // ici, avant toute lecture, en plus de la taille.
        function validateImportFile(file) {
            if (!file.name.toLowerCase().endsWith(IMPORT_ALLOWED_EXTENSION)) {
                return `Format non autorisé — seul ${IMPORT_ALLOWED_EXTENSION} est accepté.`;
            }
            if (file.size > IMPORT_MAX_FILE_SIZE_BYTES) {
                return `Le fichier dépasse la taille maximale autorisée (${IMPORT_MAX_FILE_SIZE_MB} Mo).`;
            }
            return null;
        }

        // Correspond exactement à la ligne 2 (noms techniques) du modèle livré —
        // ne pas modifier sans mettre à jour le modèle Excel en parallèle.
        const IMPORT_COLUMNS = [
            'first_name', 'last_name', 'email', 'pool', 'staff_type', 'tracking_pool', 'gender', 'nationality',
            'country_of_residence', 'current_function', 'education_level', 'education_specialty',
            'languages', 'other_languages', 'key_skills', 'intervention_contexts', 'intervention_zones',
            'has_visa', 'pool_integration_date', 'experience_months_alima', 'experience_months_humanitarian',
            'number_of_alima_missions', 'availability_type', 'availability_date', 'availability_months', 'status'
        ];

        async function loadReferenceData() {
            try {
                const { data, error } = await CapHumaData.getPools(supabaseClient, { select: 'pool_id, name' });
                if (error) throw error;
                cachedPools = data || [];
            } catch (err) {
                console.error('[Import] Erreur de chargement des pools :', err);
            }
            try {
                const { data, error } = await CapHumaData.getTalents(supabaseClient, { select: 'email' });
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

        function sanitizeFreeText(raw) {
            return capHumaStripControlChars(raw);
        }

        function checkTextLength(value, fieldLabel, maxLen, errors) {
            if (value && value.length > maxLen) errors.push(`${fieldLabel} dépasse ${maxLen} caractères`);
        }

        function checkListLengths(list, fieldLabel, maxLen, errors) {
            list.forEach(item => checkTextLength(item, fieldLabel, maxLen, errors));
        }

        function isPlausibleDate(date, fieldLabel, errors) {
            const year = date.getFullYear();
            if (year < IMPORT_MIN_YEAR || year > IMPORT_MAX_YEAR) {
                errors.push(`${fieldLabel} peu plausible (année ${year})`);
            }
        }

        // absent → null sans erreur ; présent et reconnu → valeur normalisée ; présent
        // et non reconnu → erreur, avec la valeur brute conservée pour un Set (cohérent
        // avec gender/education_level) ou null pour une table de correspondance.
        function validateOptionalEnumField(rawValue, allowedValues, fieldLabel) {
            if (!rawValue) return { value: null, error: null };
            const isSet = allowedValues instanceof Set;
            const isValid = isSet ? allowedValues.has(rawValue) : (rawValue in allowedValues);
            if (!isValid) {
                return { value: isSet ? rawValue : null, error: `${fieldLabel} "${rawValue}" invalide` };
            }
            return { value: isSet ? rawValue : allowedValues[rawValue], error: null };
        }

        // absent → pas d'erreur, code null ; présent et reconnu par le référentiel
        // (shared/caphuma-countries.js) → code ISO ; présent et non reconnu → erreur
        // nommant la valeur refusée. Même sémantique que validateOptionalEnumField()
        // ci-dessus, mais résolu dynamiquement plutôt que contre une liste fixe.
        function validateOptionalCountryField(rawValue, fieldLabel) {
            if (!rawValue) return { value: null, error: null };
            const code = CapHumaCountries.findCodeByText(rawValue);
            if (!code) return { value: null, error: `${fieldLabel} "${rawValue}" non reconnu(e)` };
            return { value: code, error: null };
        }

        // invertLabelMap est déclarée plus bas dans ce fichier (déclaration de fonction,
        // hissée — utilisable ici sans souci d'ordre).
        const STAFF_TYPE_LABEL_TO_ENUM = invertLabelMap(STAFF_TYPE_LABELS);

        const TALENT_OPTIONAL_ENUM_FIELDS = [
            { key: 'education_level', label: "Niveau d'études", allowed: EDU_LEVELS_VALID },
            { key: 'has_visa', label: 'Visa', allowed: HAS_VISA_LABEL_TO_BOOL },
            { key: 'number_of_alima_missions', label: 'Missions', allowed: MISSIONS_LABEL_TO_ENUM },
            { key: 'availability_type', label: 'Disponibilité', allowed: AVAILABILITY_LABEL_TO_ENUM }
        ];

        // Reprend les valeurs du filtre "Statut" de talents.html — aucune liste
        // centralisée dans caphuma-utils.js pour ce champ précis.
        const TALENT_STATUS_VALID = new Set([
            'En poste ALIMA', 'En attente de poste', 'En poste autre ONG', 'En poste hors humanitaire'
        ]);

        function validateRequiredIdentityFields(firstName, lastName, email, errors) {
            if (!firstName) errors.push('Prénom manquant');
            if (!lastName) errors.push('Nom manquant');
            if (!email) errors.push('Email manquant');
            else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email au format invalide');
        }

        // Vide -> expat (comportement par défaut, identique à avant l'ajout de cette
        // colonne — rétrocompatible avec un fichier qui ne la remplit pas).
        function resolveStaffType(staffTypeRaw, errors) {
            if (!staffTypeRaw) return 'expat';
            const staffType = STAFF_TYPE_LABEL_TO_ENUM[staffTypeRaw];
            if (!staffType) errors.push(`Type de staff "${staffTypeRaw}" invalide (attendu : Expatrié / National)`);
            return staffType;
        }

        function resolveTrackingPool(trackingPoolRaw, errors) {
            if (!trackingPoolRaw) return null;
            if (!cachedPools.some(p => (p.pool_id || '').toUpperCase() === String(trackingPoolRaw).toUpperCase())) {
                errors.push(`Pool de suivi "${trackingPoolRaw}" inconnu`);
                return null;
            }
            return String(trackingPoolRaw).toUpperCase();
        }

        function validatePoolForStaffType(staffType, pool, trackingPoolRaw, errors) {
            if (staffType === 'national') {
                if (pool) errors.push('Code Pool doit être vide pour un staff national (utiliser Pool de suivi)');
            } else {
                if (!pool) errors.push('Code Pool manquant');
                else if (!cachedPools.some(p => (p.pool_id || '').toUpperCase() === String(pool).toUpperCase())) {
                    errors.push(`Pool "${pool}" inconnu`);
                }
                if (trackingPoolRaw) errors.push('Pool de suivi ne doit être rempli que pour un staff national');
            }
        }

        function checkEmailDuplicates(email, seenEmailsInFile, errors) {
            const emailLower = (email || '').toString().toLowerCase();
            if (email) {
                if (seenEmailsInFile.has(emailLower)) errors.push('Email en double dans le fichier');
                else seenEmailsInFile.add(emailLower);
                if (cachedExistingEmails.has(emailLower)) errors.push('Un talent avec cet email existe déjà');
            }
        }

        function validateGender(gender, errors) {
            if (gender && gender !== 'H' && gender !== 'F') errors.push(`Genre "${gender}" invalide`);
        }

        function validateStatus(status, errors) {
            if (status && !TALENT_STATUS_VALID.has(status)) {
                errors.push(`Statut "${status}" invalide (attendu : ${Array.from(TALENT_STATUS_VALID).join(' / ')})`);
            }
        }

        function resolveOptionalEnumFields(get, errors) {
            const enumResults = {};
            TALENT_OPTIONAL_ENUM_FIELDS.forEach(({ key, label, allowed }) => {
                const { value, error } = validateOptionalEnumField(get(key), allowed, label);
                if (error) errors.push(error);
                enumResults[key] = value;
            });
            return enumResults;
        }

        function resolveNationality(get, errors) {
            const result = validateOptionalCountryField(get('nationality'), 'Nationalité');
            if (result.error) errors.push(result.error);
            return result.value;
        }

        function resolveAvailability(get, raw, availabilityType, errors) {
            let availDate = null;
            if (availabilityType === 'date') {
                availDate = parseDateCell(raw['availability_date']);
                if (!availDate) errors.push('Date de disponibilité requise (type = Date précise)');
                else isPlausibleDate(availDate, 'Date de disponibilité', errors);
            }

            let availMonths = null;
            const availMonthsRaw = get('availability_months');
            if (availabilityType === 'notice') {
                availMonths = Number(availMonthsRaw);
                if (availMonthsRaw === '' || availMonthsRaw == null || isNaN(availMonths)) errors.push('Préavis (mois) requis (type = Préavis)');
            } else if (availMonthsRaw !== '' && availMonthsRaw != null) {
                const n = Number(availMonthsRaw);
                if (isNaN(n)) errors.push('Préavis (mois) doit être numérique');
                else availMonths = n;
            }

            return { availDate, availMonths };
        }

        function resolvePoolIntegrationDate(raw, errors) {
            if (!raw['pool_integration_date']) return null;
            const date = parseDateCell(raw['pool_integration_date']);
            if (!date) { errors.push("Date d'intégration invalide"); return null; }
            isPlausibleDate(date, "Date d'intégration", errors);
            return date;
        }

        // NaN volontairement renvoyé tel quel si invalide (comme avant) : sans
        // effet, la ligne est de toute façon rejetée par ses erreurs.
        function resolveNumericField(rawValue, fieldLabel, errors) {
            if (rawValue === '' || rawValue == null) return null;
            const n = Number(rawValue);
            if (isNaN(n)) errors.push(`${fieldLabel} doit être numérique`);
            return n;
        }

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

            validateRequiredIdentityFields(firstName, lastName, email, errors);

            const staffType = resolveStaffType(get('staff_type'), errors);
            const trackingPoolRaw = get('tracking_pool');
            const trackingPool = resolveTrackingPool(trackingPoolRaw, errors);
            validatePoolForStaffType(staffType, pool, trackingPoolRaw, errors);

            checkEmailDuplicates(email, seenEmailsInFile, errors);

            const gender = get('gender');
            validateGender(gender, errors);

            const status = get('status');
            validateStatus(status, errors);

            checkTextLength(firstName, 'Prénom', IMPORT_MAX_TEXT_LENGTH, errors);
            checkTextLength(lastName, 'Nom', IMPORT_MAX_TEXT_LENGTH, errors);
            checkTextLength(get('current_function'), 'Fonction actuelle', IMPORT_MAX_TEXT_LENGTH, errors);
            checkTextLength(get('education_specialty'), "Spécialité d'études", IMPORT_MAX_TEXT_LENGTH, errors);
            checkTextLength(get('country_of_residence'), 'Pays de résidence', IMPORT_MAX_TEXT_LENGTH, errors);
            checkListLengths(splitMultiValue(get('languages')), 'Langue', IMPORT_MAX_LIST_ITEM_LENGTH, errors);
            checkListLengths(splitMultiValue(get('other_languages')), 'Autre langue', IMPORT_MAX_LIST_ITEM_LENGTH, errors);
            checkListLengths(splitMultiValue(get('key_skills')), 'Compétence clé', IMPORT_MAX_LIST_ITEM_LENGTH, errors);
            checkListLengths(splitMultiValue(get('intervention_contexts')), "Contexte d'intervention", IMPORT_MAX_LIST_ITEM_LENGTH, errors);
            checkListLengths(splitMultiValue(get('intervention_zones')), "Zone d'intervention", IMPORT_MAX_LIST_ITEM_LENGTH, errors);

            const enumResults = resolveOptionalEnumFields(get, errors);
            const nationalityCode = resolveNationality(get, errors);
            const { availDate, availMonths } = resolveAvailability(get, raw, enumResults.availability_type, errors);
            const poolIntegrationDate = resolvePoolIntegrationDate(raw, errors);
            const expAlima = resolveNumericField(get('experience_months_alima'), 'Expérience ALIMA (mois)', errors);
            const expHum = resolveNumericField(get('experience_months_humanitarian'), 'Expérience humanitaire (mois)', errors);

            const normalized = {
                first_name: sanitizeFreeText(firstName) || null,
                last_name: sanitizeFreeText(lastName) || null,
                email: email || null,
                pool: staffType === 'national' ? null : (pool ? String(pool).toUpperCase() : null),
                staff_type: staffType,
                tracking_pool: staffType === 'national' ? trackingPool : null,
                gender: gender || null,
                nationality_code: nationalityCode,
                country_of_residence: sanitizeFreeText(get('country_of_residence')) || null,
                current_function: sanitizeFreeText(get('current_function')) || null,
                education_level: enumResults.education_level,
                education_specialty: sanitizeFreeText(get('education_specialty')) || null,
                languages: splitMultiValue(get('languages')).map(sanitizeFreeText),
                other_languages: splitMultiValue(get('other_languages')).map(sanitizeFreeText),
                key_skills: splitMultiValue(get('key_skills')).map(sanitizeFreeText),
                intervention_contexts: splitMultiValue(get('intervention_contexts')).map(sanitizeFreeText),
                intervention_zones: splitMultiValue(get('intervention_zones')).map(sanitizeFreeText),
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
            if (dataRows.length > IMPORT_MAX_ROWS) {
                return { error: `Fichier trop volumineux — ${dataRows.length} lignes, maximum ${IMPORT_MAX_ROWS}.` };
            }

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
                                    <td class="px-3 py-2">${r.normalized.staff_type === 'national'
                                        ? `<span class="text-amber-700 font-semibold">National${r.normalized.tracking_pool ? ` (${escapeHtml(r.normalized.tracking_pool)})` : ''}</span>`
                                        : escapeHtml(r.normalized.pool || '')}</td>
                                    <td class="px-3 py-2">
                                        ${r.errors.length === 0
                                            ? '<span class="text-emerald-600 font-semibold"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg> Valide</span>'
                                            : `<span class="text-red-600 font-semibold"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg> ${escapeHtml(r.errors.join(' · '))}</span>`}
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

        // Par lots de 25 lignes. Les lignes en erreur (déjà filtrées avant l'appel)
        // ne sont jamais envoyées.
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

                // Un défaut Postgres ne s'applique que si la colonne est absente de
                // l'INSERT, jamais si elle est envoyée explicitement à null — on retire
                // donc la clé status plutôt que d'envoyer null quand elle est vide.
                const payload = batch.map(r => {
                    const row = { ...r.normalized, created_by: currentUserId };
                    if (!row.status) delete row.status;
                    return row;
                });

                try {
                    // Pas de capHumaWithRetry() : lot de jusqu'à 25 talents sans aucune
                    // contrainte UNIQUE, une relance après perte de réponse dupliquerait
                    // silencieusement jusqu'à 25 fiches d'un coup.
                    const { data, error } = await CapHumaData.createTalent(supabaseClient, payload, 'id');
                    if (error) throw error;
                    successCount += (data || []).length;
                } catch (err) {
                    console.error('[Import] Échec sur un lot :', err);
                    // Le lot entier a échoué (ex. contrainte violée) : journalisé en bloc,
                    // un échec de lot ne permet pas de savoir quelle ligne précise a posé
                    // problème sans le rejouer ligne par ligne.
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
                    <p class="text-sm font-bold text-emerald-700"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg> ${successCount} talent(s) importé(s) avec succès.</p>
                </div>
                ${failures.length > 0 ? `
                    <div class="bg-red-50 border border-red-100 rounded-xl p-4">
                        <p class="text-sm font-bold text-red-700 mb-2"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg> ${failures.length} échec(s) :</p>
                        <ul class="text-xs text-red-600 space-y-1">
                            ${failures.map(f => `<li>Ligne ${f.rowNumber} (${escapeHtml(f.name)}) — ${escapeHtml(f.message)}</li>`).join('')}
                        </ul>
                        <p class="text-[11px] text-red-500 mt-2 italic">Ces lignes n'ont pas été importées — corrigez-les dans le fichier et réessayez uniquement pour celles-ci.</p>
                    </div>
                ` : ''}
                <a href="talents.html" class="inline-block mt-3 text-xs font-semibold text-primary hover:underline">Voir les talents →</a>
            `;
        }

        // Miroir du module talents ci-dessus, pour la table `missions`. Un poste
        // importé n'a jamais d'occupant à ce stade (occupant_id toujours null, statut
        // limité à vacant/recruiting) — le rattachement d'un talent à un poste reste
        // une action manuelle depuis missions.html. Colonnes vérifiées contre
        // pages/missions.js (MISSIONS_COLUMNS) : `pool` (pas `pool_id`),
        // `occupant_id`/`future_talent_id`.

        const MISSION_IMPORT_COLUMNS = [
            'title', 'pool', 'pool_level', 'status', 'country', 'location',
            'project_name', 'candidate_type', 'desk',
            'contract_start_date', 'contract_end_date', 'contract_status'
        ];
        const EXAMPLE_ROW_TITLE = 'Exemple - Coordinateur Terrain';

        function invertLabelMap(labelMap) {
            const inv = {};
            Object.keys(labelMap).forEach(k => { inv[labelMap[k]] = k; });
            return inv;
        }
        const DESK_LABEL_TO_ENUM = invertLabelMap(DESK_LABELS);
        const CANDIDATE_TYPE_LABEL_TO_ENUM = invertLabelMap(CANDIDATE_TYPE_LABELS);
        const CONTRACT_STATUS_LABEL_TO_ENUM = invertLabelMap(CONTRACT_STATUS_LABELS);

        // pool_level n'est pas centralisé dans caphuma-utils.js, contrairement aux
        // énumérations ci-dessus.
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

        function validateMissionTitle(title, errors) {
            if (!title) errors.push('Titre manquant');
        }

        function validateMissionPool(pool, errors) {
            if (!pool) errors.push('Code Pool manquant');
            else if (!cachedPools.some(p => (p.pool_id || '').toUpperCase() === String(pool).toUpperCase())) {
                errors.push(`Pool "${pool}" inconnu`);
            }
        }

        function resolveMissionCountryCode(country, errors) {
            if (!country) { errors.push('Pays manquant'); return null; }
            const countryCode = CapHumaCountries.findCodeByText(country);
            if (!countryCode) errors.push(`Pays "${country}" non reconnu`);
            return countryCode;
        }

        function validateMissionLocation(location, errors) {
            if (!location) errors.push('Lieu manquant');
        }

        function resolveMissionPoolLevel(poolLevelRaw, errors) {
            if (!poolLevelRaw) { errors.push('Niveau manquant'); return null; }
            if (!(poolLevelRaw in POOL_LEVEL_LABEL_TO_ENUM)) {
                errors.push(`Niveau "${poolLevelRaw}" invalide (attendu : Mission / Projet)`);
                return null;
            }
            return POOL_LEVEL_LABEL_TO_ENUM[poolLevelRaw];
        }

        function resolveMissionStatus(statusRaw, errors) {
            if (!statusRaw) { errors.push('Statut manquant'); return null; }
            if (statusRaw === 'Occupé') {
                errors.push(`Statut "Occupé" non autorisé à l'import — importez en Vacant ou En recrutement, puis affectez le talent depuis la page Postes`);
                return null;
            }
            if (!(statusRaw in MISSION_STATUS_LABEL_TO_ENUM)) {
                errors.push(`Statut "${statusRaw}" invalide (attendu : Vacant / En recrutement)`);
                return null;
            }
            return MISSION_STATUS_LABEL_TO_ENUM[statusRaw];
        }

        // Mêmes 3 champs "optionnel, valeur parmi une liste connue" que côté talent
        // — réduits via validateOptionalEnumField() ci-dessus.
        function resolveMissionOptionalEnumFields(get, errors) {
            const enumResults = {};
            MISSION_OPTIONAL_ENUM_FIELDS.forEach(({ key, label, allowed }) => {
                const { value, error } = validateOptionalEnumField(get(key), allowed, label);
                if (error) errors.push(error);
                enumResults[key] = value;
            });
            return enumResults;
        }

        function resolveMissionContractDate(rawValue, fieldLabel, errors) {
            if (!rawValue) return null;
            const date = parseDateCell(rawValue);
            if (!date) { errors.push(fieldLabel); return null; }
            isPlausibleDate(date, 'Date de contrat', errors);
            return date;
        }

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

            validateMissionTitle(title, errors);
            validateMissionPool(pool, errors);
            const countryCode = resolveMissionCountryCode(country, errors);
            validateMissionLocation(location, errors);

            checkTextLength(title, 'Titre', IMPORT_MAX_TEXT_LENGTH, errors);
            checkTextLength(location, 'Lieu', IMPORT_MAX_TEXT_LENGTH, errors);
            checkTextLength(get('project_name'), 'Nom du projet', IMPORT_MAX_TEXT_LENGTH, errors);

            const poolLevel = resolveMissionPoolLevel(get('pool_level'), errors);
            const status = resolveMissionStatus(get('status'), errors);
            const enumResults = resolveMissionOptionalEnumFields(get, errors);
            const contractStart = resolveMissionContractDate(get('contract_start_date'), 'Date début contrat invalide', errors);
            const contractEnd = resolveMissionContractDate(get('contract_end_date'), 'Date fin contrat invalide', errors);

            const normalized = {
                title: sanitizeFreeText(title) || null,
                pool: pool ? String(pool).toUpperCase() : null,
                pool_level: poolLevel,
                status: status,
                country_code: countryCode,
                location: sanitizeFreeText(location) || null,
                project_name: sanitizeFreeText(get('project_name')) || null,
                candidate_type: enumResults.candidate_type,
                // is_expat maintenue en cohérence avec candidate_type, comme le formulaire
                // manuel de missions.html.
                is_expat: enumResults.candidate_type ? enumResults.candidate_type === 'expat' : null,
                desk: enumResults.desk,
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
            if (dataRows.length > IMPORT_MAX_ROWS) {
                return { error: `Fichier trop volumineux — ${dataRows.length} lignes, maximum ${IMPORT_MAX_ROWS}.` };
            }

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
                                    <td class="px-3 py-2">${escapeHtml(((r.normalized.location || '') + ' — ' + (CapHumaCountries.getCountryName(r.normalized.country_code) || '')))}</td>
                                    <td class="px-3 py-2">
                                        ${r.errors.length === 0
                                            ? '<span class="text-emerald-600 font-semibold"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg> Valide</span>'
                                            : `<span class="text-red-600 font-semibold"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg> ${escapeHtml(r.errors.join(' · '))}</span>`}
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
                    // Pas de capHumaWithRetry(), même raison que l'import de talents :
                    // lot sans contrainte UNIQUE sur missions, un retry après perte de
                    // réponse dupliquerait silencieusement jusqu'à 25 postes d'un coup.
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

            // Le trigger Postgres trg_audit_missions journalise déjà chaque insertion
            // individuellement — ce log-ci ne fait qu'ajouter une synthèse de
            // l'opération globale, cohérent avec l'import talents.
            await logAuditAction(
                'create', 'mission', null, 'Import en masse',
                `${successCount} poste(s) importé(s), ${failures.length} échec(s) sur ${validRows.length} ligne(s) tentée(s)`
            );

            const singlePool = poolsUsed.size === 1 ? Array.from(poolsUsed)[0] : null;

            resultBox.classList.remove('hidden');
            resultBox.innerHTML = `
                <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-4 mb-2">
                    <p class="text-sm font-bold text-emerald-700"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg> ${successCount} poste(s) importé(s) avec succès.</p>
                </div>
                ${failures.length > 0 ? `
                    <div class="bg-red-50 border border-red-100 rounded-xl p-4">
                        <p class="text-sm font-bold text-red-700 mb-2"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg> ${failures.length} échec(s) :</p>
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

            const fileError = validateImportFile(file);
            if (fileError) {
                statusMsg.textContent = fileError;
                statusMsg.className = 'text-xs text-red-600 font-semibold mt-2';
                return;
            }

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

            const fileError = validateImportFile(file);
            if (fileError) {
                statusMsg.textContent = fileError;
                statusMsg.className = 'text-xs text-red-600 font-semibold mt-2';
                return;
            }

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
