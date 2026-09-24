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

function condition(ligne, colonne, expression) {
    const [operateur, ...reste] = expression.split('.');
    const attendu = reste.join('.');
    const valeur = ligne[colonne] === null || ligne[colonne] === undefined ? null : String(ligne[colonne]);
    if (operateur === 'eq') return valeur === attendu;
    if (operateur === 'neq') return valeur !== attendu;
    if (operateur === 'is') return attendu === 'null' ? valeur === null : valeur === attendu;
    if (operateur === 'not') return !condition(ligne, colonne, attendu);
    if (operateur === 'in') return attendu.replace(/^\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, '')).includes(valeur);
    if (operateur === 'gte') return valeur !== null && valeur >= attendu;
    if (operateur === 'lte') return valeur !== null && valeur <= attendu;
    if (operateur === 'gt') return valeur !== null && valeur > attendu;
    if (operateur === 'lt') return valeur !== null && valeur < attendu;
    if (operateur === 'ilike') return valeur !== null && new RegExp('^' + attendu.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*') + '$', 'i').test(valeur);
    return true;
}

function filtrer(lignes, parametres) {
    let resultat = lignes;
    for (const [colonne, valeur] of parametres.entries()) {
        if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(colonne)) continue;
        if (colonne === 'or') {
            const alternatives = valeur.replace(/^\(|\)$/g, '').split(',').map(a => {
                const point = a.indexOf('.');
                return [a.slice(0, point), a.slice(point + 1)];
            });
            resultat = resultat.filter(l => alternatives.some(([c, e]) => condition(l, c, e)));
        } else {
            resultat = resultat.filter(l => condition(l, colonne, valeur));
        }
    }
    return resultat;
}

function trier(lignes, ordre) {
    if (!ordre) return lignes;
    const criteres = ordre.split(',').map(c => {
        const [colonne, sens, nulls] = c.split('.');
        return { colonne, desc: sens === 'desc', nullsFirst: nulls === 'nullsfirst' };
    });
    return [...lignes].sort((a, b) => {
        for (const { colonne, desc } of criteres) {
            const x = a[colonne], y = b[colonne];
            if (x === y) continue;
            if (x === null || x === undefined) return desc ? -1 : 1;
            if (y === null || y === undefined) return desc ? 1 : -1;
            const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
            return desc ? -cmp : cmp;
        }
        return 0;
    });
}

const lireJson = (texte) => { try { return texte ? JSON.parse(texte) : null; } catch { return texte; } };

let compteur = 0;
const nouvelId = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

function reponsesParDefaut(requete, role, actif, base) {
    const table = requete.chemin.replace(/^\/rest\/v1\//, '');
    if (requete.chemin === '/auth/v1/token') {
        const { email } = lireJson(requete.corps) || {};
        const compte = base.users.find(u => u.email === email);
        if (!compte) return { status: 400, body: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } };
        return sessionPour(Object.keys(ID_COMPTES).find(r => ID_COMPTES[r] === compte.id));
    }
    if (requete.chemin.startsWith('/storage/v1/object/')) {
        const reste = requete.chemin.replace('/storage/v1/object/', '');
        if (reste.startsWith('sign/')) return { signedURL: `/object/${reste}?token=lien-temporaire` };
        if (requete.methode === 'POST' || requete.methode === 'PUT') {
            base.stockage.push(reste);
            return { Key: reste, Id: nouvelId() };
        }
        if (requete.methode === 'DELETE') {
            const { prefixes = [] } = lireJson(requete.corps) || {};
            const seau = reste.replace(/\/$/, '');
            base.stockage = base.stockage.filter(chemin => !prefixes.includes(chemin.slice(seau.length + 1)));
            return prefixes.map(name => ({ name }));
        }
    }
    if (requete.chemin.startsWith('/auth/v1/')) return requete.chemin.endsWith('/user') ? sessionPour(role).user : {};
    if (table === 'users' && requete.parametres.get('id') === `eq.${ID_COMPTES[role]}`) {
        const u = base.users.find(x => x.id === ID_COMPTES[role]);
        return [{ role: u.role, name: u.name, is_active: actif }];
    }
    if (requete.chemin === '/functions/v1/sensitive-reads') {
        const demande = lireJson(requete.corps) || {};
        if (demande.resource === 'red_list') {
            const liste = base.talents.filter(t => t.is_red_listed);
            return { success: true, data: liste, count: liste.length, page: 1, totalPages: 1 };
        }
        if (demande.resource === 'extraction') {
            return { success: true, talents: base.talents.filter(t => t.staff_type === 'expat'), missions: base.missions };
        }
        if (demande.resource === 'audit_logs') {
            return { success: true, data: base.audit_logs, count: base.audit_logs.length, page: 1, totalPages: 1 };
        }
    }
    if (table === 'rpc/get_pool_talent_stats') return base.stats_talents;
    if (table === 'rpc/get_pool_mission_counts') return base.stats_postes;
    if (table === 'rpc/get_notification_alerts') return base.alertes;
    if (table === 'rpc/get_shared_talent') return base.talent_partage;
    if (table.startsWith('rpc/')) return null;
    if (!base[table]) return [];
    if (requete.methode === 'GET' || requete.methode === 'HEAD') return filtrer(base[table], requete.parametres);
    if (requete.methode === 'POST') {
        const corps = lireJson(requete.corps) || [];
        const lignes = (Array.isArray(corps) ? corps : [corps]).map(l => ({ id: nouvelId(), created_at: new Date().toISOString(), ...l }));
        base[table].push(...lignes);
        return lignes;
    }
    if (requete.methode === 'PATCH') {
        const changement = lireJson(requete.corps) || {};
        const cibles = filtrer(base[table], requete.parametres);
        cibles.forEach(l => Object.assign(l, changement));
        return cibles;
    }
    if (requete.methode === 'DELETE') {
        const cibles = filtrer(base[table], requete.parametres);
        base[table] = base[table].filter(l => !cibles.includes(l));
        return cibles;
    }
    return [];
}

async function ouvrirPage(page, chemin, reponses = () => undefined, { role = 'admin', actif = true, connecte = true, attendre = true } = {}) {
    const envois = [];
    const dialogues = [];
    const erreursPage = [];
    page.envois = envois;
    page.dialogues = dialogues;
    page.erreursPage = erreursPage;
    const base = structuredClone(DONNEES);
    base.stockage = [];
    page.base = base;

    page.on('pageerror', (erreur) => erreursPage.push(erreur.message));
    page.on('dialog', async (dialogue) => {
        dialogues.push([dialogue.message(), dialogue.defaultValue()].filter(Boolean).join(' '));
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
        if (requete.methode !== 'GET' && requete.methode !== 'HEAD') {
            envois.push(`${requete.methode} ${requete.chemin}`);
            page.corpsEnvoyes = page.corpsEnvoyes || [];
            page.corpsEnvoyes.push({ methode: requete.methode, chemin: requete.chemin, parametres: Object.fromEntries(url.searchParams), corps: lireJson(requete.corps) });
        }

        let reponse = await reponses(requete);
        if (reponse === undefined) reponse = reponsesParDefaut(requete, role, actif, base);

        if (reponse && reponse.status) {
            return route.fulfill({ status: reponse.status, contentType: 'application/json', headers: entetes, body: JSON.stringify(reponse.body) });
        }

        const objetSeul = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
        let donnees = reponse;
        let debut = 0;
        let total = Array.isArray(donnees) ? donnees.length : 1;
        if (Array.isArray(donnees) && requete.methode === 'GET') {
            donnees = trier(donnees, url.searchParams.get('order'));
            debut = Number(url.searchParams.get('offset') || 0);
            const limite = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 1000;
            total = donnees.length;
            donnees = donnees.slice(debut, debut + Math.min(limite, 1000));
        }
        if (objetSeul && Array.isArray(donnees)) donnees = donnees[0] ?? null;
        const recus = Array.isArray(donnees) ? donnees.length : 1;
        return route.fulfill({
            status: 200, contentType: 'application/json',
            headers: { ...entetes, 'content-range': `${recus ? `${debut}-${debut + recus - 1}` : '*'}/${total}` },
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
