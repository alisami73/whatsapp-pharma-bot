'use strict';

const fs = require('fs');
const path = require('path');
const azureAiSearch = require('./azure_ai_search');
const supabaseKb = require('./supabase_kb');

const LEGAL_CHUNKS_DIR = path.join(__dirname, '..', 'data', 'legal_kb', 'chunks');
const LEGAL_HYBRID_INDEX_PATH = path.join(__dirname, '..', 'data', 'legal_kb', 'indexes', 'legal_hybrid_index.json');

const MAX_EMBEDDING_TEXT_CHARS = 2400;
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const RRF_K = 60;
const DEFAULT_TOP_K = Math.max(1, Number(process.env.TOP_K) || 4);
const TOPICAL_QUERY_STOPWORDS = new Set([
  'a',
  'ai',
  'au',
  'aux',
  'avec',
  'cas',
  'ce',
  'ces',
  'comment',
  'dans',
  'de',
  'des',
  'dois',
  'doit',
  'du',
  'elle',
  'en',
  'est',
  'et',
  'etre',
  'fais',
  'faire',
  'faut',
  'il',
  'je',
  'l',
  'la',
  'le',
  'les',
  'ma',
  'mes',
  'mon',
  'nous',
  'obtenir',
  'on',
  'ou',
  'par',
  'pas',
  'pour',
  'qu',
  'que',
  'quel',
  'quelle',
  'quelles',
  'quels',
  'quoi',
  'sa',
  'ses',
  'son',
  'sur',
  'ta',
  'tes',
  'ton',
  'un',
  'une',
  'vous',
]);

let _corpusCache = null;
let _hybridIndexCache = null;
let _embeddingClientCache = null;

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
}

function shouldUseLegalKb(scope) {
  return ['conformites', 'compliance', 'regulations'].includes(String(scope || '').trim().toLowerCase());
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function buildTopicalQueryTokens(tokens) {
  return Array.from(new Set(
    (tokens || []).filter((token) => token.length > 2 && !TOPICAL_QUERY_STOPWORDS.has(token)),
  ));
}

function extractArticleRefs(value) {
  const matches = [];
  const patterns = [
    /\barticle\s+(premier|1er|\d+)\b/gi,
    /\bart\.?\s*(premier|1er|\d+)\b/gi,
    /المادة\s+([0-9٠-٩]+)/g,
  ];

  patterns.forEach((pattern) => {
    for (const match of String(value || '').matchAll(pattern)) {
      const ref = String(match[1] || '').trim();
      if (ref && !matches.includes(ref)) {
        matches.push(ref);
      }
    }
  });

  return matches;
}

function extractDocumentRefs(value) {
  const refs = [];
  const patterns = [
    /\b(?:loi|dahir|decret|décret|arrete|arrêté)\s*(?:n[°º]?\s*)?[\d.-]+/gi,
    /\bbo[\s_:-]*\d+/gi,
    /مرسوم\s+رقم\s+[\d.-]+/g,
    /ظهير(?:\s+شريف)?\s+رقم\s+[\d.-]+/g,
  ];

  patterns.forEach((pattern) => {
    for (const match of String(value || '').matchAll(pattern)) {
      const ref = normalizeText(match[0]);
      if (ref && !refs.includes(ref)) {
        refs.push(ref);
      }
    }
  });

  return refs;
}

function extractDateRefs(value) {
  const refs = [];
  const patterns = [
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
    /\b\d{1,2}\s+[a-z\u0600-\u06ff]+\s+\d{4}\b/gi,
  ];

  patterns.forEach((pattern) => {
    for (const match of String(value || '').matchAll(pattern)) {
      const ref = normalizeText(match[0]);
      if (ref && !refs.includes(ref)) {
        refs.push(ref);
      }
    }
  });

  return refs;
}

// Expand query tokens for known domain topics to improve recall
function expandQueryTokens(tokens, text) {
  const expanded = [...tokens];
  const normalized = normalizeText(text);

  const expansions = [
    { pattern: /inspect/, add: ['inspection', 'locaux', 'affichage', 'registre', 'armoire', 'materiel', 'diplome'] },
    { pattern: /stupefiant|narcot|morphin/, add: ['stupefiants', 'registre', 'armoire', 'carnet', 'ordonnance'] },
    { pattern: /autoris|exerc|cnop|inscription/, add: ['autorisation', 'cnop', 'inscription', 'pharmacien', 'diplome'] },
    { pattern: /equival|diplom|etranger|universit|enseignement.?superieur/, add: ['equivalence', 'equivalences', 'diplome', 'diplomes', 'etranger', 'etrangers', 'enseignement', 'superieur', 'commission', 'commissions', 'recours'] },
    { pattern: /absence|conge|remplac/, add: ['absence', 'remplacement', 'pharmacien', 'officine'] },
    { pattern: /fse|tiers.?payant|amm|assurance/, add: ['fse', 'assurance', 'tiers', 'payant'] },
    { pattern: /cndp|donnees.?personnelles|protection/, add: ['cndp', 'protection', 'donnees', 'personnelles'] },
    { pattern: /cnss|cotis|salaire|smig|travail/, add: ['cnss', 'cotisations', 'salaire', 'travail'] },
  ];

  for (const { pattern, add } of expansions) {
    if (pattern.test(normalized)) {
      for (const token of add) {
        if (!expanded.includes(token)) expanded.push(token);
      }
    }
  }

  return expanded;
}

function parseQueryFeatures(question) {
  const text = String(question || '');
  const normalizedQuestion = normalizeText(text);
  const articleRefs = extractArticleRefs(text).map((value) => normalizeText(value));
  const documentRefs = extractDocumentRefs(text);
  const dateRefs = extractDateRefs(text);
  const baseTokens = Array.from(new Set([
    ...tokenize(text),
    ...articleRefs.flatMap((value) => tokenize(value)),
    ...documentRefs.flatMap((value) => tokenize(value)),
    ...dateRefs.flatMap((value) => tokenize(value)),
  ]));
  // Use normalized (accent-stripped) for pattern matching
  const tokens = expandQueryTokens(baseTokens, text);
  const nq = normalizedQuestion;

  const asksAboutPractical = /\b(que faire|quoi faire|comment|je dois|dois je|je fais|fais je|a faire|quels? documents?|preparer|se preparer|faut.il|كيف|ماذا|je dois|que doit|que faut|que prevoi|prevo)\b/.test(nq);

  return {
    text,
    normalizedQuestion,
    tokens,
    topicTokens: buildTopicalQueryTokens(tokens),
    articleRefs,
    documentRefs,
    dateRefs,
    asksAboutSanctions: /\b(sanction|amende|penalite|peine|punie|punissable)\b/.test(nq),
    asksAboutDeadlines: /\b(delai|jours|mois|date limite|avant le|quand)\b/.test(nq),
    asksAboutObligations: /\b(obligation|obligatoire|doit|doivent|faut il|est il obligatoire)\b/.test(nq),
    asksAboutPractical,
  };
}

function buildLexicalText(chunk) {
  return uniqueNonEmpty([
    chunk.official_title,
    chunk.short_title,
    chunk.title,
    chunk.structure_path,
    chunk.section_path,
    chunk.article_number ? `article ${chunk.article_number}` : null,
    chunk.publication_reference,
    chunk.publication_date,
    chunk.effective_date,
    ...(chunk.topic_tags || []),
    ...(chunk.topics || []),
    ...(chunk.retrieval_keywords || []),
    ...(chunk.keywords || []),
    ...(chunk.entities || []),
    ...(chunk.obligations || []),
    ...(chunk.deadlines || []),
    ...(chunk.citations || []),
    ...(chunk.cross_references || []),
    ...(chunk.key_rules || []),
    ...(chunk.sanctions || []),
    ...(chunk.definitions || []),
    ...(chunk.user_questions || []),
    chunk.legal_summary,
    chunk.clean_text || chunk.text,
    chunk.citation_label,
  ]).join('\n');
}

function buildEmbeddingText(chunk) {
  const parts = uniqueNonEmpty([
    chunk.official_title || chunk.title || chunk.short_title,
    chunk.document_type ? `Type: ${chunk.document_type}` : null,
    chunk.section_path || chunk.structure_path,
    chunk.article_number ? `Article: ${chunk.article_number}` : null,
    chunk.chunk_type ? `Chunk type: ${chunk.chunk_type}` : null,
    chunk.publication_date ? `Publication: ${chunk.publication_date}` : null,
    chunk.effective_date ? `Effective: ${chunk.effective_date}` : null,
    (chunk.topics || chunk.topic_tags || []).length ? `Topics: ${(chunk.topics || chunk.topic_tags).join(', ')}` : null,
    (chunk.entities || []).length ? `Entities: ${chunk.entities.join(', ')}` : null,
    (chunk.citations || chunk.cross_references || []).length ? `References: ${(chunk.citations || chunk.cross_references).join(', ')}` : null,
    (chunk.user_questions || []).length ? `User questions: ${chunk.user_questions.slice(0, 6).join(' | ')}` : null,
    chunk.legal_summary,
    chunk.clean_text || chunk.text,
  ]);

  return parts.join('\n').slice(0, MAX_EMBEDDING_TEXT_CHARS);
}

function sourceAuthorityScore(chunk) {
  if (chunk.document_type === 'autre' || chunk.source_document_kind === 'knowledge_markdown') {
    return -1;
  }
  if (chunk.manual_review_required) {
    return -0.5;
  }
  return 1;
}

function loadHybridIndex() {
  if (_hybridIndexCache !== null) {
    return _hybridIndexCache;
  }

  try {
    if (fs.existsSync(LEGAL_HYBRID_INDEX_PATH)) {
      _hybridIndexCache = JSON.parse(fs.readFileSync(LEGAL_HYBRID_INDEX_PATH, 'utf8'));
      return _hybridIndexCache;
    }
  } catch (error) {
    console.warn('[legal-kb] Impossible de charger legal_hybrid_index.json:', error.message);
  }

  _hybridIndexCache = null;
  return _hybridIndexCache;
}

function loadChunkEntries() {
  const hybridIndex = loadHybridIndex();
  if (Array.isArray(hybridIndex?.chunks) && hybridIndex.chunks.length) {
    return hybridIndex.chunks.map((entry) => ({
      ...entry.chunk,
      embedding: Array.isArray(entry.embedding) ? entry.embedding : null,
      embedding_text: entry.embedding_text || buildEmbeddingText(entry.chunk || {}),
    }));
  }

  if (!fs.existsSync(LEGAL_CHUNKS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(LEGAL_CHUNKS_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort();

  const chunks = [];

  files.forEach((file) => {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(LEGAL_CHUNKS_DIR, file), 'utf8'));
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.chunks)
        ? payload.chunks
        : [];
      list.forEach((chunk) => chunks.push({
        ...chunk,
        embedding: Array.isArray(chunk.embedding) ? chunk.embedding : null,
        embedding_text: chunk.embedding_text || buildEmbeddingText(chunk),
      }));
    } catch (error) {
      console.warn(`[legal-kb] Impossible de charger ${file}:`, error.message);
    }
  });

  return chunks;
}

function buildCorpus() {
  const entries = loadChunkEntries();
  const tokenizedEntries = entries.map((chunk) => {
    const lexicalText = buildLexicalText(chunk);
    const tokens = tokenize(lexicalText);
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

  tokenizedEntries.forEach((entry) => {
    totalLength += entry.docLength;
    Array.from(new Set(entry.tokens)).forEach((token) => {
      documentFrequencies.set(token, (documentFrequencies.get(token) || 0) + 1);
    });
  });

  return {
    entries: tokenizedEntries,
    documentFrequencies,
    averageLength: tokenizedEntries.length ? totalLength / tokenizedEntries.length : 1,
  };
}

function getCorpus() {
  if (_corpusCache !== null) {
    return _corpusCache;
  }

  _corpusCache = buildCorpus();
  return _corpusCache;
}

function invalidateCaches() {
  _corpusCache = null;
  _hybridIndexCache = null;
  _embeddingClientCache = null;
}

function bm25Score(queryTokens, corpusEntry, corpus) {
  let score = 0;
  const { termFreq, docLength } = corpusEntry;
  const avgdl = corpus.averageLength || 1;
  const docCount = corpus.entries.length || 1;

  queryTokens.forEach((token) => {
    const frequency = termFreq.get(token) || 0;
    if (!frequency) {
      return;
    }

    const df = corpus.documentFrequencies.get(token) || 0;
    const idf = Math.log(1 + ((docCount - df + 0.5) / (df + 0.5)));
    const numerator = frequency * (BM25_K1 + 1);
    const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgdl));
    score += idf * (numerator / denominator);
  });

  return score;
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) {
    return 0;
  }

  let dot = 0;
  let normLeft = 0;
  let normRight = 0;

  for (let index = 0; index < left.length; index += 1) {
    const l = Number(left[index]) || 0;
    const r = Number(right[index]) || 0;
    dot += l * r;
    normLeft += l * l;
    normRight += r * r;
  }

  if (!normLeft || !normRight) {
    return 0;
  }

  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
}

function exactMatchBoost(chunk, queryFeatures) {
  let score = 0;
  const chunkArticle = normalizeText(chunk.article_number || '');
  const chunkCorpus = normalizeText([
    chunk.official_title,
    chunk.short_title,
    chunk.citation_label,
    chunk.structure_path,
    chunk.section_path,
    ...(chunk.citations || chunk.cross_references || []),
  ].join(' '));

  if (chunkArticle && queryFeatures.articleRefs.includes(chunkArticle)) {
    score += 8;
  }

  if (queryFeatures.documentRefs.some((ref) => chunkCorpus.includes(ref))) {
    score += 10;
  }

  if (queryFeatures.dateRefs.some((ref) => chunkCorpus.includes(ref))) {
    score += 4;
  }

  if (
    normalizeText(chunk.citation_label).length &&
    queryFeatures.normalizedQuestion.includes(normalizeText(chunk.citation_label))
  ) {
    score += 6;
  }

  return score;
}

function buildChunkTopicTokens(chunk) {
  const topicalText = uniqueNonEmpty([
    chunk.doc_id,
    chunk.official_title,
    chunk.short_title,
    chunk.citation_label,
    chunk.section_path,
    chunk.structure_path,
    ...(chunk.topics || []),
    ...(chunk.topic_tags || []),
    ...(chunk.retrieval_keywords || []),
    ...(chunk.keywords || []),
    ...(chunk.user_questions || []),
    chunk.legal_summary,
  ]).join('\n');

  return new Set(buildTopicalQueryTokens(tokenize(topicalText)));
}

function computeTopicOverlap(chunk, queryFeatures) {
  const queryTokens = Array.isArray(queryFeatures.topicTokens) && queryFeatures.topicTokens.length
    ? queryFeatures.topicTokens
    : buildTopicalQueryTokens(queryFeatures.tokens);

  if (!queryTokens.length) {
    return { count: 0, matches: [] };
  }

  const chunkTokens = buildChunkTopicTokens(chunk);
  const matches = queryTokens.filter((token) => chunkTokens.has(token));
  return { count: matches.length, matches };
}

function topicalBoost(chunk, queryFeatures) {
  let score = 0;
  const topicOverlap = computeTopicOverlap(chunk, queryFeatures);
  const normalizedDocumentType = normalizeText(chunk.document_type || '');
  const normalizedTopicText = normalizeText([
    chunk.official_title,
    chunk.short_title,
    ...(chunk.topics || []),
    ...(chunk.topic_tags || []),
  ].join(' '));
  const isEquivalenceQuery = (queryFeatures.topicTokens || []).some((token) => token.startsWith('equival') || token.startsWith('diplom'));
  const asksAboutAuthorization = (queryFeatures.topicTokens || []).some((token) => /autoris|exerc|cnop|ordre/.test(token));

  if (topicOverlap.count) {
    score += Math.min(topicOverlap.count, 4) * 1.4;
  }

  if (isEquivalenceQuery && topicOverlap.count >= 2 && ['decret', 'loi', 'arrete'].includes(normalizedDocumentType)) {
    score += 1.5;
  }

  if (
    isEquivalenceQuery &&
    !asksAboutAuthorization &&
    chunk.document_type === 'guide_pratique' &&
    /autorisation|cnop|ordre des pharmaciens|exercice/.test(normalizedTopicText)
  ) {
    score -= 1.5;
  }

  if (queryFeatures.asksAboutSanctions && Array.isArray(chunk.sanctions) && chunk.sanctions.length) {
    score += 2;
  }
  if (queryFeatures.asksAboutDeadlines && Array.isArray(chunk.deadlines) && chunk.deadlines.length) {
    score += 2;
  }
  if (queryFeatures.asksAboutObligations && Array.isArray(chunk.obligations) && chunk.obligations.length) {
    score += 2;
  }

  // Boost practical guides when user asks "que faire / comment / preparer"
  if (queryFeatures.asksAboutPractical && chunk.document_type === 'guide_pratique') {
    if (topicOverlap.count >= 2) {
      score += 5;
    } else if (topicOverlap.count === 1) {
      score += 1;
    } else {
      score -= 1;
    }
  }

  // Boost chunks whose doc_id tokens overlap strongly with query tokens
  const docIdTokens = tokenize(normalizeText(chunk.doc_id || chunk.chunk_id || ''));
  const docIdReferenceTokens = Array.isArray(queryFeatures.topicTokens) && queryFeatures.topicTokens.length
    ? queryFeatures.topicTokens
    : queryFeatures.tokens;
  const docIdOverlap = docIdTokens.filter((t) => docIdReferenceTokens.includes(t)).length;
  if (docIdOverlap >= 2) {
    score += docIdOverlap * 1.5;
  }

  if (chunk.language === 'ar' && /[\u0600-\u06FF]/.test(queryFeatures.text)) {
    score += 1;
  }
  if (chunk.language === 'fr' && !/[\u0600-\u06FF]/.test(queryFeatures.text)) {
    score += 0.5;
  }

  if (chunk.confidence === 'high') {
    score += 1;
  } else if (chunk.confidence === 'medium') {
    score += 0.4;
  } else if (chunk.confidence === 'low') {
    score -= 0.5;
  }

  if (chunk.manual_review_required) {
    score -= 1;
  }

  score += sourceAuthorityScore(chunk);

  return score;
}

function scopeBoost(chunk, scope) {
  const normalizedScope = String(scope || '').trim().toLowerCase();

  if (normalizedScope === 'regulations' && chunk.document_type === 'autre') {
    return -1.5;
  }

  if (normalizedScope === 'compliance' && chunk.document_type === 'autre') {
    return -0.2;
  }

  return 0;
}

function reciprocalRank(rank) {
  if (!Number.isFinite(rank) || rank <= 0) {
    return 0;
  }
  return 1 / (RRF_K + rank);
}

function rerankResults(baseEntries, lexicalRankMap, vectorRankMap, queryFeatures, scope) {
  return baseEntries
    .map((entry) => {
      const lexicalRank = lexicalRankMap.get(entry.chunk.chunk_id) || null;
      const vectorRank = vectorRankMap.get(entry.chunk.chunk_id) || null;
      const fusedScore = reciprocalRank(lexicalRank) + reciprocalRank(vectorRank);
      const rerankScore = fusedScore
        + exactMatchBoost(entry.chunk, queryFeatures) * 0.08
        + topicalBoost(entry.chunk, queryFeatures) * 0.05
        + scopeBoost(entry.chunk, scope) * 0.05;

      return {
        ...entry,
        lexicalRank,
        vectorRank,
        fusedScore,
        rerankScore,
      };
    })
    .sort((left, right) => right.rerankScore - left.rerankScore);
}

function hasEmbeddingSupport() {
  const azureEnabled = Boolean(
    process.env.AZURE_OPENAI_API_KEY &&
    process.env.AZURE_OPENAI_ENDPOINT &&
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
  );
  const openAiEnabled = Boolean(
    process.env.OPENAI_API_KEY &&
    process.env.OPENAI_EMBEDDING_MODEL,
  );

  return azureEnabled || openAiEnabled;
}

function getEmbeddingClient() {
  if (_embeddingClientCache !== null) {
    return _embeddingClientCache;
  }

  if (
    process.env.AZURE_OPENAI_API_KEY &&
    process.env.AZURE_OPENAI_ENDPOINT &&
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT
  ) {
    const { AzureOpenAI } = require('openai');
    _embeddingClientCache = {
      provider: 'azure',
      model: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      client: new AzureOpenAI({
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-01',
        timeout: 8000,
        maxRetries: 0,
      }),
    };
    return _embeddingClientCache;
  }

  if (process.env.OPENAI_API_KEY && process.env.OPENAI_EMBEDDING_MODEL) {
    const { OpenAI } = require('openai');
    _embeddingClientCache = {
      provider: 'openai',
      model: process.env.OPENAI_EMBEDDING_MODEL,
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    };
    return _embeddingClientCache;
  }

  _embeddingClientCache = null;
  return _embeddingClientCache;
}

async function embedText(value) {
  const runtime = getEmbeddingClient();
  if (!runtime) {
    return null;
  }

  const response = await runtime.client.embeddings.create({
    model: runtime.model,
    input: String(value || '').trim(),
  });

  return response?.data?.[0]?.embedding || null;
}

async function resolveQueryEmbedding(question, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'queryEmbedding')) {
    return options.queryEmbedding;
  }

  if (!hasEmbeddingSupport()) {
    return null;
  }

  try {
    return await embedText(String(question || '').trim());
  } catch (error) {
    console.warn('[legal-kb] Embedding lookup failed, continuing without vectors:', error.message || error);
    return null;
  }
}

async function retrieveLegalResults(question, options = {}) {
  const scope = options.scope || '';
  const topK = Number(options.topK) || DEFAULT_TOP_K;
  const queryFeatures = parseQueryFeatures(question);
  const useAzureSearch = azureAiSearch.isAzureAiSearchEnabled() && !options.corpus;
  const queryEmbedding = await resolveQueryEmbedding(question, options);

  if (useAzureSearch) {
    try {
      const results = await azureAiSearch.searchChunks({
        queryText: question,
        queryEmbedding,
        topK,
        hybrid: options.hybrid !== undefined ? Boolean(options.hybrid) : azureAiSearch.getConfig().hybridEnabled,
      });
      console.log('[legal-kb] azure_ai_search retrieved:', results.map((r) => `${r.chunk.chunk_id}(${Number(r.rerankScore || 0).toFixed(2)})`).join(', '));

      return {
        queryFeatures,
        usedVector: Array.isArray(queryEmbedding) && queryEmbedding.length > 0,
        queryEmbedding,
        results,
        provider: 'azure_ai_search',
      };
    } catch (error) {
      console.warn('[legal-kb] Azure AI Search failed, falling back to local retrieval:', error.message || error);
    }
  }

  const corpus = options.corpus || getCorpus();

  const lexicalCandidates = corpus.entries
    .map((entry) => {
      const lexicalScore = bm25Score(queryFeatures.tokens, entry, corpus);
      const exactScore = exactMatchBoost(entry.chunk, queryFeatures);
      const topicalScore = topicalBoost(entry.chunk, queryFeatures);
      const totalLexical = lexicalScore + exactScore + topicalScore + scopeBoost(entry.chunk, scope);

      return {
        chunk: entry.chunk,
        lexicalScore,
        exactScore,
        topicalScore,
        totalLexical,
      };
    })
    .filter((entry) => entry.totalLexical > 0)
    .sort((left, right) => right.totalLexical - left.totalLexical);

  const lexicalRankMap = new Map();
  lexicalCandidates.forEach((entry, index) => lexicalRankMap.set(entry.chunk.chunk_id, index + 1));

  let vectorCandidates = [];

  // ── Supabase vector search (preferred when populated) ──────────────────────
  if (Array.isArray(queryEmbedding) && supabaseKb.isEnabled()) {
    try {
      const supabaseTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Supabase search timeout')), 5000),
      );
      const sbResults = await Promise.race([
        supabaseKb.searchChunks({
          queryText: String(question || '').trim(),
          queryEmbedding,
          topK: Math.max(topK * 4, 20),
        }),
        supabaseTimeout,
      ]);
      if (sbResults.length > 0) {
        vectorCandidates = sbResults.map((r) => ({
          chunk: r.chunk,
          vectorScore: r.rerankScore,
        }));
        console.log('[legal-kb] supabase hybrid retrieved:', sbResults.map((r) => `${r.chunk.chunk_id}(${Number(r.rerankScore || 0).toFixed(3)})`).join(', '));
      }
    } catch (sbErr) {
      console.warn('[legal-kb] Supabase search failed, falling back to local cosine:', sbErr.message);
    }
  }

  // ── Local cosine fallback (when Supabase unavailable or empty) ────────────
  if (!vectorCandidates.length && Array.isArray(queryEmbedding)) {
    vectorCandidates = corpus.entries
      .filter((entry) => Array.isArray(entry.chunk.embedding))
      .map((entry) => ({
        chunk: entry.chunk,
        vectorScore: cosineSimilarity(queryEmbedding, entry.chunk.embedding),
      }))
      .filter((entry) => entry.vectorScore > 0)
      .sort((left, right) => right.vectorScore - left.vectorScore);
  }

  const vectorRankMap = new Map();
  vectorCandidates.forEach((entry, index) => vectorRankMap.set(entry.chunk.chunk_id, index + 1));

  const byChunkId = new Map();

  lexicalCandidates.slice(0, Math.max(topK * 4, 20)).forEach((entry) => {
    byChunkId.set(entry.chunk.chunk_id, {
      chunk: entry.chunk,
      lexicalScore: entry.totalLexical,
      vectorScore: 0,
    });
  });

  vectorCandidates.slice(0, Math.max(topK * 4, 20)).forEach((entry) => {
    const existing = byChunkId.get(entry.chunk.chunk_id) || {
      chunk: entry.chunk,
      lexicalScore: 0,
      vectorScore: 0,
    };
    existing.vectorScore = entry.vectorScore;
    byChunkId.set(entry.chunk.chunk_id, existing);
  });

  const reranked = rerankResults(
    Array.from(byChunkId.values()),
    lexicalRankMap,
    vectorRankMap,
    queryFeatures,
    scope,
  );

  const topResults = reranked.slice(0, topK);
  console.log('[legal-kb] retrieved:', topResults.map((r) => `${r.chunk.chunk_id}(${r.rerankScore?.toFixed(2)})`).join(', '));

  const usedSupabase = supabaseKb.isEnabled() && vectorCandidates.length > 0;

  return {
    queryFeatures,
    usedVector: Array.isArray(queryEmbedding) && vectorCandidates.length > 0,
    queryEmbedding,
    results: topResults,
    provider: usedSupabase ? 'supabase' : 'local_bm25',
  };
}

function buildCitationLabel(chunk) {
  if (String(chunk?.citation_label || '').trim()) {
    return String(chunk.citation_label).trim();
  }

  const sourceTitle = chunk.title || chunk.official_title || chunk.short_title || chunk.doc_id;
  const sectionLabel = chunk.section_path || chunk.structure_path || chunk.chunk_type || 'section';
  const articlePart = chunk.article_number ? `art. ${chunk.article_number}` : null;
  const pagePart = chunk.page_start
    ? (chunk.page_end && chunk.page_end !== chunk.page_start ? `p. ${chunk.page_start}-${chunk.page_end}` : `p. ${chunk.page_start}`)
    : null;

  return uniqueNonEmpty([sourceTitle, sectionLabel, articlePart, pagePart]).join(' — ');
}

function buildLegalContext(results, options = {}) {
  const maxChars = Number(options.maxChars) || 14000;
  const parts = [];
  let currentLength = 0;

  results.forEach((entry, index) => {
    const chunk = entry.chunk;
    const block = [
      `[R${index + 1}] ${buildCitationLabel(chunk)}`,
      `Document ID: ${chunk.document_id || chunk.doc_id}`,
      `Document type: ${chunk.document_type || 'unknown'}`,
      `Chunk type: ${chunk.chunk_type || 'unknown'}`,
      `Publication: ${chunk.publication_date || chunk.date_gregorian || chunk.publication_reference || 'unknown'}`,
      `Effective date: ${chunk.effective_date || 'unknown'}`,
      `Section path: ${chunk.section_path || chunk.structure_path || 'unknown'}`,
      chunk.article_number ? `Article: ${chunk.article_number}` : null,
      (chunk.topics || chunk.topic_tags || []).length ? `Topics: ${(chunk.topics || chunk.topic_tags).slice(0, 8).join(' | ')}` : null,
      (chunk.entities || []).length ? `Entities: ${chunk.entities.slice(0, 8).join(' | ')}` : null,
      (chunk.obligations || []).length ? `Obligations: ${chunk.obligations.slice(0, 3).join(' | ')}` : null,
      (chunk.sanctions || []).length ? `Sanctions: ${chunk.sanctions.slice(0, 3).join(' | ')}` : null,
      (chunk.deadlines || []).length ? `Deadlines: ${chunk.deadlines.slice(0, 3).join(' | ')}` : null,
      (chunk.citations || chunk.cross_references || []).length ? `Citations: ${(chunk.citations || chunk.cross_references).slice(0, 8).join(' | ')}` : null,
      `Confidence: ${chunk.confidence || 'unknown'}${chunk.manual_review_required ? ' | manual_review_required=true' : ''}`,
      chunk.legal_summary ? `Summary: ${chunk.legal_summary}` : null,
      `Excerpt: ${(chunk.clean_text || chunk.text || '').slice(0, 1800)}`,
    ].filter(Boolean).join('\n');

    if (currentLength + block.length <= maxChars) {
      parts.push(block);
      currentLength += block.length + 2;
    }
  });

  return parts.join('\n\n');
}

module.exports = {
  LEGAL_HYBRID_INDEX_PATH,
  buildCitationLabel,
  buildEmbeddingText,
  buildLegalContext,
  buildLexicalText,
  embedText,
  getCorpus,
  hasEmbeddingSupport,
  invalidateCaches,
  normalizeText,
  parseQueryFeatures,
  retrieveLegalResults,
  shouldUseLegalKb,
  tokenize,
};
