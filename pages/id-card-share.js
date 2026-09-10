// Liens de partage public de la fiche talent : génération, liste, révocation.
// Voir id-card.js (chargé avant ce fichier) pour l'explication de IdCardPage.
(() => {
        function buildShareUrl(token) {
            // Reconstruction à partir du dossier de la page actuelle (jamais
            // window.location.origin seul), pour rester valide en hébergement GitHub
            // Pages "project site".
            const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
            return `${window.location.origin}${basePath}shared-talent.html?token=${encodeURIComponent(token)}`;
        }

        function maskToken(token) {
            if (!token || token.length <= 12) return token || '';
            return token.substring(0, 6) + '••••••••' + token.substring(token.length - 4);
        }

        function openShareLinksModal() {
            document.getElementById('share-links-modal').classList.remove('hidden');
            document.getElementById('share-links-modal').classList.add('flex');
            document.getElementById('share-links-duration').value = '30';
            document.getElementById('share-links-custom-date').value = '';
            document.getElementById('share-links-custom-date').classList.add('hidden');
            loadShareLinks();
        }

        function closeShareLinksModal() {
            document.getElementById('share-links-modal').classList.add('hidden');
            document.getElementById('share-links-modal').classList.remove('flex');
        }

        document.getElementById('share-links-close').addEventListener('click', closeShareLinksModal);

        async function loadShareLinks() {
            const loadingEl = document.getElementById('share-links-loading');
            const emptyEl = document.getElementById('share-links-empty');
            const listEl = document.getElementById('share-links-list');

            loadingEl.classList.remove('hidden');
            emptyEl.classList.add('hidden');
            listEl.innerHTML = '';

            try {
                const { data, error } = await capHumaWithRetry(() =>
                    IdCardPage.supabaseClient
                        .from('share_tokens')
                        .select('id, token, expires_at, is_revoked, view_count, last_viewed_at, created_at')
                        .eq('talent_id', IdCardPage.talentId)
                        .eq('is_revoked', false)
                        .order('created_at', { ascending: false })
                );

                if (error) throw error;

                const now = Date.now();
                const activeLinks = (data || []).filter(l => !l.expires_at || new Date(l.expires_at).getTime() > now);

                loadingEl.classList.add('hidden');

                if (activeLinks.length === 0) {
                    emptyEl.classList.remove('hidden');
                    return;
                }

                activeLinks.forEach(link => listEl.appendChild(renderShareLinkRow(link)));

            } catch (err) {
                console.error("Erreur de chargement des liens de partage :", err);
                loadingEl.classList.add('hidden');
                emptyEl.textContent = "Impossible de charger les liens de partage.";
                emptyEl.classList.remove('hidden');
            }
        }

        function renderShareLinkRow(link) {
            const row = document.createElement('div');
            row.className = "border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap";

            const createdStr = link.created_at ? new Date(link.created_at).toLocaleDateString('fr-FR') : '—';
            const expiresStr = link.expires_at ? new Date(link.expires_at).toLocaleDateString('fr-FR') : 'jamais';
            const viewsStr = link.view_count || 0;

            row.innerHTML = `
                <div class="min-w-0">
                    <p class="text-xs font-mono text-slate-600 truncate">${escapeHtml(maskToken(link.token))}</p>
                    <p class="text-[11px] text-slate-500">Créé le ${createdStr} · Expire le ${expiresStr} · Vu ${viewsStr} fois</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <button class="btn-copy-share-link text-xs font-semibold text-primary hover:bg-primary-light px-2.5 py-1.5 rounded-lg transition-all">Copier</button>
                    <button class="btn-revoke-share-link text-xs font-semibold text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-all">Révoquer</button>
                </div>
            `;

            row.querySelector('.btn-copy-share-link').addEventListener('click', async () => {
                await navigator.clipboard.writeText(buildShareUrl(link.token));
                toastMessage("Lien copié dans le presse-papiers.", "success");
            });

            row.querySelector('.btn-revoke-share-link').addEventListener('click', () => revokeShareLink(link.id));

            return row;
        }

        async function revokeShareLink(linkId) {
            const confirmed = confirm("Révoquer ce lien ? Toute personne qui l'utilise perdra immédiatement l'accès à la fiche.");
            if (!confirmed) return;

            try {
                // UPDATE par id, idempotent : sûr à envelopper dans capHumaWithRetry().
                const { data, error } = await capHumaWithRetry(() =>
                    IdCardPage.supabaseClient
                        .from('share_tokens')
                        .update({ is_revoked: true })
                        .eq('id', linkId)
                        .select('id')
                );

                if (error) throw error;
                if (!data || data.length === 0) {
                    throw new Error("La révocation n'a affecté aucune ligne (policy RLS ?).");
                }

                // Journalisé automatiquement par le trigger Postgres trg_audit_share_tokens,
                // pas d'appel explicite à logAuditAction ici.
                toastMessage("Lien révoqué.", "success");
                await loadShareLinks();
            } catch (err) {
                console.error(err);
                toastMessage("Échec de la révocation : " + (err && err.message ? err.message : 'erreur inconnue.'), "error");
            }
        }

        document.getElementById('share-links-duration').addEventListener('change', (e) => {
            document.getElementById('share-links-custom-date').classList.toggle('hidden', e.target.value !== 'custom');
        });

        function computeShareExpiresAt() {
            const duration = document.getElementById('share-links-duration').value;

            if (duration === 'custom') {
                const dateVal = document.getElementById('share-links-custom-date').value;
                if (!dateVal) return { error: "Choisissez une date d'expiration précise." };
                // Fin de journée (23:59:59) du jour choisi, en heure locale.
                const expiresAt = new Date(dateVal + 'T23:59:59');
                if (expiresAt.getTime() <= Date.now()) {
                    return { error: "La date d'expiration doit être dans le futur." };
                }
                return { value: expiresAt.toISOString() };
            }

            const days = parseInt(duration, 10) || 30;
            return { value: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() };
        }

        document.getElementById('share-links-generate').addEventListener('click', async () => {
            const btn = document.getElementById('share-links-generate');

            const expiry = computeShareExpiresAt();
            if (expiry.error) {
                toastMessage(expiry.error, "error");
                return;
            }

            btn.disabled = true;
            try {
                // crypto.randomUUID(), pas Math.random() : ce jeton donne accès à une
                // fiche talent confidentielle sans compte, Math.random() est prévisible.
                const token = 'st_' + crypto.randomUUID();
                // created_at absent du payload (DEFAULT now() côté base). expires_at en
                // ISO string (colonne "timestamp with time zone"), jamais en timestamp
                // JS numérique.
                // token déjà calculé (pas régénéré à chaque tentative) et `token` porte une
                // contrainte UNIQUE : une relance après perte de réponse retombe proprement
                // sur une violation de contrainte plutôt que de créer un second lien — sûr
                // à envelopper dans capHumaWithRetry().
                const { error } = await capHumaWithRetry(() =>
                    IdCardPage.supabaseClient.from('share_tokens').insert({
                        token,
                        talent_id: IdCardPage.talentId,
                        created_by: IdCardPage.currentUserId,
                        created_by_name: document.getElementById('user-display-name').textContent,
                        expires_at: expiry.value,
                        is_revoked: false,
                        view_count: 0
                    })
                );

                if (error) throw error;

                await navigator.clipboard.writeText(buildShareUrl(token));
                toastMessage("Nouveau lien généré et copié dans le presse-papiers !", "success");
                // Journalisé automatiquement par le trigger Postgres trg_audit_share_tokens.
                await loadShareLinks();
            } catch (err) {
                console.error(err);
                toastMessage("Échec de la génération du lien de partage.", "error");
            } finally {
                btn.disabled = false;
            }
        });

        // Exposé sur IdCardPage pour appel depuis un autre fichier de la page
        IdCardPage.openShareLinksModal = openShareLinksModal;
})();
