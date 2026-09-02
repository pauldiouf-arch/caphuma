// Correctif P26 (B13-Q2, Master Context §7) — 4/4 : liens de partage public
// de la fiche (génération, liste, révocation). Voir id-card.js (chargé
// AVANT ce fichier) pour l'explication de IdCardPage.
(() => {
        // ============================================================================
        // GESTION DES LIENS DE PARTAGE (point ouvert historique, jamais construit
        // jusqu'ici) — génération, liste des liens actifs par talent, révocation
        // manuelle. `is_revoked` existait déjà en base (section 6 du Master Context)
        // mais n'était jusqu'ici jamais exploité côté client.
        // ============================================================================
        function buildShareUrl(token) {
            // Reconstruction à partir du dossier de la page actuelle (jamais
            // window.location.origin seul), pour rester valide en hébergement GitHub
            // Pages "project site" (cf. règle de méthode n°27 du Master Context).
            const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
            // Correctif P12 (B12-S3, 28/08/2026, trouvé en marge de l'audit initial) :
            // token est aujourd'hui 'st_' + crypto.randomUUID(), donc déjà propre —
            // encodé par précaution, même logique que les 2 points ci-dessus.
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

        // Ne montre que les liens réellement encore utilisables (ni révoqués, ni
        // expirés) — un lien expiré tout seul disparaît de la liste sans action
        // nécessaire, un lien révoqué aussi (plus besoin de le voir une fois révoqué).
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
                    <p class="text-[11px] text-slate-400">Créé le ${createdStr} · Expire le ${expiresStr} · Vu ${viewsStr} fois</p>
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
                // Enveloppé dans capHumaWithRetry() (P19) : UPDATE par id, sûr à
                // retenter (voir le raisonnement détaillé sur la modification de
                // commentaire plus haut dans ce fichier).
                const { data, error } = await capHumaWithRetry(() =>
                    IdCardPage.supabaseClient
                        .from('share_tokens')
                        .update({ is_revoked: true })
                        .eq('id', linkId)
                        .select('id')
                );

                if (error) throw error;
                // Cf. règle de méthode n°15 : un .update() peut "réussir" sans rien
                // affecter si une policy RLS bloque silencieusement la ligne.
                if (!data || data.length === 0) {
                    throw new Error("La révocation n'a affecté aucune ligne (policy RLS ?).");
                }

                // IdCardPage.logAuditAction('update', 'share_link', ...) retiré le 18/08/2026 (A5) :
                // couvert désormais par le trigger Postgres trg_audit_share_tokens.
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

        // Calcule la date d'expiration ISO selon le choix du sélecteur de durée —
        // renvoie null si la sélection est invalide (date précise manquante ou déjà
        // passée), pour ne jamais créer un lien déjà expiré silencieusement.
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
                // Correctif sécurité du 17/07/2026 : l'ancienne génération
                // ('st_' + Math.random()...) n'était PAS cryptographiquement sûre —
                // Math.random() est prévisible en théorie. crypto.randomUUID() est le
                // générateur d'aléa sécurisé natif du navigateur (Web Crypto API,
                // disponible nativement, aucune dépendance ajoutée), utilisé ici pour
                // protéger l'accès à des fiches talent confidentielles partagées sans
                // compte. Format légèrement différent (UUID v4 avec tirets) mais la
                // colonne `token` est un simple texte UNIQUE, donc sans impact sur le
                // schéma ni sur les liens déjà générés (ils restent valides tels quels).
                const token = 'st_' + crypto.randomUUID();
                // created_at retiré du payload (DEFAULT now() côté base) ; expires_at
                // envoyé en ISO string, jamais en timestamp JS numérique (la colonne est
                // "timestamp with time zone" — cf. règle de méthode n°26).
                // Enveloppé dans capHumaWithRetry() (P19) : sûr à retenter — token est
                // calculé une seule fois juste au-dessus (pas régénéré à chaque tentative)
                // et share_tokens.token porte une contrainte UNIQUE (Dossier de passation
                // §4.2), donc une relance après perte de réponse retomberait proprement
                // sur une violation de contrainte plutôt que de créer un second lien.
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
                // IdCardPage.logAuditAction('create', 'share_link', ...) retiré le 18/08/2026 (A5) :
                // couvert désormais par le trigger Postgres trg_audit_share_tokens.
                await loadShareLinks();
            } catch (err) {
                console.error(err);
                toastMessage("Échec de la génération du lien de partage.", "error");
            } finally {
                btn.disabled = false;
            }
        });

        // toastMessage() retirée d'ici : vient désormais de shared/caphuma-utils.js.
        // ⚠️ Petit changement : z-index 50→70 et durée 3000→3500ms (harmonisé
        // avec la majorité des pages — voir MC13 Addendum, point A3).


        // Exposé sur IdCardPage pour appel depuis un autre fichier de la page
        IdCardPage.openShareLinksModal = openShareLinksModal;
})();
