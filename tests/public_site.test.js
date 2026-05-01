'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const publicSite = require('../modules/public_site');

test('buildPublicRequestRedirectUrl redirects Railway public pages to the custom domain', () => {
  process.env.PUBLIC_SITE_ORIGIN = 'https://blinkpremium.blinkpharmacie.ma';

  const req = {
    path: '/site/contact.html',
    originalUrl: '/site/contact.html?lang=es',
    url: '/site/contact.html?lang=es',
    headers: {
      host: 'whatsapp-pharma-bot-production.up.railway.app',
    },
  };

  assert.equal(
    publicSite.buildPublicRequestRedirectUrl(req),
    'https://blinkpremium.blinkpharmacie.ma/contact.html?lang=es',
  );
});

test('buildPublicRequestRedirectUrl does not redirect when already on the custom domain', () => {
  process.env.PUBLIC_SITE_ORIGIN = 'https://blinkpremium.blinkpharmacie.ma';

  const req = {
    path: '/contact.html',
    originalUrl: '/contact.html',
    url: '/contact.html',
    headers: {
      host: 'blinkpremium.blinkpharmacie.ma',
    },
  };

  assert.equal(publicSite.buildPublicRequestRedirectUrl(req), null);
});

test('buildPublicRequestRedirectUrl ignores webhook and API routes', () => {
  process.env.PUBLIC_SITE_ORIGIN = 'https://blinkpremium.blinkpharmacie.ma';

  const req = {
    path: '/webhook/whatsapp',
    originalUrl: '/webhook/whatsapp',
    url: '/webhook/whatsapp',
    headers: {
      host: 'whatsapp-pharma-bot-production.up.railway.app',
    },
  };

  assert.equal(publicSite.buildPublicRequestRedirectUrl(req), null);
});
