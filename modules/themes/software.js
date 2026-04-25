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
 * @param {string} lang
 * @param {'callback'|'demo'|'info'} type — type de la demande
 */
async function notifyCommercial(userPhone, lang, type = 'callback') {
  try {
    const config = twilioService.getTwilioConfig();
    const client = twilioService.getTwilioClient();

    const cleanPhone = String(userPhone).replace('whatsapp:', '');
    const notifKey = type === 'demo' ? 'sw_callback_notif_demo'
      : type === 'info' ? 'sw_callback_notif_info'
      : 'sw_callback_notification';
    const notifBody = t(notifKey, lang, { phone: cleanPhone });

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
  const cacheKey = `software_carousel_v3_${lang}`;

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
      friendlyName: `blink_software_carousel_v3_${lang}`,
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
 * Gère la réponse à une sous-action du carrousel Software (kept for backward-compat).
 */
async function handleSoftwareAction(action, userPhone, lang) {
  if (action === 'sw_call_me' || action === '1') {
    notifyCommercial(userPhone, lang).catch(() => {});
    return { text: t('sw_callback_confirm', lang), sentInteractive: false };
  }
  if (action === 'sw_benefits' || action === '2') {
    return { text: t('sw_benefits_body', lang), sentInteractive: false };
  }
  if (action === 'sw_data_protection' || action === '3') {
    return { text: t('sw_data_protection_body', lang), sentInteractive: false };
  }
  return null;
}

// ── Helper : création/cache d'un template list-picker ───────────────────────
async function createOrFetchListPicker(cacheKey, spec) {
  const fs = require('fs');
  const path = require('path');
  const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'interactive_templates.json');
  const TEMPLATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  let cache = {};
  try {
    if (fs.existsSync(CACHE_PATH)) cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (_) {}

  const entry = cache[cacheKey];
  const isFresh = entry && entry.sid && entry.created_at &&
    (Date.now() - new Date(entry.created_at).getTime() < TEMPLATE_TTL_MS);

  if (isFresh) return entry.sid;

  const client = twilioService.getTwilioClient();
  let sid = null;
  try {
    const created = await client.content.v1.contents.create(spec);
    sid = created.sid;
    cache[cacheKey] = { sid, created_at: new Date().toISOString() };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
    console.log(`[software] Template créé: ${cacheKey} → ${sid}`);
  } catch (createErr) {
    console.warn(`[software] Création échouée (${cacheKey}): ${createErr.message} — recherche existant...`);
    try {
      const all = await client.content.v1.contents.list({ limit: 100 });
      const match = all.find((tmpl) => tmpl.friendlyName === spec.friendlyName);
      if (match) {
        sid = match.sid;
        cache[cacheKey] = { sid, created_at: new Date().toISOString() };
        fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
      }
    } catch (_) {}
  }
  return sid;
}

async function sendListPickerMessage(to, sid, lang) {
  const interactive = require('../interactive');
  if (!interactive.isInteractiveEnabled() || !sid) return null;

  const config = twilioService.getTwilioConfig();
  const client = twilioService.getTwilioClient();

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

  return client.messages.create(payload);
}

// ── Sous-menu "Appelez-moi" (démo ou renseignement) ─────────────────────────

async function sendCallbackSubMenu(to, lang) {
  const interactive = require('../interactive');
  if (!interactive.isInteractiveEnabled()) return null;

  const langCode = lang === 'ar' ? 'ar' : lang === 'es' ? 'es' : lang === 'ru' ? 'ru' : 'fr';
  const cacheKey = `software_callback_sub_v1_${lang}`;
  const spec = {
    friendlyName: `blink_software_callback_sub_v1_${lang}`,
    language: langCode,
    types: {
      'twilio/list-picker': {
        body: t('sw_callback_sub_body', lang),
        button: t('sw_callback_sub_button', lang).slice(0, 20),
        items: [
          { id: 'sw_callback_demo', item: t('sw_callback_demo', lang).slice(0, 24) },
          { id: 'sw_callback_info', item: t('sw_callback_info', lang).slice(0, 24) },
        ],
      },
    },
  };

  const sid = await createOrFetchListPicker(cacheKey, spec);
  return sendListPickerMessage(to, sid, lang);
}

function buildCallbackSubMenuText(lang) {
  return [
    t('sw_callback_sub_body', lang),
    '',
    `1. ${t('sw_callback_demo', lang)}`,
    `2. ${t('sw_callback_info', lang)}`,
    '',
    'Tapez 1 ou 2. RETOUR pour revenir.',
  ].join('\n');
}

function handleCallbackSubAction(action, phone, lang) {
  if (action === 'sw_callback_demo' || action === '1') {
    notifyCommercial(phone, lang, 'demo').catch(() => {});
    return { text: t('sw_callback_confirm_demo', lang) };
  }
  if (action === 'sw_callback_info' || action === '2') {
    notifyCommercial(phone, lang, 'info').catch(() => {});
    return { text: t('sw_callback_confirm_info', lang) };
  }
  return null;
}

// ── FAQ "Pourquoi Blink ?" ───────────────────────────────────────────────────

async function sendBenefitsFAQMenu(to, lang) {
  const interactive = require('../interactive');
  if (!interactive.isInteractiveEnabled()) return null;

  // Approved Meta carousel SIDs — one per language (fr approved 2026-04-25)
  const CAROUSEL_SIDS = {
    fr: 'HX01bacb94b4484ccf7a268865439accdb',
    ar: 'HXd94ea788e7dc9b37f33a9b5e1a1e5074',
    es: 'HXe96feee33bef32e03c97e08260c17ace',
    ru: 'HX96eea6f671fb13c3718dc49b55e8ac20',
  };

  const sid = CAROUSEL_SIDS[lang] || CAROUSEL_SIDS.fr;
  if (!sid) return null;

  const config = twilioService.getTwilioConfig();
  const client = twilioService.getTwilioClient();

  const payload = {
    to: twilioService.normalizeWhatsAppAddress(to),
    contentSid: sid,
    contentVariables: '{}',
  };
  if (config.whatsappFrom) payload.from = config.whatsappFrom;
  else if (config.messagingServiceSid) payload.messagingServiceSid = config.messagingServiceSid;
  else return null;

  const statusCallback = twilioService.buildStatusCallbackUrl();
  if (statusCallback) payload.statusCallback = statusCallback;

  try {
    return await client.messages.create(payload);
  } catch (err) {
    console.error(`[software] sendBenefitsFAQMenu failed: ${err.message}`);
    return null;
  }
}

function buildBenefitsFAQText(lang) {
  return [
    t('sw_benefits_carousel_body', lang),
    '',
    `1. ${t('sw_faq_q1', lang)}`,
    `2. ${t('sw_faq_q2', lang)}`,
    `3. ${t('sw_faq_q3', lang)}`,
    `4. ${t('sw_faq_q4', lang)}`,
    `5. ${t('sw_faq_q5', lang)}`,
    `6. ${t('sw_faq_q6', lang)}`,
    `7. ${t('sw_faq_q7', lang)}`,
    `8. ${t('sw_faq_q8', lang)}`,
    `9. ${t('sw_faq_medindex', lang)}`,
    `10. ${t('sw_faq_ia', lang)}`,
    '',
    'Tapez un numéro. RETOUR pour revenir.',
  ].join('\n');
}

function handleBenefitsFAQAction(action, lang) {
  const map = {
    sw_faq_q1: 'sw_faq_ans_q1',       '1': 'sw_faq_ans_q1',
    sw_faq_q2: 'sw_faq_ans_q2',       '2': 'sw_faq_ans_q2',
    sw_faq_q3: 'sw_faq_ans_q3',       '3': 'sw_faq_ans_q3',
    sw_faq_q4: 'sw_faq_ans_q4',       '4': 'sw_faq_ans_q4',
    sw_faq_q5: 'sw_faq_ans_q5',       '5': 'sw_faq_ans_q5',
    sw_faq_q6: 'sw_faq_ans_q6',       '6': 'sw_faq_ans_q6',
    sw_faq_q7: 'sw_faq_ans_q7',       '7': 'sw_faq_ans_q7',
    sw_faq_q8: 'sw_faq_ans_q8',       '8': 'sw_faq_ans_q8',
    sw_faq_medindex: 'sw_faq_ans_medindex', '9': 'sw_faq_ans_medindex',
    sw_faq_ia: 'sw_faq_ans_ia',       '10': 'sw_faq_ans_ia',
  };
  const key = map[action];
  if (!key) return null;
  return { text: t(key, lang) };
}

// ── FAQ "Mes données & CNDP" ─────────────────────────────────────────────────

async function sendDataFAQMenu(to, lang) {
  const interactive = require('../interactive');
  if (!interactive.isInteractiveEnabled()) return null;

  const langCode = lang === 'ar' ? 'ar' : lang === 'es' ? 'es' : lang === 'ru' ? 'ru' : 'fr';
  const cacheKey = `software_data_faq_v1_${lang}`;
  const spec = {
    friendlyName: `blink_software_data_faq_v1_${lang}`,
    language: langCode,
    types: {
      'twilio/list-picker': {
        body: t('sw_data_faq_body', lang),
        button: t('sw_data_faq_button', lang).slice(0, 20),
        items: [
          { id: 'sw_faq_data_securite',   item: t('sw_faq_data_securite', lang).slice(0, 24) },
          { id: 'sw_faq_data_permission', item: t('sw_faq_data_permission', lang).slice(0, 24) },
          { id: 'sw_faq_data_loi',        item: t('sw_faq_data_loi', lang).slice(0, 24) },
          { id: 'sw_faq_data_controle',   item: t('sw_faq_data_controle', lang).slice(0, 24) },
          { id: 'sw_faq_data_regles',     item: t('sw_faq_data_regles', lang).slice(0, 24) },
        ],
      },
    },
  };

  const sid = await createOrFetchListPicker(cacheKey, spec);
  return sendListPickerMessage(to, sid, lang);
}

function buildDataFAQText(lang) {
  return [
    t('sw_data_faq_body', lang),
    '',
    `1. ${t('sw_faq_data_securite', lang)}`,
    `2. ${t('sw_faq_data_permission', lang)}`,
    `3. ${t('sw_faq_data_loi', lang)}`,
    `4. ${t('sw_faq_data_controle', lang)}`,
    `5. ${t('sw_faq_data_regles', lang)}`,
    '',
    'Tapez un numéro. RETOUR pour revenir.',
  ].join('\n');
}

function handleDataFAQAction(action, lang) {
  const map = {
    sw_faq_data_securite:   'sw_faq_ans_data_securite',   '1': 'sw_faq_ans_data_securite',
    sw_faq_data_permission: 'sw_faq_ans_data_permission',  '2': 'sw_faq_ans_data_permission',
    sw_faq_data_loi:        'sw_faq_ans_data_loi',         '3': 'sw_faq_ans_data_loi',
    sw_faq_data_controle:   'sw_faq_ans_data_controle',    '4': 'sw_faq_ans_data_controle',
    sw_faq_data_regles:     'sw_faq_ans_data_regles',      '5': 'sw_faq_ans_data_regles',
  };
  const key = map[action];
  if (!key) return null;
  return { text: t(key, lang) };
}

module.exports = {
  sendSoftwareCarousel,
  buildSoftwareCarouselText,
  handleSoftwareAction,
  sendCallbackSubMenu,
  buildCallbackSubMenuText,
  handleCallbackSubAction,
  sendBenefitsFAQMenu,
  buildBenefitsFAQText,
  handleBenefitsFAQAction,
  sendDataFAQMenu,
  buildDataFAQText,
  handleDataFAQAction,
};
