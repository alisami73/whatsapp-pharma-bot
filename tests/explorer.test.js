'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const explorer = require('../modules/explorer');

test('explorer template versions restart arabic and spanish while preserving french defaults', () => {
  delete process.env.TWILIO_EXPLORER_TEMPLATE_VERSION;
  delete process.env.TWILIO_EXPLORER_TEMPLATE_VERSION_FR;
  delete process.env.TWILIO_EXPLORER_TEMPLATE_VERSION_AR;
  delete process.env.TWILIO_EXPLORER_TEMPLATE_VERSION_ES;
  delete process.env.TWILIO_EXPLORER_TEMPLATE_VERSION_RU;

  assert.equal(explorer.getExplorerTemplateCacheKey('fr'), 'explorer_v4_fr');
  assert.equal(explorer.getExplorerTemplateCacheKey('ar'), 'explorer_v5_ar');
  assert.equal(explorer.getExplorerTemplateCacheKey('es'), 'explorer_v5_es');
  assert.equal(explorer.getExplorerTemplateCacheKey('ru'), 'explorer_v4_ru');

  const arSpec = explorer.buildExplorerV3Spec('ar');
  const esSpec = explorer.buildExplorerV3Spec('es');
  assert.equal(arSpec.friendlyName, 'blink_explorer_v5_ar');
  assert.equal(esSpec.friendlyName, 'blink_explorer_v5_es');
});

test('explorer template versions can be overridden globally or per language', () => {
  process.env.TWILIO_EXPLORER_TEMPLATE_VERSION = '8';
  process.env.TWILIO_EXPLORER_TEMPLATE_VERSION_AR = '9';

  assert.equal(explorer.getExplorerTemplateCacheKey('fr'), 'explorer_v8_fr');
  assert.equal(explorer.getExplorerTemplateCacheKey('ar'), 'explorer_v9_ar');

  delete process.env.TWILIO_EXPLORER_TEMPLATE_VERSION;
  delete process.env.TWILIO_EXPLORER_TEMPLATE_VERSION_AR;
});
