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

test('buildPracticalShortLines priorise le decret d equivalence avant les formalites CNOP pour une question d equivalence pure', () => {
  const lines = cnss._test.buildPracticalShortLines(
    [
      {
        document_type: 'guide_pratique',
        confidence: 'high',
        citation_label: "Autorisation d'exercer - CNOP, unnamed_section, p. 2",
        key_rules: [
          "Le dossier doit aussi comprendre une copie certifiee conforme a l'original de la carte d'identite nationale.",
          "Il est precise que toute certification de plus de trois mois est systematiquement rejetee.",
        ],
      },
      {
        document_type: 'decret',
        confidence: 'high',
        citation_label: 'Decret 2-01-333 du 21 juin 2001, unnamed_section, p. 1-2',
        key_rules: [
          "Article 1 : l'autorite gouvernementale chargee de l'enseignement superieur est seule habilitee a prononcer l'equivalence.",
          "Article 3 : l'equivalence est prononcee par arrete apres avis d'une commission sectorielle.",
        ],
      },
    ],
    "Comment obtenir l'equivalence d'un diplome ?",
  );

  assert.match(lines[0], /autorite gouvernementale|commission sectorielle|arrete/i);
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

test('resolveFaqScopeOverride reroute les questions CNDP du theme conformites vers la FAQ CNDP', () => {
  assert.equal(
    cnss._test.resolveFaqScopeOverride('Combien de pages contient le formulaire CNDP ?', 'conformites'),
    'cndp',
  );
  assert.equal(
    cnss._test.resolveFaqScopeOverride('Que faut-il preparer avant une inspection ?', 'conformites'),
    null,
  );
});

test('fallbackKeywordSearch retrouve la bonne section FSE pour une question sur le logiciel', () => {
  const output = cnss._test.fallbackKeywordSearch('Faut-il un nouveau logiciel pour la FSE ?', 'fse');

  assert.match(output, /logiciel de gestion officinale existant/i);
  assert.doesNotMatch(output, /qr code/i);
});

test('embedded FAQ fallback couvre les scopes FSE et CNDP quand la base runtime manque', () => {
  const fseFallback = cnss._test.getEmbeddedFaqContext('fse');
  const cndpFallback = cnss._test.getEmbeddedFaqContext('cndp');

  assert.match(fseFallback, /C'est quoi la FSE/i);
  assert.match(fseFallback, /phase pilote/i);
  assert.match(cndpFallback, /formulaire CNDP comporte 8 pages|8 pages/i);
  assert.match(cndpFallback, /conf-secteur-sante@cndp\.ma/i);
});

test('answerQuestion repond a une question CNDP du theme conformites avec la FAQ CNDP', async () => {
  const output = await cnss.answerQuestion('Combien de pages contient le formulaire CNDP ?', 'conformites', 'fr');

  assert.match(output, /8 pages|huit pages/i);
  assert.match(output, /cndp|sante\\.cndp\\.ma|conf-secteur-sante@cndp\\.ma/i);
});
