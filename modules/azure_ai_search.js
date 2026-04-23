'use strict';

const AZURE_VECTOR_FIELD = 'content_vector';
const AZURE_VECTOR_PROFILE = 'rag-vector-profile';
const AZURE_VECTOR_ALGORITHM = 'rag-hnsw';
const DEFAULT_API_VERSION = '2025-09-01';
const DEFAULT_BATCH_SIZE = 100;

function envBool(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).trim().toLowerCase());
}

function getConfig() {
  return {
    endpoint: String(process.env.AZURE_SEARCH_ENDPOINT || '').replace(/\/+$/, ''),
    apiKey: process.env.AZURE_SEARCH_API_KEY || '',
    indexName: process.env.AZURE_SEARCH_INDEX_NAME || '',
    apiVersion: process.env.AZURE_SEARCH_API_VERSION || DEFAULT_API_VERSION,
    batchSize: Math.max(1, Math.min(Number(process.env.AZURE_SEARCH_BATCH_SIZE) || DEFAULT_BATCH_SIZE, 1000)),
    hybridEnabled: envBool('AZURE_SEARCH_ENABLE_HYBRID', true),
    semanticRerankerEnabled: envBool('AZURE_SEARCH_ENABLE_SEMANTIC_RERANKER', false),
    semanticConfiguration: process.env.AZURE_SEARCH_SEMANTIC_CONFIGURATION || '',
  };
}

function isAzureAiSearchEnabled() {
  return String(process.env.VECTOR_STORE_PROVIDER || '').trim().toLowerCase() === 'azure_ai_search';
}

function requireConfig() {
  const config = getConfig();
  const missing = [];
  if (!config.endpoint) missing.push('AZURE_SEARCH_ENDPOINT');
  if (!config.apiKey) missing.push('AZURE_SEARCH_API_KEY');
  if (!config.indexName) missing.push('AZURE_SEARCH_INDEX_NAME');
  if (missing.length) {
    throw new Error(`Configuration Azure AI Search incomplète: ${missing.join(', ')}`);
  }
  return config;
}

function makeSearchDocumentId(documentId, chunkId) {
  const raw = `${documentId || 'document'}:${chunkId || 'chunk'}`;
  return `chunk-${Buffer.from(raw, 'utf8').toString('base64url')}`;
}

function buildIndexPayload(config, dimensions) {
  return {
    name: config.indexName,
    fields: [
      { name: 'id', type: 'Edm.String', key: true, filterable: true, retrievable: true },
      {
        name: 'document_id',
        type: 'Edm.String',
        searchable: true,
        filterable: true,
        retrievable: true,
      },
      { name: 'chunk_id', type: 'Edm.String', filterable: true, retrievable: true },
      { name: 'content', type: 'Edm.String', searchable: true, retrievable: true },
      {
        name: AZURE_VECTOR_FIELD,
        type: 'Collection(Edm.Single)',
        searchable: true,
        retrievable: false,
        stored: false,
        dimensions,
        vectorSearchProfile: AZURE_VECTOR_PROFILE,
      },
      {
        name: 'source',
        type: 'Edm.String',
        searchable: true,
        filterable: true,
        retrievable: true,
      },
      {
        name: 'page',
        type: 'Edm.Int32',
        filterable: true,
        sortable: true,
        retrievable: true,
      },
      { name: 'metadata_json', type: 'Edm.String', searchable: true, retrievable: true },
    ],
    vectorSearch: {
      algorithms: [
        {
          name: AZURE_VECTOR_ALGORITHM,
          kind: 'hnsw',
          hnswParameters: {
            m: 4,
            efConstruction: 400,
            efSearch: 500,
            metric: 'cosine',
          },
        },
      ],
      profiles: [{ name: AZURE_VECTOR_PROFILE, algorithm: AZURE_VECTOR_ALGORITHM }],
    },
  };
}

async function requestJson(config, method, path, body = null) {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${config.endpoint}${path}${separator}api-version=${encodeURIComponent(config.apiVersion)}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : {};

  if (!response.ok) {
    const message = payload?.error?.message || payload?.error?.code || raw || response.statusText;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

function indexPath(config) {
  return `/indexes/${encodeURIComponent(config.indexName)}`;
}

function docsIndexPath(config) {
  return `/indexes/${encodeURIComponent(config.indexName)}/docs/index`;
}

function docsSearchPath(config) {
  return `/indexes/${encodeURIComponent(config.indexName)}/docs/search`;
}

async function ensureIndex(dimensions) {
  const config = requireConfig();
  let existing = null;
  try {
    existing = await requestJson(config, 'GET', indexPath(config));
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  if (existing) {
    const vectorField = (existing.fields || []).find((field) => field.name === AZURE_VECTOR_FIELD);
    if (!vectorField) {
      throw new Error(`L'index Azure AI Search '${config.indexName}' existe sans champ ${AZURE_VECTOR_FIELD}.`);
    }
    if (Number(vectorField.dimensions) && Number(vectorField.dimensions) !== Number(dimensions)) {
      throw new Error(
        `Dimension embedding incompatible pour l'index '${config.indexName}': `
        + `${vectorField.dimensions} existant, ${dimensions} demandé.`,
      );
    }
    return { created: false, indexName: config.indexName };
  }

  await requestJson(config, 'PUT', indexPath(config), buildIndexPayload(config, dimensions));
  console.log(`[azure-ai-search] index créé: ${config.indexName} (${dimensions} dimensions)`);
  return { created: true, indexName: config.indexName };
}

function metadataForChunk(chunk) {
  const metadata = { ...chunk };
  delete metadata.text;
  delete metadata.clean_text;
  delete metadata.embedding;
  delete metadata.embedding_text;
  return metadata;
}

function documentFromChunk(chunk, embedding) {
  const documentId = chunk.document_id || chunk.doc_id;
  const content = chunk.clean_text || chunk.text || chunk.legal_summary || '';
  const source = chunk.referenced_source_file || chunk.source_file || chunk.source_document || '';
  const page = Number(chunk.page_start || chunk.page || 0) || 0;

  return {
    id: makeSearchDocumentId(documentId, chunk.chunk_id),
    document_id: documentId,
    chunk_id: chunk.chunk_id,
    content,
    content_vector: embedding.map((value) => Number(value) || 0),
    source,
    page,
    metadata_json: JSON.stringify(metadataForChunk(chunk)),
  };
}

async function upsertChunkEntries(entries) {
  const config = requireConfig();
  const firstEmbedding = entries.find((entry) => Array.isArray(entry.embedding))?.embedding;
  if (!firstEmbedding?.length) {
    throw new Error('Aucun embedding valide à indexer dans Azure AI Search.');
  }

  await ensureIndex(firstEmbedding.length);
  const documents = entries.map((entry) => documentFromChunk(entry.chunk, entry.embedding));
  let indexed = 0;

  for (let index = 0; index < documents.length; index += config.batchSize) {
    const batch = documents.slice(index, index + config.batchSize);
    const payload = {
      value: batch.map((document) => ({ '@search.action': 'mergeOrUpload', ...document })),
    };
    const response = await requestJson(config, 'POST', docsIndexPath(config), payload);
    const failures = (response.value || []).filter((item) => item.status === false);
    if (failures.length) {
      const first = failures[0];
      throw new Error(`Azure AI Search a refusé ${first.key || first.id}: ${first.errorMessage || 'erreur inconnue'}`);
    }
    indexed += batch.length;
    console.log(`[azure-ai-search] batch indexé: ${batch.length}`);
  }

  return {
    provider: 'azure_ai_search',
    indexName: config.indexName,
    indexed,
  };
}

function parseMetadata(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function chunkFromSearchDocument(document) {
  const metadata = parseMetadata(document.metadata_json);
  return {
    ...metadata,
    chunk_id: document.chunk_id,
    doc_id: document.document_id,
    document_id: document.document_id,
    source_file: document.source,
    referenced_source_file: document.source,
    page_start: document.page,
    page_end: metadata.page_end || document.page,
    clean_text: document.content,
    text: document.content,
  };
}

async function searchChunks({ queryText, queryEmbedding, topK = 4, hybrid = true }) {
  const config = requireConfig();
  const trimmedQuery = String(queryText || '').trim();
  const top = Math.max(1, Number(topK) || 4);
  const payload = {
    top,
    select: 'id,document_id,chunk_id,content,source,page,metadata_json',
  };

  if (Array.isArray(queryEmbedding) && queryEmbedding.length) {
    payload.vectorQueries = [
      {
        kind: 'vector',
        vector: queryEmbedding.map((value) => Number(value) || 0),
        fields: AZURE_VECTOR_FIELD,
        k: top,
      },
    ];
  }

  if (hybrid && trimmedQuery) {
    payload.search = trimmedQuery;
    payload.searchFields = 'content,source,metadata_json';
  } else if (!payload.vectorQueries) {
    payload.search = trimmedQuery || '*';
  }

  if (config.semanticRerankerEnabled && trimmedQuery) {
    if (!config.semanticConfiguration) {
      throw new Error('AZURE_SEARCH_ENABLE_SEMANTIC_RERANKER=true nécessite AZURE_SEARCH_SEMANTIC_CONFIGURATION.');
    }
    payload.queryType = 'semantic';
    payload.semanticConfiguration = config.semanticConfiguration;
    payload.captions = 'extractive';
  }

  const response = await requestJson(config, 'POST', docsSearchPath(config), payload);
  return (response.value || []).map((document) => ({
    chunk: chunkFromSearchDocument(document),
    lexicalScore: 0,
    vectorScore: document['@search.score'] || 0,
    rerankScore: document['@search.rerankerScore'] || document['@search.score'] || 0,
    searchScore: document['@search.score'] || 0,
    rerankerScore: document['@search.rerankerScore'] || null,
    captions: document['@search.captions'] || [],
    provider: 'azure_ai_search',
  }));
}

module.exports = {
  AZURE_VECTOR_FIELD,
  ensureIndex,
  getConfig,
  isAzureAiSearchEnabled,
  makeSearchDocumentId,
  searchChunks,
  upsertChunkEntries,
};
