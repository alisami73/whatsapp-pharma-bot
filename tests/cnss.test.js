'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cnss = require('../modules/cnss');
const legalKb = require('../modules/legal_kb');

test('postProcessLegalReply remplace les references internes par des citations lisibles', () => {
  const results = [
    {
      chunk: {
        title: 'Décret inspection',
        official_title: 'Décret inspection',
        section_path: 'Article 6',
        article_number: '6',
        page_start: 8,
        page_end: 8,
      },
    },
    {
      chunk: {
        title: 'Guide pratique inspection',
        official_title: 'Guide pratique inspection',
        section_path: 'Checklist avant la visite',
        article_number: null,
        page_start: 1,
        page_end: 1,
      },
    },
  ];

  const raw = [
    'Réponse courte :',
    '- Vérifiez les documents [R1] et la checklist [R2].',
    '',
    'Sources :',
    '- [R1]',
    '- [R2]',
  ].join('\n');

  const output = cnss._test.postProcessLegalReply(raw, results, 'fr');

  assert.match(output, /Réponse utile/);
  assert.doesNotMatch(output, /\[R1\]/);
  assert.doesNotMatch(output, /\[R2\]/);
  assert.match(output, /Décret inspection — Article 6 — art\. 6 — p\. 8/);
  assert.match(output, /Guide pratique inspection — Checklist avant la visite — p\. 1/);
});

test('getStructuredLabels adapte les intitulés pour une question pratique juridique', () => {
  const labels = cnss._test.getStructuredLabels('fr', { practical: true, legal: true });

  assert.equal(labels.short, 'Ce que vous devez faire');
  assert.equal(labels.foundation, 'Base juridique');
  assert.equal(labels.limits, 'Risques / points à vérifier');
  assert.equal(labels.sources, 'Sources utiles');
});

test('extractAssistantText reconstruit le texte si le contenu est renvoye en parties', () => {
  const output = cnss._test.extractAssistantText({
    content: [
      { text: 'Bloc 1' },
      { text: { value: 'Bloc 2' } },
    ],
  });

  assert.equal(output, 'Bloc 1\nBloc 2');
});

test('fallbackLegalSearch ne plante pas si la récupération juridique avancée échoue', async () => {
  const originalRetrieveLegalResults = legalKb.retrieveLegalResults;
  legalKb.retrieveLegalResults = async () => {
    throw new Error('azure unavailable');
  };

  try {
    const output = await cnss._test.fallbackLegalSearch('Dis moi ce que je dois faire en cas d inspection', 'conformites');

    assert.equal(typeof output, 'string');
    assert.ok(output.length > 0);
    assert.match(output, /Ce que vous devez faire|Réponse utile/);
    assert.match(output, /Base juridique|Fondement/);
  } finally {
    legalKb.retrieveLegalResults = originalRetrieveLegalResults;
  }
});
