'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Charger les secrets de test sans les vrais secrets de prod
process.env.USER_HASH_SECRET = 'test-hash-secret-32chars-minimum!!';
process.env.USER_LINK_SIGNING_SECRET = 'test-signing-secret-32chars-min!!';
process.env.PUBLIC_SITE_BASE_URL = 'https://example.com';
process.env.TRACKING_TOKEN_TTL_MINUTES = '60';

const identity = require('../modules/identity_service');
const { createSignedUserLink, verifySignedUserToken } = require('../modules/signed_link_service');

// ── identity_service ───────────────────────────────────────────────────────────

describe('identity_service — normalizePhone', () => {
  it('retire le préfixe whatsapp:', () => {
    assert.equal(identity.normalizePhone('whatsapp:+212600000001'), '+212600000001');
  });
  it('garde le numéro si déjà propre', () => {
    assert.equal(identity.normalizePhone('+212600000001'), '+212600000001');
  });
  it('retourne null pour une valeur vide', () => {
    assert.equal(identity.normalizePhone(''), null);
    assert.equal(identity.normalizePhone(null), null);
  });
});

describe('identity_service — hashPhone', () => {
  it('produit un hash stable (HMAC-SHA256 hex 64 chars)', () => {
    const h1 = identity.hashPhone('+212600000001');
    const h2 = identity.hashPhone('+212600000001');
    assert.equal(h1, h2);
    assert.equal(h1.length, 64);
    assert.match(h1, /^[0-9a-f]{64}$/);
  });

  it('deux numéros différents → hashes différents', () => {
    const h1 = identity.hashPhone('+212600000001');
    const h2 = identity.hashPhone('+212600000002');
    assert.notEqual(h1, h2);
  });

  it('le hash ne contient jamais le numéro en clair', () => {
    const h = identity.hashPhone('+212600000001');
    assert.ok(!h.includes('212600000001'), 'Le numéro est visible dans le hash !');
  });

  it('lève une erreur si le téléphone est vide', () => {
    assert.throws(() => identity.hashPhone(''), /phone required/);
  });
});

describe('identity_service — hashIp', () => {
  it('hash une IP sans la stocker en clair', () => {
    const h = identity.hashIp('192.168.1.1');
    assert.ok(h);
    assert.ok(!h.includes('192.168.1.1'));
  });
  it('retourne null pour une IP inconnue', () => {
    assert.equal(identity.hashIp('unknown'), null);
    assert.equal(identity.hashIp(null), null);
  });
});

// ── signed_link_service ────────────────────────────────────────────────────────

describe('signed_link_service — createSignedUserLink', () => {
  const mockUser = { id: 'a1b2c3d4-0000-0000-0000-000000000001', phone_hash: 'abc123' };

  it('génère un lien avec /w/entry?token=', () => {
    const link = createSignedUserLink(mockUser);
    assert.ok(link.includes('/w/entry?token='), `Lien inattendu : ${link}`);
  });

  it('le lien ne contient pas le phone_hash en clair', () => {
    const link = createSignedUserLink(mockUser);
    assert.ok(!link.includes('abc123'), 'phone_hash visible dans l\'URL !');
  });

  it('le lien ne contient jamais de numéro de téléphone', () => {
    const link = createSignedUserLink(mockUser, { metadata: { phone: '+212600000001' } });
    assert.ok(!link.includes('212600000001'), 'Téléphone visible dans l\'URL !');
  });

  it('lève une erreur si user.id manque', () => {
    assert.throws(() => createSignedUserLink({}), /user required/);
  });
});

describe('signed_link_service — verifySignedUserToken', () => {
  const mockUser = { id: 'a1b2c3d4-0000-0000-0000-000000000001', phone_hash: 'abc123' };

  it('vérifie un token valide', () => {
    const link = createSignedUserLink(mockUser, { source: 'whatsapp', campaign: 'fse' });
    const token = new URL(link).searchParams.get('token');
    const payload = verifySignedUserToken(token);
    assert.ok(payload, 'payload null pour token valide');
    assert.equal(payload.user_id, mockUser.id);
    assert.equal(payload.source, 'whatsapp');
    assert.equal(payload.campaign, 'fse');
  });

  it('refuse un token invalide (signature trafiquée)', () => {
    const link = createSignedUserLink(mockUser);
    const token = new URL(link).searchParams.get('token');
    const tampered = token.slice(0, -5) + 'XXXXX';
    assert.equal(verifySignedUserToken(tampered), null);
  });

  it('refuse un token expiré', () => {
    // Construire un payload avec exp dans le passé puis signer manuellement
    const crypto = require('crypto');
    const secret = process.env.USER_LINK_SIGNING_SECRET;
    const expired = { user_id: mockUser.id, phone_hash: mockUser.phone_hash, exp: Date.now() - 1000 };
    const encoded = Buffer.from(JSON.stringify(expired)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    const token = `${encoded}.${sig}`;
    assert.equal(verifySignedUserToken(token), null);
  });

  it('refuse null / chaîne vide', () => {
    assert.equal(verifySignedUserToken(null), null);
    assert.equal(verifySignedUserToken(''), null);
    assert.equal(verifySignedUserToken('notavalidtoken'), null);
  });
});
