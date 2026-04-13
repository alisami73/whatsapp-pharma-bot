'use strict';

/**
 * Module Consent - Gestion du consentement, des rôles et des templates Meta
 *
 * Ce module centralise :
 *   - Les textes de consentement (version courte, longue, mise à jour version)
 *   - Les constantes de rôles utilisateur (titulaire / adjoint / autre)
 *   - Les messages de confirmation, refus, révocation
 *   - Les définitions des templates Meta WhatsApp Business à soumettre
 *   - Les fonctions utilitaires pour les restrictions par rôle
 *
 * Aucune dépendance externe.
 */

// ---------------------------------------------------------------------------
// Version du consentement
// ---------------------------------------------------------------------------

/**
 * Version courante du texte de consentement.
 * Si CONSENT_CURRENT_VERSION change, les utilisateurs existants seront invités
 * à re-confirmer lors de leur prochain message (si leur version stockée diffère).
 */
const CONSENT_CURRENT_VERSION = process.env.CONSENT_CURRENT_VERSION || 'v1';

/**
 * Snapshots textuels par version pour l'audit trail.
 * Ajouter une entrée ici à chaque changement de version.
 */
const CONSENT_TEXT_SNAPSHOTS = {
  v1: [
    'Je suis pharmacien ou j\'utilise ce service sous ma responsabilite.',
    'J\'accepte de recevoir des messages WhatsApp lies aux services actives.',
    'Je comprends que les informations doivent etre validees par l\'utilisateur avant toute decision.',
    'Je respecte les prerogatives et les limites de mon role si je ne suis pas le pharmacien titulaire.',
  ].join(' '),
};

/**
 * Retourne le snapshot textuel correspondant à une version.
 * @param {string} version
 * @returns {string}
 */
function getConsentTextSnapshot(version) {
  return CONSENT_TEXT_SNAPSHOTS[version] || CONSENT_TEXT_SNAPSHOTS.v1;
}

// ---------------------------------------------------------------------------
// Rôles utilisateur
// ---------------------------------------------------------------------------

const ROLES = {
  TITULAIRE: 'titulaire',
  ADJOINT: 'adjoint',
  AUTRE: 'autre',
};

const ROLE_LABELS = {
  titulaire: 'Pharmacien titulaire',
  adjoint: 'Pharmacien adjoint / collaborateur',
  autre: 'Autre utilisateur',
};

/**
 * Détermine si l'accès à un thème est restreint selon le rôle déclaré.
 * Règle : si le thème requiert une authentification ET que le rôle est connu
 * mais n'est pas titulaire, l'accès est restreint.
 * Un rôle null (non renseigné) ne déclenche PAS de restriction (bénéfice du doute).
 * @param {string|null} role
 * @param {{ requires_auth: boolean }} theme
 * @returns {boolean}
 */
function isRoleRestricted(role, theme) {
  return Boolean(theme.requires_auth && role && role !== ROLES.TITULAIRE);
}

// ---------------------------------------------------------------------------
// Textes conversationnels — Version courte (onboarding initial)
// ---------------------------------------------------------------------------

/**
 * Message de consentement court, optimisé mobile WhatsApp.
 * Affiché au premier contact utilisateur inconnu.
 */
function buildConsentShort() {
  return [
    'Pour utiliser Assistant Pharmacie, veuillez confirmer :',
    '',
    '✔ Je suis pharmacien ou j\'utilise ce service sous ma responsabilite',
    '✔ J\'accepte de recevoir des messages WhatsApp lies aux services actives',
    '✔ Je comprends que les informations doivent etre validees par l\'utilisateur',
    '✔ Je respecte les prerogatives et les limites de mon role si je ne suis pas le pharmacien titulaire de l\'officine',
    '',
    'Repondez :',
    'OUI - pour activer le service',
    'NON - pour refuser',
    'EN SAVOIR PLUS - pour plus d\'informations',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Textes conversationnels — Version longue (sur demande EN SAVOIR PLUS)
// ---------------------------------------------------------------------------

/**
 * Message de consentement détaillé, envoyé si l'utilisateur répond "EN SAVOIR PLUS".
 * Contient les informations complètes pour une acceptation éclairée.
 */
function buildConsentLong() {
  return [
    'Assistant Pharmacie - Informations complementaires',
    '',
    'En utilisant ce service, vous confirmez :',
    '',
    '1. Qualite professionnelle',
    '   Vous etes pharmacien diplome ou agissez sous la responsabilite directe d\'un pharmacien titulaire d\'officine.',
    '',
    '2. Reception de messages',
    '   Vous acceptez de recevoir des messages WhatsApp relatifs aux services actives : informations medicament, interactions medicamenteuses, monitoring de stock, reportings.',
    '',
    '3. Validation des informations',
    '   Les informations fournies (interactions medicamenteuses, donnees MedIndex, etc.) ont une valeur informative uniquement et doivent etre validees par l\'utilisateur avant toute decision clinique ou commerciale.',
    '',
    '4. Role et responsabilite',
    '   Si vous n\'etes pas le pharmacien titulaire de l\'officine, vous vous engagez a respecter les prerogatives liees a votre role et a ne pas acceder aux fonctionnalites reservees au titulaire.',
    '',
    '5. Messages automatiques',
    '   Certains services (reporting quotidien, alertes stock) peuvent envoyer des messages automatiques. Ces envois ne sont effectues que si vous les avez explicitement actives.',
    '',
    '6. Opt-out',
    '   Vous pouvez vous desinscrire a tout moment en repondant STOP. Aucun message automatique ne sera envoye si le consentement est absent.',
    '',
    'Repondez OUI pour confirmer ou NON pour refuser.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Textes conversationnels — Mise à jour de version
// ---------------------------------------------------------------------------

/**
 * Message demandant une re-confirmation suite à une mise à jour des conditions.
 * Envoyé quand CONSENT_CURRENT_VERSION diffère de la version stockée pour l'utilisateur.
 * @param {string} newVersion - Nouvelle version (ex: 'v2')
 */
function buildConsentVersionUpdate(newVersion) {
  return [
    'Mise a jour des conditions d\'utilisation (' + newVersion + ')',
    '',
    'Nos conditions ont ete mises a jour. Veuillez confirmer a nouveau :',
    '',
    '✔ Je suis pharmacien ou j\'utilise ce service sous ma responsabilite',
    '✔ J\'accepte les nouvelles conditions d\'utilisation',
    '✔ Je comprends les limites informationnelles de ce service',
    '',
    'Repondez OUI pour confirmer ou NON pour vous desinscrire.',
    'Repondez EN SAVOIR PLUS pour lire les nouvelles conditions.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Textes conversationnels — Confirmation, refus, révocation
// ---------------------------------------------------------------------------

/**
 * Message de confirmation après acceptation du consentement.
 * @param {string|null} role - Rôle déclaré (optionnel, peut être null)
 */
function buildConsentConfirmation(role) {
  const roleLabel = ROLE_LABELS[role] || null;
  const lines = [
    'Consentement enregistre (version ' + CONSENT_CURRENT_VERSION + ').',
  ];
  if (roleLabel) {
    lines.push('Role enregistre : ' + roleLabel + '.');
  }
  lines.push('');
  lines.push('Repondez STOP a tout moment pour vous desinscrire.');
  return lines.join('\n');
}

/**
 * Message envoyé quand l'utilisateur répond NON au consentement.
 * Aucun autre message ne sera envoyé après ce point.
 */
function buildConsentDeclined() {
  return [
    'Votre choix a ete enregistre.',
    '',
    'L\'assistant WhatsApp n\'est pas active pour votre numero.',
    'Aucun message ne vous sera envoye.',
    '',
    'Si vous changez d\'avis, repondez OUI pour activer le service.',
  ].join('\n');
}

/**
 * Message envoyé après une commande STOP (révocation du consentement).
 * Confirme la désinscription complète.
 */
function buildConsentRevoked() {
  return [
    'Desinscription confirmee.',
    '',
    'Votre acces et vos abonnements ont ete supprimes.',
    'Aucun message ne vous sera envoye.',
    '',
    'Pour reactiver le service, repondez OUI.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Textes pour la gestion des rôles
// ---------------------------------------------------------------------------

/**
 * Message affiché quand un utilisateur non-titulaire tente d'accéder
 * à un service réservé au pharmacien titulaire.
 * @param {string} serviceName - Nom du service/thème
 */
function buildRoleRestrictionMessage(serviceName) {
  return [
    'Acces restreint',
    '',
    'Le service "' + serviceName + '" est reserve au pharmacien titulaire de l\'officine.',
    '',
    'Si vous etes titulaire, mettez a jour votre role en tapant PROFIL.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Templates Meta WhatsApp Business — Prêts à soumettre
// ---------------------------------------------------------------------------

/**
 * Définitions des templates Meta à créer via Twilio Content Template Builder
 * ou directement dans le Meta Business Manager.
 *
 * Pour chaque template :
 *   - name       : identifiant interne snake_case
 *   - category   : 'UTILITY' (non promotionnel, conforme Meta)
 *   - language   : 'fr'
 *   - body_text  : corps du message (variables sous forme {{1}}, {{2}})
 *   - variables  : description des variables éventuelles
 *   - buttons    : boutons quick-reply si supportés
 *   - dev_note   : justification de conformité Meta (pour documentation interne)
 */
const META_TEMPLATES = [
  {
    name: 'consent_request_v1',
    category: 'UTILITY',
    language: 'fr',
    body_text: [
      'Pour utiliser Assistant Pharmacie, veuillez confirmer :',
      '',
      '✔ Je suis pharmacien ou j\'utilise ce service sous ma responsabilite',
      '✔ J\'accepte de recevoir des messages WhatsApp lies aux services actives',
      '✔ Je comprends que les informations doivent etre validees par l\'utilisateur',
      '✔ Je respecte les prerogatives et les limites de mon role',
      '',
      'Repondez OUI pour continuer, NON pour refuser, ou EN SAVOIR PLUS.',
    ].join('\n'),
    variables: [],
    buttons: [
      { type: 'QUICK_REPLY', text: 'OUI' },
      { type: 'QUICK_REPLY', text: 'NON' },
      { type: 'QUICK_REPLY', text: 'EN SAVOIR PLUS' },
    ],
    dev_note: 'Template utilitaire conforme Meta. Non promotionnel. Texte < 1024 caracteres. Boutons quick-reply optimaux sur mobile. Aucune variable requise pour l\'envoi initial hors fenetre 24h.',
  },
  {
    name: 'consent_reminder_v1',
    category: 'UTILITY',
    language: 'fr',
    body_text: [
      'Bonjour {{1}},',
      '',
      'Vous n\'avez pas encore active votre acces a Assistant Pharmacie.',
      '',
      'Repondez OUI pour activer le service ou NON pour ne plus recevoir ce rappel.',
    ].join('\n'),
    variables: [
      { index: '1', description: 'Prenom du pharmacien ou "Pharmacien" par defaut si inconnu' },
    ],
    buttons: [
      { type: 'QUICK_REPLY', text: 'OUI' },
      { type: 'QUICK_REPLY', text: 'NON' },
    ],
    dev_note: 'Relance hors fenetre 24h via Twilio Content API. Variable {{1}} = prenom ou "Pharmacien". A envoyer une seule fois par numero non encore consentant. Categorie UTILITY car lié à l\'activation d\'un service demandé.',
  },
  {
    name: 'consent_updated_v1',
    category: 'UTILITY',
    language: 'fr',
    body_text: [
      'Bonjour,',
      '',
      'Nos conditions d\'utilisation ont ete mises a jour (version {{1}}).',
      '',
      'Veuillez confirmer a nouveau votre consentement pour continuer a utiliser Assistant Pharmacie.',
      '',
      'Repondez OUI pour confirmer ou NON pour vous desinscrire.',
    ].join('\n'),
    variables: [
      { index: '1', description: 'Numero de version des nouvelles conditions (ex: v2)' },
    ],
    buttons: [
      { type: 'QUICK_REPLY', text: 'OUI' },
      { type: 'QUICK_REPLY', text: 'NON' },
    ],
    dev_note: 'Notifie les utilisateurs existants d\'une mise a jour des CGU. Declenche quand CONSENT_CURRENT_VERSION change. Envoyer via Messaging Service pour contourner la fenetre 24h. Variable {{1}} = nouvelle version.',
  },
  {
    name: 'reporting_optin_v1',
    category: 'UTILITY',
    language: 'fr',
    body_text: [
      'Bonjour,',
      '',
      'Vous avez active le module de reporting pour votre pharmacie.',
      '',
      'Pour recevoir les rapports automatiques (stock, ventes), confirmez :',
      '',
      '✔ J\'accepte de recevoir des messages automatiques de reporting',
      '✔ Je comprends que ces messages sont envoyes selon la frequence que j\'ai choisie',
      '',
      'Repondez OUI pour confirmer ou NON pour annuler.',
    ].join('\n'),
    variables: [],
    buttons: [
      { type: 'QUICK_REPLY', text: 'OUI' },
      { type: 'QUICK_REPLY', text: 'NON' },
    ],
    dev_note: 'Consentement specifique requis avant tout envoi automatique de reporting. Stocke dans subscriptions avec source "reporting_optin". Requis par les regles Meta : les messages automatiques non-transactionnels necessitent un double opt-in explicite.',
  },
  {
    name: 'email_collection_notice_v1',
    category: 'UTILITY',
    language: 'fr',
    body_text: [
      'Bonjour,',
      '',
      'Pour recevoir vos rapports par email, veuillez fournir votre adresse email.',
      '',
      'Repondez avec votre adresse email ou PASSER pour continuer sans email.',
    ].join('\n'),
    variables: [],
    buttons: [],
    dev_note: 'Accompagne la collecte d\'email pour le reporting. Pas de bouton : l\'utilisateur doit saisir son email en texte libre. Message simple et non promotionnel, clair sur l\'objectif de la collecte. Conforme au RGPD / régulation marocaine sur les données personnelles.',
  },
  {
    name: 'stop_confirmation_v1',
    category: 'UTILITY',
    language: 'fr',
    body_text: [
      'Votre desinscription a ete confirmee.',
      '',
      'Vous ne recevrez plus de messages de Assistant Pharmacie.',
      '',
      'Pour reactiver le service, repondez OUI.',
    ].join('\n'),
    variables: [],
    buttons: [],
    dev_note: 'Confirmation de desinscription apres commande STOP. Envoi unique. Conforme aux exigences Meta : tout opt-out doit etre confirme explicitement. Pas de bouton car c\'est le message final de la sequence de desinscription.',
  },
];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  CONSENT_CURRENT_VERSION,
  ROLES,
  ROLE_LABELS,
  META_TEMPLATES,
  getConsentTextSnapshot,
  buildConsentShort,
  buildConsentLong,
  buildConsentVersionUpdate,
  buildConsentConfirmation,
  buildConsentDeclined,
  buildConsentRevoked,
  buildRoleRestrictionMessage,
  isRoleRestricted,
};
