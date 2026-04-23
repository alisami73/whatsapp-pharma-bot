'use strict';

/**
 * modules/supabase_kb.js
 *
 * Supabase pgvector client for the legal RAG pipeline.
 *
 * Responsibilities:
 *   - Hybrid search (vector cosine + FTS, RRF-fused in SQL)
 *   - Quality log inserts
 *   - Batch chunk upsert (used by embed_and_upload.js)
 *
 * Enabled when SUPABASE_URL + SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) are set.
 * Uses service key so it runs without RLS policies on server side.
 */

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

function isEnabled() {
  return Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY),
  );
}

/**
 * Count chunks that have embeddings — used to check if Supabase is populated.
 */
async function countChunks() {
  const client = getClient();
  if (!client) return 0;
  try {
    const { count, error } = await client
      .from('legal_chunks')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null);
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Hybrid vector + FTS search via the `hybrid_search` Supabase RPC function.
 *
 * Returns results in the same shape as legal_kb.js expects:
 *   { chunk, rerankScore, vectorRank, ftsRank, lexicalRank, fusedScore }
 */
async function searchChunks({ queryText, queryEmbedding, topK = 4 }) {
  const client = getClient();
  if (!client) throw new Error('[supabase-kb] Not configured');

  const { data, error } = await client.rpc('hybrid_search', {
    query_text: queryText,
    query_embedding: queryEmbedding,
    match_count: topK,
  });

  if (error) throw new Error(`[supabase-kb] hybrid_search failed: ${error.message}`);

  return (data || []).map((row) => ({
    chunk: {
      // Top-level fields first
      chunk_id: row.chunk_id,
      doc_id: row.doc_id,
      document_type: row.document_type,
      title: row.title,
      citation_label: row.citation_label,
      text: row.chunk_text,
      clean_text: row.chunk_text,
      // Merge all metadata fields (contains topic_tags, key_rules, sanctions, etc.)
      ...row.metadata,
      // Re-enforce top-level fields so they're not overridden by metadata
      chunk_id: row.chunk_id,
      doc_id: row.doc_id,
    },
    rerankScore: row.rrf_score,
    fusedScore: row.rrf_score,
    vectorRank: row.vector_rank,
    ftsRank: row.fts_rank,
    lexicalRank: row.fts_rank,
    vectorScore: null,
    lexicalScore: null,
  }));
}

/**
 * Fire-and-forget quality log insert.
 * Silently ignores errors — never blocks the main reply path.
 */
async function logQuality({
  phone, question, answer, contextIds,
  score, dims, retried, flagged, scope, lang,
}) {
  const client = getClient();
  if (!client) return;

  try {
    await client.from('rag_quality_logs').insert({
      phone: phone || null,
      question,
      answer,
      context_ids: contextIds || [],
      quality_score: score ?? null,
      quality_dims: dims || {},
      retried: Boolean(retried),
      flagged: Boolean(flagged),
      scope: scope || null,
      lang: lang || null,
    });
  } catch (err) {
    console.warn('[supabase-kb] Quality log failed (non-blocking):', err.message);
  }
}

/**
 * Batch upsert chunks into legal_chunks table.
 * Each row: { chunk_id, doc_id, document_type, title, citation_label,
 *             chunk_text, embedding_text, embedding, metadata }
 */
async function upsertChunks(rows) {
  const client = getClient();
  if (!client) throw new Error('[supabase-kb] Not configured');

  const { error } = await client
    .from('legal_chunks')
    .upsert(rows, { onConflict: 'chunk_id' });

  if (error) throw new Error(`[supabase-kb] upsert failed: ${error.message}`);
}

module.exports = {
  isEnabled,
  countChunks,
  searchChunks,
  logQuality,
  upsertChunks,
  getClient,
};
