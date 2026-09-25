const { test, expect } = require('@playwright/test');
const { ouvrirPage, erreurServeur } = require('./simulateur-supabase');
const { ID, ID_COMPTES } = require('./donnees');

const envoi = (page, methode, fin) => (page.corpsEnvoyes || []).filter(e => e.methode === methode && e.chemin.endsWith(fin));
const notification = (page, texte) => page.locator('div.fixed.bottom-5', { hasText: texte });
const carte = (page, id) => page.locator(`#missionsGrid > div:has([data-id="${id}"])`);
const POSTES = 'missions.html?pool=P1';

test.describe('Postes', () => {
    test('liste : cartes, occupants et indicateurs', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'user' });
        await expect(page.locator('#kpiTotal')).toHaveText('5');
        await expect(page.locator('#kpiOccupied')).toHaveText('3');
        await expect(page.locator('#kpiRecruiting')).toHaveText('1');
        await expect(page.locator('#kpiVacant')).toHaveText('1');
        await expect(carte(page, ID.posteAwa)).toContainText('Awa');
        await expect(carte(page, ID.posteNational)).toContainText('Cheick Traoré');
        await expect(carte(page, ID.posteAwa)).toContainText('Niamey');
    });

    test('créer un poste vacant : demande complète et fenêtre fermée', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'user' });
        await page.click('#createMissionBtn');
        await page.fill('#fieldTitle', 'Pharmacien');
        await page.selectOption('#fieldCountry', 'TD');
        await page.fill('#fieldLocation', "N'Djamena");
        await page.selectOption('#fieldCandidateType', 'expat');
        await page.click('#saveMissionBtn');
        await expect(notification(page, 'Poste créé.')).toBeVisible();
        await expect(page.locator('#missionModal')).toBeHidden();
        const [demande] = envoi(page, 'POST', '/rpc/save_mission');
        expect(demande.corps.p_mission_id).toBeNull();
        expect(demande.corps.p_vacate_mission_id).toBeNull();
        expect(demande.corps.p_payload).toMatchObject({ title: 'Pharmacien', pool: 'P1', status: 'vacant', country_code: 'TD', location: "N'Djamena", candidate_type: 'expat', is_expat: true, occupant_id: null });
    });

    test('champs obligatoires vides : rien n\'est envoyé', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'user' });
        await page.click('#createMissionBtn');
        await page.click('#saveMissionBtn');
        await expect(page.locator('#missionModal')).toBeVisible();
        expect(envoi(page, 'POST', '/rpc/save_mission')).toEqual([]);
    });

    test('modifier un poste occupé : les valeurs existantes sont reprises', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'user' });
        await carte(page, ID.posteAwa).locator('.editMissionBtn').click();
        await expect(page.locator('#fieldTitle')).toHaveValue('Référente nutrition Niger');
        await expect(page.locator('#fieldOccupant')).toHaveValue(ID.expat);
        await page.fill('#fieldLocation', 'Maradi');
        await page.click('#saveMissionBtn');
        await expect(notification(page, 'Poste mis à jour.')).toBeVisible();
        const [demande] = envoi(page, 'POST', '/rpc/save_mission');
        expect(demande.corps.p_mission_id).toBe(ID.posteAwa);
        expect(demande.corps.p_payload).toMatchObject({ location: 'Maradi', status: 'occupied', occupant_id: ID.expat });
    });

    test('occupant déjà en poste ailleurs : confirmation et ancien poste libéré', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'user' });
        await carte(page, ID.posteVacant).locator('.editMissionBtn').click();
        await page.selectOption('#fieldCountry', 'TD');
        await page.selectOption('#fieldCandidateType', 'expat');
        await page.selectOption('#fieldStatus', 'occupied');
        await page.selectOption('#fieldOccupant', ID.expat);
        await page.click('#saveMissionBtn');
        await expect(notification(page, 'Poste mis à jour.')).toBeVisible();
        expect(page.dialogues.join(' ')).toContain('occupe déjà le poste « Référente nutrition Niger »');
        expect(envoi(page, 'POST', '/rpc/save_mission')[0].corps.p_vacate_mission_id).toBe(ID.posteAwa);
    });

    test('détachement sans poste national derrière : avertissement', async ({ page }) => {
        await ouvrirPage(page, POSTES, (requete) => {
            if (requete.chemin.endsWith('/rest/v1/missions') && requete.parametres.get('candidate_type') === 'eq.nat') return [];
        }, { role: 'user' });
        await carte(page, ID.detachement).locator('.editMissionBtn').click();
        await page.fill('#fieldLocation', 'Dakar centre');
        await page.click('#saveMissionBtn');
        await expect.poll(() => page.dialogues.join(' ')).toContain("n'occupe actuellement aucun poste national");
    });

    test('détachement plus long que le poste national : avertissement', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'user' });
        await carte(page, ID.detachement).locator('.editMissionBtn').click();
        await page.fill('#fieldContractEnd', '2099-12-31');
        await page.click('#saveMissionBtn');
        await expect.poll(() => page.dialogues.join(' ')).toContain('avant la fin de ce détachement');
    });

    test('vérification du poste national impossible : avertissement au lieu d\'un silence', async ({ page }) => {
        await ouvrirPage(page, POSTES, (requete) => {
            if (requete.chemin.endsWith('/rest/v1/missions') && requete.parametres.get('candidate_type') === 'eq.nat') return erreurServeur();
        }, { role: 'user' });
        await carte(page, ID.detachement).locator('.editMissionBtn').click();
        await page.click('#saveMissionBtn');
        await expect.poll(() => page.dialogues.join(' ')).toContain('Impossible de vérifier le poste national');
    });

    test('changer l\'occupant d\'un poste national qui a un détachement : rappel', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'user' });
        await carte(page, ID.posteNational).locator('.editMissionBtn').click();
        await page.selectOption('#fieldOccupant', '');
        await page.click('#saveMissionBtn');
        await expect.poll(() => page.dialogues.join(' ')).toContain('occupe aussi le détachement « Détachement Dakar »');
    });

    test('supprimer un poste : confirmation puis suppression demandée', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'user' });
        await carte(page, ID.posteVacant).locator('.deleteMissionBtn').click();
        await expect(notification(page, 'Poste supprimé.')).toBeVisible();
        expect(page.dialogues[0]).toContain('Supprimer définitivement « Médecin référent »');
        expect(envoi(page, 'POST', '/rpc/delete_mission')[0].corps).toEqual({ p_mission_id: ID.posteVacant });
    });

    test('resynchroniser le compteur de l\'occupant', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'user' });
        await carte(page, ID.posteAwa).locator('.resyncOccupantBtn').click();
        await expect(notification(page, 'Compteur du talent resynchronisé.')).toBeVisible();
        expect(envoi(page, 'POST', '/rpc/resync_mission_occupant')[0].corps).toEqual({ p_mission_id: ID.posteAwa });
    });

    test('contrats échus traités à l\'ouverture : message et liste rafraîchie', async ({ page }) => {
        await ouvrirPage(page, POSTES, (requete) => {
            if (requete.chemin.endsWith('/rpc/process_expired_missions')) return [{ rotated_count: 1, vacated_count: 2 }];
        }, { role: 'user' });
        await expect(notification(page, '1 poste(s) automatiquement transféré(s) au futur occupant prévu · 2 poste(s) automatiquement libéré(s)')).toBeVisible();
    });

    test('contrat expiré non confirmé : signalé sur la carte', async ({ page }) => {
        await ouvrirPage(page, POSTES, (requete) => {
            if (requete.chemin.endsWith('/rest/v1/missions') && requete.methode === 'GET' && requete.parametres.get('pool') === 'eq.P1') {
                return [{ id: 'm-exp', title: 'Poste échu', pool: 'P1', pool_level: 'mission', status: 'occupied', occupant_id: ID.expat, candidate_type: 'expat', country_code: 'ML', location: 'Ségou', contract_end_type: 'date', contract_start_date: '2025-01-01', contract_end_date: '2026-01-31', contract_status: 'ongoing' }];
            }
        }, { role: 'user' });
        await expect(carte(page, 'm-exp')).toContainText('Contrat expiré le 31/01/2026');
    });

    test('pagination : 30 postes sur 3 pages de 12', async ({ page }) => {
        await ouvrirPage(page, POSTES, (requete) => {
            if (requete.chemin.endsWith('/rest/v1/missions') && requete.methode === 'GET' && requete.parametres.get('pool') === 'eq.P1') {
                return Array.from({ length: 30 }, (_, i) => ({ id: `m-${String(i).padStart(2, '0')}`, title: `Poste ${String(i).padStart(2, '0')}`, pool: 'P1', pool_level: 'mission', status: 'vacant', country_code: 'ML', location: 'Bamako', contract_end_type: 'date' }));
            }
        }, { role: 'user' });
        await expect(page.locator('#missionsGrid > div')).toHaveCount(12);
        await expect(page.locator('#missionsPagination')).toContainText('Page 1 / 3');
        await page.click('#missionsPagination [data-page-nav="next"]');
        await page.click('#missionsPagination [data-page-nav="next"]');
        await expect(page.locator('#missionsPagination')).toContainText('Page 3 / 3');
        await expect(page.locator('#missionsGrid > div')).toHaveCount(6);
    });
});

test.describe('Évaluations', () => {
    test('liste : un recruteur gère les siennes, pas celles des autres', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'user' });
        await carte(page, ID.posteNational).locator('.evaluationsBtn').click();
        await expect(page.locator('#evaluationsSubtitle')).toContainText('Cheick Traoré');
        await expect(page.locator('#evaluationsList > div')).toHaveCount(2);
        await expect(page.locator('#evaluationsList > div', { hasText: 'Évaluation de l' }).locator('.editEvaluationBtn')).toHaveCount(0);
        await expect(page.locator('#evaluationsList > div', { hasText: 'reco@alima.ngo' }).locator('.editEvaluationBtn')).toBeVisible();
    });

    test('ajouter une évaluation : envoi complet et liste mise à jour', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'user' });
        await carte(page, ID.posteNational).locator('.evaluationsBtn').click();
        await page.fill('#fieldContext', 'Mission de riposte choléra');
        await page.fill('#fieldPositivePoints', 'Organisation');
        await page.fill('#fieldRating', '8');
        await page.click('#saveEvaluationBtn');
        await expect(notification(page, 'Évaluation ajoutée.')).toBeVisible();
        await expect(page.locator('#evaluationsList')).toContainText('Mission de riposte choléra');
        expect(envoi(page, 'POST', '/evaluations')[0].corps).toMatchObject({ context: 'Mission de riposte choléra', positive_points: 'Organisation', rating: 8, mission_id: ID.posteNational, talent_id: ID.national, author_id: ID_COMPTES.user });
    });

    test('modifier puis supprimer une évaluation', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'admin' });
        await carte(page, ID.posteNational).locator('.evaluationsBtn').click();
        await page.locator('#evaluationsList > div', { hasText: 'Évaluation de l' }).locator('.editEvaluationBtn').click();
        await expect(page.locator('#fieldRating')).toHaveValue('9');
        await page.fill('#fieldRating', '10');
        await page.click('#saveEvaluationBtn');
        await expect(notification(page, 'Évaluation modifiée.')).toBeVisible();
        expect(envoi(page, 'PATCH', '/evaluations')[0].corps.rating).toBe(10);
        await page.locator('#evaluationsList > div', { hasText: 'Évaluation de l' }).locator('.deleteEvaluationBtn').click();
        await expect(notification(page, 'Évaluation supprimée.')).toBeVisible();
        await expect(page.locator('#evaluationsList > div')).toHaveCount(1);
    });

    test('suppression refusée par la base sans message d\'erreur : l\'échec est signalé', async ({ page }) => {
        await ouvrirPage(page, POSTES, (requete) => {
            if (requete.chemin.endsWith('/rest/v1/evaluations') && requete.methode === 'DELETE') return [];
        }, { role: 'admin' });
        await carte(page, ID.posteNational).locator('.evaluationsBtn').click();
        await page.locator('#evaluationsList .deleteEvaluationBtn').first().click();
        await expect(notification(page, 'Échec de la suppression')).toBeVisible();
        await expect(notification(page, 'Évaluation supprimée.')).toHaveCount(0);
    });

    test('visiteur : évaluations lisibles sans l\'e-mail de leur auteur, formulaire caché', async ({ page }) => {
        await ouvrirPage(page, POSTES, undefined, { role: 'visitor' });
        await carte(page, ID.posteNational).locator('.evaluationsBtn').click();
        await expect(page.locator('#evaluationsList > div')).toHaveCount(2);
        await expect(page.locator('#evaluationForm')).toBeHidden();
        await expect(page.locator('#evaluationsList .deleteEvaluationBtn')).toHaveCount(0);
        await expect(page.locator('#evaluationsList')).toContainText('Auteur inconnu');
        await expect(page.locator('#evaluationsList')).not.toContainText('@alima.ngo');
        expect(envoi(page, 'POST', '/rpc/visitor_mission_evaluations').map(e => e.corps)).toEqual([{ p_mission_id: ID.posteNational }]);
    });
});

test.describe('Visiteur : postes et statistiques par les portes de la base', () => {
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

    test('postes : cartes, occupants et indicateurs servis par la base, sans liste de talents', async ({ page }) => {
        await ouvrirEnVisiteur(page, POSTES);
        await expect(page.locator('#kpiTotal')).toHaveText('5');
        await expect(page.locator('#kpiOccupied')).toHaveText('3');
        await expect(carte(page, ID.posteAwa)).toContainText('Awa');
        await expect(carte(page, ID.posteNational)).toContainText('Cheick Traoré');
        expect(envoi(page, 'POST', '/rpc/visitor_pool_missions').map(e => e.corps)).toEqual([{ p_pool: 'P1' }]);
        await carte(page, ID.posteNational).locator('.evaluationsBtn').click();
        await expect(page.locator('#evaluationsList > div')).toHaveCount(2);
        expect(tablesLues(page)).toEqual([]);
        expect(page.erreursPage).toEqual([]);
    });

    test('évaluations : limite horaire atteinte, message lisible', async ({ page }) => {
        await ouvrirEnVisiteur(page, POSTES, (requete) => {
            if (requete.chemin.endsWith('/rpc/visitor_mission_evaluations')) return limiteAtteinte;
        });
        await carte(page, ID.posteNational).locator('.evaluationsBtn').click();
        await expect(page.locator('#evaluationsError')).toContainText('Limite de consultation atteinte');
    });

    test('statistiques : mêmes indicateurs, lignes anonymes servies par la base, sans lecture de table', async ({ page }) => {
        await ouvrirEnVisiteur(page, 'statistics.html');
        await expect(page.locator('#kpi-occupancy-sub')).toHaveText('3 de 5 postes occupés');
        await expect(page.locator('#kpi-vacancies')).toHaveText('1');
        await expect(page.locator('#kpi-talents-active')).not.toHaveText('0');
        expect(envoi(page, 'POST', '/rpc/visitor_statistics_rows')).toHaveLength(1);
        expect(tablesLues(page)).toEqual([]);
        expect(page.erreursPage).toEqual([]);
    });
});

test.describe('Dévalidés', () => {
    test('liste groupée par pool et filtre par pool', async ({ page }) => {
        await ouvrirPage(page, 'devalidated.html', undefined, { role: 'user' });
        await expect(page.locator('#poolsContainer')).toContainText('Dado');
        await expect(page.locator('#poolsContainer')).toContainText('Pool Un');
        await page.selectOption('#filterPool', 'P2');
        await expect(page.locator('#poolsContainer')).not.toContainText('Dado');
        await page.click('#resetFiltersBtn');
        await expect(page.locator('#poolsContainer')).toContainText('Dado');
    });

    test('réintégrer : confirmation, demande complète et message', async ({ page }) => {
        await ouvrirPage(page, 'devalidated.html', undefined, { role: 'user' });
        await page.locator('.btn-reintegrer').first().click();
        await expect(notification(page, 'réintégré')).toBeVisible();
        const [maj] = envoi(page, 'PATCH', '/talents');
        expect(maj.parametres.id).toBe(`eq.${ID.devalide}`);
        expect(maj.corps).toMatchObject({ is_valid: true, devalidation_date: null, months_without_mission: 0, last_mission_end_date: null });
        await expect(page.locator('#poolsContainer')).not.toContainText('Dado');
    });

    test('mettre en Liste Rouge depuis les dévalidés : message de confirmation', async ({ page }) => {
        await ouvrirPage(page, 'devalidated.html', undefined, { role: 'user' });
        await page.locator('.btn-redlist').first().click();
        await page.fill('#redListReasonInput', 'Fraude documentaire');
        await page.click('#redListModalConfirm');
        await expect(notification(page, 'Liste Rouge')).toBeVisible();
        expect(envoi(page, 'PATCH', '/talents')[0].corps).toMatchObject({ is_red_listed: true, red_list_reason: 'Fraude documentaire' });
        await expect(page.locator('#redListModal')).toBeHidden();
    });

    test('suppression définitive (admin) : double confirmation, suppression et message', async ({ page }) => {
        await ouvrirPage(page, 'devalidated.html', undefined, { role: 'admin' });
        await page.locator('.btn-delete').first().click();
        await expect(notification(page, 'supprimée')).toBeVisible();
        expect(page.dialogues).toHaveLength(2);
        expect(envoi(page, 'DELETE', '/talents')[0].parametres.id).toBe(`eq.${ID.devalide}`);
    });

    test('recruteur : pas de suppression définitive', async ({ page }) => {
        await ouvrirPage(page, 'devalidated.html', undefined, { role: 'user' });
        await expect(page.locator('#poolsContainer')).toContainText('Dado');
        await expect(page.locator('.btn-delete')).toHaveCount(0);
    });
});

test.describe('Liste Rouge', () => {
    const PDF = { name: 'Preuve été.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') };

    test('liste : talent signalé, motif et document consultables', async ({ page }) => {
        await ouvrirPage(page, 'red_list.html', undefined, { role: 'user' });
        await expect(page.locator('#redlist-count')).toHaveText('1');
        await expect(page.locator('#redlist-tbody')).toContainText('Eli');
        await page.locator('.btn-view-reason').first().click();
        await expect(page.locator('#reason-content')).toContainText('Motif');
        await expect(page.locator('#reason-documents-list a')).toHaveCount(1);
        await expect(page.locator('#reason-documents-list a')).toHaveAttribute('href', /token=lien-temporaire/);
        await expect(page.locator('#reason-documents-list a')).toHaveAttribute('rel', /noopener/);
    });

    test('ajout : choix du pool et du talent, motif, document, puis inscription', async ({ page }) => {
        await ouvrirPage(page, 'red_list.html', undefined, { role: 'user' });
        await page.locator('#btn-header-add-redlist:visible, #btn-mobile-add-redlist:visible').first().click();
        await page.selectOption('#modal-select-pool', 'P1');
        await expect(page.locator('#modal-select-talent option', { hasText: 'Eli' })).toHaveCount(0);
        await page.selectOption('#modal-select-talent', ID.aRisque);
        await page.fill('#modal-redlist-add-reason', 'Menaces envers un collègue');
        await expect(page.locator('#modal-redlist-add-confirm')).toBeDisabled();
        await page.setInputFiles('#modal-redlist-add-files', PDF);
        await expect(page.locator('#modal-redlist-files-list')).toContainText('Preuve été.pdf');
        await page.click('#modal-redlist-add-confirm');
        await expect(notification(page, 'Talent inscrit en Liste Rouge avec succès.')).toBeVisible();
        expect(page.base.stockage).toHaveLength(1);
        expect(page.base.stockage[0]).toMatch(new RegExp(`^red-list-documents/${ID.aRisque}/\\d+_0_Preuve_ete\\.pdf$`));
        const [maj] = envoi(page, 'PATCH', '/talents');
        expect(maj.corps).toMatchObject({ is_red_listed: true, red_list_reason: 'Menaces envers un collègue' });
        expect(maj.corps.red_list_documents).toEqual([page.base.stockage[0].replace('red-list-documents/', '')]);
    });

    test('ajout : fichier d\'un type interdit ou trop lourd refusé', async ({ page }) => {
        await ouvrirPage(page, 'red_list.html', undefined, { role: 'user' });
        await page.locator('#btn-header-add-redlist:visible, #btn-mobile-add-redlist:visible').first().click();
        await page.setInputFiles('#modal-redlist-add-files', [
            { name: 'programme.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') },
            { name: 'enorme.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(11 * 1024 * 1024) },
        ]);
        await expect(notification(page, 'programme.exe (type de fichier non autorisé)')).toBeVisible();
        await expect(notification(page, 'enorme.pdf (dépasse 10 Mo)')).toBeVisible();
        await expect(page.locator('#modal-redlist-files-list')).toBeEmpty();
    });

    test('ajout refusé par la base après l\'envoi du document : le document est retiré du stockage', async ({ page }) => {
        await ouvrirPage(page, 'red_list.html', (requete) => {
            if (requete.chemin.endsWith('/rest/v1/talents') && requete.methode === 'PATCH') return erreurServeur('refus simulé');
        }, { role: 'user' });
        await page.locator('#btn-header-add-redlist:visible, #btn-mobile-add-redlist:visible').first().click();
        await page.selectOption('#modal-select-pool', 'P1');
        await page.selectOption('#modal-select-talent', ID.aRisque);
        await page.fill('#modal-redlist-add-reason', 'Motif');
        await page.setInputFiles('#modal-redlist-add-files', PDF);
        await page.click('#modal-redlist-add-confirm');
        await expect(notification(page, "Échec de l'inscription")).toBeVisible();
        await expect.poll(() => envoi(page, 'DELETE', '/storage/v1/object/red-list-documents').length).toBe(1);
        expect(page.base.stockage).toEqual([]);
    });

    test('retrait : confirmation, fiche remise à zéro et document supprimé', async ({ page }) => {
        await ouvrirPage(page, 'red_list.html', undefined, { role: 'user' });
        await page.locator('.btn-remove-redlist').first().click();
        await page.click('#btn-confirm-confirm');
        await expect(notification(page, 'Talent retiré de la liste rouge.')).toBeVisible();
        const [maj] = envoi(page, 'PATCH', '/talents');
        expect(maj.parametres.id).toBe(`eq.${ID.listeRouge}`);
        expect(maj.corps).toEqual({ is_red_listed: false, red_list_date: null, red_list_reason: null, red_list_added_by: null, red_list_added_by_name: null, red_list_documents: null });
        expect(envoi(page, 'DELETE', '/storage/v1/object/red-list-documents')[0].corps).toEqual({ prefixes: [`${ID.listeRouge}/1_preuve.pdf`] });
    });

    test('pagination : la page demandée est transmise', async ({ page }) => {
        await ouvrirPage(page, 'red_list.html', (requete) => {
            if (requete.chemin === '/functions/v1/sensitive-reads') {
                const { page: numero } = JSON.parse(requete.corps);
                return { success: true, data: [{ id: `r${numero}`, first_name: `Page${numero}`, last_name: 'Test', pool: 'P1', red_list_reason: 'Motif', red_list_documents: [] }], count: 45, page: numero, totalPages: 3 };
            }
        }, { role: 'user' });
        await expect(page.locator('#redlist-pagination')).toContainText('Page 1 / 3');
        await page.click('#redlist-pagination [data-page-nav="next"]');
        await expect(page.locator('#redlist-tbody')).toContainText('Page2');
        await expect(page.locator('#redlist-pagination')).toContainText('Page 2 / 3');
    });

    test('ajouter un talent reste possible quand la liste n\'est pas vide, sur tous les écrans', async ({ page }) => {
        await ouvrirPage(page, 'red_list.html', undefined, { role: 'user' });
        await expect(page.locator('#redlist-tbody')).toContainText('Eli');
        await page.locator('#btn-header-add-redlist:visible, #btn-mobile-add-redlist:visible').first().click();
        await expect(page.locator('#redlist-add-modal')).toBeVisible();
    });
});
