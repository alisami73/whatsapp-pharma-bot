'use strict';

const fs = require('fs');
const path = require('path');

const storage = require('../storage');
const twilioService = require('../twilio_service');
const twilioContentTemplates = require('./twilio_content_templates');

const CACHE_PATH = path.join(__dirname, '..', 'data', 'interactive_templates.json');
const CACHE_KEY = 'ammps_alert_v1_fr';
const TEMPLATE_ENV = 'TWILIO_TEMPLATE_AMMPS_ALERT_FR_SID';
const DEFAULT_THEME_ID = 'nouveautes-medicaments';
const TEMPLATE_FRIENDLY_NAME = 'blink_ammps_alert_v1_fr';
const STOP_MESSAGE = 'Repondez STOP pour vous desabonner.';

function trim(value, max = 1000) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function clipText(value, max = 700) {
  const clean = trim(value, max + 20);
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function formatDateLabel(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return trim(value, 32);
  }

  return date.toLocaleDateString('fr-MA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function normalizeActionType(actionType) {
  return String(actionType || '').trim().toLowerCase() === 'warning' ? 'warning' : 'recall';
}

function buildActionHeading(action) {
  return normalizeActionType(action?.action_type) === 'warning'
    ? 'AMMPS - Avertissement reglementaire'
    : 'AMMPS - Retrait de lot';
}

function buildActionTitle(action) {
  const actionType = normalizeActionType(action?.action_type);
  if (actionType === 'warning') {
    return clipText(action?.title || 'Avertissement AMMPS', 180);
  }
  return clipText(action?.product_name || action?.title || 'Retrait de lot AMMPS', 180);
}

function buildActionDetails(action) {
  const actionType = normalizeActionType(action?.action_type);
  const raw = actionType === 'warning'
    ? action?.warning_content
    : action?.recall_reason;
  return clipText(raw || 'Consultez la publication AMMPS pour le detail complet.', 720);
}

function buildActionMeta(action) {
  const actionType = normalizeActionType(action?.action_type);
  const parts = [];

  if (actionType === 'warning') {
    if (action?.reference_number) {
      parts.push(`Ref: ${trim(action.reference_number, 80)}`);
    }
    if (action?.effective_date) {
      parts.push(`Date d'effet: ${formatDateLabel(action.effective_date)}`);
    }
  } else {
    if (action?.batch_number) {
      parts.push(`Lot: ${trim(action.batch_number, 80)}`);
    }
    if (action?.lab_name) {
      parts.push(`Labo: ${trim(action.lab_name, 120)}`);
    }
    if (action?.recall_date) {
      parts.push(`Date: ${formatDateLabel(action.recall_date)}`);
    }
  }

  if (action?.geographic_scope) {
    parts.push(`Portee: ${trim(action.geographic_scope, 80)}`);
  }

  return parts.length ? clipText(parts.join(' | '), 240) : 'Publication AMMPS';
}

function buildTemplateVariables(action) {
  return {
    '1': buildActionHeading(action),
    '2': buildActionTitle(action),
    '3': buildActionDetails(action),
    '4': buildActionMeta(action),
    '5': STOP_MESSAGE,
  };
}

function buildRenderedBody(action) {
  const variables = buildTemplateVariables(action);
  return [variables['1'], variables['2'], variables['3'], variables['4'], variables['5']]
    .filter(Boolean)
    .join('\n\n');
}

function buildTemplateSpec() {
  return {
    friendlyName: TEMPLATE_FRIENDLY_NAME,
    language: 'fr',
    variables: {
      '1': 'AMMPS - Retrait de lot',
      '2': 'Produit exemple 500 mg comprimes',
      '3': 'Retrait immediat du lot concerne en raison d un defaut de qualite detecte.',
      '4': 'Lot: LOT-2026-0001 | Labo: Exemple Pharma | Date: 05/05/2026 | Portee: national',
      '5': STOP_MESSAGE,
    },
    types: {
      'twilio/text': {
        body: '{{1}}\n\n{{2}}\n\n{{3}}\n\n{{4}}\n\n{{5}}',
      },
    },
  };
}

function getConfiguredTemplateSid() {
  return String(process.env[TEMPLATE_ENV] || '').trim();
}

function getBroadcastThemeId(overrideThemeId = null) {
  return String(
    overrideThemeId || process.env.AMMPS_BROADCAST_THEME_ID || DEFAULT_THEME_ID,
  ).trim();
}

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
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (error) {
    console.warn('[ammps-broadcasts] cache write skipped:', error.message);
  }
}

async function ensureTemplateSid() {
  const configuredSid = getConfiguredTemplateSid();
  if (configuredSid) {
    return configuredSid;
  }

  if (!twilioService.isTwilioConfigured()) {
    return null;
  }

  const cache = readCache();
  if (cache[CACHE_KEY]?.sid) {
    return String(cache[CACHE_KEY].sid).trim();
  }

  const spec = buildTemplateSpec();
  twilioContentTemplates.assertFriendlyName(spec);

  try {
    const existing = await twilioContentTemplates.findTemplateByFriendlyName(spec.friendlyName);
    if (existing?.sid) {
      cache[CACHE_KEY] = { sid: existing.sid, created_at: new Date().toISOString() };
      writeCache(cache);
      return existing.sid;
    }
  } catch (error) {
    console.warn('[ammps-broadcasts] template lookup failed:', error.message);
  }

  try {
    const created = await twilioContentTemplates.createTemplate(spec);
    if (created?.sid) {
      cache[CACHE_KEY] = { sid: created.sid, created_at: new Date().toISOString() };
      writeCache(cache);
      return created.sid;
    }
  } catch (error) {
    console.warn('[ammps-broadcasts] template creation failed:', error.message);
  }

  return null;
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
  if (!logId) {
    return null;
  }

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
      .filter((entry) =>
        entry.direction === 'outbound'
        && entry.metadata?.source === 'ammps_broadcast'
        && entry.metadata?.action_id === actionId
        && entry.status !== 'failed',
      )
      .map((entry) => entry.phone),
  );

  const seen = new Set();
  const recipients = [];
  let skippedAlreadySent = 0;
  let skippedWithoutConsent = 0;

  for (const subscription of subscriptions) {
    if (subscription.theme_id !== themeId) {
      continue;
    }

    const phone = twilioService.normalizeWhatsAppAddress(subscription.phone);
    if (!phone || seen.has(phone)) {
      continue;
    }
    seen.add(phone);

    if (alreadySent.has(phone)) {
      skippedAlreadySent += 1;
      continue;
    }

    const hasConsent = await storage.hasConsent(phone);
    if (!hasConsent) {
      skippedWithoutConsent += 1;
      continue;
    }

    recipients.push(phone);
  }

  return {
    recipients,
    uniqueSubscribers: seen.size,
    skippedAlreadySent,
    skippedWithoutConsent,
  };
}

async function sendActionBroadcast(action, actor, options = {}) {
  if (!action?.id) {
    throw Object.assign(new Error('AMMPS action is required'), { status: 400 });
  }

  if (String(action.status || '').trim() !== 'published') {
    throw Object.assign(new Error('Only published AMMPS actions can be broadcast.'), {
      status: 400,
      code: 'ACTION_NOT_PUBLISHED',
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
    throw Object.assign(new Error('Twilio is not configured.'), {
      status: 503,
      code: 'TWILIO_NOT_CONFIGURED',
    });
  }

  const contentSid = await ensureTemplateSid();
  if (!contentSid) {
    throw Object.assign(
      new Error(`Twilio template SID missing. Set ${TEMPLATE_ENV} or create ${TEMPLATE_FRIENDLY_NAME}.`),
      { status: 503, code: 'TWILIO_TEMPLATE_MISSING' },
    );
  }

  const { recipients, uniqueSubscribers, skippedAlreadySent, skippedWithoutConsent } =
    await listRecipientPhones(themeId, action.id, Boolean(options.force));

  const variables = buildTemplateVariables(action);
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
        metadata: {
          twilio_direction: twilioMessage.direction || null,
          template_sid: contentSid,
        },
      });
    } catch (error) {
      failedCount += 1;
      failures.push({
        phone,
        message: error.message || 'Twilio send failed',
        code: error.code || null,
      });
      await updateMessageLogSafe(pendingLog?.id, {
        status: 'failed',
        error_code: error.code || null,
        error_message: error.message || 'Twilio send failed',
        metadata: {
          template_sid: contentSid,
        },
      });
    }
  }

  return {
    ok: true,
    theme_id: themeId,
    theme_title: theme.title,
    template_sid: contentSid,
    template_env: TEMPLATE_ENV,
    template_friendly_name: TEMPLATE_FRIENDLY_NAME,
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
  TEMPLATE_ENV,
  TEMPLATE_FRIENDLY_NAME,
  DEFAULT_THEME_ID,
  STOP_MESSAGE,
  buildActionHeading,
  buildActionTitle,
  buildActionDetails,
  buildActionMeta,
  buildTemplateVariables,
  buildRenderedBody,
  buildTemplateSpec,
  getBroadcastThemeId,
  ensureTemplateSid,
  sendActionBroadcast,
};
