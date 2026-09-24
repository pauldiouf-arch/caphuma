const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const RACINE = path.join(__dirname, '..');
const SCRIPTS = ['shared/caphuma-config.js', 'shared/caphuma-utils.js', 'shared/caphuma-countries.js', 'shared/caphuma-form-draft.js', 'shared/caphuma-export-i18n.js'];

test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'ordinateur', 'règles indépendantes de l\'écran');
    await page.route('**/__regles__.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body></body></html>' }));
    await page.goto('__regles__.html');
    for (const script of SCRIPTS) await page.addScriptTag({ url: script });
});

const ilYaMois = (mois) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - mois);
    return d.toISOString().slice(0, 10);
};

test.describe('Affichage sûr du texte', () => {
    test('escapeHtml neutralise les caractères du HTML', async ({ page }) => {
        const r = await page.evaluate(() => [escapeHtml('<b a="1" b=\'2\'>&</b>'), escapeHtml(null), escapeHtml(undefined), escapeHtml(0)]);
        expect(r).toEqual(['&lt;b a=&quot;1&quot; b=&#039;2&#039;&gt;&amp;&lt;/b&gt;', '', '', '0']);
    });

    test('capHumaStripControlChars retire les caractères invisibles et les espaces autour', async ({ page }) => {
        const r = await page.evaluate(() => [capHumaStripControlChars('  a\u0000b\u0007c\td\n  '), capHumaStripControlChars(42)]);
        expect(r).toEqual(['abc\td', 42]);
    });
});

test.describe('Validité dans le pool (24 mois)', () => {
    test('les seuils valent 20, 22 et 24 mois', async ({ page }) => {
        expect(await page.evaluate(() => [DEVALIDATION_AT_RISK_MONTHS, DEVALIDATION_CRITICAL_MONTHS, DEVALIDATION_MAX_MONTHS])).toEqual([20, 22, 24]);
    });

    test('mois sans mission : compteur gelé en poste ALIMA, sinon calculé depuis la dernière date connue', async ({ page }) => {
        const dates = { six: ilYaMois(6), trente: ilYaMois(30) };
        const r = await page.evaluate((d) => [
            calculateMonthsWithoutMission({ status: 'En poste ALIMA', months_without_mission: 5, last_mission_end_date: d.trente }),
            calculateMonthsWithoutMission({ status: 'En attente de poste', is_currently_on_mission: true, months_without_mission: 3 }),
            calculateMonthsWithoutMission({ status: 'En attente de poste', last_mission_end_date: d.six }),
            calculateMonthsWithoutMission({ status: 'En attente de poste', pool_integration_date: d.trente }),
            calculateMonthsWithoutMission({ status: 'En attente de poste' }),
            calculateMonthsWithoutMission({ status: 'En attente de poste', last_mission_end_date: '2999-01-01' }),
        ], dates);
        expect(r).toEqual([5, 3, 6, 30, 0, 0]);
    });

    test('état de validité : progression, mois restants, plafond et talent dévalidé', async ({ page }) => {
        const d = { douze: ilYaMois(12), trente: ilYaMois(30) };
        const r = await page.evaluate((d) => {
            const garder = (s) => ({ isInvalid: s.isInvalid, isPaused: s.isPaused, totalMonths: s.totalMonths, cappedMonths: s.cappedMonths, progressPercent: s.progressPercent, remainingMonths: s.remainingMonths, refLabel: s.refLabel });
            return [
                garder(capHumaGetValidityStatus({ status: 'En attente de poste', last_mission_end_date: d.douze })),
                garder(capHumaGetValidityStatus({ status: 'En attente de poste', pool_integration_date: d.trente })),
                garder(capHumaGetValidityStatus({ is_valid: false, status: 'En attente de poste' })),
                garder(capHumaGetValidityStatus({ status: 'En poste ALIMA', months_without_mission: 0 })),
            ];
        }, d);
        expect(r[0]).toEqual({ isInvalid: false, isPaused: false, totalMonths: 12, cappedMonths: 12, progressPercent: 50, remainingMonths: 12, refLabel: 'Fin dernière mission' });
        expect(r[1]).toEqual({ isInvalid: false, isPaused: false, totalMonths: 30, cappedMonths: 24, progressPercent: 100, remainingMonths: 0, refLabel: 'Intégration pool' });
        expect(r[2]).toMatchObject({ isInvalid: true, isPaused: false, totalMonths: 24, progressPercent: 100, remainingMonths: 0 });
        expect(r[3]).toMatchObject({ isInvalid: false, isPaused: true, totalMonths: 0 });
    });
});

test.describe('Formats et pays', () => {
    test('durées d\'expérience en français et en anglais', async ({ page }) => {
        const r = await page.evaluate(() => [0, 1, 12, 13, 25, 'x'].map(m => capHumaFormatExpDuration(m, 'fr')).concat([13, 24].map(m => capHumaFormatExpDuration(m, 'en'))));
        expect(r).toEqual(['0 ans 0 mois', '0 ans 1 mois', '1 an 0 mois', '1 an 1 mois', '2 ans 1 mois', '0 ans 0 mois', '1 yr 1 mo', '2 yrs 0 mo']);
    });

    test('pays et nationalités : noms, langues et recherche sans accents', async ({ page }) => {
        const r = await page.evaluate(() => [
            CapHumaCountries.getCountryName('ML'), CapHumaCountries.getCountryName('ML', 'en'), CapHumaCountries.getNationality('SN'),
            CapHumaCountries.getCountryName('ZZ'), CapHumaCountries.findCodeByText(' senegal '), CapHumaCountries.findCodeByText('Malienne'),
            CapHumaCountries.findCodeByText('Atlantide'), CapHumaCountries.findCodeByText(''),
            CapHumaCountries.getPassageCountry({ countryCode: 'NE' }), CapHumaCountries.getPassageCountry({ country: 'Texte libre' }),
            CapHumaCountries.getAll().length > 190,
        ]);
        expect(r).toEqual(['Mali', 'Mali', 'sénégalaise', null, 'SN', 'ML', null, null, 'Niger', 'Texte libre', true]);
    });

    test('pagination : libellés et boutons désactivés aux extrémités', async ({ page }) => {
        const r = await page.evaluate(() => {
            const zone = document.createElement('div');
            zone.innerHTML = renderPaginationControls(1, 3, 45);
            const debut = { texte: zone.textContent.replace(/\s+/g, ' ').trim(), prec: zone.querySelector('[data-page-nav="prev"]').disabled, suiv: zone.querySelector('[data-page-nav="next"]').disabled };
            zone.innerHTML = renderPaginationControls(3, 3, 1);
            return [debut, { texte: zone.textContent.replace(/\s+/g, ' ').trim(), prec: zone.querySelector('[data-page-nav="prev"]').disabled, suiv: zone.querySelector('[data-page-nav="next"]').disabled }];
        });
        expect(r[0]).toEqual({ texte: '45 résultats ◀ Précédent Page 1 / 3 Suivant ▶', prec: true, suiv: false });
        expect(r[1]).toEqual({ texte: '1 résultat ◀ Précédent Page 3 / 3 Suivant ▶', prec: false, suiv: true });
    });
});

test.describe('Lecture des données', () => {
    test('lecture par pages : tout est lu au-delà de 1000 lignes, en 3 appels pour 2500 lignes', async ({ page }) => {
        const r = await page.evaluate(async () => {
            const toutes = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
            let appels = 0;
            const requete = () => ({ range: async (de, a) => { appels++; return { data: toutes.slice(de, a + 1), error: null, count: toutes.length }; } });
            const { data, error } = await capHumaSelectAllPages(requete);
            return { lignes: data.length, uniques: new Set(data.map(x => x.id)).size, appels, error };
        });
        expect(r).toEqual({ lignes: 2500, uniques: 2500, appels: 3, error: null });
    });

    test('lecture par pages : une erreur est renvoyée telle quelle, sans données partielles', async ({ page }) => {
        const r = await page.evaluate(async () => {
            let appels = 0;
            const requete = () => ({ range: async () => (++appels === 1 ? { data: [{ id: 1 }], error: null, count: 5 } : { data: null, error: { message: 'refus' } }) });
            return await capHumaSelectAllPages(requete, 1);
        });
        expect(r).toEqual({ data: null, error: { message: 'refus' } });
    });

    test('nouvel essai uniquement sur une panne réseau, jamais sur un refus du serveur', async ({ page }) => {
        const r = await page.evaluate(async () => {
            let reseau = 0;
            const apresPanne = await capHumaWithRetry(async () => { if (++reseau === 1) throw new Error('réseau'); return 'ok'; }, { delayMs: 1 });
            let refus = 0;
            const refuse = await capHumaWithRetry(async () => { refus++; return { error: { message: 'refus' } }; }, { delayMs: 1 });
            let toujours = 0;
            let message = null;
            try { await capHumaWithRetry(async () => { toujours++; throw new Error('toujours'); }, { delayMs: 1 }); } catch (e) { message = e.message; }
            return { apresPanne, reseau, refuse: refuse.error.message, refus, toujours, message };
        });
        expect(r).toEqual({ apresPanne: 'ok', reseau: 2, refuse: 'refus', refus: 1, toujours: 2, message: 'toujours' });
    });
});

test.describe('Brouillons et messages', () => {
    test('brouillon : enregistrement, relecture, suppression, et nettoyage des seuls brouillons', async ({ page }) => {
        const r = await page.evaluate(() => {
            capHumaDraftSave('draft:talent:1', { nom: 'Awa' });
            capHumaDraftSave('draft:poste:2', { titre: 'X' });
            sessionStorage.setItem('autre', 'garder');
            const lu = capHumaDraftLoad('draft:talent:1');
            capHumaDraftClear('draft:talent:1');
            const apresSuppression = capHumaDraftLoad('draft:talent:1');
            sessionStorage.setItem('draft:casse', '{pas du json');
            const casse = capHumaDraftLoad('draft:casse');
            capHumaDraftClearAll();
            return { lu, apresSuppression, casse, restants: Object.keys(sessionStorage).sort() };
        });
        expect(r).toEqual({ lu: { nom: 'Awa' }, apresSuppression: null, casse: null, restants: ['autre'] });
    });

    test('notifications : les erreurs sont annoncées tout de suite et restent plus longtemps', async ({ page }) => {
        const r = await page.evaluate(() => {
            toastMessage('Enregistré.');
            toastMessage('Échec.', 'error');
            const [ok, ko] = document.querySelectorAll('div.fixed.bottom-5');
            return { ok: [ok.getAttribute('role'), ok.getAttribute('aria-live'), ok.className.includes('bg-green-600')], ko: [ko.getAttribute('role'), ko.getAttribute('aria-live'), ko.className.includes('bg-red-600')] };
        });
        expect(r).toEqual({ ok: ['status', 'polite', true], ko: ['alert', 'assertive', true] });
        await expect(page.getByText('Enregistré.')).toBeHidden({ timeout: 5000 });
        await expect(page.getByText('Échec.')).toBeVisible();
        await expect(page.getByText('Échec.')).toBeHidden({ timeout: 8000 });
    });
});

test.describe('Liens entre les pages', () => {
    test('chaque lien vers une page du site mène à un fichier existant', async () => {
        const fichiers = [
            ...fs.readdirSync(RACINE).filter(f => f.endsWith('.html')),
            ...fs.readdirSync(path.join(RACINE, 'pages')).map(f => `pages/${f}`),
            ...fs.readdirSync(path.join(RACINE, 'shared')).filter(f => f.endsWith('.js')).map(f => `shared/${f}`),
        ];
        const manquants = [];
        for (const fichier of fichiers) {
            const contenu = fs.readFileSync(path.join(RACINE, fichier), 'utf8');
            for (const [, cible] of contenu.matchAll(/["'`(=}/]([a-z_-]+\.html)(?:[?#"'`)]|\$\{)/g)) {
                if (!fs.existsSync(path.join(RACINE, cible))) manquants.push(`${fichier} → ${cible}`);
            }
            for (const [, cible] of contenu.matchAll(/(?:src|href)="((?:shared|pages)\/[^"?#]+)"/g)) {
                if (!fs.existsSync(path.join(RACINE, cible))) manquants.push(`${fichier} → ${cible}`);
            }
            for (const [, cible] of contenu.matchAll(/capHumaLoadScriptOnce\('([^']+)'\)/g)) {
                if (!fs.existsSync(path.join(RACINE, cible))) manquants.push(`${fichier} → ${cible}`);
            }
        }
        expect(manquants).toEqual([]);
    });
});
