'use strict';

const crypto = require('crypto');

function _secret() {
  const s = process.env.USER_LINK_SIGNING_SECRET;
  if (!s) throw new Error('USER_LINK_SIGNING_SECRET not configured');
  return s;
}

function _baseUrl() {
  // /w/entry est exposé sous le domaine public (Vercel) — jamais l'URL Railway interne
  return String(
    process.env.PUBLIC_SITE_ORIGIN ||
    process.env.PUBLIC_BASE_URL ||
    'https://blinkpremium.blinkpharmacie.ma',
  ).replace(/\/+$/, '');
}

function _ttlMs() {
  return parseInt(process.env.TRACKING_TOKEN_TTL_MINUTES || '10080', 10) * 60 * 1000;
}

function _sign(encoded) {
  return crypto.createHmac('sha256', _secret()).update(encoded).digest('base64url');
}

/**
 * Génère un lien signé vers /w/entry?token=...
 * Le numéro de téléphone n'est jamais inclus dans le token — uniquement phone_hash.
 */
function createSignedUserLink(user, { source = 'whatsapp', campaign = null, redirect = null, metadata = {} } = {}) {
  if (!user || !user.id) throw new Error('createSignedUserLink: user required');

  const payload = {
    user_id: user.id,
    phone_hash: user.phone_hash,
    source,
    campaign: campaign || null,
    redirect: redirect || null,
    metadata: metadata || {},
    exp: Date.now() + _ttlMs(),
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = _sign(encoded);
  const token = `${encoded}.${sig}`;

  const url = new URL(`${_baseUrl()}/w/entry`);
  url.searchParams.set('token', token);
  return url.toString();
}

/**
 * Vérifie un token et retourne le payload si valide, null sinon.
 */
function verifySignedUserToken(token) {
  if (!token || typeof token !== 'string') return null;

  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;

  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let expectedSig;
  try {
    expectedSig = _sign(encoded);
  } catch {
    return null;
  }

  let sigOk = false;
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    sigOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return null;
  }
  if (!sigOk) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload.exp || Date.now() > payload.exp) return null;
  if (!payload.user_id || !payload.phone_hash) return null;

  return payload;
}

module.exports = { createSignedUserLink, verifySignedUserToken };
