// Fiche talent — onglets de la modale, champs "tags" réutilisables, affichage
// conditionnel, compteur de validité, arbitrage (prolonger/dévalider),
// formations ALIMA, brouillon local, ouverture/fermeture et enregistrement de
// la modale. Voir talents.js (chargé AVANT ce fichier) pour l'explication de
// TalentsPage.
(() => {

        // ============================================================================
        // 4. GESTION DES ONGLETS DE LA MODALE
        // ============================================================================
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tabId = btn.dataset.tab;
                document.querySelectorAll('.tab-panel').forEach(p => {
                    p.classList.toggle('hidden', p.dataset.panel !== tabId);
                });
            });
        });

        function resetTabsToFirst() {
            document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== '1'));
        }

        // ============================================================================
        // 5. CHAMPS "TAGS" RÉUTILISABLES (langues, contextes, zones, compétences)
        // ============================================================================
        function createTagField(containerId, fieldName, label, maxTags) {
            const container = document.getElementById(containerId);
            // id dérivé de fieldName (déjà un identifiant simple sans espace, cf. les 5
            // appels de createTagField()) pour associer le label généré à son champ
            // via for=/id=, sur le même modèle que les labels statiques des autres
            // pages.
            const inputId = `tagfield-input-${fieldName.replace(/_/g, '-')}`;
            container.innerHTML = `
                <label class="text-xs font-bold text-slate-500 uppercase" for="${inputId}">${label}</label>
                <div class="tags-wrap flex flex-wrap gap-1.5 mt-1 mb-1.5" data-field="${fieldName}"></div>
                <input id="${inputId}" type="text" class="tag-input w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:border-primary" placeholder="Tape puis Entrée pour ajouter" data-field="${fieldName}" />
            `;
            const input = container.querySelector('.tag-input');
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = input.value.trim();
                    const wrap = container.querySelector('.tags-wrap');
                    const current = wrap.querySelectorAll('.tag-chip').length;
                    if (val && (!maxTags || current < maxTags)) {
                        addTagChip(wrap, val);
                        input.value = '';
                    }
                }
            });
        }

        function addTagChip(wrap, value) {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.dataset.value = value;
            chip.innerHTML = `${escapeHtml(value)} <button type="button">&times;</button>`;
            chip.querySelector('button').addEventListener('click', () => chip.remove());
            wrap.appendChild(chip);
        }

        function getTagValues(fieldName) {
            const wrap = document.querySelector(`.tags-wrap[data-field="${fieldName}"]`);
            return Array.from(wrap.querySelectorAll('.tag-chip')).map(c => c.dataset.value);
        }

        function setTagValues(fieldName, values) {
            const wrap = document.querySelector(`.tags-wrap[data-field="${fieldName}"]`);
            wrap.innerHTML = '';
            (values || []).forEach(v => addTagChip(wrap, v));
        }

        createTagField('tagfield_languages', 'languages', 'Langues parlées', null);
        createTagField('tagfield_other_languages', 'other_languages', 'Autres langues (non répertoriées)', null);
        createTagField('tagfield_intervention_contexts', 'intervention_contexts', "Contextes d'intervention", null);
        createTagField('tagfield_intervention_zones', 'intervention_zones', 'Zones géographiques', null);
        createTagField('tagfield_key_skills', 'key_skills', 'Compétences clés', 5);

        // ============================================================================
        // 6. AFFICHAGE CONDITIONNEL (disponibilité, commentaires missions)
        // ============================================================================
        document.getElementById('availabilityType').addEventListener('change', function () {
            document.getElementById('availabilityMonthsWrap').classList.toggle('hidden', this.value !== 'notice');
            document.getElementById('availabilityDateWrap').classList.toggle('hidden', this.value !== 'date');
        });

        // ── Cohérence "A effectué une mission ALIMA" / "Nombre de missions" / "Date de fin de dernière mission" ──
        const hadAlimaMissionCb = document.getElementById('hadAlimaMissionCb');
        const numberOfMissionsSelect = document.getElementById('numberOfMissionsSelect');
        const lastMissionEndDateWrap = document.getElementById('lastMissionEndDateWrap');
        const lastMissionEndDateInput = talentForm.querySelector('[name="last_mission_end_date"]');

        function syncMissionFields() {
            if (hadAlimaMissionCb.checked) {
                lastMissionEndDateWrap.classList.remove('hidden');
                lastMissionEndDateInput.required = true;
                numberOfMissionsSelect.querySelector('option[value="none"]').disabled = true;
                if (numberOfMissionsSelect.value === 'none') numberOfMissionsSelect.value = 'one';
            } else {
                lastMissionEndDateWrap.classList.add('hidden');
                lastMissionEndDateInput.required = false;
                lastMissionEndDateInput.value = '';
                numberOfMissionsSelect.querySelector('option[value="none"]').disabled = false;
                numberOfMissionsSelect.value = 'none';
            }
        }
        hadAlimaMissionCb.addEventListener('change', syncMissionFields);

        // ============================================================================
        // 7. COMPTEUR DE VALIDITÉ & BARRE DE PROGRESSION (DevalidationProgressBar)
        // ============================================================================
        // DEVALIDATION_MAX_MONTHS (et DEVALIDATION_AT_RISK_MONTHS/CRITICAL_MONTHS,
        // utilisées plus bas) viennent de shared/caphuma-utils.js (chargé ligne 10)
        // — seul endroit du site où ces 3 seuils sont définis. Ne PAS les redéclarer
        // ici : un second "const" du même nom dans une balise <script> différente de
        // la même page provoque une erreur de syntaxe qui casse tout le script.

        // calculateMonthsWithoutMission() vient de shared/caphuma-utils.js (chargé
        // ligne 10), qui utilise la méthode calendaire — la même que statistics.html
        // et id-card.html.

        // Une prolongation est active tant que devalidation_extension_until est dans le futur.
        function hasActiveExtension(talent) {
            if (!talent.devalidation_extension_until) return false;
            return new Date(talent.devalidation_extension_until).getTime() > Date.now();
        }

        // Un talent est proposé à l'arbitrage (dévalider/prolonger) s'il n'est pas déjà
        // dévalidé, qu'il a atteint le seuil des 24 mois sans mission, et qu'aucune
        // prolongation active ne le couvre encore.
        function isDevalidationEligible(talent) {
            if (talent.is_valid === false) return false;
            if (hasActiveExtension(talent)) return false;
            return calculateMonthsWithoutMission(talent) >= DEVALIDATION_MAX_MONTHS;
        }

        // ============================================================================
        // 7bis. ARBITRAGE : PROLONGER OU DÉVALIDER DEPUIS LA LISTE
        // ============================================================================
        // toastMessage() retirée d'ici : vient désormais de shared/caphuma-utils.js
        // (comportement identique — cette page avait déjà cette version).

        let talentPendingArbitration = null;
        const prolongModal = document.getElementById('prolongModal');

        function openProlongModal(talent) {
            talentPendingArbitration = talent;
            document.getElementById('prolongTalentName').textContent = `${talent.first_name || ''} ${talent.last_name || ''}`.trim();
            document.getElementById('prolongMonths').value = '3';
            prolongModal.classList.remove('hidden');
        }

        document.getElementById('prolongCancelBtn').addEventListener('click', () => {
            prolongModal.classList.add('hidden');
            talentPendingArbitration = null;
        });

        document.getElementById('prolongConfirmBtn').addEventListener('click', async () => {
            if (!talentPendingArbitration) return;
            const months = parseInt(document.getElementById('prolongMonths').value, 10);

            const untilDate = new Date();
            untilDate.setMonth(untilDate.getMonth() + months);
            const untilStr = untilDate.toISOString().slice(0, 10); // colonne "date"

            try {
                const { error } = await capHumaWithRetry(() =>
                    TalentsPage.supabaseClient
                        .from('talents')
                        .update({
                            devalidation_extension_until: untilStr,
                            devalidation_extension_months: months,
                            devalidation_extension_granted_by: TalentsPage.currentUserId,
                            devalidation_extension_granted_by_name: TalentsPage.currentUserEmail,
                            devalidation_extension_granted_at: new Date().toISOString()
                        })
                        .eq('id', talentPendingArbitration.id)
                );

                if (error) throw error;

                // Journalisé automatiquement par le trigger Postgres trg_audit_talents
                // (détecte la prolongation via devalidation_extension_until).
                prolongModal.classList.add('hidden');
                toastMessage(`Prolongation de ${months} mois accordée.`);
                talentPendingArbitration = null;
                await TalentsPage.loadTalents();
            } catch (err) {
                console.error(err);
                toastMessage("Échec de la prolongation : " + err.message, "error");
            }
        });

        // Dévalidation directe depuis la liste : aucun email n'est envoyé
        // automatiquement (choix validé avec l'utilisateur) — le recruteur/admin
        // doit avoir contacté le talent lui-même avant de confirmer ici.
        async function devalidateTalentFromList(talent) {
            const fullName = `${talent.first_name || ''} ${talent.last_name || ''}`.trim();
            const confirmed = confirm(
                `Dévalider "${fullName}" ?\n\nAssurez-vous d'avoir déjà envoyé un email à ${talent.email || '(email non renseigné)'} avant de confirmer.\nCette action est réversible depuis la fiche du talent (bouton Réintégrer).`
            );
            if (!confirmed) return;

            try {
                const { error } = await capHumaWithRetry(() =>
                    TalentsPage.supabaseClient
                        .from('talents')
                        .update({
                            is_valid: false,
                            devalidation_date: new Date().toISOString().slice(0, 10),
                            devalidation_extension_until: null,
                            devalidation_extension_months: null,
                            devalidation_extension_granted_by: null,
                            devalidation_extension_granted_by_name: null,
                            devalidation_extension_granted_at: null
                        })
                        .eq('id', talent.id)
                );

                if (error) throw error;

                // Journalisé automatiquement par le trigger Postgres trg_audit_talents.
                toastMessage(`${fullName} a été dévalidé(e).`);
                await TalentsPage.loadTalents();
            } catch (err) {
                console.error(err);
                toastMessage("Échec de la dévalidation : " + err.message, "error");
            }
        }

        function getValidityData(talent) {
            const isInvalid = talent.is_valid === false;
            const isCurrentlyOnMission = talent.is_currently_on_mission || talent.isCurrentlyOnAlimaMission;
            const isPaused = !isInvalid && (isCurrentlyOnMission || talent.status === 'En poste ALIMA');
            const totalMonths = isInvalid ? DEVALIDATION_MAX_MONTHS : calculateMonthsWithoutMission(talent);
            const cappedMonths = Math.min(totalMonths, DEVALIDATION_MAX_MONTHS);
            const progressPercent = (cappedMonths / DEVALIDATION_MAX_MONTHS) * 100;
            const remainingMonths = Math.max(0, DEVALIDATION_MAX_MONTHS - totalMonths);

            let barColor, textColor;
            if (isInvalid || totalMonths >= DEVALIDATION_MAX_MONTHS) { barColor = 'bg-red-600'; textColor = 'text-red-600'; }
            else if (totalMonths >= DEVALIDATION_CRITICAL_MONTHS) { barColor = 'bg-red-50'; textColor = 'text-red-600'; }
            else if (totalMonths >= DEVALIDATION_AT_RISK_MONTHS) { barColor = 'bg-orange-400'; textColor = 'text-orange-600'; }
            else { barColor = 'bg-green-500'; textColor = 'text-slate-500'; }

            const refDate = talent.last_mission_end_date || talent.pool_integration_date;
            const refLabel = talent.last_mission_end_date ? 'Fin dernière mission' : 'Intégration pool';

            return { isInvalid, isPaused, totalMonths, cappedMonths, progressPercent, remainingMonths, barColor, textColor, refDate, refLabel };
        }

        // Version "liste" de la jauge de validité — reprend le même contenu que
        // renderValidityIndicator() (libellé + explication contextuelle selon la
        // position du talent), mais retourne une chaîne HTML autonome au lieu
        // d'injecter dans un unique élément #validityIndicator, pour être utilisable
        // une fois par ligne dans la liste des talents.
        function renderInlineValidityBar(talent) {
            const v = getValidityData(talent);
            let labelHtml, bottomHtml;

            if (v.isInvalid) {
                labelHtml = `<span class="text-red-600 font-bold flex items-center gap-1">⛔ Dévalidé</span><span class="text-red-600 font-bold">${DEVALIDATION_MAX_MONTHS} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                bottomHtml = '';
            } else if (v.isPaused) {
                labelHtml = `<span class="text-blue-600 font-bold flex items-center gap-1">⏸ Compteur suspendu</span><span class="font-bold ${v.textColor}">${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                bottomHtml = `<p class="text-[11px] text-blue-500 mt-0.5">⏸ En mission ALIMA — compteur en pause</p>`;
            } else {
                const riskLabel = v.totalMonths < DEVALIDATION_AT_RISK_MONTHS ? 'Validité pool' : (v.totalMonths >= DEVALIDATION_CRITICAL_MONTHS ? 'Critique' : 'À risque');
                const riskIcon = v.totalMonths < DEVALIDATION_AT_RISK_MONTHS ? '✅' : '⚠️';
                labelHtml = `<span class="font-bold ${v.textColor} flex items-center gap-1">${riskIcon} ${riskLabel}</span><span class="font-bold ${v.textColor}">${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                const remainingText = v.totalMonths >= DEVALIDATION_AT_RISK_MONTHS
                    ? (v.remainingMonths === 0 ? 'Dévalidation imminente !' : `${v.remainingMonths} mois restant${v.remainingMonths > 1 ? 's' : ''} avant éjection du pool`)
                    : '';
                bottomHtml = remainingText
                    ? `<p class="text-[11px] font-medium ${v.textColor} mt-0.5">${remainingText}</p>`
                    : '';
            }

            return `
                <div class="mt-2">
                    <div class="flex items-center justify-between text-[11px] mb-1">${labelHtml}</div>
                    <div class="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden"><div class="h-full rounded-full ${v.barColor} ${v.isPaused ? 'opacity-50' : ''}" style="width:${v.progressPercent}%"></div></div>
                    ${bottomHtml}
                </div>
            `;
        }

        function renderValidityIndicator(talent) {
            const box = document.getElementById('validityIndicator');
            const v = getValidityData(talent);
            box.classList.remove('hidden');

            let labelHtml, bottomHtml;

            if (v.isInvalid) {
                labelHtml = `<span class="text-red-600 font-bold flex items-center gap-1">⛔ Dévalidé</span><span class="text-red-600 font-bold">${DEVALIDATION_MAX_MONTHS} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                bottomHtml = '';
            } else if (v.isPaused) {
                labelHtml = `<span class="text-blue-600 font-bold flex items-center gap-1">⏸ Compteur suspendu</span><span class="font-bold ${v.textColor}">${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                bottomHtml = `<p class="text-xs text-blue-500 mt-1">⏸ En mission ALIMA — compteur en pause</p>`;
            } else {
                const riskLabel = v.totalMonths < DEVALIDATION_AT_RISK_MONTHS ? '✅ Validité pool' : (v.totalMonths >= DEVALIDATION_CRITICAL_MONTHS ? '⚠️ Critique' : '⚠️ À risque');
                labelHtml = `<span class="font-bold ${v.textColor}">${riskLabel}</span><span class="font-bold ${v.textColor}">${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                const remainingText = v.totalMonths >= DEVALIDATION_AT_RISK_MONTHS
                    ? (v.remainingMonths === 0 ? 'Dévalidation imminente !' : `${v.remainingMonths} mois restant${v.remainingMonths > 1 ? 's' : ''} avant éjection du pool`)
                    : '';
                bottomHtml = `<div class="flex items-center justify-between text-xs text-slate-500 mt-1">
                    <span class="font-medium ${v.textColor}">${remainingText}</span>
                    <span class="italic">${v.refLabel} : ${v.refDate ? new Date(v.refDate).toLocaleDateString('fr-FR') : 'N/A'}</span>
                </div>`;
            }

            box.innerHTML = `
                <div class="flex items-center justify-between text-xs mb-1.5">${labelHtml}</div>
                <div class="h-1.5 w-full rounded-full bg-white overflow-hidden"><div class="h-full rounded-full ${v.barColor} ${v.isPaused ? 'opacity-50' : ''}" style="width:${v.progressPercent}%"></div></div>
                ${bottomHtml}
            `;
        }

        document.querySelectorAll('.mission-checkbox').forEach(cb => {
            cb.addEventListener('change', function () {
                const target = document.querySelector(`textarea[name="${this.dataset.target}"]`);
                target.classList.toggle('hidden', !this.checked);
            });
        });

        // ============================================================================
        // 8. FORMATIONS ALIMA — LIGNES DYNAMIQUES
        // ============================================================================
        function addTrainingRow(training) {
            training = training || {};
            const row = document.createElement('div');
            row.className = 'training-row grid grid-cols-12 gap-2 items-center bg-slate-50 border border-slate-200 rounded-lg p-2';
            row.innerHTML = `
                <input class="training-name col-span-4 rounded border border-slate-200 p-1.5 text-xs" placeholder="Nom formation" value="${escapeHtml(training.name || '')}" />
                <input class="training-date col-span-3 rounded border border-slate-200 p-1.5 text-xs" type="date" value="${escapeHtml(training.date ? training.date.substring(0,10) : '')}" />
                <input class="training-duration col-span-2 rounded border border-slate-200 p-1.5 text-xs" placeholder="Durée" value="${escapeHtml(training.duration || '')}" />
                <input class="training-desc col-span-2 rounded border border-slate-200 p-1.5 text-xs" placeholder="Description" value="${escapeHtml(training.description || '')}" />
                <button type="button" class="removeTrainingBtn col-span-1 text-red-500 text-lg">&times;</button>
            `;
            row.querySelector('.removeTrainingBtn').addEventListener('click', () => row.remove());
            document.getElementById('trainingsList').appendChild(row);
        }

        document.getElementById('addTrainingBtn').addEventListener('click', () => addTrainingRow());

        function getTrainingsValues() {
            return Array.from(document.querySelectorAll('.training-row')).map(row => ({
                name: row.querySelector('.training-name').value,
                date: row.querySelector('.training-date').value ? new Date(row.querySelector('.training-date').value).toISOString() : null,
                duration: row.querySelector('.training-duration').value,
                description: row.querySelector('.training-desc').value
            })).filter(t => t.name);
        }

        // ============================================================================
        // 8bis. BROUILLON LOCAL
        // ============================================================================
        // Sauvegarde locale du contenu du formulaire en cours de saisie, pour ne pas
        // tout perdre en cas de fermeture d'onglet, crash, ou rechargement pendant une
        // erreur affichée — voir shared/caphuma-form-draft.js pour le mécanisme
        // générique et les décisions de périmètre.
        //
        // Portée : création ET édition. Clé propre à chaque cas (`draft:talent:new`
        // en création, `draft:talent:edit:<id>` en édition) pour qu'un brouillon ne
        // s'applique jamais par erreur à une autre fiche que celle visée.
        //
        // collectTalentDraft()/restoreTalentDraft() réutilisent volontairement les
        // fonctions déjà existantes (getTagValues()/setTagValues() §5,
        // getTrainingsValues()/addTrainingRow() ci-dessus) plutôt que de dupliquer la
        // logique de lecture/écriture des tags et formations — ces champs ne sont pas
        // couverts par la collecte par défaut de caphuma-form-draft.js (chips et
        // lignes dynamiques sans name=).
        let currentTalentDraftKey = null;
        let currentTalentDraftBinding = null;

        function collectTalentDraft() {
            const data = capHumaDefaultDraftCollect(talentForm);
            data.__tags = {
                languages: getTagValues('languages'),
                other_languages: getTagValues('other_languages'),
                intervention_contexts: getTagValues('intervention_contexts'),
                intervention_zones: getTagValues('intervention_zones'),
                key_skills: getTagValues('key_skills')
            };
            data.__trainings = getTrainingsValues();
            return data;
        }

        function restoreTalentDraft(data) {
            capHumaDefaultDraftRestore(talentForm, data);

            if (data.__tags) {
                Object.entries(data.__tags).forEach(([field, values]) => setTagValues(field, values));
            }
            if (data.__trainings) {
                document.getElementById('trainingsList').innerHTML = '';
                data.__trainings.forEach(tr => addTrainingRow(tr));
            }

            // Champs conditionnels pilotés par des écouteurs 'change' (jamais
            // déclenchés par une affectation .value/.checked programmatique) — même
            // logique que celle déjà appliquée par openEditModal() pour ces mêmes
            // champs, réappliquée ici après restauration des valeurs du brouillon.
            const availabilityTypeField = talentForm.querySelector('[name="availability_type"]');
            if (availabilityTypeField) {
                document.getElementById('availabilityMonthsWrap').classList.toggle('hidden', availabilityTypeField.value !== 'notice');
                document.getElementById('availabilityDateWrap').classList.toggle('hidden', availabilityTypeField.value !== 'date');
            }
            syncMissionFields();
            document.querySelectorAll('.mission-checkbox').forEach(cb => {
                document.querySelector(`textarea[name="${cb.dataset.target}"]`).classList.toggle('hidden', !cb.checked);
            });
        }

        // Démarre le suivi de brouillon pour la modale qui vient de s'ouvrir — appelé
        // en toute fin de openCreateModal()/openEditModal(), une fois le formulaire
        // entièrement rempli (données réelles du talent en édition), pour que l'offre
        // de restauration ne porte que sur ce que l'utilisateur avait tapé en plus.
        function startTalentDraftTracking(draftKey) {
            stopTalentDraftTracking();
            currentTalentDraftKey = draftKey;
            capHumaOfferDraftRestore(draftKey, restoreTalentDraft);
            currentTalentDraftBinding = capHumaAttachDraftAutosave(talentForm, draftKey, { collect: collectTalentDraft });
        }

        // Annuler/× ferme la boîte SANS effacer le brouillon — un clic sur la croix
        // sert souvent juste à sortir provisoirement, pas à jeter délibérément la
        // saisie. Le brouillon reste donc en sessionStorage et sera reproposé à la
        // prochaine ouverture de la même fiche (voir shared/caphuma-form-draft.js
        // pour la règle complète). Seul l'autosave est arrêté, pour ne pas continuer
        // à écrire sur un formulaire désormais masqué.
        function stopTalentDraftTracking() {
            if (currentTalentDraftBinding) {
                currentTalentDraftBinding.stop();
                currentTalentDraftBinding = null;
            }
        }

        // Effacement DÉFINITIF — appelé uniquement après un enregistrement réussi
        // (section 10) : le brouillon n'a alors plus lieu d'être.
        function discardTalentDraft() {
            stopTalentDraftTracking();
            if (currentTalentDraftKey) {
                capHumaDraftClear(currentTalentDraftKey);
                currentTalentDraftKey = null;
            }
        }

        // ============================================================================
        // 9. OUVERTURE / FERMETURE DE LA MODALE
        // ============================================================================
        const talentModal = document.getElementById('talentModal');
        const formError = document.getElementById('formError');
        let editingTalentId = null;

        function openCreateModal() {
            editingTalentId = null;
            talentForm.reset();
            document.getElementById('modalTitle').textContent = 'Nouveau talent';
            document.querySelectorAll('.tags-wrap').forEach(w => w.innerHTML = '');
            document.getElementById('trainingsList').innerHTML = '';
            document.getElementById('availabilityMonthsWrap').classList.add('hidden');
            document.getElementById('availabilityDateWrap').classList.add('hidden');
            document.querySelectorAll('.mission-checkbox').forEach(cb => {
                document.querySelector(`textarea[name="${cb.dataset.target}"]`).classList.add('hidden');
            });
            document.getElementById('redListReadonly').innerHTML = "Ces informations apparaîtront ici une fois le profil créé. La gestion de la Liste Rouge se fait exclusivement depuis <strong>Admin</strong>.";
            document.getElementById('historyReadonly').innerHTML = "L'historique se construit automatiquement au fil du temps. Aucun historique pour un nouveau profil.";
            document.getElementById('validityIndicator').classList.add('hidden');
            syncMissionFields();
            formError.classList.add('hidden');
            resetTabsToFirst();
            startTalentDraftTracking('draft:talent:new');
            talentModal.classList.remove('hidden');
        }

        // openEditModal() est décomposée en 5 fonctions nommées par responsabilité,
        // chacune peuplant une zone distincte du formulaire/modale, composées
        // séquentiellement dans openEditModal ci-dessous — même pattern que
        // exportTalentCardPDF() (id-card-pdf.js) et bindButtonListeners()
        // (id-card.js). Toutes locales à ce fichier (IIFE) : aucune n'est appelée
        // depuis un autre fichier de la page, donc aucune exposée sur TalentsPage.

        // Onglets 1-2 — champs simples du formulaire (texte, nombre, date, checkbox),
        // peuplés génériquement depuis les clés de l'objet talent.
        function populateBasicFields(talent) {
            Object.keys(talent).forEach(key => {
                const field = talentForm.querySelector(`[name="${key}"]`);
                if (!field) return;
                if (field.type === 'checkbox') field.checked = !!talent[key];
                else if (field.type === 'date' && talent[key]) field.value = talent[key].substring(0, 10);
                else if (talent[key] !== null && talent[key] !== undefined) field.value = talent[key];
            });
        }

        // Les 5 champs "tags" (chips) — setTagValues() vide déjà le conteneur avant
        // de le repeupler, d'où le nom : chaque champ est réinitialisé puis rempli.
        function resetTagFields(talent) {
            setTagValues('languages', talent.languages);
            setTagValues('other_languages', talent.other_languages);
            setTagValues('intervention_contexts', talent.intervention_contexts);
            setTagValues('intervention_zones', talent.intervention_zones);
            setTagValues('key_skills', talent.key_skills);
        }

        // Onglet 3 — liste des formations ALIMA (lignes dynamiques).
        function populateTrainingFields(talent) {
            document.getElementById('trainingsList').innerHTML = '';
            (talent.alima_trainings || []).forEach(tr => addTrainingRow(tr));
        }

        // Onglet 4 — disponibilité, cohérence "mission ALIMA"/nombre de missions/date
        // de fin, et indicateur de validité qui en dépend (doit être calculé après
        // que ces champs soient posés).
        function populateMissionAndValidityFields(talent) {
            document.getElementById('availabilityMonthsWrap').classList.toggle('hidden', talent.availability_type !== 'notice');
            document.getElementById('availabilityDateWrap').classList.toggle('hidden', talent.availability_type !== 'date');

            hadAlimaMissionCb.checked = !!talent.had_alima_mission;
            syncMissionFields();
            if (talent.last_mission_end_date) lastMissionEndDateInput.value = talent.last_mission_end_date.substring(0, 10);
            if (talent.number_of_alima_missions) numberOfMissionsSelect.value = talent.number_of_alima_missions;

            renderValidityIndicator(talent);

            document.querySelectorAll('.mission-checkbox').forEach(cb => {
                document.querySelector(`textarea[name="${cb.dataset.target}"]`).classList.toggle('hidden', !cb.checked);
            });
        }

        // Onglets 5-6 — panneaux Liste Rouge et Historique, tous deux en lecture
        // seule dans cette modale (gérés exclusivement depuis Admin).
        function populateReadonlyPanels(talent) {
            // Onglet 5 — Liste Rouge (lecture seule)
            if (talent.is_red_listed) {
                document.getElementById('redListReadonly').innerHTML = `
                    <p class="font-bold text-red-600">🚩 Talent en Liste Rouge</p>
                    <p class="mt-2"><strong>Date :</strong> ${escapeHtml(talent.red_list_date || '—')}</p>
                    <p><strong>Raison :</strong> ${escapeHtml(talent.red_list_reason || '—')}</p>
                    <p><strong>Ajouté par :</strong> ${escapeHtml(talent.red_list_added_by_name || '—')}</p>
                    <p class="mt-2 text-xs">La réhabilitation se fait exclusivement depuis <strong>Admin</strong>.</p>
                `;
            } else {
                document.getElementById('redListReadonly').innerHTML = "Ce talent n'est pas en Liste Rouge.";
            }

            // Onglet 6 — Historique (lecture seule)
            const passages = talent.archived_position_passages || [];
            const history = talent.status_history || [];
            if (passages.length === 0 && history.length === 0) {
                document.getElementById('historyReadonly').innerHTML = "Aucun historique enregistré pour ce talent.";
            } else {
                let html = '';
                if (passages.length) {
                    html += '<p class="font-bold text-slate-700 mb-2">Missions passées</p>';
                    passages.forEach(p => {
                        html += `<div class="mb-2 pb-2 border-b border-slate-200"><p class="font-semibold">${escapeHtml(p.positionTitle || '')} — ${escapeHtml(p.country || '')}</p></div>`;
                    });
                }
                if (history.length) {
                    html += '<p class="font-bold text-slate-700 mt-3 mb-2">Changements</p>';
                    history.forEach(h => {
                        html += `<p class="text-xs">${escapeHtml(h.previousValue)} → ${escapeHtml(h.newValue)} <span class="text-slate-500">(${escapeHtml(h.changedByName || '')})</span></p>`;
                    });
                }
                document.getElementById('historyReadonly').innerHTML = html;
            }
        }

        function openEditModal(talent) {
            editingTalentId = talent.id;
            talentForm.reset();
            document.getElementById('modalTitle').textContent = `${talent.first_name} ${talent.last_name}`;

            populateBasicFields(talent);
            resetTagFields(talent);
            populateTrainingFields(talent);
            populateMissionAndValidityFields(talent);
            populateReadonlyPanels(talent);

            formError.classList.add('hidden');
            resetTabsToFirst();
            startTalentDraftTracking(`draft:talent:edit:${talent.id}`);
            talentModal.classList.remove('hidden');
        }

        document.getElementById('newTalentBtn').addEventListener('click', openCreateModal);
        document.getElementById('closeModalBtn').addEventListener('click', () => {
            talentModal.classList.add('hidden');
            stopTalentDraftTracking();
        });
        document.getElementById('cancelBtn').addEventListener('click', () => {
            talentModal.classList.add('hidden');
            stopTalentDraftTracking();
        });

        // ============================================================================
        // 10. ENREGISTREMENT (création ou mise à jour)
        // ============================================================================
        document.getElementById('saveTalentBtn').addEventListener('click', async function () {
            formError.classList.add('hidden');

            // Filet de sécurité : capture immédiate avant validation, sans attendre
            // le debounce de l'autosave — la fenêtre entre le clic et la fin de
            // l'enregistrement est justement le moment où un crash/une fermeture
            // accidentelle serait le plus coûteux à perdre.
            if (currentTalentDraftBinding) currentTalentDraftBinding.saveNow();

            const formData = new FormData(talentForm);
            const payload = {};
            for (const [key, value] of formData.entries()) {
                const field = talentForm.querySelector(`[name="${key}"]`);
                if (field.type === 'checkbox') continue;
                if (field.type === 'number') payload[key] = value ? Number(value) : null;
                else payload[key] = value || null;
            }
            
            ['has_visa', 'had_alima_mission', 'has_mission_opening', 'has_emergency_mission', 'has_mission_closure'].forEach(name => {
                const field = talentForm.querySelector(`[name="${name}"]`);
                if (field) payload[name] = field.checked;
            });

            payload.languages = getTagValues('languages');
            payload.other_languages = getTagValues('other_languages');
            payload.intervention_contexts = getTagValues('intervention_contexts');
            payload.intervention_zones = getTagValues('intervention_zones');
            payload.key_skills = getTagValues('key_skills');
            payload.alima_trainings = getTrainingsValues();

            if (!payload.first_name || !payload.last_name || !payload.status) {
                formError.textContent = "Merci de remplir au minimum Prénom, Nom et Statut (onglets 1 et 2).";
                formError.classList.remove('hidden');
                return;
            }

            const saveBtn = document.getElementById('saveTalentBtn');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Enregistrement...';

            try {
                if (editingTalentId) {
                    const { error } = await capHumaWithRetry(() =>
                        TalentsPage.supabaseClient.from('talents').update(payload).eq('id', editingTalentId)
                    );
                    if (error) throw error;
                    // Journalisé automatiquement par le trigger Postgres trg_audit_talents.
                } else {
                    payload.pool = TalentsPage.currentPoolId;
                    payload.created_by = TalentsPage.currentUserId;
                    payload.is_valid = true;
                    // Volontairement pas enveloppé dans capHumaWithRetry() : talents n'a
                    // aucune contrainte UNIQUE — une relance après perte de réponse
                    // dupliquerait silencieusement la fiche talent créée.
                    const { error } = await TalentsPage.supabaseClient.from('talents').insert(payload);
                    if (error) throw error;
                    // Journalisé automatiquement par le trigger Postgres trg_audit_talents.
                }
                talentModal.classList.add('hidden');
                discardTalentDraft();
                await TalentsPage.loadTalents();
            } catch (err) {
                console.error(err);
                formError.textContent = "Erreur lors de l'enregistrement : " + err.message;
                formError.classList.remove('hidden');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Enregistrer';
            }
        });

        // Exposé sur TalentsPage pour appel depuis l'autre fichier de la page
        TalentsPage.openEditModal = openEditModal;
        TalentsPage.openProlongModal = openProlongModal;
        TalentsPage.devalidateTalentFromList = devalidateTalentFromList;
        TalentsPage.isDevalidationEligible = isDevalidationEligible;
        TalentsPage.hasActiveExtension = hasActiveExtension;
        TalentsPage.renderInlineValidityBar = renderInlineValidityBar;
})();
