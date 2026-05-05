'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ammpsBroadcasts = require('../modules/ammps_broadcasts');

test('AMMPS template spec uses an explicit friendly name and text body', () => {
  const spec = ammpsBroadcasts.buildTemplateSpec();

  assert.equal(spec.friendlyName, 'blink_ammps_alert_v1_fr');
  assert.equal(spec.language, 'fr');
  assert.ok(spec.types['twilio/text']);
  assert.match(spec.types['twilio/text'].body, /\{\{1\}\}/);
  assert.match(spec.types['twilio/text'].body, /\{\{5\}\}/);
});

test('AMMPS template variables render recall content for subscribers', () => {
  const variables = ammpsBroadcasts.buildTemplateVariables({
    action_type: 'recall',
    product_name: 'Paracetamol 500 mg',
    batch_number: 'LOT-2026-0042',
    lab_name: 'Exemple Pharma',
    recall_date: '2026-05-05',
    recall_reason: 'Defaut de qualite detecte sur certains lots.',
    geographic_scope: 'national',
  });

  assert.match(variables['1'], /Retrait de lot/i);
  assert.match(variables['2'], /Paracetamol 500 mg/);
  assert.match(variables['3'], /Defaut de qualite/);
  assert.match(variables['4'], /LOT-2026-0042/);
  assert.match(variables['4'], /national/i);
  assert.match(variables['5'], /STOP/i);
});

test('AMMPS rendered body includes warning title and reference', () => {
  const body = ammpsBroadcasts.buildRenderedBody({
    action_type: 'warning',
    title: 'Mise en garde usage du medicament X',
    reference_number: 'AMMPS/2026/001',
    effective_date: '2026-05-05',
    warning_content: 'Verifier les conditions de delivrance avant dispensation.',
    geographic_scope: 'national',
  });

  assert.match(body, /Avertissement reglementaire/i);
  assert.match(body, /medicament X/i);
  assert.match(body, /AMMPS\/2026\/001/);
  assert.match(body, /STOP/i);
});
