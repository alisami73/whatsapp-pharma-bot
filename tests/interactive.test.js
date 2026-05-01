'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const interactive = require('../modules/interactive');

test('consent spec uses a WhatsApp URL button for full CGU browsing', () => {
  const spec = interactive.buildConsentSpec('fr');

  assert.equal(spec.friendlyName, 'blink_consent_v3_fr');
  assert.ok(spec.types['whatsapp/card']);
  assert.ok(spec.types['twilio/text']);

  const actions = spec.types['whatsapp/card'].actions;
  assert.equal(actions.length, 3);
  assert.equal(actions[0].type, 'QUICK_REPLY');
  assert.equal(actions[0].id, 'cgu_accept');
  assert.equal(actions[1].type, 'QUICK_REPLY');
  assert.equal(actions[1].id, 'cgu_decline');
  assert.equal(actions[2].type, 'URL');
  assert.equal(actions[2].title, 'Voir CGU complètes');
  assert.match(actions[2].url, /\/site\/cgu\.html\?lang=fr$/);
});

test('CGU URL preserves the requested language', () => {
  assert.match(interactive.buildCguUrl('ar'), /\/site\/cgu\.html\?lang=ar$/);
  assert.match(interactive.buildCguUrl('es'), /\/site\/cgu\.html\?lang=es$/);
});
