'use strict';

/**
 * modules/explorer/index.js
 *
 * Explorer carousel — menu principal 5 rubriques.
 *
 * Rubriques :
 *   explore_blink_premium       → Blink Premium (logique software existante)
 *   explore_actu_medicaments    → Actu Médicaments (coming soon)
 *   explore_fse                 → FSE CNSS (réponse IA + page web)
 *   explore_conformite_pharma   → Conformité Pharma (réponse IA + page web)
 *   explore_medindex            → MedIndex (URL directe https://medindex.ma)
 */

const twilioService = require('../../twilio_service');

// ── Card definitions ─────────────────────────────────────────────────────────
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

// Approved Meta carousel SIDs (fr/ar submitted 2026-04-25 pending; es/ru approved 2026-04-25)
const APPROVED_CAROUSEL_SIDS = {
  fr: 'HXd9eb17cff40280a0f7ad94978d2625ee',
  ar: 'HX0f8860dfebafb971e29f12fb28a8ae2e',
  es: 'HX72b8a6ba16a01b5056eb27c0323b2feb',
  ru: 'HX80bc43cb8ec1cae4da7da24f0157fac2',
};

// ── Send carousel ─────────────────────────────────────────────────────────────

async function sendExplorerCarousel(to, lang = 'fr') {
  const interactive = require('../interactive');
  if (!interactive.isInteractiveEnabled()) return null;

  const lcode = ['ar', 'es', 'ru'].includes(lang) ? lang : 'fr';
  const sid   = APPROVED_CAROUSEL_SIDS[lcode];

  if (!sid) {
    console.error(`[explorer] Aucun SID approuvé pour la langue ${lcode}`);
    return null;
  }

  console.log(`[explorer] Envoi carousel sid=${sid} to=${to}`);

  const config  = twilioService.getTwilioConfig();
  const client  = twilioService.getTwilioClient();
  const payload = { to: twilioService.normalizeWhatsAppAddress(to), contentSid: sid };

  if (config.whatsappFrom) payload.from = config.whatsappFrom;
  else if (config.messagingServiceSid) payload.messagingServiceSid = config.messagingServiceSid;
  else {
    console.error('[explorer] Aucun sender configuré (whatsappFrom ni messagingServiceSid)');
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
