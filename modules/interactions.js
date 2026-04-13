/**
 * Module Interactions médicamenteuses
 *
 * Vérifie les interactions entre plusieurs médicaments et retourne
 * un rapport avec niveaux de gravité colorés :
 *   VERT  (compatible)  - aucune interaction connue
 *   ORANGE (surveiller) - interaction modérée, utiliser avec précaution
 *   ROUGE  (éviter)     - interaction majeure, contre-indication relative
 *
 * Usage WhatsApp : l'utilisateur envoie les noms de médicaments séparés par
 * "+", "," ou "/" — exemple : "Metformine + Ibuprofène"
 *
 * La base de données locale couvre les interactions les plus courantes au Maroc.
 * Elle peut être étendue ou remplacée par un appel API externe.
 */

'use strict';

// ---------------------------------------------------------------------------
// Base d'interactions (DCI normalisées en minuscules sans accents)
// Format : [dci1, dci2, niveau, message_fr]
// ---------------------------------------------------------------------------

const INTERACTION_DB = [
  // ─── ROUGE : interactions majeures ──────────────────────────────────────
  ['warfarine', 'aspirine', 'ROUGE',
    'Risque hemorragique majeur. Association a eviter sauf avis specialise.'],
  ['warfarine', 'acide acetylsalicylique', 'ROUGE',
    'Risque hemorragique majeur. Association a eviter sauf avis specialise.'],
  ['warfarine', 'ibuprofene', 'ROUGE',
    'AINS + anticoagulant oral : risque hemorragique severe. Contre-indique.'],
  ['warfarine', 'ketoprofene', 'ROUGE',
    'AINS + anticoagulant oral : risque hemorragique severe. Contre-indique.'],
  ['warfarine', 'diclofenac', 'ROUGE',
    'AINS + anticoagulant oral : risque hemorragique severe. Contre-indique.'],
  ['digoxine', 'amiodarone', 'ROUGE',
    'Amiodarone augmente les concentrations de digoxine, risque de toxicite cardiaque.'],
  ['digoxine', 'clarithromycine', 'ROUGE',
    'Clarithromycine inhibe P-gp, doublement possible des concentrations de digoxine.'],
  ['methotrexate', 'ibuprofene', 'ROUGE',
    'AINS reduisent l\'elimination du methotrexate : risque de toxicite severe.'],
  ['methotrexate', 'aspirine', 'ROUGE',
    'AINS reduisent l\'elimination du methotrexate : risque de toxicite severe.'],
  ['itraconazole', 'simvastatine', 'ROUGE',
    'Inhibiteur puissant CYP3A4 : risque de myopathie/rhabdomyolyse.'],
  ['fluconazole', 'simvastatine', 'ROUGE',
    'Inhibiteur puissant CYP3A4 : risque de myopathie/rhabdomyolyse.'],
  ['clarithromycine', 'simvastatine', 'ROUGE',
    'Inhibiteur puissant CYP3A4 : risque de myopathie/rhabdomyolyse.'],
  ['sertindole', 'erythromycine', 'ROUGE',
    'Allongement QT cumule, risque de torsades de pointes.'],
  ['tramadol', 'imao', 'ROUGE',
    'Risque de syndrome serotoninergique severe. Contre-indique.'],
  ['fluoxetine', 'imao', 'ROUGE',
    'Syndrome serotoninergique potentiellement fatal. Respecter un delai de 14 jours.'],
  ['linezolide', 'fluoxetine', 'ROUGE',
    'Risque de syndrome serotoninergique (IMAO + ISRS). Contre-indique.'],
  ['clopidogrel', 'omeprazole', 'ROUGE',
    'Omeprazole reduit l\'activation du clopidogrel (inhibition CYP2C19). Preferer pantoprazole.'],
  ['metformine', 'alcool', 'ROUGE',
    'Risque d\'acidose lactique potentiellement fatale. Contre-indique.'],

  // ─── ORANGE : interactions modérées (surveiller) ─────────────────────────
  ['warfarine', 'paracetamol', 'ORANGE',
    'Paracetamol a doses elevees potentialise l\'anticoagulation. Surveiller l\'INR.'],
  ['ibuprofene', 'prednisolone', 'ORANGE',
    'AINS + corticoide : risque d\'ulcere gastro-intestinal augmente.'],
  ['ibuprofene', 'cortisone', 'ORANGE',
    'AINS + corticoide : risque d\'ulcere gastro-intestinal augmente.'],
  ['ibuprofene', 'prednisone', 'ORANGE',
    'AINS + corticoide : risque d\'ulcere gastro-intestinal augmente.'],
  ['metformine', 'ibuprofene', 'ORANGE',
    'AINS peuvent deteriorer la fonction renale et augmenter le risque d\'acidose lactique.'],
  ['metformine', 'furosemide', 'ORANGE',
    'Diuretiques de l\'anse augmentent le risque d\'acidose lactique sous metformine.'],
  ['iec', 'potassium', 'ORANGE',
    'IEC + supplement potassique : risque d\'hyperkaliemie. Surveiller ionogramme.'],
  ['losartan', 'potassium', 'ORANGE',
    'ARA2 + supplement potassique : risque d\'hyperkaliemie. Surveiller ionogramme.'],
  ['enalapril', 'potassium', 'ORANGE',
    'IEC + supplement potassique : risque d\'hyperkaliemie. Surveiller ionogramme.'],
  ['amlodipine', 'simvastatine', 'ORANGE',
    'Amlodipine (inhibiteur modere CYP3A4) augmente les concentrations de simvastatine. Dose max simvastatine : 20mg.'],
  ['amoxicilline', 'methotrexate', 'ORANGE',
    'Amoxicilline peut reduire l\'elimination renale du methotrexate. Surveiller.'],
  ['ciprofloxacine', 'antiacide', 'ORANGE',
    'Antiacides reduisent significativement l\'absorption de la ciprofloxacine. Espacer de 2h.'],
  ['ciprofloxacine', 'fer', 'ORANGE',
    'Le fer chelatent la ciprofloxacine reduit son absorption. Espacer de 2h.'],
  ['levothyroxine', 'fer', 'ORANGE',
    'Le fer reduit l\'absorption de la levothyroxine. Espacer de 4h minimum.'],
  ['levothyroxine', 'calcium', 'ORANGE',
    'Le calcium reduit l\'absorption de la levothyroxine. Espacer de 4h minimum.'],
  ['atorvastatine', 'erythromycine', 'ORANGE',
    'Erythromycine inhibe CYP3A4 : augmentation des concentrations d\'atorvastatine. Surveiller.'],
  ['digoxine', 'furosemide', 'ORANGE',
    'Furosemide peut induire une hypokaliemie potentialisant la toxicite de la digoxine.'],
  ['losartan', 'ibuprofene', 'ORANGE',
    'AINS peuvent reduire l\'effet antihypertenseur et deteriorer la fonction renale.'],
  ['enalapril', 'ibuprofene', 'ORANGE',
    'AINS peuvent reduire l\'effet antihypertenseur et deteriorer la fonction renale.'],
  ['metformine', 'produit-de-contraste', 'ORANGE',
    'Suspendre la metformine 48h avant injection de produit de contraste iode.'],
];

// ---------------------------------------------------------------------------
// Utilitaires de normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise une DCI pour la comparaison (minuscules, sans accents, sans espaces doubles).
 */
function normalizeDci(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Retourne true si une DCI de la base correspond à la DCI utilisateur.
 * Accepte les correspondances partielles (ex: "iec" matche "enalapril" si mappage défini).
 */
function dciMatches(dbDci, userDci) {
  const db = normalizeDci(dbDci);
  const user = normalizeDci(userDci);
  if (!db || !user) return false;
  // Correspondance exacte ou inclusion partielle (au moins 4 caractères)
  return db === user || (user.length >= 4 && db.includes(user)) || (db.length >= 4 && user.includes(db));
}

/**
 * Parse l'entrée utilisateur en liste de médicaments.
 * Supporte les séparateurs : +, /, virgule, point-virgule, "et", "avec".
 * @param {string} input
 * @returns {string[]} Liste de noms normalisés (3+ caractères)
 */
function parseDrugList(input) {
  return String(input || '')
    .split(/[+\/,;]|\s+et\s+|\s+avec\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

// ---------------------------------------------------------------------------
// Moteur de vérification
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { 'ROUGE': 3, 'ORANGE': 2, 'VERT': 1 };

/**
 * Vérifie les interactions entre une liste de médicaments.
 * @param {string[]} drugs - Noms des médicaments (DCI ou noms commerciaux)
 * @returns {{ pairs: Array, worstLevel: string, count: object }}
 */
function checkInteractions(drugs) {
  if (!Array.isArray(drugs) || drugs.length < 2) {
    return { pairs: [], worstLevel: 'VERT', count: { ROUGE: 0, ORANGE: 0, VERT: 0 } };
  }

  const foundInteractions = [];

  // Comparer chaque paire de médicaments
  for (let i = 0; i < drugs.length; i++) {
    for (let j = i + 1; j < drugs.length; j++) {
      const drugA = drugs[i];
      const drugB = drugs[j];
      let bestMatch = null;

      for (const [dci1, dci2, level, message] of INTERACTION_DB) {
        const matchAB = dciMatches(dci1, drugA) && dciMatches(dci2, drugB);
        const matchBA = dciMatches(dci1, drugB) && dciMatches(dci2, drugA);

        if (matchAB || matchBA) {
          // Prendre l'interaction de plus haute gravité pour cette paire
          if (!bestMatch || SEVERITY_ORDER[level] > SEVERITY_ORDER[bestMatch.level]) {
            bestMatch = { drugA, drugB, level, message };
          }
        }
      }

      if (bestMatch) {
        foundInteractions.push(bestMatch);
      }
    }
  }

  // Calculer la pire gravité globale
  const worstLevel = foundInteractions.reduce((worst, item) => {
    return SEVERITY_ORDER[item.level] > SEVERITY_ORDER[worst] ? item.level : worst;
  }, 'VERT');

  const count = { ROUGE: 0, ORANGE: 0, VERT: 0 };
  foundInteractions.forEach((item) => { count[item.level] = (count[item.level] || 0) + 1; });

  return { pairs: foundInteractions, worstLevel, count };
}

// ---------------------------------------------------------------------------
// Formatage WhatsApp
// ---------------------------------------------------------------------------

const LEVEL_LABELS = {
  ROUGE: '[ROUGE] EVITER',
  ORANGE: '[ORANGE] Surveiller',
  VERT: '[VERT] Compatible',
};

/**
 * Formate le rapport d'interactions pour un message WhatsApp.
 * @param {string[]} drugs - Liste des médicaments analysés
 * @param {{ pairs, worstLevel, count }} result - Résultat de checkInteractions()
 * @returns {string} Texte formaté
 */
function formatInteractionReport(drugs, result) {
  const lines = [];

  lines.push(`Analyse d'interactions pour :`);
  drugs.forEach((d) => lines.push(`  - ${d}`));
  lines.push('');

  if (result.pairs.length === 0) {
    lines.push('[VERT] Aucune interaction connue dans notre base.');
    lines.push('');
    lines.push('Attention : ceci ne remplace pas une verificationclinique complete.');
  } else {
    const summary = [];
    if (result.count.ROUGE) summary.push(`${result.count.ROUGE} interaction(s) ROUGE`);
    if (result.count.ORANGE) summary.push(`${result.count.ORANGE} interaction(s) ORANGE`);
    lines.push(`Bilan : ${summary.join(', ')}`);
    lines.push('');

    result.pairs.forEach((pair) => {
      lines.push(`${LEVEL_LABELS[pair.level]}`);
      lines.push(`  ${pair.drugA} + ${pair.drugB}`);
      lines.push(`  ${pair.message}`);
      lines.push('');
    });

    lines.push('Sources : base interne - pour validation clinique, consultez le Vidal/BCFI.');
  }

  lines.push('\nNouvelle analyse : envoyez les noms. Retour : RETOUR');

  return lines.join('\n');
}

/**
 * Message d'aide affiché lors de l'entrée dans le module.
 */
function buildInteractionPrompt() {
  return [
    'Analyseur d\'interactions medicamenteuses',
    '',
    'Envoyez les noms des medicaments a analyser, separes par "+" ou ",".',
    '',
    'Exemples :',
    '  Metformine + Ibuprofene',
    '  Warfarine, Aspirine, Paracetamol',
    '  Digoxine + Amiodarone + Furosemide',
    '',
    'Niveaux de gravite : [ROUGE] Eviter / [ORANGE] Surveiller / [VERT] Compatible',
    '',
    'Envoyez RETOUR pour revenir au menu.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parseDrugList,
  checkInteractions,
  formatInteractionReport,
  buildInteractionPrompt,
};
