'use strict';

/**
 * modules/interactive.js
 *
 * Gère les messages WhatsApp interactifs via l'API Twilio Content.
 * Chaque template est créé une fois puis mis en cache dans data/interactive_templates.json.
 *
 * Screens :
 *   1. sendLanguageScreen(to)          — carousel 4 langues (même pour tous)
 *   2. sendConsentScreen(to, lang)     — quick-reply CGU (3 boutons : accepter, refuser, voir CGU)
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
const supabaseStore = require('./supabase_store');
const twilioContentTemplates = require('./twilio_content_templates');
const { t } = require('./i18n');
const { buildPublicAssetUrl, buildPublicSiteUrl } = require('./public_site');

const CACHE_PATH = path.join(__dirname, '..', 'data', 'interactive_templates.json');
const CACHE_SUPABASE_KEY = 'interactive_templates';
const TEMPLATE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const DEFAULT_APPROVED_LANGUAGE_TEMPLATE_SID = 'HX2908fc06ee9d18dea8127f7d0975f6d8';

function isInteractiveEnabled() {
  return String(process.env.INTERACTIVE_MESSAGES_ENABLED || '').toLowerCase() === 'true';
}

// ─── Cache I/O (Supabase primary, file fallback) ──────────────────────────────

async function readCache() {
  if (supabaseStore.isEnabled()) {
    try {
      const val = await supabaseStore.read(CACHE_SUPABASE_KEY);
      if (val && typeof val === 'object') return val;
    } catch {}
  }
  try {
    if (fs.existsSync(CACHE_PATH)) return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (_) {}
  return {};
}

async function writeCache(cache) {
  if (supabaseStore.isEnabled()) {
    supabaseStore.write(CACHE_SUPABASE_KEY, cache).catch(() => {});
  }
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    if (!supabaseStore.isEnabled()) {
      console.error('[interactive] Impossible d\'écrire le cache templates:', err.message);
    }
  }
}

function isFresh(entry) {
  if (!entry || !entry.sid || !entry.created_at) return false;
  return Date.now() - new Date(entry.created_at).getTime() < TEMPLATE_TTL_MS;
}

// ─── Template specs ───────────────────────────────────────────────────────────

function buildAbsoluteUrl(relativePath) {
  return buildPublicAssetUrl(relativePath);
}

function normalizeInteractiveLang(lang = 'fr') {
  return lang === 'ar' ? 'ar' : lang === 'es' ? 'es' : lang === 'ru' ? 'ru' : 'fr';
}

function buildCguUrl(lang = 'fr') {
  const safeLang = normalizeInteractiveLang(lang);
  const fallbackBaseUrl = buildPublicSiteUrl('/cgu.html');
  const configuredUrl = String(process.env.CGU_URL || fallbackBaseUrl).trim() || fallbackBaseUrl;

  try {
    const url = new URL(configuredUrl);
    url.searchParams.set('lang', safeLang);
    return url.toString();
  } catch (_) {
    const separator = configuredUrl.includes('?') ? '&' : '?';
    return `${configuredUrl}${separator}lang=${encodeURIComponent(safeLang)}`;
  }
}

function buildLanguageCardSpecs() {
  return [
    {
      id: 'lang_ar',
      title: '🇲🇦 العربية',
      body: 'تحدث مع Blink باللغة التي تفضلها',
      cta: 'اختر',
      media: buildAbsoluteUrl('public/onboarding/language-ar.png'),
    },
    {
      id: 'lang_fr',
      title: '🇫🇷 Français',
      body: 'Discutez avec Blink dans la langue que vous préférez',
      cta: 'Choisir',
      media: buildAbsoluteUrl('public/onboarding/language-fr.png'),
    },
    {
      id: 'lang_es',
      title: '🇪🇸 Español',
      body: 'Habla con Blink en el idioma que prefieras',
      cta: 'Elegir',
      media: buildAbsoluteUrl('public/onboarding/language-es.png'),
    },
    {
      id: 'lang_ru',
      title: '🇷🇺 Русский',
      body: 'Общайтесь с Blink на языке, который вы предпочитаете',
      cta: 'Выбрать',
      media: buildAbsoluteUrl('public/onboarding/language-ru.png'),
    },
  ];
}

function buildLanguageSpec() {
  return {
    friendlyName: 'blink_language_v4',
    language: 'fr',
    types: {
      'twilio/carousel': {
        body: t('language_body', 'fr'),
        cards: buildLanguageCardSpecs().map((card) => ({
          title: card.title,
          body: card.body,
          media: card.media,
          actions: [
            {
              type: 'QUICK_REPLY',
              title: card.cta.slice(0, 25),
              id: card.id,
            },
          ],
        })),
      },
    },
  };
}

function buildConsentSpec(lang) {
  const safeLang = normalizeInteractiveLang(lang);
  // twilio/quick-reply does not require Meta pre-approval and delivers instantly.
  // "Voir CGU" sends cgu_full payload → bot replies with URL text → WhatsApp auto-links it.
  return {
    friendlyName: `blink_consent_v2_${safeLang}`,
    language: safeLang,
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
    friendlyName: `blink_role_v3_${lang}`,
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
  if (!twilioService.isTwilioConfigured()) {
    console.warn(`[interactive] resolveTemplate: Twilio not configured — skipping ${cacheKey}`);
    return null;
  }

  const cache = await readCache();
  if (isFresh(cache[cacheKey])) {
    console.log(`[interactive] Cache hit: ${cacheKey} → ${cache[cacheKey].sid}`);
    return cache[cacheKey].sid;
  }
  console.log(`[interactive] Cache miss for "${cacheKey}" — will call Twilio API`);

  const spec = buildSpec();
  twilioContentTemplates.assertFriendlyName(spec);

  // Tentative 1 : réutiliser un template déjà présent
  try {
    const match = await twilioContentTemplates.findTemplateByFriendlyName(spec.friendlyName);
    if (match) {
      cache[cacheKey] = { sid: match.sid, created_at: new Date().toISOString() };
      await writeCache(cache);
      console.log(`[interactive] Template existant réutilisé : ${cacheKey} → ${match.sid}`);
      return match.sid;
    }
  } catch (listErr) {
    console.error(`[interactive] Impossible de lister les templates: ${listErr.message}`);
  }

  // Tentative 2 : créer explicitement avec friendly_name
  try {
    const created = await twilioContentTemplates.createTemplate(spec);
    cache[cacheKey] = { sid: created.sid, created_at: new Date().toISOString() };
    await writeCache(cache);
    console.log(`[interactive] Template créé : ${cacheKey} → ${created.sid}`);
    return created.sid;
  } catch (createErr) {
    console.warn(`[interactive] Création échouée "${cacheKey}": ${createErr.message}`);
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
  if (!isInteractiveEnabled()) {
    console.log('[interactive] sendLanguageScreen: INTERACTIVE_MESSAGES_ENABLED is off — text fallback');
    return null;
  }
  const configuredSid = String(process.env.TWILIO_LANGUAGE_TEMPLATE_SID || '').trim();
  const sid = configuredSid || DEFAULT_APPROVED_LANGUAGE_TEMPLATE_SID;

  if (sid) {
    console.log(`[interactive] sendLanguageScreen → using approved language SID ${sid} for ${to}`);
    const result = await sendInteractive(to, sid);
    console.log(`[interactive] sendLanguageScreen → sent ok, sid=${result && result.sid}, status=${result && result.status}`);
    return result;
  }

  console.log(`[interactive] sendLanguageScreen → resolveTemplate language_v4 for ${to}`);
  const resolvedSid = await resolveTemplate('language_v4', buildLanguageSpec);
  if (!resolvedSid) {
    console.warn('[interactive] sendLanguageScreen: no SID — text fallback');
    return null;
  }
  console.log(`[interactive] sendLanguageScreen → sendInteractive sid=${resolvedSid}`);
  const result = await sendInteractive(to, resolvedSid);
  console.log(`[interactive] sendLanguageScreen → sent ok, sid=${result && result.sid}, status=${result && result.status}`);
  return result;
}

/**
 * Écran 2 — CGU dans la langue de l'utilisateur (2 quick replies + 1 bouton URL).
 * @param {string} to
 * @param {string} lang  — 'fr'|'ar'|'es'|'ru'
 */
async function sendConsentScreen(to, lang = 'fr') {
  if (!isInteractiveEnabled()) return null;
  const cacheKey = `consent_v2_${normalizeInteractiveLang(lang)}`;
  const sid = await resolveTemplate(cacheKey, () => buildConsentSpec(lang));
  if (!sid) return null;
  return sendInteractive(to, sid);
}

/**
 * Écran onboarding — Sélection du rôle dans la langue de l'utilisateur.
 */
async function sendRoleScreen(to, lang = 'fr') {
  if (!isInteractiveEnabled()) return null;
  const cacheKey = `role_v3_${lang}`;
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
  buildCguUrl,
  buildConsentSpec,
  buildLanguageSpec,
  resolveTemplate,
  sendLanguageScreen,
  sendConsentScreen,
  sendRoleScreen,
  sendMenuScreen,
  isInteractiveEnabled,
};
