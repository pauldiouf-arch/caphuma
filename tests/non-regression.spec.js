const { test, expect } = require('@playwright/test');
const { ouvrirPage, SUPABASE_URL } = require('./simulateur-supabase');

const PAGES = [
    'admin.html', 'audit_logs.html', 'dashboard.html', 'devalidated.html', 'extraction.html', 'guide.html', 'id-card.html',
    'import.html', 'index.html', 'login.html', 'missions.html', 'red_list.html', 'shared-talent.html', 'statistics.html', 'talents.html',
];

test.describe('Police et sécurité des pages', () => {
    for (const nom of PAGES) {
        test(`${nom} : police Inter chargée depuis le site, sans appel externe ni blocage de sécurité`, async ({ page }) => {
            const externes = [];
            const blocages = [];
            page.on('request', (requete) => {
                const url = requete.url();
                if (!url.startsWith('http://localhost') && !url.startsWith(SUPABASE_URL)) externes.push(url);
            });
            page.on('console', (message) => {
                if (/Content Security Policy|Refused to/.test(message.text())) blocages.push(message.text());
            });
            await page.route(`${SUPABASE_URL}/**`, (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
            await page.goto(nom);
            await page.evaluate(() => document.fonts.load('600 16px Inter', 'Aïssatou Łukasz'));
            const policeChargee = await page.evaluate(() => document.fonts.check('600 16px Inter', 'Aïssatou Łukasz'));
            expect(policeChargee, 'police Inter chargée').toBe(true);
            expect(externes, 'appels vers un autre site').toEqual([]);
            expect(blocages, 'blocages de la politique de sécurité').toEqual([]);
        });
    }
});

test.describe('Export PDF', () => {
    test('le PDF de la fiche talent se génère', async ({ page }) => {
        const talent = {
            id: '11111111-1111-1111-1111-111111111111', first_name: 'Aïssatou', last_name: 'Łukasz', email: 'a@exemple.org', pool: 'P1',
            staff_type: 'expat', status: 'En attente de poste', is_valid: true, is_red_listed: false, key_skills: ['Coordination'],
            languages: ['Français'], archived_position_passages: [{ positionTitle: 'Coordinateur', startDate: '2020-01-01', endDate: '2021-01-01', comments: [{ context: 'Contexte', rating: 8 }] }],
        };
        await ouvrirPage(page, `id-card.html?id=${talent.id}`, (requete) => {
            if (requete.chemin.endsWith('/rest/v1/talents')) return [talent];
        });
        const [telechargement] = await Promise.all([page.waitForEvent('download'), page.click('#pdf-btn')]);
        expect(telechargement.suggestedFilename()).toMatch(/^talent-.*\.pdf$/);
        const chemin = await telechargement.path();
        const contenu = require('fs').readFileSync(chemin);
        expect(contenu.subarray(0, 5).toString()).toBe('%PDF-');
        expect(contenu.length).toBeGreaterThan(2000);
        await expect(page.locator('div.fixed.bottom-5.bg-red-600')).toHaveCount(0);
    });
});
