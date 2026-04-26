'use strict';

const nodemailer = require('nodemailer');

const { DEFAULT_LANG, parseLang } = require('./i18n');

const DEFAULT_CONTACT_EMAIL = 'contact@blinkpharma.ma';
const EMAIL_SUBJECT_PREFIX = 'Nouvelle demande de demo Blink Premium';

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
  const smtpUrl = sanitizeSingleLine(env.CONTACT_SMTP_URL || env.SMTP_URL, 500);
  const host = sanitizeSingleLine(env.CONTACT_SMTP_HOST || env.SMTP_HOST, 200);
  const port = Number(env.CONTACT_SMTP_PORT || env.SMTP_PORT || 0);
  const secure = parseBoolean(env.CONTACT_SMTP_SECURE || env.SMTP_SECURE, port === 465);
  const user = sanitizeSingleLine(env.CONTACT_SMTP_USER || env.SMTP_USER, 200);
  const pass = String(env.CONTACT_SMTP_PASS || env.SMTP_PASS || '');
  const to = sanitizeSingleLine(env.CONTACT_FORM_TO, 200) || DEFAULT_CONTACT_EMAIL;
  const from =
    sanitizeSingleLine(env.CONTACT_FORM_FROM, 200) ||
    sanitizeSingleLine(user, 200) ||
    DEFAULT_CONTACT_EMAIL;

  return {
    smtpUrl,
    host,
    port,
    secure,
    user,
    pass,
    to,
    from,
    isConfigured: Boolean(smtpUrl || (host && port)),
  };
}

function createTransport(config = getContactEmailConfig()) {
  if (!config.isConfigured) {
    const error = new Error('Contact email transport is not configured');
    error.code = 'CONTACT_EMAIL_NOT_CONFIGURED';
    throw error;
  }

  const cacheKey = JSON.stringify({
    smtpUrl: config.smtpUrl,
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    pass: config.pass ? '***' : '',
  });

  if (cachedTransport && cachedTransportKey === cacheKey) {
    return cachedTransport;
  }

  const transport = config.smtpUrl
    ? nodemailer.createTransport(config.smtpUrl)
    : nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user || config.pass ? { user: config.user, pass: config.pass } : undefined,
      });

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

async function sendContactLead(lead, meta = {}, env = process.env) {
  const config = getContactEmailConfig(env);
  const transport = createTransport(config);
  const mail = buildContactLeadMail(lead, meta, config);
  return transport.sendMail(mail);
}

function isContactEmailConfigError(error) {
  return Boolean(error && error.code === 'CONTACT_EMAIL_NOT_CONFIGURED');
}

module.exports = {
  DEFAULT_CONTACT_EMAIL,
  buildContactLeadMail,
  getContactEmailConfig,
  isContactEmailConfigError,
  normalizeContactLead,
  sendContactLead,
  validateContactLead,
};
