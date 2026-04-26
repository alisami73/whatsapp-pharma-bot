'use strict';

/**
 * modules/themes/software.js
 *
 * Handler du thème "Logiciel Blink Premium".
 * Présente un carrousel Twilio/WhatsApp avec 3 actions principales :
 *   sw_call_me          → notifie le commercial + renvoie l'image de confirmation
 *   sw_benefits         → ouvre le flow existant "Pourquoi Blink ?"
 *   sw_data_protection  → renvoie un lien vers la page web CNDP
 */

const fs = require('fs');
const path = require('path');

const twilioService = require('../../twilio_service');
const { t } = require('../i18n');
const { sendAIResponseWithFooter } = require('../shared/footer');

// Numéro commercial à notifier pour "Appelez-moi"
const COMMERCIAL_PHONE = process.env.COMMERCIAL_PHONE || 'whatsapp:+212661095271';
const DEFAULT_PUBLIC_BASE_URL = 'https://whatsapp-pharma-bot-production.up.railway.app';
const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'interactive_templates.json');
const TEMPLATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CALLBACK_IMAGE_FILENAME = 'blink-premium-callback-confirmation.png';

// TODO: paramétrer via COMMERCIAL_WEBHOOK_URL si besoin d'un webhook CRM en plus du WhatsApp

function normalizeLang(lang = 'fr') {
  return ['fr', 'ar', 'es', 'ru'].includes(lang) ? lang : 'fr';
}

function getPublicBaseUrl() {
  const configuredBaseUrl = String(twilioService.getTwilioConfig().publicBaseUrl || '').trim();
  return (configuredBaseUrl || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '');
}

function buildAbsoluteUrl(relativePath) {
  return `${getPublicBaseUrl()}/${String(relativePath || '').replace(/^\/+/, '')}`;
}

function getLocalizedCarouselAssetPath(cardNumber, lang) {
  const normalizedLang = normalizeLang(lang);
  const suffix = normalizedLang === 'fr' ? '' : `-${normalizedLang}`;
  return `public/carousel/blink-carte-${String(cardNumber).padStart(2, '0')}${suffix}.jpg`;
}

function getCallbackImageUrl() {
  return buildAbsoluteUrl(`public/carousel/${CALLBACK_IMAGE_FILENAME}`);
}

function getDataCndpPageUrl(lang) {
  const normalizedLang = normalizeLang(lang);
  const suffix = normalizedLang === 'fr' ? '' : `?lang=${normalizedLang}`;
  return `${buildAbsoluteUrl('site/data-cndp.html')}${suffix}`;
}

function readTemplateCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function writeTemplateCache(cache) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (error) {
    console.error(`[software] Impossible d'écrire le cache templates: ${error.message}`);
  }
}

function isFreshCacheEntry(entry) {
  return Boolean(
    entry &&
      entry.sid &&
      entry.created_at &&
      Date.now() - new Date(entry.created_at).getTime() < TEMPLATE_TTL_MS,
  );
}

function buildSoftwareCarouselCards(lang) {
  const normalizedLang = normalizeLang(lang);

  return [
    {
      title: t('sw_call_me', normalizedLang),
      body: t('sw_card_body_call_me', normalizedLang),
      media: getCallbackImageUrl(),
      actions: [
        {
          type: 'QUICK_REPLY',
          title: t('sw_carousel_cta_call_me', normalizedLang).slice(0, 25),
          id: 'sw_call_me',
        },
      ],
    },
    {
      title: t('sw_benefits', normalizedLang),
      body: t('sw_card_body_benefits', normalizedLang),
      media: buildAbsoluteUrl(getLocalizedCarouselAssetPath(1, normalizedLang)),
      actions: [
        {
          type: 'QUICK_REPLY',
          title: t('sw_carousel_cta_benefits', normalizedLang).slice(0, 25),
          id: 'sw_benefits',
        },
      ],
    },
    {
      title: t('sw_data_protection', normalizedLang),
      body: t('sw_card_body_data', normalizedLang),
      media: buildAbsoluteUrl(getLocalizedCarouselAssetPath(3, normalizedLang)),
      actions: [
        {
          type: 'QUICK_REPLY',
          title: t('sw_carousel_cta_data', normalizedLang).slice(0, 25),
          id: 'sw_data_protection',
        },
      ],
    },
  ];
}

function buildSoftwareCarouselSpec(lang) {
  const normalizedLang = normalizeLang(lang);

  return {
    friendlyName: `blink_software_carousel_v6_${normalizedLang}`,
    language: normalizedLang,
    types: {
      'twilio/carousel': {
        body: t('sw_carousel_body', normalizedLang),
        cards: buildSoftwareCarouselCards(normalizedLang),
      },
    },
  };
}

function getSoftwareTemplateArtifacts(lang) {
  const normalizedLang = normalizeLang(lang);
  const spec = buildSoftwareCarouselSpec(normalizedLang);
  const cacheKey = `software_carousel_v6_${normalizedLang}`;

  return {
    lang: normalizedLang,
    cacheKey,
    spec,
    approvalNote:
      'Soumettre le template WhatsApp via le lien approval_create renvoyé par Twilio ou via la console Content Template Builder.',
  };
}

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
 * Envoie le carrousel Blink Premium (template Twilio/WhatsApp).
 * Retourne null si les messages interactifs sont désactivés → fallback texte.
 */
async function sendSoftwareCarousel(to, lang) {
  const interactive = require('../interactive');
  if (!interactive.isInteractiveEnabled()) return null;

  const { cacheKey, spec } = getSoftwareTemplateArtifacts(lang);
  const sid = await createOrFetchContentTemplate(cacheKey, spec);

  if (!sid) return null;

  return sendContentTemplateMessage(to, sid);
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

async function sendCallbackConfirmationImage(to, lang) {
  return twilioService.sendWhatsAppMessage({
    to,
    body: t('sw_callback_confirm', lang),
    mediaUrl: getCallbackImageUrl(),
  });
}

async function handleCallMeRequest(userPhone, lang) {
  notifyCommercial(userPhone, lang).catch(() => {});
  return sendCallbackConfirmationImage(userPhone, lang);
}

function buildDataCndpLinkText(lang) {
  return t('sw_data_page_message', lang, { url: getDataCndpPageUrl(lang) });
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
    return { text: buildDataCndpLinkText(lang), sentInteractive: false };
  }
  return null;
}

// ── Helpers Twilio Content ───────────────────────────────────────────────────
async function createOrFetchContentTemplate(cacheKey, spec) {
  const cache = readTemplateCache();
  const entry = cache[cacheKey];

  if (isFreshCacheEntry(entry)) return entry.sid;

  const client = twilioService.getTwilioClient();
  let sid = null;
  try {
    const created = await client.content.v1.contents.create(spec);
    sid = created.sid;
    cache[cacheKey] = { sid, created_at: new Date().toISOString() };
    writeTemplateCache(cache);
    console.log(`[software] Template créé: ${cacheKey} → ${sid}`);
  } catch (createErr) {
    console.warn(`[software] Création échouée (${cacheKey}): ${createErr.message} — recherche existant...`);
    try {
      const all = await client.content.v1.contents.list({ limit: 100 });
      const match = all.find((tmpl) => tmpl.friendlyName === spec.friendlyName);
      if (match) {
        sid = match.sid;
        cache[cacheKey] = { sid, created_at: new Date().toISOString() };
        writeTemplateCache(cache);
      }
    } catch (_) {}
  }
  return sid;
}

async function sendContentTemplateMessage(to, sid) {
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

// ── Helper : création/cache d'un template list-picker ───────────────────────
async function createOrFetchListPicker(cacheKey, spec) {
  return createOrFetchContentTemplate(cacheKey, spec);
}

async function sendListPickerMessage(to, sid) {
  return sendContentTemplateMessage(to, sid);
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

const FAQ_CARDS = [
  { key: 'sw_faq_q1',       bodyKey: 'sw_card_body_q1',       imgNum: 1 },
  { key: 'sw_faq_q2',       bodyKey: 'sw_card_body_q2',       imgNum: 2 },
  { key: 'sw_faq_q3',       bodyKey: 'sw_card_body_q3',       imgNum: 3 },
  { key: 'sw_faq_q4',       bodyKey: 'sw_card_body_q4',       imgNum: 4 },
  { key: 'sw_faq_q5',       bodyKey: 'sw_card_body_q5',       imgNum: 5 },
  { key: 'sw_faq_q6',       bodyKey: 'sw_card_body_q6',       imgNum: 6 },
  { key: 'sw_faq_q7',       bodyKey: 'sw_card_body_q7',       imgNum: 7 },
  { key: 'sw_faq_q8',       bodyKey: 'sw_card_body_q8',       imgNum: 8 },
  { key: 'sw_faq_medindex', bodyKey: 'sw_card_body_medindex', imgNum: 9 },
  { key: 'sw_faq_ia',       bodyKey: 'sw_card_body_ia',       imgNum: 10 },
];

function buildFAQImageUrl(cardNumber, lang) {
  const normalizedLang = normalizeLang(lang);
  // Cards 09+ have no localized variants — fall back to French image
  const hasLangVariant = cardNumber <= 8 && normalizedLang !== 'fr';
  const suffix = hasLangVariant ? `-${normalizedLang}` : '';
  return buildAbsoluteUrl(`public/carousel/blink-carte-${String(cardNumber).padStart(2, '0')}${suffix}.jpg`);
}

function buildBenefitsFAQCarouselSpec(lang) {
  const normalizedLang = normalizeLang(lang);
  const btnTitle = t('sw_faq_btn_more', normalizedLang).slice(0, 25);
  return {
    friendlyName: `blink_benefits_faq_v2_${normalizedLang}`,
    language: normalizedLang,
    types: {
      'twilio/carousel': {
        body: t('sw_benefits_carousel_body', normalizedLang),
        cards: FAQ_CARDS.map(({ key, bodyKey, imgNum }) => ({
          title: t(key, normalizedLang),
          body: t(bodyKey, normalizedLang),
          media: buildFAQImageUrl(imgNum, normalizedLang),
          actions: [{ type: 'QUICK_REPLY', title: btnTitle, id: key }],
        })),
      },
    },
  };
}

async function sendBenefitsFAQMenu(to, lang) {
  const interactive = require('../interactive');
  if (!interactive.isInteractiveEnabled()) return null;

  const normalizedLang = normalizeLang(lang);
  const cacheKey = `benefits_faq_v2_${normalizedLang}`;
  const sid = await createOrFetchContentTemplate(cacheKey, buildBenefitsFAQCarouselSpec(normalizedLang));
  if (!sid) return null;

  return sendContentTemplateMessage(to, sid);
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
  buildSoftwareCarouselSpec,
  getSoftwareTemplateArtifacts,
  sendSoftwareCarousel,
  buildSoftwareCarouselText,
  handleCallMeRequest,
  buildDataCndpLinkText,
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
