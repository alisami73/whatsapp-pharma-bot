'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const legalKb = require('../modules/legal_kb');

function buildCorpus(chunks) {
  const entries = chunks.map((chunk) => {
    const lexicalText = legalKb.buildLexicalText(chunk);
    const tokens = legalKb.tokenize(lexicalText);
    const termFreq = new Map();
    tokens.forEach((token) => {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    });

    return {
      chunk,
      lexicalText,
      tokens,
      termFreq,
      docLength: tokens.length || 1,
    };
  });

  const documentFrequencies = new Map();
  let totalLength = 0;

  entries.forEach((entry) => {
    totalLength += entry.docLength;
    Array.from(new Set(entry.tokens)).forEach((token) => {
      documentFrequencies.set(token, (documentFrequencies.get(token) || 0) + 1);
    });
  });

  return {
    entries,
    documentFrequencies,
    averageLength: entries.length ? totalLength / entries.length : 1,
  };
}

test('buildEmbeddingText keeps legal signal and avoids runtime noise', () => {
  const text = legalKb.buildEmbeddingText({
    official_title: 'Loi n° 17-04',
    document_type: 'loi',
    section_path: 'Titre I > Chapitre I > Article 12',
    article_number: '12',
    chunk_type: 'article',
    publication_date: '22 novembre 2006',
    topics: ['officine', 'inspection'],
    entities: ['CNSS'],
    citations: ['loi n° 17-04'],
    user_questions: ['Que dit l article 12 ?', 'Quelle autorisation faut-il ?'],
    legal_summary: 'Le pharmacien doit afficher l’autorisation.',
    clean_text: 'Le pharmacien doit afficher l’autorisation dans l’officine.',
    confidence: 'high',
    manual_review_required: true,
  });

  assert.match(text, /Loi n° 17-04/);
  assert.match(text, /Article: 12/);
  assert.match(text, /User questions:/);
  assert.doesNotMatch(text, /manual_review_required/);
  assert.doesNotMatch(text, /confidence/i);
});

test('hybrid retrieval favors exact legal reference matches', async () => {
  const chunks = [
    {
      chunk_id: 'chunk_article_12',
      doc_id: 'law_17_04',
      official_title: 'Loi n° 17-04 portant code du médicament et de la pharmacie',
      short_title: 'Loi n° 17-04',
      structure_path: 'Titre I > Chapitre I > Article 12',
      section_path: 'Titre I > Chapitre I > Article 12',
      article_number: '12',
      document_type: 'loi',
      language: 'fr',
      clean_text: 'Article 12 : Le pharmacien doit afficher l’autorisation dans l’officine.',
      legal_summary: 'Le pharmacien doit afficher l’autorisation dans l’officine.',
      topics: ['officine'],
      topic_tags: ['officine'],
      retrieval_keywords: ['article 12', 'autorisation', 'officine'],
      citations: ['loi n 17 04'],
      obligations: ['Le pharmacien doit afficher l’autorisation dans l’officine.'],
      sanctions: [],
      deadlines: [],
      confidence: 'high',
      manual_review_required: false,
      embedding: [1, 0],
    },
    {
      chunk_id: 'chunk_general',
      doc_id: 'inspection',
      official_title: 'Décret inspection',
      short_title: 'Décret inspection',
      structure_path: 'Inspection',
      section_path: 'Inspection',
      article_number: null,
      document_type: 'décret',
      language: 'fr',
      clean_text: 'L’inspection vérifie les conditions générales d’exploitation de l’officine.',
      legal_summary: 'Inspection générale de l’officine.',
      topics: ['inspection'],
      topic_tags: ['inspection'],
      retrieval_keywords: ['inspection', 'officine'],
      citations: [],
      obligations: [],
      sanctions: [],
      deadlines: [],
      confidence: 'high',
      manual_review_required: false,
      embedding: [0.2, 0.8],
    },
  ];

  const corpus = buildCorpus(chunks);
  const retrieval = await legalKb.retrieveLegalResults(
    'Que dit l’article 12 sur l’autorisation de l’officine ?',
    {
      scope: 'regulations',
      topK: 2,
      corpus,
      queryEmbedding: [1, 0],
    },
  );

  assert.equal(retrieval.results[0].chunk.chunk_id, 'chunk_article_12');
});

test('reranking boosts sanctions and deadlines when the query asks for them', async () => {
  const chunks = [
    {
      chunk_id: 'chunk_delay_sanction',
      doc_id: 'doc_a',
      official_title: 'Texte A',
      short_title: 'Texte A',
      structure_path: 'Article 8',
      section_path: 'Article 8',
      article_number: '8',
      document_type: 'loi',
      language: 'fr',
      clean_text: 'Le dossier doit être transmis dans un délai de 30 jours. Toute infraction est punie d’une amende.',
      legal_summary: 'Transmission dans un délai de 30 jours avec amende en cas d’infraction.',
      topics: ['inspection'],
      topic_tags: ['inspection'],
      retrieval_keywords: ['délai', '30 jours', 'amende'],
      citations: ['loi n 17 04'],
      obligations: ['Le dossier doit être transmis.'],
      sanctions: ['Toute infraction est punie d’une amende.'],
      deadlines: ['délai de 30 jours'],
      confidence: 'high',
      manual_review_required: false,
      embedding: [0.9, 0.1],
    },
    {
      chunk_id: 'chunk_neutral',
      doc_id: 'doc_b',
      official_title: 'Texte B',
      short_title: 'Texte B',
      structure_path: 'Article 9',
      section_path: 'Article 9',
      article_number: '9',
      document_type: 'loi',
      language: 'fr',
      clean_text: 'Le pharmacien doit afficher le règlement intérieur.',
      legal_summary: 'Affichage du règlement intérieur.',
      topics: ['officine'],
      topic_tags: ['officine'],
      retrieval_keywords: ['règlement', 'affichage'],
      citations: [],
      obligations: ['Le pharmacien doit afficher le règlement intérieur.'],
      sanctions: [],
      deadlines: [],
      confidence: 'high',
      manual_review_required: false,
      embedding: [0.1, 0.9],
    },
  ];

  const corpus = buildCorpus(chunks);
  const retrieval = await legalKb.retrieveLegalResults(
    'Quel est le délai et quelle amende est prévue en cas d’infraction ?',
    {
      scope: 'compliance',
      topK: 2,
      corpus,
      queryEmbedding: [0.9, 0.1],
    },
  );

  assert.equal(retrieval.results[0].chunk.chunk_id, 'chunk_delay_sanction');
  assert.ok(retrieval.results[0].rerankScore >= retrieval.results[1].rerankScore);
});

test('retrieveLegalResults keeps working when embedding lookup fails', async () => {
  const openai = require('openai');
  const originalAzureOpenAI = openai.AzureOpenAI;
  const previousEnv = {
    AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
    AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
    AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION,
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
  };

  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  process.env.AZURE_OPENAI_ENDPOINT = 'https://example.openai.azure.com/';
  process.env.AZURE_OPENAI_API_VERSION = '2024-10-21';
  process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = 'text-embedding-3-small';

  Object.defineProperty(openai, 'AzureOpenAI', {
    configurable: true,
    enumerable: true,
    value: class AzureOpenAIMock {
      constructor() {
        this.embeddings = {
          create: async () => {
            throw new Error('embedding offline');
          },
        };
      }
    },
  });

  const chunks = [
    {
      chunk_id: 'chunk_inspection',
      doc_id: 'doc_inspection',
      official_title: 'Décret inspection',
      short_title: 'Décret inspection',
      structure_path: 'Article 6',
      section_path: 'Article 6',
      article_number: '6',
      document_type: 'décret',
      language: 'fr',
      clean_text: 'Les inspecteurs peuvent accéder à tous les locaux soumis à inspection.',
      legal_summary: 'Les inspecteurs peuvent accéder à tous les locaux soumis à inspection.',
      topics: ['inspection'],
      topic_tags: ['inspection'],
      retrieval_keywords: ['inspection', 'locaux', 'inspecteurs'],
      citations: [],
      obligations: [],
      sanctions: [],
      deadlines: [],
      confidence: 'high',
      manual_review_required: false,
    },
  ];

  try {
    legalKb.invalidateCaches();
    const corpus = buildCorpus(chunks);
    const retrieval = await legalKb.retrieveLegalResults('Que peuvent faire les inspecteurs pendant une inspection ?', {
      scope: 'conformites',
      topK: 1,
      corpus,
    });

    assert.equal(retrieval.results[0].chunk.chunk_id, 'chunk_inspection');
    assert.equal(retrieval.usedVector, false);
  } finally {
    Object.defineProperty(openai, 'AzureOpenAI', {
      configurable: true,
      enumerable: true,
      value: originalAzureOpenAI,
    });
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    legalKb.invalidateCaches();
  }
});
