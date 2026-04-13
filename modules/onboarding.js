/**
 * Module Onboarding - Collecte progressive des informations pharmacien
 *
 * Après le consentement explicite, le bot collecte optionnellement :
 *   1. Prénom/nom du pharmacien  (étape ONBOARDING_NAME)
 *   2. Nom de la pharmacie       (étape ONBOARDING_PHARMACY)
 *   3. Ville                     (étape ONBOARDING_CITY)
 *   4. Logiciel utilisé          (étape ONBOARDING_SOFTWARE)
 *
 * Chaque étape peut être passée en répondant "PASSER".
 * Les données collectées sont enregistrées dans data/pharmacists.json (CRM).
 *
 * Le module exporte les noms d'états (pour cohérence avec index.js)
 * et les fonctions de gestion de chaque étape.
 */

'use strict';

const { ROLES } = require('./consent');

// ---------------------------------------------------------------------------
// Constantes d'états onboarding (à importer dans index.js)
// ---------------------------------------------------------------------------

const ONBOARDING_STATES = {
  ONBOARDING_ROLE: 'onboarding_role',       // Première étape : rôle dans l'officine
  ONBOARDING_NAME: 'onboarding_name',
  ONBOARDING_PHARMACY: 'onboarding_pharmacy',
  ONBOARDING_CITY: 'onboarding_city',
  ONBOARDING_SOFTWARE: 'onboarding_software',
};

// ---------------------------------------------------------------------------
// Messages d'invite pour chaque étape
// ---------------------------------------------------------------------------

/**
 * Prompt de l'étape ONBOARDING_ROLE — première étape après consentement.
 * Demande le rôle de l'utilisateur dans l'officine.
 */
function buildRolePrompt() {
  return [
    'Quel est votre role dans l\'officine ?',
    '',
    '1. Pharmacien titulaire',
    '2. Pharmacien adjoint / collaborateur',
    '3. Autre role',
    '',
    'Tapez 1, 2, 3 ou PASSER.',
  ].join('\n');
}

function buildNamePrompt() {
  return [
    'Bienvenue! Pour personnaliser votre experience, quelques informations sont necessaires.',
    '',
    'Quel est votre prenom et nom ? (ou repondez PASSER pour ignorer)',
  ].join('\n');
}

function buildPharmacyPrompt(name) {
  const greeting = name ? `Merci ${name.split(' ')[0]}.` : 'Merci.';
  return [
    `${greeting}`,
    '',
    'Quel est le nom de votre pharmacie ? (ou PASSER)',
  ].join('\n');
}

function buildCityPrompt() {
  return 'Dans quelle ville exercez-vous ? (ou PASSER)';
}

function buildSoftwarePrompt() {
  return [
    'Quel logiciel de gestion utilisez-vous ?',
    '',
    '1. Blink Pharma',
    '2. Sobrus',
    '3. Autre',
    '4. Aucun / Ne pas renseigner (PASSER)',
    '',
    'Repondez avec un numero ou le nom du logiciel.',
  ].join('\n');
}

function buildOnboardingCompleteMessage(pharmacist) {
  const parts = ['Profil enregistre.'];
  if (pharmacist.name) parts.push(`Nom : ${pharmacist.name}`);
  if (pharmacist.pharmacy_name) parts.push(`Pharmacie : ${pharmacist.pharmacy_name}`);
  if (pharmacist.city) parts.push(`Ville : ${pharmacist.city}`);
  if (pharmacist.software) parts.push(`Logiciel : ${pharmacist.software}`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Logique de parsing pour chaque étape
// ---------------------------------------------------------------------------

/**
 * Détermine si l'utilisateur veut passer l'étape.
 */
function isSkip(normalizedInput) {
  return ['passer', 'skip', 'non', 'no', '-', '4'].includes(normalizedInput);
}

/**
 * Extrait le logiciel à partir de l'entrée utilisateur.
 * @param {string} normalizedInput
 * @returns {string|null}
 */
function parseSoftwareChoice(normalizedInput) {
  if (normalizedInput === '1' || normalizedInput.includes('blink')) return 'blink';
  if (normalizedInput === '2' || normalizedInput.includes('sobrus')) return 'sobrus';
  if (normalizedInput === '3' || normalizedInput.includes('autre')) return 'autre';
  return null; // passer ou non reconnu → null
}

// ---------------------------------------------------------------------------
// Handlers d'étape
// ---------------------------------------------------------------------------

/**
 * Parse le choix de rôle depuis l'entrée utilisateur.
 * @param {string} normalizedInput
 * @returns {string|null} - 'titulaire' | 'adjoint' | 'autre' | null
 */
function parseRoleChoice(normalizedInput) {
  if (normalizedInput === '1' || normalizedInput.includes('titulaire')) return ROLES.TITULAIRE;
  if (normalizedInput === '2' || normalizedInput.includes('adjoint') || normalizedInput.includes('collaborateur')) return ROLES.ADJOINT;
  if (normalizedInput === '3' || normalizedInput.includes('autre')) return ROLES.AUTRE;
  return null; // passer ou non reconnu → null
}

/**
 * Traite la réponse à l'étape ONBOARDING_ROLE.
 * @param {string} normalizedInput
 * @param {object} currentPharmacist
 * @returns {{ updatedPharmacist: object, nextStep: string, role: string|null }}
 */
function handleRoleStep(normalizedInput, currentPharmacist) {
  const role = isSkip(normalizedInput) ? null : (parseRoleChoice(normalizedInput) || null);
  return {
    updatedPharmacist: { ...currentPharmacist, role: role || null },
    nextStep: ONBOARDING_STATES.ONBOARDING_NAME,
    role, // retourné séparément pour mettre à jour le consent record
  };
}

/**
 * Traite la réponse à l'étape ONBOARDING_NAME.
 * @param {string} normalizedInput - Entrée normalisée
 * @param {object} currentPharmacist - Profil CRM partiel existant
 * @returns {{ updatedPharmacist: object, nextStep: string }}
 */
function handleNameStep(normalizedInput, currentPharmacist) {
  const name = isSkip(normalizedInput) ? null : String(normalizedInput).slice(0, 80);
  return {
    updatedPharmacist: { ...currentPharmacist, name: name || null },
    nextStep: ONBOARDING_STATES.ONBOARDING_PHARMACY,
  };
}

/**
 * Traite la réponse à l'étape ONBOARDING_PHARMACY.
 * @param {string} rawInput - Entrée brute (pour préserver la casse)
 * @param {string} normalizedInput
 * @param {object} currentPharmacist
 * @returns {{ updatedPharmacist: object, nextStep: string }}
 */
function handlePharmacyStep(rawInput, normalizedInput, currentPharmacist) {
  const pharmacyName = isSkip(normalizedInput) ? null : String(rawInput).slice(0, 100);
  return {
    updatedPharmacist: { ...currentPharmacist, pharmacy_name: pharmacyName || null },
    nextStep: ONBOARDING_STATES.ONBOARDING_CITY,
  };
}

/**
 * Traite la réponse à l'étape ONBOARDING_CITY.
 * @param {string} rawInput
 * @param {string} normalizedInput
 * @param {object} currentPharmacist
 * @returns {{ updatedPharmacist: object, nextStep: string }}
 */
function handleCityStep(rawInput, normalizedInput, currentPharmacist) {
  const city = isSkip(normalizedInput) ? null : String(rawInput).slice(0, 80);
  return {
    updatedPharmacist: { ...currentPharmacist, city: city || null },
    nextStep: ONBOARDING_STATES.ONBOARDING_SOFTWARE,
  };
}

/**
 * Traite la réponse à l'étape ONBOARDING_SOFTWARE.
 * @param {string} normalizedInput
 * @param {object} currentPharmacist
 * @returns {{ updatedPharmacist: object, nextStep: null }} (null = onboarding terminé)
 */
function handleSoftwareStep(normalizedInput, currentPharmacist) {
  const software = isSkip(normalizedInput) ? null : (parseSoftwareChoice(normalizedInput) || null);
  return {
    updatedPharmacist: { ...currentPharmacist, software: software || null },
    nextStep: null, // Fin de l'onboarding
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ONBOARDING_STATES,
  buildRolePrompt,
  buildNamePrompt,
  buildPharmacyPrompt,
  buildCityPrompt,
  buildSoftwarePrompt,
  buildOnboardingCompleteMessage,
  handleRoleStep,
  handleNameStep,
  handlePharmacyStep,
  handleCityStep,
  handleSoftwareStep,
  isSkip,
  parseRoleChoice,
};
