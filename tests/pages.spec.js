const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { ouvrirPage } = require('./simulateur-supabase');
const { ID } = require('./donnees');

const TOUS = ['admin', 'user', 'visitor'];
const LIBELLES = { admin: 'admin', user: 'recruteur', visitor: 'visiteur' };

const contenu = (visibles = [], masques = []) => ({ type: 'contenu', visibles, masques });
const refus = (selecteur, puisRenvoi = null) => ({ type: 'refus', selecteur, puisRenvoi });
const renvoi = (vers) => ({ type: 'renvoi', vers });

const PAGES = [
    { nom: 'Tableau de bord', chemin: 'dashboard.html', attendu: {
        admin: contenu(['#adminNavGroup', '#notifBellBtn', '#navRedList']),
        user: contenu(['#notifBellBtn', '#navRedList', '#navDevalidated', '#navExtraction'], ['#adminNavGroup']),
        visitor: contenu([], ['#adminNavGroup', '#notifBellBtn', '#navRedList', '#navDevalidated', '#navExtraction']),
    } },
    { nom: 'Talents du pool', chemin: 'talents.html?pool=P1', attendu: {
        admin: contenu(['#newTalentBtn', '.edit-btn >> nth=0']),
        user: contenu(['#newTalentBtn', '.edit-btn >> nth=0']),
        visitor: contenu([], ['#newTalentBtn', '.edit-btn']),
    } },
    { nom: 'Fiche talent', chemin: `id-card.html?id=${ID.expat}`, attendu: {
        admin: contenu(['#share-btn', '#btn-redlist', '#btn-change-pool', '#btn-delete-talent']),
        user: contenu(['#share-btn', '#btn-redlist', '#btn-change-pool'], ['#btn-delete-talent']),
        visitor: contenu([], ['#share-btn', '#btn-redlist', '#btn-change-pool', '#btn-delete-talent', '#btn-devalidate', '#btn-add-comment']),
    } },
    { nom: 'Postes du pool', chemin: 'missions.html?pool=P1', attendu: {
        admin: contenu(['#createMissionBtn', '.editMissionBtn >> nth=0'], ['#readOnlyNotice']),
        user: contenu(['#createMissionBtn', '.editMissionBtn >> nth=0'], ['#readOnlyNotice']),
        visitor: contenu(['#readOnlyNotice'], ['#createMissionBtn', '.editMissionBtn']),
    } },
    { nom: 'Dévalidés', chemin: 'devalidated.html', attendu: {
        admin: contenu(), user: contenu(), visitor: renvoi(/dashboard\.html/),
    } },
    { nom: 'Liste Rouge', chemin: 'red_list.html', attendu: {
        admin: contenu(['#redlist-content']), user: contenu(['#redlist-content']), visitor: refus('#access-denied-banner', /dashboard\.html/),
    } },
    { nom: 'Extraction', chemin: 'extraction.html', attendu: {
        admin: contenu(), user: contenu(), visitor: renvoi(/dashboard\.html/),
    } },
    { nom: 'Statistiques', chemin: 'statistics.html', attendu: {
        admin: contenu(['#aiStrategicHub'], ['#aiVisitorNotice']),
        user: contenu(['#aiStrategicHub'], ['#aiVisitorNotice']),
        visitor: contenu(['#aiVisitorNotice'], ['#aiStrategicHub']),
    } },
    { nom: 'Comptes', chemin: 'admin.html', attendu: {
        admin: contenu(['#admin-content']), user: refus('#access-denied-banner', /dashboard\.html/), visitor: refus('#access-denied-banner', /dashboard\.html/),
    } },
    { nom: 'Import', chemin: 'import.html', attendu: {
        admin: contenu(['#pageContent']), user: refus('#accessDeniedBanner'), visitor: refus('#accessDeniedBanner'),
    } },
    { nom: 'Journal d\'audit', chemin: 'audit_logs.html', attendu: {
        admin: contenu(), user: renvoi(/dashboard\.html/), visitor: renvoi(/dashboard\.html/),
    } },
    { nom: 'Guide', chemin: 'guide.html', attendu: {
        admin: contenu(['#guideAdmin'], ['#guideRecruteur', '#guideVisitor']),
        user: contenu(['#guideRecruteur'], ['#guideAdmin', '#guideVisitor']),
        visitor: contenu(['#guideVisitor'], ['#guideAdmin', '#guideRecruteur']),
    } },
];

const PAGES_PROTEGEES = ['index.html', ...PAGES.map(p => p.chemin)];

async function controlesCommuns(page, testInfo) {
    await page.waitForLoadState('networkidle');
    expect(page.erreursPage, 'erreurs JavaScript dans la page').toEqual([]);
    expect(await page.locator('[data-xss]').count(), 'texte piégé interprété comme du code').toBe(0);
    const ecran = page.viewportSize().width;
    const contenu = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(contenu, 'défilement horizontal').toBeLessThanOrEqual(ecran + 1);
    await verifierAccessibilite(page, testInfo);
}

async function verifierAccessibilite(page, testInfo) {
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const decrire = (v) => `${v.id} (${v.impact}) : ${v.help} — ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}${v.nodes.length > 3 ? ` (+${v.nodes.length - 3})` : ''}`;
    const graves = violations.filter(v => ['critical', 'serious'].includes(v.impact));
    for (const v of violations.filter(x => !graves.includes(x))) {
        testInfo.annotations.push({ type: 'accessibilité (non bloquant)', description: decrire(v) });
    }
    expect(graves.map(decrire), 'problèmes d\'accessibilité graves').toEqual([]);
}

for (const definition of PAGES) {
    test.describe(definition.nom, () => {
        for (const role of TOUS) {
            const attendu = definition.attendu[role];
            test(`${LIBELLES[role]} : affichage, droits, sécurité, accessibilité`, async ({ page }, testInfo) => {
                await ouvrirPage(page, definition.chemin, undefined, { role, attendre: attendu.type !== 'renvoi' });
                if (attendu.type === 'renvoi') {
                    await expect(page).toHaveURL(attendu.vers);
                    return;
                }
                if (attendu.type === 'refus') {
                    await expect(page.locator(attendu.selecteur)).toBeVisible();
                    if (attendu.puisRenvoi) {
                        expect(await page.locator('[data-xss]').count(), 'texte piégé interprété comme du code').toBe(0);
                        await expect(page).toHaveURL(attendu.puisRenvoi, { timeout: 10000 });
                        return;
                    }
                } else {
                    for (const selecteur of attendu.visibles) await expect(page.locator(selecteur), `${selecteur} visible`).toBeVisible();
                    for (const selecteur of attendu.masques) await expect(page.locator(selecteur).first(), `${selecteur} caché`).toBeHidden();
                }
                await controlesCommuns(page, testInfo);
            });
        }
    });
}

test.describe('Lien de partage public', () => {
    test('profil partagé : affichage, sécurité, accessibilité', async ({ page }, testInfo) => {
        await ouvrirPage(page, 'shared-talent.html?token=st_jeton-de-test-actif', undefined, { connecte: false, attendre: false });
        await expect(page.locator('#talent-card')).toBeVisible();
        await controlesCommuns(page, testInfo);
    });
});

test.describe('Connexion', () => {
    test('page de connexion : affichage, sécurité, accessibilité', async ({ page }, testInfo) => {
        await ouvrirPage(page, 'login.html', undefined, { connecte: false, attendre: false });
        await expect(page.locator('#loginEmail')).toBeVisible();
        await controlesCommuns(page, testInfo);
    });

    for (const chemin of PAGES_PROTEGEES) {
        test(`sans session, ${chemin} renvoie vers la connexion`, async ({ page }) => {
            await ouvrirPage(page, chemin, undefined, { connecte: false, attendre: false });
            await expect(page).toHaveURL(/login\.html/);
            await expect(page.locator('#loginEmail')).toBeVisible();
        });
    }

    test('compte suspendu : renvoyé vers la connexion, aucune donnée affichée', async ({ page }) => {
        await ouvrirPage(page, 'dashboard.html', undefined, { role: 'user', actif: false, attendre: false });
        await expect(page).toHaveURL(/login\.html/);
        await expect(page.locator('#loginEmail')).toBeVisible();
    });
});
