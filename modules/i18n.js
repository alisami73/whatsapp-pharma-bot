'use strict';

/**
 * modules/i18n.js
 *
 * Helper de traduction minimal.
 * Charge les fichiers locales/{lang}.json et expose t(key, lang, vars).
 * Fallback automatique vers 'fr' si la clé est absente dans la langue demandée.
 */

const path = require('path');
const fs = require('fs');

const SUPPORTED_LANGS = ['fr', 'ar', 'es', 'ru'];
const DEFAULT_LANG = 'fr';
const LOCALES_DIR = path.join(__dirname, '..', 'locales');

// Cache en mémoire — chargé une fois au démarrage
const _cache = {};

function loadLocale(lang) {
  if (_cache[lang]) return _cache[lang];
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  try {
    _cache[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    _cache[lang] = {};
  }
  return _cache[lang];
}

// Précharger toutes les langues au démarrage
SUPPORTED_LANGS.forEach(loadLocale);

/**
 * Retourne la traduction d'une clé dans la langue donnée.
 * @param {string} key   - Clé dans le fichier locale (ex: 'cgu_accept')
 * @param {string} lang  - Code langue : 'fr' | 'ar' | 'es' | 'ru'
 * @param {object} vars  - Variables à interpoler (ex: { url: 'https://...' })
 * @returns {string}
 */
function t(key, lang, vars = {}) {
  const safeLang = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
  const locale = loadLocale(safeLang);
  const fallback = loadLocale(DEFAULT_LANG);

  let value = locale[key] !== undefined ? locale[key] : (fallback[key] || key);

  // Interpolation : remplacer {variableName} par la valeur
  for (const [varKey, varVal] of Object.entries(vars)) {
    value = value.replace(new RegExp(`\\{${varKey}\\}`, 'g'), String(varVal));
  }

  return value;
}

/**
 * Normalise un code langue entrant (payload bouton ou texte libre).
 * @param {string} input
 * @returns {'fr'|'ar'|'es'|'ru'|null}
 */
function parseLang(input) {
  const norm = String(input || '').toLowerCase().trim();
  if (norm === 'lang_fr' || norm === 'fr' || norm.includes('français') || norm.includes('francais')) return 'fr';
  if (norm === 'lang_ar' || norm === 'ar' || norm.includes('عربية') || norm.includes('arabe')) return 'ar';
  if (norm === 'lang_es' || norm === 'es' || norm.includes('español') || norm.includes('espagnol')) return 'es';
  if (norm === 'lang_ru' || norm === 'ru' || norm.includes('русский') || norm.includes('russe')) return 'ru';
  return null;
}

module.exports = { t, parseLang, SUPPORTED_LANGS, DEFAULT_LANG };
