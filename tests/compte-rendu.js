const fs = require('fs');
const path = require('path');

const sansCouleurs = (texte) => (texte || '').replace(/\u001b\[[0-9;]*m/g, '');

class CompteRendu {
    constructor() {
        this.resultats = [];
    }

    onTestEnd(test, resultat) {
        this.resultats.push({ test, resultat });
    }

    onEnd(bilan) {
        const derniers = new Map();
        for (const { test, resultat } of this.resultats) derniers.set(test.id, { test, resultat });
        const liste = [...derniers.values()];
        const echecs = liste.filter(({ test }) => test.outcome() === 'unexpected');
        const instables = liste.filter(({ test }) => test.outcome() === 'flaky');
        const reussis = liste.filter(({ test }) => test.outcome() === 'expected');
        const titre = ({ test }) => `[${test.parent.project().name}] ${test.titlePath().slice(3).join(' › ')}`;

        const lignes = [
            '# Compte rendu des tests du site Cap Huma',
            '',
            `- Date : ${new Date().toLocaleString('fr-FR', { timeZone: 'UTC' })} (UTC)`,
            `- Version testée : ${process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : 'copie locale'}`,
            `- Résultat : ${echecs.length === 0 ? 'TOUT EST BON' : 'DES TESTS ONT ÉCHOUÉ'} — ${reussis.length} réussi(s), ${echecs.length} échoué(s), ${instables.length} réussi(s) au 2e essai`,
            '',
        ];

        if (echecs.length > 0) {
            lignes.push('## Tests échoués', '');
            for (const element of echecs) {
                const { test, resultat } = element;
                const erreur = sansCouleurs(resultat.error && (resultat.error.message || resultat.error.value)).split('\n').filter(Boolean).slice(0, 30).join('\n');
                const captures = resultat.attachments.filter(a => a.path && a.contentType.startsWith('image/')).map(a => path.relative(path.join(__dirname, 'resultats'), a.path));
                lignes.push(`### ${titre(element)}`, '', `- Emplacement : ${path.basename(test.location.file)}, ligne ${test.location.line}`);
                if (captures.length) lignes.push(`- Capture d'écran : ${captures.join(', ')}`);
                lignes.push('', '```', erreur || '(pas de message)', '```', '');
            }
        }

        if (instables.length > 0) {
            lignes.push('## Réussis seulement au 2e essai', '', ...instables.map(e => `- ${titre(e)}`), '');
        }

        const remarques = [...new Set(liste.flatMap(({ test, resultat }) => [...(resultat.annotations || []), ...test.annotations].filter(a => a.type.endsWith('(non bloquant)')).map(a => `${a.type} — ${a.description}`)))];
        if (remarques.length > 0) {
            lignes.push('## Points à améliorer, non bloquants', '', ...remarques.map(r => `- ${r}`), '');
        }

        lignes.push('## Tests réussis', '', ...reussis.map(e => `- ${titre(e)}`), '');

        const texte = lignes.join('\n');
        const dossier = path.join(__dirname, 'resultats');
        fs.mkdirSync(dossier, { recursive: true });
        fs.writeFileSync(path.join(dossier, 'compte-rendu.md'), texte);
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, texte + '\n');
        console.log(`\nCompte rendu écrit dans tests/resultats/compte-rendu.md (${bilan.status})`);
    }
}

module.exports = CompteRendu;
