#!/usr/bin/env node

'use strict';

require('dotenv').config();

const legalKb = require('../modules/legal_kb');

function parseArgs(argv) {
  const topKIndex = argv.indexOf('--top-k');
  const topK = topKIndex >= 0 ? Number(argv[topKIndex + 1]) : Number(process.env.TOP_K) || 4;
  const hybrid = argv.includes('--vector-only') ? false : !argv.includes('--no-hybrid');
  const queryParts = argv.filter((arg, index) => {
    if (arg === '--top-k' || index === topKIndex + 1) return false;
    return !arg.startsWith('--');
  });

  return {
    query: queryParts.join(' ').trim() || "Quelles sont les obligations d'une officine lors d'une inspection ?",
    topK: Math.max(1, topK),
    hybrid,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const provider = String(process.env.VECTOR_STORE_PROVIDER || 'json').trim().toLowerCase();
  const retrieval = await legalKb.retrieveLegalResults(options.query, {
    scope: 'regulations',
    topK: options.topK,
    hybrid: options.hybrid,
  });

  const results = retrieval.results.map((entry, index) => ({
    rank: index + 1,
    chunk_id: entry.chunk.chunk_id,
    document_id: entry.chunk.document_id || entry.chunk.doc_id,
    score: entry.rerankScore || entry.searchScore || entry.vectorScore || null,
    source: legalKb.buildCitationLabel(entry.chunk),
    excerpt: String(entry.chunk.legal_summary || entry.chunk.clean_text || entry.chunk.text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 280),
  }));

  process.stdout.write(`${JSON.stringify({
    ok: results.length > 0,
    provider,
    query: options.query,
    top_k: options.topK,
    hybrid: options.hybrid,
    used_vector: retrieval.usedVector,
    result_count: results.length,
    results,
  }, null, 2)}\n`);

  if (!results.length) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error('[search_smoke_test]', error.message || error);
  process.exit(1);
});
