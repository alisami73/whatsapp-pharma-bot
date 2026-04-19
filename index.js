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
const onboardingFlow = require('./modules/onboarding_flow');
const interactive = require('./modules/interactive');
const { t, parseLang } = require('./modules/i18n');
const { sendAIResponseWithFooter } = require('./modules/shared/footer');
const software = require('./modules/themes/software');
const comingSoon = require('./modules/themes/coming-soon');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const { MessagingResponse } = twilio.twiml;

const STATES = {
  AWAITING_LANGUAGE: 'awaiting_language',              // Écran 1 — sélection langue
  AWAITING_CONSENT: 'awaiting_consent',
  BROWSING_SOFTWARE_CAROUSEL: 'browsing_software_carousel', // Carrousel Blink Premium
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
  const interactiveData = onboardingFlow.extractInteractiveData(req.body);

  return {
    phone,
    message,
    payload,
    interactiveData,
    normalizedMessage: normalizeText(message),
    normalizedPayload: normalizeText(payload),
  };
}

function buildEmptyTwiml() {
  return new MessagingResponse().toString();
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
  return Boolean(theme) && (theme.module_type === 'cnss' || theme.id === 'fse' || theme.id === 'compliance');
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
  const labelByThemeId = {
    fse: '1. Poser ma question sur la FSE',
    cnss: '1. Poser ma question sur la CNSS',
    cndp: '1. Poser ma question sur la conformite CNDP (Loi 09-08)',
  };
  const labelByModuleType = {
    medindex: '1. Rechercher un medicament (MedIndex)',
    interactions: '1. Analyser des interactions medicamenteuses',
    monitoring: '1. Consulter mon monitoring (stock / ventes)',
    knowledge_base: '1. Poser ma question',
  };
  const mainActionLabel = labelByThemeId[theme.id] || labelByModuleType[theme.module_type] || '1. Poser ma question';
  lines.push(mainActionLabel);

  let optionNumber = 2;

  if (theme.allow_subscription) {
    lines.push(`${optionNumber}. Recevoir les mises a jour de ce theme`);
    optionNumber += 1;
  }

  lines.push(`${optionNumber}. Retour au menu`);
  lines.push('');
  lines.push('Repondez avec un numero.');
  if (usesDocumentKnowledge(theme)) {
    lines.push('Vous pouvez aussi envoyer directement votre question.');
  }
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
  // Après consentement → welcome Blink Premium multilingue + choix de rôle
  return [
    '🇲🇦 العربية',
    '',
    'مرحبًا بكم في شات بوت Blink Premium.',
    '',
    'نضع رهن إشارتكم خدمتنا المدعومة بالذكاء الاصطناعي للإجابة عن أسئلتكم حول ورقة العلاجات الإلكترونية.',
    '',
    'أنتم:',
    '1. صيدلي صاحب صيدلية',
    '2. صيدلي مساعد / متعاون',
    '3. دور آخر',
    '',
    '🇫🇷 Français',
    '',
    'Bienvenue dans le Chatbot Blink Premium.',
    '',
    'Nous mettons notre service assisté par Intelligence Artificielle pour répondre à vos questions sur la Feuille de Soins Électronique.',
    '',
    'Vous êtes :',
    '1. Pharmacien d\'officine titulaire',
    '2. Pharmacien adjoint / collaborateur',
    '3. Autre rôle',
    '',
    '🇪🇸 Español',
    '',
    'Bienvenido al Chatbot Blink Premium.',
    '',
    'Ponemos a su disposición nuestro servicio asistido por Inteligencia Artificial para responder a sus preguntas sobre la Hoja Electrónica de Atención Médica.',
    '',
    'Usted es:',
    '1. Farmacéutico titular de oficina de farmacia',
    '2. Farmacéutico adjunto / colaborador',
    '3. Otro rol',
    '',
    '🇷🇺 Русский',
    '',
    'Добро пожаловать в Chatbot Blink Premium.',
    '',
    'Мы предоставляем наш сервис с поддержкой искусственного интеллекта, чтобы отвечать на ваши вопросы об Электронном листе медицинского обслуживания.',
    '',
    'Вы являетесь:',
    '1. Владельцем аптеки / главным фармацевтом',
    '2. Помощником фармацевта / сотрудником',
    '3. Другая роль',
  ].join('\n');
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

/** Retourne la langue de l'utilisateur, 'fr' par défaut. */
function getUserLang(user) {
  return user && user.user_language ? user.user_language : 'fr';
}

async function ensureUser(phone) {
  const existingUser = await storage.getUser(phone);
  if (existingUser) return existingUser;

  // Nouvel utilisateur → commencer par la sélection de langue
  return storage.saveUser({
    phone,
    current_theme: null,
    current_state: STATES.AWAITING_LANGUAGE,
    user_language: null,
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

// Tente d'envoyer le menu principal en interactif (list-picker).
// Retourne true si le message a été envoyé via l'API Twilio, false sinon.
// Le caller doit retourner empty TwiML si true, ou continuer avec le texte si false.
async function tryRespondWithMainMenuInteractive(phone, res, user, prefix) {
  try {
    const activeThemes = (await storage.getThemes()).filter((th) => th.active);
    await setMainMenuState(user);
    const lang = getUserLang(user);
    const result = await interactive.sendMenuScreen(phone, activeThemes, lang);
    if (result) {
      await storage.appendMessageLog({
        direction: 'outbound',
        phone,
        body: '[interactive:main_menu]',
        status: result.status || 'queued',
        provider_message_sid: result.sid,
        metadata: { source: 'interactive_main_menu' },
      });
      if (prefix) {
        // Send the prefix as a separate text message before the interactive menu
        await twilioService.sendWhatsAppMessage({ to: phone, body: prefix });
      }
      res.type('text/xml').send(buildEmptyTwiml());
      return true;
    }
  } catch (err) {
    console.error('[interactive] sendMenuScreen failed:', err.message || err);
  }
  return false;
}

async function respondWithMainMenu(response, user, prefix = '') {
  const activeThemes = (await storage.getThemes()).filter((theme) => theme.active);
  await setMainMenuState(user);
  const message = buildMainMenu(activeThemes);
  response.message(prefix ? `${prefix}\n\n${message}` : message);
}

async function sendOnboardingFlowMessage(phone) {
  const contentSid = onboardingFlow.getOnboardingFlowContentSid();

  if (!contentSid) {
    return null;
  }

  const outboundMessage = await twilioService.sendWhatsAppMessage({
    to: phone,
    contentSid,
  });

  await storage.appendMessageLog({
    direction: 'outbound',
    phone,
    body: '[onboarding_flow]',
    status: outboundMessage.status || 'queued',
    provider_message_sid: outboundMessage.sid,
    metadata: {
      source: 'onboarding_flow',
      content_sid: contentSid,
    },
  });

  return outboundMessage;
}

async function handleOnboardingFlowSubmission(response, user, context) {
  const submission = onboardingFlow.parseFlowSubmission(context.interactiveData);

  if (!submission) {
    return false;
  }

  if (submission.consent_choice === 'refuse') {
    await storage.refuseConsent(context.phone);
    await storage.resetUser(context.phone);
    response.message(buildConsentDeclinedMessage());
    return true;
  }

  if (submission.consent_choice !== 'accept') {
    response.message('Soumission incomplete. Merci de relancer le parcours.');
    return true;
  }

  await storage.grantConsentWithMeta(context.phone, {
    version: consent.CONSENT_CURRENT_VERSION,
    textSnapshot: consent.getConsentTextSnapshot(consent.CONSENT_CURRENT_VERSION),
    source: 'template',
    notes: 'consentement recueilli via WhatsApp Flow',
  });

  const storedRole = onboardingFlow.mapRoleChoiceToStoredRole(submission.role_choice);
  if (storedRole) {
    await storage.updateConsentRole(context.phone, storedRole);
  }

  const currentPharmacist = (await storage.getPharmacist(context.phone)) || { phone: context.phone };
  await storage.savePharmacist({
    ...currentPharmacist,
    role: storedRole,
    entry_choice: submission.entry_choice || null,
    onboarding_completed: true,
  });

  await setMainMenuState({
    ...user,
    phone: context.phone,
    authenticated: false,
  });

  response.message('Merci. Vos choix ont bien ete enregistres.');
  return true;
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

/**
 * Gère les étapes d'onboarding progressif.
 * Retourne true si la réponse HTTP a déjà été envoyée (TwiML vide + message outbound),
 * false si le caller doit envoyer response.toString().
 */
async function handleOnboardingStep(response, res, user, context) {
  const { message, normalizedMessage } = context;
  // Pour l'étape rôle, on priorise le payload (bouton list-picker) sur le texte
  const roleControlValue = context.normalizedPayload || normalizedMessage;
  const currentPharmacist = (await storage.getPharmacist(user.phone)) || { phone: user.phone };

  // ── Étape ROLE (première et dernière étape post-consentement) ────────────
  if (user.current_state === STATES.ONBOARDING_ROLE) {
    const lang = getUserLang(user);
    const isValidRoleChoice = onboarding.isSkip(roleControlValue) || Boolean(onboarding.parseRoleChoice(roleControlValue));

    if (!isValidRoleChoice) {
      // Renvoyer l'écran de sélection de rôle
      try {
        const roleResult = await interactive.sendRoleScreen(user.phone, lang);
        if (roleResult) { return; } // empty TwiML déjà envoyé plus haut
      } catch (_) {}
      response.message(t('role_body', lang));
      return;
    }

    const { updatedPharmacist, role } = onboarding.handleRoleStep(roleControlValue, currentPharmacist);
    await storage.savePharmacist({ ...updatedPharmacist, onboarding_completed: true });
    if (role) await storage.updateConsentRole(user.phone, role);

    // Onboarding terminé → Écran 3 (menu des thèmes)
    console.log(`[state] ${user.phone} → MAIN_MENU (onboarding rôle terminé, lang: ${lang})`);
    await setMainMenuState(user);

    // Tentative interactive
    const activeThemes = (await storage.getThemes()).filter((th) => th.active);
    try {
      const menuResult = await interactive.sendMenuScreen(user.phone, activeThemes, lang);
      if (menuResult) {
        await storage.appendMessageLog({
          direction: 'outbound', phone: user.phone,
          body: '[interactive:main_menu]',
          status: menuResult.status || 'queued',
          provider_message_sid: menuResult.sid,
          metadata: { source: 'onboarding_complete', lang },
        });
        res.type('text/xml').send(buildEmptyTwiml());
        return true;
      }
    } catch (err) {
      console.error('[interactive] sendMenuScreen after role failed:', err.message);
    }
    // Fallback texte
    response.message(`${t('onboarding_complete', lang)}\n\n${buildMainMenu(activeThemes)}`);
    return false;
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
        interactive_data: context.interactiveData || null,
        profile_name: req.body.ProfileName || null,
        current_state: user.current_state || null,
      },
    });

    const handledFlowSubmission = await handleOnboardingFlowSubmission(response, user, context);
    if (handledFlowSubmission) {
      res.type('text/xml').send(response.toString());
      return;
    }

    // ── Commande STOP (globale — tous états) ────────────────────────────────────
    if (controlValue === 'stop') {
      const lang = getUserLang(user);
      await storage.revokeConsent(context.phone);
      await storage.removeUserSubscriptions(context.phone);
      await storage.resetUser(context.phone);
      response.message(t('stop_message', lang));
      res.type('text/xml').send(response.toString());
      return;
    }

    // ── Footer : back_to_themes (retour Écran 3 sans reset CGU/langue) ──────────
    if (controlValue === 'back_to_themes') {
      const consented2 = await storage.hasConsent(context.phone);
      if (consented2) {
        const sentMenu = await tryRespondWithMainMenuInteractive(context.phone, res, user, '');
        if (!sentMenu) {
          const activeThemes2 = (await storage.getThemes()).filter((th) => th.active);
          await respondWithMainMenu(response, user);
          res.type('text/xml').send(response.toString());
        }
      } else {
        // Pas de consentement → retour Écran 2
        const lang2 = getUserLang(user);
        try {
          const cr = await interactive.sendConsentScreen(context.phone, lang2);
          if (cr) { res.type('text/xml').send(buildEmptyTwiml()); return; }
        } catch (_) {}
        response.message(t('cgu_body', getUserLang(user)));
        res.type('text/xml').send(response.toString());
      }
      return;
    }

    // ── Footer : back_to_language (retour Écran 1 sans reset CGU) ───────────────
    if (controlValue === 'back_to_language') {
      user = await storage.saveUser({ ...user, current_state: STATES.AWAITING_LANGUAGE, user_language: null });
      console.log(`[state] ${context.phone} → AWAITING_LANGUAGE (back_to_language)`);
      try {
        const lr = await interactive.sendLanguageScreen(context.phone);
        if (lr) { res.type('text/xml').send(buildEmptyTwiml()); return; }
      } catch (_) {}
      response.message(t('language_body', 'fr'));
      res.type('text/xml').send(response.toString());
      return;
    }

    // ── Commande /LANGUE (globale — reprend depuis la sélection de langue) ──────
    const isLanguageCmd =
      controlValue === 'langue' ||
      controlValue === 'language' ||
      controlValue === '/langue' ||
      controlValue === '/language';

    if (isLanguageCmd) {
      user = await storage.saveUser({ ...user, current_state: STATES.AWAITING_LANGUAGE, user_language: null });
      console.log(`[state] ${context.phone} → AWAITING_LANGUAGE (commande /LANGUE)`);
      try {
        const langResult = await interactive.sendLanguageScreen(context.phone);
        if (langResult) { res.type('text/xml').send(buildEmptyTwiml()); return; }
      } catch (_) {}
      response.message(t('language_body', 'fr'));
      res.type('text/xml').send(response.toString());
      return;
    }

    // ── Commande /START (réinitialisation complète) ──────────────────────────────
    const isStartCmd =
      controlValue === 'demarrer' ||
      controlValue === '/demarrer' ||
      controlValue === 'start' ||
      controlValue === '/start';

    if (isStartCmd) {
      await storage.revokeConsent(context.phone);
      await storage.removeUserSubscriptions(context.phone);
      user = await storage.saveUser({
        phone: context.phone,
        current_theme: null,
        current_state: STATES.AWAITING_LANGUAGE,
        user_language: null,
        authenticated: false,
      });
      console.log(`[state] ${context.phone} → AWAITING_LANGUAGE (commande /START)`);
      try {
        const langResult = await interactive.sendLanguageScreen(context.phone);
        if (langResult) { res.type('text/xml').send(buildEmptyTwiml()); return; }
      } catch (_) {}
      response.message(t('language_body', 'fr'));
      res.type('text/xml').send(response.toString());
      return;
    }

    // ── ÉCRAN 1 : Sélection de langue ───────────────────────────────────────────
    // Déclenché si l'utilisateur n'a pas encore de langue enregistrée.
    if (!user.user_language || user.current_state === STATES.AWAITING_LANGUAGE) {
      const chosenLang = parseLang(controlValue);

      if (chosenLang) {
        // Langue choisie → sauvegarder et passer à l'Écran 2 (CGU)
        user = await storage.saveUser({
          ...user,
          user_language: chosenLang,
          current_state: STATES.AWAITING_CONSENT,
        });
        console.log(`[state] ${context.phone} → AWAITING_CONSENT (langue: ${chosenLang})`);

        // Envoyer le consentement dans la langue choisie
        try {
          const consentResult = await interactive.sendConsentScreen(context.phone, chosenLang);
          if (consentResult) {
            await storage.appendMessageLog({
              direction: 'outbound', phone: context.phone,
              body: `[interactive:consent_${chosenLang}]`,
              status: consentResult.status || 'queued',
              provider_message_sid: consentResult.sid,
              metadata: { source: 'interactive_consent', lang: chosenLang },
            });
            res.type('text/xml').send(buildEmptyTwiml());
            return;
          }
        } catch (err) {
          console.error('[interactive] sendConsentScreen failed:', err.message);
        }
        // Fallback texte
        response.message(t('cgu_body', chosenLang));
        res.type('text/xml').send(response.toString());
        return;
      }

      // Pas de langue reconnue → afficher l'écran de sélection
      console.log(`[state] ${context.phone} → sendLanguageScreen`);
      try {
        const langResult = await interactive.sendLanguageScreen(context.phone);
        if (langResult) {
          await storage.appendMessageLog({
            direction: 'outbound', phone: context.phone,
            body: '[interactive:language_picker]',
            status: langResult.status || 'queued',
            provider_message_sid: langResult.sid,
            metadata: { source: 'interactive_language' },
          });
          res.type('text/xml').send(buildEmptyTwiml());
          return;
        }
      } catch (err) {
        console.error('[interactive] sendLanguageScreen failed:', err.message);
      }
      // Fallback texte multilingue
      response.message(t('language_body', 'fr'));
      res.type('text/xml').send(response.toString());
      return;
    }

    // ── ÉCRAN 2 : Consentement CGU ───────────────────────────────────────────────
    const consented = await storage.hasConsent(context.phone);
    const lang = getUserLang(user);

    if (!consented) {
      const isCguAccept = controlValue === 'cgu_accept' ||
        controlValue === 'oui' || controlValue === '1' ||
        ['j accepte', 'j\'accepte', 'accepte', 'اوافق', 'acepto', 'принимаю'].includes(controlValue);
      const isCguDecline = controlValue === 'cgu_decline' ||
        controlValue === 'non' || controlValue === '2' ||
        ['je refuse', 'refuse', 'ارفض', 'rechazo', 'отказываюсь'].includes(controlValue);
      const isCguFull = controlValue === 'cgu_full';

      if (isCguAccept) {
        // Enregistrer le consentement
        await storage.grantConsentWithMeta(context.phone, {
          version: consent.CONSENT_CURRENT_VERSION,
          textSnapshot: consent.getConsentTextSnapshot(consent.CONSENT_CURRENT_VERSION),
          source: 'interactive_button',
          lang,
        });
        // Démarrer l'onboarding par le rôle
        user = await setOnboardingState({ ...user, authenticated: false }, STATES.ONBOARDING_ROLE);
        console.log(`[state] ${context.phone} → ONBOARDING_ROLE`);
        // Écran rôle interactif
        try {
          const roleResult = await interactive.sendRoleScreen(context.phone, lang);
          if (roleResult) {
            await storage.appendMessageLog({
              direction: 'outbound', phone: context.phone,
              body: '[interactive:role_list_picker]',
              status: roleResult.status || 'queued',
              provider_message_sid: roleResult.sid,
              metadata: { source: 'interactive_role', lang },
            });
            res.type('text/xml').send(buildEmptyTwiml());
            return;
          }
        } catch (err) {
          console.error('[interactive] sendRoleScreen failed:', err.message);
        }
        // Fallback texte
        response.message(buildActivationMessage());

      } else if (isCguDecline) {
        await storage.refuseConsent(context.phone);
        await storage.resetUser(context.phone);
        console.log(`[state] ${context.phone} → CGU refusée`);
        response.message(t('cgu_declined', lang));

      } else if (isCguFull) {
        // Envoyer le lien CGU puis renvoyer l'écran CGU
        const cguUrl = String(process.env.CGU_URL || 'https://blink.ma/cgu');
        response.message(t('cgu_link', lang, { url: cguUrl }));
        // Re-envoyer l'écran CGU en message séparé (outbound asynchrone)
        try {
          await interactive.sendConsentScreen(context.phone, lang);
        } catch (_) {}

      } else {
        // Message non reconnu → ré-afficher l'écran CGU
        try {
          const consentResult = await interactive.sendConsentScreen(context.phone, lang);
          if (consentResult) {
            res.type('text/xml').send(buildEmptyTwiml());
            return;
          }
        } catch (err) {
          console.error('[interactive] sendConsentScreen failed:', err.message);
        }
        response.message(t('cgu_body', lang));
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
      const sentInteractive = await tryRespondWithMainMenuInteractive(context.phone, res, user, '');
      if (!sentInteractive) {
        await respondWithMainMenu(response, user);
        res.type('text/xml').send(response.toString());
      }
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
      // Routing Software → carrousel Blink Premium
      if (payloadTheme.id === 'software') {
        user = await storage.saveUser({ ...user, current_state: STATES.BROWSING_SOFTWARE_CAROUSEL, current_theme: 'software' });
        const carouselResult = await software.sendSoftwareCarousel(context.phone, lang);
        if (carouselResult) { res.type('text/xml').send(buildEmptyTwiml()); return; }
        response.message(software.buildSoftwareCarouselText(lang));
        res.type('text/xml').send(response.toString());
        return;
      }
      // Routing Medindex → Bientôt disponible
      if (payloadTheme.id === 'medindex') {
        const { sent, text } = await comingSoon.handleComingSoon(context.phone, lang);
        if (sent) { res.type('text/xml').send(buildEmptyTwiml()); return; }
        response.message(text);
        res.type('text/xml').send(response.toString());
        return;
      }
      await handleThemeSelection(response, user, payloadTheme);
      res.type('text/xml').send(response.toString());
      return;
    }

    // ── Onboarding progressif ─────────────────────────────────────────────
    // Doit être AVANT le handler de sélection numérique : les étapes d'onboarding
    // (ex: choix du rôle par "1"/"2"/"3") utiliseraient sinon le handler de menu.
    const onboardingStates = Object.values(onboarding.ONBOARDING_STATES);
    if (onboardingStates.includes(user.current_state)) {
      const handledDirectly = await handleOnboardingStep(response, res, user, context);
      if (!handledDirectly) res.type('text/xml').send(response.toString());
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

    // ── Module CNSS (conversationnel avec footer) ─────────────────────────
    if (user.current_state === STATES.AWAITING_CNSS_QUESTION && currentTheme) {
      const answer = await cnss.answerQuestion(context.message, currentTheme.id);
      const footerResult = await sendAIResponseWithFooter(context.phone, lang, answer);
      if (footerResult) {
        res.type('text/xml').send(buildEmptyTwiml());
      } else {
        response.message(answer + '\n\nEnvoyez RETOUR pour revenir au menu.');
        res.type('text/xml').send(response.toString());
      }
      return;
    }

    // ── Carrousel Software Blink Premium ──────────────────────────────────
    if (user.current_state === STATES.BROWSING_SOFTWARE_CAROUSEL) {
      const action = controlValue;
      const actionResult = await software.handleSoftwareAction(action, context.phone, lang);
      if (actionResult) {
        const footerResult = await sendAIResponseWithFooter(context.phone, lang, actionResult.text);
        if (footerResult) {
          res.type('text/xml').send(buildEmptyTwiml());
        } else {
          response.message(actionResult.text);
          res.type('text/xml').send(response.toString());
        }
        return;
      }
      // Action non reconnue → renvoyer le carrousel
      const carouselResult = await software.sendSoftwareCarousel(context.phone, lang);
      if (carouselResult) { res.type('text/xml').send(buildEmptyTwiml()); return; }
      response.message(software.buildSoftwareCarouselText(lang));
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

    if (currentTheme && usesDocumentKnowledge(currentTheme)) {
      await setCnssQuestionState(user, currentTheme.id);
      const answer = await cnss.answerQuestion(context.message, currentTheme.id);
      response.message(answer + '\n\nEnvoyez RETOUR pour revenir au menu.');
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

  if (
    req.path === '/webhook/whatsapp' ||
    req.path === '/webhooks/twilio/whatsapp' ||
    req.path === '/webhooks/twilio/whatsapp/fallback'
  ) {
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
