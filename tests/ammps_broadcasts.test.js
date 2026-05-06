'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ammpsBroadcasts = require('../modules/ammps_broadcasts');

// ── Recall template ──────────────────────────────────────────────────────────

test('recall spec has correct friendly name and compliant body', () => {
  const spec = ammpsBroadcasts.buildRecallSpec();

  assert.equal(spec.friendlyName, 'blink_ammps_recall_v1_fr');
  assert.equal(spec.language, 'fr');
  assert.ok(spec.types['twilio/text']);

  const body = spec.types['twilio/text'].body;
  assert.match(body, /Retrait de lot/);
  assert.match(body, /\{\{1\}\}/);
  assert.match(body, /\{\{5\}\}/);
  assert.match(body, /STOP/i);
  // Meta rule: no more than 2 consecutive newlines
  assert.doesNotMatch(body, /\n{3,}/);
});

test('recall variables map the correct action fields', () => {
  const vars = ammpsBroadcasts.buildRecallVariables({
    action_type: 'recall',
    product_name: 'Paracetamol 500 mg',
    batch_number: 'LOT-2026-0042',
    lab_name: 'Exemple Pharma',
    recall_date: '2026-05-05',
    recall_reason: 'Defaut de qualite detecte lors du controle final.',
  });

  assert.match(vars['1'], /Paracetamol 500 mg/);
  assert.match(vars['2'], /LOT-2026-0042/);
  assert.match(vars['3'], /Exemple Pharma/);
  assert.match(vars['4'], /05\/05\/2026/);
  assert.match(vars['5'], /Defaut de qualite/);
});

test('recall rendered body starts with "Retrait de lot :"', () => {
  const body = ammpsBroadcasts.buildRenderedBody({
    action_type: 'recall',
    product_name: 'Produit X',
    batch_number: 'LOT-001',
    lab_name: 'Labo A',
    recall_date: '2026-05-05',
    recall_reason: 'Defaut qualite.',
  });

  assert.ok(body.startsWith('Retrait de lot :'), `Expected body to start with "Retrait de lot :" but got: ${body.slice(0, 40)}`);
  assert.match(body, /Produit X/);
  assert.match(body, /STOP/i);
  assert.doesNotMatch(body, /\n{3,}/);
});

// ── Warning template ─────────────────────────────────────────────────────────

test('warning spec has correct friendly name and compliant body', () => {
  const spec = ammpsBroadcasts.buildWarningSpec();

  assert.equal(spec.friendlyName, 'blink_ammps_warning_v1_fr');
  assert.equal(spec.language, 'fr');
  assert.ok(spec.types['twilio/text']);

  const body = spec.types['twilio/text'].body;
  assert.match(body, /Alerte reglementaire/);
  assert.match(body, /\{\{1\}\}/);
  assert.match(body, /\{\{4\}\}/);
  assert.match(body, /STOP/i);
  assert.doesNotMatch(body, /\n{3,}/);
});

test('warning variables map the correct action fields', () => {
  const vars = ammpsBroadcasts.buildWarningVariables({
    action_type: 'warning',
    title: 'Mise en garde medicament X',
    reference_number: 'AMMPS/2026/001',
    effective_date: '2026-05-05',
    warning_content: 'Verifier les conditions de delivrance avant dispensation.',
  });

  assert.match(vars['1'], /Mise en garde/);
  assert.match(vars['2'], /AMMPS\/2026\/001/);
  assert.match(vars['3'], /05\/05\/2026/);
  assert.match(vars['4'], /conditions de delivrance/);
});

test('warning rendered body starts with "Alerte reglementaire :"', () => {
  const body = ammpsBroadcasts.buildRenderedBody({
    action_type: 'warning',
    title: 'Mise en garde usage du medicament X',
    reference_number: 'AMMPS/2026/001',
    effective_date: '2026-05-05',
    warning_content: 'Verifier les conditions de delivrance avant dispensation.',
  });

  assert.ok(body.startsWith('Alerte reglementaire :'), `Expected body to start with "Alerte reglementaire :" but got: ${body.slice(0, 50)}`);
  assert.match(body, /medicament X/i);
  assert.match(body, /AMMPS\/2026\/001/);
  assert.match(body, /STOP/i);
  assert.doesNotMatch(body, /\n{3,}/);
});

// ── TEMPLATES map ────────────────────────────────────────────────────────────

test('TEMPLATES map exposes both recall and warning entries', () => {
  assert.ok(ammpsBroadcasts.TEMPLATES.recall);
  assert.ok(ammpsBroadcasts.TEMPLATES.warning);
  assert.equal(ammpsBroadcasts.TEMPLATES.recall.friendlyName, 'blink_ammps_recall_v1_fr');
  assert.equal(ammpsBroadcasts.TEMPLATES.warning.friendlyName, 'blink_ammps_warning_v1_fr');
  assert.ok(ammpsBroadcasts.TEMPLATES.recall.envVar);
  assert.ok(ammpsBroadcasts.TEMPLATES.warning.envVar);
});
