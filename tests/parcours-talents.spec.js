const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const XLSX = require('../shared/vendor/xlsx.core.min.js');
const { ouvrirPage, erreurServeur, attendreMessageLisible, CLE_SESSION } = require('./simulateur-supabase');
const { ID, ID_COMPTES, PIEGE } = require('./donnees');

const envoi = (page, methode, fin) => (page.corpsEnvoyes || []).filter(e => e.methode === methode && e.chemin.endsWith(fin));
const journal = (page) => envoi(page, 'POST', '/rpc/log_client_event').map(e => e.corps);
const notification = (page, texte) => page.locator('div.fixed.bottom-5', { hasText: texte });
const lignesTalents = (page) => page.locator('#talentsList a[href^="id-card.html"]');

test.describe('Connexion', () => {
    test('bons identifiants : accès au tableau de bord et connexion journalisée', async ({ page }) => {
        await ouvrirPage(page, 'login.html', undefined, { connecte: false, attendre: false });
        await page.fill('#loginEmail', 'reco@alima.ngo');
        await page.fill('#loginPassword', 'secret');
        await page.click('#submitLoginBtn');
        await expect(page).toHaveURL(/dashboard\.html/);
        expect(journal(page)).toContainEqual({ p_action: 'login', p_entity_type: 'user' });
        expect(envoi(page, 'POST', '/audit_logs')).toEqual([]);
    });

    test('mauvais identifiants : message clair, bouton de nouveau utilisable', async ({ page }) => {
        await ouvrirPage(page, 'login.html', undefined, { connecte: false, attendre: false });
        await page.fill('#loginEmail', 'inconnu@alima.ngo');
        await page.fill('#loginPassword', 'faux');
        await page.click('#submitLoginBtn');
        await expect(page.locator('#loginError')).toHaveText('Identifiants incorrects ou compte inexistant.');
        await expect(page.locator('#submitLoginBtn')).toBeEnabled();
        await expect(page).toHaveURL(/login\.html/);
    });

    test('compte suspendu : message dédié', async ({ page }) => {
        await ouvrirPage(page, 'login.html', (requete) => {
            if (requete.chemin === '/auth/v1/token') return { status: 400, body: { code: 400, error_code: 'user_banned', msg: 'User is banned' } };
        }, { connecte: false, attendre: false });
        await page.fill('#loginEmail', 'reco@alima.ngo');
        await page.fill('#loginPassword', 'secret');
        await page.click('#submitLoginBtn');
        await expect(page.locator('#loginError')).toHaveText('Compte suspendu. Contactez un administrateur ALIMA.');
    });

    test('déjà connecté : la page de connexion mène au tableau de bord', async ({ page }) => {
        await ouvrirPage(page, 'login.html', undefined, { attendre: false });
        await expect(page).toHaveURL(/dashboard\.html/);
    });

    test('mot de passe oublié : e-mail repris, demande envoyée, message de confirmation', async ({ page }) => {
        await ouvrirPage(page, 'login.html', undefined, { connecte: false, attendre: false });
        await page.fill('#loginEmail', 'reco@alima.ngo');
        await page.click('#showResetRequestBtn');
        await expect(page.locator('#resetRequestEmail')).toHaveValue('reco@alima.ngo');
        await page.click('#submitResetRequestBtn');
        await expect(page.locator('#resetRequestMessage')).toContainText('un administrateur a été prévenu');
        expect(envoi(page, 'POST', '/rpc/request_access_code_reset').map(e => e.corps)).toEqual([{ p_email: 'reco@alima.ngo' }]);
        await page.click('#backToLoginBtn');
        await expect(page.locator('#loginForm')).toBeVisible();
    });

    test('mot de passe oublié en panne : message d\'erreur et nouvel essai possible', async ({ page }) => {
        await ouvrirPage(page, 'login.html', (requete) => {
            if (requete.chemin.endsWith('/rpc/request_access_code_reset')) return erreurServeur();
        }, { connecte: false, attendre: false });
        await page.click('#showResetRequestBtn');
        await page.fill('#resetRequestEmail', 'reco@alima.ngo');
        await page.click('#submitResetRequestBtn');
        await expect(page.locator('#resetRequestMessage')).toContainText("La demande n'a pas pu être envoyée");
        await expect(page.locator('#submitResetRequestBtn')).toBeEnabled();
    });

    test('déconnexion : retour à la connexion, session effacée, déconnexion journalisée', async ({ page }) => {
        await ouvrirPage(page, 'dashboard.html', undefined, { role: 'user' });
        await page.locator('#logoutBtn').click();
        await expect(page).toHaveURL(/login\.html/);
        expect(await page.evaluate((cle) => localStorage.getItem(cle), CLE_SESSION)).toBeNull();
        expect(journal(page).map(j => j.p_action)).toContain('logout');
        expect(envoi(page, 'POST', '/audit_logs')).toEqual([]);
    });
});

test.describe('Liste des talents', () => {
    test('par défaut : talents actifs et staff national suivi, sans dévalidé ni Liste Rouge', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'user' });
        await expect(page.locator('#talentsList')).toContainText('Binta');
        const texte = await page.locator('#talentsList').innerText();
        expect(texte).toContain('Cheick');
        expect(texte).toContain('Staff national');
        expect(texte).not.toContain('Dado');
        expect(texte).not.toContain('Eli');
        await expect(page.locator('#searchResultsSummary')).toHaveText('3 talents au total');
    });

    test('recherche par nom : un seul résultat et résumé', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'user' });
        await page.fill('#searchInput', 'binta');
        await expect(page.locator('#searchResultsSummary')).toHaveText('1 talent trouvé sur 5 au total');
        await expect(lignesTalents(page).filter({ hasText: 'Binta' })).toHaveCount(1);
        await expect(lignesTalents(page).filter({ hasText: 'Fanta' })).toHaveCount(0);
    });

    test('filtre « dévalidés » puis bouton de réinitialisation', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'user' });
        await page.selectOption('#filterValidity', 'devalidated');
        await expect(page.locator('#talentsList')).toContainText('Dado');
        await expect(page.locator('#talentsList')).not.toContainText('Binta');
        await page.click('#resetFiltersBtn');
        await expect(page.locator('#talentsList')).toContainText('Binta');
        await expect(page.locator('#resetFiltersBtn')).toBeHidden();
    });

    test('filtres avancés : langue et visa', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'user' });
        await page.click('#toggleAdvancedBtn');
        await expect(page.locator('#toggleAdvancedBtn')).toHaveAttribute('aria-expanded', 'true');
        await page.fill('#filterLanguage', 'angl');
        await expect(page.locator('#searchResultsSummary')).toContainText('1 talent trouvé');
        await expect(page.locator('#talentsList')).toContainText('Fanta');
        await page.fill('#filterLanguage', '');
        await page.selectOption('#filterVisa', 'oui');
        await expect(page.locator('#talentsList')).not.toContainText('Fanta');
        await expect(page.locator('#talentsList')).toContainText('Binta');
    });

    test('pagination : 45 talents répartis sur 3 pages', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P9', (requete) => {
            if (requete.chemin.endsWith('/rest/v1/talents') && requete.methode === 'GET') {
                if (requete.parametres.has('tracking_pool')) return [];
                return Array.from({ length: 45 }, (_, i) => ({ id: `t-${String(i).padStart(2, '0')}`, first_name: `Prénom${String(i).padStart(2, '0')}`, last_name: 'Test', pool: 'P9', staff_type: 'expat', status: 'En attente de poste', is_valid: true, is_red_listed: false, pool_integration_date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}` }));
            }
        }, { role: 'user' });
        await expect(page.locator('#paginationLabel')).toHaveText('Page 1 sur 3');
        await expect(page.locator('#prevPageBtn')).toBeDisabled();
        await expect(lignesTalents(page)).toHaveCount(20);
        await page.click('#nextPageBtn');
        await page.click('#nextPageBtn');
        await expect(page.locator('#paginationLabel')).toHaveText('Page 3 sur 3');
        await expect(lignesTalents(page)).toHaveCount(5);
        await expect(page.locator('#nextPageBtn')).toBeDisabled();
    });

    test('talent à 24 mois et plus : « À arbitrer » avec Prolonger et Dévalider, sauf pour un visiteur', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'user' });
        const ligne = page.locator('#talentsList > div', { hasText: 'Fanta' });
        await expect(ligne).toContainText('À arbitrer');
        await expect(ligne.locator('.btn-prolong-talent')).toBeVisible();
        await expect(ligne.locator('.btn-devalidate-talent')).toBeVisible();
        await expect(page.locator('#talentsList > div', { hasText: 'Binta' }).locator('.btn-prolong-talent')).toHaveCount(0);
    });

    test('visiteur : « À arbitrer » visible mais sans bouton d\'action', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'visitor' });
        const ligne = page.locator('#talentsList > div', { hasText: 'Fanta' });
        await expect(ligne).toContainText('À arbitrer');
        await expect(ligne.locator('button')).toHaveCount(0);
    });

    test('prolonger de 6 mois : enregistrement et badge « Prolongé »', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'user' });
        await page.locator('#talentsList > div', { hasText: 'Fanta' }).locator('.btn-prolong-talent').click();
        await expect(page.locator('#prolongTalentName')).toHaveText('Fanta Camara');
        await page.selectOption('#prolongMonths', '6');
        await page.click('#prolongConfirmBtn');
        await expect(notification(page, 'Prolongation de 6 mois accordée.')).toBeVisible();
        const [maj] = envoi(page, 'PATCH', '/talents');
        expect(maj.parametres.id).toBe(`eq.${ID.aArbitrer}`);
        expect(maj.corps.devalidation_extension_months).toBe(6);
        await expect(page.locator('#talentsList > div', { hasText: 'Fanta' })).toContainText('Prolongé jusqu');
    });

    test('dévalider depuis la liste : confirmation avec l\'e-mail, puis le talent quitte la liste', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'user' });
        await page.locator('#talentsList > div', { hasText: 'Fanta' }).locator('.btn-devalidate-talent').click();
        await expect(notification(page, 'a été dévalidé(e)')).toBeVisible();
        expect(page.dialogues[0]).toContain('fanta@exemple.org');
        const [maj] = envoi(page, 'PATCH', '/talents');
        expect(maj.corps).toMatchObject({ is_valid: false, devalidation_extension_until: null });
        await expect(page.locator('#talentsList')).not.toContainText('Fanta');
    });

    test('créer un talent : envoi complet, fenêtre fermée, talent dans la liste', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'user' });
        await page.click('#newTalentBtn');
        await page.fill('#field-first-name', 'Gaby');
        await page.fill('#field-last-name', 'Diop');
        await page.fill('#field-email', 'gaby@exemple.org');
        await page.fill('#field-current-function', 'Logisticien');
        await page.click('#saveTalentBtn');
        await expect(page.locator('#talentModal')).toBeHidden();
        const [creation] = envoi(page, 'POST', '/talents');
        expect(creation.corps).toMatchObject({ first_name: 'Gaby', last_name: 'Diop', email: 'gaby@exemple.org', current_function: 'Logisticien', pool: 'P1', is_valid: true, created_by: ID_COMPTES.user });
        await expect(page.locator('#talentsList')).toContainText('Gaby');
    });

    test('créer un staff national : sans pool, suivi par le pool courant', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'user' });
        await page.click('#newNationalStaffLink');
        await expect(page.locator('#modalTitle')).toHaveText('Nouveau staff national');
        await page.fill('#field-first-name', 'Hawa');
        await page.fill('#field-last-name', 'Keita');
        await page.click('#saveTalentBtn');
        await expect(page.locator('#talentModal')).toBeHidden();
        const [creation] = envoi(page, 'POST', '/talents');
        expect(creation.corps).toMatchObject({ first_name: 'Hawa', staff_type: 'national', pool: null, tracking_pool: 'P1' });
    });

    test('modifier un talent : les champs existants sont repris et la modification enregistrée', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'user' });
        await page.locator('#talentsList > div', { hasText: 'Binta' }).locator('.edit-btn').click();
        await expect(page.locator('#field-email')).toHaveValue('binta@exemple.org');
        await page.fill('#field-current-function', 'Cheffe de mission');
        await page.click('#saveTalentBtn');
        await expect(page.locator('#talentModal')).toBeHidden();
        const [maj] = envoi(page, 'PATCH', '/talents');
        expect(maj.parametres.id).toBe(`eq.${ID.aRisque}`);
        expect(maj.corps).toMatchObject({ first_name: 'Binta', last_name: 'Koné', email: 'binta@exemple.org', current_function: 'Cheffe de mission' });
    });

    test('brouillon : une saisie interrompue est proposée à la réouverture', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', undefined, { role: 'user' });
        await page.click('#newTalentBtn');
        await page.fill('#field-first-name', 'Brouillon');
        await page.fill('#field-last-name', 'Test');
        await page.waitForTimeout(1200);
        await page.click('#cancelBtn');
        await page.click('#newTalentBtn');
        await expect(page.locator('#field-first-name')).toHaveValue('Brouillon');
    });

    for (const [cas, chemin, attendu] of [
        ['liste par défaut', 'talents.html?pool=P1', ['Awa', 'Binta', 'Fanta']],
        ['après une recherche', 'talents.html?pool=P1', ['Binta']],
    ]) {
        test(`export Excel ${cas} : exactement les talents affichés`, async ({ page }) => {
            await ouvrirPage(page, chemin, undefined, { role: 'user' });
            if (cas === 'après une recherche') {
                await page.fill('#searchInput', 'binta');
                await expect(page.locator('#searchResultsSummary')).toContainText('1 talent trouvé');
            }
            await expect(page.locator('#talentsList')).toContainText('Binta');
            const [fichier] = await Promise.all([page.waitForEvent('download'), page.click('#exportPoolExcelBtn')]);
            expect(fichier.suggestedFilename()).toMatch(/^talents-p1-\d{4}-\d{2}-\d{2}\.xlsx$/);
            const classeur = XLSX.read(fs.readFileSync(await fichier.path()));
            const lignes = XLSX.utils.sheet_to_json(classeur.Sheets[classeur.SheetNames[0]]);
            expect(lignes.map(l => l['Prénom(s) et Nom'].split(' ')[0]).sort()).toEqual(attendu);
            expect(Object.keys(lignes[0])).toEqual(expect.arrayContaining(['Genre', 'Adresse mail', 'Nationalité', 'Visa Schengen', 'Nombre de missions ALIMA']));
            await expect.poll(() => journal(page).map(j => j.p_action)).toContain('export');
        });
    }
});

test.describe('Fiche talent', () => {
    const fiche = (id = ID.expat) => `id-card.html?id=${id}`;

    test('affichage : identité et validité', async ({ page }) => {
        await ouvrirPage(page, fiche(ID.aRisque), undefined, { role: 'user' });
        await expect(page.locator('#talent-fullname')).toHaveText('Binta Koné');
        await expect(page.locator('#info-email')).toHaveText('binta@exemple.org');
        await expect(page.locator('#validity-counter')).toContainText('23');
        await expect(page.locator('#info-nationality')).toHaveText('malienne');
    });

    test('affichage : historique des pools, commentaires, parcours', async ({ page }) => {
        await ouvrirPage(page, fiche(), undefined, { role: 'user' });
        await expect(page.locator('#pool-history-container')).toContainText('P2');
        await expect(page.locator('#comments-list-container')).toContainText('Commentaire');
        await expect(page.locator('#timeline-container')).toContainText('Ancien poste');
    });

    test('talent inexistant : message d\'erreur', async ({ page }) => {
        await ouvrirPage(page, fiche('99999999-9999-9999-9999-999999999999'), undefined, { role: 'user' });
        await expect(page.locator('#error-banner')).toBeVisible();
        await expect(page.locator('#error-message')).toContainText("n'existe pas");
    });

    test('commentaire : ajout, puis affiché en tête de liste', async ({ page }) => {
        await ouvrirPage(page, fiche(), undefined, { role: 'user' });
        await page.fill('#new-comment-input', 'Très bon retour terrain');
        await page.click('#btn-add-comment');
        await expect(notification(page, 'Commentaire ajouté.')).toBeVisible();
        await expect(page.locator('#comments-list-container')).toContainText('Très bon retour terrain');
        await expect(page.locator('#new-comment-input')).toHaveValue('');
        expect(envoi(page, 'POST', '/comments')[0].corps).toMatchObject({ talent_id: ID.expat, user_id: ID_COMPTES.user, content: 'Très bon retour terrain' });
    });

    test('commentaire vide : refusé avec un message', async ({ page }) => {
        await ouvrirPage(page, fiche(), undefined, { role: 'user' });
        await page.click('#btn-add-comment');
        await expect.poll(() => page.dialogues).toContain("Veuillez saisir un commentaire avant de l'ajouter.");
        expect(envoi(page, 'POST', '/comments')).toEqual([]);
    });

    test('commentaires : un recruteur gère les siens, pas ceux des autres', async ({ page }) => {
        await ouvrirPage(page, fiche(), (requete) => {
            if (requete.chemin.endsWith('/rest/v1/comments') && requete.methode === 'GET') {
                return [
                    { id: 'c1', talent_id: ID.expat, user_id: ID_COMPTES.user, content: 'Le mien', created_at: '2026-05-02T10:00:00Z', author_email: 'reco@alima.ngo' },
                    { id: 'c2', talent_id: ID.expat, user_id: ID_COMPTES.admin, content: "Celui de l'admin", created_at: '2026-05-01T10:00:00Z', author_email: 'admin@alima.ngo' },
                ];
            }
        }, { role: 'user' });
        await expect(page.locator('[data-comment-id="c1"] .btn-edit-comment')).toBeVisible();
        await expect(page.locator('[data-comment-id="c2"] .btn-edit-comment')).toHaveCount(0);
    });

    test('commentaire : modification puis suppression', async ({ page }) => {
        await ouvrirPage(page, fiche(), undefined, { role: 'admin' });
        await page.click('[data-comment-id="c1"] .btn-edit-comment');
        await page.fill('[data-comment-id="c1"] .edit-comment-textarea', 'Texte corrigé');
        await page.click('[data-comment-id="c1"] .btn-save-edit-comment');
        await expect(notification(page, 'Commentaire modifié.')).toBeVisible();
        await expect(page.locator('#comments-list-container')).toContainText('Texte corrigé');
        await page.click('[data-comment-id="c1"] .btn-delete-comment');
        await expect(notification(page, 'Commentaire supprimé.')).toBeVisible();
        await expect(page.locator('#comments-list-container')).toContainText('Aucun commentaire');
        expect(journal(page), 'le journal des commentaires est tenu par la base').toEqual([]);
        expect(envoi(page, 'POST', '/audit_logs')).toEqual([]);
    });

    test('lien de partage : liste masquée, création 30 jours copiée, révocation', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await ouvrirPage(page, fiche(), undefined, { role: 'user' });
        await page.click('#share-btn');
        await expect(page.locator('#share-links-list')).toContainText('st_jet••••••••ctif');
        await page.click('#share-links-generate');
        await expect(notification(page, 'Nouveau lien généré et copié')).toBeVisible();
        const [creation] = envoi(page, 'POST', '/share_tokens');
        expect(creation.corps).not.toHaveProperty('token');
        expect(creation.parametres.select).toBe('token');
        const jours = (new Date(creation.corps.expires_at) - Date.now()) / 864e5;
        expect(jours).toBeGreaterThan(29.9);
        expect(jours).toBeLessThan(30.1);
        const jetonDeLaBase = page.base.share_tokens.at(-1).token;
        expect(jetonDeLaBase).toMatch(/^st_[0-9a-f-]{36}$/);
        expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`shared-talent.html?token=${jetonDeLaBase}`);
        await expect(page.locator('#share-links-list > div')).toHaveCount(2);
        await page.locator('#share-links-list .btn-revoke-share-link').first().click();
        await expect(notification(page, 'Lien révoqué.')).toBeVisible();
        await expect(page.locator('#share-links-list > div')).toHaveCount(1);
    });

    test('lien de partage : date précise passée refusée', async ({ page }) => {
        await ouvrirPage(page, fiche(), undefined, { role: 'user' });
        await page.click('#share-btn');
        await page.selectOption('#share-links-duration', 'custom');
        await page.fill('#share-links-custom-date', '2020-01-01');
        await page.click('#share-links-generate');
        await expect(notification(page, "La date d'expiration doit être dans le futur.")).toBeVisible();
        expect(envoi(page, 'POST', '/share_tokens')).toEqual([]);
    });

    test('lien de partage : 90 jours au plus, dans le calendrier comme à l\'envoi', async ({ page }) => {
        await ouvrirPage(page, fiche(), undefined, { role: 'user' });
        await page.click('#share-btn');
        await page.selectOption('#share-links-duration', 'custom');
        const date = page.locator('#share-links-custom-date');
        const dansJours = (n) => page.evaluate((j) => { const d = new Date(); d.setDate(d.getDate() + j); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, n);
        await expect(date).toHaveAttribute('max', await dansJours(90));
        await date.fill(await dansJours(91));
        await page.click('#share-links-generate');
        await expect(notification(page, 'Un lien de partage est valable 90 jours au plus.')).toBeVisible();
        expect(envoi(page, 'POST', '/share_tokens')).toEqual([]);
        await date.fill(await dansJours(90));
        await page.click('#share-links-generate');
        await expect.poll(() => envoi(page, 'POST', '/share_tokens').length).toBe(1);
    });

    test('lien de partage : si la copie automatique est impossible, le lien est affiché pour être copié à la main', async ({ page, context }) => {
        await context.clearPermissions();
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('refusé')) }, configurable: true });
        });
        await ouvrirPage(page, fiche(), undefined, { role: 'user' });
        await page.click('#share-btn');
        await page.click('#share-links-generate');
        await expect(page.locator('#share-links-list > div')).toHaveCount(2);
        await expect.poll(() => page.dialogues.join(' ')).toContain('shared-talent.html?token=st_');
        await expect(notification(page, 'Échec de la génération')).toHaveCount(0);
        page.dialogues.length = 0;
        await page.locator('#share-links-list .btn-copy-share-link').last().click();
        await expect.poll(() => page.dialogues.join(' ')).toContain('shared-talent.html?token=st_jeton-de-test-actif');
        expect(page.erreursPage).toEqual([]);
    });

    test('dévalider puis réintégrer depuis la fiche', async ({ page }) => {
        await ouvrirPage(page, fiche(ID.aRisque), undefined, { role: 'user' });
        await page.click('#btn-devalidate');
        await expect(notification(page, 'Le talent a été dévalidé.')).toBeVisible();
        await expect(page.locator('#btn-revalidate')).toBeVisible();
        await page.click('#btn-revalidate');
        await expect(notification(page, 'Le talent a été réintégré dans le pool.')).toBeVisible();
        const [devalider, reintegrer] = envoi(page, 'PATCH', '/talents');
        expect(devalider.corps.is_valid).toBe(false);
        expect(reintegrer.corps).toMatchObject({ is_valid: true, devalidation_date: null, months_without_mission: 0 });
        await expect(page.locator('#btn-devalidate')).toBeVisible();
    });

    test('Liste Rouge depuis la fiche : motif obligatoire, puis bandeau affiché', async ({ page }) => {
        await ouvrirPage(page, fiche(ID.aRisque), undefined, { role: 'user' });
        await page.click('#btn-redlist');
        await page.click('#modal-redlist-confirm');
        await expect.poll(() => page.dialogues).toContain("Veuillez indiquer la raison d'inscription.");
        await page.fill('#modal-redlist-reason', 'Comportement inapproprié constaté');
        await page.click('#modal-redlist-confirm');
        await expect(notification(page, 'Le talent est inscrit en Liste Rouge.')).toBeVisible();
        await expect(page.locator('#redlist-banner')).toBeVisible();
        await expect(page.locator('#redlist-reason')).toContainText('Comportement inapproprié constaté');
    });

    test('changer de pool : la bonne demande est envoyée', async ({ page }) => {
        await ouvrirPage(page, fiche(ID.aRisque), undefined, { role: 'user' });
        await page.click('#btn-change-pool');
        await page.selectOption('#modal-pool-select', 'P2');
        await page.click('#modal-pool-confirm');
        await expect(page.locator('#pool-change-modal')).toBeHidden();
        expect(envoi(page, 'POST', '/rpc/change_talent_pool')[0].corps).toEqual({ p_talent_id: ID.aRisque, p_new_pool: 'P2' });
    });

    test('passer en expat : la bonne demande est envoyée', async ({ page }) => {
        await ouvrirPage(page, fiche(ID.national), undefined, { role: 'user' });
        await page.click('#btn-promote-to-expat');
        await page.selectOption('#modal-promote-pool-select', 'P2');
        await page.click('#modal-promote-confirm');
        await expect(page.locator('#promote-modal')).toBeHidden();
        expect(envoi(page, 'POST', '/rpc/promote_national_to_expat')[0].corps).toEqual({ p_talent_id: ID.national, p_pool: 'P2' });
    });

    test('suppression définitive (admin) : double confirmation puis retour à la liste', async ({ page }) => {
        await ouvrirPage(page, fiche(ID.aRisque), undefined, { role: 'admin' });
        await page.click('#btn-delete-talent');
        await expect(notification(page, 'Talent supprimé définitivement.')).toBeVisible();
        expect(page.dialogues).toHaveLength(2);
        expect(page.dialogues[0]).toContain('Binta Koné');
        expect(envoi(page, 'DELETE', '/talents')[0].parametres.id).toBe(`eq.${ID.aRisque}`);
        await expect(page).toHaveURL(/talents\.html/);
    });
});

test.describe('Visiteur : lecture par les portes de la base', () => {
    const TABLES_FERMEES = ['/rest/v1/talents', '/rest/v1/missions', '/rest/v1/comments', '/rest/v1/pool_history', '/rest/v1/evaluations'];
    const limiteAtteinte = erreurServeur('Limite de consultation atteinte (50 fiches par heure). Réessayez plus tard.', '54000');

    async function ouvrirEnVisiteur(page, chemin, reponses = () => undefined) {
        page.lectures = [];
        await ouvrirPage(page, chemin, (requete) => {
            if (requete.methode === 'GET') page.lectures.push(requete.chemin);
            return reponses(requete);
        }, { role: 'visitor' });
    }
    const tablesLues = (page) => page.lectures.filter(chemin => TABLES_FERMEES.includes(chemin));

    test('liste : une page servie par la base, sans lecture de table, export Excel masqué', async ({ page }) => {
        await ouvrirEnVisiteur(page, 'talents.html?pool=P1');
        await expect(page.locator('#searchResultsSummary')).toHaveText('3 talents au total');
        const texte = await page.locator('#talentsList').innerText();
        expect(texte).toContain('Binta');
        expect(texte).toContain('Cheick');
        expect(texte).not.toContain('Dado');
        expect(texte).not.toContain('Eli');
        await expect(page.locator('#exportPoolExcelBtn')).toBeHidden();
        const [demande] = envoi(page, 'POST', '/rpc/visitor_talents_page');
        expect(demande.corps).toMatchObject({ p_pool: 'P1', p_page: 0, p_filters: { validity: 'active', sort_by: 'integration', sort_order: 'desc' } });
        expect(tablesLues(page)).toEqual([]);
    });

    test('recherche : la frappe est regroupée en une seule demande, filtrée par la base', async ({ page }) => {
        await ouvrirEnVisiteur(page, 'talents.html?pool=P1');
        await expect(page.locator('#searchResultsSummary')).toHaveText('3 talents au total');
        await page.locator('#searchInput').pressSequentially('binta', { delay: 40 });
        await expect(page.locator('#searchResultsSummary')).toHaveText('1 talent au total');
        await expect(lignesTalents(page).filter({ hasText: 'Binta' })).toHaveCount(1);
        const demandes = envoi(page, 'POST', '/rpc/visitor_talents_page');
        expect(demandes).toHaveLength(2);
        expect(demandes[1].corps.p_filters.search).toBe('binta');
    });

    test('filtre de nationalité : envoyé sous forme de codes pays', async ({ page }) => {
        await ouvrirEnVisiteur(page, 'talents.html?pool=P1');
        await page.click('#toggleAdvancedBtn');
        await page.fill('#filterNationality', 'malienne');
        await expect.poll(() => envoi(page, 'POST', '/rpc/visitor_talents_page').length).toBe(2);
        const codes = envoi(page, 'POST', '/rpc/visitor_talents_page')[1].corps.p_filters.nationality_codes;
        expect(codes).toContain('ML');
        expect(codes).not.toContain('SN');
        await expect(page.locator('#searchResultsSummary')).toHaveText('3 talents au total');
    });

    test('liste : limite horaire atteinte, message lisible', async ({ page }) => {
        await ouvrirEnVisiteur(page, 'talents.html?pool=P1', (requete) => {
            if (requete.chemin.endsWith('/rpc/visitor_talents_page')) return limiteAtteinte;
        });
        await attendreMessageLisible(page, '#listError', 'Limite de consultation atteinte');
    });

    test('fiche : servie par la base, évaluations sans l\'e-mail de leur auteur, sans lecture de table', async ({ page }) => {
        await ouvrirEnVisiteur(page, `id-card.html?id=${ID.expat}`);
        await expect(page.locator('#talent-fullname')).toContainText('Awa');
        await expect(page.locator('#info-email')).toHaveText('awa@exemple.org');
        await expect(page.locator('#timeline-container')).toContainText('Ancien poste');
        await expect(page.locator('#timeline-container')).toContainText('Référente nutrition Niger');
        await expect(page.locator('#timeline-container')).not.toContainText('reco@alima.ngo');
        await expect(page.locator('#pool-history-container')).toContainText('P2');
        await expect(page.locator('#comments-list-container')).toContainText('Commentaire');
        await expect(page.locator('#comment-form-container')).toBeHidden();
        expect(envoi(page, 'POST', '/rpc/visitor_talent_card').map(e => e.corps)).toEqual([{ p_talent_id: ID.expat }]);
        expect(tablesLues(page)).toEqual([]);
        expect(page.erreursPage).toEqual([]);
    });

    test('fiche d\'un talent en Liste Rouge : refusée par la base, message « n\'existe pas »', async ({ page }) => {
        await ouvrirEnVisiteur(page, `id-card.html?id=${ID.listeRouge}`);
        await expect(page.locator('#error-message')).toContainText("n'existe pas");
        await expect(page.locator('#talent-fullname')).not.toContainText('Eli');
    });

    test('fiche : limite horaire atteinte, message lisible', async ({ page }) => {
        await ouvrirEnVisiteur(page, `id-card.html?id=${ID.expat}`, (requete) => {
            if (requete.chemin.endsWith('/rpc/visitor_talent_card')) return limiteAtteinte;
        });
        await attendreMessageLisible(page, '#error-banner', 'Limite de consultation atteinte');
    });
});

test.describe('Lien de partage public', () => {
    test('lien valide : profil affiché sans données internes', async ({ page }) => {
        await ouvrirPage(page, 'shared-talent.html?token=st_jeton-de-test-actif', undefined, { connecte: false, attendre: false });
        await expect(page.locator('#talent-card')).toBeVisible();
        await expect(page.locator('#talent-fullname')).toContainText('Awa');
        await expect(page.locator('#timeline-container')).toContainText('Poste');
        await expect(page.locator('body')).not.toContainText('Commentaire');
        await expect(page.locator('#logoutBtn')).toHaveCount(0);
        expect(envoi(page, 'POST', '/rpc/get_shared_talent')[0].corps).toEqual({ p_token: 'st_jeton-de-test-actif' });
    });

    for (const [code, titre] of [['invalid_token', 'Lien introuvable'], ['revoked', 'Lien révoqué'], ['expired', 'Lien expiré'], ['talent_not_found', 'Profil introuvable']]) {
        test(`lien refusé (${code}) : « ${titre} »`, async ({ page }) => {
            await ouvrirPage(page, 'shared-talent.html?token=x', (requete) => {
                if (requete.chemin.endsWith('/rpc/get_shared_talent')) return { error: code };
            }, { connecte: false, attendre: false });
            await expect(page.locator('#error-state')).toBeVisible();
            await expect(page.locator('#error-title')).toHaveText(titre);
            await expect(page.locator('#talent-card')).toBeHidden();
        });
    }

    test('lien sans jeton : « Lien invalide »', async ({ page }) => {
        await ouvrirPage(page, 'shared-talent.html', undefined, { connecte: false, attendre: false });
        await expect(page.locator('#error-title')).toHaveText('Lien invalide');
    });

    test('serveur indisponible : message d\'erreur, pas de page blanche', async ({ page }) => {
        await ouvrirPage(page, 'shared-talent.html?token=x', (requete) => {
            if (requete.chemin.endsWith('/rpc/get_shared_talent')) return erreurServeur();
        }, { connecte: false, attendre: false });
        await expect(page.locator('#error-title')).toHaveText('Erreur');
        await expect(page.locator('#error-message')).toContainText('Réessayez plus tard');
    });
});
