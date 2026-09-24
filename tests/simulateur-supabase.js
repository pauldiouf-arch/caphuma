const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { DONNEES, ID_COMPTES } = require('./donnees');

const config = fs.readFileSync(path.join(__dirname, '..', 'shared', 'caphuma-config.js'), 'utf8');
const SUPABASE_URL = config.match(/SUPABASE_URL\s*=\s*["']([^"']+)["']/)[1];
const CLE_SESSION = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

const base64url = (objet) => Buffer.from(JSON.stringify(objet)).toString('base64url');

function sessionPour(role) {
    const id = ID_COMPTES[role];
    const utilisateur = DONNEES.users.find(u => u.id === id);
    const jeton = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: id, role: 'authenticated', exp: 4102444800 })}.signature`;
    return {
        access_token: jeton, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
        user: { id, email: utilisateur.email, aud: 'authenticated', role: 'authenticated' },
    };
}

const erreurServeur = (message = 'erreur simulée du serveur', code = 'XX000', status = 500) =>
    ({ status, body: { code, message, details: null, hint: null } });

function filtrer(lignes, parametres) {
    let resultat = lignes;
    for (const [colonne, valeur] of parametres.entries()) {
        if (['select', 'order', 'offset', 'limit', 'or', 'and', 'on_conflict', 'columns'].includes(colonne)) continue;
        const [operateur, ...reste] = valeur.split('.');
        const attendu = reste.join('.');
        const texte = (ligne) => (ligne[colonne] === null || ligne[colonne] === undefined ? null : String(ligne[colonne]));
        if (operateur === 'eq') resultat = resultat.filter(l => texte(l) === attendu);
        else if (operateur === 'neq') resultat = resultat.filter(l => texte(l) !== attendu);
        else if (operateur === 'is' && attendu === 'null') resultat = resultat.filter(l => texte(l) === null);
        else if (operateur === 'not' && attendu === 'is.null') resultat = resultat.filter(l => texte(l) !== null);
        else if (operateur === 'in') {
            const liste = attendu.replace(/^\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, ''));
            resultat = resultat.filter(l => liste.includes(texte(l)));
        }
    }
    return resultat;
}

function reponsesParDefaut(requete, role, actif) {
    const table = requete.chemin.replace(/^\/rest\/v1\//, '');
    if (requete.chemin.startsWith('/auth/v1/')) return requete.chemin.endsWith('/user') ? sessionPour(role).user : {};
    if (table === 'users' && requete.parametres.get('id') === `eq.${ID_COMPTES[role]}`) {
        const u = DONNEES.users.find(x => x.id === ID_COMPTES[role]);
        return [{ role: u.role, name: u.name, is_active: actif }];
    }
    if (requete.chemin === '/functions/v1/sensitive-reads') {
        const demande = JSON.parse(requete.corps || '{}');
        if (demande.resource === 'red_list') {
            const liste = DONNEES.talents.filter(t => t.is_red_listed);
            return { success: true, data: liste, count: liste.length, page: 1, totalPages: 1 };
        }
        if (demande.resource === 'extraction') {
            return { success: true, talents: DONNEES.talents.filter(t => t.staff_type === 'expat'), missions: DONNEES.missions };
        }
        if (demande.resource === 'audit_logs') {
            return { success: true, data: DONNEES.audit_logs, count: DONNEES.audit_logs.length, page: 1, totalPages: 1 };
        }
    }
    if (table === 'rpc/get_pool_talent_stats') return DONNEES.stats_talents;
    if (table === 'rpc/get_pool_mission_counts') return DONNEES.stats_postes;
    if (table === 'rpc/get_notification_alerts') return DONNEES.alertes;
    if (table === 'rpc/get_shared_talent') return DONNEES.talent_partage;
    if (table.startsWith('rpc/')) return null;
    if (DONNEES[table] && requete.methode === 'GET') return filtrer(DONNEES[table], requete.parametres);
    if (DONNEES[table] && requete.methode === 'HEAD') return filtrer(DONNEES[table], requete.parametres);
    return [];
}

async function ouvrirPage(page, chemin, reponses = () => undefined, { role = 'admin', actif = true, connecte = true, attendre = true } = {}) {
    const envois = [];
    const dialogues = [];
    const erreursPage = [];
    page.envois = envois;
    page.dialogues = dialogues;
    page.erreursPage = erreursPage;

    page.on('pageerror', (erreur) => erreursPage.push(erreur.message));
    page.on('dialog', async (dialogue) => {
        dialogues.push(dialogue.message());
        if (dialogue.type() === 'prompt') await dialogue.dismiss(); else await dialogue.accept();
    });

    if (connecte) {
        await page.addInitScript(([cle, session]) => {
            if (!sessionStorage.getItem('caphuma-test-init')) {
                localStorage.setItem(cle, session);
                sessionStorage.setItem('caphuma-test-init', '1');
            }
        }, [CLE_SESSION, JSON.stringify(sessionPour(role))]);
    }

    await page.route(`${SUPABASE_URL}/**`, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const requete = { methode: req.method(), chemin: url.pathname, parametres: url.searchParams, corps: req.postData() };
        const entetes = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
        if (requete.methode === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...entetes, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        if (requete.methode !== 'GET' && requete.methode !== 'HEAD') envois.push(`${requete.methode} ${requete.chemin}`);

        let reponse = await reponses(requete);
        if (reponse === undefined) reponse = reponsesParDefaut(requete, role, actif);

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
            body: requete.methode === 'HEAD' ? '' : JSON.stringify(donnees),
        });
    });

    await page.goto(chemin);
    if (attendre) await expect(page.locator('#appBody')).toBeVisible();
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

module.exports = { ouvrirPage, attendreMessageLisible, attendreNotificationErreur, erreurServeur, SUPABASE_URL, CLE_SESSION };
