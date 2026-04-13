require('dotenv').config();

const express = require('express');
const twilio = require('twilio');

const adminRoutes = require('./admin_routes');
const storage = require('./storage');
const twilioService = require('./twilio_service');

// Modules métier
const medindex = require('./modules/medindex');
const interactions = require('./modules/interactions');
const monitoring = require('./modules/monitoring');
const onboarding = require('./modules/onboarding');
const consent = require('./modules/consent');
const cnss = require('./modules/cnss');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const { MessagingResponse } = twilio.twiml;

const STATES = {
  AWAITING_CONSENT: 'awaiting_consent',
  AWAITING_CONSENT_DETAILS: 'awaiting_consent_details', // après "EN SAVOIR PLUS"
  MAIN_MENU: 'main_menu',
  THEME_MENU: 'theme_menu',
  AWAITING_FREE_QUESTION: 'awaiting_free_question',
  AWAITING_AUTH: 'awaiting_auth',
  // Onboarding progressif (post-consentement) — inclut désormais ONBOARDING_ROLE en premier
  ...onboarding.ONBOARDING_STATES,
  // Modules spéciaux
  AWAITING_MEDINDEX_QUERY: 'awaiting_medindex_query',
  AWAITING_INTERACTION_DRUGS: 'awaiting_interaction_drugs',
  AWAITING_MONITORING_CHOICE: 'awaiting_monitoring_choice',
  AWAITING_CNSS_QUESTION: 'awaiting_cnss_question',
};

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/admin', adminRoutes);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(value) {
  return normalizeText(value)
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isNumberSelection(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function getRequestContext(req) {
  const message = String(req.body.Body || '').trim();
  const payload = String(req.body.ButtonPayload || req.body.Payload || '').trim();
  const phone = twilioService.normalizeWhatsAppAddress(
    req.body.From || req.body.WaId || '',
  );

  return {
    phone,
    message,
    payload,
    normalizedMessage: normalizeText(message),
    normalizedPayload: normalizeText(payload),
  };
}

// Les textes de consentement sont désormais gérés par modules/consent.js.
// buildConsentMessage / buildConsentDeclinedMessage sont conservés comme wrappers
// pour faciliter d'éventuelles surcharges futures sans toucher à la logique principale.

function buildConsentMessage() {
  return consent.buildConsentShort();
}

function buildConsentDeclinedMessage() {
  return consent.buildConsentDeclined();
}

function buildMainMenu(themes) {
  if (!themes.length) {
    return [
      'Menu principal',
      'Aucun theme actif pour le moment.',
      'Envoyez MENU pour actualiser la liste plus tard.',
      '',
      'Tapez PROFIL pour voir votre profil.',
      'Tapez STOP pour vous desinscrire.',
    ].join('\n');
  }

  const lines = ['Menu principal', ''];

  themes.forEach((theme, index) => {
    lines.push(`${index + 1}. ${theme.title}`);
  });

  lines.push('');
  lines.push('Repondez avec un numero pour ouvrir un theme.');
  lines.push('Tapez MENU pour revoir ce menu.');
  lines.push('Tapez PROFIL pour voir votre profil.');
  lines.push('Tapez AIDE pour l\'aide.');
  lines.push('Tapez STOP pour vous desinscrire.');

  return lines.join('\n');
}

function buildHelpMessage() {
  return [
    'Assistant Pharmacie - Aide',
    '',
    'Commandes disponibles :',
    '- Numero : choisir un theme du menu principal',
    '- MENU : revenir au menu principal',
    '- RETOUR : revenir au menu du theme en cours',
    '- PROFIL : voir votre profil et votre role',
    '- AIDE : afficher ce message',
    '- STOP : vous desinscrire du service',
    '',
    'Les informations fournies sont a valeur informative uniquement.',
    'Elles doivent etre validees par l\'utilisateur avant toute decision.',
  ].join('\n');
}

function buildThemeHeader(theme) {
  return [
    theme.title,
    theme.intro_message || 'Aucune introduction disponible.',
    `Focus actuel: ${theme.current_focus || 'Aucun focus specifique pour le moment.'}`,
  ].join('\n\n');
}

function usesDocumentKnowledge(theme) {
  return Boolean(theme) && (theme.module_type === 'cnss' || theme.id === 'fse');
}

function buildThemeMenu(theme, user) {
  const lines = [buildThemeHeader(theme), ''];

  if (theme.requires_auth && !user.authenticated) {
    lines.push('Pour acceder a ce module via WhatsApp, vous devez connecter votre compte.');
    lines.push('');
    lines.push('1. Recevoir mon lien de connexion');
    lines.push('2. Retour au menu');
    lines.push('');
    lines.push('Repondez avec un numero.');
    lines.push('Vous pouvez aussi envoyer AUTH OK une fois votre connexion effectuee.');
    return lines.join('\n');
  }

  // Libellé de l'action principale selon le module_type
  const mainActionLabel = theme.id === 'fse'
    ? '1. Poser ma question sur la FSE'
    : {
    medindex: '1. Rechercher un medicament (MedIndex)',
    interactions: '1. Analyser des interactions medicamenteuses',
    monitoring: '1. Consulter mon monitoring (stock / ventes)',
    knowledge_base: '1. Poser ma question',
    cnss: '1. Poser ma question sur la CNSS',
  }[theme.module_type] || '1. Poser ma question';
  lines.push(mainActionLabel);

  let optionNumber = 2;

  if (theme.allow_subscription) {
    lines.push(`${optionNumber}. Recevoir les mises a jour de ce theme`);
    optionNumber += 1;
  }

  lines.push(`${optionNumber}. Retour au menu`);
  lines.push('');
  lines.push('Repondez avec un numero.');
  lines.push('Envoyez RETOUR pour revenir au menu principal.');

  return lines.join('\n');
}

function buildAskQuestionPrompt(theme) {
  return [
    `Vous pouvez maintenant poser votre question sur le theme "${theme.title}".`,
    'Nous allons chercher la reponse la plus proche dans notre base interne.',
    'Envoyez RETOUR pour revenir au menu du theme.',
  ].join('\n\n');
}

function buildConnectionLinkMessage(theme) {
  return [
    'Lien de connexion securise:',
    `https://portail-pharmacie.example.com/connexion?module=${encodeURIComponent(theme.id)}`,
    '',
    'Une fois votre connexion effectuee, repondez AUTH OK.',
  ].join('\n');
}

function buildActivationMessage() {
  // Après consentement → démarrer l'onboarding par la demande de rôle
  return onboarding.buildRolePrompt();
}

function buildDisabledMessage() {
  // Utilisé après STOP : délègue au module consent pour cohérence
  return consent.buildConsentRevoked();
}

async function handleProfileRequest(response, user) {
  const pharmacist = (await storage.getPharmacist(user.phone)) || {};
  const consentRecord = await storage.getConsentRecord(user.phone);
  const lines = ['Votre profil', ''];

  if (pharmacist.name) lines.push(`Nom : ${pharmacist.name}`);
  if (pharmacist.pharmacy_name) lines.push(`Pharmacie : ${pharmacist.pharmacy_name}`);
  if (pharmacist.city) lines.push(`Ville : ${pharmacist.city}`);

  const roleLabel = pharmacist.role ? (consent.ROLE_LABELS[pharmacist.role] || pharmacist.role) : null;
  lines.push(`Role : ${roleLabel || 'Non renseigne'}`);

  if (pharmacist.software) lines.push(`Logiciel : ${pharmacist.software}`);

  if (consentRecord) {
    const statusLabel = consentRecord.consent_status === 'accepted' ? 'Accepte' :
                        consentRecord.consent_status === 'refused' ? 'Refuse' :
                        consentRecord.consent_status === 'revoked' ? 'Revoque' : 'En attente';
    lines.push(`Consentement : ${statusLabel}`);
    if (consentRecord.consent_version) {
      lines.push(`Version : ${consentRecord.consent_version}`);
    }
    if (consentRecord.accepted_at) {
      const d = new Date(consentRecord.accepted_at);
      lines.push(`Date : ${d.toLocaleDateString('fr-FR')}`);
    }
  }

  lines.push('');
  lines.push('Tapez STOP pour vous desinscrire.');

  response.message(lines.join('\n'));
}

function scoreTopicMatch(input, topic) {
  const normalizedInput = normalizeText(input);
  const inputTokens = new Set(tokenize(input));
  const keywordValues = Array.isArray(topic.keywords) ? topic.keywords : [];
  const candidateValues = [...keywordValues, topic.title];
  let score = 0;

  candidateValues.forEach((candidate) => {
    const normalizedCandidate = normalizeText(candidate);
    const candidateTokens = tokenize(candidate);

    if (!normalizedCandidate) {
      return;
    }

    if (normalizedInput.includes(normalizedCandidate)) {
      score += normalizedCandidate.split(' ').length + 3;
      return;
    }

    candidateTokens.forEach((token) => {
      if (inputTokens.has(token)) {
        score += 1;
      }
    });
  });

  return score;
}

function findBestTopicMatch(message, topics) {
  let bestTopic = null;
  let bestScore = 0;

  topics.forEach((topic) => {
    const score = scoreTopicMatch(message, topic);

    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  });

  return bestScore > 0 ? bestTopic : null;
}

function findThemeFromPayload(payload, themes) {
  if (!payload.startsWith('theme_')) {
    return null;
  }

  const themeId = payload.slice('theme_'.length);
  return themes.find((theme) => normalizeText(theme.id) === themeId) || null;
}

async function ensureUser(phone) {
  const existingUser = await storage.getUser(phone);

  if (existingUser) {
    return existingUser;
  }

  return storage.saveUser({
    phone,
    current_theme: null,
    current_state: STATES.AWAITING_CONSENT,
    authenticated: false,
  });
}

async function setMainMenuState(user) {
  return storage.saveUser({
    ...user,
    current_theme: null,
    current_state: STATES.MAIN_MENU,
  });
}

async function setThemeMenuState(user, themeId) {
  return storage.saveUser({
    ...user,
    current_theme: themeId,
    current_state: STATES.THEME_MENU,
  });
}

async function setFreeQuestionState(user, themeId) {
  return storage.saveUser({
    ...user,
    current_theme: themeId,
    current_state: STATES.AWAITING_FREE_QUESTION,
  });
}

async function setAwaitingAuthState(user, themeId) {
  return storage.saveUser({
    ...user,
    current_theme: themeId,
    current_state: STATES.AWAITING_AUTH,
  });
}

async function setOnboardingState(user, state) {
  return storage.saveUser({ ...user, current_theme: null, current_state: state });
}

async function setMedindexState(user, themeId) {
  return storage.saveUser({ ...user, current_theme: themeId, current_state: STATES.AWAITING_MEDINDEX_QUERY });
}

async function setInteractionState(user, themeId) {
  return storage.saveUser({ ...user, current_theme: themeId, current_state: STATES.AWAITING_INTERACTION_DRUGS });
}

async function setMonitoringChoiceState(user, themeId) {
  return storage.saveUser({ ...user, current_theme: themeId, current_state: STATES.AWAITING_MONITORING_CHOICE });
}

async function setCnssQuestionState(user, themeId) {
  return storage.saveUser({ ...user, current_theme: themeId, current_state: STATES.AWAITING_CNSS_QUESTION });
}

async function respondWithMainMenu(response, user, prefix = '') {
  const activeThemes = (await storage.getThemes()).filter((theme) => theme.active);
  await setMainMenuState(user);
  const message = buildMainMenu(activeThemes);
  response.message(prefix ? `${prefix}\n\n${message}` : message);
}

async function respondWithThemeMenu(response, user, theme, prefix = '') {
  const nextUser =
    theme.requires_auth && !user.authenticated
      ? await setAwaitingAuthState(user, theme.id)
      : await setThemeMenuState(user, theme.id);
  const menu = buildThemeMenu(theme, nextUser);
  response.message(prefix ? `${prefix}\n\n${menu}` : menu);
}

async function handleThemeSelection(response, user, theme) {
  if (!theme) {
    await respondWithMainMenu(response, user, 'Selection invalide.');
    return;
  }

  await respondWithThemeMenu(response, user, theme);
}

async function handleAuthSelection(response, user, theme, selectedIndex) {
  if (selectedIndex === 0) {
    await respondWithThemeMenu(response, user, theme, buildConnectionLinkMessage(theme));
    return;
  }

  if (selectedIndex === 1) {
    await respondWithMainMenu(response, user);
    return;
  }

  await respondWithThemeMenu(response, user, theme, 'Choix invalide.');
}

async function handleThemeMenuSelection(response, user, theme, selectedIndex) {
  if (theme.requires_auth && !user.authenticated) {
    await handleAuthSelection(response, user, theme, selectedIndex);
    return;
  }

  const actions = ['ask_question'];

  if (theme.allow_subscription) {
    actions.push('subscribe');
  }

  actions.push('back_to_menu');

  const action = actions[selectedIndex];

  if (!action) {
    await respondWithThemeMenu(response, user, theme, 'Choix invalide.');
    return;
  }

  if (action === 'ask_question') {
    // Vérification de restriction par rôle avant d'accéder au service
    const pharmacistForRole = await storage.getPharmacist(user.phone);
    const userRole = pharmacistForRole && pharmacistForRole.role;
    if (consent.isRoleRestricted(userRole, theme)) {
      response.message(consent.buildRoleRestrictionMessage(theme.title));
      return;
    }

    // Pour les modules spéciaux, entrer directement dans l'état du module
    if (theme.module_type === 'medindex') {
      await setMedindexState(user, theme.id);
      response.message(
        `Module MedIndex - Recherche de medicaments\n\n` +
        `Tapez le nom du medicament (nom commercial ou DCI) :\n\nRETOUR pour revenir au menu.`
      );
      return;
    }
    if (theme.module_type === 'interactions') {
      await setInteractionState(user, theme.id);
      response.message(interactions.buildInteractionPrompt());
      return;
    }
    if (theme.module_type === 'monitoring') {
      await setMonitoringChoiceState(user, theme.id);
      const pharmacist = await storage.getPharmacist(user.phone);
      const software = (pharmacist && pharmacist.software) || 'blink';
      response.message(monitoring.buildMonitoringMenu(software));
      return;
    }
    if (usesDocumentKnowledge(theme)) {
      await setCnssQuestionState(user, theme.id);
      response.message(cnss.buildCnssQuestionPrompt(theme));
      return;
    }

    // knowledge_base : comportement existant
    await setFreeQuestionState(user, theme.id);
    response.message(buildAskQuestionPrompt(theme));
    return;
  }

  if (action === 'subscribe') {
    const alreadySubscribed = await storage.isSubscribed(user.phone, theme.id);

    if (alreadySubscribed) {
      await respondWithThemeMenu(
        response,
        user,
        theme,
        'Vous recevez deja les mises a jour de ce theme.',
      );
      return;
    }

    await storage.subscribeUserToTheme(user.phone, theme.id);
    await respondWithThemeMenu(
      response,
      user,
      theme,
      'Votre abonnement aux mises a jour a bien ete active.',
    );
    return;
  }

  await respondWithMainMenu(response, user);
}

async function handleFreeQuestion(response, user, theme, incomingMessage) {
  // Routing selon le module_type du thème
  if (theme.module_type === 'medindex') {
    await setMedindexState(user, theme.id);
    response.message(
      `Module MedIndex - Recherche de medicaments\n\n` +
      `Tapez le nom du medicament (nom commercial ou DCI) pour le rechercher.\n` +
      `Envoyez RETOUR pour revenir au menu.`
    );
    return;
  }

  if (theme.module_type === 'interactions') {
    await setInteractionState(user, theme.id);
    response.message(interactions.buildInteractionPrompt());
    return;
  }

  if (theme.module_type === 'monitoring') {
    await setMonitoringChoiceState(user, theme.id);
    const pharmacist = await storage.getPharmacist(user.phone);
    const software = (pharmacist && pharmacist.software) || 'blink';
    response.message(monitoring.buildMonitoringMenu(software));
    return;
  }

  if (usesDocumentKnowledge(theme)) {
    const answer = await cnss.answerQuestion(incomingMessage, theme.id);
    await setCnssQuestionState(user, theme.id);
    response.message(answer + '\n\nEnvoyez RETOUR pour revenir au menu.');
    return;
  }

  // knowledge_base : comportement existant
  const topics = await storage.getTopics(theme.id);
  const matchedTopic = findBestTopicMatch(incomingMessage, topics);

  if (matchedTopic) {
    await respondWithThemeMenu(response, user, theme, matchedTopic.answer);
    return;
  }

  await respondWithThemeMenu(
    response,
    user,
    theme,
    'Votre question a bien ete recue. Elle necessite une analyse plus specifique.',
  );
}

// ---------------------------------------------------------------------------
// Handlers onboarding progressif
// ---------------------------------------------------------------------------

async function handleOnboardingStep(response, user, context) {
  const { message, normalizedMessage } = context;
  const currentPharmacist = (await storage.getPharmacist(user.phone)) || { phone: user.phone };

  // ── Étape ROLE (première étape post-consentement) ─────────────────────────
  if (user.current_state === STATES.ONBOARDING_ROLE) {
    const { updatedPharmacist, nextStep, role } = onboarding.handleRoleStep(normalizedMessage, currentPharmacist);
    await storage.savePharmacist(updatedPharmacist);
    // Mettre à jour le rôle dans l'audit trail du consentement
    if (role) {
      await storage.updateConsentRole(user.phone, role);
    }
    await setOnboardingState(user, nextStep);
    response.message(onboarding.buildNamePrompt());
    return;
  }

  if (user.current_state === STATES.ONBOARDING_NAME) {
    const { updatedPharmacist, nextStep } = onboarding.handleNameStep(normalizedMessage, currentPharmacist);
    await storage.savePharmacist(updatedPharmacist);
    await setOnboardingState(user, nextStep);
    response.message(onboarding.buildPharmacyPrompt(updatedPharmacist.name));
    return;
  }

  if (user.current_state === STATES.ONBOARDING_PHARMACY) {
    const { updatedPharmacist, nextStep } = onboarding.handlePharmacyStep(message, normalizedMessage, currentPharmacist);
    await storage.savePharmacist(updatedPharmacist);
    await setOnboardingState(user, nextStep);
    response.message(onboarding.buildCityPrompt());
    return;
  }

  if (user.current_state === STATES.ONBOARDING_CITY) {
    const { updatedPharmacist, nextStep } = onboarding.handleCityStep(message, normalizedMessage, currentPharmacist);
    await storage.savePharmacist(updatedPharmacist);
    await setOnboardingState(user, nextStep);
    response.message(onboarding.buildSoftwarePrompt());
    return;
  }

  if (user.current_state === STATES.ONBOARDING_SOFTWARE) {
    const { updatedPharmacist } = onboarding.handleSoftwareStep(normalizedMessage, currentPharmacist);
    updatedPharmacist.onboarding_completed = true;
    await storage.savePharmacist(updatedPharmacist);

    // Onboarding terminé → afficher le menu principal
    const activeThemes = (await storage.getThemes()).filter((t) => t.active);
    const completionMsg = onboarding.buildOnboardingCompleteMessage(updatedPharmacist);
    const updatedUser = await setMainMenuState(user);
    response.message(`${completionMsg}\n\n${buildMainMenu(activeThemes)}`);
    return;
  }
}

// ---------------------------------------------------------------------------
// Handlers modules spéciaux (MedIndex, Interactions, Monitoring)
// ---------------------------------------------------------------------------

async function handleMedindexQuery(response, user, theme, incomingMessage) {
  if (normalizeText(incomingMessage) === 'retour') {
    await respondWithThemeMenu(response, user, theme);
    return;
  }

  const results = await medindex.searchMedication(incomingMessage);
  const formatted = medindex.formatSearchResults(results, incomingMessage);
  // Rester dans l'état AWAITING_MEDINDEX_QUERY pour permettre une nouvelle recherche
  response.message(formatted);
}

async function handleInteractionQuery(response, user, theme, incomingMessage) {
  if (normalizeText(incomingMessage) === 'retour') {
    await respondWithThemeMenu(response, user, theme);
    return;
  }

  const drugs = interactions.parseDrugList(incomingMessage);

  if (drugs.length < 2) {
    response.message(
      'Veuillez entrer au moins 2 medicaments separes par "+" ou ",".\n' +
      'Exemple : Metformine + Ibuprofene\n\n' +
      'RETOUR pour revenir au menu.'
    );
    return;
  }

  const result = interactions.checkInteractions(drugs);
  const report = interactions.formatInteractionReport(drugs, result);
  response.message(report);
  // Rester dans AWAITING_INTERACTION_DRUGS pour permettre une nouvelle analyse
}

async function handleMonitoringChoice(response, user, theme, normalizedMessage) {
  const pharmacist = await storage.getPharmacist(user.phone);
  const software = (pharmacist && pharmacist.software) || 'blink';
  const connector = monitoring.getConnector(software);

  if (normalizedMessage === 'retour') {
    await respondWithThemeMenu(response, user, theme);
    return;
  }

  // Commandes rapides
  if (normalizedMessage === 'stock' || normalizedMessage === '1') {
    const pharmacyId = (pharmacist && pharmacist.software_pharmacy_id) || 'demo';
    const alerts = await connector.getStockAlerts(pharmacyId);
    response.message(monitoring.formatStockAlertsMessage(alerts, software));
    return;
  }

  if (normalizedMessage === 'ventes' || normalizedMessage === '2') {
    const pharmacyId = (pharmacist && pharmacist.software_pharmacy_id) || 'demo';
    const sales = await connector.getSalesSummary(pharmacyId);
    response.message(monitoring.formatSalesSummaryMessage(sales, software));
    return;
  }

  if (normalizedMessage === '3') {
    await respondWithMainMenu(response, user);
    return;
  }

  // Afficher le menu monitoring si saisie non reconnue
  response.message(monitoring.buildMonitoringMenu(software));
}

app.get('/', (req, res) => {
  const acceptHeader = String(req.get('accept') || '').toLowerCase();

  if (acceptHeader.includes('text/html')) {
    res.redirect('/admin');
    return;
  }

  res.json({
    status: 'ok',
    admin: '/admin',
    webhook: '/webhook/whatsapp',
    twilioWhatsappWebhook: '/webhooks/twilio/whatsapp',
    twilioWhatsappFallback: '/webhooks/twilio/whatsapp/fallback',
    statusCallback: '/webhook/twilio/status',
  });
});

async function handleIncomingWhatsappWebhook(req, res, next) {
  try {
    const response = new MessagingResponse();
    const context = getRequestContext(req);
    const controlValue = context.normalizedPayload || context.normalizedMessage;

    if (!context.phone) {
      response.message("Requete invalide. Numero d'utilisateur introuvable.");
      res.type('text/xml').status(400).send(response.toString());
      return;
    }

    let user = await ensureUser(context.phone);
    await storage.appendMessageLog({
      direction: 'inbound',
      phone: context.phone,
      theme_id: user.current_theme || null,
      body: context.message || context.payload || '',
      status: 'received',
      provider_message_sid: req.body.MessageSid || null,
      metadata: {
        payload: context.payload || null,
        profile_name: req.body.ProfileName || null,
        current_state: user.current_state || null,
      },
    });

    if (controlValue === 'stop') {
      await storage.revokeConsent(context.phone);
      await storage.removeUserSubscriptions(context.phone);
      await storage.resetUser(context.phone);
      response.message(buildDisabledMessage());
      res.type('text/xml').send(response.toString());
      return;
    }

    const consented = await storage.hasConsent(context.phone);

    if (!consented) {
      const isOui = context.normalizedMessage === 'oui' || controlValue === 'consent_yes';
      const isNon = context.normalizedMessage === 'non' || controlValue === 'consent_no';
      const isEnSavoirPlus =
        context.normalizedMessage === 'en savoir plus' ||
        context.normalizedMessage === 'plus' ||
        controlValue === 'consent_more';

      if (isOui) {
        // Enregistrer le consentement avec version et snapshot textuel
        await storage.grantConsentWithMeta(context.phone, {
          version: consent.CONSENT_CURRENT_VERSION,
          textSnapshot: consent.getConsentTextSnapshot(consent.CONSENT_CURRENT_VERSION),
        });
        // Démarrer l'onboarding par la demande de rôle
        user = await setOnboardingState(
          { ...user, authenticated: false },
          STATES.ONBOARDING_ROLE,
        );
        response.message(buildActivationMessage());
      } else if (isNon) {
        // Enregistrer le refus (conserve l'entrée pour l'audit trail)
        await storage.refuseConsent(context.phone);
        await storage.resetUser(context.phone);
        response.message(buildConsentDeclinedMessage());
      } else if (isEnSavoirPlus) {
        // Envoyer la version longue et mémoriser l'état pour la réponse suivante
        await storage.saveUser({ ...user, current_state: STATES.AWAITING_CONSENT_DETAILS });
        response.message(consent.buildConsentLong());
      } else if (user.current_state === STATES.AWAITING_CONSENT_DETAILS) {
        // L'utilisateur avait demandé plus d'info mais envoie autre chose → ré-afficher
        response.message(consent.buildConsentLong());
      } else {
        // Premier contact ou message non reconnu → afficher le consentement court
        await storage.resetUser(context.phone);
        response.message(buildConsentMessage());
      }

      res.type('text/xml').send(response.toString());
      return;
    }

    // ── Vérification de version du consentement ───────────────────────────────
    // Si la version stockée existe et diffère de la version courante, demander re-confirmation.
    // Les utilisateurs sans version stockée (consentement antérieur) ne sont pas impactés.
    const consentRecordForVersionCheck = await storage.getConsentRecord(context.phone);
    if (
      consentRecordForVersionCheck &&
      consentRecordForVersionCheck.consent_version &&
      consentRecordForVersionCheck.consent_version !== consent.CONSENT_CURRENT_VERSION
    ) {
      console.info('[consent-version-check]', JSON.stringify({
        phone: context.phone,
        stored: consentRecordForVersionCheck.consent_version,
        current: consent.CONSENT_CURRENT_VERSION,
      }));
      // Réinitialiser l'état pour forcer la re-confirmation
      await storage.saveUser({ ...user, current_state: STATES.AWAITING_CONSENT, current_theme: null });
      // Supprimer le consentement existant pour que hasConsent retourne false au prochain message
      await storage.revokeConsent(context.phone);
      response.message(consent.buildConsentVersionUpdate(consent.CONSENT_CURRENT_VERSION));
      res.type('text/xml').send(response.toString());
      return;
    }

    const themes = await storage.getThemes();
    const activeThemes = themes.filter((theme) => theme.active);
    const currentTheme = user.current_theme
      ? themes.find((theme) => theme.id === user.current_theme)
      : null;
    const payloadTheme = findThemeFromPayload(context.normalizedPayload, activeThemes);

    if (user.current_theme && (!currentTheme || !currentTheme.active)) {
      user = await setMainMenuState(user);
      response.message(`Ce theme n'est plus disponible.\n\n${buildMainMenu(activeThemes)}`);
      res.type('text/xml').send(response.toString());
      return;
    }

    if (controlValue === 'menu') {
      await respondWithMainMenu(response, user);
      res.type('text/xml').send(response.toString());
      return;
    }

    if (context.normalizedMessage === 'profil' || context.normalizedMessage === 'mon profil' || controlValue === 'profil') {
      await handleProfileRequest(response, user);
      res.type('text/xml').send(response.toString());
      return;
    }

    if (context.normalizedMessage === 'aide' || controlValue === 'aide') {
      response.message(buildHelpMessage());
      res.type('text/xml').send(response.toString());
      return;
    }

    if (controlValue === 'retour') {
      if (user.current_state === STATES.AWAITING_FREE_QUESTION && currentTheme) {
        await respondWithThemeMenu(response, user, currentTheme);
      } else {
        await respondWithMainMenu(response, user);
      }

      res.type('text/xml').send(response.toString());
      return;
    }

    if (context.normalizedMessage === 'auth ok' || controlValue === 'auth_ok') {
      user = await storage.saveUser({
        ...user,
        authenticated: true,
      });

      if (currentTheme && currentTheme.active) {
        await respondWithThemeMenu(
          response,
          user,
          currentTheme,
          'Authentification prise en compte.',
        );
      } else {
        await respondWithMainMenu(response, user, 'Authentification prise en compte.');
      }

      res.type('text/xml').send(response.toString());
      return;
    }

    if (payloadTheme) {
      await handleThemeSelection(response, user, payloadTheme);
      res.type('text/xml').send(response.toString());
      return;
    }

    // ── Onboarding progressif ─────────────────────────────────────────────
    // Doit être AVANT le handler de sélection numérique : les étapes d'onboarding
    // (ex: choix du rôle par "1"/"2"/"3") utiliseraient sinon le handler de menu.
    const onboardingStates = Object.values(onboarding.ONBOARDING_STATES);
    if (onboardingStates.includes(user.current_state)) {
      await handleOnboardingStep(response, user, context);
      res.type('text/xml').send(response.toString());
      return;
    }

    if (isNumberSelection(context.normalizedMessage)) {
      const selectedIndex = Number(context.normalizedMessage) - 1;

      if (user.current_theme && currentTheme) {
        await handleThemeMenuSelection(response, user, currentTheme, selectedIndex);
      } else {
        await handleThemeSelection(response, user, activeThemes[selectedIndex]);
      }

      res.type('text/xml').send(response.toString());
      return;
    }

    // ── Module MedIndex ───────────────────────────────────────────────────
    if (user.current_state === STATES.AWAITING_MEDINDEX_QUERY && currentTheme) {
      await handleMedindexQuery(response, user, currentTheme, context.message);
      res.type('text/xml').send(response.toString());
      return;
    }

    // ── Module Interactions ───────────────────────────────────────────────
    if (user.current_state === STATES.AWAITING_INTERACTION_DRUGS && currentTheme) {
      await handleInteractionQuery(response, user, currentTheme, context.message);
      res.type('text/xml').send(response.toString());
      return;
    }

    // ── Module Monitoring ─────────────────────────────────────────────────
    if (user.current_state === STATES.AWAITING_MONITORING_CHOICE && currentTheme) {
      await handleMonitoringChoice(response, user, currentTheme, context.normalizedMessage);
      res.type('text/xml').send(response.toString());
      return;
    }

    // ── Module CNSS ───────────────────────────────────────────────────────
    if (user.current_state === STATES.AWAITING_CNSS_QUESTION && currentTheme) {
      const answer = await cnss.answerQuestion(context.message, currentTheme.id);
      response.message(answer + '\n\nEnvoyez RETOUR pour revenir au menu.');
      res.type('text/xml').send(response.toString());
      return;
    }

    if (user.current_state === STATES.AWAITING_FREE_QUESTION && currentTheme) {
      await handleFreeQuestion(response, user, currentTheme, context.message);
      res.type('text/xml').send(response.toString());
      return;
    }

    if (user.current_state === STATES.AWAITING_AUTH && currentTheme) {
      await respondWithThemeMenu(
        response,
        user,
        currentTheme,
        'Merci de choisir une option de connexion.',
      );
      res.type('text/xml').send(response.toString());
      return;
    }

    if (currentTheme) {
      await respondWithThemeMenu(
        response,
        user,
        currentTheme,
        'Merci de choisir une option avec son numero.',
      );
      res.type('text/xml').send(response.toString());
      return;
    }

    await respondWithMainMenu(response, user, 'Merci de choisir un theme avec son numero.');
    res.type('text/xml').send(response.toString());
  } catch (error) {
    next(error);
  }
}

app.post('/webhook/whatsapp', handleIncomingWhatsappWebhook);
app.post('/webhooks/twilio/whatsapp', handleIncomingWhatsappWebhook);
app.post('/webhooks/twilio/whatsapp/fallback', handleIncomingWhatsappWebhook);

app.post('/webhook/twilio/status', async (req, res, next) => {
  try {
    const messageSid = String(req.body.MessageSid || '').trim();
    const messageStatus = String(req.body.MessageStatus || '').trim() || 'unknown';
    const updatePayload = {
      status: messageStatus,
      error_code: req.body.ErrorCode || null,
      error_message: req.body.ErrorMessage || null,
      metadata: {
        callback_to: req.body.To || null,
        callback_from: req.body.From || null,
      },
    };

    if (messageSid) {
      const updatedLog = await storage.updateMessageLogByProviderSid(
        messageSid,
        updatePayload,
      );

      if (!updatedLog) {
        await storage.appendMessageLog({
          direction: 'outbound',
          phone: String(req.body.To || '').trim(),
          body: '',
          status: messageStatus,
          provider_message_sid: messageSid,
          error_code: req.body.ErrorCode || null,
          error_message: req.body.ErrorMessage || null,
          metadata: {
            source: 'twilio_status_callback',
            callback_from: req.body.From || null,
          },
        });
      }
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);

  if (req.path === '/webhook/whatsapp') {
    const response = new MessagingResponse();
    response.message("Une erreur est survenue. Merci de reessayer dans quelques instants.");
    res.type('text/xml').status(200).send(response.toString());
    return;
  }

  if (req.path === '/webhook/twilio/status') {
    res.status(500).json({ error: 'Status callback processing failed' });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
});

// Démarrage du serveur (local uniquement — sur Vercel, on exporte l'app)
if (require.main === module) {
  storage
    .initializeStorage()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`WhatsApp pharmacy assistant running on port ${PORT}`);
        console.log(`Admin : http://localhost:${PORT}/admin`);
        console.log(`Webhook principal : http://localhost:${PORT}/webhook/whatsapp`);
      });
    })
    .catch((error) => {
      console.error('Unable to initialize storage:', error);
      process.exit(1);
    });
} else {
  // Import par Vercel ou les tests : initialiser le storage silencieusement
  storage.initializeStorage().catch((error) => {
    console.error('[storage-init]', error.message);
  });
}

// Export pour Vercel serverless et les tests
module.exports = app;
