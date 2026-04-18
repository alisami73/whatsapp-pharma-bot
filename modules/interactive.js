'use strict';

/**
 * modules/interactive.js
 *
 * Gère les messages WhatsApp interactifs (boutons quick-reply, listes, carousel)
 * via l'API Twilio Content. Chaque template est créé une fois puis mis en cache
 * dans data/interactive_templates.json.
 *
 * Toutes les fonctions publiques retournent null si l'interactif n'est pas
 * disponible (Twilio non configuré, création échouée) — le caller doit alors
 * basculer sur le fallback texte.
 */

const fs = require('fs');
const path = require('path');
const twilioService = require('../twilio_service');

const CACHE_PATH = path.join(__dirname, '..', 'data', 'interactive_templates.json');
const TEMPLATE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

// ─── Cache I/O ────────────────────────────────────────────────────────────────

function readCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    }
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

function buildConsentSpec() {
  return {
    friendlyName: 'blink_consent_v1',
    types: {
      'twilio/quick-reply': {
        body: [
          'Pour utiliser ce service, vous confirmez que :',
          '',
          '✅ Vous êtes pharmacien ou utilisez ce service sous votre responsabilité',
          '✅ Vous acceptez de recevoir des messages WhatsApp liés aux services actifs',
          '✅ Vous validez les informations avant de les appliquer',
          '✅ Vous respectez les limites de votre rôle',
        ].join('\n'),
        actions: [
          { id: 'consent_yes', title: "J'accepte" },
          { id: 'consent_no', title: 'Je refuse' },
        ],
      },
    },
  };
}

function buildRoleSpec() {
  return {
    friendlyName: 'blink_role_v1',
    types: {
      'twilio/list-picker': {
        body: [
          '🇲🇦 مرحبًا بكم في Blink Premium.',
          'نضع خدمتنا المدعومة بالذكاء الاصطناعي لأسئلتكم حول ورقة العلاجات الإلكترونية.',
          '',
          '🇫🇷 Bienvenue dans le Chatbot Blink Premium.',
          'Nous mettons notre service IA pour répondre à vos questions sur la FSE.',
          '',
          '🇪🇸 Bienvenido al Chatbot Blink Premium.',
          'Nuestro servicio IA responde sus preguntas sobre la Hoja Electrónica.',
          '',
          '🇷🇺 Добро пожаловать в Blink Premium.',
          'Наш сервис ИИ отвечает на ваши вопросы об Электронном листе.',
        ].join('\n'),
        button: 'Choisir mon rôle',
        items: [
          { id: 'role_titulaire', item: 'Pharmacien titulaire' },
          { id: 'role_adjoint', item: 'Pharmacien adjoint / collaborateur' },
          { id: 'role_autre', item: 'Autre rôle' },
        ],
      },
    },
  };
}

function themeHash(themes) {
  const str = themes.map((t) => `${t.id}:${t.title}`).join('|');
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

function buildMenuSpec(activeThemes) {
  const items = activeThemes.slice(0, 10).map((theme) => ({
    id: `theme_${theme.id}`,
    item: theme.title.length > 24 ? theme.title.slice(0, 22) + '…' : theme.title,
    description: (theme.intro_message || '').slice(0, 72),
  }));

  return {
    friendlyName: `blink_menu_v1_${themeHash(activeThemes)}`,
    types: {
      'twilio/list-picker': {
        body: 'Blink Premium — Choisissez un service :',
        button: 'Voir les services',
        items,
      },
    },
  };
}

// ─── Core: create template + cache SID ───────────────────────────────────────

async function resolveTemplate(cacheKey, buildSpec) {
  if (!twilioService.isTwilioConfigured()) return null;

  const cache = readCache();
  if (isFresh(cache[cacheKey])) {
    return cache[cacheKey].sid;
  }

  try {
    const client = twilioService.getTwilioClient();
    const spec = buildSpec();
    const created = await client.content.v1.contents.create(spec);
    cache[cacheKey] = { sid: created.sid, created_at: new Date().toISOString() };
    writeCache(cache);
    console.log(`[interactive] Template créé : ${cacheKey} → ${created.sid}`);
    return created.sid;
  } catch (err) {
    console.error(`[interactive] Création template échouée pour "${cacheKey}":`, err.message || err);
    return null;
  }
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

async function sendInteractive(to, contentSid) {
  return twilioService.sendWhatsAppMessage({ to, contentSid, contentVariables: {} });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Envoie l'écran de consentement (quick-reply 2 boutons).
 * Retourne null si l'envoi est impossible → le caller bascule en texte.
 */
async function sendConsentScreen(to) {
  const sid = await resolveTemplate('consent_v1', buildConsentSpec);
  if (!sid) return null;
  return sendInteractive(to, sid);
}

/**
 * Envoie l'écran de sélection de rôle (list-picker 3 items).
 * Retourne null si l'envoi est impossible → le caller bascule en texte.
 */
async function sendRoleScreen(to) {
  const sid = await resolveTemplate('role_v1', buildRoleSpec);
  if (!sid) return null;
  return sendInteractive(to, sid);
}

/**
 * Envoie le menu principal (list-picker, un item par thème actif).
 * Le template est re-créé si la liste des thèmes change.
 * Retourne null si l'envoi est impossible → le caller bascule en texte.
 */
async function sendMenuScreen(to, activeThemes) {
  if (!activeThemes || !activeThemes.length) return null;
  const key = `menu_v1_${themeHash(activeThemes)}`;
  const sid = await resolveTemplate(key, () => buildMenuSpec(activeThemes));
  if (!sid) return null;
  return sendInteractive(to, sid);
}

module.exports = {
  sendConsentScreen,
  sendRoleScreen,
  sendMenuScreen,
};
