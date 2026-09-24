const { test, expect } = require('@playwright/test');
const { ouvrirPage, attendreMessageLisible, attendreNotificationErreur, erreurServeur } = require('./simulateur-supabase');

const ID_TALENT = '11111111-1111-1111-1111-111111111111';
const ID_REMPLACANT = '44444444-4444-4444-4444-444444444444';
const ID_POSTE = '33333333-3333-3333-3333-333333333333';

const TALENT = {
    id: ID_TALENT, first_name: 'Awa', last_name: 'Diallo', email: 'awa@exemple.org', pool: 'P1', staff_type: 'expat',
    status: 'En attente de poste', is_valid: true, is_red_listed: false, nationality_code: 'ML',
};
const STAFF_NATIONAL = { ...TALENT, staff_type: 'national', status: 'En poste ALIMA', tracking_pool: 'P1' };
const REMPLACANT = { ...STAFF_NATIONAL, id: ID_REMPLACANT, first_name: 'Binta' };
const TALENT_DEVALIDE = { ...TALENT, is_valid: false, devalidation_date: '2026-01-01' };
const POSTE_NATIONAL = {
    id: ID_POSTE, title: 'Coordinateur national', pool: 'P1', pool_level: 'mission', status: 'occupied', occupant_id: ID_TALENT,
    candidate_type: 'nat', country_code: 'ML', location: 'Bamako', contract_end_type: 'date',
    contract_start_date: '2026-01-01', contract_end_date: '2026-12-31',
};

const EMAIL_EN_DOUBLE = erreurServeur('duplicate key value violates unique constraint "talents_email_unique"', '23505', 409);
const LISTE_POSTES_CHANGEE = erreurServeur("La liste des postes a changé depuis l'ouverture de la page. Rechargez la page puis recommencez.", 'P0001', 400);

const fin = (requete, table) => requete.chemin.endsWith('/rest/v1/' + table);
const rpc = (requete, nom) => requete.chemin.endsWith('/rest/v1/rpc/' + nom);

test.describe('Talents', () => {
    const reponses = (requete) => {
        if (fin(requete, 'talents')) return requete.methode === 'GET' ? [TALENT] : EMAIL_EN_DOUBLE;
    };

    test('création avec un e-mail déjà utilisé : message lisible', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', reponses);
        await page.click('#newTalentBtn');
        await page.fill('[name="first_name"]', 'Nouveau');
        await page.fill('[name="last_name"]', 'Talent');
        await page.fill('[name="email"]', 'AWA@exemple.org');
        await page.click('#saveTalentBtn');
        await attendreMessageLisible(page, '#talentModal #formError', 'Un autre talent utilise déjà cet e-mail.');
    });

    test('modification avec un e-mail déjà utilisé : message lisible', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', reponses);
        await page.evaluate((talent) => TalentsPage.openEditModal(talent), TALENT);
        await page.click('#saveTalentBtn');
        await attendreMessageLisible(page, '#talentModal #formError', 'Un autre talent utilise déjà cet e-mail.');
    });

    test('champs obligatoires vides : message lisible', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', reponses);
        await page.click('#newTalentBtn');
        await page.click('#saveTalentBtn');
        await attendreMessageLisible(page, '#talentModal #formError', 'Merci de remplir au minimum Prénom, Nom et Statut');
    });

    test('création réussie : la fenêtre se ferme', async ({ page }) => {
        await ouvrirPage(page, 'talents.html?pool=P1', (requete) => {
            if (fin(requete, 'talents')) return requete.methode === 'GET' ? [TALENT] : { status: 201, body: null };
        });
        await page.click('#newTalentBtn');
        await page.fill('[name="first_name"]', 'Nouveau');
        await page.fill('[name="last_name"]', 'Talent');
        await page.click('#saveTalentBtn');
        await expect(page.locator('#talentModal')).toBeHidden();
        expect(page.envois).toContain('POST /rest/v1/talents');
    });
});

test.describe('Postes', () => {
    const reponses = (enregistrement) => (requete) => {
        if (fin(requete, 'missions')) return [POSTE_NATIONAL];
        if (fin(requete, 'talents')) return [STAFF_NATIONAL, REMPLACANT];
        if (fin(requete, 'evaluations')) return [];
        if (rpc(requete, 'save_mission')) return enregistrement;
    };

    test('poste occupé, « la liste des postes a changé » : message lisible', async ({ page }) => {
        await ouvrirPage(page, 'missions.html?pool=P1', reponses(LISTE_POSTES_CHANGEE));
        await page.click(`.editMissionBtn[data-id="${ID_POSTE}"]`);
        await page.click('#saveMissionBtn');
        await attendreMessageLisible(page, '#formError', 'La liste des postes a changé');
    });

    test('nouveau poste, « la liste des postes a changé » : message lisible', async ({ page }) => {
        await ouvrirPage(page, 'missions.html?pool=P1', reponses(LISTE_POSTES_CHANGEE));
        await page.click('#createMissionBtn');
        await page.fill('#fieldTitle', 'Poste test');
        await page.selectOption('#fieldCountry', 'ML');
        await page.fill('#fieldLocation', 'Bamako');
        await page.click('#saveMissionBtn');
        await attendreMessageLisible(page, '#formError', 'La liste des postes a changé');
    });

    test('enregistrement réussi : la fenêtre se ferme', async ({ page }) => {
        await ouvrirPage(page, 'missions.html?pool=P1', reponses(ID_POSTE));
        await page.click(`.editMissionBtn[data-id="${ID_POSTE}"]`);
        await page.click('#saveMissionBtn');
        await expect(page.locator('#missionModal')).toBeHidden();
        await expect(page.locator('div.fixed.bottom-5', { hasText: 'Poste mis à jour.' })).toBeVisible();
    });

    test('talents du pool non chargés : notification, message et enregistrement bloqué', async ({ page }) => {
        await ouvrirPage(page, 'missions.html?pool=P1', (requete) => {
            if (fin(requete, 'missions')) return [POSTE_NATIONAL];
            if (fin(requete, 'talents')) return erreurServeur();
            if (rpc(requete, 'save_mission')) return ID_POSTE;
        });
        await attendreNotificationErreur(page, 'Liste des talents du pool non chargée');
        await page.click(`.editMissionBtn[data-id="${ID_POSTE}"]`);
        await attendreMessageLisible(page, '#formError', "La liste des talents du pool n'a pas pu être chargée");
        await page.click('#saveMissionBtn');
        await attendreMessageLisible(page, '#formError', "La liste des talents du pool n'a pas pu être chargée");
        expect(page.envois).not.toContain('POST /rest/v1/rpc/save_mission');
    });

    const detachementsIntrouvables = (requete) => {
        if (fin(requete, 'missions') && requete.parametres.get('candidate_type') === 'eq.detache') return erreurServeur();
        return reponses(ID_POSTE)(requete);
    };

    test('détachements introuvables au changement d\'occupant : avertissement', async ({ page }) => {
        await ouvrirPage(page, 'missions.html?pool=P1', detachementsIntrouvables);
        await page.click(`.editMissionBtn[data-id="${ID_POSTE}"]`);
        await page.selectOption('#fieldOccupant', ID_REMPLACANT);
        await page.click('#saveMissionBtn');
        await expect.poll(() => page.dialogues.join(' ')).toContain('Impossible de vérifier si Awa Diallo occupe aussi un détachement');
    });

    test('détachements introuvables à la suppression : avertissement', async ({ page }) => {
        await ouvrirPage(page, 'missions.html?pool=P1', detachementsIntrouvables);
        await page.click(`.deleteMissionBtn[data-id="${ID_POSTE}"]`);
        await expect.poll(() => page.dialogues.join(' ')).toContain('Impossible de vérifier si Awa Diallo occupe aussi un détachement');
    });
});

test.describe('Évaluations', () => {
    const reponses = (requete) => {
        if (fin(requete, 'missions')) return [POSTE_NATIONAL];
        if (fin(requete, 'talents')) return [STAFF_NATIONAL];
        if (fin(requete, 'evaluations')) return requete.methode === 'GET' ? [] : erreurServeur();
    };

    test('échec de l\'enregistrement : message lisible', async ({ page }) => {
        await ouvrirPage(page, 'missions.html?pool=P1', reponses);
        await page.click(`.evaluationsBtn[data-id="${ID_POSTE}"]`);
        await page.fill('#fieldContext', 'Contexte');
        await page.fill('#fieldRating', '7');
        await page.click('#saveEvaluationBtn');
        await attendreMessageLisible(page, '#evaluationFormError', 'erreur simulée du serveur');
    });

    test('contexte et note vides : le navigateur bloque l\'envoi', async ({ page }) => {
        await ouvrirPage(page, 'missions.html?pool=P1', reponses);
        await page.click(`.evaluationsBtn[data-id="${ID_POSTE}"]`);
        await page.click('#saveEvaluationBtn');
        await expect(page.locator('#fieldContext')).toHaveJSProperty('validity.valueMissing', true);
        expect(page.envois).not.toContain('POST /rest/v1/evaluations');
    });
});

test.describe('Dévalidés', () => {
    const reponses = (requete) => {
        if (fin(requete, 'talents')) return requete.methode === 'GET' ? [TALENT_DEVALIDE] : erreurServeur();
    };

    test('Liste Rouge sans motif : message lisible', async ({ page }) => {
        await ouvrirPage(page, 'devalidated.html', reponses);
        await page.click('.btn-redlist');
        await page.click('#redListModalConfirm');
        await attendreMessageLisible(page, '#redListModalError', 'Le motif est obligatoire.');
    });

    test('Liste Rouge refusée par le serveur : message lisible', async ({ page }) => {
        await ouvrirPage(page, 'devalidated.html', reponses);
        await page.click('.btn-redlist');
        await page.fill('#redListReasonInput', 'Motif de test');
        await page.click('#redListModalConfirm');
        await attendreMessageLisible(page, '#redListModalError', 'erreur simulée du serveur');
    });
});

test.describe('Fiche talent', () => {
    const reponses = (talent) => (requete) => {
        if (fin(requete, 'talents')) return [talent];
        if (rpc(requete, 'change_talent_pool') || rpc(requete, 'promote_national_to_expat')) return erreurServeur();
    };

    test('changement de pool sans pool choisi : message lisible', async ({ page }) => {
        await ouvrirPage(page, `id-card.html?id=${ID_TALENT}`, reponses(TALENT));
        await page.click('#btn-change-pool');
        await page.selectOption('#modal-pool-select', '');
        await page.click('#modal-pool-confirm');
        await attendreMessageLisible(page, '#pool-change-error', 'Veuillez choisir un pool de destination.');
    });

    test('changement de pool refusé : message lisible', async ({ page }) => {
        await ouvrirPage(page, `id-card.html?id=${ID_TALENT}`, reponses(TALENT));
        await page.click('#btn-change-pool');
        await page.selectOption('#modal-pool-select', 'P2');
        await page.click('#modal-pool-confirm');
        await attendreMessageLisible(page, '#pool-change-error', 'Échec du changement de pool');
    });

    test('passage en expat sans pool choisi : message lisible', async ({ page }) => {
        await ouvrirPage(page, `id-card.html?id=${ID_TALENT}`, reponses(STAFF_NATIONAL));
        await page.click('#btn-promote-to-expat');
        await page.selectOption('#modal-promote-pool-select', '');
        await page.click('#modal-promote-confirm');
        await attendreMessageLisible(page, '#promote-error', "Veuillez choisir un pool d'intégration.");
    });

    test('passage en expat refusé : message lisible', async ({ page }) => {
        await ouvrirPage(page, `id-card.html?id=${ID_TALENT}`, reponses(STAFF_NATIONAL));
        await page.click('#btn-promote-to-expat');
        await page.selectOption('#modal-promote-pool-select', 'P2');
        await page.click('#modal-promote-confirm');
        await attendreMessageLisible(page, '#promote-error', 'Échec du passage en expat');
    });
});

test.describe('Statistiques', () => {
    test('analyse IA d\'un pool impossible : message lisible', async ({ page }) => {
        await ouvrirPage(page, 'statistics.html', (requete) => {
            if (requete.chemin.endsWith('/functions/v1/ai-proxy')) return erreurServeur('service IA indisponible');
            if (requete.chemin.endsWith('/functions/v1/sensitive-reads')) return { success: true, talents: [TALENT], missions: [POSTE_NATIONAL] };
            if (fin(requete, 'talents')) return [TALENT];
            if (fin(requete, 'missions')) return [POSTE_NATIONAL];
        });
        await page.selectOption('#pool-selector', 'P1');
        await page.click('#pool-ai-analysis-btn');
        await attendreMessageLisible(page, '#pool-ai-analysis-error', "Impossible de générer l'analyse");
    });
});

test.describe('Liste Rouge', () => {
    test('talents du pool non chargés dans la fenêtre d\'ajout : notification', async ({ page }) => {
        await ouvrirPage(page, 'red_list.html', (requete) => {
            if (fin(requete, 'talents') && requete.parametres.get('pool')) return erreurServeur();
            if (requete.chemin.endsWith('/functions/v1/sensitive-reads')) return { success: true, data: [], count: 0, page: 1, totalPages: 1 };
        });
        await page.locator('#btn-header-add-redlist:visible, #btn-empty-add-redlist:visible').first().click();
        await page.selectOption('#modal-select-pool', 'P1');
        await attendreNotificationErreur(page, 'Impossible de charger les talents de ce pool');
    });
});

test.describe('Import', () => {
    const fichier = { name: 'import.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK') };

    for (const [description, table] of [['pools', 'pools'], ['e-mails existants', 'talents']]) {
        test(`${description} non chargés : le fichier n'est pas lu et un message l'explique`, async ({ page }) => {
            await ouvrirPage(page, 'import.html', (requete) => {
                if (fin(requete, table)) return erreurServeur();
            });
            await page.setInputFiles('#importFileInput', fichier);
            await attendreMessageLisible(page, '#fileStatusMsg', "n'a pas pu être chargée : rechargez la page avant d'importer");
        });
    }

    test('pools non chargés, import de postes : message', async ({ page }) => {
        await ouvrirPage(page, 'import.html', (requete) => {
            if (fin(requete, 'pools')) return erreurServeur();
        });
        await page.click('#tabBtnMissions');
        await page.setInputFiles('#importMissionFileInput', fichier);
        await attendreMessageLisible(page, '#fileStatusMsgMissions', "La liste des pools n'a pas pu être chargée");
    });
});

test.describe('Tableau de bord', () => {
    const reponses = (enPanne) => (requete) => {
        if (enPanne && rpc(requete, enPanne)) return erreurServeur();
        if (rpc(requete, 'get_pool_talent_stats')) return [{ pool_id: 'P1', active: 12, available: 4, at_risk: 1 }, { pool_id: 'P2', active: 3, available: 1, at_risk: 0 }];
        if (rpc(requete, 'get_pool_mission_counts')) return [{ pool_id: 'P1', positions: 7 }, { pool_id: 'P2', positions: 2 }];
    };
    const chiffres = (page) => page.locator('#poolsGrid .grid p.text-base').first().locator('xpath=../..').locator('p.text-base');

    test('cas normal : chiffres affichés, pas de message', async ({ page }) => {
        await ouvrirPage(page, 'dashboard.html', reponses(null));
        await expect(chiffres(page)).toHaveText(['12', '4', '1', '7']);
        await expect(page.locator('#poolsError')).toBeHidden();
    });

    test('chiffres des talents non chargés : « — » et message', async ({ page }) => {
        await ouvrirPage(page, 'dashboard.html', reponses('get_pool_talent_stats'));
        await expect(chiffres(page)).toHaveText(['—', '—', '—', '7']);
        await attendreMessageLisible(page, '#poolsError', "Certains chiffres des pools n'ont pas pu être chargés");
    });

    test('nombre de postes non chargé : « — » et message', async ({ page }) => {
        await ouvrirPage(page, 'dashboard.html', reponses('get_pool_mission_counts'));
        await expect(chiffres(page)).toHaveText(['12', '4', '1', '—']);
        await attendreMessageLisible(page, '#poolsError', "Certains chiffres des pools n'ont pas pu être chargés");
    });
});
