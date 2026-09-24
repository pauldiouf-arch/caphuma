(() => {
        function buildShareUrl(token) {
            // Pas window.location.origin seul : le site est servi depuis un sous-dossier.
            const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
            return `${window.location.origin}${basePath}shared-talent.html?token=${encodeURIComponent(token)}`;
        }

        function maskToken(token) {
            if (!token || token.length <= 12) return token || '';
            return token.substring(0, 6) + '••••••••' + token.substring(token.length - 4);
        }

        const SHARE_MAX_DAYS = 90;

        function isoDateInDays(days) {
            const d = new Date();
            d.setDate(d.getDate() + days);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }

        function openShareLinksModal() {
            document.getElementById('share-links-modal').classList.remove('hidden');
            document.getElementById('share-links-modal').classList.add('flex');
            document.getElementById('share-links-duration').value = '30';
            const customDate = document.getElementById('share-links-custom-date');
            customDate.value = '';
            customDate.min = isoDateInDays(1);
            customDate.max = isoDateInDays(SHARE_MAX_DAYS);
            customDate.classList.add('hidden');
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
                if (await copyShareUrl(buildShareUrl(link.token))) {
                    toastMessage("Lien copié dans le presse-papiers.", "success");
                }
            });

            row.querySelector('.btn-revoke-share-link').addEventListener('click', () => revokeShareLink(link.id));

            return row;
        }

        async function copyShareUrl(url) {
            try {
                await navigator.clipboard.writeText(url);
                return true;
            } catch (err) {
                console.warn("[Partage] Copie automatique impossible :", err);
                window.prompt("Copie automatique impossible : sélectionnez ce lien (Ctrl/Cmd+C) pour le copier.", url);
                return false;
            }
        }

        async function revokeShareLink(linkId) {
            const confirmed = confirm("Révoquer ce lien ? Toute personne qui l'utilise perdra immédiatement l'accès à la fiche.");
            if (!confirmed) return;

            try {
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
                const expiresAt = new Date(dateVal + 'T23:59:59');
                if (expiresAt.getTime() <= Date.now()) {
                    return { error: "La date d'expiration doit être dans le futur." };
                }
                if (dateVal > isoDateInDays(SHARE_MAX_DAYS)) {
                    return { error: `Un lien de partage est valable ${SHARE_MAX_DAYS} jours au plus.` };
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
                const { data: created, error } = await IdCardPage.supabaseClient.from('share_tokens').insert({
                    talent_id: IdCardPage.talentId,
                    created_by: IdCardPage.currentUserId,
                    expires_at: expiry.value
                }).select('token').single();

                if (error) throw error;

                await loadShareLinks();
                if (await copyShareUrl(buildShareUrl(created.token))) {
                    toastMessage("Nouveau lien généré et copié dans le presse-papiers !", "success");
                }
            } catch (err) {
                console.error(err);
                toastMessage("Échec de la génération du lien de partage.", "error");
            } finally {
                btn.disabled = false;
            }
        });

        IdCardPage.openShareLinksModal = openShareLinksModal;
})();
