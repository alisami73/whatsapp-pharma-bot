require('dotenv').config();

const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const { MessagingResponse } = twilio.twiml;

const WHATSAPP_WEBHOOK_PATHS = new Set([
  '/webhook/whatsapp',
  '/webhooks/twilio/whatsapp',
  '/webhooks/twilio/whatsapp/fallback',
]);

let cachedApp = null;
let cachedSupabase = null;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePhone(value) {
  const rawValue = normalizeText(value);

  if (!rawValue) {
    return '';
  }

  if (/^whatsapp:/i.test(rawValue)) {
    const withoutPrefix = rawValue.replace(/^whatsapp:/i, '').trim();
    return `whatsapp:${withoutPrefix}`;
  }

  return rawValue;
}

function normalizeConsentMessage(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseFormUrlencoded(value) {
  const params = new URLSearchParams(String(value || ''));
  return Object.fromEntries(params.entries());
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

function getRequestPath(req) {
  const rawPath = normalizeText(req.path || req.url || req.originalUrl || '/');
  const [pathname] = rawPath.split('?');
  return pathname || '/';
}

function isWhatsappWebhookRequest(req) {
  return WHATSAPP_WEBHOOK_PATHS.has(getRequestPath(req));
}

function buildTwimlMessage(message) {
  const response = new MessagingResponse();

  if (normalizeText(message)) {
    response.message(message);
  }

  return response.toString();
}

function sendTwimlResponse(res, message) {
  const twiml = buildTwimlMessage(message);

  if (typeof res.status === 'function') {
    res.status(200);
  } else {
    res.statusCode = 200;
  }

  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  }

  if (typeof res.send === 'function') {
    res.send(twiml);
    return;
  }

  res.end(twiml);
}

function getSupabaseClient() {
  if (cachedSupabase) {
    return cachedSupabase;
  }

  const supabaseUrl = normalizeText(process.env.SUPABASE_URL);
  const supabaseAnonKey = normalizeText(process.env.SUPABASE_ANON_KEY);

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }

  cachedSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedSupabase;
}

function getWhatsappUsersTable() {
  return getSupabaseClient().schema('public').from('whatsapp_users');
}

async function upsertWhatsappUser(phone, message) {
  const table = getWhatsappUsersTable();
  const normalizedMessage = normalizeConsentMessage(message);
  const wantsConsent = normalizedMessage === 'OUI';

  console.info(
    '[whatsapp-webhook] Supabase called',
    JSON.stringify({
      action: 'select_user',
      phone,
    }),
  );

  const { data: existingUser, error: selectError } = await table
    .select('id, phone, consent')
    .eq('phone', phone)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  let user = existingUser;

  if (!user) {
    console.info(
      '[whatsapp-webhook] Supabase called',
      JSON.stringify({
        action: 'insert_user',
        phone,
      }),
    );

    const { data: insertedUser, error: insertError } = await table
      .insert({
        phone,
        consent: false,
      })
      .select('id, phone, consent')
      .single();

    if (insertError) {
      throw insertError;
    }

    user = insertedUser;

    console.info(
      '[whatsapp-webhook] insert OK',
      JSON.stringify({
        phone,
        consent: user ? user.consent : false,
      }),
    );
  }

  if (wantsConsent) {
    console.info(
      '[whatsapp-webhook] Supabase called',
      JSON.stringify({
        action: 'update_consent',
        phone,
        consent: true,
      }),
    );

    const { data: updatedUser, error: updateError } = await table
      .update({ consent: true })
      .eq('phone', phone)
      .select('id, phone, consent')
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    user = updatedUser || user;

    console.info(
      '[whatsapp-webhook] update OK',
      JSON.stringify({
        phone,
        consent: true,
      }),
    );
  }

  return {
    user,
    wantsConsent,
  };
}

async function handleWhatsappWebhook(req, res) {
  try {
    if (req.method !== 'POST') {
      console.info(
        '[whatsapp-webhook] webhook received',
        JSON.stringify({
          method: req.method,
          path: getRequestPath(req),
          note: 'non_post_request',
        }),
      );

      sendTwimlResponse(res, 'Webhook WhatsApp actif');
      return;
    }

    const requestBody = await readTwilioRequestBody(req);
    const phone = normalizePhone(requestBody.From);
    const body = normalizeText(requestBody.Body);

    console.info(
      '[whatsapp-webhook] webhook received',
      JSON.stringify({
        method: req.method,
        path: getRequestPath(req),
        phone: phone || null,
        body,
      }),
    );

    if (!phone) {
      throw new Error('Missing From in Twilio payload');
    }

    const { wantsConsent } = await upsertWhatsappUser(phone, body);

    if (wantsConsent) {
      sendTwimlResponse(res, 'Merci, votre consentement a bien ete enregistre.');
      return;
    }

    sendTwimlResponse(res, 'Message recu. Repondez OUI pour confirmer votre consentement.');
  } catch (error) {
    console.error(
      '[whatsapp-webhook] erreur capturee',
      JSON.stringify({
        message: error && error.message ? error.message : 'unknown_error',
        stack: error && error.stack ? error.stack : null,
      }),
    );

    sendTwimlResponse(res, 'Service momentanement indisponible');
  }
}

module.exports = async (req, res) => {
  if (isWhatsappWebhookRequest(req)) {
    await handleWhatsappWebhook(req, res);
    return;
  }

  if (!cachedApp) {
    cachedApp = require('../index');
  }

  return cachedApp(req, res);
};
