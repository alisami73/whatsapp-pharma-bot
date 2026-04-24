const fs = require('fs');
const path = require('path');

const twilioService = require('./twilio_service');

const fsp = fs.promises;
const DATA_DIR = path.join(__dirname, 'data');

const DATA_FILES = {
  themes: path.join(DATA_DIR, 'themes.json'),
  content: path.join(DATA_DIR, 'content.json'),
  users: path.join(DATA_DIR, 'users.json'),
  consents: path.join(DATA_DIR, 'consents.json'),
  subscriptions: path.join(DATA_DIR, 'subscriptions.json'),
  messageLogs: path.join(DATA_DIR, 'message_logs.json'),
  // CRM pharmaciens (ajouté pour enrichissement progressif)
  pharmacists: path.join(DATA_DIR, 'pharmacists.json'),
};

const DEFAULT_DATA = {
  themes: [
    {
      id: 'fse',
      title: 'Feuille de soins electronique',
      active: true,
      intro_message: 'Bienvenue dans le module FSE. Posez votre question librement.',
      current_focus: 'Transmission, rejets et suivi des feuilles de soins electroniques.',
      requires_auth: false,
      allow_free_question: true,
      allow_subscription: true,
    },
    {
      id: 'nouveautes-medicaments',
      title: 'Nouveautes medicaments',
      active: true,
      intro_message: 'Retrouvez les informations utiles sur les nouveautes, campagnes et produits recents.',
      current_focus: 'Mises a jour mensuelles, campagnes et nouveaux produits.',
      requires_auth: false,
      allow_free_question: true,
      allow_subscription: true,
    },
    {
      id: 'acces-stock',
      title: 'Acces a mon stock',
      active: true,
      intro_message: 'Consultez les sujets lies a votre stock et a la disponibilite des produits.',
      current_focus: 'Disponibilite produit, ecarts de stock et reapprovisionnement.',
      requires_auth: true,
      allow_free_question: true,
      allow_subscription: false,
    },
  ],
  content: {
    fse: [
      {
        id: 'fse-refusee',
        title: 'FSE refusee',
        answer: "Les causes les plus frequentes sont une erreur d'identification patient, une convention non a jour ou une teletransmission incomplete. Verifiez les donnees, la date de soin et relancez l'envoi apres correction.",
        keywords: ['fse refusee', 'refus', 'rejete', 'cnss', 'teletransmission'],
      },
      {
        id: 'envoyer-fse',
        title: 'Comment envoyer une FSE',
        answer: "Ouvrez le dossier patient, verifiez les droits, controlez les donnees obligatoires puis lancez la transmission depuis votre logiciel. En cas d'echec, conservez le message d'erreur pour analyse.",
        keywords: ['envoyer fse', 'transmettre', 'teletransmission', 'envoi', 'feuille de soins'],
      },
      {
        id: 'probleme-cnss',
        title: 'Probleme CNSS',
        answer: "Si la CNSS bloque le traitement, controlez le numero d'affiliation, la validite des droits et la coherence entre ordonnance et prestation. Si le blocage persiste, remontez le dossier avec la reference de la FSE.",
        keywords: ['cnss', 'affiliation', 'droits', 'blocage', 'assure'],
      },
    ],
    'nouveautes-medicaments': [
      {
        id: 'nouveaux-produits',
        title: 'Nouveaux produits du mois',
        answer: 'Cette rubrique peut etre mise a jour chaque mois pour publier les nouveaux produits, les campagnes saisonnieres et les informations de lancement.',
        keywords: ['nouveau', 'nouveaute', 'mois', 'campagne', 'lancement'],
      },
      {
        id: 'promotions-labos',
        title: 'Promotions laboratoires',
        answer: 'Ajoutez ici les offres fournisseurs en cours, les conditions de commande et les dates limites de validite pour aider les equipes en officine.',
        keywords: ['promotion', 'labo', 'offre', 'commande', 'remise'],
      },
    ],
    'acces-stock': [
      {
        id: 'produit-indisponible',
        title: 'Produit indisponible',
        answer: "Controlez d'abord le stock theorique, puis les receptions en attente et les sorties recentes. Si l'ecart persiste, faites un inventaire rapide et informez votre responsable.",
        keywords: ['rupture', 'indisponible', 'stock', 'manquant', 'inventaire'],
      },
      {
        id: 'demande-reappro',
        title: 'Demande de reapprovisionnement',
        answer: "Preparez la liste des references critiques, verifiez les seuils mini et transmettez la demande de reapprovisionnement via votre circuit habituel pour eviter une rupture prolongee.",
        keywords: ['reapprovisionnement', 'reappro', 'commande', 'seuil', 'approvisionnement'],
      },
    ],
  },
  users: [],
  consents: [],
  subscriptions: [],
  messageLogs: [],
  pharmacists: [],
};

const writeQueues = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDefaultData(name) {
  return clone(DEFAULT_DATA[name]);
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// module_type contrôle le routage conversation :
//   'knowledge_base' (défaut) - Q&A depuis content.json
//   'medindex'                 - Recherche API MedIndex
//   'interactions'             - Vérificateur d'interactions médicamenteuses
//   'monitoring'               - Monitoring Blink/Sobrus
//   'cnss'                     - Base documentaire CNSS/FSE via Azure OpenAI
const VALID_MODULE_TYPES = ['knowledge_base', 'medindex', 'interactions', 'monitoring', 'cnss'];

function normalizeTheme(theme) {
  const rawModuleType = String(theme.module_type || 'knowledge_base').trim();
  return {
    id: String(theme.id || '').trim(),
    title: String(theme.title || '').trim(),
    active: Boolean(theme.active),
    intro_message: String(theme.intro_message || '').trim(),
    current_focus: String(theme.current_focus || '').trim(),
    requires_auth: Boolean(theme.requires_auth),
    allow_free_question: theme.allow_free_question !== false,
    allow_subscription: Boolean(theme.allow_subscription),
    module_type: VALID_MODULE_TYPES.includes(rawModuleType) ? rawModuleType : 'knowledge_base',
  };
}

function normalizePhone(value) {
  return twilioService.normalizeWhatsAppAddress(value);
}

function phonesMatch(left, right) {
  const normalizedLeft = normalizePhone(left);
  const normalizedRight = normalizePhone(right);

  if (normalizedLeft && normalizedRight) {
    return normalizedLeft === normalizedRight;
  }

  return String(left || '').trim() === String(right || '').trim();
}

// Sources valides pour le consentement
const VALID_CONSENT_SOURCES = [
  'explicit_consent',
  'stored_opt_in',
  'inbound_reply',
  'whatsapp_manual',
  'template',
  'refused',
  'revoked',
];

function normalizeConsent(consent) {
  const rawSource = consent.source || 'explicit_consent';
  const source = VALID_CONSENT_SOURCES.includes(rawSource) ? rawSource : 'explicit_consent';

  // Dérive le statut depuis la source si non fourni (compat ascendante)
  const statusFromSource =
    source === 'explicit_consent' ||
    source === 'inbound_reply' ||
    source === 'whatsapp_manual' ||
    source === 'template'
      ? 'accepted'
      : source === 'stored_opt_in'
      ? 'pending'
      : source === 'refused'
      ? 'refused'
      : source === 'revoked'
      ? 'revoked'
      : 'pending';

  const consentStatus = consent.consent_status || statusFromSource;
  const acceptedAt =
    consentStatus === 'accepted'
      ? consent.accepted_at || consent.consented_at || new Date().toISOString()
      : null;

  return {
    phone: normalizePhone(consent.phone),
    // Champs legacy conservés pour compatibilité avec hasConsent / grantConsent
    consented_at: consent.consented_at || acceptedAt || new Date().toISOString(),
    source,
    // Champs enrichis pour audit trail
    consent_status: consentStatus,              // 'accepted' | 'refused' | 'revoked' | 'pending'
    consent_version: consent.consent_version || null,
    consent_text_snapshot: consent.consent_text_snapshot || null,
    channel: consent.channel || 'whatsapp',
    accepted_at: acceptedAt,
    refused_at: consent.refused_at || null,
    revoked_at: consent.revoked_at || null,
    role_declared: consent.role_declared || null,
    notes: consent.notes || null,
  };
}

function normalizeUser(user) {
  const rawUserLanguage = String(user.user_language || '').trim().toLowerCase();
  const userLanguage = rawUserLanguage || null;

  return {
    ...user,
    phone: normalizePhone(user.phone),
    current_theme: user.current_theme || null,
    current_state: user.current_state || 'main_menu',
    authenticated: Boolean(user.authenticated),
    user_language: userLanguage,
    updated_at: new Date().toISOString(),
  };
}

function normalizeSubscription(subscription) {
  return {
    phone: normalizePhone(subscription.phone),
    theme_id: String(subscription.theme_id || '').trim(),
    subscribed_at: subscription.subscribed_at || new Date().toISOString(),
  };
}

function normalizeMessageLog(entry) {
  return {
    id: String(entry.id || '').trim(),
    direction: entry.direction === 'outbound' ? 'outbound' : 'inbound',
    channel: 'whatsapp',
    phone: normalizePhone(entry.phone),
    theme_id: entry.theme_id || null,
    body: String(entry.body || '').trim(),
    status: String(
      entry.status || (entry.direction === 'outbound' ? 'pending' : 'received'),
    ).trim(),
    provider: 'twilio',
    provider_message_sid: entry.provider_message_sid
      ? String(entry.provider_message_sid).trim()
      : null,
    error_code: entry.error_code ? String(entry.error_code).trim() : null,
    error_message: entry.error_message ? String(entry.error_message).trim() : null,
    metadata:
      entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
        ? entry.metadata
        : {},
    created_at: entry.created_at || new Date().toISOString(),
    updated_at: entry.updated_at || new Date().toISOString(),
  };
}

async function ensureJsonFile(name) {
  const filePath = DATA_FILES[name];
  const fallbackValue = getDefaultData(name);

  await fsp.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fsp.access(filePath, fs.constants.F_OK);
  } catch (error) {
    await fsp.writeFile(filePath, JSON.stringify(fallbackValue, null, 2));
    return;
  }

  try {
    const raw = await fsp.readFile(filePath, 'utf8');

    if (!raw.trim()) {
      throw new Error('Empty JSON file');
    }

    JSON.parse(raw);
  } catch (error) {
    await fsp.writeFile(filePath, JSON.stringify(fallbackValue, null, 2));
  }
}

async function initializeStorage() {
  await Promise.all(Object.keys(DATA_FILES).map((name) => ensureJsonFile(name)));
}

async function readJson(name) {
  await ensureJsonFile(name);
  const raw = await fsp.readFile(DATA_FILES[name], 'utf8');
  return JSON.parse(raw);
}

async function writeJson(name, value) {
  const filePath = DATA_FILES[name];
  const tmpPath = `${filePath}.tmp`;
  const payload = JSON.stringify(value, null, 2);
  const previousWrite = writeQueues.get(filePath) || Promise.resolve();

  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(async () => {
      await ensureJsonFile(name);
      await fsp.writeFile(tmpPath, payload);
      await fsp.rename(tmpPath, filePath); // atomic on Linux: prevents corruption on mid-write crash
      return clone(value);
    });

  writeQueues.set(filePath, nextWrite);
  return nextWrite;
}

function buildUniqueId(baseValue, existingIds, fallbackPrefix) {
  const base = slugify(baseValue) || `${fallbackPrefix}-${Date.now()}`;
  let candidate = base;
  let counter = 1;

  while (existingIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

async function getThemes() {
  const themes = await readJson('themes');
  return Array.isArray(themes) ? themes.map(normalizeTheme) : getDefaultData('themes');
}

async function getTheme(themeId) {
  const themes = await getThemes();
  return themes.find((theme) => theme.id === themeId) || null;
}

async function saveThemes(themes) {
  return writeJson('themes', themes.map(normalizeTheme));
}

async function createTheme(payload) {
  const themes = await getThemes();
  const existingIds = new Set(themes.map((theme) => theme.id));
  const id = buildUniqueId(payload.id || payload.title, existingIds, 'theme');
  const theme = normalizeTheme({
    id,
    title: payload.title,
    active: payload.active,
    intro_message: payload.intro_message,
    current_focus: payload.current_focus,
    requires_auth: payload.requires_auth,
    allow_free_question: payload.allow_free_question,
    allow_subscription: payload.allow_subscription,
  });

  themes.push(theme);
  await saveThemes(themes);

  const content = await getContent();

  if (!Array.isArray(content[id])) {
    content[id] = [];
    await saveContent(content);
  }

  return theme;
}

async function updateTheme(themeId, payload) {
  const themes = await getThemes();
  const index = themes.findIndex((theme) => theme.id === themeId);

  if (index === -1) {
    return null;
  }

  const nextTheme = normalizeTheme({
    ...themes[index],
    title: payload.title,
    active: payload.active,
    intro_message: payload.intro_message,
    current_focus: payload.current_focus,
    requires_auth: payload.requires_auth,
    allow_free_question: payload.allow_free_question,
    allow_subscription: payload.allow_subscription,
  });

  themes[index] = nextTheme;
  await saveThemes(themes);
  return nextTheme;
}

async function deleteTheme(themeId) {
  const themes = await getThemes();
  const nextThemes = themes.filter((theme) => theme.id !== themeId);

  if (nextThemes.length === themes.length) {
    return false;
  }

  await saveThemes(nextThemes);

  const content = await getContent();

  if (Object.prototype.hasOwnProperty.call(content, themeId)) {
    delete content[themeId];
    await saveContent(content);
  }

  const users = await getUsers();
  const nextUsers = users.map((user) => {
    if (user.current_theme !== themeId) {
      return user;
    }

    return {
      ...user,
      current_theme: null,
      current_state: 'main_menu',
      updated_at: new Date().toISOString(),
    };
  });

  await saveUsers(nextUsers);
  await removeThemeSubscriptions(themeId);
  return true;
}

async function getContent() {
  return readJson('content');
}

async function saveContent(content) {
  return writeJson('content', content);
}

async function getTopics(themeId) {
  const content = await getContent();
  return Array.isArray(content[themeId]) ? content[themeId] : [];
}

async function createTopic(themeId, payload) {
  const content = await getContent();
  const topics = Array.isArray(content[themeId]) ? content[themeId] : [];
  const existingIds = new Set(topics.map((topic) => topic.id));
  const id = buildUniqueId(payload.id || payload.title, existingIds, 'topic');

  const topic = {
    id,
    title: payload.title,
    answer: payload.answer || '',
    keywords: Array.isArray(payload.keywords) ? payload.keywords : [],
  };

  content[themeId] = [...topics, topic];
  await saveContent(content);
  return topic;
}

async function updateTopic(themeId, topicId, payload) {
  const content = await getContent();
  const topics = Array.isArray(content[themeId]) ? content[themeId] : [];
  const index = topics.findIndex((topic) => topic.id === topicId);

  if (index === -1) {
    return null;
  }

  const nextTopic = {
    ...topics[index],
    title: payload.title,
    answer: payload.answer || '',
    keywords: Array.isArray(payload.keywords) ? payload.keywords : [],
  };

  topics[index] = nextTopic;
  content[themeId] = topics;
  await saveContent(content);
  return nextTopic;
}

async function deleteTopic(themeId, topicId) {
  const content = await getContent();
  const topics = Array.isArray(content[themeId]) ? content[themeId] : [];
  const nextTopics = topics.filter((topic) => topic.id !== topicId);

  if (nextTopics.length === topics.length) {
    return false;
  }

  content[themeId] = nextTopics;
  await saveContent(content);
  return true;
}

async function getUsers() {
  return readJson('users');
}

async function saveUsers(users) {
  return writeJson('users', users.map(normalizeUser));
}

async function getUser(phone) {
  const users = await getUsers();
  return users.find((user) => phonesMatch(user.phone, phone)) || null;
}

async function saveUser(user) {
  const normalized = normalizeUser(user);
  const users = await getUsers();
  const index = users.findIndex((entry) => phonesMatch(entry.phone, normalized.phone));

  if (index === -1) {
    users.push(normalized);
  } else {
    users[index] = {
      ...users[index],
      ...normalized,
    };
  }

  await saveUsers(users);
  return normalized;
}

async function resetUser(phone) {
  return saveUser({
    phone,
    current_theme: null,
    current_state: 'awaiting_consent',
    authenticated: false,
  });
}

async function getConsents() {
  const consents = await readJson('consents');
  return Array.isArray(consents) ? consents.map(normalizeConsent) : [];
}

async function saveConsents(consents) {
  return writeJson('consents', consents.map(normalizeConsent));
}

async function hasConsent(phone) {
  const normalizedPhone = normalizePhone(phone);
  const consents = await getConsents();
  return consents.some(
    (entry) =>
      phonesMatch(entry.phone, normalizedPhone) &&
      (entry.consent_status === 'accepted' || entry.source === 'explicit_consent'),
  );
}

async function grantConsent(phone) {
  const normalizedPhone = normalizePhone(phone);
  const consents = await getConsents();
  const existingIndex = consents.findIndex((entry) =>
    phonesMatch(entry.phone, normalizedPhone),
  );

  if (existingIndex !== -1) {
    const existing = consents[existingIndex];
    const nextConsent = normalizeConsent({
      ...existing,
      phone: normalizedPhone,
      consented_at:
        existing.source === 'explicit_consent'
          ? existing.consented_at
          : new Date().toISOString(),
      source: 'explicit_consent',
    });

    if (
      existing.phone !== nextConsent.phone ||
      existing.consented_at !== nextConsent.consented_at ||
      existing.source !== nextConsent.source
    ) {
      consents[existingIndex] = nextConsent;
      await saveConsents(consents);
    }

    return nextConsent;
  }

  const consent = normalizeConsent({
    phone: normalizedPhone,
    consented_at: new Date().toISOString(),
    source: 'explicit_consent',
  });

  consents.push(consent);
  await saveConsents(consents);
  return consent;
}

async function revokeConsent(phone) {
  const normalizedPhone = normalizePhone(phone);
  const consents = await getConsents();
  const nextConsents = consents.filter(
    (entry) => !phonesMatch(entry.phone, normalizedPhone),
  );

  if (nextConsents.length === consents.length) {
    return false;
  }

  await saveConsents(nextConsents);
  return true;
}

/**
 * Retourne l'entrée de consentement complète pour un numéro (ou null si absent).
 * Inclut tous les champs enrichis (consent_status, consent_version, role_declared, etc.)
 * @param {string} phone
 * @returns {Promise<object|null>}
 */
async function getConsentRecord(phone) {
  const normalizedPhone = normalizePhone(phone);
  const consents = await getConsents();
  return consents.find((entry) => phonesMatch(entry.phone, normalizedPhone)) || null;
}

/**
 * Enregistre un refus explicite (NON) sans supprimer l'entrée de consentement.
 * Permet l'audit trail et de ne pas respace si l'utilisateur re-contacte plus tard.
 * Distinct de revokeConsent (STOP) qui supprime l'entrée.
 * @param {string} phone
 * @returns {Promise<object>}
 */
async function refuseConsent(phone) {
  const normalizedPhone = normalizePhone(phone);
  const consents = await getConsents();
  const existingIndex = consents.findIndex((entry) => phonesMatch(entry.phone, normalizedPhone));
  const now = new Date().toISOString();

  const refusedEntry = normalizeConsent({
    ...(existingIndex !== -1 ? consents[existingIndex] : { phone: normalizedPhone }),
    source: 'refused',
    consent_status: 'refused',
    refused_at: now,
    accepted_at: null,
    revoked_at: null,
  });

  if (existingIndex !== -1) {
    consents[existingIndex] = refusedEntry;
  } else {
    consents.push(refusedEntry);
  }
  await saveConsents(consents);
  return refusedEntry;
}

/**
 * Met à jour le rôle déclaré dans l'entrée de consentement (audit trail).
 * @param {string} phone
 * @param {string} role - 'titulaire' | 'adjoint' | 'autre'
 * @returns {Promise<object|null>} - null si l'entrée n'existe pas
 */
async function updateConsentRole(phone, role) {
  const normalizedPhone = normalizePhone(phone);
  const consents = await getConsents();
  const existingIndex = consents.findIndex((entry) => phonesMatch(entry.phone, normalizedPhone));
  if (existingIndex === -1) return null;
  consents[existingIndex] = normalizeConsent({ ...consents[existingIndex], role_declared: role });
  await saveConsents(consents);
  return consents[existingIndex];
}

/**
 * Version enrichie de grantConsent avec version, rôle, snapshot textuel.
 * Remplace grantConsent dans les nouveaux flux tout en restant compatible.
 * @param {string} phone
 * @param {{ version?: string, role?: string, textSnapshot?: string, source?: string, notes?: string }} options
 * @returns {Promise<object>}
 */
async function grantConsentWithMeta(phone, options = {}) {
  const normalizedPhone = normalizePhone(phone);
  const consents = await getConsents();
  const existingIndex = consents.findIndex((entry) => phonesMatch(entry.phone, normalizedPhone));
  const now = new Date().toISOString();
  const { version, role, textSnapshot, source, notes } = options;

  const base = existingIndex !== -1 ? consents[existingIndex] : { phone: normalizedPhone };
  const nextConsent = normalizeConsent({
    ...base,
    source: source || 'explicit_consent',
    consent_status: 'accepted',
    consent_version: version || null,
    consent_text_snapshot: textSnapshot || null,
    role_declared: role || base.role_declared || null,
    notes: notes || base.notes || null,
    accepted_at: now,
    consented_at: now,
    refused_at: null,
    revoked_at: null,
  });

  if (existingIndex !== -1) {
    consents[existingIndex] = nextConsent;
  } else {
    consents.push(nextConsent);
  }
  await saveConsents(consents);
  return nextConsent;
}

async function getSubscriptions() {
  const subscriptions = await readJson('subscriptions');
  return Array.isArray(subscriptions)
    ? subscriptions.map(normalizeSubscription)
    : getDefaultData('subscriptions');
}

async function saveSubscriptions(subscriptions) {
  return writeJson('subscriptions', subscriptions.map(normalizeSubscription));
}

async function getUserSubscriptions(phone) {
  const subscriptions = await getSubscriptions();
  return subscriptions.filter((entry) => phonesMatch(entry.phone, phone));
}

async function isSubscribed(phone, themeId) {
  const subscriptions = await getSubscriptions();
  return subscriptions.some(
    (entry) => phonesMatch(entry.phone, phone) && entry.theme_id === themeId,
  );
}

async function subscribeUserToTheme(phone, themeId) {
  const subscriptions = await getSubscriptions();
  const normalizedPhone = normalizePhone(phone);
  const existing = subscriptions.find(
    (entry) => phonesMatch(entry.phone, normalizedPhone) && entry.theme_id === themeId,
  );

  if (existing) {
    return existing;
  }

  const subscription = normalizeSubscription({
    phone: normalizedPhone,
    theme_id: themeId,
    subscribed_at: new Date().toISOString(),
  });

  subscriptions.push(subscription);
  await saveSubscriptions(subscriptions);
  return subscription;
}

async function removeUserSubscriptions(phone) {
  const subscriptions = await getSubscriptions();
  const normalizedPhone = normalizePhone(phone);
  const nextSubscriptions = subscriptions.filter(
    (entry) => !phonesMatch(entry.phone, normalizedPhone),
  );

  if (nextSubscriptions.length === subscriptions.length) {
    return false;
  }

  await saveSubscriptions(nextSubscriptions);
  return true;
}

async function removeThemeSubscriptions(themeId) {
  const subscriptions = await getSubscriptions();
  const nextSubscriptions = subscriptions.filter((entry) => entry.theme_id !== themeId);

  if (nextSubscriptions.length === subscriptions.length) {
    return false;
  }

  await saveSubscriptions(nextSubscriptions);
  return true;
}

async function getMessageLogs() {
  const messageLogs = await readJson('messageLogs');
  return Array.isArray(messageLogs)
    ? messageLogs.map(normalizeMessageLog)
    : getDefaultData('messageLogs');
}

async function saveMessageLogs(messageLogs) {
  return writeJson('messageLogs', messageLogs.map(normalizeMessageLog));
}

async function appendMessageLog(payload) {
  const messageLogs = await getMessageLogs();

  if (payload.provider_message_sid) {
    const existing = messageLogs.find(
      (entry) =>
        entry.provider_message_sid === payload.provider_message_sid &&
        entry.direction === (payload.direction === 'outbound' ? 'outbound' : 'inbound'),
    );

    if (existing) {
      return existing;
    }
  }

  const id = buildUniqueId(
    payload.provider_message_sid || `message-${Date.now()}`,
    new Set(messageLogs.map((entry) => entry.id)),
    'message',
  );
  const now = new Date().toISOString();
  const nextEntry = normalizeMessageLog({
    ...payload,
    id,
    created_at: now,
    updated_at: now,
  });

  messageLogs.push(nextEntry);
  await saveMessageLogs(messageLogs);
  return nextEntry;
}

async function updateMessageLog(logId, patch) {
  const messageLogs = await getMessageLogs();
  const index = messageLogs.findIndex((entry) => entry.id === logId);

  if (index === -1) {
    return null;
  }

  const nextEntry = normalizeMessageLog({
    ...messageLogs[index],
    ...patch,
    metadata: patch.metadata
      ? { ...messageLogs[index].metadata, ...patch.metadata }
      : messageLogs[index].metadata,
    created_at: messageLogs[index].created_at,
    updated_at: new Date().toISOString(),
  });

  messageLogs[index] = nextEntry;
  await saveMessageLogs(messageLogs);
  return nextEntry;
}

async function updateMessageLogByProviderSid(providerMessageSid, patch) {
  const messageLogs = await getMessageLogs();
  const index = messageLogs.findIndex(
    (entry) => entry.provider_message_sid === providerMessageSid,
  );

  if (index === -1) {
    return null;
  }

  const nextEntry = normalizeMessageLog({
    ...messageLogs[index],
    ...patch,
    metadata: patch.metadata
      ? { ...messageLogs[index].metadata, ...patch.metadata }
      : messageLogs[index].metadata,
    created_at: messageLogs[index].created_at,
    updated_at: new Date().toISOString(),
  });

  messageLogs[index] = nextEntry;
  await saveMessageLogs(messageLogs);
  return nextEntry;
}

async function listMessageLogs(limit = 50) {
  const messageLogs = await getMessageLogs();
  return messageLogs
    .slice()
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// CRM Pharmacists
// ---------------------------------------------------------------------------

const VALID_PHARMACIST_ROLES = ['titulaire', 'adjoint', 'autre'];
const VALID_ENTRY_CHOICES = ['faq', 'medicaments', 'logiciel', 'services'];

function normalizePharmacist(entry) {
  const rawRole = entry.role || null;
  return {
    phone: normalizePhone(entry.phone),
    name: entry.name ? String(entry.name).trim().slice(0, 80) : null,
    pharmacy_name: entry.pharmacy_name ? String(entry.pharmacy_name).trim().slice(0, 100) : null,
    city: entry.city ? String(entry.city).trim().slice(0, 80) : null,
    role: rawRole && VALID_PHARMACIST_ROLES.includes(rawRole) ? rawRole : null, // 'titulaire' | 'adjoint' | 'autre' | null
    entry_choice:
      entry.entry_choice && VALID_ENTRY_CHOICES.includes(String(entry.entry_choice).trim().toLowerCase())
        ? String(entry.entry_choice).trim().toLowerCase()
        : null,
    software: entry.software || null, // 'blink' | 'sobrus' | 'autre' | null
    software_pharmacy_id: entry.software_pharmacy_id ? String(entry.software_pharmacy_id).trim() : null,
    onboarding_completed: Boolean(entry.onboarding_completed),
    created_at: entry.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function getPharmacists() {
  const data = await readJson('pharmacists');
  return Array.isArray(data) ? data.map(normalizePharmacist) : [];
}

async function savePharmacists(pharmacists) {
  return writeJson('pharmacists', pharmacists.map(normalizePharmacist));
}

async function getPharmacist(phone) {
  const pharmacists = await getPharmacists();
  return pharmacists.find((entry) => phonesMatch(entry.phone, phone)) || null;
}

async function savePharmacist(pharmacist) {
  const normalized = normalizePharmacist(pharmacist);
  const pharmacists = await getPharmacists();
  const index = pharmacists.findIndex((entry) => phonesMatch(entry.phone, normalized.phone));

  if (index === -1) {
    // Préserver created_at si c'est un nouveau pharmacien
    normalized.created_at = new Date().toISOString();
    pharmacists.push(normalized);
  } else {
    pharmacists[index] = {
      ...pharmacists[index],
      ...normalized,
      created_at: pharmacists[index].created_at, // ne pas écraser la date de création
    };
  }

  await savePharmacists(pharmacists);
  return normalized;
}

async function listPharmacists(limit = 100) {
  const pharmacists = await getPharmacists();
  return pharmacists
    .slice()
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, limit);
}

module.exports = {
  DATA_DIR,
  DATA_FILES,
  initializeStorage,
  slugify,
  getThemes,
  getTheme,
  createTheme,
  updateTheme,
  deleteTheme,
  getContent,
  getTopics,
  createTopic,
  updateTopic,
  deleteTopic,
  getUsers,
  getUser,
  saveUser,
  resetUser,
  getConsents,
  hasConsent,
  grantConsent,
  grantConsentWithMeta,
  refuseConsent,
  revokeConsent,
  getConsentRecord,
  updateConsentRole,
  getSubscriptions,
  getUserSubscriptions,
  isSubscribed,
  subscribeUserToTheme,
  removeUserSubscriptions,
  removeThemeSubscriptions,
  getMessageLogs,
  appendMessageLog,
  updateMessageLog,
  updateMessageLogByProviderSid,
  listMessageLogs,
  // CRM Pharmacists
  getPharmacist,
  savePharmacist,
  getPharmacists,
  listPharmacists,
};
