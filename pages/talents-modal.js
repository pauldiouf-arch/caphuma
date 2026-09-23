(() => {
        const talentForm = document.getElementById('talentForm');

        const talentTabs = Array.from(document.querySelectorAll('.tab-btn'));
        const selectTalentTab = capHumaInitTabs(
            document.getElementById('talentFormTabs'),
            talentTabs,
            tab => document.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`),
            activeTab => talentTabs.forEach(tab => tab.classList.toggle('active', tab === activeTab))
        );
        selectTalentTab(talentTabs[0]);

        const nationalitySelect = document.getElementById('field-nationality');
        nationalitySelect.innerHTML = '<option value="">— Sélectionner —</option>' +
            CapHumaCountries.getAll().map(c => {
                const label = c.nationalityFr.charAt(0).toUpperCase() + c.nationalityFr.slice(1);
                return `<option value="${c.code}">${escapeHtml(label)}</option>`;
            }).join('');

        function resetTabsToFirst() {
            selectTalentTab(talentTabs[0]);
        }

        function createTagField(containerId, fieldName, label, maxTags) {
            const container = document.getElementById(containerId);
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
            chip.innerHTML = `${escapeHtml(value)} <button type="button" aria-label="Retirer ${escapeHtml(value)}">&times;</button>`;
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

        document.getElementById('availabilityType').addEventListener('change', function () {
            document.getElementById('availabilityMonthsWrap').classList.toggle('hidden', this.value !== 'notice');
            document.getElementById('availabilityDateWrap').classList.toggle('hidden', this.value !== 'date');
        });

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

        // Seuils définis dans caphuma-utils.js : ne pas les redéclarer ici, un const en double casse la page.
        function hasActiveExtension(talent) {
            if (!talent.devalidation_extension_until) return false;
            return new Date(talent.devalidation_extension_until).getTime() > Date.now();
        }

        function isDevalidationEligible(talent) {
            if (talent.is_valid === false) return false;
            if (hasActiveExtension(talent)) return false;
            return calculateMonthsWithoutMission(talent) >= DEVALIDATION_MAX_MONTHS;
        }

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
            const untilStr = untilDate.toISOString().slice(0, 10);

            try {
                const { error } = await CapHumaData.updateTalent(TalentsPage.supabaseClient, talentPendingArbitration.id, {
                    devalidation_extension_until: untilStr,
                    devalidation_extension_months: months,
                    devalidation_extension_granted_by: TalentsPage.currentUserId,
                    devalidation_extension_granted_by_name: TalentsPage.currentUserEmail,
                    devalidation_extension_granted_at: new Date().toISOString()
                });

                if (error) throw error;

                prolongModal.classList.add('hidden');
                toastMessage(`Prolongation de ${months} mois accordée.`);
                talentPendingArbitration = null;
                await TalentsPage.loadTalents();
            } catch (err) {
                console.error(err);
                toastMessage("Échec de la prolongation : " + err.message, "error");
            }
        });

        async function devalidateTalentFromList(talent) {
            const fullName = `${talent.first_name || ''} ${talent.last_name || ''}`.trim();
            const confirmed = confirm(
                `Dévalider "${fullName}" ?\n\nAssurez-vous d'avoir déjà envoyé un email à ${talent.email || '(email non renseigné)'} avant de confirmer.\nCette action est réversible depuis la fiche du talent (bouton Réintégrer).`
            );
            if (!confirmed) return;

            try {
                const { error } = await CapHumaData.updateTalent(TalentsPage.supabaseClient, talent.id, {
                            is_valid: false,
                            devalidation_date: new Date().toISOString().slice(0, 10),
                            devalidation_extension_until: null,
                            devalidation_extension_months: null,
                            devalidation_extension_granted_by: null,
                            devalidation_extension_granted_by_name: null,
                            devalidation_extension_granted_at: null
                        });

                if (error) throw error;

                toastMessage(`${fullName} a été dévalidé(e).`);
                await TalentsPage.loadTalents();
            } catch (err) {
                console.error(err);
                toastMessage("Échec de la dévalidation : " + err.message, "error");
            }
        }

        function getValidityData(talent) {
            const status = capHumaGetValidityStatus(talent);

            let barColor, textColor;
            if (status.isInvalid || status.totalMonths >= DEVALIDATION_MAX_MONTHS) { barColor = 'bg-red-600'; textColor = 'text-red-600'; }
            else if (status.totalMonths >= DEVALIDATION_CRITICAL_MONTHS) { barColor = 'bg-red-50'; textColor = 'text-red-600'; }
            else if (status.totalMonths >= DEVALIDATION_AT_RISK_MONTHS) { barColor = 'bg-orange-400'; textColor = 'text-orange-600'; }
            else { barColor = 'bg-green-500'; textColor = 'text-slate-500'; }

            return { ...status, barColor, textColor };
        }

        function buildValidityLabelHtml(v, variant) {
            const isFull = variant === 'full';
            const gapClass = 'flex items-center gap-1';

            if (v.isInvalid) {
                const labelHtml = `<span class="text-red-600 font-bold ${gapClass}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"/></svg> Dévalidé</span><span class="text-red-600 font-bold">${DEVALIDATION_MAX_MONTHS} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                return { labelHtml, bottomHtml: '' };
            }

            if (v.isPaused) {
                const labelHtml = `<span class="text-blue-600 font-bold ${gapClass}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5"/></svg> Compteur suspendu</span><span class="font-bold ${v.textColor}">${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;
                const pausedNoteClass = isFull ? 'text-xs text-blue-500 mt-1' : 'text-[11px] text-blue-500 mt-0.5';
                const bottomHtml = `<p class="${pausedNoteClass}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5"/></svg> En mission ALIMA — compteur en pause</p>`;
                return { labelHtml, bottomHtml };
            }

            const riskLabel = v.totalMonths < DEVALIDATION_AT_RISK_MONTHS ? 'Validité pool' : (v.totalMonths >= DEVALIDATION_CRITICAL_MONTHS ? 'Critique' : 'À risque');
            const riskIcon = v.totalMonths < DEVALIDATION_AT_RISK_MONTHS
                ? CapHumaIcons.get('checkCircle', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0')
                : CapHumaIcons.get('alertTriangle', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0');
            const labelHtml = `<span class="font-bold ${v.textColor} ${gapClass}">${riskIcon} ${riskLabel}</span><span class="font-bold ${v.textColor}">${v.totalMonths} / ${DEVALIDATION_MAX_MONTHS} mois</span>`;

            const remainingText = v.totalMonths >= DEVALIDATION_AT_RISK_MONTHS
                ? (v.remainingMonths === 0 ? 'Dévalidation imminente !' : `${v.remainingMonths} mois restant${v.remainingMonths > 1 ? 's' : ''} avant éjection du pool`)
                : '';

            let bottomHtml;
            if (isFull) {
                bottomHtml = `<div class="flex items-center justify-between text-xs text-slate-500 mt-1">
                    <span class="font-medium ${v.textColor}">${remainingText}</span>
                    <span class="italic">${v.refLabel} : ${v.refDate ? new Date(v.refDate).toLocaleDateString('fr-FR') : 'N/A'}</span>
                </div>`;
            } else {
                bottomHtml = remainingText
                    ? `<p class="text-[11px] font-medium ${v.textColor} mt-0.5">${remainingText}</p>`
                    : '';
            }

            return { labelHtml, bottomHtml };
        }

        function renderInlineValidityBar(talent) {
            const v = getValidityData(talent);
            const { labelHtml, bottomHtml } = buildValidityLabelHtml(v, 'inline');

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

            const { labelHtml, bottomHtml } = buildValidityLabelHtml(v, 'full');

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

        function addTrainingRow(training) {
            training = training || {};
            const row = document.createElement('div');
            row.className = 'training-row grid grid-cols-12 gap-2 items-center bg-slate-50 border border-slate-200 rounded-lg p-2';
            row.innerHTML = `
                <input aria-label="Nom de la formation" class="training-name col-span-4 rounded border border-slate-200 p-1.5 text-xs" placeholder="Nom formation" value="${escapeHtml(training.name || '')}" />
                <input aria-label="Date de la formation" class="training-date col-span-3 rounded border border-slate-200 p-1.5 text-xs" type="date" value="${escapeHtml(training.date ? training.date.substring(0,10) : '')}" />
                <input aria-label="Durée de la formation" class="training-duration col-span-2 rounded border border-slate-200 p-1.5 text-xs" placeholder="Durée" value="${escapeHtml(training.duration || '')}" />
                <input aria-label="Description de la formation" class="training-desc col-span-2 rounded border border-slate-200 p-1.5 text-xs" placeholder="Description" value="${escapeHtml(training.description || '')}" />
                <button type="button" aria-label="Retirer la formation" class="removeTrainingBtn col-span-1 text-red-700 text-lg">&times;</button>
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

            // Une affectation .value ne déclenche pas 'change' : champs conditionnels resynchronisés à la main.
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

        function startTalentDraftTracking(draftKey) {
            stopTalentDraftTracking();
            currentTalentDraftKey = draftKey;
            capHumaOfferDraftRestore(draftKey, restoreTalentDraft);
            currentTalentDraftBinding = capHumaAttachDraftAutosave(talentForm, draftKey, { collect: collectTalentDraft });
        }

        function stopTalentDraftTracking() {
            if (currentTalentDraftBinding) {
                currentTalentDraftBinding.stop();
                currentTalentDraftBinding = null;
            }
        }

        function discardTalentDraft() {
            stopTalentDraftTracking();
            if (currentTalentDraftKey) {
                capHumaDraftClear(currentTalentDraftKey);
                currentTalentDraftKey = null;
            }
        }

        const talentModal = document.getElementById('talentModal');
        const formError = document.getElementById('formError');
        let editingTalentId = null;

        function applyStaffTypeFieldVisibility(isNational) {
            document.querySelectorAll('.pool-only-field').forEach(el => el.classList.toggle('hidden', isNational));
            document.querySelectorAll('.national-only-field').forEach(el => el.classList.toggle('hidden', !isNational));
        }

        function openCreateModal(forceNational) {
            editingTalentId = null;
            talentForm.reset();
            const creatingNational = forceNational === true;
            TalentsPage.creatingNationalStaff = creatingNational;
            applyStaffTypeFieldVisibility(creatingNational);
            if (creatingNational && TalentsPage.currentPoolId) {
                document.getElementById('field-tracking-pool').value = TalentsPage.currentPoolId;
            }
            document.getElementById('modalTitle').textContent = creatingNational ? 'Nouveau staff national' : 'Nouveau talent';
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

        function populateBasicFields(talent) {
            Object.keys(talent).forEach(key => {
                const field = talentForm.querySelector(`[name="${key}"]`);
                if (!field) return;
                if (field.type === 'checkbox') field.checked = !!talent[key];
                else if (field.type === 'date' && talent[key]) field.value = talent[key].substring(0, 10);
                else if (talent[key] !== null && talent[key] !== undefined) field.value = talent[key];
            });
        }

        function resetTagFields(talent) {
            setTagValues('languages', talent.languages);
            setTagValues('other_languages', talent.other_languages);
            setTagValues('intervention_contexts', talent.intervention_contexts);
            setTagValues('intervention_zones', talent.intervention_zones);
            setTagValues('key_skills', talent.key_skills);
        }

        function populateTrainingFields(talent) {
            document.getElementById('trainingsList').innerHTML = '';
            (talent.alima_trainings || []).forEach(tr => addTrainingRow(tr));
        }

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

        function populateReadonlyPanels(talent) {
            if (talent.is_red_listed) {
                document.getElementById('redListReadonly').innerHTML = `
                    <p class="font-bold text-red-600"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5"/></svg> Talent en Liste Rouge</p>
                    <p class="mt-2"><strong>Date :</strong> ${escapeHtml(talent.red_list_date || '—')}</p>
                    <p><strong>Raison :</strong> ${escapeHtml(talent.red_list_reason || '—')}</p>
                    <p><strong>Ajouté par :</strong> ${escapeHtml(talent.red_list_added_by_name || '—')}</p>
                    <p class="mt-2 text-xs">La réhabilitation se fait exclusivement depuis <strong>Admin</strong>.</p>
                `;
            } else {
                document.getElementById('redListReadonly').innerHTML = "Ce talent n'est pas en Liste Rouge.";
            }

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
            TalentsPage.creatingNationalStaff = false;
            applyStaffTypeFieldVisibility(talent.staff_type === 'national');
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

        document.getElementById('newTalentBtn').addEventListener('click', () => openCreateModal());
        document.getElementById('newNationalStaffLink').addEventListener('click', () => openCreateModal(true));
        document.getElementById('closeModalBtn').addEventListener('click', () => {
            talentModal.classList.add('hidden');
            stopTalentDraftTracking();
        });
        document.getElementById('cancelBtn').addEventListener('click', () => {
            talentModal.classList.add('hidden');
            stopTalentDraftTracking();
        });

        document.getElementById('saveTalentBtn').addEventListener('click', async function () {
            formError.classList.add('hidden');

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
                    const { error } = await CapHumaData.updateTalent(TalentsPage.supabaseClient, editingTalentId, payload);
                    if (error) throw error;
                } else {
                    if (TalentsPage.creatingNationalStaff) {
                        payload.pool = null;
                        payload.staff_type = 'national';
                    } else {
                        payload.pool = TalentsPage.currentPoolId;
                    }
                    payload.created_by = TalentsPage.currentUserId;
                    payload.is_valid = true;
                    // Pas de capHumaWithRetry() : pas de contrainte UNIQUE, une relance dupliquerait la fiche.
                    const { error } = await CapHumaData.createTalent(TalentsPage.supabaseClient, payload);
                    if (error) throw error;
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

        TalentsPage.openEditModal = openEditModal;
        TalentsPage.openProlongModal = openProlongModal;
        TalentsPage.devalidateTalentFromList = devalidateTalentFromList;
        TalentsPage.isDevalidationEligible = isDevalidationEligible;
        TalentsPage.hasActiveExtension = hasActiveExtension;
        TalentsPage.renderInlineValidityBar = renderInlineValidityBar;
})();
