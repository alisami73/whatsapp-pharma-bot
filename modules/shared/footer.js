'use strict';

/**
 * modules/shared/footer.js
 *
 * sendAIResponseWithFooter(to, lang, bodyText)
 *
 * Envoie la réponse IA (bodyText) dans un message twilio/quick-reply
 * incluant 2 boutons footer :
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
  if (!interactive.isInteractiveEnabled()) return null;

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

    // Tronquer le texte à 1024 chars (limite Twilio quick-reply body)
    const safeBody = String(bodyText || '').slice(0, 1024);

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

module.exports = { sendAIResponseWithFooter };
