'use strict';

/**
 * modules/themes/software.js
 *
 * Handler du thème "Logiciel Blink Premium".
 * Présente un Carrousel 2 (Phase 1 = list-picker) avec 3 sous-actions :
 *   sw_call_me          → envoie WhatsApp au commercial + confirme à l'utilisateur
 *   sw_benefits         → liste les avantages Blink Premium
 *   sw_data_protection  → texte sur la protection des données
 *
 * TODO Phase 2: migrate to WhatsApp Template Message with CAROUSEL component
 *               with product images (https://blink.ma/assets/software/{card}.jpg)
 */

const twilioService = require('../../twilio_service');
const { t } = require('../i18n');
const { sendAIResponseWithFooter } = require('../shared/footer');

// Numéro commercial à notifier pour "Appelez-moi"
const COMMERCIAL_PHONE = process.env.COMMERCIAL_PHONE || 'whatsapp:+212661095271';

// TODO: paramétrer via COMMERCIAL_WEBHOOK_URL si besoin d'un webhook CRM en plus du WhatsApp

/**
 * Envoie la notification WhatsApp au commercial quand un utilisateur demande à être rappelé.
 * @param {string} userPhone — numéro de l'utilisateur (ex: whatsapp:+212XXXXXXXXX)
 */
async function notifyCommercial(userPhone, lang) {
  try {
    const config = twilioService.getTwilioConfig();
    const client = twilioService.getTwilioClient();

    const cleanPhone = String(userPhone).replace('whatsapp:', '');
    const notifBody = t('sw_callback_notification', lang, { phone: cleanPhone });

    const payload = {
      to: COMMERCIAL_PHONE,
      body: notifBody,
    };

    if (config.whatsappFrom) {
      payload.from = config.whatsappFrom;
    } else if (config.messagingServiceSid) {
      payload.messagingServiceSid = config.messagingServiceSid;
    }

    await client.messages.create(payload);
    console.log(`[software] Notification commercial envoyée pour ${cleanPhone}`);
  } catch (err) {
    console.error(`[software] Échec notification commercial: ${err.message}`);
  }
}

/**
 * Envoie le carrousel Blink Premium (list-picker Phase 1).
 * Retourne null si les messages interactifs sont désactivés → fallback texte.
 */
async function sendSoftwareCarousel(to, lang) {
  const interactive = require('../interactive');
  if (!interactive.isInteractiveEnabled()) return null;

  const twilioClient = twilioService.getTwilioClient();
  const config = twilioService.getTwilioConfig();

  const fs = require('fs');
  const path = require('path');
  const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'interactive_templates.json');
  const TEMPLATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const cacheKey = `software_carousel_v1_${lang}`;

  let cache = {};
  try {
    if (fs.existsSync(CACHE_PATH)) cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (_) {}

  const entry = cache[cacheKey];
  const isFresh = entry && entry.sid && entry.created_at &&
    (Date.now() - new Date(entry.created_at).getTime() < TEMPLATE_TTL_MS);

  let sid = isFresh ? entry.sid : null;

  if (!sid) {
    const langCode = lang === 'ar' ? 'ar' : lang === 'es' ? 'es' : lang === 'ru' ? 'ru' : 'fr';
    const spec = {
      friendlyName: `blink_software_carousel_v1_${lang}`,
      language: langCode,
      types: {
        'twilio/list-picker': {
          body: t('sw_carousel_body', lang),
          button: t('sw_carousel_button', lang).slice(0, 20),
          items: [
            { id: 'sw_call_me',         item: t('sw_call_me', lang).slice(0, 24) },
            { id: 'sw_benefits',        item: t('sw_benefits', lang).slice(0, 24) },
            { id: 'sw_data_protection', item: t('sw_data_protection', lang).slice(0, 24) },
          ],
        },
      },
    };

    try {
      const created = await twilioClient.content.v1.contents.create(spec);
      sid = created.sid;
      cache[cacheKey] = { sid, created_at: new Date().toISOString() };
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
      console.log(`[software] Template carrousel créé: ${cacheKey} → ${sid}`);
    } catch (createErr) {
      console.warn(`[software] Création carrousel échouée: ${createErr.message} — recherche existant...`);
      try {
        const all = await twilioClient.content.v1.contents.list({ limit: 100 });
        const match = all.find((tmpl) => tmpl.friendlyName === spec.friendlyName);
        if (match) {
          sid = match.sid;
          cache[cacheKey] = { sid, created_at: new Date().toISOString() };
          fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
        }
      } catch (_) {}
    }
  }

  if (!sid) return null;

  const payload = {
    to: twilioService.normalizeWhatsAppAddress(to),
    contentSid: sid,
    contentVariables: '{}',
  };
  if (config.whatsappFrom) {
    payload.from = config.whatsappFrom;
  } else if (config.messagingServiceSid) {
    payload.messagingServiceSid = config.messagingServiceSid;
  }
  const statusCallback = twilioService.buildStatusCallbackUrl();
  if (statusCallback) payload.statusCallback = statusCallback;

  return twilioClient.messages.create(payload);
}

/**
 * Texte fallback du carrousel (si interactif désactivé).
 */
function buildSoftwareCarouselText(lang) {
  return [
    t('sw_carousel_body', lang),
    '',
    `1. ${t('sw_call_me', lang)}`,
    `2. ${t('sw_benefits', lang)}`,
    `3. ${t('sw_data_protection', lang)}`,
    '',
    'Tapez 1, 2 ou 3.',
  ].join('\n');
}

/**
 * Gère la réponse à une sous-action du carrousel Software.
 *
 * @param {string} action       — 'sw_call_me' | 'sw_benefits' | 'sw_data_protection'
 * @param {string} userPhone    — numéro WhatsApp de l'utilisateur
 * @param {string} lang
 * @returns {{ text: string, sentInteractive: boolean }}
 */
async function handleSoftwareAction(action, userPhone, lang) {
  if (action === 'sw_call_me' || action === '1') {
    // Notifier le commercial en parallèle (non-bloquant)
    notifyCommercial(userPhone, lang).catch(() => {});
    return { text: t('sw_callback_confirm', lang), sentInteractive: false };
  }

  if (action === 'sw_benefits' || action === '2') {
    return { text: t('sw_benefits_body', lang), sentInteractive: false };
  }

  if (action === 'sw_data_protection' || action === '3') {
    return { text: t('sw_data_protection_body', lang), sentInteractive: false };
  }

  return null; // action non reconnue
}

module.exports = {
  sendSoftwareCarousel,
  buildSoftwareCarouselText,
  handleSoftwareAction,
};
