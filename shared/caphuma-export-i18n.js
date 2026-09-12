/**
 * Traductions et préférence de langue pour les documents exportés (PDF,
 * puis exports Excel dans un second temps). Aucune dépendance à Supabase :
 * ce fichier peut être inclus tel quel sur n'importe quelle page qui
 * génère un export. La préférence est mémorisée dans le navigateur
 * (localStorage), jamais en base — la langue d'un export dépend de qui le
 * reçoit, pas d'un réglage de compte figé.
 */

const CAPHUMA_EXPORT_LANG_KEY = 'capHumaExportLang';

function capHumaGetExportLang() {
    try {
        const v = localStorage.getItem(CAPHUMA_EXPORT_LANG_KEY);
        return (v === 'en') ? 'en' : 'fr';
    } catch (e) {
        return 'fr';
    }
}

function capHumaSetExportLang(lang) {
    try {
        localStorage.setItem(CAPHUMA_EXPORT_LANG_KEY, (lang === 'en') ? 'en' : 'fr');
    } catch (e) {
        // Stockage indisponible (navigation privée stricte, quota) : la
        // langue retombera sur le défaut FR au prochain export, sans
        // bloquer l'action en cours.
    }
}

// Formate "X ans Y mois" / "X yrs Y mo" à partir d'un nombre de mois.
function capHumaFormatExpDuration(months, lang) {
    const m = Number(months) || 0;
    const y = Math.floor(m / 12);
    const rem = m % 12;
    if (lang === 'en') {
        return `${y} yr${y !== 1 ? "s" : ""} ${rem} mo`;
    }
    return `${y} an${y !== 1 ? "s" : ""} ${rem} mois`;
}

const EDU_LEVEL_LABELS_I18N = {
    fr: {
        none: "Néant", bac: "Bac", "bac+1": "Bac+1", "bac+2": "Bac+2",
        "bac+3": "Bac+3 (Licence)", "bac+4": "Bac+4", "bac+5": "Bac+5 (Master)",
        "bac+6": "Bac+6", "bac+7": "Bac+7", "bac+8+": "Bac+8+ (Doctorat)"
    },
    en: {
        none: "None", bac: "Bac (high school diploma)", "bac+1": "Bac+1", "bac+2": "Bac+2",
        "bac+3": "Bac+3 (Bachelor's)", "bac+4": "Bac+4", "bac+5": "Bac+5 (Master's)",
        "bac+6": "Bac+6", "bac+7": "Bac+7", "bac+8+": "Bac+8+ (PhD)"
    }
};

const MISSION_COUNT_LABELS_I18N = {
    fr: { none: "0 mission", one: "1 mission", two: "2 missions", three_plus: "3 missions et +" },
    en: { none: "0 missions", one: "1 mission", two: "2 missions", three_plus: "3+ missions" }
};

const PDF_I18N = {
    fr: {
        brand: "ALIMA TalentHub",
        poolPrefix: "Pool : ",
        sectionGeneralInfo: "Informations Générales",
        sectionExperience: "Expérience",
        sectionEducation: "Formation & Compétences",
        sectionKeySkills: "Compétences clés",
        sectionGeoLanguages: "Géographie & Langues",
        sectionIntervention: "Contextes & Zones d'intervention",
        sectionMissionHistory: "Parcours de missions ALIMA",
        sectionRecap: "Récapitulatif Expérience",
        fieldEmail: "Email",
        fieldStatus: "Statut",
        fieldGender: "Genre",
        fieldPool: "Pool",
        fieldExpAlima: "Expérience ALIMA",
        fieldExpHum: "Expérience Humanitaire",
        fieldExpHumRecap: "Expérience humanitaire",
        fieldMissionsAlima: "Missions ALIMA",
        fieldMissionsAlimaRecap: "Nombre de missions ALIMA",
        fieldPoolIntegrationDate: "Date d'intégration pool",
        fieldEduLevel: "Niveau d'études",
        fieldEduSpecialty: "Spécialité",
        fieldNationality: "Nationalité",
        fieldCountryResidence: "Pays de résidence",
        fieldLanguages: "Langues",
        fieldKeySkillsRecap: "Compétences clés",
        fieldInterventionContexts: "Contextes d'intervention",
        fieldGeoZones: "Zones géographiques",
        genderMale: "Homme",
        genderFemale: "Femme",
        contextsLabel: "Types de contextes vécus :",
        zonesLabel: "Zones géographiques :",
        ongoing: "● EN COURS",
        missionFallback: "Mission ALIMA",
        since: "Depuis ",
        context: "Contexte :",
        strengths: "Points forts :",
        improvementAreas: "Axes d'amélioration :",
        evaluationBy: "Évaluation par ",
        recapCriterion: "Critère",
        recapValue: "Valeur",
        durationMonths: (n) => `(${n} mois)`,
        generatedOn: (date) => `Carte générée le ${date} — ALIMA TalentHub`,
        page: (i, total) => `Page ${i}/${total}`,
        locale: 'fr-FR'
    },
    en: {
        brand: "ALIMA TalentHub",
        poolPrefix: "Pool: ",
        sectionGeneralInfo: "General Information",
        sectionExperience: "Experience",
        sectionEducation: "Education & Skills",
        sectionKeySkills: "Key Skills",
        sectionGeoLanguages: "Geography & Languages",
        sectionIntervention: "Intervention Contexts & Zones",
        sectionMissionHistory: "ALIMA Mission History",
        sectionRecap: "Experience Summary",
        fieldEmail: "Email",
        fieldStatus: "Status",
        fieldGender: "Gender",
        fieldPool: "Pool",
        fieldExpAlima: "ALIMA Experience",
        fieldExpHum: "Humanitarian Experience",
        fieldExpHumRecap: "Humanitarian experience",
        fieldMissionsAlima: "ALIMA Missions",
        fieldMissionsAlimaRecap: "Number of ALIMA Missions",
        fieldPoolIntegrationDate: "Pool Integration Date",
        fieldEduLevel: "Education Level",
        fieldEduSpecialty: "Specialty",
        fieldNationality: "Nationality",
        fieldCountryResidence: "Country of Residence",
        fieldLanguages: "Languages",
        fieldKeySkillsRecap: "Key Skills",
        fieldInterventionContexts: "Intervention Contexts",
        fieldGeoZones: "Geographic Zones",
        genderMale: "Male",
        genderFemale: "Female",
        contextsLabel: "Types of contexts experienced:",
        zonesLabel: "Geographic zones:",
        ongoing: "● ONGOING",
        missionFallback: "ALIMA Mission",
        since: "Since ",
        context: "Context:",
        strengths: "Strengths:",
        improvementAreas: "Areas for improvement:",
        evaluationBy: "Evaluation by ",
        recapCriterion: "Criterion",
        recapValue: "Value",
        durationMonths: (n) => `(${n} mo)`,
        generatedOn: (date) => `Card generated on ${date} — ALIMA TalentHub`,
        page: (i, total) => `Page ${i}/${total}`,
        locale: 'en-GB'
    }
};
