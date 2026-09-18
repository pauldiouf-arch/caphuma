// Modale création/modification de poste, suppression de poste. Voir
// missions.js (chargé AVANT ce fichier) pour l'explication de MissionsPage.
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

        // Masqué si le statut n'est pas "Occupé" — en cohérence avec le garde-fou
        // plus bas qui force occupant_id à null dans ce cas.
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

        // Confort d'usage (voir getEligibleTalents() dans missions.js) : recalculé à
        // chaque changement d'un des 3 critères dont dépendent les 5 combinaisons du
        // tableau du plan (§1.3) — type de poste, niveau de pool, pays du poste.
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
            // Options du menu occupant reconstruites AVANT de leur assigner une valeur :
            // l'occupant réel (un staff national par ex.) doit déjà exister dans la
            // liste au moment de l'affectation, sinon elle échoue silencieusement.
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

        // Garde-fou 1 : l'occupant choisi est-il déjà occupant d'un autre poste de la
        // même catégorie ? Poste national/expatrié et détachement ne se bloquent jamais
        // entre eux (le staff garde son poste national en parallèle de son détachement),
        // mais deux détachements simultanés ne sont pas plus autorisés que deux postes
        // nationaux/expatriés simultanés.
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

        // Garde-fou 2, purement informatif (pas d'action automatique contrairement au
        // 1) : chevauchement entre la date de début prévue ici et la date de sortie du
        // futur occupant sur son poste actuel ?
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

        // Garde-fou 3, non bloquant (§1.3 du plan) : un poste national niveau projet
        // accepte un expat sans la nationalité du pays, mais on le signale.
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

        // Garde-fou 4, non bloquant : le poste national du staff peut appartenir à un
        // autre pool que celui affiché ici, d'où la requête dédiée plutôt qu'une
        // recherche dans MissionsPage.currentMissions comme les 3 précédents.
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
                country_code: document.getElementById('fieldCountry').value.trim(),
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
                contract_end_type: document.getElementById('fieldContractEndType').value || 'date',
                contract_end_date: document.getElementById('fieldContractEnd').value || null,
                contract_status: document.getElementById('fieldContractStatus').value || null,
                future_talent_id: document.getElementById('fieldFutureOccupant').value || null,
                future_contract_start_date: document.getElementById('fieldFutureContractStart').value || null,
                future_contract_end_date: document.getElementById('fieldFutureContractEnd').value || null,
            };

            if (!payload.title || !payload.country_code || !payload.location) {
                formError.textContent = "Le titre, le pays et le lieu sont obligatoires.";
                formError.classList.remove('hidden');
                return;
            }

            const occupantCheck = checkOccupantConflict(payload, missionId);
            if (!occupantCheck.proceed) return;
            const conflictMissionToVacate = occupantCheck.conflictMissionToVacate;

            if (!checkFutureOccupantOverlap(payload, missionId)) return;
            if (!checkNationalityMismatch(payload)) return;
            if (!(await checkDetachmentDuration(payload))) return;

            const saveBtn = document.getElementById('saveMissionBtn');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Enregistrement…';

            try {
                // Conflit confirmé (garde-fou 1) : même traitement qu'une sortie normale.
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

                    // Pas d'appel à logAuditAction('update', ...) : couvert par le trigger
                    // Postgres trg_audit_missions, fiable même hors de cette page.

                    if (payload.occupant_id && payload.occupant_id !== previousOccupantId) {
                        await MissionsPage.markIncomingOccupant(payload.occupant_id, payload.candidate_type);
                    }

                    toastMessage('Poste mis à jour.', 'success');
                } else {
                    payload.created_by = MissionsPage.currentUserId;
                    // Pas de capHumaWithRetry() : missions n'a aucune contrainte UNIQUE,
                    // une relance après perte de réponse dupliquerait silencieusement le poste.
                    const { error } = await MissionsPage.supabaseClient
                        .from('missions')
                        .insert(payload);
                    if (error) throw error;

                    // Pas d'appel à logAuditAction('create', ...) : couvert par le trigger
                    // Postgres trg_audit_missions.

                    if (payload.occupant_id) {
                        await MissionsPage.markIncomingOccupant(payload.occupant_id, payload.candidate_type);
                    }

                    toastMessage('Poste créé.', 'success');
                }

                closeModal();
                await MissionsPage.loadMissions();

            } catch (error) {
                console.error("Erreur d'enregistrement du poste :", error);
                // PostgrestError n'est pas une instance native d'Error : on teste .message directement.
                formError.textContent = "Erreur lors de l'enregistrement : " + (error && error.message ? error.message : 'erreur inconnue.');
                formError.classList.remove('hidden');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Enregistrer';
            }
        });

        // Exposé sur MissionsPage pour appel depuis les autres fichiers de la page
        MissionsPage.openEditModal = openEditModal;

        async function deleteMission(missionId) {
            const mission = MissionsPage.currentMissions.find(m => m.id === missionId);
            const label = mission ? mission.title : 'ce poste';

            if (!window.confirm(`Supprimer définitivement « ${label} » ? Cette action est irréversible.`)) {
                return;
            }

            try {
                // Fait sortir l'occupant, comme un changement de statut, avant de supprimer.
                if (mission && mission.occupant_id) {
                    await MissionsPage.archiveOutgoingOccupant(mission);
                }

                // Contrairement aux suppressions ailleurs sur le site, cette page ne
                // vérifie pas le nombre de lignes affectées après coup — pas de contrôle
                // RLS à rendre ambigu par une relance, donc sûr à envelopper.
                const { error } = await capHumaWithRetry(() =>
                    MissionsPage.supabaseClient
                        .from('missions')
                        .delete()
                        .eq('id', missionId)
                );

                if (error) throw error;

                // Pas d'appel à logAuditAction('delete', ...) : couvert par le trigger
                // Postgres trg_audit_missions.
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
