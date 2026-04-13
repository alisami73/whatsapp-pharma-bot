const twilio = require('twilio');

const { MessagingResponse } = twilio.twiml;

function parseFormUrlencoded(value) {
  const params = new URLSearchParams(String(value || ''));
  return Object.fromEntries(params.entries());
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeWebhookPayload(body) {
  const numMediaRaw = normalizeText(body.NumMedia);
  const numMedia = Number.parseInt(numMediaRaw || '0', 10);

  return {
    body: normalizeText(body.Body),
    from: normalizeText(body.From),
    to: normalizeText(body.To),
    messageSid: normalizeText(body.MessageSid),
    profileName: normalizeText(body.ProfileName),
    numMedia: Number.isNaN(numMedia) ? 0 : numMedia,
  };
}

function sendResponse(res, statusCode, payload, contentType) {
  if (typeof res.status === 'function') {
    res.status(statusCode);
  } else {
    res.statusCode = statusCode;
  }

  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', contentType);
  }

  if (typeof res.send === 'function') {
    res.send(payload);
    return;
  }

  res.end(payload);
}

function buildEmptyTwiml() {
  const response = new MessagingResponse();
  return response.toString();
}

async function readRawRequestBody(req) {
  if (typeof req.body === 'string') {
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf8');
  }

  if (isPlainObject(req.body)) {
    return req.body;
  }

  const chunks = [];

  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    req.on('end', resolve);
    req.on('error', reject);
  });

  return Buffer.concat(chunks).toString('utf8');
}

async function readTwilioRequestBody(req) {
  const rawBody = await readRawRequestBody(req);

  if (isPlainObject(rawBody)) {
    return rawBody;
  }

  if (!normalizeText(rawBody)) {
    return {};
  }

  return parseFormUrlencoded(rawBody);
}

function logWebhook(routeName, req, payload) {
  console.info(
    '[twilio-whatsapp-webhook]',
    JSON.stringify({
      event: 'twilio.whatsapp.webhook.received',
      route: routeName,
      method: req.method,
      contentType: req.headers['content-type'] || null,
      from: payload.from || null,
      to: payload.to || null,
      messageSid: payload.messageSid || null,
      profileName: payload.profileName || null,
      numMedia: payload.numMedia,
      body: payload.body,
      receivedAt: new Date().toISOString(),
    }),
  );
}

async function handleTwilioWhatsappWebhook(req, res, routeName) {
  if (req.method !== 'POST') {
    sendResponse(
      res,
      405,
      JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      'application/json; charset=utf-8',
    );
    return;
  }

  try {
    const requestBody = await readTwilioRequestBody(req);
    const payload = normalizeWebhookPayload(requestBody);

    logWebhook(routeName, req, payload);

    sendResponse(res, 200, buildEmptyTwiml(), 'text/xml; charset=utf-8');
  } catch (error) {
    console.error('[twilio-whatsapp-webhook:error]', routeName, error);
    sendResponse(res, 200, buildEmptyTwiml(), 'text/xml; charset=utf-8');
  }
}

async function handlePrimaryTwilioWhatsappWebhook(req, res) {
  await handleTwilioWhatsappWebhook(req, res, 'primary');
}

async function handleFallbackTwilioWhatsappWebhook(req, res) {
  await handleTwilioWhatsappWebhook(req, res, 'fallback');
}

module.exports = {
  handlePrimaryTwilioWhatsappWebhook,
  handleFallbackTwilioWhatsappWebhook,
};
