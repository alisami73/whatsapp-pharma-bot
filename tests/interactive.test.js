'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const interactive = require('../modules/interactive');

test('consent spec uses a WhatsApp URL button for full CGU browsing', () => {
  const spec = interactive.buildConsentSpec('fr');

  assert.equal(spec.friendlyName, 'blink_consent_v2_fr');
  assert.ok(spec.types['twilio/quick-reply']);

  const actions = spec.types['twilio/quick-reply'].actions;
  assert.equal(actions.length, 3);
  assert.equal(actions[0].id, 'cgu_accept');
  assert.equal(actions[1].id, 'cgu_decline');
  assert.equal(actions[2].id, 'cgu_full');
});

test('CGU URL preserves the requested language', () => {
  assert.match(interactive.buildCguUrl('ar'), /\/cgu\.html\?lang=ar$/);
  assert.match(interactive.buildCguUrl('es'), /\/cgu\.html\?lang=es$/);
});
