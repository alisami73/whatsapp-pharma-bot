require('dotenv').config();

const twilio = require('twilio');

let cachedClient = null;

function normalizeWhatsAppAddress(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return '';
  }

  const withoutPrefix = rawValue.replace(/^whatsapp:/i, '').trim();
  const compactValue = withoutPrefix.replace(/[^\d+]/g, '');

  if (!compactValue) {
    return '';
  }

  if (compactValue.startsWith('+')) {
    return `whatsapp:+${compactValue.slice(1).replace(/\+/g, '')}`;
  }

  if (/^\d+$/.test(compactValue)) {
    return `whatsapp:+${compactValue}`;
  }

  return `whatsapp:${compactValue}`;
}

function getTwilioConfig() {
  return {
    accountSid: String(process.env.TWILIO_ACCOUNT_SID || '').trim(),
    authToken: String(process.env.TWILIO_AUTH_TOKEN || '').trim(),
    messagingServiceSid: String(process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim(),
    whatsappFrom: normalizeWhatsAppAddress(process.env.TWILIO_WHATSAPP_FROM || ''),
    publicBaseUrl: String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, ''),
    statusCallbackUrl: String(process.env.TWILIO_STATUS_CALLBACK_URL || '').trim(),
    allowManualSendWithoutConsent:
      String(process.env.TWILIO_ALLOW_MANUAL_SEND_WITHOUT_CONSENT || '').toLowerCase() === 'true',
  };
}

function buildStatusCallbackUrl() {
  const config = getTwilioConfig();

  if (config.statusCallbackUrl) {
    return config.statusCallbackUrl;
  }

  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl}/webhook/twilio/status`;
  }

  return null;
}

function isTwilioConfigured() {
  const config = getTwilioConfig();
  return Boolean(
    config.accountSid &&
      config.authToken &&
      (config.messagingServiceSid || config.whatsappFrom),
  );
}

function getTwilioClient() {
  const config = getTwilioConfig();

  if (!isTwilioConfigured()) {
    throw new Error(
      'Twilio is not configured. Define TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID or TWILIO_WHATSAPP_FROM.',
    );
  }

  if (!cachedClient) {
    cachedClient = twilio(config.accountSid, config.authToken);
  }

  return cachedClient;
}

function getPublicTwilioStatus() {
  const config = getTwilioConfig();

  return {
    configured: isTwilioConfigured(),
    senderMode: config.messagingServiceSid ? 'messaging_service' : config.whatsappFrom ? 'direct_sender' : 'missing',
    whatsappFrom: config.whatsappFrom || null,
    messagingServiceSid: config.messagingServiceSid || null,
    statusCallbackUrl: buildStatusCallbackUrl(),
    allowManualSendWithoutConsent: config.allowManualSendWithoutConsent,
  };
}

async function sendWhatsAppMessage(options) {
  const client = getTwilioClient();
  const config = getTwilioConfig();
  const payload = {
    to: normalizeWhatsAppAddress(options.to),
  };

  if (!payload.to) {
    throw new Error('Destination phone number is required.');
  }

  if (config.messagingServiceSid) {
    payload.messagingServiceSid = config.messagingServiceSid;
  } else {
    payload.from = config.whatsappFrom;
  }

  if (options.contentSid) {
    payload.contentSid = options.contentSid;

    if (options.contentVariables) {
      payload.contentVariables =
        typeof options.contentVariables === 'string'
          ? options.contentVariables
          : JSON.stringify(options.contentVariables);
    }
  } else {
    payload.body = String(options.body || '').trim();

    if (!payload.body) {
      throw new Error('Message body is required when no contentSid is provided.');
    }
  }

  const statusCallback = options.statusCallback || buildStatusCallbackUrl();

  if (statusCallback) {
    payload.statusCallback = statusCallback;
  }

  if (options.mediaUrl) {
    payload.mediaUrl = Array.isArray(options.mediaUrl)
      ? options.mediaUrl
      : [options.mediaUrl];
  }

  return client.messages.create(payload);
}

module.exports = {
  normalizeWhatsAppAddress,
  getTwilioConfig,
  getPublicTwilioStatus,
  buildStatusCallbackUrl,
  isTwilioConfigured,
  sendWhatsAppMessage,
};
