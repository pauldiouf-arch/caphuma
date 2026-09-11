// Évaluations de l'occupant courant (modale, CRUD, brouillon local). Voir
// missions.js (chargé avant ce fichier) pour l'explication de MissionsPage.
(() => {
        const evaluationsModal = document.getElementById('evaluationsModal');
        const evaluationsList = document.getElementById('evaluationsList');
        const evaluationsEmpty = document.getElementById('evaluationsEmpty');
        const evaluationsError = document.getElementById('evaluationsError');
        const evaluationsSubtitle = document.getElementById('evaluationsSubtitle');
        const evaluationForm = document.getElementById('evaluationForm');
        const evaluationFormError = document.getElementById('evaluationFormError');

        let currentEvaluationMission = null;

        // Brouillon local (evaluationForm) : création uniquement, jamais en édition
        // d'une évaluation existante — ce même <form> sert aux deux cas, voir
        // collectEvaluationDraft() plus bas. Une clé par mission.
        let currentEvaluationDraftKey = null;
        let currentEvaluationDraftBinding = null;

        // Évite d'écrire un brouillon entièrement vide en sessionStorage (qui
        // proposerait ensuite de "restaurer" un formulaire sans contenu). Sert au
        // filtre de collectEvaluationDraft() et au garde-fou local plus bas.
        function isEvaluationDraftNonEmpty(data) {
            return Object.entries(data).some(([key, value]) => {
                if (key === 'evaluationId') return false; // champ technique (hidden), jamais un contenu saisi
                return typeof value === 'string' ? value.trim() !== '' : !!value;
            });
        }

        function collectEvaluationDraft() {
            if (document.getElementById('evaluationId').value) return undefined; // en édition
            const data = capHumaDefaultDraftCollect(evaluationForm);
            if (!isEvaluationDraftNonEmpty(data)) return undefined;
            return data;
        }

        function restoreEvaluationDraft(data) {
            capHumaDefaultDraftRestore(evaluationForm, data);
        }

        // Appelé en fin de openEvaluationsModal(), juste après resetEvaluationForm()
        // (donc #evaluationId est garanti vide ici).
        function startEvaluationDraftTracking(missionId) {
            stopEvaluationDraftTracking();
            currentEvaluationDraftKey = `draft:evaluation:${missionId}`;
            capHumaOfferDraftRestore(currentEvaluationDraftKey, restoreEvaluationDraft);
            currentEvaluationDraftBinding = capHumaAttachDraftAutosave(evaluationForm, currentEvaluationDraftKey, { collect: collectEvaluationDraft });
        }

        function stopEvaluationDraftTracking() {
            if (currentEvaluationDraftBinding) {
                currentEvaluationDraftBinding.stop();
                currentEvaluationDraftBinding = null;
            }
        }

        // Appelé uniquement après une création réussie, jamais après une
        // modification (qui n'a rien à voir avec un brouillon de création en attente).
        function discardEvaluationDraft() {
            stopEvaluationDraftTracking();
            if (currentEvaluationDraftKey) {
                capHumaDraftClear(currentEvaluationDraftKey);
                currentEvaluationDraftKey = null;
            }
        }

        document.getElementById('closeEvaluationsModalBtn').addEventListener('click', () => {
            evaluationsModal.classList.add('hidden');
            stopEvaluationDraftTracking();
        });

        // Formulaire redevenu entièrement vide (saisie effacée sans valider) : on
        // efface le brouillon tout de suite plutôt que d'attendre l'autosave différé.
        evaluationForm.addEventListener('input', () => {
            if (document.getElementById('evaluationId').value) return; // en édition
            if (currentEvaluationDraftKey && !isEvaluationDraftNonEmpty(capHumaDefaultDraftCollect(evaluationForm))) {
                capHumaDraftClear(currentEvaluationDraftKey);
            }
        });

        async function openEvaluationsModal(missionId) {
            const mission = MissionsPage.currentMissions.find(m => m.id === missionId);
            if (!mission || !mission.occupant_id) return;

            currentEvaluationMission = mission;
            const occupantName = MissionsPage.talentNameById[mission.occupant_id] || 'Talent introuvable';
            evaluationsSubtitle.textContent = `${occupantName} — ${mission.title}`;

            evaluationsList.innerHTML = '';
            evaluationsEmpty.classList.add('hidden');
            evaluationsError.classList.add('hidden');
            resetEvaluationForm();

            const canEdit = MissionsPage.currentUserRole === 'admin' || MissionsPage.currentUserRole === 'user';
            evaluationForm.classList.toggle('hidden', !canEdit);
            if (canEdit) {
                startEvaluationDraftTracking(mission.id);
            } else {
                stopEvaluationDraftTracking();
            }

            evaluationsModal.classList.remove('hidden');
            await loadEvaluations(mission.id);
        }

        async function loadEvaluations(missionId) {
            try {
                // Colonnes restreintes à celles réellement utilisées. is_moderated /
                // is_red_list_trigger / legacy_content / comment_text volontairement
                // ignorées : usage non documenté à ce jour.
                const { data: evaluations, error } = await capHumaWithRetry(() =>
                    MissionsPage.supabaseClient
                        .from('evaluations')
                        .select('id, mission_id, talent_id, author_id, author_email, context, positive_points, negative_points, rating, created_at')
                        .eq('mission_id', missionId)
                        .order('created_at', { ascending: false })
                );

                if (error) throw error;

                currentEvaluationsCache = evaluations || [];
                renderEvaluations(currentEvaluationsCache);

            } catch (error) {
                console.error("Erreur de récupération des évaluations :", error);
                evaluationsError.textContent = "Impossible de charger les évaluations depuis Supabase.";
                evaluationsError.classList.remove('hidden');
            }
        }

        function renderEvaluations(evaluations) {
            evaluationsList.innerHTML = '';

            if (evaluations.length === 0) {
                evaluationsEmpty.classList.remove('hidden');
                return;
            }
            evaluationsEmpty.classList.add('hidden');

            evaluations.forEach(evaluation => {
                const canManage = MissionsPage.currentUserRole === 'admin'
                    || (MissionsPage.currentUserRole === 'user' && evaluation.author_id === MissionsPage.currentUserId);

                const item = document.createElement('div');
                item.className = 'bg-slate-50 border border-slate-200 rounded-xl p-4';

                item.innerHTML = `
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-xs font-bold text-slate-600">${escapeHtml(evaluation.author_email || 'Auteur inconnu')}</span>
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-extrabold text-primary bg-primary-light px-2 py-0.5 rounded-full">${escapeHtml(evaluation.rating != null ? evaluation.rating + '/10' : '—')}</span>
                            <span class="text-[10px] text-slate-500">${escapeHtml(MissionsPage.formatDate(evaluation.created_at))}</span>
                        </div>
                    </div>
                    <p class="text-sm text-slate-700 mb-2">${escapeHtml(evaluation.context)}</p>
                    ${evaluation.positive_points ? `<p class="text-xs text-emerald-700 mb-1">${CapHumaIcons.get('checkCircle', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0')} ${escapeHtml(evaluation.positive_points)}</p>` : ''}
                    ${evaluation.negative_points ? `<p class="text-xs text-amber-700 mb-1">${CapHumaIcons.get('alertTriangle', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0')} ${escapeHtml(evaluation.negative_points)}</p>` : ''}
                    ${canManage ? `
                    <div class="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200">
                        <button type="button" class="editEvaluationBtn text-xs font-bold text-primary hover:underline" data-id="${escapeHtml(evaluation.id)}">${CapHumaIcons.get('pencil', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0')} Modifier</button>
                        <button type="button" class="deleteEvaluationBtn text-xs font-bold text-red-600 hover:underline" data-id="${escapeHtml(evaluation.id)}">${CapHumaIcons.get('trash', 'w-3.5 h-3.5 inline-block align-[-0.15em] shrink-0')} Supprimer</button>
                    </div>` : ''}
                `;

                evaluationsList.appendChild(item);
            });

            document.querySelectorAll('.editEvaluationBtn').forEach(btn => {
                btn.addEventListener('click', () => startEditEvaluation(btn.dataset.id));
            });
            document.querySelectorAll('.deleteEvaluationBtn').forEach(btn => {
                btn.addEventListener('click', () => deleteEvaluation(btn.dataset.id));
            });
        }

        // Remplie à chaque loadEvaluations(), pour retrouver les valeurs à éditer
        // sans refaire une requête réseau.
        let currentEvaluationsCache = [];

        function startEditEvaluation(evaluationId) {
            const evaluation = currentEvaluationsCache.find(e => e.id === evaluationId);
            if (!evaluation) return;

            document.getElementById('evaluationId').value = evaluation.id;
            document.getElementById('fieldContext').value = evaluation.context || '';
            document.getElementById('fieldPositivePoints').value = evaluation.positive_points || '';
            document.getElementById('fieldNegativePoints').value = evaluation.negative_points || '';
            document.getElementById('fieldRating').value = evaluation.rating != null ? evaluation.rating : '';

            document.getElementById('evaluationFormLabel').textContent = "Modifier l'évaluation";
            document.getElementById('saveEvaluationBtn').textContent = 'Enregistrer les modifications';
            document.getElementById('cancelEvaluationEditBtn').classList.remove('hidden');
            evaluationFormError.classList.add('hidden');

            evaluationForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function resetEvaluationForm() {
            evaluationForm.reset();
            document.getElementById('evaluationId').value = '';
            document.getElementById('evaluationFormLabel').textContent = 'Ajouter une évaluation';
            document.getElementById('saveEvaluationBtn').textContent = "Ajouter l'évaluation";
            document.getElementById('cancelEvaluationEditBtn').classList.add('hidden');
            evaluationFormError.classList.add('hidden');
        }

        document.getElementById('cancelEvaluationEditBtn').addEventListener('click', resetEvaluationForm);

        async function deleteEvaluation(evaluationId) {
            if (!window.confirm("Supprimer définitivement cette évaluation ? Cette action est irréversible.")) {
                return;
            }

            try {
                const { error } = await capHumaWithRetry(() =>
                    MissionsPage.supabaseClient
                        .from('evaluations')
                        .delete()
                        .eq('id', evaluationId)
                );

                if (error) throw error;

                toastMessage('Évaluation supprimée.', 'success');
                await loadEvaluations(currentEvaluationMission.id);

            } catch (error) {
                console.error("Erreur de suppression de l'évaluation :", error);
                toastMessage("Échec de la suppression : " + (error && error.message ? error.message : 'erreur inconnue.'), 'error');
            }
        }

        evaluationForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            evaluationFormError.classList.add('hidden');

            if (!currentEvaluationMission) return;

            // Capture immédiate avant validation, sans attendre le debounce.
            if (currentEvaluationDraftBinding) currentEvaluationDraftBinding.saveNow();

            const evaluationId = document.getElementById('evaluationId').value;

            const payload = {
                context: document.getElementById('fieldContext').value.trim(),
                positive_points: document.getElementById('fieldPositivePoints').value.trim() || null,
                negative_points: document.getElementById('fieldNegativePoints').value.trim() || null,
                rating: parseInt(document.getElementById('fieldRating').value, 10),
            };

            if (!payload.context || !payload.rating || payload.rating < 1 || payload.rating > 10) {
                evaluationFormError.textContent = "Le contexte et une note entre 1 et 10 sont obligatoires.";
                evaluationFormError.classList.remove('hidden');
                return;
            }

            const saveBtn = document.getElementById('saveEvaluationBtn');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Enregistrement…';

            try {
                if (evaluationId) {
                    // mission_id/talent_id/author_id/author_email ne changent jamais en modification.
                    const { error } = await capHumaWithRetry(() =>
                        MissionsPage.supabaseClient
                            .from('evaluations')
                            .update(payload)
                            .eq('id', evaluationId)
                    );
                    if (error) throw error;
                    toastMessage('Évaluation modifiée.', 'success');
                } else {
                    payload.mission_id = currentEvaluationMission.id;
                    payload.talent_id = currentEvaluationMission.occupant_id;
                    payload.author_id = MissionsPage.currentUserId;
                    payload.author_email = MissionsPage.currentUserEmail;
                    // Pas de capHumaWithRetry() : evaluations n'a aucune contrainte UNIQUE,
                    // une relance après perte de réponse dupliquerait l'évaluation ajoutée.
                    const { error } = await MissionsPage.supabaseClient
                        .from('evaluations')
                        .insert(payload);
                    if (error) throw error;
                    toastMessage('Évaluation ajoutée.', 'success');
                    discardEvaluationDraft(); // création réussie : le brouillon n'a plus lieu d'être
                }

                resetEvaluationForm();
                await loadEvaluations(currentEvaluationMission.id);

            } catch (error) {
                console.error("Erreur d'enregistrement de l'évaluation :", error);
                evaluationFormError.textContent = "Erreur lors de l'enregistrement : " + (error && error.message ? error.message : 'erreur inconnue.');
                evaluationFormError.classList.remove('hidden');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = evaluationId ? 'Enregistrer les modifications' : "Ajouter l'évaluation";
            }
        });

        // Exposé sur MissionsPage pour appel depuis les autres fichiers de la page
        MissionsPage.openEvaluationsModal = openEvaluationsModal;
})();
