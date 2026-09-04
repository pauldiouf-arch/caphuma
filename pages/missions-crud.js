// Modale création/modification de poste, suppression de poste. Voir
// missions.js (chargé AVANT ce fichier) pour l'explication de MissionsPage.
(() => {
        const createMissionBtn = document.getElementById('createMissionBtn');

        // ============================================================================
        // 5. MODALE CRÉATION / MODIFICATION
        // ============================================================================
        const missionModal = document.getElementById('missionModal');
        const missionForm = document.getElementById('missionForm');
        const modalTitle = document.getElementById('modalTitle');
        const formError = document.getElementById('formError');

        createMissionBtn.addEventListener('click', openCreateModal);
        document.getElementById('closeModalBtn').addEventListener('click', closeModal);
        document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

        // Le champ "Nom du projet" n'a de sens que pour un poste de niveau "Projet" —
        // masqué et vidé automatiquement pour un poste de niveau "Mission".
        const fieldPoolLevel = document.getElementById('fieldPoolLevel');
        const projectNameField = document.getElementById('projectNameField');
        const fieldProjectName = document.getElementById('fieldProjectName');

        function toggleProjectNameField() {
            if (fieldPoolLevel.value === 'project') {
                projectNameField.classList.remove('hidden');
            } else {
                projectNameField.classList.add('hidden');
                fieldProjectName.value = '';
            }
        }

        fieldPoolLevel.addEventListener('change', toggleProjectNameField);

        // Le champ "Occupant" n'a de sens que si le statut est "Occupé" — masqué sinon,
        // en cohérence avec le garde-fou appliqué à l'enregistrement (occupant_id forcé à null).
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

        function openCreateModal() {
            modalTitle.textContent = 'Nouveau poste';
            missionForm.reset();
            document.getElementById('missionId').value = '';
            document.getElementById('fieldPoolLevel').value = 'mission';
            document.getElementById('fieldStatus').value = 'vacant';
            toggleProjectNameField();
            toggleOccupantField();
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
            document.getElementById('fieldCountry').value = mission.country || '';
            document.getElementById('fieldLocation').value = mission.location || '';
            document.getElementById('fieldProjectName').value = mission.project_name || '';
            document.getElementById('fieldCandidateType').value = mission.candidate_type || '';
            document.getElementById('fieldDesk').value = mission.desk || '';
            document.getElementById('fieldOccupant').value = mission.occupant_id || '';
            document.getElementById('fieldContractStart').value = toDateInputValue(mission.contract_start_date);
            document.getElementById('fieldContractEnd').value = toDateInputValue(mission.contract_end_date);
            document.getElementById('fieldContractStatus').value = mission.contract_status || '';
            document.getElementById('fieldFutureOccupant').value = mission.future_talent_id || '';
            document.getElementById('fieldFutureContractStart').value = toDateInputValue(mission.future_contract_start_date);
            document.getElementById('fieldFutureContractEnd').value = toDateInputValue(mission.future_contract_end_date);

            toggleProjectNameField();
            toggleOccupantField();
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

        missionForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            formError.classList.add('hidden');

            const missionId = document.getElementById('missionId').value;
            const candidateType = document.getElementById('fieldCandidateType').value || null;
            const selectedStatus = document.getElementById('fieldStatus').value;
            const selectedOccupantId = document.getElementById('fieldOccupant').value || null;

            const payload = {
                title: document.getElementById('fieldTitle').value.trim(),
                pool: MissionsPage.currentPoolId,
                pool_level: document.getElementById('fieldPoolLevel').value,
                status: selectedStatus,
                country: document.getElementById('fieldCountry').value.trim(),
                location: document.getElementById('fieldLocation').value.trim(),
                project_name: document.getElementById('fieldProjectName').value.trim() || null,
                candidate_type: candidateType,
                // is_expat maintenue en cohérence automatique avec candidate_type pour éviter
                // qu'elle devienne une colonne fantôme jamais alimentée.
                is_expat: candidateType ? candidateType === 'expat' : null,
                desk: document.getElementById('fieldDesk').value || null,
                // Garde-fou : un poste qui n'est plus "occupied" ne peut pas conserver d'occupant affiché.
                occupant_id: selectedStatus === 'occupied' ? selectedOccupantId : null,
                contract_start_date: document.getElementById('fieldContractStart').value || null,
                contract_end_date: document.getElementById('fieldContractEnd').value || null,
                contract_status: document.getElementById('fieldContractStatus').value || null,
                future_talent_id: document.getElementById('fieldFutureOccupant').value || null,
                future_contract_start_date: document.getElementById('fieldFutureContractStart').value || null,
                future_contract_end_date: document.getElementById('fieldFutureContractEnd').value || null,
            };

            if (!payload.title || !payload.country || !payload.location) {
                formError.textContent = "Le titre, le pays et le lieu sont obligatoires.";
                formError.classList.remove('hidden');
                return;
            }

            // ────────────────────────────────────────────────────────────────
            // GARDE-FOU 1 : l'occupant choisi est-il déjà occupant d'un AUTRE poste ?
            // (recherché dans les postes déjà chargés pour ce pool — un talent
            // n'appartenant qu'à un seul pool, un conflit ne peut exister qu'ici)
            // ────────────────────────────────────────────────────────────────
            let conflictMissionToVacate = null;
            if (payload.status === 'occupied' && payload.occupant_id) {
                const conflict = MissionsPage.currentMissions.find(m =>
                    m.id !== missionId &&
                    m.occupant_id === payload.occupant_id &&
                    m.status === 'occupied'
                );
                if (conflict) {
                    const talentLabel = MissionsPage.talentNameById[payload.occupant_id] || 'Ce talent';
                    const confirmed = window.confirm(
                        `${talentLabel} occupe déjà le poste « ${conflict.title} ».\n\n` +
                        `Confirmer le changement de poste ? L'ancien poste sera automatiquement libéré ` +
                        `(remis en Vacant) et ses évaluations archivées dans l'historique du talent.`
                    );
                    if (!confirmed) return;
                    conflictMissionToVacate = conflict;
                }
            }

            // ────────────────────────────────────────────────────────────────
            // GARDE-FOU 2 : le futur occupant choisi est-il occupant ailleurs, avec un
            // chevauchement de dates (début prévu ici < date de sortie de son poste actuel) ?
            // Purement informatif — pas d'action automatique, contrairement au garde-fou 1.
            // ────────────────────────────────────────────────────────────────
            if (payload.future_talent_id) {
                const futureConflict = MissionsPage.currentMissions.find(m =>
                    m.id !== missionId &&
                    m.occupant_id === payload.future_talent_id &&
                    m.status === 'occupied'
                );
                if (futureConflict && payload.future_contract_start_date && futureConflict.contract_end_date
                    && payload.future_contract_start_date < futureConflict.contract_end_date) {
                    const talentLabel = MissionsPage.talentNameById[payload.future_talent_id] || 'Ce talent';
                    const confirmed = window.confirm(
                        `${talentLabel} est actuellement occupant de « ${futureConflict.title} » jusqu'au ` +
                        `${MissionsPage.formatDate(futureConflict.contract_end_date)}.\n\n` +
                        `La date de début prévue ici (${MissionsPage.formatDate(payload.future_contract_start_date)}) est ` +
                        `antérieure à cette date de sortie — chevauchement. Continuer quand même ?`
                    );
                    if (!confirmed) return;
                }
            }

            const saveBtn = document.getElementById('saveMissionBtn');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Enregistrement…';

            try {
                // Libération de l'ancien poste si un conflit a été confirmé (garde-fou 1) :
                // même traitement qu'une sortie normale (archivage des évaluations + poste vacant).
                if (conflictMissionToVacate) {
                    await MissionsPage.archiveOutgoingOccupant(conflictMissionToVacate);

                    const { data: vacateData, error: vacateErr } = await capHumaWithRetry(() =>
                        MissionsPage.supabaseClient
                            .from('missions')
                            .update({ status: 'vacant', occupant_id: null })
                            .eq('id', conflictMissionToVacate.id)
                            .select('id')
                    );
                    if (vacateErr) throw vacateErr;
                    if (!vacateData || vacateData.length === 0) {
                        throw new Error("La libération de l'ancien poste n'a affecté aucune ligne (policy RLS ?).");
                    }
                }

                if (missionId) {
                    const originalMission = MissionsPage.currentMissions.find(m => m.id === missionId);
                    const previousOccupantId = originalMission ? originalMission.occupant_id : null;

                    // L'occupant sort si : il y avait un occupant avant ET (il change, OU le poste
                    // n'est plus "occupied").
                    if (originalMission && previousOccupantId && previousOccupantId !== payload.occupant_id) {
                        await MissionsPage.archiveOutgoingOccupant(originalMission);
                    }

                    const { error } = await capHumaWithRetry(() =>
                        MissionsPage.supabaseClient
                            .from('missions')
                            .update(payload)
                            .eq('id', missionId)
                    );
                    if (error) throw error;

                    // Pas d'appel à logAuditAction('update', ...) ici : couvert par le
                    // trigger Postgres trg_audit_missions, fiable même pour une
                    // modification faite hors de cette page.

                    // Nouvel occupant entrant (affectation ou rotation) : compteurs remis à zéro.
                    if (payload.occupant_id && payload.occupant_id !== previousOccupantId) {
                        await MissionsPage.markIncomingOccupant(payload.occupant_id);
                    }

                    toastMessage('Poste mis à jour.', 'success');
                } else {
                    payload.created_by = MissionsPage.currentUserId;
                    // Volontairement pas enveloppé dans capHumaWithRetry() : missions n'a
                    // aucune contrainte UNIQUE (Dossier de passation §4.2) — une relance
                    // après perte de réponse dupliquerait silencieusement le poste créé.
                    const { error } = await MissionsPage.supabaseClient
                        .from('missions')
                        .insert(payload);
                    if (error) throw error;

                    // Pas d'appel à logAuditAction('create', ...) ici : couvert par le
                    // trigger Postgres trg_audit_missions.

                    if (payload.occupant_id) {
                        await MissionsPage.markIncomingOccupant(payload.occupant_id);
                    }

                    toastMessage('Poste créé.', 'success');
                }

                closeModal();
                await MissionsPage.loadMissions();

            } catch (error) {
                console.error("Erreur d'enregistrement du poste :", error);
                // PostgrestError n'est pas une instance native d'Error — on teste .message directement
                formError.textContent = "Erreur lors de l'enregistrement : " + (error && error.message ? error.message : 'erreur inconnue.');
                formError.classList.remove('hidden');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Enregistrer';
            }
        });

        // Exposé sur MissionsPage pour appel depuis les autres fichiers de la page
        MissionsPage.openEditModal = openEditModal;

        // ============================================================================
        // 6. SUPPRESSION D'UN POSTE
        // ============================================================================
        async function deleteMission(missionId) {
            const mission = MissionsPage.currentMissions.find(m => m.id === missionId);
            const label = mission ? mission.title : 'ce poste';

            if (!window.confirm(`Supprimer définitivement « ${label} » ? Cette action est irréversible.`)) {
                return;
            }

            try {
                // La suppression d'un poste occupé fait sortir l'occupant au même titre qu'un
                // changement de statut — on archive avant de supprimer.
                if (mission && mission.occupant_id) {
                    await MissionsPage.archiveOutgoingOccupant(mission);
                }

                // Enveloppé dans capHumaWithRetry() : sûr à retenter — contrairement
                // aux suppressions ailleurs sur le site, cette page ne vérifie pas le
                // nombre de lignes affectées après coup, donc pas de contrôle RLS à
                // rendre ambigu par une relance.
                const { error } = await capHumaWithRetry(() =>
                    MissionsPage.supabaseClient
                        .from('missions')
                        .delete()
                        .eq('id', missionId)
                );

                if (error) throw error;

                // Pas d'appel à logAuditAction('delete', ...) ici : couvert par le
                // trigger Postgres trg_audit_missions.
                toastMessage('Poste supprimé.', 'success');
                await MissionsPage.loadMissions();

            } catch (error) {
                console.error("Erreur de suppression du poste :", error);
                toastMessage("Échec de la suppression : " + (error && error.message ? error.message : 'erreur inconnue.'), 'error');
            }
        }

        // Exposé sur MissionsPage pour appel depuis les autres fichiers de la page
        MissionsPage.deleteMission = deleteMission;
})();
