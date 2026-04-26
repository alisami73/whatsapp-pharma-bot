'use strict';

/**
 * modules/answer_pages.js
 *
 * Sauvegarde et récupération des réponses IA générées pour FSE et Conformité Pharma.
 * Les réponses sont stockées dans la table Supabase `chatbot_answer_history`.
 * Les pages web sont servies à /answers/:topic/:id
 *
 * Table SQL (à créer dans Supabase) :
 *   voir scripts/create_answer_history_table.sql
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const TABLE = 'chatbot_answer_history';
const LOCAL_STORE_PATH = String(process.env.ANSWER_HISTORY_FILE || '').trim()
  || path.join(__dirname, '..', 'data', 'answer_history.json');
const SUPPORTED_LANGS = new Set(['fr', 'ar', 'es', 'ru']);

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function isEnabled() {
  return true;
}

// Hash du numéro — jamais exposé dans les URLs publiques
function hashPhone(phone) {
  return crypto.createHash('sha256').update(String(phone || '')).digest('hex').slice(0, 16);
}

function getBaseUrl() {
  return String(
    process.env.PUBLIC_BASE_URL || 'https://whatsapp-pharma-bot-production.up.railway.app'
  ).replace(/\/+$/, '');
}

function normalizeTopic(topic) {
  const raw = String(topic || '').trim().toLowerCase();
  if (raw === 'conformite') return 'conformites';
  if (raw === 'conformites') return 'conformites';
  return 'fse';
}

function normalizeLang(lang) {
  return SUPPORTED_LANGS.has(lang) ? lang : 'fr';
}

function ensureLocalStoreDir() {
  try {
    fs.mkdirSync(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  } catch (_) {}
}

function readLocalStore() {
  try {
    if (!fs.existsSync(LOCAL_STORE_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeLocalStore(entries) {
  ensureLocalStoreDir();
  fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

function saveAnswerLocally(record) {
  const entries = readLocalStore();
  entries.unshift(record);
  writeLocalStore(entries);
}

function getLocalAnswer(id) {
  return readLocalStore().find((entry) => entry.id === id) || null;
}

/**
 * Sauvegarde une réponse IA et retourne l'UUID de la page.
 */
async function saveAnswer({ topic, userPhone, question, answer, sources = null, lang = 'fr' }) {
  const id = crypto.randomUUID();
  const record = {
    id,
    user_phone_hash: hashPhone(userPhone),
    rubrique: normalizeTopic(topic),
    question,
    answer,
    sources: sources ? JSON.stringify(sources) : null,
    page_slug: id,
    lang: normalizeLang(lang),
    created_at:      new Date().toISOString(),
  };

  // Toujours persister localement pour garantir que la page web fonctionne
  // même si Supabase n'est pas disponible ou si la table n'existe pas encore.
  saveAnswerLocally(record);

  const client = getClient();
  if (!client) return id;

  try {
    const { lang: _lang, ...supabaseRecord } = record;
    const { error } = await client.from(TABLE).insert(supabaseRecord);
    if (error) {
      console.warn(`[answer_pages] Supabase insert failed, local fallback kept: ${error.message}`);
    }
  } catch (error) {
    console.warn(`[answer_pages] Supabase unavailable, local fallback kept: ${error.message}`);
  }

  return id;
}

/**
 * Récupère une réponse par son UUID.
 */
async function getAnswer(id) {
  const local = getLocalAnswer(id);
  if (local) return local;

  const client = getClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;
    return data;
  } catch (_) {
    return null;
  }
}

/**
 * Récupère l'historique d'un utilisateur (par hash de téléphone).
 */
async function getUserHistory(phone, limit = 20) {
  const localHistory = readLocalStore()
    .filter((entry) => entry.user_phone_hash === hashPhone(phone))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      rubrique: entry.rubrique,
      question: entry.question,
      created_at: entry.created_at,
      page_slug: entry.page_slug,
      lang: entry.lang || 'fr',
    }));

  const client = getClient();
  if (!client) return localHistory;

  try {
    const phoneHash = hashPhone(phone);
    const { data } = await client
      .from(TABLE)
      .select('id, rubrique, question, created_at, page_slug')
      .eq('user_phone_hash', phoneHash)
      .order('created_at', { ascending: false })
      .limit(limit);

    return (data && data.length) ? data : localHistory;
  } catch (_) {
    return localHistory;
  }
}

/**
 * Construit l'URL publique d'une réponse.
 */
function buildAnswerUrl(topic, id, lang = null) {
  const safeTopic = normalizeTopic(topic);
  const safeId = String(id || '').trim();
  const safeLang = lang ? normalizeLang(lang) : null;
  if (safeLang) return `${getBaseUrl()}/answers/${safeTopic}/${safeLang}/${safeId}`;
  return `${getBaseUrl()}/answers/${safeTopic}/${safeId}`;
}

/**
 * Construit le message WhatsApp envoyé après génération.
 */
function buildAnswerReadyMessage(topic, id, lang = 'fr') {
  const safeLang = normalizeLang(lang);
  const url = buildAnswerUrl(topic, id, safeLang);
  const labels = {
    fse: {
      fr: '📋 *Votre réponse FSE est prête*',
      ar: '📋 *إجابتك حول FSE جاهزة*',
      es: '📋 *Tu respuesta FSE está lista*',
      ru: '📋 *Ваш ответ по ФСЭ готов*',
    },
    conformites: {
      fr: '⚖️ *Votre réponse Conformité est prête*',
      ar: '⚖️ *إجابتك حول الامتثال جاهزة*',
      es: '⚖️ *Tu respuesta de Conformidad está lista*',
      ru: '⚖️ *Ваш ответ по Соответствию готов*',
    },
  };

  const subtitles = {
    fr: 'Réponse complète + téléchargement PDF sur la page.',
    ar: 'الإجابة الكاملة + تحميل PDF في الصفحة.',
    es: 'Respuesta completa + descarga PDF en la página.',
    ru: 'Полный ответ + скачать PDF на странице.',
  };

  const safeTopic = normalizeTopic(topic);
  const title = (labels[safeTopic] || labels.fse)[safeLang] || (labels[safeTopic] || labels.fse).fr;
  const subtitle = subtitles[safeLang] || subtitles.fr;

  return `${title}\n\n${url}\n\n_${subtitle}_`;
}

module.exports = {
  isEnabled,
  hashPhone,
  normalizeTopic,
  normalizeLang,
  saveAnswer,
  getAnswer,
  getUserHistory,
  buildAnswerUrl,
  buildAnswerReadyMessage,
};
