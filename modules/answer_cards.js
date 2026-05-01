'use strict';

const fs = require('fs');
const path = require('path');

const twilioService = require('../twilio_service');
const answerPages = require('./answer_pages');
const { buildPublicAssetUrl } = require('./public_site');

const CACHE_PATH = path.join(__dirname, '..', 'data', 'interactive_templates.json');
const TEMPLATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOPIC_META = {
  fse: {
    asset: 'public/carousel/fse.jpg',
    copy: {
      fr: {
        friendlyName: 'blink_answer_card_fse_v2_fr',
        button: 'Voir les détails',
        footer: 'Blink Premium',
        intro: '📋 Soins Électroniques — FSE CNSS',
        ready: 'Votre réponse détaillée est prête.',
        textFallback: 'Ouvrez la page détaillée :',
      },
      ar: {
        friendlyName: 'blink_answer_card_fse_v2_ar',
        button: 'عرض التفاصيل',
        footer: 'Blink Premium',
        intro: '📋 ورقة العلاج الإلكترونية — CNSS',
        ready: 'إجابتكم المفصلة جاهزة.',
        textFallback: 'افتحوا الصفحة التفصيلية:',
      },
      es: {
        friendlyName: 'blink_answer_card_fse_v2_es',
        button: 'Ver detalles',
        footer: 'Blink Premium',
        intro: '📋 Hoja Electrónica de Cuidados — CNSS',
        ready: 'Su respuesta detallada está lista.',
        textFallback: 'Abra la página detallada:',
      },
      ru: {
        friendlyName: 'blink_answer_card_fse_v2_ru',
        button: 'Подробнее',
        footer: 'Blink Premium',
        intro: '📋 Электронный листок лечения — CNSS',
        ready: 'Ваш подробный ответ готов.',
        textFallback: 'Откройте подробную страницу:',
      },
    },
  },
  conformites: {
    asset: 'public/carousel/conformite-pharma.jpg',
    copy: {
      fr: {
        friendlyName: 'blink_answer_card_conformites_v2_fr',
        button: 'Voir les détails',
        footer: 'Blink Premium',
        intro: '⚖️ Conformité Pharma',
        ready: 'Votre réponse détaillée est prête.',
        textFallback: 'Ouvrez la page détaillée :',
      },
      ar: {
        friendlyName: 'blink_answer_card_conformites_v2_ar',
        button: 'عرض التفاصيل',
        footer: 'Blink Premium',
        intro: '⚖️ الامتثال الصيدلي',
        ready: 'إجابتكم المفصلة جاهزة.',
        textFallback: 'افتحوا الصفحة التفصيلية:',
      },
      es: {
        friendlyName: 'blink_answer_card_conformites_v2_es',
        button: 'Ver detalles',
        footer: 'Blink Premium',
        intro: '⚖️ Conformidad Farmacéutica',
        ready: 'Su respuesta detallada está lista.',
        textFallback: 'Abra la página detallada:',
      },
      ru: {
        friendlyName: 'blink_answer_card_conformites_v2_ru',
        button: 'Подробнее',
        footer: 'Blink Premium',
        intro: '⚖️ Фармацевтическое соответствие',
        ready: 'Ваш подробный ответ готов.',
        textFallback: 'Откройте подробную страницу:',
      },
    },
  },
};

function normalizeLang(lang = 'fr') {
  return ['fr', 'ar', 'es', 'ru'].includes(lang) ? lang : 'fr';
}

function normalizeTopic(topic = 'fse') {
  return answerPages.normalizeTopic(topic);
}

function readCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (_) {}
  return {};
}

function writeCache(cache) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('[answer_cards] Impossible d\'écrire le cache templates:', err.message);
  }
}

function isFresh(entry) {
  if (!entry || !entry.sid || !entry.created_at) return false;
  return Date.now() - new Date(entry.created_at).getTime() < TEMPLATE_TTL_MS;
}

function getTopicCopy(topic, lang) {
  const safeTopic = normalizeTopic(topic);
  const safeLang = normalizeLang(lang);
  return TOPIC_META[safeTopic].copy[safeLang];
}

function stripMarkdown(value) {
  return String(value || '')
    .replace(/[*_`#>-]+/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function clipText(value, maxChars) {
  const clean = stripMarkdown(value);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function buildAnswerCardBody({ topic, lang, question, answer }) {
  const copy = getTopicCopy(topic, lang);
  const safeQuestion = clipText(question, 120);
  const safeAnswer = clipText(answer, 260);
  return [
    copy.intro,
    copy.ready,
    '',
    safeQuestion,
    '',
    safeAnswer,
  ].join('\n');
}

function buildAnswerFallbackText({ topic, lang, id }) {
  const copy = getTopicCopy(topic, lang);
  const url = answerPages.buildAnswerUrl(topic, id, lang);
  return `${copy.intro}\n\n${copy.textFallback}\n${url}`;
}

function buildAnswerCardSpec(topic, lang) {
  const safeTopic = normalizeTopic(topic);
  const safeLang = normalizeLang(lang);
  const copy = getTopicCopy(safeTopic, safeLang);
  const sampleId = '00000000-0000-4000-8000-000000000000';
  const sampleBody = buildAnswerCardBody({
    topic: safeTopic,
    lang: safeLang,
    question: 'Exemple de question pharmacien',
    answer: 'Votre réponse détaillée a été générée. Ouvrez la page pour consulter l’explication complète et télécharger le PDF.',
  });
  const sampleUrl = answerPages.buildAnswerUrl(safeTopic, sampleId, safeLang);

  return {
    friendlyName: copy.friendlyName,
    language: safeLang,
    variables: {
      '1': sampleBody,
      '2': sampleId,
      '3': sampleUrl,
    },
    types: {
      'whatsapp/card': {
        body: '{{1}}',
        footer: copy.footer,
        media: [buildPublicAssetUrl(TOPIC_META[safeTopic].asset)],
        actions: [
          {
            type: 'URL',
            title: copy.button.slice(0, 20),
            url: answerPages.buildAnswerUrl(safeTopic, '{{2}}', safeLang),
          },
        ],
      },
      'twilio/text': {
        body: '{{1}}\n\n{{3}}',
      },
    },
  };
}

async function createOrFetchTemplate(cacheKey, spec) {
  if (!twilioService.isTwilioConfigured()) return null;

  const cache = readCache();
  if (isFresh(cache[cacheKey])) return cache[cacheKey].sid;

  const client = twilioService.getTwilioClient();

  try {
    const created = await client.content.v1.contents.create(spec);
    cache[cacheKey] = { sid: created.sid, created_at: new Date().toISOString() };
    writeCache(cache);
    return created.sid;
  } catch (createErr) {
    console.warn(`[answer_cards] Création échouée "${cacheKey}": ${createErr.message} — recherche existant...`);
  }

  try {
    const all = await twilioService.getTwilioClient().content.v1.contents.list({ limit: 100 });
    const match = all.find((tmpl) => tmpl.friendlyName === spec.friendlyName);
    if (match) {
      cache[cacheKey] = { sid: match.sid, created_at: new Date().toISOString() };
      writeCache(cache);
      return match.sid;
    }
  } catch (listErr) {
    console.error(`[answer_cards] Impossible de lister les templates: ${listErr.message}`);
  }

  return null;
}

async function sendAnswerCard(to, { topic, id, lang = 'fr', question, answer }) {
  const interactive = require('./interactive');
  if (!interactive.isInteractiveEnabled()) return null;
  if (!twilioService.isTwilioConfigured()) return null;

  const safeTopic = normalizeTopic(topic);
  const safeLang = normalizeLang(lang);
  const sid = await ensureAnswerCardTemplate(safeTopic, safeLang);
  if (!sid) return null;

  const config = twilioService.getTwilioConfig();
  const client = twilioService.getTwilioClient();
  const payload = {
    to: twilioService.normalizeWhatsAppAddress(to),
    contentSid: sid,
    contentVariables: JSON.stringify({
      '1': buildAnswerCardBody({ topic: safeTopic, lang: safeLang, question, answer }),
      '2': String(id || '').trim(),
      '3': answerPages.buildAnswerUrl(safeTopic, id, safeLang),
    }),
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

  return client.messages.create(payload);
}

async function ensureAnswerCardTemplate(topic, lang = 'fr') {
  if (!twilioService.isTwilioConfigured()) return null;

  const safeTopic = normalizeTopic(topic);
  const safeLang = normalizeLang(lang);
  const cacheKey = `answer_card_v2_${safeTopic}_${safeLang}`;
  const spec = buildAnswerCardSpec(safeTopic, safeLang);
  return createOrFetchTemplate(cacheKey, spec);
}

async function ensureAnswerCardTemplates() {
  const results = [];
  for (const topic of ['fse', 'conformites']) {
    for (const lang of ['fr', 'ar', 'es', 'ru']) {
      try {
        const sid = await ensureAnswerCardTemplate(topic, lang);
        results.push({ topic, lang, sid });
      } catch (error) {
        console.error(`[answer_cards] bootstrap failed for ${topic}/${lang}: ${error.message}`);
        results.push({ topic, lang, sid: null, error: error.message });
      }
    }
  }
  return results;
}

module.exports = {
  TOPIC_META,
  normalizeLang,
  normalizeTopic,
  buildAnswerCardBody,
  buildAnswerFallbackText,
  buildAnswerCardSpec,
  ensureAnswerCardTemplate,
  ensureAnswerCardTemplates,
  sendAnswerCard,
};
