#!/usr/bin/env node
'use strict';

/**
 * scripts/embed_and_upload.js
 *
 * Computes embeddings for all chunks in legal_hybrid_index.json
 * using Azure OpenAI text-embedding-3-small, then upserts them into Supabase.
 *
 * Usage:
 *   node scripts/embed_and_upload.js              # embed all, upload to Supabase
 *   node scripts/embed_and_upload.js --dry-run    # compute only, no upload
 *   node scripts/embed_and_upload.js --force      # re-embed even if already done
 *
 * Requires in .env:
 *   AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT,
 *   AZURE_OPENAI_API_VERSION, AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { AzureOpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

const HYBRID_INDEX_PATH = path.join(__dirname, '..', 'data', 'legal_kb', 'indexes', 'legal_hybrid_index.json');
const BATCH_SIZE = 20;        // texts per Azure OpenAI embeddings call
const UPLOAD_BATCH = 50;      // rows per Supabase upsert
const DELAY_MS = 300;         // ms between embedding batches (rate-limit safety)
const MAX_EMBEDDING_CHARS = 2400;

const isDryRun = process.argv.includes('--dry-run');
const isForce  = process.argv.includes('--force');

// ── Clients ───────────────────────────────────────────────────────────────────

function getEmbeddingClient() {
  const key      = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const version  = process.env.AZURE_OPENAI_API_VERSION || '2024-02-01';
  const deploy   = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small';

  if (!key || !endpoint) {
    throw new Error('Missing AZURE_OPENAI_API_KEY or AZURE_OPENAI_ENDPOINT in .env');
  }

  return {
    client: new AzureOpenAI({ apiKey: key, endpoint, apiVersion: version }),
    model: deploy,
  };
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildChunkRow(entry) {
  const chunk = entry.chunk || {};
  return {
    chunk_id:       chunk.chunk_id,
    doc_id:         chunk.doc_id || null,
    document_type:  chunk.document_type || null,
    title:          chunk.title || chunk.official_title || chunk.short_title || null,
    citation_label: chunk.citation_label || null,
    chunk_text:     chunk.clean_text || chunk.text || null,
    embedding_text: (entry.embedding_text || '').slice(0, MAX_EMBEDDING_CHARS) || null,
    metadata:       chunk,
    updated_at:     new Date().toISOString(),
  };
}

// ── Existing Supabase chunk IDs ───────────────────────────────────────────────

async function fetchExistingChunkIds(supabase) {
  const ids = new Set();
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('legal_chunks')
      .select('chunk_id')
      .not('embedding', 'is', null)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
    if (!data || !data.length) break;

    data.forEach((r) => ids.add(r.chunk_id));
    if (data.length < pageSize) break;
    page++;
  }

  return ids;
}

// ── Batch embed ───────────────────────────────────────────────────────────────

async function embedBatch(texts, embClient) {
  const response = await embClient.client.embeddings.create({
    model: embClient.model,
    input: texts,
  });
  // response.data is ordered by index
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

// ── Upload batch to Supabase ──────────────────────────────────────────────────

async function uploadBatch(rows, supabase) {
  const { error } = await supabase
    .from('legal_chunks')
    .upsert(rows, { onConflict: 'chunk_id' });

  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('─────────────────────────────────────────────────────');
  console.log('embed_and_upload.js — RAG embedding pipeline');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no upload)' : 'LIVE'} | Force re-embed: ${isForce}`);
  console.log('─────────────────────────────────────────────────────\n');

  // Load index
  console.log(`Loading ${HYBRID_INDEX_PATH} …`);
  const raw = fs.readFileSync(HYBRID_INDEX_PATH, 'utf8');
  const hybridIndex = JSON.parse(raw);
  const allEntries = hybridIndex.chunks || [];
  console.log(`Total chunks in index: ${allEntries.length}\n`);

  if (!allEntries.length) {
    console.error('No chunks found. Exiting.');
    process.exit(1);
  }

  // Validate all entries have chunk_id
  const invalid = allEntries.filter((e) => !e.chunk?.chunk_id);
  if (invalid.length) {
    console.warn(`Warning: ${invalid.length} entries have no chunk_id — skipping them.`);
  }
  const entries = allEntries.filter((e) => e.chunk?.chunk_id);

  // Init clients
  const embClient = getEmbeddingClient();
  console.log(`Azure OpenAI embedding deployment: ${embClient.model}`);

  let supabase = null;
  let existingIds = new Set();

  if (!isDryRun) {
    supabase = getSupabaseClient();
    console.log('Checking existing Supabase embeddings …');
    existingIds = await fetchExistingChunkIds(supabase);
    console.log(`Already in Supabase: ${existingIds.size} chunks with embeddings\n`);
  }

  // Determine which entries need embedding
  const toEmbed = isForce
    ? entries
    : entries.filter((e) => !existingIds.has(e.chunk.chunk_id));

  console.log(`Chunks to embed: ${toEmbed.length}/${entries.length}`);
  if (!toEmbed.length) {
    console.log('\nAll chunks already embedded. Nothing to do.');
    return;
  }

  // Process in batches
  const uploadQueue = [];
  let embeddedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    const texts = batch.map((e) =>
      (e.embedding_text || e.chunk?.clean_text || e.chunk?.text || '').slice(0, MAX_EMBEDDING_CHARS),
    );

    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toEmbed.length / BATCH_SIZE);
    process.stdout.write(`Batch ${batchNum}/${totalBatches} (${batch.length} texts) … `);

    try {
      const embeddings = await embedBatch(texts, embClient);

      batch.forEach((entry, idx) => {
        const row = buildChunkRow(entry);
        row.embedding = embeddings[idx];
        uploadQueue.push(row);
      });

      embeddedCount += batch.length;
      console.log(`OK (${embeddedCount}/${toEmbed.length} total)`);
    } catch (err) {
      errorCount += batch.length;
      console.log(`FAILED: ${err.message}`);
    }

    // Upload when queue is large enough or at the end
    if (!isDryRun && (uploadQueue.length >= UPLOAD_BATCH || i + BATCH_SIZE >= toEmbed.length)) {
      while (uploadQueue.length > 0) {
        const chunk = uploadQueue.splice(0, UPLOAD_BATCH);
        try {
          await uploadBatch(chunk, supabase);
          process.stdout.write(`  ↳ Uploaded ${chunk.length} rows to Supabase\n`);
        } catch (uploadErr) {
          console.error(`  ↳ Upload FAILED: ${uploadErr.message}`);
          errorCount += chunk.length;
        }
      }
    }

    // Rate-limit safety
    if (i + BATCH_SIZE < toEmbed.length) {
      await sleep(DELAY_MS);
    }
  }

  // Summary
  console.log('\n─────────────────────────────────────────────────────');
  console.log(`Done.`);
  console.log(`  Embedded:  ${embeddedCount}`);
  console.log(`  Errors:    ${errorCount}`);
  if (!isDryRun) {
    const finalCount = await fetchExistingChunkIds(supabase).then((s) => s.size).catch(() => '?');
    console.log(`  Supabase total with embeddings: ${finalCount}`);
  }
  console.log('─────────────────────────────────────────────────────\n');

  if (errorCount > 0) {
    console.warn(`Warning: ${errorCount} chunks failed. Re-run the script to retry.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
