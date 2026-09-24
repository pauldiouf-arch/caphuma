const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');

const config = fs.readFileSync(path.join(__dirname, '..', 'shared', 'caphuma-config.js'), 'utf8');
const SUPABASE_URL = config.match(/SUPABASE_URL\s*=\s*["']([^"']+)["']/)[1];
const CLE_SESSION = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const ID_COMPTE = '00000000-0000-0000-0000-0000000000a1';

const base64url = (objet) => Buffer.from(JSON.stringify(objet)).toString('base64url');
const JETON = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: ID_COMPTE, role: 'authenticated', exp: 4102444800 })}.signature`;
const SESSION = {
    access_token: JETON, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
    user: { id: ID_COMPTE, email: 'admin@alima.ngo', aud: 'authenticated', role: 'authenticated' },
};

const POOLS = [
    { id: 1, pool_id: 'P1', name: 'P1', full_name: 'Pool Un', level: 'mission', is_archived: false },
    { id: 2, pool_id: 'P2', name: 'P2', full_name: 'Pool Deux', level: 'mission', is_archived: false },
];

const erreurServeur = (message = 'erreur simulée du serveur', code = 'XX000', status = 500) =>
    ({ status, body: { code, message, details: null, hint: null } });

function reponsesParDefaut(requete) {
    if (requete.chemin.endsWith('/rest/v1/users')) return [{ role: 'admin', name: 'Admin Test', is_active: true }];
    if (requete.chemin.endsWith('/rest/v1/pools')) return POOLS;
    return [];
}

async function ouvrirPage(page, chemin, reponses = () => undefined) {
    const envois = [];
    const dialogues = [];
    page.envois = envois;
    page.dialogues = dialogues;

    page.on('dialog', async (dialogue) => {
        dialogues.push(dialogue.message());
        await dialogue.accept();
    });

    await page.addInitScript(([cle, session]) => {
        localStorage.setItem(cle, session);
    }, [CLE_SESSION, JSON.stringify(SESSION)]);

    await page.route(`${SUPABASE_URL}/**`, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const requete = { methode: req.method(), chemin: url.pathname, parametres: url.searchParams, corps: req.postData() };
        if (requete.methode !== 'GET' && requete.methode !== 'OPTIONS') envois.push(`${requete.methode} ${requete.chemin}`);

        let reponse = reponses(requete);
        if (reponse === undefined) reponse = reponsesParDefaut(requete);

        const entetes = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
        if (reponse && reponse.status) {
            return route.fulfill({ status: reponse.status, contentType: 'application/json', headers: entetes, body: JSON.stringify(reponse.body) });
        }

        const objetSeul = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
        let donnees = reponse;
        if (Array.isArray(donnees) && Number(url.searchParams.get('offset') || 0) > 0) donnees = [];
        if (objetSeul && Array.isArray(donnees)) donnees = donnees[0] ?? null;
        const total = Array.isArray(donnees) ? donnees.length : 1;
        return route.fulfill({
            status: 200, contentType: 'application/json',
            headers: { ...entetes, 'content-range': `0-${Math.max(0, total - 1)}/${total}` },
            body: JSON.stringify(donnees),
        });
    });

    await page.goto(chemin);
    await expect(page.locator('#appBody')).toBeVisible();
}

async function attendreMessageLisible(page, selecteur, texte) {
    const message = page.locator(selecteur);
    await expect(message).toBeVisible();
    await expect(message).toContainText(texte);
    await expect(message).toBeInViewport({ ratio: 1 });
}

async function attendreNotificationErreur(page, texte) {
    await expect(page.locator('div.fixed.bottom-5.bg-red-600', { hasText: texte })).toBeVisible();
}

module.exports = { ouvrirPage, attendreMessageLisible, attendreNotificationErreur, erreurServeur, SUPABASE_URL };
