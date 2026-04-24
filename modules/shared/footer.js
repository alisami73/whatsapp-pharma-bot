'use strict';

/**
 * modules/shared/footer.js
 *
 * sendAIResponseWithFooter(to, lang, bodyText)
 *
 * Envoie la réponse IA (bodyText) dans un message twilio/quick-reply
 * incluant 2 boutons footer quand INTERACTIVE_FOOTER_ENABLED=true :
 *   - back_to_themes  → "Choisir un thème"
 *   - back_to_language → "Changer de langue"
 *
 * Si les messages interactifs sont désactivés ou si la création du template
 * échoue, retourne null → le caller envoie le texte brut via TwiML.
 *
 * Le template footer est créé une fois par langue et mis en cache.
 * La réponse IA est injectée via contentVariable {{1}}.
 */

const twilioService = require('../../twilio_service');
const { t } = require('../i18n');

// Importé en mode lazy pour éviter la dépendance circulaire
// (interactive.js → footer.js → interactive.js ne doit pas exister)
function getInteractive() {
  return require('../interactive');
}

const FOOTER_CACHE_KEY_PREFIX = 'footer_v1';
const MAX_INTERACTIVE_BODY_CHARS = 950;

function isFooterQuickReplyEnabled() {
  return String(process.env.INTERACTIVE_FOOTER_ENABLED || '').toLowerCase() === 'true';
}

function buildTextFooter(lang, options = {}) {
  const safeLang = ['fr', 'ar', 'es', 'ru'].includes(lang) ? lang : 'fr';
  const { includeBack = false } = options;

  const messages = {
    fr: includeBack
      ? 'Envoyez RETOUR pour revenir au menu, MENU pour choisir un theme ou LANGUE pour changer de langue.'
      : 'Envoyez MENU pour choisir un theme ou LANGUE pour changer de langue.',
    ar: includeBack
      ? 'أرسل RETOUR للعودة إلى القائمة، أو MENU لاختيار موضوع، أو LANGUE لتغيير اللغة.'
      : 'أرسل MENU لاختيار موضوع أو LANGUE لتغيير اللغة.',
    es: includeBack
      ? 'Envie RETOUR para volver al menu, MENU para elegir un tema o LANGUE para cambiar el idioma.'
      : 'Envie MENU para elegir un tema o LANGUE para cambiar el idioma.',
    ru: includeBack
      ? 'Отправьте RETOUR, чтобы вернуться в меню, MENU, чтобы выбрать тему, или LANGUE, чтобы сменить язык.'
      : 'Отправьте MENU, чтобы выбрать тему, или LANGUE, чтобы сменить язык.',
  };

  return messages[safeLang] || messages.fr;
}

function appendTextFooter(bodyText, lang, options = {}) {
  const navigationText = buildTextFooter(lang, options);
  return `${String(bodyText || '').trim()}\n\n${navigationText}`;
}

/**
 * Retourne la spec du template footer pour une langue donnée.
 * Le body contient {{1}} — variable qui sera remplacée par la réponse IA.
 */
function buildFooterSpec(lang) {
  const langCode = lang === 'ar' ? 'ar' : lang === 'es' ? 'es' : lang === 'ru' ? 'ru' : 'fr';
  return {
    friendlyName: `blink_footer_v1_${lang}`,
    language: langCode,
    types: {
      'twilio/quick-reply': {
        body: '{{1}}',
        actions: [
          { id: 'back_to_themes',   title: t('footer_back_themes', lang).slice(0, 20) },
          { id: 'back_to_language', title: t('footer_back_language', lang).slice(0, 20) },
        ],
      },
    },
  };
}

/**
 * Envoie un message outbound avec la réponse IA et les 2 boutons footer.
 *
 * @param {string} to        — numéro WhatsApp destinataire
 * @param {string} lang      — langue de l'utilisateur
 * @param {string} bodyText  — texte de la réponse IA (tronqué à 1024 chars si nécessaire)
 * @returns {object|null}    — objet Twilio message ou null (fallback texte)
 */
async function sendAIResponseWithFooter(to, lang, bodyText) {
  const interactive = getInteractive();

  // Long messages: always use outbound API regardless of footer setting.
  // TwiML <Message> silently drops WhatsApp messages over ~1000 chars.
  // Twilio WhatsApp outbound body limit is 1600 chars — split if needed.
  const MAX_WA_BODY = 1550;
  if (String(bodyText || '').length > MAX_INTERACTIVE_BODY_CHARS) {
    console.log(`[footer] Réponse trop longue (${String(bodyText).length} chars), envoi outbound plain text.`);
    try {
      const client = twilioService.getTwilioClient();
      const config = twilioService.getTwilioConfig();
      const fullText = appendTextFooter(bodyText, lang, { includeBack: true });

      const basePayload = { to: twilioService.normalizeWhatsAppAddress(to) };
      if (config.whatsappFrom) basePayload.from = config.whatsappFrom;
      else if (config.messagingServiceSid) basePayload.messagingServiceSid = config.messagingServiceSid;
      else return null;

      if (fullText.length <= MAX_WA_BODY) {
        const result = await client.messages.create({ ...basePayload, body: fullText });
        console.log(`[footer] Outbound envoyé (${fullText.length} chars) → ${result.sid}`);
        return result;
      }

      // Split at the last paragraph break before the limit
      const splitAt = fullText.lastIndexOf('\n\n', MAX_WA_BODY);
      const cut = splitAt > 200 ? splitAt : MAX_WA_BODY;
      const part1 = fullText.slice(0, cut).trim();
      const part2 = fullText.slice(cut).trim();

      const r1 = await client.messages.create({ ...basePayload, body: part1 });
      console.log(`[footer] Outbound part 1 (${part1.length} chars) → ${r1.sid}`);
      if (part2) {
        const r2 = await client.messages.create({ ...basePayload, body: part2 });
        console.log(`[footer] Outbound part 2 (${part2.length} chars) → ${r2.sid}`);
      }
      return r1;
    } catch (err) {
      console.error(`[footer] Outbound plain message failed: ${err.message}`);
      return null;
    }
  }

  if (!interactive.isInteractiveEnabled() || !isFooterQuickReplyEnabled()) return null;

  const cacheKey = `${FOOTER_CACHE_KEY_PREFIX}_${lang}`;

  // Résoudre le SID du template footer
  let sid;
  try {
    // resolveTemplate est une fonction interne — on y accède via le cache + l'API Twilio
    const client = twilioService.getTwilioClient();
    const config = twilioService.getTwilioConfig();

    // Vérifier le cache
    const fs = require('fs');
    const path = require('path');
    const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'interactive_templates.json');

    let cache = {};
    try {
      if (fs.existsSync(CACHE_PATH)) cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch (_) {}

    const TEMPLATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const entry = cache[cacheKey];
    const isFresh = entry && entry.sid && entry.created_at &&
      (Date.now() - new Date(entry.created_at).getTime() < TEMPLATE_TTL_MS);

    if (isFresh) {
      sid = entry.sid;
    } else {
      const spec = buildFooterSpec(lang);
      try {
        const created = await client.content.v1.contents.create(spec);
        sid = created.sid;
        cache[cacheKey] = { sid, created_at: new Date().toISOString() };
        fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
        console.log(`[footer] Template créé : ${cacheKey} → ${sid}`);
      } catch (createErr) {
        console.warn(`[footer] Création échouée "${cacheKey}": ${createErr.message} — recherche existant...`);
        const all = await client.content.v1.contents.list({ limit: 100 });
        const match = all.find((tmpl) => tmpl.friendlyName === spec.friendlyName);
        if (match) {
          sid = match.sid;
          cache[cacheKey] = { sid, created_at: new Date().toISOString() };
          fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
          console.log(`[footer] Template existant réutilisé : ${cacheKey} → ${sid}`);
        }
      }
    }

    if (!sid) return null;

    const safeBody = String(bodyText || '');

    const payload = {
      to: twilioService.normalizeWhatsAppAddress(to),
      contentSid: sid,
      contentVariables: JSON.stringify({ '1': safeBody }),
    };

    if (config.whatsappFrom) {
      payload.from = config.whatsappFrom;
    } else if (config.messagingServiceSid) {
      payload.messagingServiceSid = config.messagingServiceSid;
    } else {
      return null;
    }

    const statusCallback = twilioService.buildStatusCallbackUrl();
    if (statusCallback) payload.statusCallback = statusCallback;

    return await client.messages.create(payload);

  } catch (err) {
    console.error(`[footer] sendAIResponseWithFooter failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  appendTextFooter,
  buildTextFooter,
  isFooterQuickReplyEnabled,
  sendAIResponseWithFooter,
};
