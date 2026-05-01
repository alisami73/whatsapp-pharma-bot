'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const answerCards = require('../modules/answer_cards');

test('answer card spec for FSE uses branded media and URL button', () => {
  const spec = answerCards.buildAnswerCardSpec('fse', 'fr');

  assert.equal(spec.friendlyName, 'blink_answer_card_fse_v2_fr');
  assert.ok(spec.types['whatsapp/card']);
  assert.match(spec.types['whatsapp/card'].media[0], /public\/carousel\/fse\.jpg$/);
  assert.equal(spec.types['whatsapp/card'].actions[0].type, 'URL');
  assert.equal(spec.types['whatsapp/card'].actions[0].title, 'Voir les détails');
  assert.match(spec.types['whatsapp/card'].actions[0].url, /\/answers\/fse\/fr\/\{\{2\}\}$/);
});

test('answer card body includes intro, ready state, question and answer teaser', () => {
  const body = answerCards.buildAnswerCardBody({
    topic: 'conformites',
    lang: 'fr',
    question: 'Que faire en cas d inspection DMP ?',
    answer: 'Commencez par preparer vos registres, vos factures et vos justificatifs de conformite.',
  });

  assert.match(body, /Conformité Pharma/);
  assert.match(body, /Votre réponse détaillée est prête/);
  assert.match(body, /inspection DMP/i);
  assert.match(body, /preparer vos registres/i);
});
