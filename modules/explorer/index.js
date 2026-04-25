'use strict';

/**
 * modules/explorer/index.js
 *
 * Explorer carousel — menu principal 5 rubriques.
 * Remplace la list-picker "Explorer" actuelle par un carousel WhatsApp avec images.
 *
 * Rubriques :
 *   explore_blink_premium       → Blink Premium (logique software existante)
 *   explore_actu_medicaments    → Actu Médicaments (coming soon)
 *   explore_fse                 → FSE CNSS (réponse IA + page web)
 *   explore_conformite_pharma   → Conformité Pharma (réponse IA + page web)
 *   explore_medindex            → MedIndex (URL directe https://medindex.ma)
 */

const fs   = require('fs');
const path = require('path');

const twilioService = require('../../twilio_service');
const { t }         = require('../i18n');

const CACHE_PATH     = path.join(__dirname, '..', '..', 'data', 'interactive_templates.json');
const TEMPLATE_TTL   = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Card definitions ─────────────────────────────────────────────────────────
// Edit titles, bodies, image filenames and button labels here freely.
const EXPLORER_CARDS = [
  {
    id:          'explore_blink_premium',
    title:       '💎 Blink Premium',
    body:        'Logiciel N°1 gestion officine au Maroc — démo & tarifs inclus',
    image:       'blink-premium.jpg',
    buttonLabel: 'Explorer',
    buttonType:  'QUICK_REPLY',
  },
  {
    id:          'explore_actu_medicaments',
    title:       '🔔 Actu Médicaments',
    body:        'Nouveautés, rappels de lots & mises à jour du marché pharma',
    image:       'actu-medicaments.jpg',
    buttonLabel: 'Explorer',
    buttonType:  'QUICK_REPLY',
  },
  {
    id:          'explore_fse',
    title:       '📋 Soins Électroniques',
    body:        'Tout sur la FSE CNSS : déploiement, process, impact & questions',
    image:       'fse.jpg',
    buttonLabel: 'Poser une question',
    buttonType:  'QUICK_REPLY',
  },
  {
    id:          'explore_conformite_pharma',
    title:       '⚖️ Conformité Pharma',
    body:        'Inspections DMP, stupéfiants, CNDP, Loi 17-04 & sanctions',
    image:       'conformite-pharma.jpg',
    buttonLabel: 'Poser une question',
    buttonType:  'QUICK_REPLY',
  },
  {
    id:          'explore_medindex',
    title:       '💊 MedIndex',
    body:        'Base médicaments marocains — nom commercial, DCI & dosages',
    image:       'medindex.jpg',
    buttonLabel: 'Ouvrir MedIndex',
    buttonType:  'QUICK_REPLY',
  },
];

// Maps explore_* payload IDs → internal theme IDs used by the rest of the app
const PAYLOAD_TO_THEME = {
  explore_blink_premium:     'software',
  explore_actu_medicaments:  'nouveautes-medicaments',
  explore_fse:               'fse',
  explore_conformite_pharma: 'conformites',
  explore_medindex:          'medindex',
  // Numeric fallbacks (text input when carousel unsupported)
  '1': 'software',
  '2': 'nouveautes-medicaments',
  '3': 'fse',
  '4': 'conformites',
  '5': 'medindex',
};

// ── Cache helpers ─────────────────────────────────────────────────────────────

function readCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (_) {}
  return {};
}

function writeCache(cache) {
  try { fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8'); } catch (_) {}
}

// ── Template builder ──────────────────────────────────────────────────────────

function getBaseUrl() {
  return String(
    process.env.PUBLIC_BASE_URL || 'https://whatsapp-pharma-bot-production.up.railway.app'
  ).replace(/\/+$/, '');
}

function buildExplorerCarouselSpec(lang) {
  const base  = getBaseUrl();
  const lcode = ['ar', 'es', 'ru'].includes(lang) ? lang : 'fr';

  const cards = EXPLORER_CARDS.map((card) => {
    const actions = [{ type: 'QUICK_REPLY', title: card.buttonLabel.slice(0, 20), id: card.id }];

    return {
      title:  card.title,
      body:   card.body,
      media:  `${base}/public/carousel/${card.image}`,
      actions,
    };
  });

  return {
    friendlyName: `blink_explorer_carousel_v1_${lcode}`,
    language:     lcode,
    types: {
      'twilio/carousel': {
        body:  '✨ Explorer',
        cards,
      },
    },
  };
}

// ── Send carousel ─────────────────────────────────────────────────────────────

async function sendExplorerCarousel(to, lang = 'fr') {
  const interactive = require('../interactive');
  if (!interactive.isInteractiveEnabled()) return null;

  const lcode    = ['ar', 'es', 'ru'].includes(lang) ? lang : 'fr';
  const cacheKey = `explorer_carousel_v1_${lcode}`;
  const cache    = readCache();
  const entry    = cache[cacheKey];
  const isFresh  = entry && entry.sid && entry.created_at &&
    (Date.now() - new Date(entry.created_at).getTime() < TEMPLATE_TTL);

  let sid = isFresh ? entry.sid : null;

  if (!sid) {
    const spec   = buildExplorerCarouselSpec(lcode);
    const client = twilioService.getTwilioClient();
    try {
      const created = await client.content.v1.contents.create(spec);
      sid = created.sid;
      cache[cacheKey] = { sid, created_at: new Date().toISOString() };
      writeCache(cache);
      console.log(`[explorer] Template créé: ${cacheKey} → ${sid}`);
    } catch (err) {
      console.warn(`[explorer] Création échouée: ${err.message} — recherche existant…`);
      try {
        const all   = await client.content.v1.contents.list({ limit: 100 });
        const match = all.find((tmpl) => tmpl.friendlyName === spec.friendlyName);
        if (match) {
          sid = match.sid;
          cache[cacheKey] = { sid, created_at: new Date().toISOString() };
          writeCache(cache);
        }
      } catch (_) {}
    }
  }

  if (!sid) return null;

  const config  = twilioService.getTwilioConfig();
  const client  = twilioService.getTwilioClient();
  const payload = { to: twilioService.normalizeWhatsAppAddress(to), contentSid: sid };

  if (config.whatsappFrom) payload.from = config.whatsappFrom;
  else if (config.messagingServiceSid) payload.messagingServiceSid = config.messagingServiceSid;
  else return null;

  const cb = twilioService.buildStatusCallbackUrl();
  if (cb) payload.statusCallback = cb;

  try {
    return await client.messages.create(payload);
  } catch (err) {
    console.error(`[explorer] sendExplorerCarousel failed: ${err.message}`);
    return null;
  }
}

// ── Fallback text (when carousel unsupported) ─────────────────────────────────

function buildExplorerFallbackText() {
  return [
    '✨ *Explorer*\n',
    '1. 💎 Blink Premium',
    '2. 🔔 Actu Médicaments',
    '3. 📋 Soins Électroniques (FSE)',
    '4. ⚖️ Conformité Pharma',
    '5. 💊 MedIndex',
    '',
    'Tapez un numéro pour sélectionner une rubrique.',
  ].join('\n');
}

// ── Payload resolution ────────────────────────────────────────────────────────

function resolveExplorerPayload(action) {
  return PAYLOAD_TO_THEME[action] || null;
}

function isExplorerPayload(action) {
  return String(action || '').startsWith('explore_') || Boolean(PAYLOAD_TO_THEME[action]);
}

module.exports = {
  EXPLORER_CARDS,
  PAYLOAD_TO_THEME,
  sendExplorerCarousel,
  buildExplorerFallbackText,
  resolveExplorerPayload,
  isExplorerPayload,
};
