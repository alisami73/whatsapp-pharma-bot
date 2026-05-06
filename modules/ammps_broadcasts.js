'use strict';

const fs = require('fs');
const path = require('path');

const storage = require('../storage');
const twilioService = require('../twilio_service');
const twilioContentTemplates = require('./twilio_content_templates');

const CACHE_PATH = path.join(__dirname, '..', 'data', 'interactive_templates.json');
const DEFAULT_THEME_ID = 'nouveautes-medicaments';
const STOP_MESSAGE = 'Repondez STOP pour vous desabonner.';

// Two separate templates — Meta requires literal text in the body (not only parameters)
const TEMPLATES = {
  recall: {
    cacheKey: 'ammps_recall_v1_fr',
    envVar:   'TWILIO_TEMPLATE_AMMPS_RECALL_FR_SID',
    friendlyName: 'blink_ammps_recall_v1_fr',
  },
  warning: {
    cacheKey: 'ammps_warning_v1_fr',
    envVar:   'TWILIO_TEMPLATE_AMMPS_WARNING_FR_SID',
    friendlyName: 'blink_ammps_warning_v1_fr',
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function trim(value, max = 1000) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function clipText(value, max = 700) {
  const clean = trim(value, max + 20);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function formatDateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return trim(value, 32);
  return date.toLocaleDateString('fr-MA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function normalizeActionType(actionType) {
  return String(actionType || '').trim().toLowerCase() === 'warning' ? 'warning' : 'recall';
}

// ── Recall template ──────────────────────────────────────────────────────────
// Body: "Retrait de lot : {{1}}\n\nLot : {{2}} | Labo : {{3}} | Date : {{4}}\n\nMotif : {{5}}\n\nRepondez STOP pour vous desabonner."

function buildRecallVariables(action) {
  return {
    '1': clipText(action?.product_name || action?.title || 'Produit inconnu', 180),
    '2': trim(action?.batch_number || 'N/A', 80),
    '3': clipText(action?.lab_name || 'Laboratoire non specifie', 120),
    '4': formatDateLabel(action?.recall_date) || 'N/A',
    '5': clipText(action?.recall_reason || 'Voir publication AMMPS pour le detail.', 600),
  };
}

function buildRecallSpec() {
  return {
    friendlyName: TEMPLATES.recall.friendlyName,
    language: 'fr',
    variables: {
      '1': 'Paracetamol 500 mg comprimes',
      '2': 'LOT-2026-0001',
      '3': 'Laboratoire Exemple',
      '4': '05/05/2026',
      '5': 'Retrait immediat en raison d un defaut de qualite detecte lors du controle final.',
    },
    types: {
      'twilio/text': {
        body: 'Retrait de lot : {{1}}\n\nLot : {{2}} | Labo : {{3}} | Date : {{4}}\n\nMotif : {{5}}\n\n' + STOP_MESSAGE,
      },
    },
  };
}

function buildRecallRenderedBody(action) {
  const v = buildRecallVariables(action);
  return `Retrait de lot : ${v['1']}\n\nLot : ${v['2']} | Labo : ${v['3']} | Date : ${v['4']}\n\nMotif : ${v['5']}\n\n${STOP_MESSAGE}`;
}

// ── Warning template ─────────────────────────────────────────────────────────
// Body: "Alerte reglementaire : {{1}}\n\nRef : {{2}} | Date d'effet : {{3}}\n\nDetail : {{4}}\n\nRepondez STOP pour vous desabonner."

function buildWarningVariables(action) {
  return {
    '1': clipText(action?.title || 'Avertissement AMMPS', 180),
    '2': trim(action?.reference_number || 'N/A', 80),
    '3': formatDateLabel(action?.effective_date) || 'N/A',
    '4': clipText(action?.warning_content || 'Voir publication AMMPS pour le detail complet.', 600),
  };
}

function buildWarningSpec() {
  return {
    friendlyName: TEMPLATES.warning.friendlyName,
    language: 'fr',
    variables: {
      '1': 'Mise en garde sur les conditions de conservation du medicament X',
      '2': 'AMMPS/2026/001',
      '3': '05/05/2026',
      '4': 'Les conditions de conservation doivent etre maintenues entre 2 et 8 degres Celsius.',
    },
    types: {
      'twilio/text': {
        body: "Alerte reglementaire : {{1}}\n\nRef : {{2}} | Date d'effet : {{3}}\n\nDetail : {{4}}\n\n" + STOP_MESSAGE,
      },
    },
  };
}

function buildWarningRenderedBody(action) {
  const v = buildWarningVariables(action);
  return `Alerte reglementaire : ${v['1']}\n\nRef : ${v['2']} | Date d'effet : ${v['3']}\n\nDetail : ${v['4']}\n\n${STOP_MESSAGE}`;
}

// ── Dispatch helpers ─────────────────────────────────────────────────────────

function buildRenderedBody(action) {
  return normalizeActionType(action?.action_type) === 'warning'
    ? buildWarningRenderedBody(action)
    : buildRecallRenderedBody(action);
}

// ── Template SID resolution ──────────────────────────────────────────────────

function readCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (_) {}
  return {};
}

function writeCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (error) {
    console.warn('[ammps-broadcasts] cache write skipped:', error.message);
  }
}

async function ensureTemplateSid(actionType) {
  const type = normalizeActionType(actionType);
  const tpl  = TEMPLATES[type];
  const spec = type === 'warning' ? buildWarningSpec() : buildRecallSpec();

  const configuredSid = String(process.env[tpl.envVar] || '').trim();
  if (configuredSid) return configuredSid;

  if (!twilioService.isTwilioConfigured()) return null;

  const cache = readCache();
  if (cache[tpl.cacheKey]?.sid) return String(cache[tpl.cacheKey].sid).trim();

  twilioContentTemplates.assertFriendlyName(spec);

  try {
    const existing = await twilioContentTemplates.findTemplateByFriendlyName(spec.friendlyName);
    if (existing?.sid) {
      cache[tpl.cacheKey] = { sid: existing.sid, created_at: new Date().toISOString() };
      writeCache(cache);
      return existing.sid;
    }
  } catch (error) {
    console.warn('[ammps-broadcasts] template lookup failed:', error.message);
  }

  try {
    const created = await twilioContentTemplates.createTemplate(spec);
    if (created?.sid) {
      cache[tpl.cacheKey] = { sid: created.sid, created_at: new Date().toISOString() };
      writeCache(cache);
      return created.sid;
    }
  } catch (error) {
    console.warn('[ammps-broadcasts] template creation failed:', error.message);
  }

  return null;
}

// ── Broadcast ────────────────────────────────────────────────────────────────

function getBroadcastThemeId(overrideThemeId = null) {
  return String(overrideThemeId || process.env.AMMPS_BROADCAST_THEME_ID || DEFAULT_THEME_ID).trim();
}

async function appendMessageLogSafe(payload) {
  try {
    return await storage.appendMessageLog(payload);
  } catch (error) {
    console.warn('[ammps-broadcasts] appendMessageLog skipped:', error.code || error.message);
    return null;
  }
}

async function updateMessageLogSafe(logId, patch) {
  if (!logId) return null;
  try {
    return await storage.updateMessageLog(logId, patch);
  } catch (error) {
    console.warn('[ammps-broadcasts] updateMessageLog skipped:', error.code || error.message);
    return null;
  }
}

async function listRecipientPhones(themeId, actionId, force = false) {
  const subscriptions = await storage.getSubscriptions();
  const logs = force ? [] : await storage.getMessageLogs();
  const alreadySent = new Set(
    logs
      .filter(
        (entry) =>
          entry.direction === 'outbound' &&
          entry.metadata?.source === 'ammps_broadcast' &&
          entry.metadata?.action_id === actionId &&
          entry.status !== 'failed',
      )
      .map((entry) => entry.phone),
  );

  const seen = new Set();
  const recipients = [];
  let skippedAlreadySent = 0;
  let skippedWithoutConsent = 0;

  for (const subscription of subscriptions) {
    if (subscription.theme_id !== themeId) continue;

    const phone = twilioService.normalizeWhatsAppAddress(subscription.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);

    if (alreadySent.has(phone)) { skippedAlreadySent += 1; continue; }

    const hasConsent = await storage.hasConsent(phone);
    if (!hasConsent) { skippedWithoutConsent += 1; continue; }

    recipients.push(phone);
  }

  return { recipients, uniqueSubscribers: seen.size, skippedAlreadySent, skippedWithoutConsent };
}

async function sendActionBroadcast(action, actor, options = {}) {
  if (!action?.id) throw Object.assign(new Error('AMMPS action is required'), { status: 400 });

  if (String(action.status || '').trim() !== 'published') {
    throw Object.assign(new Error('Only published AMMPS actions can be broadcast.'), {
      status: 400, code: 'ACTION_NOT_PUBLISHED',
    });
  }

  const themeId = getBroadcastThemeId(options.themeId);
  const theme = await storage.getTheme(themeId);
  if (!theme) {
    throw Object.assign(
      new Error(`Theme ${themeId} not found. Configure AMMPS_BROADCAST_THEME_ID or create the theme.`),
      { status: 503, code: 'AMMPS_THEME_MISSING' },
    );
  }

  if (!twilioService.isTwilioConfigured()) {
    throw Object.assign(new Error('Twilio is not configured.'), { status: 503, code: 'TWILIO_NOT_CONFIGURED' });
  }

  const type = normalizeActionType(action.action_type);
  const tpl  = TEMPLATES[type];
  const contentSid = await ensureTemplateSid(type);
  if (!contentSid) {
    throw Object.assign(
      new Error(`Twilio template SID missing. Set ${tpl.envVar} or create ${tpl.friendlyName}.`),
      { status: 503, code: 'TWILIO_TEMPLATE_MISSING' },
    );
  }

  const { recipients, uniqueSubscribers, skippedAlreadySent, skippedWithoutConsent } =
    await listRecipientPhones(themeId, action.id, Boolean(options.force));

  const variables    = type === 'warning' ? buildWarningVariables(action) : buildRecallVariables(action);
  const renderedBody = buildRenderedBody(action);
  let sentCount = 0;
  let failedCount = 0;
  const failures = [];

  for (const phone of recipients) {
    const pendingLog = await appendMessageLogSafe({
      direction: 'outbound',
      phone,
      theme_id: themeId,
      body: renderedBody,
      status: 'pending_local',
      metadata: {
        source: 'ammps_broadcast',
        action_id: action.id,
        action_type: action.action_type,
        theme_title: theme.title,
        actor_id: actor?.id || null,
      },
    });

    try {
      const twilioMessage = await twilioService.sendWhatsAppMessage({
        to: phone,
        contentSid,
        contentVariables: variables,
      });

      sentCount += 1;
      await updateMessageLogSafe(pendingLog?.id, {
        status: twilioMessage.status || 'queued',
        provider_message_sid: twilioMessage.sid || null,
        metadata: { twilio_direction: twilioMessage.direction || null, template_sid: contentSid },
      });
    } catch (error) {
      failedCount += 1;
      failures.push({ phone, message: error.message || 'Twilio send failed', code: error.code || null });
      await updateMessageLogSafe(pendingLog?.id, {
        status: 'failed',
        error_code: error.code || null,
        error_message: error.message || 'Twilio send failed',
        metadata: { template_sid: contentSid },
      });
    }
  }

  return {
    ok: true,
    theme_id: themeId,
    theme_title: theme.title,
    template_sid: contentSid,
    template_env: tpl.envVar,
    template_friendly_name: tpl.friendlyName,
    unique_subscribers: uniqueSubscribers,
    eligible_recipients: recipients.length,
    skipped_already_sent: skippedAlreadySent,
    skipped_without_consent: skippedWithoutConsent,
    sent_count: sentCount,
    failed_count: failedCount,
    failures,
  };
}

module.exports = {
  TEMPLATES,
  DEFAULT_THEME_ID,
  STOP_MESSAGE,
  buildRecallVariables,
  buildWarningVariables,
  buildRecallSpec,
  buildWarningSpec,
  buildRenderedBody,
  getBroadcastThemeId,
  ensureTemplateSid,
  sendActionBroadcast,
};
