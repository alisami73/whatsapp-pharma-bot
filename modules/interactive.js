'use strict';

/**
 * modules/interactive.js
 *
 * Gère les messages WhatsApp interactifs via l'API Twilio Content.
 * Chaque template est créé une fois puis mis en cache dans data/interactive_templates.json.
 *
 * Screens :
 *   1. sendLanguageScreen(to)          — list-picker 4 langues (même pour tous)
 *   2. sendConsentScreen(to, lang)     — quick-reply CGU (1 template par langue)
 *   3. sendRoleScreen(to, lang)        — list-picker rôle (1 template par langue)
 *   4. sendMenuScreen(to, themes, lang) — list-picker thèmes actifs
 *
 * Toutes les fonctions retournent null si l'interactif est indisponible → fallback texte.
 *
 * Activer avec : INTERACTIVE_MESSAGES_ENABLED=true (variable Railway).
 */

const fs = require('fs');
const path = require('path');
const twilioService = require('../twilio_service');
const { t } = require('./i18n');

const CACHE_PATH = path.join(__dirname, '..', 'data', 'interactive_templates.json');
const TEMPLATE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function isInteractiveEnabled() {
  return String(process.env.INTERACTIVE_MESSAGES_ENABLED || '').toLowerCase() === 'true';
}

// ─── Cache I/O ────────────────────────────────────────────────────────────────

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
    console.error('[interactive] Impossible d\'écrire le cache templates:', err.message);
  }
}

function isFresh(entry) {
  if (!entry || !entry.sid || !entry.created_at) return false;
  return Date.now() - new Date(entry.created_at).getTime() < TEMPLATE_TTL_MS;
}

// ─── Template specs ───────────────────────────────────────────────────────────

function buildLanguageSpec() {
  return {
    friendlyName: 'blink_language_v1',
    language: 'fr',
    types: {
      'twilio/list-picker': {
        body: t('language_body', 'fr'),
        button: t('language_button', 'fr'),
        items: [
          { id: 'lang_ar', item: t('lang_ar', 'fr') },
          { id: 'lang_fr', item: t('lang_fr', 'fr') },
          { id: 'lang_es', item: t('lang_es', 'fr') },
          { id: 'lang_ru', item: t('lang_ru', 'fr') },
        ],
      },
    },
  };
}

function buildConsentSpec(lang) {
  return {
    friendlyName: `blink_consent_v2_${lang}`,
    language: lang === 'ar' ? 'ar' : lang === 'es' ? 'es' : lang === 'ru' ? 'ru' : 'fr',
    types: {
      'twilio/quick-reply': {
        body: t('cgu_body', lang),
        actions: [
          { id: 'cgu_accept', title: t('cgu_accept', lang).slice(0, 20) },
          { id: 'cgu_decline', title: t('cgu_decline', lang).slice(0, 20) },
          { id: 'cgu_full', title: t('cgu_full', lang).slice(0, 20) },
        ],
      },
    },
  };
}

function buildRoleSpec(lang) {
  return {
    friendlyName: `blink_role_v2_${lang}`,
    language: lang === 'ar' ? 'ar' : lang === 'es' ? 'es' : lang === 'ru' ? 'ru' : 'fr',
    types: {
      'twilio/list-picker': {
        body: t('role_body', lang),
        button: t('role_button', lang).slice(0, 20),
        items: [
          { id: 'role_titulaire', item: t('role_titulaire', lang).slice(0, 24) },
          { id: 'role_adjoint', item: t('role_adjoint', lang).slice(0, 24) },
          { id: 'role_autre', item: t('role_autre', lang).slice(0, 24) },
        ],
      },
    },
  };
}

function themeHash(themes) {
  const str = themes.map((th) => `${th.id}:${th.title}`).join('|');
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function buildMenuSpec(activeThemes, lang) {
  const items = activeThemes.slice(0, 10).map((theme) => {
    const localizedTitle = t(`theme_${theme.id}`, lang);
    const title = (localizedTitle !== `theme_${theme.id}` ? localizedTitle : theme.title);
    return {
      id: `theme_${theme.id}`,
      item: title.length > 24 ? title.slice(0, 22) + '…' : title,
      description: (theme.intro_message || '').slice(0, 72),
    };
  });

  return {
    friendlyName: `blink_menu_v2_${lang}_${themeHash(activeThemes)}`,
    language: lang === 'ar' ? 'ar' : lang === 'es' ? 'es' : lang === 'ru' ? 'ru' : 'fr',
    types: {
      'twilio/list-picker': {
        body: t('theme_body', lang),
        button: t('theme_button', lang).slice(0, 20),
        items,
      },
    },
  };
}

// ─── Core: resolve template SID (create or reuse) ────────────────────────────

async function resolveTemplate(cacheKey, buildSpec) {
  if (!twilioService.isTwilioConfigured()) return null;

  const cache = readCache();
  if (isFresh(cache[cacheKey])) return cache[cacheKey].sid;

  const client = twilioService.getTwilioClient();
  const spec = buildSpec();

  // Tentative 1 : créer
  try {
    const created = await client.content.v1.contents.create(spec);
    cache[cacheKey] = { sid: created.sid, created_at: new Date().toISOString() };
    writeCache(cache);
    console.log(`[interactive] Template créé : ${cacheKey} → ${created.sid}`);
    return created.sid;
  } catch (createErr) {
    console.warn(`[interactive] Création échouée "${cacheKey}": ${createErr.message} — recherche existant...`);
  }

  // Tentative 2 : retrouver par friendlyName
  try {
    const all = await client.content.v1.contents.list({ limit: 100 });
    const match = all.find((tmpl) => tmpl.friendlyName === spec.friendlyName);
    if (match) {
      cache[cacheKey] = { sid: match.sid, created_at: new Date().toISOString() };
      writeCache(cache);
      console.log(`[interactive] Template existant réutilisé : ${cacheKey} → ${match.sid}`);
      return match.sid;
    }
  } catch (listErr) {
    console.error(`[interactive] Impossible de lister les templates: ${listErr.message}`);
  }

  console.error(`[interactive] Template introuvable pour "${cacheKey}" — fallback texte.`);
  return null;
}

// ─── Send helper ──────────────────────────────────────────────────────────────

async function sendInteractive(to, contentSid) {
  const config = twilioService.getTwilioConfig();
  const client = twilioService.getTwilioClient();

  // Toujours utiliser le numéro direct (TWILIO_WHATSAPP_FROM) pour éviter
  // que le Messaging Service route vers un numéro sandbox US (erreur 63015/63112).
  const payload = {
    to: twilioService.normalizeWhatsAppAddress(to),
    contentSid,
    contentVariables: '{}',
  };

  if (config.whatsappFrom) {
    payload.from = config.whatsappFrom;
  } else if (config.messagingServiceSid) {
    payload.messagingServiceSid = config.messagingServiceSid;
  } else {
    throw new Error('No WhatsApp sender configured.');
  }

  const statusCallback = twilioService.buildStatusCallbackUrl();
  if (statusCallback) payload.statusCallback = statusCallback;

  return client.messages.create(payload);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Écran 1 — Sélection de la langue (identique pour tous).
 */
async function sendLanguageScreen(to) {
  if (!isInteractiveEnabled()) return null;
  const sid = await resolveTemplate('language_v1', buildLanguageSpec);
  if (!sid) return null;
  return sendInteractive(to, sid);
}

/**
 * Écran 2 — CGU dans la langue de l'utilisateur (3 boutons).
 * @param {string} to
 * @param {string} lang  — 'fr'|'ar'|'es'|'ru'
 */
async function sendConsentScreen(to, lang = 'fr') {
  if (!isInteractiveEnabled()) return null;
  const cacheKey = `consent_v2_${lang}`;
  const sid = await resolveTemplate(cacheKey, () => buildConsentSpec(lang));
  if (!sid) return null;
  return sendInteractive(to, sid);
}

/**
 * Écran onboarding — Sélection du rôle dans la langue de l'utilisateur.
 */
async function sendRoleScreen(to, lang = 'fr') {
  if (!isInteractiveEnabled()) return null;
  const cacheKey = `role_v2_${lang}`;
  const sid = await resolveTemplate(cacheKey, () => buildRoleSpec(lang));
  if (!sid) return null;
  return sendInteractive(to, sid);
}

/**
 * Écran 3 — Menu thèmes dans la langue de l'utilisateur.
 */
async function sendMenuScreen(to, activeThemes, lang = 'fr') {
  if (!isInteractiveEnabled()) return null;
  if (!activeThemes || !activeThemes.length) return null;
  const key = `menu_v2_${lang}_${themeHash(activeThemes)}`;
  const sid = await resolveTemplate(key, () => buildMenuSpec(activeThemes, lang));
  if (!sid) return null;
  return sendInteractive(to, sid);
}

module.exports = {
  sendLanguageScreen,
  sendConsentScreen,
  sendRoleScreen,
  sendMenuScreen,
  isInteractiveEnabled,
};
