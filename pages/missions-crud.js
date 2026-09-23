(() => {
        const createMissionBtn = document.getElementById('createMissionBtn');

        const missionModal = document.getElementById('missionModal');
        const missionForm = document.getElementById('missionForm');
        const modalTitle = document.getElementById('modalTitle');
        const formError = document.getElementById('formError');

        createMissionBtn.addEventListener('click', openCreateModal);
        document.getElementById('closeModalBtn').addEventListener('click', closeModal);
        document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

        const fieldPoolLevel = document.getElementById('fieldPoolLevel');
        const projectNameField = document.getElementById('projectNameField');
        const fieldProjectName = document.getElementById('fieldProjectName');

        document.getElementById('fieldCountry').innerHTML = '<option value="">— Sélectionner —</option>' +
            CapHumaCountries.getAll().map(c => `<option value="${c.code}">${escapeHtml(c.nameFr)}</option>`).join('');

        function toggleProjectNameField() {
            if (fieldPoolLevel.value === 'project') {
                projectNameField.classList.remove('hidden');
            } else {
                projectNameField.classList.add('hidden');
                fieldProjectName.value = '';
            }
        }

        fieldPoolLevel.addEventListener('change', toggleProjectNameField);

        const fieldStatus = document.getElementById('fieldStatus');
        const occupantField = document.getElementById('occupantField');
        const currentContractFields = document.getElementById('currentContractFields');

        function toggleOccupantField() {
            if (fieldStatus.value === 'occupied') {
                occupantField.classList.remove('hidden');
                currentContractFields.classList.remove('hidden');
            } else {
                occupantField.classList.add('hidden');
                currentContractFields.classList.add('hidden');
            }
        }

        fieldStatus.addEventListener('change', toggleOccupantField);

        const fieldContractEndType = document.getElementById('fieldContractEndType');
        const contractEndDateField = document.getElementById('contractEndDateField');

        function toggleContractEndDateField() {
            if (fieldContractEndType.value === 'cdi' || fieldContractEndType.value === 'ongoing') {
                contractEndDateField.classList.add('hidden');
                document.getElementById('fieldContractEnd').value = '';
            } else {
                contractEndDateField.classList.remove('hidden');
            }
        }

        fieldContractEndType.addEventListener('change', toggleContractEndDateField);

        function refreshOccupantDropdowns() {
            MissionsPage.populateTalentDropdown('fieldOccupant');
            MissionsPage.populateTalentDropdown('fieldFutureOccupant');
        }

        document.getElementById('fieldCandidateType').addEventListener('change', refreshOccupantDropdowns);
        fieldPoolLevel.addEventListener('change', refreshOccupantDropdowns);
        document.getElementById('fieldCountry').addEventListener('change', refreshOccupantDropdowns);

        function openCreateModal() {
            modalTitle.textContent = 'Nouveau poste';
            missionForm.reset();
            document.getElementById('missionId').value = '';
            document.getElementById('fieldPoolLevel').value = 'mission';
            document.getElementById('fieldStatus').value = 'vacant';
            document.getElementById('fieldContractEndType').value = 'date';
            refreshOccupantDropdowns();
            toggleProjectNameField();
            toggleOccupantField();
            toggleContractEndDateField();
            formError.classList.add('hidden');
            missionModal.classList.remove('hidden');
        }

        function openEditModal(missionId) {
            const mission = MissionsPage.currentMissions.find(m => m.id === missionId);
            if (!mission) return;

            modalTitle.textContent = 'Modifier le poste';
            document.getElementById('missionId').value = mission.id;
            document.getElementById('fieldTitle').value = mission.title || '';
            document.getElementById('fieldPoolLevel').value = mission.pool_level || 'mission';
            document.getElementById('fieldStatus').value = mission.status || 'vacant';
            document.getElementById('fieldCountry').value = mission.country_code || '';
            document.getElementById('fieldLocation').value = mission.location || '';
            document.getElementById('fieldProjectName').value = mission.project_name || '';
            document.getElementById('fieldCandidateType').value = mission.candidate_type || '';
            document.getElementById('fieldDesk').value = mission.desk || '';
            // Options reconstruites avant l'affectation, sinon la valeur est perdue sans erreur.
            refreshOccupantDropdowns();
            document.getElementById('fieldOccupant').value = mission.occupant_id || '';
            document.getElementById('fieldContractStart').value = toDateInputValue(mission.contract_start_date);
            document.getElementById('fieldContractEndType').value = mission.contract_end_type || 'date';
            document.getElementById('fieldContractEnd').value = toDateInputValue(mission.contract_end_date);
            document.getElementById('fieldContractStatus').value = mission.contract_status || '';
            document.getElementById('fieldFutureOccupant').value = mission.future_talent_id || '';
            document.getElementById('fieldFutureContractStart').value = toDateInputValue(mission.future_contract_start_date);
            document.getElementById('fieldFutureContractEnd').value = toDateInputValue(mission.future_contract_end_date);

            toggleProjectNameField();
            toggleOccupantField();
            toggleContractEndDateField();
            formError.classList.add('hidden');
            missionModal.classList.remove('hidden');
        }

        function toDateInputValue(isoDate) {
            if (!isoDate) return '';
            return String(isoDate).substring(0, 10);
        }

        function closeModal() {
            missionModal.classList.add('hidden');
        }

        function checkOccupantConflict(payload, missionId) {
            if (payload.status !== 'occupied' || !payload.occupant_id) {
                return { proceed: true, conflictMissionToVacate: null };
            }
            const conflict = MissionsPage.currentMissions.find(m =>
                m.id !== missionId &&
                m.occupant_id === payload.occupant_id &&
                m.status === 'occupied' &&
                (payload.candidate_type === 'detache' ? m.candidate_type === 'detache' : m.candidate_type !== 'detache')
            );
            if (!conflict) return { proceed: true, conflictMissionToVacate: null };

            const talentLabel = MissionsPage.talentNameById[payload.occupant_id] || 'Ce talent';
            const confirmed = window.confirm(
                `${talentLabel} occupe déjà le poste « ${conflict.title} ».\n\n` +
                `Confirmer le changement de poste ? L'ancien poste sera automatiquement libéré ` +
                `(remis en Vacant) et ses évaluations archivées dans l'historique du talent.`
            );
            return { proceed: confirmed, conflictMissionToVacate: confirmed ? conflict : null };
        }

        function checkFutureOccupantOverlap(payload, missionId) {
            if (!payload.future_talent_id) return true;
            const futureConflict = MissionsPage.currentMissions.find(m =>
                m.id !== missionId &&
                m.occupant_id === payload.future_talent_id &&
                m.status === 'occupied'
            );
            if (!futureConflict || !payload.future_contract_start_date || !futureConflict.contract_end_date
                || payload.future_contract_start_date >= futureConflict.contract_end_date) {
                return true;
            }
            const talentLabel = MissionsPage.talentNameById[payload.future_talent_id] || 'Ce talent';
            return window.confirm(
                `${talentLabel} est actuellement occupant de « ${futureConflict.title} » jusqu'au ` +
                `${MissionsPage.formatDate(futureConflict.contract_end_date)}.\n\n` +
                `La date de début prévue ici (${MissionsPage.formatDate(payload.future_contract_start_date)}) est ` +
                `antérieure à cette date de sortie — chevauchement. Continuer quand même ?`
            );
        }

        function checkNationalityMismatch(payload) {
            if (payload.candidate_type !== 'nat' || payload.pool_level !== 'project'
                || payload.status !== 'occupied' || !payload.occupant_id) {
                return true;
            }
            const occupant = (MissionsPage.poolTalents || []).find(t => t.id === payload.occupant_id);
            if (!occupant || occupant.staff_type === 'national' || occupant.nationality_code === payload.country_code) {
                return true;
            }
            const talentLabel = MissionsPage.talentNameById[payload.occupant_id] || 'Ce talent';
            return window.confirm(
                `${talentLabel} n'a pas la nationalité du pays de ce poste.\n\n` +
                `Ce poste est de type National — si c'est voulu (un expat peut occuper un poste ` +
                `national), continue. Sinon, annule et repasse le poste en Expatrié.`
            );
        }

        async function checkDetachmentDuration(payload) {
            if (payload.candidate_type !== 'detache' || payload.pool_level !== 'project'
                || payload.status !== 'occupied' || !payload.occupant_id) {
                return true;
            }
            const { data: nationalPost, error: natError } = await MissionsPage.supabaseClient
                .from('missions')
                .select('title, contract_end_date, contract_end_type')
                .eq('occupant_id', payload.occupant_id)
                .eq('candidate_type', 'nat')
                .eq('status', 'occupied')
                .maybeSingle();

            if (natError) {
                console.error("Erreur de vérification du poste national sous-jacent :", natError);
                return true;
            }

            const talentLabel = MissionsPage.talentNameById[payload.occupant_id] || 'Ce talent';
            if (!nationalPost) {
                return window.confirm(
                    `${talentLabel} n'occupe actuellement aucun poste national.\n\n` +
                    `Un détachement niveau projet suppose normalement un poste national existant. ` +
                    `Continuer quand même ?`
                );
            }
            if (nationalPost.contract_end_type === 'date' && nationalPost.contract_end_date
                && payload.contract_end_type === 'date' && payload.contract_end_date
                && nationalPost.contract_end_date < payload.contract_end_date) {
                return window.confirm(
                    `Le poste national de ${talentLabel} (« ${nationalPost.title} ») se termine le ` +
                    `${MissionsPage.formatDate(nationalPost.contract_end_date)}, avant la fin de ce ` +
                    `détachement (${MissionsPage.formatDate(payload.contract_end_date)}).\n\n` +
                    `Continuer quand même ?`
                );
            }
            return true;
        }

        function buildMissionPayloadFromForm() {
            const candidateType = document.getElementById('fieldCandidateType').value || null;
            const selectedStatus = document.getElementById('fieldStatus').value;
            const selectedOccupantId = document.getElementById('fieldOccupant').value || null;

            return {
                title: document.getElementById('fieldTitle').value.trim(),
                pool: MissionsPage.currentPoolId,
                pool_level: document.getElementById('fieldPoolLevel').value,
                status: selectedStatus,
                country_code: document.getElementById('fieldCountry').value.trim(),
                location: document.getElementById('fieldLocation').value.trim(),
                project_name: document.getElementById('fieldProjectName').value.trim() || null,
                candidate_type: candidateType,
                is_expat: candidateType ? candidateType === 'expat' : null,
                desk: document.getElementById('fieldDesk').value || null,
                occupant_id: selectedStatus === 'occupied' ? selectedOccupantId : null,
                contract_start_date: document.getElementById('fieldContractStart').value || null,
                contract_end_type: document.getElementById('fieldContractEndType').value || 'date',
                contract_end_date: document.getElementById('fieldContractEnd').value || null,
                contract_status: document.getElementById('fieldContractStatus').value || null,
                future_talent_id: document.getElementById('fieldFutureOccupant').value || null,
                future_contract_start_date: document.getElementById('fieldFutureContractStart').value || null,
                future_contract_end_date: document.getElementById('fieldFutureContractEnd').value || null,
            };
        }

        function validateMissionPayload(payload) {
            if (!payload.title || !payload.country_code || !payload.location) {
                return "Le titre, le pays et le lieu sont obligatoires.";
            }
            return null;
        }

        async function runMissionSaveGuards(payload, missionId) {
            const occupantCheck = checkOccupantConflict(payload, missionId);
            if (!occupantCheck.proceed) return { proceed: false };

            if (!checkFutureOccupantOverlap(payload, missionId)) return { proceed: false };
            if (!checkNationalityMismatch(payload)) return { proceed: false };
            if (!(await checkDetachmentDuration(payload))) return { proceed: false };

            return { proceed: true, conflictMissionToVacate: occupantCheck.conflictMissionToVacate };
        }

        async function saveMissionPayload(missionId, payload, conflictMissionToVacate) {
            // Pas de capHumaWithRetry() : pas de contrainte UNIQUE, une relance dupliquerait le poste.
            const { error } = await MissionsPage.supabaseClient.rpc('save_mission', {
                p_mission_id: missionId || null,
                p_payload: payload,
                p_vacate_mission_id: conflictMissionToVacate ? conflictMissionToVacate.id : null
            });
            if (error) throw error;

            toastMessage(missionId ? 'Poste mis à jour.' : 'Poste créé.', 'success');
        }

        async function withSaveButtonDisabled(fn) {
            const saveBtn = document.getElementById('saveMissionBtn');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Enregistrement…';
            try {
                await fn();
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Enregistrer';
            }
        }

        async function handleMissionFormSubmit(e) {
            e.preventDefault();
            formError.classList.add('hidden');

            const missionId = document.getElementById('missionId').value;
            const payload = buildMissionPayloadFromForm();

            const validationError = validateMissionPayload(payload);
            if (validationError) {
                formError.textContent = validationError;
                formError.classList.remove('hidden');
                return;
            }

            const guards = await runMissionSaveGuards(payload, missionId);
            if (!guards.proceed) return;

            await withSaveButtonDisabled(async () => {
                try {
                    await saveMissionPayload(missionId, payload, guards.conflictMissionToVacate);
                    closeModal();
                    await MissionsPage.loadMissions();
                } catch (error) {
                    console.error("Erreur d'enregistrement du poste :", error);
                    formError.textContent = "Erreur lors de l'enregistrement : " + (error && error.message ? error.message : 'erreur inconnue.');
                    formError.classList.remove('hidden');
                }
            });
        }

        missionForm.addEventListener('submit', handleMissionFormSubmit);

        MissionsPage.openEditModal = openEditModal;

        async function deleteMission(missionId) {
            const mission = MissionsPage.currentMissions.find(m => m.id === missionId);
            const label = mission ? mission.title : 'ce poste';

            if (!window.confirm(`Supprimer définitivement « ${label} » ? Cette action est irréversible.`)) {
                return;
            }

            try {
                const { error } = await capHumaWithRetry(() =>
                    MissionsPage.supabaseClient.rpc('delete_mission', { p_mission_id: missionId })
                );

                if (error) throw error;

                toastMessage('Poste supprimé.', 'success');
                await MissionsPage.loadMissions();

            } catch (error) {
                console.error("Erreur de suppression du poste :", error);
                toastMessage("Échec de la suppression : " + (error && error.message ? error.message : 'erreur inconnue.'), 'error');
            }
        }

        MissionsPage.deleteMission = deleteMission;
})();
