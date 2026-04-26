'use strict';

/**
 * modules/explorer/index.js
 *
 * Explorer carousel — menu principal 5 rubriques.
 *
 * Architecture: chaque carte ouvre une page web dans le viewer WhatsApp (bouton URL).
 * Plus de QUICK_REPLY — toute l'interaction se passe dans le navigateur in-app.
 *
 * Rubriques :
 *   💎 Blink Premium       → /site/index.html
 *   🔔 Actualités Pharma   → /site/actu.html
 *   📋 FSE CNSS            → /site/fse.html     (Q&A IA dans le navigateur)
 *   ⚖️ Conformité Pharma   → /site/conformite.html (Q&A IA dans le navigateur)
 *   💊 MedIndex            → https://medindex.ma
 */

const twilioService = require('../../twilio_service');

// ── URL builder ───────────────────────────────────────────────────────────────
const DEFAULT_BASE = 'https://whatsapp-pharma-bot-production.up.railway.app';
function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

// ── Multilingual card content ─────────────────────────────────────────────────
const CARD_CONTENT = {
  fr: [
    { title: '💎 Blink Premium',     body: 'Logiciel N°1 gestion officine au Maroc — démo, tarifs & fonctionnalités', btn: 'Découvrir',        url: () => `${baseUrl()}/site/index.html` },
    { title: '🔔 Actualités Pharma', body: 'Nouveautés, rappels de lots & mises à jour du marché pharma marocain',    btn: 'Consulter',        url: () => `${baseUrl()}/site/actu.html` },
    { title: '📋 FSE CNSS',          body: 'Tout sur la Feuille de Soins Électronique — posez votre question à l\'IA', btn: 'Poser une question', url: () => `${baseUrl()}/site/fse.html` },
    { title: '⚖️ Conformité Pharma', body: 'Inspections DMP, stupéfiants, CNDP, Loi 17-04 — réponses instantanées',  btn: 'Poser une question', url: () => `${baseUrl()}/site/conformite.html` },
    { title: '💊 MedIndex',          body: 'Base médicaments marocains — nom commercial, DCI, dosage & interactions',  btn: 'Ouvrir MedIndex',   url: () => 'https://medindex.ma' },
  ],
  ar: [
    { title: '💎 بلينك بريميوم',     body: 'برنامج إدارة الصيدليات N°1 في المغرب — عرض تجريبي وأسعار ومميزات',      btn: 'اكتشف',            url: () => `${baseUrl()}/site/index.html?lang=ar` },
    { title: '🔔 أخبار الصيدلة',     body: 'المستجدات وسحب الدفعات وتحديثات سوق الأدوية المغربي',                   btn: 'استعرض',           url: () => `${baseUrl()}/site/actu.html?lang=ar` },
    { title: '📋 FSE CNSS',          body: 'كل شيء عن وصفة العلاج الإلكترونية — اطرح سؤالك على الذكاء الاصطناعي',   btn: 'اطرح سؤالاً',     url: () => `${baseUrl()}/site/fse.html?lang=ar` },
    { title: '⚖️ الامتثال الصيدلي', body: 'تفتيش DMP والمخدرات وCNDP والقانون 17-04 — إجابات فورية',              btn: 'اطرح سؤالاً',     url: () => `${baseUrl()}/site/conformite.html?lang=ar` },
    { title: '💊 ميدإندكس',          body: 'قاعدة الأدوية المغربية — الاسم التجاري والجرعة والتفاعلات',               btn: 'فتح ميدإندكس',    url: () => 'https://medindex.ma' },
  ],
  es: [
    { title: '💎 Blink Premium',     body: 'Software N°1 gestión farmacia en Marruecos — demo, precios y funciones',  btn: 'Descubrir',        url: () => `${baseUrl()}/site/index.html?lang=es` },
    { title: '🔔 Actualidades Pharma',body: 'Novedades, retiradas de lotes y actualizaciones del mercado farmacéutico', btn: 'Consultar',        url: () => `${baseUrl()}/site/actu.html?lang=es` },
    { title: '📋 FSE CNSS',          body: 'Todo sobre la Hoja de Cuidados Electrónica — pregúntele a la IA',         btn: 'Hacer una pregunta', url: () => `${baseUrl()}/site/fse.html?lang=es` },
    { title: '⚖️ Conformidad Pharma',body: 'Inspecciones DMP, estupefacientes, CNDP, Ley 17-04 — respuestas rápidas', btn: 'Hacer una pregunta', url: () => `${baseUrl()}/site/conformite.html?lang=es` },
    { title: '💊 MedIndex',          body: 'Base medicamentos marroquíes — nombre comercial, DCI, dosis e interacciones', btn: 'Abrir MedIndex',   url: () => 'https://medindex.ma' },
  ],
  ru: [
    { title: '💎 Blink Premium',     body: 'Программа №1 для аптек Марокко — демо, цены и функции',                  btn: 'Узнать',           url: () => `${baseUrl()}/site/index.html?lang=ru` },
    { title: '🔔 Новости Pharma',    body: 'Новинки, отзывы партий и обновления фармацевтического рынка',             btn: 'Просмотреть',      url: () => `${baseUrl()}/site/actu.html?lang=ru` },
    { title: '📋 FSE CNSS',          body: 'Всё об электронном листе лечения — задайте вопрос ИИ',                    btn: 'Задать вопрос',    url: () => `${baseUrl()}/site/fse.html?lang=ru` },
    { title: '⚖️ Соответствие Pharma',body: 'Инспекции DMP, наркотики, CNDP, Закон 17-04 — мгновенные ответы',      btn: 'Задать вопрос',    url: () => `${baseUrl()}/site/conformite.html?lang=ru` },
    { title: '💊 MedIndex',          body: 'База лекарств Марокко — торговое название, МНН, доза и взаимодействия',   btn: 'Открыть MedIndex', url: () => 'https://medindex.ma' },
  ],
};

const CAROUSEL_BODY = {
  fr: '✨ Explorez les rubriques Blink Premium',
  ar: '✨ استكشف أقسام بلينك بريميوم',
  es: '✨ Explore las secciones de Blink Premium',
  ru: '✨ Изучите разделы Blink Premium',
};

const CAROUSEL_IMAGES = [
  'blink-premium.jpg',
  'actu-medicaments.jpg',
  'fse.jpg',
  'conformite-pharma.jpg',
  'medindex.jpg',
];

// ── Template spec builder (v2 — URL buttons) ──────────────────────────────────
function buildExplorerV2Spec(lang) {
  const lcode = ['ar', 'es', 'ru'].includes(lang) ? lang : 'fr';
  const cards  = CARD_CONTENT[lcode];
  return {
    friendlyName: `blink_explorer_v2_${lcode}`,
    language: lcode,
    types: {
      'twilio/carousel': {
        body: CAROUSEL_BODY[lcode],
        cards: cards.map((c, i) => ({
          title:  c.title,
          body:   c.body,
          media:  `${baseUrl()}/public/carousel/${CAROUSEL_IMAGES[i]}`,
          actions: [{
            type:  'URL',
            title: c.btn.slice(0, 25),
            url:   c.url(),
          }],
        })),
      },
    },
  };
}

// ── Approved SIDs ─────────────────────────────────────────────────────────────
// v1 — QUICK_REPLY, approved 2026-04-26 (kept as fallback until v2 approved)
const APPROVED_V1_SIDS = {
  fr: 'HXd9eb17cff40280a0f7ad94978d2625ee',
  ar: 'HX0f8860dfebafb971e29f12fb28a8ae2e',
  es: 'HX72b8a6ba16a01b5056eb27c0323b2feb',
  ru: 'HX80bc43cb8ec1cae4da7da24f0157fac2',
};

// v2 — URL buttons (fill in after Meta approval)
const APPROVED_V2_SIDS = {
  fr: null,
  ar: null,
  es: null,
  ru: null,
};

// ── Send carousel ─────────────────────────────────────────────────────────────
async function sendExplorerCarousel(to, lang = 'fr') {
  const interactive = require('../interactive');
  if (!interactive.isInteractiveEnabled()) return null;

  const lcode = ['ar', 'es', 'ru'].includes(lang) ? lang : 'fr';

  // Use v2 (URL buttons) if approved, else fall back to v1
  const sid = APPROVED_V2_SIDS[lcode] || APPROVED_V1_SIDS[lcode];

  if (!sid) {
    console.error(`[explorer] Aucun SID approuvé pour la langue ${lcode}`);
    return null;
  }

  const version = APPROVED_V2_SIDS[lcode] ? 'v2' : 'v1(fallback)';
  console.log(`[explorer] Envoi carousel ${version} sid=${sid} to=${to}`);

  const config  = twilioService.getTwilioConfig();
  const client  = twilioService.getTwilioClient();
  const payload = { to: twilioService.normalizeWhatsAppAddress(to), contentSid: sid, contentVariables: '{}' };

  if (config.whatsappFrom) payload.from = config.whatsappFrom;
  else if (config.messagingServiceSid) payload.messagingServiceSid = config.messagingServiceSid;
  else {
    console.error('[explorer] Aucun sender configuré');
    return null;
  }

  const cb = twilioService.buildStatusCallbackUrl();
  if (cb) payload.statusCallback = cb;

  try {
    const msg = await client.messages.create(payload);
    console.log(`[explorer] Carousel envoyé OK: msgSid=${msg.sid} status=${msg.status}`);
    return msg;
  } catch (err) {
    console.error(`[explorer] sendExplorerCarousel FAILED: ${err.message} (code=${err.code})`);
    return null;
  }
}

// ── Fallback text (when carousel unsupported) ─────────────────────────────────
function buildExplorerFallbackText(lang) {
  const lcode = ['ar', 'es', 'ru'].includes(lang) ? lang : 'fr';
  const base = baseUrl();
  const lines = {
    fr: [
      '✨ *Explorer Blink Premium*\n',
      `1. 💎 Blink Premium → ${base}/site/index.html`,
      `2. 🔔 Actualités Pharma → ${base}/site/actu.html`,
      `3. 📋 FSE CNSS → ${base}/site/fse.html`,
      `4. ⚖️ Conformité Pharma → ${base}/site/conformite.html`,
      '5. 💊 MedIndex → https://medindex.ma',
    ],
    ar: [
      '✨ *استكشف بلينك بريميوم*\n',
      `1. 💎 بلينك بريميوم → ${base}/site/index.html?lang=ar`,
      `2. 🔔 أخبار الصيدلة → ${base}/site/actu.html?lang=ar`,
      `3. 📋 FSE CNSS → ${base}/site/fse.html?lang=ar`,
      `4. ⚖️ الامتثال الصيدلي → ${base}/site/conformite.html?lang=ar`,
      '5. 💊 ميدإندكس → https://medindex.ma',
    ],
    es: [
      '✨ *Explorar Blink Premium*\n',
      `1. 💎 Blink Premium → ${base}/site/index.html?lang=es`,
      `2. 🔔 Actualidades Pharma → ${base}/site/actu.html?lang=es`,
      `3. 📋 FSE CNSS → ${base}/site/fse.html?lang=es`,
      `4. ⚖️ Conformidad Pharma → ${base}/site/conformite.html?lang=es`,
      '5. 💊 MedIndex → https://medindex.ma',
    ],
    ru: [
      '✨ *Обзор Blink Premium*\n',
      `1. 💎 Blink Premium → ${base}/site/index.html?lang=ru`,
      `2. 🔔 Новости Pharma → ${base}/site/actu.html?lang=ru`,
      `3. 📋 FSE CNSS → ${base}/site/fse.html?lang=ru`,
      `4. ⚖️ Соответствие Pharma → ${base}/site/conformite.html?lang=ru`,
      '5. 💊 MedIndex → https://medindex.ma',
    ],
  };
  return lines[lcode].join('\n');
}

// ── Payload resolution (kept for backward compat with existing QUICK_REPLY v1) ─
const PAYLOAD_TO_THEME = {
  explore_blink_premium:    'software',
  explore_actu_medicaments: 'nouveautes-medicaments',
  explore_fse:              'fse',
  explore_conformite_pharma:'conformites',
  explore_medindex:         'medindex',
  '1': 'software',
  '2': 'nouveautes-medicaments',
  '3': 'fse',
  '4': 'conformites',
  '5': 'medindex',
};

function resolveExplorerPayload(action) { return PAYLOAD_TO_THEME[action] || null; }
function isExplorerPayload(action) {
  return String(action || '').startsWith('explore_') || Boolean(PAYLOAD_TO_THEME[action]);
}

module.exports = {
  CARD_CONTENT,
  APPROVED_V1_SIDS,
  APPROVED_V2_SIDS,
  buildExplorerV2Spec,
  sendExplorerCarousel,
  buildExplorerFallbackText,
  resolveExplorerPayload,
  isExplorerPayload,
};
