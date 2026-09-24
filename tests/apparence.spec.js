const { test, expect } = require('@playwright/test');
const { ouvrirPage } = require('./simulateur-supabase');
const { ID } = require('./donnees');

const LARGEURS = [390, 1024, 1366, 1920];

const ECRANS = [
    { nom: 'tableau-de-bord-admin', chemin: 'dashboard.html', role: 'admin' },
    { nom: 'tableau-de-bord-recruteur', chemin: 'dashboard.html', role: 'user' },
    { nom: 'tableau-de-bord-visiteur', chemin: 'dashboard.html', role: 'visitor' },
    { nom: 'talents', chemin: 'talents.html?pool=P1', role: 'user' },
    { nom: 'fiche-talent-admin', chemin: `id-card.html?id=${ID.aRisque}`, role: 'admin' },
    { nom: 'fiche-talent-visiteur', chemin: `id-card.html?id=${ID.aRisque}`, role: 'visitor' },
    { nom: 'postes', chemin: 'missions.html?pool=P1', role: 'user' },
    { nom: 'connexion', chemin: 'login.html', public: true },
    { nom: 'lien-public', chemin: 'shared-talent.html?token=st_jeton-de-test-actif', public: true },
];

const VARIABLE = [/\d{2}\/\d{2}\/\d{4}/, /depuis \d+ mois/, /\d+ jours?/];

test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'ordinateur', 'les largeurs d\'écran sont fixées par le test');
});

for (const ecran of ECRANS) {
    for (const largeur of LARGEURS) {
        test(`${ecran.nom} en ${largeur} px : présentation identique à la référence`, async ({ page }) => {
            await page.setViewportSize({ width: largeur, height: 900 });
            await ouvrirPage(page, ecran.chemin, undefined, { role: ecran.role || 'admin', connecte: !ecran.public, attendre: !ecran.public });
            await page.waitForLoadState('networkidle');
            await page.mouse.move(0, 0);
            await expect(page).toHaveScreenshot(`${ecran.nom}-${largeur}.png`, {
                animations: 'disabled',
                caret: 'hide',
                mask: VARIABLE.map(motif => page.getByText(motif)),
                maxDiffPixelRatio: 0.01,
                threshold: 0.2,
            });
        });
    }
}
