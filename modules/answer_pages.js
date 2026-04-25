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
const { createClient } = require('@supabase/supabase-js');

const TABLE = 'chatbot_answer_history';

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function isEnabled() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
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

/**
 * Sauvegarde une réponse IA et retourne l'UUID de la page.
 */
async function saveAnswer({ topic, userPhone, question, answer, sources = null }) {
  const client = getClient();
  if (!client) throw new Error('Supabase non configuré');

  const id          = crypto.randomUUID();
  const phoneHash   = hashPhone(userPhone);

  const { error } = await client.from(TABLE).insert({
    id,
    user_phone_hash: phoneHash,
    rubrique:        topic,
    question,
    answer,
    sources:         sources ? JSON.stringify(sources) : null,
    page_slug:       id,
    created_at:      new Date().toISOString(),
  });

  if (error) throw new Error(error.message);
  return id;
}

/**
 * Récupère une réponse par son UUID.
 */
async function getAnswer(id) {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Récupère l'historique d'un utilisateur (par hash de téléphone).
 */
async function getUserHistory(phone, limit = 20) {
  const client = getClient();
  if (!client) return [];

  const phoneHash = hashPhone(phone);
  const { data } = await client
    .from(TABLE)
    .select('id, rubrique, question, created_at, page_slug')
    .eq('user_phone_hash', phoneHash)
    .order('created_at', { ascending: false })
    .limit(limit);

  return data || [];
}

/**
 * Construit l'URL publique d'une réponse.
 */
function buildAnswerUrl(topic, id) {
  return `${getBaseUrl()}/answers/${topic}/${id}`;
}

/**
 * Construit le message WhatsApp envoyé après génération.
 */
function buildAnswerReadyMessage(topic, id, lang = 'fr') {
  const url = buildAnswerUrl(topic, id);
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

  const title    = (labels[topic] || labels.fse)[lang] || (labels[topic] || labels.fse).fr;
  const subtitle = subtitles[lang] || subtitles.fr;

  return `${title}\n\n${url}\n\n_${subtitle}_`;
}

module.exports = {
  isEnabled,
  hashPhone,
  saveAnswer,
  getAnswer,
  getUserHistory,
  buildAnswerUrl,
  buildAnswerReadyMessage,
};
