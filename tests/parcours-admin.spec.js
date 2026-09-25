const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const XLSX = require('../shared/vendor/xlsx.core.min.js');
const { ouvrirPage, erreurServeur } = require('./simulateur-supabase');
const { ID, ID_COMPTES, DONNEES, PIEGE } = require('./donnees');

const envoi = (page, methode, fin) => (page.corpsEnvoyes || []).filter(e => e.methode === methode && e.chemin.endsWith(fin));
const journal = (page) => envoi(page, 'POST', '/rpc/log_client_event').map(e => e.corps);
const ecrituresJournal = (page) => [...envoi(page, 'POST', '/audit_logs'), ...envoi(page, 'POST', '/rpc/log_client_event')];
const notification = (page, texte) => page.locator('div.fixed.bottom-5', { hasText: texte });
const MODELES = path.join(__dirname, '..', 'templates');

function gestionComptes(reponses = {}) {
    return (requete) => {
        if (requete.chemin !== '/functions/v1/manage-users') return undefined;
        const { action } = JSON.parse(requete.corps);
        if (reponses[action]) return reponses[action];
        if (action === 'create' || action === 'reset_password') return { success: true, accessCode: 'CODE-TEST-1234' };
        return { success: true };
    };
}

function classeurDepuisModele(fichier, feuille, lignes) {
    const classeur = XLSX.read(fs.readFileSync(path.join(MODELES, fichier)));
    const donnees = XLSX.utils.sheet_to_json(classeur.Sheets[feuille], { header: 1, defval: '' });
    const colonnes = donnees[1];
    const nouvelles = lignes.map(ligne => colonnes.map(c => ligne[c] ?? ''));
    classeur.Sheets[feuille] = XLSX.utils.aoa_to_sheet([donnees[0], donnees[1], donnees[2], ...nouvelles]);
    return { name: 'import.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(XLSX.write(classeur, { type: 'array', bookType: 'xlsx' })) };
}

async function lireTelechargement(page, declencheur) {
    const [fichier] = await Promise.all([page.waitForEvent('download'), declencheur()]);
    return { nom: fichier.suggestedFilename(), classeur: XLSX.read(fs.readFileSync(await fichier.path())) };
}

test.describe('Comptes', () => {
    test('liste : trois comptes, et pas de suspension ni suppression de son propre compte', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await expect(page.locator('#accounts-tbody tr')).toHaveCount(3);
        await expect(page.locator(`.btn-delete-account[data-id="${ID_COMPTES.user}"]`)).toHaveCount(1);
        await expect(page.locator(`.btn-delete-account[data-id="${ID_COMPTES.admin}"]`)).toHaveCount(0);
        await expect(page.locator(`.btn-toggle-active[data-id="${ID_COMPTES.admin}"]`)).toHaveCount(0);
    });

    test('créer un compte : demande complète et code d\'accès affiché une fois', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click('#btn-open-create-account');
        await page.fill('#input-new-name', 'Nouvelle Recrue');
        await page.fill('#input-new-email', 'recrue@alima.ngo');
        await page.selectOption('#input-new-role', 'visitor');
        await page.click('#btn-confirm-create-account');
        await expect(page.locator('#modal-access-code')).toBeVisible();
        await expect(page.locator('#access-code-value')).toHaveText('CODE-TEST-1234');
        expect(envoi(page, 'POST', '/functions/v1/manage-users')[0].corps).toEqual({ action: 'create', email: 'recrue@alima.ngo', role: 'visitor', fullName: 'Nouvelle Recrue' });
        await page.click('#btn-close-access-code');
        await expect(page.locator('#access-code-value')).toHaveText('');
    });

    test('créer un compte sans e-mail : refusé avec un message', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click('#btn-open-create-account');
        await page.click('#btn-confirm-create-account');
        await expect(notification(page, "L'email et le rôle sont obligatoires.")).toBeVisible();
        expect(envoi(page, 'POST', '/functions/v1/manage-users')).toEqual([]);
    });

    test('création refusée par le serveur : message d\'erreur explicite', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes({ create: { status: 400, body: { error: 'Un compte existe déjà avec cet email.' } } }));
        await page.click('#btn-open-create-account');
        await page.fill('#input-new-email', 'reco@alima.ngo');
        await page.click('#btn-confirm-create-account');
        await expect(notification(page, 'Échec de la création : Un compte existe déjà avec cet email.')).toBeVisible();
        await expect(page.locator('#modal-create-account')).toBeVisible();
    });

    for (const [bouton, action, message] of [
        ['.btn-toggle-active', 'suspend', 'Compte suspendu.'],
        ['.btn-delete-account', 'delete', 'Compte supprimé avec succès.'],
    ]) {
        test(`${action} : confirmation, demande envoyée et message`, async ({ page }) => {
            await ouvrirPage(page, 'admin.html', gestionComptes());
            await page.click(`${bouton}[data-id="${ID_COMPTES.user}"]`);
            await page.click('#btn-confirm-confirm');
            await expect(notification(page, message)).toBeVisible();
            expect(envoi(page, 'POST', '/functions/v1/manage-users')[0].corps).toEqual({ action, userId: ID_COMPTES.user });
        });
    }

    test('réinitialiser un code : nouveau code affiché, demande envoyée une seule fois', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click(`#accounts-tbody .btn-reset-password[data-id="${ID_COMPTES.user}"]`);
        await page.click('#btn-confirm-confirm');
        await expect(page.locator('#access-code-value')).toHaveText('CODE-TEST-1234');
        await expect(notification(page, "Code d'accès réinitialisé avec succès.")).toBeVisible();
        expect(envoi(page, 'POST', '/functions/v1/manage-users')).toHaveLength(1);
    });

    test('action partiellement réussie : l\'avertissement du serveur est affiché', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes({ suspend: { success: true, warning: 'Sessions non révoquées.' } }));
        await page.click(`.btn-toggle-active[data-id="${ID_COMPTES.user}"]`);
        await page.click('#btn-confirm-confirm');
        await expect(notification(page, 'Sessions non révoquées.')).toBeVisible();
    });

    test('demande de nouveau code : affichée, puis ignorée', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await expect(page.locator('#access-requests-card')).toBeVisible();
        await expect(page.locator('#access-requests-list')).toContainText('reco@alima.ngo');
        await expect(page.locator('#access-requests-list')).toContainText('Recruteur Un');
        await page.click('.btn-dismiss-request');
        await page.click('#btn-confirm-confirm');
        await expect(notification(page, 'Demande ignorée.')).toBeVisible();
        expect(envoi(page, 'POST', '/rpc/dismiss_access_code_request')[0].corps).toEqual({ p_id: 'r1' });
        expect(ecrituresJournal(page)).toEqual([]);
    });
});

test.describe('Pools', () => {
    test('liste : pools actifs et archivés', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click('[data-tab="pools"]');
        await expect(page.locator('#pools-tbody tr')).toHaveCount(3);
        await expect(page.locator('#pools-tbody tr', { hasText: 'P9' })).toContainText('Archivé');
    });

    test('créer un pool : code en majuscules et demande complète', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click('[data-tab="pools"]');
        await page.click('#btn-open-create-pool');
        await page.fill('#input-pool-code', 'cosan');
        await page.fill('#input-pool-fullname', 'Coordination santé');
        await page.click('#btn-confirm-create-pool');
        await expect(notification(page, 'Pool créé avec succès.')).toBeVisible();
        expect(envoi(page, 'POST', '/rest/v1/pools')[0].corps).toMatchObject({ pool_id: 'COSAN', name: 'COSAN', full_name: 'Coordination santé', is_archived: false });
    });

    test('créer un pool dont le code existe déjà : message compréhensible', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', (requete) => {
            if (requete.chemin.endsWith('/rest/v1/pools') && requete.methode === 'POST') return erreurServeur('duplicate key value violates unique constraint "pools_pool_id_key"', '23505', 409);
            return gestionComptes()(requete);
        });
        await page.click('[data-tab="pools"]');
        await page.click('#btn-open-create-pool');
        await page.fill('#input-pool-code', 'P1');
        await page.fill('#input-pool-fullname', 'Doublon');
        await page.click('#btn-confirm-create-pool');
        await expect(notification(page, 'Un pool avec le code P1 existe déjà.')).toBeVisible();
        expect(envoi(page, 'POST', '/rest/v1/pools')).toHaveLength(1);
    });

    test('archiver un pool : confirmation et demande complète', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click('[data-tab="pools"]');
        await page.click('.btn-toggle-pool-archive[data-code="P2"]');
        await page.click('#btn-confirm-confirm');
        await expect(notification(page, 'Pool archivé.')).toBeVisible();
        const [maj] = envoi(page, 'PATCH', '/rest/v1/pools');
        expect(maj.parametres.id).toBe('eq.2');
        expect(maj.corps).toMatchObject({ is_archived: true, archived_by_name: 'admin@alima.ngo' });
    });

    test('archivage refusé sans erreur du serveur : l\'échec est signalé', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', (requete) => {
            if (requete.chemin.endsWith('/rest/v1/pools') && requete.methode === 'PATCH') return [];
            return gestionComptes()(requete);
        });
        await page.click('[data-tab="pools"]');
        await page.click('.btn-toggle-pool-archive[data-code="P2"]');
        await page.click('#btn-confirm-confirm');
        await expect(notification(page, "Le pool n'a pas été modifié")).toBeVisible();
        await expect(notification(page, 'Pool archivé.')).toHaveCount(0);
    });

    test('utilisation de chaque pool affichée, suppression proposée seulement pour un pool jamais utilisé', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click('[data-tab="pools"]');
        const ligne = (code) => page.locator('#pools-tbody tr', { has: page.locator('td:first-child', { hasText: new RegExp(`^${code}$`) }) });
        await expect(ligne('P1')).toContainText('Utilisé : 6 talents, 5 postes');
        await expect(ligne('P2')).toContainText("Présent dans l'historique des talents");
        await expect(ligne('P9')).toContainText('Jamais utilisé');
        await expect(page.locator('.btn-delete-pool')).toHaveCount(1);
        await expect(ligne('P9').locator('.btn-delete-pool')).toHaveAccessibleName('Supprimer le pool P9');
    });

    test('modifier un pool : fenêtre préremplie, code verrouillé, seuls les champs changés envoyés, journal laissé à la base', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click('[data-tab="pools"]');
        await page.click('.btn-edit-pool[data-id="2"]');
        await expect(page.locator('#modal-create-pool-title')).toHaveText('Modifier le pool P2');
        await expect(page.locator('#input-pool-code')).toHaveValue('P2');
        await expect(page.locator('#input-pool-code')).toBeDisabled();
        await expect(page.locator('#input-pool-code')).toHaveAccessibleDescription(/ne peut pas être modifié/);
        await expect(page.locator('#input-pool-fullname')).toHaveValue('Pool Deux');
        await expect(page.locator('#input-pool-fullname')).toBeFocused();
        await expect(page.locator('#pool-submit-label')).toHaveText('Enregistrer');
        const { violations } = await new AxeBuilder({ page }).include('#modal-create-pool').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => v.id)).toEqual([]);

        await page.fill('#input-pool-fullname', `Pool Deux corrigé ${PIEGE}`);
        await page.fill('#input-pool-description', 'Nouvelle description');
        await page.click('#btn-confirm-create-pool');
        await expect(notification(page, 'Pool modifié.')).toBeVisible();
        await expect(page.locator('#modal-create-pool')).toBeHidden();
        const [maj] = envoi(page, 'PATCH', '/rest/v1/pools');
        expect(maj.parametres.id).toBe('eq.2');
        expect(maj.corps).toEqual({ full_name: `Pool Deux corrigé ${PIEGE}`, description: 'Nouvelle description' });
        await expect(page.locator('#pools-tbody')).toContainText(`Pool Deux corrigé ${PIEGE}`);
        expect(await page.locator('#pools-tbody [data-xss]').count()).toBe(0);
        await expect(page.locator('.btn-edit-pool[data-id="2"]')).toBeFocused();
        expect(ecrituresJournal(page)).toEqual([]);
    });

    test('modifier puis recréer : la fenêtre de création revient vide et le code redevient saisissable', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click('[data-tab="pools"]');
        await page.click('.btn-edit-pool[data-id="2"]');
        await page.click('#btn-cancel-create-pool');
        await page.click('#btn-open-create-pool');
        await expect(page.locator('#modal-create-pool-title')).toHaveText('Nouveau pool');
        await expect(page.locator('#input-pool-code')).toBeEnabled();
        await expect(page.locator('#input-pool-code')).toHaveValue('');
        await expect(page.locator('#input-pool-code')).not.toHaveAttribute('aria-describedby');
        await expect(page.locator('#pool-code-locked-hint')).toBeHidden();
        await expect(page.locator('#pool-submit-label')).toHaveText('Créer le pool');
    });

    test('modifier sans rien changer : aucune demande ; nom vidé : refusé', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click('[data-tab="pools"]');
        await page.click('.btn-edit-pool[data-id="2"]');
        await page.click('#btn-confirm-create-pool');
        await expect(page.locator('#modal-create-pool')).toBeHidden();
        await page.click('.btn-edit-pool[data-id="2"]');
        await page.fill('#input-pool-fullname', '  ');
        await page.click('#btn-confirm-create-pool');
        await expect(notification(page, 'Le nom complet est obligatoire.')).toBeVisible();
        await expect(page.locator('#modal-create-pool')).toBeVisible();
        expect(envoi(page, 'PATCH', '/rest/v1/pools')).toEqual([]);
    });

    test('modification refusée sans erreur du serveur : l\'échec est signalé et la fenêtre reste ouverte', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', (requete) => {
            if (requete.chemin.endsWith('/rest/v1/pools') && requete.methode === 'PATCH') return [];
            return gestionComptes()(requete);
        });
        await page.click('[data-tab="pools"]');
        await page.click('.btn-edit-pool[data-id="2"]');
        await page.fill('#input-pool-fullname', 'Autre nom');
        await page.click('#btn-confirm-create-pool');
        await expect(notification(page, "Échec de la modification du pool : le pool n'a pas été modifié")).toBeVisible();
        await expect(page.locator('#modal-create-pool')).toBeVisible();
        await expect(notification(page, 'Pool modifié.')).toHaveCount(0);
    });

    test('supprimer un pool jamais utilisé : confirmation et suppression, journal laissé à la base', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click('[data-tab="pools"]');
        await page.click('.btn-delete-pool[data-code="P9"]');
        await expect(page.locator('#confirm-title')).toHaveText('Supprimer le pool P9');
        await page.click('#btn-confirm-confirm');
        await expect(notification(page, 'Pool supprimé.')).toBeVisible();
        expect(envoi(page, 'DELETE', '/rest/v1/pools')[0].parametres.id).toBe('eq.3');
        await expect(page.locator('#pools-tbody tr')).toHaveCount(2);
        await expect(page.locator('#btn-open-create-pool')).toBeFocused();
        expect(ecrituresJournal(page)).toEqual([]);
    });

    test('pool devenu utilisé entre-temps : la base refuse, message clair et bouton retiré', async ({ page }) => {
        let utilise = false;
        await ouvrirPage(page, 'admin.html', (requete) => {
            if (requete.chemin.endsWith('/rest/v1/pools') && requete.methode === 'DELETE') {
                utilise = true;
                return erreurServeur('update or delete on table "pools" violates foreign key constraint "talents_pool_fkey"', '23503', 409);
            }
            if (utilise && requete.chemin.endsWith('/rest/v1/missions') && requete.parametres.get('select') === 'pool') {
                return [{ pool: 'P9' }];
            }
            return gestionComptes()(requete);
        });
        await page.click('[data-tab="pools"]');
        await page.click('.btn-delete-pool[data-code="P9"]');
        await page.click('#btn-confirm-confirm');
        await expect(notification(page, 'le pool P9 est maintenant utilisé par des talents ou des postes. Archivez-le plutôt.')).toBeVisible();
        await expect(page.locator('.btn-delete-pool')).toHaveCount(0);
        await expect(page.locator('#pools-tbody tr', { hasText: 'P9' })).toContainText('Utilisé : 0 talent, 1 poste');
        expect(ecrituresJournal(page)).toEqual([]);
    });

    test('utilisation des pools illisible : aucune suppression proposée, le reste fonctionne', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', (requete) => {
            if (requete.chemin.endsWith('/rest/v1/pool_history')) return erreurServeur('permission denied', '42501', 403);
            return gestionComptes()(requete);
        });
        await page.click('[data-tab="pools"]');
        await expect(page.locator('#pools-tbody tr')).toHaveCount(3);
        await expect(page.locator('.btn-edit-pool')).toHaveCount(3);
        await expect(page.locator('.btn-delete-pool')).toHaveCount(0);
        await expect(page.locator('#pools-tbody')).not.toContainText('Jamais utilisé');
    });

    test('création et archivage de pool : aucune écriture du site dans le journal, tenu par la base', async ({ page }) => {
        await ouvrirPage(page, 'admin.html', gestionComptes());
        await page.click('[data-tab="pools"]');
        await page.click('#btn-open-create-pool');
        await page.fill('#input-pool-code', 'cosan');
        await page.fill('#input-pool-fullname', 'Coordination santé');
        await page.click('#btn-confirm-create-pool');
        await expect(notification(page, 'Pool créé avec succès.')).toBeVisible();
        await page.click('.btn-toggle-pool-archive[data-code="P2"]');
        await page.click('#btn-confirm-confirm');
        await expect(notification(page, 'Pool archivé.')).toBeVisible();
        await expect(page.locator('.btn-toggle-pool-archive[data-code="P2"]')).toBeFocused();
        expect(ecrituresJournal(page)).toEqual([]);
    });
});

test.describe('Import en masse', () => {
    test('modèles téléchargeables et lisibles par la page', async ({ page, request }) => {
        await ouvrirPage(page, 'import.html');
        for (const lien of await page.locator('a[href^="templates/"]').all()) {
            const reponse = await request.get(await lien.getAttribute('href'));
            expect(reponse.status()).toBe(200);
        }
    });

    test('talents : aperçu avec motifs de refus, puis import des seules lignes valides', async ({ page }) => {
        await ouvrirPage(page, 'import.html');
        await page.setInputFiles('#importFileInput', classeurDepuisModele('Cap_Huma_Modele_Import_Talents_VIERGE.xlsx', 'Modèle Import Talents', [
            { first_name: 'Ines', last_name: 'Dia', email: 'ines@exemple.org', pool: 'p1', status: 'En attente de poste', languages: 'Français, Anglais', has_visa: 'Oui' },
            { first_name: 'Jules', last_name: 'Kane', email: 'jules@exemple.org', pool: 'ZZ', status: 'En attente de poste' },
            { first_name: 'Awa', last_name: 'Bis', email: 'AWA@exemple.org', pool: 'P1', status: 'En attente de poste' },
            { first_name: 'Kofi', last_name: 'Mensah', email: 'pas-un-email', pool: 'P1', status: 'En attente de poste' },
        ]));
        await expect(page.locator('#fileStatusMsg')).toContainText('4 ligne(s) lue(s)');
        await expect(page.locator('#previewContent')).toContainText('Pool "ZZ" inconnu');
        await expect(page.locator('#previewContent')).toContainText('Un talent avec cet email existe déjà');
        await expect(page.locator('#previewContent')).toContainText('Email au format invalide');
        await expect(page.locator('#importSubmitBtn')).toHaveText(/Importer les 1 ligne\(s\) valide\(s\)/);
        await page.click('#importSubmitBtn');
        await expect(page.locator('#importResultBox')).toBeVisible();
        const [creation] = envoi(page, 'POST', '/rest/v1/talents');
        expect(creation.corps).toHaveLength(1);
        expect(creation.corps[0]).toMatchObject({ first_name: 'Ines', email: 'ines@exemple.org', pool: 'P1', languages: ['Français', 'Anglais'], has_visa: true, created_by: ID_COMPTES.admin });
        await expect.poll(() => journal(page)).toContainEqual(expect.objectContaining({ p_action: 'create', p_entity_type: 'talent', p_details: expect.stringContaining('1 talent(s) importé(s)') }));
    });

    test('fichier au mauvais format ou trop long : refusé avant tout envoi', async ({ page }) => {
        await ouvrirPage(page, 'import.html');
        await page.setInputFiles('#importFileInput', { name: 'talents.csv', mimeType: 'text/csv', buffer: Buffer.from('a;b') });
        await expect(page.locator('#fileStatusMsg')).toHaveText('Format non autorisé — seul .xlsx est accepté.');
        const lignes = Array.from({ length: 301 }, (_, i) => ({ first_name: 'P', last_name: `N${i}`, email: `p${i}@exemple.org`, pool: 'P1', status: 'En attente de poste' }));
        await page.setInputFiles('#importFileInput', classeurDepuisModele('Cap_Huma_Modele_Import_Talents_VIERGE.xlsx', 'Modèle Import Talents', lignes));
        await expect(page.locator('#fileStatusMsg')).toContainText('maximum 300');
        expect(envoi(page, 'POST', '/rest/v1/talents')).toEqual([]);
    });

    test('postes : un poste valide importé, toujours vacant ou en recrutement', async ({ page }) => {
        await ouvrirPage(page, 'import.html');
        await page.click('#tabBtnMissions');
        await page.setInputFiles('#importMissionFileInput', classeurDepuisModele('Cap_Huma_Modele_Import_Postes_VIERGE.xlsx', 'Modèle Import Postes', [
            { title: 'Chef de projet', pool: 'P1', pool_level: 'Projet', status: 'En recrutement', country: 'Mali', location: 'Mopti', project_name: 'Nutrition', candidate_type: 'Expatrié' },
            { title: 'Poste occupé', pool: 'P1', pool_level: 'Mission', status: 'Occupé', country: 'Mali', location: 'Bamako' },
        ]));
        await expect(page.locator('#previewContentMissions')).toContainText('Occupé');
        await page.click('#importMissionSubmitBtn');
        await expect(page.locator('#importMissionResultBox')).toBeVisible();
        const [creation] = envoi(page, 'POST', '/rest/v1/missions');
        expect(creation.corps).toHaveLength(1);
        expect(creation.corps[0]).toMatchObject({ title: 'Chef de projet', pool: 'P1', pool_level: 'project', status: 'recruiting', country_code: 'ML', location: 'Mopti', candidate_type: 'expat' });
    });
});

test.describe('Extraction Excel', () => {
    test('listes pros et postes du pool P1 : bonnes feuilles, bonnes lignes, export journalisé', async ({ page }) => {
        await ouvrirPage(page, 'extraction.html', undefined, { role: 'user' });
        await page.locator('#talentPoolsList .pool-row', { hasText: 'P1' }).click();
        await page.locator('#positionPoolsList .pool-row', { hasText: 'P1' }).click();
        const { nom, classeur } = await lireTelechargement(page, () => page.click('#generateBtn'));
        expect(nom).toMatch(/^extraction-cap-huma-\d{4}-\d{2}-\d{2}\.xlsx$/);
        expect(classeur.SheetNames).toEqual(['Listes pros (P1)', 'Postes P1']);
        const pros = XLSX.utils.sheet_to_json(classeur.Sheets['Listes pros (P1)']);
        expect(pros).toHaveLength(DONNEES.talents.filter(t => t.staff_type === 'expat' && t.pool === 'P1').length);
        expect(pros.find(l => l['Prénom'].startsWith('Eli'))['Liste rouge']).toBe('Oui');
        const postes = XLSX.utils.sheet_to_json(classeur.Sheets['Postes P1']);
        expect(postes.find(l => l['Titre'] === 'Référente nutrition Niger')).toMatchObject({ 'Rôle': 'Occupant actuel', 'Email talent': 'awa@exemple.org', 'Pays': 'Niger' });
        await expect(page.locator('#exportStatus')).toContainText('Fichier Excel généré');
        await expect.poll(() => journal(page).map(j => j.p_action)).toContain('export');
    });

    test('un texte qui ressemble à une formule reste du texte dans le fichier', async ({ page }) => {
        await ouvrirPage(page, 'extraction.html', (requete) => {
            if (requete.chemin === '/functions/v1/sensitive-reads') {
                return { success: true, missions: [], talents: [{ id: 't', first_name: '=HYPERLINK("http://exemple.org","clic")', last_name: '+1+1', pool: 'P1', staff_type: 'expat', email: '@SUM(A1)' }] };
            }
        }, { role: 'user' });
        await page.locator('#talentPoolsList .pool-row', { hasText: 'P1' }).click();
        const { classeur } = await lireTelechargement(page, () => page.click('#generateBtn'));
        const feuille = classeur.Sheets[classeur.SheetNames[0]];
        const cellules = Object.keys(feuille).filter(k => !k.startsWith('!')).map(k => feuille[k]);
        expect(cellules.filter(c => c.f)).toEqual([]);
        expect(cellules.map(c => c.v)).toContain('=HYPERLINK("http://exemple.org","clic")');
    });
});

test.describe('Statistiques', () => {
    const IA = (texte) => (requete) => {
        if (requete.chemin === '/functions/v1/ai-proxy') return { analysis: texte };
    };

    test('indicateurs globaux puis d\'un pool', async ({ page }) => {
        await ouvrirPage(page, 'statistics.html', undefined, { role: 'user' });
        await expect(page.locator('#kpi-occupancy-sub')).toHaveText('3 de 5 postes occupés');
        await expect(page.locator('#kpi-vacancies')).toHaveText('1');
        await expect(page.locator('#kpi-talents-active')).not.toHaveText('0');
        await page.selectOption('#pool-selector', 'P2');
        await expect(page.locator('#kpi-occupancy-sub')).toHaveText('0 de 0 postes occupés');
        await expect(page.locator('#kpi-talents-active')).toHaveText('0');
    });

    test('analyse IA globale : aucune donnée nominative envoyée, réponse affichée sans code actif', async ({ page }) => {
        await ouvrirPage(page, 'statistics.html', IA('## Synthèse\n**Point clé** : <img src=x data-xss="1"> pool stable\n- Recommandation'), { role: 'user' });
        await page.fill('#ai-prompt-input', 'Quels risques ?');
        await page.click('#ai-generate-btn');
        await expect(page.locator('#ai-result-content')).toContainText('Point clé');
        await expect(page.locator('#ai-result-content h3')).toHaveText('Synthèse');
        expect(await page.locator('#ai-result-content [data-xss]').count()).toBe(0);
        const envoye = JSON.stringify(envoi(page, 'POST', '/functions/v1/ai-proxy')[0].corps);
        for (const t of DONNEES.talents) {
            expect(envoye).not.toContain(t.last_name.split(' ')[0]);
            if (t.email) expect(envoye).not.toContain(t.email);
        }
        expect(envoye).toContain('Quels risques ?');
    });

    test('analyse IA d\'un pool : réponse affichée', async ({ page }) => {
        await ouvrirPage(page, 'statistics.html', IA('## Analyse du pool\nTout va bien'), { role: 'user' });
        await page.selectOption('#pool-selector', 'P1');
        await page.click('#pool-ai-analysis-btn');
        await expect(page.locator('#pool-ai-analysis-content')).toContainText('Tout va bien');
    });

    test('analyse IA en panne : message d\'erreur', async ({ page }) => {
        await ouvrirPage(page, 'statistics.html', (requete) => {
            if (requete.chemin === '/functions/v1/ai-proxy') return { status: 503, body: { error: 'Service IA indisponible' } };
        }, { role: 'user' });
        await page.click('#ai-generate-btn');
        await expect(notification(page, "Échec de la communication avec l'IA : Service IA indisponible")).toBeVisible();
    });
});

test.describe('Journal d\'audit', () => {
    test('compteurs, tableau et auteur « Système »', async ({ page }) => {
        await ouvrirPage(page, 'audit_logs.html');
        await expect(page.locator('#statTotal')).toHaveText('2');
        await expect(page.locator('#logsTableBody tr')).toHaveCount(2);
        await expect(page.locator('#logsTableBody')).toContainText('Système');
        await expect(page.locator('#tableCountLabel')).toHaveText('2 actions correspondant aux filtres');
    });

    test('filtres transmis au serveur et bouton de réinitialisation', async ({ page }) => {
        await ouvrirPage(page, 'audit_logs.html');
        await page.selectOption('#filterAction', 'delete');
        await page.selectOption('#filterPeriod', 'week');
        await expect(page.locator('#resetFiltersBtn')).toBeVisible();
        const derniere = () => envoi(page, 'POST', '/functions/v1/sensitive-reads').filter(e => e.corps.resource === 'audit_logs').at(-1).corps;
        await expect.poll(() => {
            const { action, gte } = derniere().filters;
            return action === 'delete' && Date.now() - new Date(gte).getTime() > 6.9 * 864e5;
        }).toBe(true);
        await page.fill('#filterExactDate', '2026-09-01');
        await expect(page.locator('#filterPeriod')).toBeDisabled();
        await expect.poll(() => derniere().filters.lte).toBeTruthy();
        await page.click('#resetFiltersBtn');
        await expect.poll(() => derniere().filters).toEqual({});
    });

    test('pagination : 120 actions sur 3 pages', async ({ page }) => {
        await ouvrirPage(page, 'audit_logs.html', (requete) => {
            if (requete.chemin === '/functions/v1/sensitive-reads') {
                const { page: numero } = JSON.parse(requete.corps);
                return { success: true, data: [{ id: `l${numero}`, action: 'update', entity_type: 'talent', entity_name: `Page${numero}`, created_at: new Date().toISOString() }], count: 120, page: numero, totalPages: 3 };
            }
        });
        await expect(page.locator('#logsPaginationLabel')).toHaveText('Page 1 sur 3');
        await page.click('#logsNextPageBtn');
        await expect(page.locator('#logsTableBody')).toContainText('Page2');
        await expect(page.locator('#logsPaginationLabel')).toHaveText('Page 2 sur 3');
    });

    test('export Excel du journal filtré, lui-même journalisé', async ({ page }) => {
        await ouvrirPage(page, 'audit_logs.html');
        await expect(page.locator('#logsTableBody tr')).toHaveCount(2);
        const { nom, classeur } = await lireTelechargement(page, () => page.click('#exportBtn'));
        expect(nom).toMatch(/^logs_audit_.*\.xlsx$/);
        const lignes = XLSX.utils.sheet_to_json(classeur.Sheets["Logs d'audit"]);
        expect(lignes).toHaveLength(2);
        expect(lignes.map(l => l['Utilisateur'])).toContain('Système');
        await expect.poll(() => journal(page).map(j => j.p_action)).toContain('export');
    });
});

test.describe('Guide', () => {
    test('les questions fréquentes s\'ouvrent et se referment', async ({ page }) => {
        await ouvrirPage(page, 'guide.html', undefined, { role: 'user' });
        const faq = page.locator('#guideRecruteur details', { hasText: 'Questions fréquentes' });
        await faq.locator('summary').click();
        await expect(faq).toHaveAttribute('open', '');
        await expect(faq).toContainText('Mot de passe oublié');
        await faq.locator('summary').click();
        await expect(faq).not.toHaveAttribute('open', '');
    });
});
