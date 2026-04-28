'use strict';

const http = require('http');
const https = require('https');
const nodemailer = require('nodemailer');

const { DEFAULT_LANG, parseLang } = require('./i18n');

const DEFAULT_CONTACT_EMAIL = 'contact@blinkpharma.ma';
const EMAIL_SUBJECT_PREFIX = 'Nouvelle demande de demo Blink Premium';
const DEFAULT_DELIVERY_TIMEOUT_MS = 15000;

let cachedTransport = null;
let cachedTransportKey = null;

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function sanitizeSingleLine(value, maxLength = 200) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeMultiLine(value, maxLength = 4000) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim()
    .slice(0, maxLength);
}

function normalizeLang(value) {
  return parseLang(value) || DEFAULT_LANG;
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeContactEmailProvider(value) {
  const normalized = sanitizeSingleLine(value, 32).toLowerCase();
  if (!normalized) return '';
  if (['graph', 'microsoft-graph', 'microsoft_graph', 'msgraph'].includes(normalized)) {
    return 'msgraph';
  }
  return 'smtp';
}

function extractEmailAddress(value) {
  const normalized = sanitizeSingleLine(value, 320);
  const bracketMatch = normalized.match(/<([^<>\s@]+@[^<>\s@]+)>/);
  if (bracketMatch) return bracketMatch[1].trim().toLowerCase();

  const inlineMatch = normalized.match(/\b[^<>\s@]+@[^<>\s@]+\b/);
  return inlineMatch ? inlineMatch[0].trim().toLowerCase() : '';
}

function normalizeContactLead(payload = {}) {
  return {
    nom: sanitizeSingleLine(payload.nom, 120),
    pharmacie: sanitizeSingleLine(payload.pharmacie, 140),
    telephone: sanitizeSingleLine(payload.telephone, 40),
    ville: sanitizeSingleLine(payload.ville, 120),
    logiciel: sanitizeSingleLine(payload.logiciel, 80),
    message: sanitizeMultiLine(payload.message, 3000),
    lang: normalizeLang(payload.lang),
    sourcePage: sanitizeSingleLine(payload.sourcePage || '/site/contact.html', 200),
  };
}

function validateContactLead(lead) {
  const fieldErrors = {};
  const normalizedLead = normalizeContactLead(lead);
  const phoneDigits = normalizedLead.telephone.replace(/[^\d+]/g, '');
  const phoneHasEnoughDigits = phoneDigits.replace(/\D/g, '').length >= 8;

  if (!normalizedLead.nom) fieldErrors.nom = 'required';
  if (!normalizedLead.pharmacie) fieldErrors.pharmacie = 'required';
  if (!normalizedLead.telephone) fieldErrors.telephone = 'required';
  if (normalizedLead.telephone && !phoneHasEnoughDigits) fieldErrors.telephone = 'invalid_phone';

  return {
    valid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    lead: normalizedLead,
  };
}

function getContactEmailConfig(env = process.env) {
  const requestedProvider = normalizeContactEmailProvider(
    env.CONTACT_EMAIL_PROVIDER || env.CONTACT_MAIL_PROVIDER,
  );
  const smtpUrl = sanitizeSingleLine(env.CONTACT_SMTP_URL || env.SMTP_URL, 500);
  const host = sanitizeSingleLine(env.CONTACT_SMTP_HOST || env.SMTP_HOST, 200);
  const port = Number(env.CONTACT_SMTP_PORT || env.SMTP_PORT || 0);
  const secure = parseBoolean(env.CONTACT_SMTP_SECURE || env.SMTP_SECURE, port === 465);
  const requireTLS = parseBoolean(
    env.CONTACT_SMTP_REQUIRE_TLS || env.SMTP_REQUIRE_TLS,
    false,
  );
  const user = sanitizeSingleLine(env.CONTACT_SMTP_USER || env.SMTP_USER, 200);
  const pass = String(env.CONTACT_SMTP_PASS || env.SMTP_PASS || '');
  const to = sanitizeSingleLine(env.CONTACT_FORM_TO, 200) || DEFAULT_CONTACT_EMAIL;
  const from =
    sanitizeSingleLine(env.CONTACT_FORM_FROM, 200) ||
    sanitizeSingleLine(user, 200) ||
    DEFAULT_CONTACT_EMAIL;
  const smtpTimeoutMs = parsePositiveInteger(
    env.CONTACT_SMTP_TIMEOUT_MS,
    DEFAULT_DELIVERY_TIMEOUT_MS,
  );
  const graphTenantId = sanitizeSingleLine(env.CONTACT_GRAPH_TENANT_ID, 200);
  const graphClientId = sanitizeSingleLine(env.CONTACT_GRAPH_CLIENT_ID, 200);
  const graphClientSecret = String(env.CONTACT_GRAPH_CLIENT_SECRET || '');
  const graphUser =
    sanitizeSingleLine(env.CONTACT_GRAPH_USER || env.CONTACT_GRAPH_MAILBOX, 200) ||
    extractEmailAddress(from) ||
    sanitizeSingleLine(user, 200) ||
    to;
  const graphTimeoutMs = parsePositiveInteger(
    env.CONTACT_GRAPH_TIMEOUT_MS,
    DEFAULT_DELIVERY_TIMEOUT_MS,
  );
  const graphConfigured = Boolean(
    graphTenantId && graphClientId && graphClientSecret && graphUser,
  );
  const provider = requestedProvider || (graphConfigured ? 'msgraph' : 'smtp');
  const smtpConfigured = Boolean(smtpUrl || (host && port));

  return {
    provider,
    smtpUrl,
    host,
    port,
    secure,
    requireTLS,
    user,
    pass,
    to,
    from,
    smtpTimeoutMs,
    graphTenantId,
    graphClientId,
    graphClientSecret,
    graphUser,
    graphTimeoutMs,
    isConfigured: provider === 'msgraph' ? graphConfigured : smtpConfigured,
  };
}

function createTransport(config = getContactEmailConfig()) {
  if (config.provider === 'msgraph') {
    const error = new Error('SMTP transport requested while Microsoft Graph provider is active');
    error.code = 'CONTACT_SMTP_NOT_ACTIVE';
    throw error;
  }

  if (!config.isConfigured) {
    const error = new Error('Contact email transport is not configured');
    error.code = 'CONTACT_EMAIL_NOT_CONFIGURED';
    throw error;
  }

  if ((config.user && !config.pass) || (!config.user && config.pass)) {
    const error = new Error('Contact email transport authentication is incomplete');
    error.code = 'CONTACT_EMAIL_AUTH_INCOMPLETE';
    throw error;
  }

  const cacheKey = JSON.stringify({
    smtpUrl: config.smtpUrl,
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    user: config.user,
    pass: config.pass ? '***' : '',
  });

  if (cachedTransport && cachedTransportKey === cacheKey) {
    return cachedTransport;
  }

  const transport = nodemailer.createTransport(
    config.smtpUrl
      ? {
          url: config.smtpUrl,
          requireTLS: config.requireTLS,
          connectionTimeout: config.smtpTimeoutMs,
          greetingTimeout: config.smtpTimeoutMs,
          socketTimeout: config.smtpTimeoutMs,
        }
      : {
          host: config.host,
          port: config.port,
          secure: config.secure,
          requireTLS: config.requireTLS,
          connectionTimeout: config.smtpTimeoutMs,
          greetingTimeout: config.smtpTimeoutMs,
          socketTimeout: config.smtpTimeoutMs,
          auth: config.user || config.pass ? { user: config.user, pass: config.pass } : undefined,
        },
  );

  cachedTransport = transport;
  cachedTransportKey = cacheKey;
  return transport;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLeadValue(value, fallback = 'Non renseigne') {
  return value ? value : fallback;
}

function buildContactLeadMail(lead, meta = {}, config = getContactEmailConfig()) {
  const normalizedLead = normalizeContactLead(lead);
  const submittedAt = sanitizeSingleLine(meta.submittedAt || new Date().toISOString(), 80);
  const ip = sanitizeSingleLine(meta.ip || 'unknown', 100);
  const userAgent = sanitizeSingleLine(meta.userAgent || 'unknown', 500);
  const referer = sanitizeSingleLine(meta.referer || '', 500);

  const subjectSuffix = normalizedLead.pharmacie || normalizedLead.nom || 'Sans nom';
  const subject = `${EMAIL_SUBJECT_PREFIX} - ${subjectSuffix}`;

  const lines = [
    EMAIL_SUBJECT_PREFIX,
    '',
    `Nom complet : ${formatLeadValue(normalizedLead.nom)}`,
    `Pharmacie : ${formatLeadValue(normalizedLead.pharmacie)}`,
    `Telephone WhatsApp : ${formatLeadValue(normalizedLead.telephone)}`,
    `Ville : ${formatLeadValue(normalizedLead.ville)}`,
    `Logiciel actuel : ${formatLeadValue(normalizedLead.logiciel)}`,
    `Langue : ${formatLeadValue(normalizedLead.lang)}`,
    `Page source : ${formatLeadValue(normalizedLead.sourcePage)}`,
    `Soumis le : ${submittedAt}`,
    `IP : ${ip}`,
    `Referer : ${formatLeadValue(referer)}`,
    `User-Agent : ${userAgent}`,
    '',
    'Message :',
    normalizedLead.message || 'Aucun message complementaire.',
  ];

  const text = lines.join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6;">
      <h2 style="margin:0 0 16px;">${escapeHtml(EMAIL_SUBJECT_PREFIX)}</h2>
      <table cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:720px;">
        <tr><td style="font-weight:700;width:220px;">Nom complet</td><td>${escapeHtml(formatLeadValue(normalizedLead.nom))}</td></tr>
        <tr><td style="font-weight:700;">Pharmacie</td><td>${escapeHtml(formatLeadValue(normalizedLead.pharmacie))}</td></tr>
        <tr><td style="font-weight:700;">Telephone WhatsApp</td><td>${escapeHtml(formatLeadValue(normalizedLead.telephone))}</td></tr>
        <tr><td style="font-weight:700;">Ville</td><td>${escapeHtml(formatLeadValue(normalizedLead.ville))}</td></tr>
        <tr><td style="font-weight:700;">Logiciel actuel</td><td>${escapeHtml(formatLeadValue(normalizedLead.logiciel))}</td></tr>
        <tr><td style="font-weight:700;">Langue</td><td>${escapeHtml(formatLeadValue(normalizedLead.lang))}</td></tr>
        <tr><td style="font-weight:700;">Page source</td><td>${escapeHtml(formatLeadValue(normalizedLead.sourcePage))}</td></tr>
        <tr><td style="font-weight:700;">Soumis le</td><td>${escapeHtml(submittedAt)}</td></tr>
        <tr><td style="font-weight:700;">IP</td><td>${escapeHtml(ip)}</td></tr>
        <tr><td style="font-weight:700;">Referer</td><td>${escapeHtml(formatLeadValue(referer))}</td></tr>
        <tr><td style="font-weight:700;">User-Agent</td><td>${escapeHtml(userAgent)}</td></tr>
      </table>
      <div style="margin-top:20px;">
        <div style="font-weight:700;margin-bottom:8px;">Message</div>
        <div style="white-space:pre-wrap;border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#f8fafc;">${escapeHtml(
          normalizedLead.message || 'Aucun message complementaire.',
        )}</div>
      </div>
    </div>
  `.trim();

  return {
    to: config.to,
    from: config.from,
    subject,
    text,
    html,
  };
}

function httpRequest(url, requestOptions = {}) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      const error = new Error(`Invalid URL: ${url}`);
      error.code = 'CONTACT_HTTP_INVALID_URL';
      reject(error);
      return;
    }

    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const body =
      typeof requestOptions.body === 'string' || Buffer.isBuffer(requestOptions.body)
        ? requestOptions.body
        : requestOptions.body == null
          ? null
          : JSON.stringify(requestOptions.body);
    const headers = Object.assign(
      {
        Accept: 'application/json',
        'User-Agent': 'whatsapp-pharma-bot/1.0',
      },
      requestOptions.headers || {},
    );

    if (body != null && headers['Content-Length'] == null && headers['content-length'] == null) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = lib.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: requestOptions.method || 'GET',
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = null;
          }

          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            text,
            data,
          });
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(
      parsePositiveInteger(requestOptions.timeoutMs, DEFAULT_DELIVERY_TIMEOUT_MS),
      () => {
        const error = new Error(requestOptions.timeoutMessage || 'Contact HTTP request timeout');
        error.code = requestOptions.timeoutCode || 'CONTACT_HTTP_TIMEOUT';
        req.destroy(error);
      },
    );

    if (body != null) req.write(body);
    req.end();
  });
}

function buildMicrosoftGraphMessage(mail) {
  const recipients = String(mail.to || '')
    .split(/[;,]/)
    .map((value) => extractEmailAddress(value) || sanitizeSingleLine(value, 200))
    .filter(Boolean);

  return {
    message: {
      subject: mail.subject,
      body: {
        contentType: 'HTML',
        content: mail.html,
      },
      toRecipients: recipients.map((address) => ({
        emailAddress: { address },
      })),
    },
    saveToSentItems: true,
  };
}

async function getMicrosoftGraphAccessToken(config) {
  if (!config.graphTenantId || !config.graphClientId || !config.graphClientSecret || !config.graphUser) {
    const error = new Error('Microsoft Graph contact email configuration is incomplete');
    error.code = 'CONTACT_GRAPH_NOT_CONFIGURED';
    throw error;
  }

  const response = await httpRequest(
    `https://login.microsoftonline.com/${encodeURIComponent(config.graphTenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.graphClientId,
        client_secret: config.graphClientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }).toString(),
      timeoutMs: config.graphTimeoutMs,
      timeoutCode: 'CONTACT_GRAPH_TOKEN_TIMEOUT',
      timeoutMessage: 'Microsoft Graph token request timed out',
    },
  );

  if (response.status !== 200 || !response.data || !response.data.access_token) {
    const error = new Error(`Microsoft Graph token request failed with HTTP ${response.status}`);
    error.code = 'CONTACT_GRAPH_TOKEN_FAILED';
    error.status = response.status;
    error.responseBody = response.text.slice(0, 500);
    throw error;
  }

  return response.data.access_token;
}

async function sendContactLeadViaMicrosoftGraph(mail, config) {
  const accessToken = await getMicrosoftGraphAccessToken(config);
  const response = await httpRequest(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.graphUser)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: buildMicrosoftGraphMessage(mail),
      timeoutMs: config.graphTimeoutMs,
      timeoutCode: 'CONTACT_GRAPH_SEND_TIMEOUT',
      timeoutMessage: 'Microsoft Graph sendMail request timed out',
    },
  );

  if (response.status !== 202) {
    const error = new Error(`Microsoft Graph sendMail failed with HTTP ${response.status}`);
    error.code = 'CONTACT_GRAPH_SEND_FAILED';
    error.status = response.status;
    error.responseBody = response.text.slice(0, 500);
    throw error;
  }

  return { accepted: true, provider: 'msgraph' };
}

async function sendContactLead(lead, meta = {}, env = process.env) {
  const config = getContactEmailConfig(env);
  const mail = buildContactLeadMail(lead, meta, config);

  if (config.provider === 'msgraph') {
    return sendContactLeadViaMicrosoftGraph(mail, config);
  }

  const transport = createTransport(config);
  return transport.sendMail(mail);
}

function isContactEmailConfigError(error) {
  return Boolean(
    error &&
      (error.code === 'CONTACT_EMAIL_NOT_CONFIGURED' ||
        error.code === 'CONTACT_EMAIL_AUTH_INCOMPLETE' ||
        error.code === 'CONTACT_GRAPH_NOT_CONFIGURED'),
  );
}

module.exports = {
  DEFAULT_CONTACT_EMAIL,
  buildContactLeadMail,
  buildMicrosoftGraphMessage,
  createTransport,
  extractEmailAddress,
  getContactEmailConfig,
  isContactEmailConfigError,
  normalizeContactLead,
  sendContactLead,
  validateContactLead,
};
