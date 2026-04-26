'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('answer_pages saves and retrieves answers using local fallback storage', async () => {
  const tmpFile = path.join(os.tmpdir(), `answer-history-${Date.now()}.json`);
  process.env.ANSWER_HISTORY_FILE = tmpFile;
  delete require.cache[require.resolve('../modules/answer_pages')];
  const answerPages = require('../modules/answer_pages');

  const id = await answerPages.saveAnswer({
    topic: 'fse',
    userPhone: 'whatsapp:+212768782598',
    question: 'Qu est ce que la FSE ?',
    answer: 'La FSE est un dispositif numerique CNSS.',
    lang: 'fr',
  });

  const entry = await answerPages.getAnswer(id);
  assert.ok(entry);
  assert.equal(entry.id, id);
  assert.equal(entry.rubrique, 'fse');
  assert.equal(entry.lang, 'fr');
  assert.match(entry.answer, /dispositif numerique/i);
  assert.ok(fs.existsSync(tmpFile));

  fs.unlinkSync(tmpFile);
  delete process.env.ANSWER_HISTORY_FILE;
});

test('answer_pages builds language-aware answer URLs', () => {
  const answerPages = require('../modules/answer_pages');
  assert.equal(
    answerPages.buildAnswerUrl('fse', 'demo-id', 'fr'),
    'https://whatsapp-pharma-bot-production.up.railway.app/answers/fse/fr/demo-id',
  );
  assert.equal(
    answerPages.buildAnswerUrl('conformite', 'demo-id', 'ar'),
    'https://whatsapp-pharma-bot-production.up.railway.app/answers/conformites/ar/demo-id',
  );
});
