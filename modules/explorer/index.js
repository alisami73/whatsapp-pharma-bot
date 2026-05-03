'use strict';

/**
 * modules/explorer/index.js
 *
 * Explorer carousel — menu principal 5 rubriques.
 *
 * Architecture: chaque carte ouvre une page web dans le viewer WhatsApp (bouton URL).
 * Toute l'interaction se passe dans le navigateur in-app.
 *
 * Rubriques :
 *   💎 Blink Premium       → /
 *   🔔 Actualités Pharma   → /actu.html
 *   📋 FSE CNSS            → /fse.html
 *   ⚖️ Conformité Pharma   → /conformite.html
 *   💊 MedIndex            → /go/medindex  (relay → https://medindex.ma)
 *
 * MedIndex uses a relay URL (/go/medindex) so the template always holds a
 * valid HTTPS URL on our domain.  The v2 SIDs had a bare "medindex://" URL
 * baked in — those are retired.  v4 SIDs are created on first use via the
 * Twilio Content API and cached in data/interactive_templates.json; they
 * require Meta approval before reaching live WhatsApp accounts.
 */

const twilioService = require('../../twilio_service');
const { buildPublicSiteUrl, buildPublicAssetUrl, appendLangQuery } = require('../public_site');

const DEFAULT_EXPLORER_TEMPLATE_VERSION_BY_LANG = Object.freeze({
  fr: '4',
  ar: '5',
  es: '5',
  ru: '4',
});

function normalizeExplorerLang(lang = 'fr') {
  return ['ar', 'es', 'ru'].includes(lang) ? lang : 'fr';
}

function getExplorerTemplateVersion(lang = 'fr') {
  const lcode = normalizeExplorerLang(lang);
  const specific = String(process.env[`TWILIO_EXPLORER_TEMPLATE_VERSION_${lcode.toUpperCase()}`] || '').trim();
  const global = String(process.env.TWILIO_EXPLORER_TEMPLATE_VERSION || '').trim();
  const raw = (specific || global || DEFAULT_EXPLORER_TEMPLATE_VERSION_BY_LANG[lcode] || '4').replace(/^v/i, '');
  return /^[0-9]+$/.test(raw) ? raw : (DEFAULT_EXPLORER_TEMPLATE_VERSION_BY_LANG[lcode] || '4');
}

function getExplorerTemplateCacheKey(lang = 'fr') {
  const lcode = normalizeExplorerLang(lang);
  return `explorer_v${getExplorerTemplateVersion(lcode)}_${lcode}`;
}

function getExplorerTemplateFriendlyName(lang = 'fr') {
  const lcode = normalizeExplorerLang(lang);
  return `blink_explorer_v${getExplorerTemplateVersion(lcode)}_${lcode}`;
}

// ── URL builder ───────────────────────────────────────────────────────────────
function pageUrl(pathname, lang = 'fr') {
  return buildPublicSiteUrl(pathname, appendLangQuery(lang));
}

// ── Multilingual card content ─────────────────────────────────────────────────
const CARD_CONTENT = {
  fr: [
    { title: '💎 Blink Premium',     body: 'Logiciel N°1 gestion officine au Maroc — démo, tarifs & fonctionnalités', btn: 'Découvrir',        url: () => pageUrl('/') },
    { title: '🔔 Actualités Pharma', body: 'Nouveautés, rappels de lots & mises à jour du marché pharma marocain',    btn: 'Consulter',        url: () => pageUrl('/actu.html') },
    { title: '📋 FSE CNSS',          body: 'Tout sur la Feuille de Soins Électronique — posez votre question à l\'IA', btn: 'Poser une question', url: () => pageUrl('/fse.html') },
    { title: '⚖️ Conformité Pharma', body: 'Inspections DMP, stupéfiants, CNDP, Loi 17-04 — réponses instantanées',  btn: 'Poser une question', url: () => pageUrl('/conformite.html') },
    { title: '💊 MedIndex',          body: 'Base médicaments marocains — nom commercial, DCI, dosage & interactions',  btn: 'Ouvrir MedIndex',   url: () => buildPublicSiteUrl('/go/medindex') },
  ],
  ar: [
    { title: '💎 بلينك بريميوم',     body: 'برنامج إدارة الصيدليات N°1 في المغرب — عرض تجريبي وأسعار ومميزات',      btn: 'اكتشف',            url: () => pageUrl('/', 'ar') },
    { title: '🔔 أخبار الصيدلة',     body: 'المستجدات وسحب الدفعات وتحديثات سوق الأدوية المغربي',                   btn: 'استعرض',           url: () => pageUrl('/actu.html', 'ar') },
    { title: '📋 FSE CNSS',          body: 'كل شيء عن وصفة العلاج الإلكترونية — اطرح سؤالك على الذكاء الاصطناعي',   btn: 'اطرح سؤالاً',     url: () => pageUrl('/fse.html', 'ar') },
    { title: '⚖️ الامتثال الصيدلي', body: 'تفتيش DMP والمخدرات وCNDP والقانون 17-04 — إجابات فورية',              btn: 'اطرح سؤالاً',     url: () => pageUrl('/conformite.html', 'ar') },
    { title: '💊 ميدإندكس',          body: 'قاعدة الأدوية المغربية — الاسم التجاري والجرعة والتفاعلات',               btn: 'فتح ميدإندكس',    url: () => buildPublicSiteUrl('/go/medindex') },
  ],
  es: [
    { title: '💎 Blink Premium',     body: 'Software N°1 gestión farmacia en Marruecos — demo, precios y funciones',  btn: 'Descubrir',        url: () => pageUrl('/', 'es') },
    { title: '🔔 Actualidades Pharma',body: 'Novedades, retiradas de lotes y actualizaciones del mercado farmacéutico', btn: 'Consultar',        url: () => pageUrl('/actu.html', 'es') },
    { title: '📋 FSE CNSS',          body: 'Todo sobre la Hoja de Cuidados Electrónica — pregúntele a la IA',         btn: 'Hacer una pregunta', url: () => pageUrl('/fse.html', 'es') },
    { title: '⚖️ Conformidad Pharma',body: 'Inspecciones DMP, estupefacientes, CNDP, Ley 17-04 — respuestas rápidas', btn: 'Hacer una pregunta', url: () => pageUrl('/conformite.html', 'es') },
    { title: '💊 MedIndex',          body: 'Base medicamentos marroquíes — nombre comercial, DCI, dosis e interacciones', btn: 'Abrir MedIndex',   url: () => buildPublicSiteUrl('/go/medindex') },
  ],
  ru: [
    { title: '💎 Blink Premium',     body: 'Программа №1 для аптек Марокко — демо, цены и функции',                  btn: 'Узнать',           url: () => pageUrl('/', 'ru') },
    { title: '🔔 Новости Pharma',    body: 'Новинки, отзывы партий и обновления фармацевтического рынка',             btn: 'Просмотреть',      url: () => pageUrl('/actu.html', 'ru') },
    { title: '📋 FSE CNSS',          body: 'Всё об электронном листе лечения — задайте вопрос ИИ',                    btn: 'Задать вопрос',    url: () => pageUrl('/fse.html', 'ru') },
    { title: '⚖️ Соответствие Pharma',body: 'Инспекции DMP, наркотики, CNDP, Закон 17-04 — мгновенные ответы',      btn: 'Задать вопрос',    url: () => pageUrl('/conformite.html', 'ru') },
    { title: '💊 MedIndex',          body: 'База лекарств Марокко — торговое название, МНН, доза и взаимодействия',   btn: 'Открыть MedIndex', url: () => buildPublicSiteUrl('/go/medindex') },
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

// ── Template spec builder (versioned — URL buttons via relay URLs) ───────────
// v2 SIDs are retired: they contained "medindex://" which Android cannot open.
// Current templates use /go/medindex (HTTPS relay on our domain) for the MedIndex card.
function buildExplorerV3Spec(lang) {
  const lcode = normalizeExplorerLang(lang);
  const cards  = CARD_CONTENT[lcode];
  return {
    friendlyName: getExplorerTemplateFriendlyName(lcode),
    language: lcode,
    types: {
      'twilio/carousel': {
        body: CAROUSEL_BODY[lcode],
        cards: cards.map((c, i) => ({
          title:  c.title,
          body:   c.body,
          media:  buildPublicAssetUrl(`/public/carousel/${CAROUSEL_IMAGES[i]}`),
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

// ── Send carousel ─────────────────────────────────────────────────────────────
async function sendExplorerCarousel(to, lang = 'fr') {
  const interactive = require('../interactive');
  if (!interactive.isInteractiveEnabled()) return null;

  const lcode = normalizeExplorerLang(lang);
  const cacheKey = getExplorerTemplateCacheKey(lcode);
  const friendlyName = getExplorerTemplateFriendlyName(lcode);

  // Resolve SID via shared resolveTemplate (creates + caches; needs Meta approval before live use)
  let sid;
  try {
    sid = await interactive.resolveTemplate(cacheKey, () => buildExplorerV3Spec(lcode));
  } catch (err) {
    console.error(`[explorer] resolveTemplate failed for ${cacheKey}: ${err.message}`);
    return null;
  }

  if (!sid) {
    console.error(`[explorer] Aucun SID disponible pour ${cacheKey}`);
    return null;
  }

  console.log(`[explorer] Envoi carousel ${friendlyName} sid=${sid} to=${to}`);

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
  const lines = {
    fr: [
      '✨ *Explorer Blink Premium*\n',
      `1. 💎 Blink Premium → ${pageUrl('/')}`,
      `2. 🔔 Actualités Pharma → ${pageUrl('/actu.html')}`,
      `3. 📋 FSE CNSS → ${pageUrl('/fse.html')}`,
      `4. ⚖️ Conformité Pharma → ${pageUrl('/conformite.html')}`,
      `5. 💊 MedIndex → ${buildPublicSiteUrl('/go/medindex')}`,
    ],
    ar: [
      '✨ *استكشف بلينك بريميوم*\n',
      `1. 💎 بلينك بريميوم → ${pageUrl('/', 'ar')}`,
      `2. 🔔 أخبار الصيدلة → ${pageUrl('/actu.html', 'ar')}`,
      `3. 📋 FSE CNSS → ${pageUrl('/fse.html', 'ar')}`,
      `4. ⚖️ الامتثال الصيدلي → ${pageUrl('/conformite.html', 'ar')}`,
      `5. 💊 ميدإندكس → ${buildPublicSiteUrl('/go/medindex')}`,
    ],
    es: [
      '✨ *Explorar Blink Premium*\n',
      `1. 💎 Blink Premium → ${pageUrl('/', 'es')}`,
      `2. 🔔 Actualidades Pharma → ${pageUrl('/actu.html', 'es')}`,
      `3. 📋 FSE CNSS → ${pageUrl('/fse.html', 'es')}`,
      `4. ⚖️ Conformidad Pharma → ${pageUrl('/conformite.html', 'es')}`,
      `5. 💊 MedIndex → ${buildPublicSiteUrl('/go/medindex')}`,
    ],
    ru: [
      '✨ *Обзор Blink Premium*\n',
      `1. 💎 Blink Premium → ${pageUrl('/', 'ru')}`,
      `2. 🔔 Новости Pharma → ${pageUrl('/actu.html', 'ru')}`,
      `3. 📋 FSE CNSS → ${pageUrl('/fse.html', 'ru')}`,
      `4. ⚖️ Соответствие Pharma → ${pageUrl('/conformite.html', 'ru')}`,
      `5. 💊 MedIndex → ${buildPublicSiteUrl('/go/medindex')}`,
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
  normalizeExplorerLang,
  getExplorerTemplateVersion,
  getExplorerTemplateCacheKey,
  getExplorerTemplateFriendlyName,
  buildExplorerV3Spec,
  sendExplorerCarousel,
  buildExplorerFallbackText,
  resolveExplorerPayload,
  isExplorerPayload,
};
