'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const REPO_DATA_DIR = path.join(ROOT_DIR, 'data');

function uniquePaths(values) {
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

function getRepoDataDir() {
  return REPO_DATA_DIR;
}

function getPreferredDataDir() {
  return String(process.env.DATA_DIR || '').trim() || REPO_DATA_DIR;
}

function toPreferredPath(...segments) {
  return path.join(getPreferredDataDir(), ...segments);
}

function buildCandidateDirs(explicitEnvName, relativeSegments) {
  const explicit = String(process.env[explicitEnvName] || '').trim();
  const preferred = toPreferredPath(...relativeSegments);
  const repo = path.join(REPO_DATA_DIR, ...relativeSegments);
  return uniquePaths([explicit, preferred, repo]);
}

function getKnowledgeDirCandidates() {
  return buildCandidateDirs('KNOWLEDGE_DIR', ['knowledge']);
}

function getLegalChunksDirCandidates() {
  return buildCandidateDirs('LEGAL_CHUNKS_DIR', ['legal_kb', 'chunks']);
}

function getLegalIndexesDirCandidates() {
  return buildCandidateDirs('LEGAL_INDEXES_DIR', ['legal_kb', 'indexes']);
}

function getPromptDirCandidates() {
  return buildCandidateDirs('PROMPTS_DIR', ['prompts']);
}

function resolveExistingDir(candidates) {
  return (candidates || []).find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  }) || null;
}

function resolveExistingFile(candidates) {
  return (candidates || []).find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) || null;
}

function getPreferredKnowledgeDir() {
  return toPreferredPath('knowledge');
}

function getPreferredLegalChunksDir() {
  return toPreferredPath('legal_kb', 'chunks');
}

function getPreferredLegalIndexesDir() {
  return toPreferredPath('legal_kb', 'indexes');
}

function getPreferredPromptDir() {
  return toPreferredPath('prompts');
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function ensurePreferredKnowledgeDir() {
  return ensureDir(getPreferredKnowledgeDir());
}

function ensurePreferredLegalChunksDir() {
  return ensureDir(getPreferredLegalChunksDir());
}

function ensurePreferredLegalIndexesDir() {
  return ensureDir(getPreferredLegalIndexesDir());
}

function ensurePreferredPromptDir() {
  return ensureDir(getPreferredPromptDir());
}

function getLegalHybridIndexPathCandidates() {
  const explicit = String(process.env.LEGAL_HYBRID_INDEX_PATH || '').trim();
  return uniquePaths([
    explicit,
    path.join(getPreferredLegalIndexesDir(), 'legal_hybrid_index.json'),
    path.join(REPO_DATA_DIR, 'legal_kb', 'indexes', 'legal_hybrid_index.json'),
  ]);
}

function getLegalPromptPathCandidates() {
  const explicit = String(process.env.LEGAL_PROMPT_PATH || '').trim();
  return uniquePaths([
    explicit,
    path.join(getPreferredPromptDir(), 'legal_rag_system_prompt.md'),
    path.join(REPO_DATA_DIR, 'prompts', 'legal_rag_system_prompt.md'),
  ]);
}

module.exports = {
  ROOT_DIR,
  getRepoDataDir,
  getPreferredDataDir,
  getKnowledgeDirCandidates,
  getLegalChunksDirCandidates,
  getLegalIndexesDirCandidates,
  getPromptDirCandidates,
  getPreferredKnowledgeDir,
  getPreferredLegalChunksDir,
  getPreferredLegalIndexesDir,
  getPreferredPromptDir,
  ensurePreferredKnowledgeDir,
  ensurePreferredLegalChunksDir,
  ensurePreferredLegalIndexesDir,
  ensurePreferredPromptDir,
  getLegalHybridIndexPathCandidates,
  getLegalPromptPathCandidates,
  resolveExistingDir,
  resolveExistingFile,
};
