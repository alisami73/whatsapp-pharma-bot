const twilio = require('twilio');

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

function sendJsonResponse(res, statusCode, payload) {
  if (typeof res.status === 'function') {
    res.status(statusCode);
  } else {
    res.statusCode = statusCode;
  }

  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }

  const serialized = JSON.stringify(payload);

  if (typeof res.send === 'function') {
    res.send(serialized);
    return;
  }

  res.end(serialized);
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

async function readFormUrlencodedRequestBody(req) {
  const rawBody = await readRawRequestBody(req);

  if (isPlainObject(rawBody)) {
    return rawBody;
  }

  if (!normalizeText(rawBody)) {
    return {};
  }

  return parseFormUrlencoded(rawBody);
}

function buildRequestUrl(req, publicPathOverride) {
  const forwardedProto = normalizeText(req.headers['x-forwarded-proto']) || 'https';
  const forwardedHost = normalizeText(req.headers['x-forwarded-host']);
  const host = forwardedHost || normalizeText(req.headers.host);
  const requestPath = normalizeText(
    publicPathOverride || req.url || req.originalUrl || '',
  );

  return `${forwardedProto}://${host}${requestPath}`;
}

function validateTwilioRequestSignature(req, payload, options = {}) {
  const authToken = normalizeText(process.env.TWILIO_AUTH_TOKEN);

  if (!authToken) {
    return {
      configured: false,
      valid: false,
      reason: 'missing_auth_token',
    };
  }

  const signature = normalizeText(req.headers['x-twilio-signature']);

  if (!signature) {
    return {
      configured: true,
      valid: false,
      reason: 'missing_signature',
    };
  }

  const requestUrl = buildRequestUrl(req, options.publicPath);
  const valid = twilio.validateRequest(authToken, signature, requestUrl, payload);

  return {
    configured: true,
    valid,
    reason: valid ? 'valid_signature' : 'invalid_signature',
    requestUrl,
  };
}

function normalizeStatusPayload(body) {
  return {
    messageSid: normalizeText(body.MessageSid),
    messageStatus: normalizeText(body.MessageStatus),
    from: normalizeText(body.From),
    to: normalizeText(body.To),
    errorCode: normalizeText(body.ErrorCode),
    errorMessage: normalizeText(body.ErrorMessage),
  };
}

function logStatusTransition(payload) {
  const normalizedStatus = normalizeText(payload.messageStatus).toLowerCase();
  const trackedStatuses = new Set([
    'sent',
    'delivered',
    'read',
    'failed',
    'undelivered',
  ]);

  if (!trackedStatuses.has(normalizedStatus)) {
    console.log(
      '[twilio-whatsapp-status:transition]',
      JSON.stringify({
        event: 'twilio.whatsapp.status.transition',
        status: normalizedStatus || 'unknown',
        messageSid: payload.messageSid || null,
        from: payload.from || null,
        to: payload.to || null,
        observedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  console.log(
    '[twilio-whatsapp-status:transition]',
    JSON.stringify({
      event: 'twilio.whatsapp.status.transition',
      status: normalizedStatus,
      messageSid: payload.messageSid || null,
      from: payload.from || null,
      to: payload.to || null,
      observedAt: new Date().toISOString(),
    }),
  );
}

async function handleTwilioWhatsappStatusCallback(req, res) {
  if (req.method !== 'POST') {
    sendJsonResponse(res, 405, { error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const requestBody = await readFormUrlencodedRequestBody(req);
    const payload = normalizeStatusPayload(requestBody);
    const signatureValidation = validateTwilioRequestSignature(req, requestBody, {
      publicPath: '/webhooks/twilio/whatsapp/status',
    });

    console.log(
      '[twilio-whatsapp-status]',
      JSON.stringify({
        event: 'twilio.whatsapp.status.received',
        payload: requestBody,
        normalized: payload,
        signature: signatureValidation,
        receivedAt: new Date().toISOString(),
      }),
    );

    if (!signatureValidation.configured) {
      console.warn(
        '[twilio-whatsapp-status:signature]',
        JSON.stringify({
          event: 'twilio.whatsapp.status.signature.skipped',
          reason: signatureValidation.reason,
        }),
      );
    } else if (!signatureValidation.valid) {
      console.error(
        '[twilio-whatsapp-status:signature]',
        JSON.stringify({
          event: 'twilio.whatsapp.status.signature.invalid',
          reason: signatureValidation.reason,
          messageSid: payload.messageSid || null,
          requestUrl: signatureValidation.requestUrl || null,
        }),
      );
      sendJsonResponse(res, 200, { received: true });
      return;
    }

    logStatusTransition(payload);

    if (payload.errorCode) {
      console.error(
        '[twilio-whatsapp-status:error]',
        JSON.stringify({
          event: 'twilio.whatsapp.status.error',
          messageSid: payload.messageSid || null,
          status: payload.messageStatus || null,
          errorCode: payload.errorCode,
          errorMessage: payload.errorMessage || null,
          from: payload.from || null,
          to: payload.to || null,
          observedAt: new Date().toISOString(),
        }),
      );
    }

    sendJsonResponse(res, 200, { received: true });
  } catch (error) {
    console.error('[twilio-whatsapp-status:unhandled]', error);
    sendJsonResponse(res, 200, { received: true });
  }
}

module.exports = {
  handleTwilioWhatsappStatusCallback,
  validateTwilioRequestSignature,
};
