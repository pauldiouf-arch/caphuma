// Commentaires libres sur la fiche talent : lecture, ajout, modification,
// suppression, brouillon local. Voir id-card.js (chargé AVANT ce fichier)
// pour l'explication de IdCardPage.
(() => {
        // ============================================================================
        // COMMENTAIRES LIBRES
        // - Lecture : tout rôle connecté (admin/user/visitor).
        // - Ajout : admin et user uniquement.
        // - Modification/Suppression : admin sur tout commentaire, user uniquement
        //   sur ses propres commentaires (comparaison user_id === IdCardPage.currentUserId).
        // - author_email enregistré directement à la création (pas de jointure vers
        //   users, pour éviter le même risque RLS déjà documenté pour evaluations).
        // ============================================================================
        async function loadComments() {
            const container = document.getElementById('comments-list-container');
            try {
                const { data, error } = await capHumaWithRetry(() =>
                    IdCardPage.supabaseClient
                        .from('comments')
                        .select('id, talent_id, user_id, content, author_email, created_at')
                        .eq('talent_id', IdCardPage.talentId)
                        .order('created_at', { ascending: false })
                );

                if (error) throw error;

                IdCardPage.comments = data || [];
                renderComments();
            } catch (err) {
                console.error("Erreur de chargement des commentaires :", err);
                if (container) {
                    container.innerHTML = `<p class="text-sm text-red-500 italic">Impossible de charger les commentaires.</p>`;
                }
            }
        }

        function renderComments() {
            const container = document.getElementById('comments-list-container');
            const formContainer = document.getElementById('comment-form-container');
            if (!container) return;

            // Formulaire d'ajout masqué pour visitor (lecture seule)
            if (formContainer) {
                formContainer.classList.toggle('hidden', IdCardPage.currentUserRole === 'visitor');
            }

            if (IdCardPage.comments.length === 0) {
                container.innerHTML = `<p class="text-sm text-slate-400 italic">Aucun commentaire pour le moment.</p>`;
                return;
            }

            container.innerHTML = '';
            IdCardPage.comments.forEach(c => {
                const canManage = IdCardPage.currentUserRole === 'admin' ||
                    (IdCardPage.currentUserRole === 'user' && c.user_id === IdCardPage.currentUserId);
                const dateStr = c.created_at ? new Date(c.created_at).toLocaleString('fr-FR') : '';
                const authorLabel = c.author_email || 'Auteur inconnu';

                const actionsHtml = canManage ? `
                    <div class="flex items-center gap-2 shrink-0">
                        <button class="btn-edit-comment text-xs font-semibold text-primary hover:underline" data-id="${escapeHtml(c.id)}">Modifier</button>
                        <button class="btn-delete-comment text-xs font-semibold text-red-600 hover:underline" data-id="${escapeHtml(c.id)}">Supprimer</button>
                    </div>
                ` : '';

                container.innerHTML += `
                    <div class="bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm space-y-1" data-comment-id="${escapeHtml(c.id)}">
                        <div class="flex justify-between items-start gap-2">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 text-[10px] text-slate-400 mb-1">
                                    <span>${escapeHtml(authorLabel)}</span>
                                    <span>•</span>
                                    <span>${escapeHtml(dateStr)}</span>
                                </div>
                                <p class="comment-content-text text-slate-700 whitespace-pre-wrap break-words">${escapeHtml(c.content)}</p>
                            </div>
                            ${actionsHtml}
                        </div>
                    </div>
                `;
            });

            bindCommentButtons();
        }

        function bindCommentButtons() {
            // Suppression d'un commentaire
            document.querySelectorAll('.btn-delete-comment').forEach(btn => {
                btn.onclick = async () => {
                    const id = btn.getAttribute('data-id');
                    if (!confirm("Supprimer définitivement ce commentaire ?")) return;

                    try {
                        // Volontairement pas enveloppé dans capHumaWithRetry() :
                        // contrairement à un update par id (la ligne existe toujours après
                        // une 1re tentative réussie, donc une 2e tentative la retrouve sans
                        // problème), un DELETE par id fait disparaître la ligne — si la 1re
                        // tentative a en fait réussi mais que sa réponse s'est perdue, la
                        // 2e tentative ne trouve plus rien à supprimer et déclencherait à
                        // tort le contrôle "0 ligne affectée" juste en dessous, conçu pour
                        // détecter un blocage RLS silencieux, pas une suppression déjà
                        // effective.
                        const { data, error } = await IdCardPage.supabaseClient
                            .from('comments')
                            .delete()
                            .eq('id', id)
                            .select('id');

                        if (error) throw error;
                        if (!data || data.length === 0) {
                            throw new Error("La suppression n'a affecté aucune ligne (policy RLS ?).");
                        }

                        toastMessage("Commentaire supprimé.", "success");
                        await IdCardPage.logAuditAction('delete', 'comment', id, null, `Sur talent ${IdCardPage.talentId}`);
                        await loadComments();
                    } catch (err) {
                        console.error(err);
                        toastMessage("Échec de la suppression : " + (err && err.message ? err.message : 'erreur inconnue.'), "error");
                    }
                };
            });

            // Modification d'un commentaire (édition en ligne)
            document.querySelectorAll('.btn-edit-comment').forEach(btn => {
                btn.onclick = () => {
                    const id = btn.getAttribute('data-id');
                    const card = document.querySelector(`[data-comment-id="${id}"]`);
                    const comment = IdCardPage.comments.find(c => c.id === id);
                    if (!card || !comment) return;

                    const textEl = card.querySelector('.comment-content-text');
                    if (!textEl) return;

                    textEl.outerHTML = `
                        <div class="space-y-2">
                            <textarea class="edit-comment-textarea w-full rounded-xl border border-slate-200 p-2 text-sm outline-none focus:border-primary resize-none" rows="3">${escapeHtml(comment.content)}</textarea>
                            <div class="flex justify-end gap-2">
                                <button class="btn-cancel-edit-comment text-xs font-semibold text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-lg">Annuler</button>
                                <button class="btn-save-edit-comment text-xs font-semibold text-white bg-primary hover:bg-primary-dark px-3 py-1.5 rounded-lg">Enregistrer</button>
                            </div>
                        </div>
                    `;

                    card.querySelector('.btn-cancel-edit-comment').onclick = () => renderComments();

                    card.querySelector('.btn-save-edit-comment').onclick = async () => {
                        const newContent = card.querySelector('.edit-comment-textarea').value.trim();
                        if (!newContent) {
                            alert("Le commentaire ne peut pas être vide.");
                            return;
                        }

                        try {
                            // Enveloppé dans capHumaWithRetry() : contrairement à un DELETE,
                            // la ligne existe toujours après une 1re tentative réussie — une
                            // 2e tentative la retrouve et réapplique le même contenu
                            // (idempotent), le contrôle "0 ligne affectée" juste en dessous
                            // reste donc fiable.
                            const { data, error } = await capHumaWithRetry(() =>
                                IdCardPage.supabaseClient
                                    .from('comments')
                                    .update({ content: newContent })
                                    .eq('id', id)
                                    .select('id')
                            );

                            if (error) throw error;
                            if (!data || data.length === 0) {
                                throw new Error("La modification n'a affecté aucune ligne (policy RLS ?).");
                            }

                            toastMessage("Commentaire modifié.", "success");
                            await loadComments();
                        } catch (err) {
                            console.error(err);
                            toastMessage("Échec de la modification : " + (err && err.message ? err.message : 'erreur inconnue.'), "error");
                        }
                    };
                };
            });
        }


        // Exposé sur IdCardPage pour appel depuis un autre fichier de la page
        IdCardPage.loadComments = loadComments;
})();
