'use strict';

const {
  getContactEmailConfig,
  createTransport,
  sendContactLeadViaMicrosoftGraph,
} = require('./contact_leads');

const SAV_ACK_MESSAGE =
  'Merci pour votre message. Votre demande a bien été transmise au service client Blink Premium. Un conseiller vous répondra dans les meilleurs délais.';

// Accusé de réception pour les contacts arrivant via le bouton wa.me de la page web.
// L'onboarding (langue → consentement → carousel) prend le relais juste après.
const WEB_CONTACT_ACK_MESSAGE =
  'Merci pour votre message ! ✅ Votre demande a bien été transmise à notre équipe Blink Premium. Nous vous recontacterons directement via votre numéro WhatsApp dans les meilleurs délais.';

// Texte pré-rempli du bouton WhatsApp sur la page web Blink Premium
// wa.me/212768782598?text=Bonjour%2C+j%27ai+une+question+sur+Blink+Premium
const WEB_CONTACT_PREFIX = "bonjour, j'ai une question sur blink premium";

/**
 * Retourne true si le message entrant doit bypasser le chatbot IA.
 * Détecte :
 *   - "SAV -"  (insensible à la casse) — lien SAV page web
 *   - "[SAV]"  (tag littéral)
 *   - préfixe du bouton WhatsApp page web Blink Premium
 */
function isSavMessage(body) {
  const trimmed = String(body || '').trim();
  // Normalise les apostrophes curvilignes → droites pour comparer
  const lower = trimmed.toLowerCase().replace(/[‘’ʼ]/g, "'");
  return (
    lower.startsWith('sav -') ||
    trimmed.includes('[SAV]') ||
    lower.startsWith(WEB_CONTACT_PREFIX)
  );
}

/**
 * Retourne 'web_contact' si le message vient du bouton WhatsApp page web,
 * 'sav' sinon.
 */
function detectSavSource(body) {
  const lower = String(body || '').trim().toLowerCase().replace(/[‘’ʼ]/g, "'");
  return lower.startsWith(WEB_CONTACT_PREFIX) ? 'web_contact' : 'sav';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSavEmail(from, profileName, body, config) {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' });
  const phone = String(from || '').replace(/^whatsapp:/i, '');
  const name = profileName || 'Non renseigné';

  const sourceType = detectSavSource(body);
  const isWebContact = sourceType === 'web_contact';
  const subject = isWebContact
    ? 'Nouvelle demande Contact WhatsApp - Blink Premium'
    : 'Nouvelle demande SAV WhatsApp - Blink Premium';
  const sourceLabel = isWebContact
    ? 'Page web Blink Premium (Bouton Contact)'
    : 'Page web Blink Premium (SAV)';

  const text = [
    subject,
    '',
    `Nom WhatsApp : ${name}`,
    `Numéro       : ${phone}`,
    `Message      :`,
    body,
    '',
    `Date/heure   : ${now}`,
    `Source       : ${sourceLabel}`,
  ].join('\n');

  const html = `
<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6;max-width:640px;">
  <h2 style="margin:0 0 16px;color:#1d4ed8;">${escapeHtml(subject)}</h2>
  <table cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
    <tr style="background:#f0f4ff;">
      <td style="font-weight:700;width:160px;">Nom WhatsApp</td>
      <td>${escapeHtml(name)}</td>
    </tr>
    <tr>
      <td style="font-weight:700;">Numéro</td>
      <td>${escapeHtml(phone)}</td>
    </tr>
    <tr style="background:#f0f4ff;">
      <td style="font-weight:700;">Date/heure</td>
      <td>${escapeHtml(now)}</td>
    </tr>
    <tr>
      <td style="font-weight:700;">Source</td>
      <td>${escapeHtml(sourceLabel)}</td>
    </tr>
  </table>
  <div style="margin-top:20px;">
    <div style="font-weight:700;margin-bottom:8px;">Message</div>
    <div style="white-space:pre-wrap;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#f8fafc;">${escapeHtml(body)}</div>
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

async function sendSavEmail(from, profileName, body) {
  const config = getContactEmailConfig();
  const mail = buildSavEmail(from, profileName, body, config);

  if (config.provider === 'msgraph') {
    return sendContactLeadViaMicrosoftGraph(mail, config);
  }

  const transport = createTransport(config);
  return transport.sendMail(mail);
}

module.exports = {
  isSavMessage,
  detectSavSource,
  sendSavEmail,
  SAV_ACK_MESSAGE,
  WEB_CONTACT_ACK_MESSAGE,
};
