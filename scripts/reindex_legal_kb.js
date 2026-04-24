#!/usr/bin/env node

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const azureAiSearch = require('../modules/azure_ai_search');
const legalKb = require('../modules/legal_kb');

const ROOT = path.join(__dirname, '..');
const LEGAL_KB_DIR = path.join(ROOT, 'data', 'legal_kb');
const LEGAL_CHUNKS_DIR = path.join(LEGAL_KB_DIR, 'chunks');
const LEGAL_INDEXES_DIR = path.join(LEGAL_KB_DIR, 'indexes');
const LEGAL_BACKUPS_DIR = path.join(ROOT, 'data', 'legal_kb_backups');
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build_legal_kb.py');

function parseArgs(argv) {
  const noAzureSearch = argv.includes('--no-azure-search');
  const pushAzureSearch = !noAzureSearch && (
    argv.includes('--azure-search')
    || String(process.env.VECTOR_STORE_PROVIDER || '').trim().toLowerCase() === 'azure_ai_search'
  );

  return {
    dryRun: argv.includes('--dry-run'),
    skipEmbeddings: argv.includes('--skip-embeddings'),
    skipBuild: argv.includes('--skip-build'),
    noBackup: argv.includes('--no-backup'),
    pushAzureSearch,
  };
}

function detectEmbeddingRuntime() {
  if (
    process.env.AZURE_OPENAI_API_KEY &&
    process.env.AZURE_OPENAI_ENDPOINT &&
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT
  ) {
    return {
      provider: 'azure',
      model: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    };
  }

  if (process.env.OPENAI_API_KEY && process.env.OPENAI_EMBEDDING_MODEL) {
    return {
      provider: 'openai',
      model: process.env.OPENAI_EMBEDDING_MODEL,
    };
  }

  return {
    provider: 'none',
    model: null,
  };
}

function listChunkFiles() {
  if (!fs.existsSync(LEGAL_CHUNKS_DIR)) {
    return [];
  }

  return fs.readdirSync(LEGAL_CHUNKS_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort();
}

function loadChunks() {
  const files = listChunkFiles();
  const chunks = [];

  files.forEach((file) => {
    const payload = JSON.parse(fs.readFileSync(path.join(LEGAL_CHUNKS_DIR, file), 'utf8'));
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.chunks)
      ? payload.chunks
      : [];

    list.forEach((chunk) => chunks.push(chunk));
  });

  return chunks;
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function createBackupIfNeeded(options) {
  if (options.dryRun || options.noBackup || !fs.existsSync(LEGAL_KB_DIR)) {
    return null;
  }

  ensureDir(LEGAL_BACKUPS_DIR);
  const backupDir = path.join(LEGAL_BACKUPS_DIR, `legal_kb_${timestampSlug()}`);
  fs.cpSync(LEGAL_KB_DIR, backupDir, { recursive: true });
  return backupDir;
}

function runBuildStep(options) {
  if (options.skipBuild) {
    return { skipped: true, status: 0 };
  }

  const args = [BUILD_SCRIPT, '--prefer-existing-raw'];
  if (options.dryRun) {
    args.push('--dry-run');
  }

  const result = spawnSync('python3', args, {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'build_legal_kb.py failed');
  }

  return {
    skipped: false,
    status: result.status,
    stdout: result.stdout,
  };
}

async function maybeEmbedChunks(chunks, options) {
  const runtime = detectEmbeddingRuntime();
  const embeddingsEnabled = !options.skipEmbeddings && runtime.provider !== 'none';
  const entries = [];

  for (const chunk of chunks) {
    const embeddingText = legalKb.buildEmbeddingText(chunk);
    let embedding = null;

    if (embeddingsEnabled) {
      try {
        embedding = await legalKb.embedText(embeddingText);
      } catch (error) {
        throw new Error(`Embedding failed for ${chunk.chunk_id}: ${error.message}`);
      }
    }

    entries.push({
      chunk,
      embedding_text: embeddingText,
      embedding,
    });
  }

  return {
    runtime,
    embeddingsEnabled,
    entries,
  };
}

function buildReport(chunks, embeddingState, backupDir, buildResult, options) {
  return {
    schema_version: 1,
    created_at: new Date().toISOString(),
    dry_run: options.dryRun,
    backup_dir: backupDir,
    build: buildResult,
    embedding_provider: embeddingState.runtime.provider,
    embedding_model: embeddingState.runtime.model,
    embeddings_enabled: embeddingState.embeddingsEnabled,
    azure_ai_search_enabled: options.pushAzureSearch,
    chunk_count: chunks.length,
    document_count: new Set(chunks.map((chunk) => chunk.doc_id)).size,
  };
}

async function maybePushAzureAiSearch(embeddingState, options) {
  if (!options.pushAzureSearch || options.dryRun) {
    return { skipped: true };
  }
  if (!embeddingState.embeddingsEnabled) {
    throw new Error('Azure AI Search nécessite des embeddings recalculés. Retirez --skip-embeddings et configurez Azure OpenAI.');
  }

  const entries = embeddingState.entries.filter((entry) => Array.isArray(entry.embedding) && entry.embedding.length);
  if (!entries.length) {
    throw new Error('Aucun chunk avec embedding valide à pousser vers Azure AI Search.');
  }

  return await azureAiSearch.upsertChunkEntries(entries);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const backupDir = createBackupIfNeeded(options);
  const buildResult = runBuildStep(options);

  const chunks = loadChunks();
  const embeddingState = await maybeEmbedChunks(chunks, options);
  const report = buildReport(chunks, embeddingState, backupDir, buildResult, options);

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  ensureDir(LEGAL_INDEXES_DIR);

  const hybridIndex = {
    schema_version: 2,
    created_at: new Date().toISOString(),
    embedding_provider: embeddingState.runtime.provider,
    embedding_model: embeddingState.runtime.model,
    chunks: embeddingState.entries,
  };

  fs.writeFileSync(
    path.join(LEGAL_INDEXES_DIR, 'legal_hybrid_index.json'),
    JSON.stringify(hybridIndex, null, 2),
    'utf8',
  );

  const azureSearchResult = await maybePushAzureAiSearch(embeddingState, options);
  report.azure_ai_search = azureSearchResult;

  fs.writeFileSync(
    path.join(LEGAL_INDEXES_DIR, 'reindex_report.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );

  legalKb.invalidateCaches();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  console.error('[reindex_legal_kb]', error.message || error);
  process.exit(1);
});
