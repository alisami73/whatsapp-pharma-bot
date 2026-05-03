'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const supabaseStore = require('./supabase_store');
const runtimePaths = require('./runtime_paths');

const fsp = fs.promises;

const MANIFEST_KEY = 'admin_kb_manifest';
const MANIFEST_FILE = path.join(runtimePaths.getPreferredDataDir(), 'admin_kb_manifest.json');
const MAX_JOBS = 20;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const FAQ_FILE_NAMES = {
  fse: 'fse_admin_faq.md',
  conformites: 'conformites_admin_faq.md',
};
const ADMIN_CHUNK_PREFIX = 'admin_upload__';
const WRITE_QUEUES = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeThemeId(themeId) {
  const value = String(themeId || '').trim().toLowerCase();
  if (!['fse', 'conformites'].includes(value)) {
    throw new Error('Theme unsupported');
  }
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getDefaultManifest() {
  return {
    schema_version: 1,
    updated_at: nowIso(),
    faq_entries: {
      fse: [],
      conformites: [],
    },
    documents: {
      fse: [],
      conformites: [],
    },
    jobs: [],
  };
}

async function ensureManifestFile() {
  await fsp.mkdir(path.dirname(MANIFEST_FILE), { recursive: true });
  try {
    await fsp.access(MANIFEST_FILE, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(MANIFEST_FILE, JSON.stringify(getDefaultManifest(), null, 2), 'utf8');
  }
}

function queueFileWrite(filePath, payload) {
  const previous = WRITE_QUEUES.get(filePath) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp`;
      await fsp.writeFile(tmpPath, payload, 'utf8');
      await fsp.rename(tmpPath, filePath);
    });
  WRITE_QUEUES.set(filePath, next);
  return next;
}

function normalizeFaqEntry(entry) {
  const keywords = Array.isArray(entry.keywords)
    ? entry.keywords.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  return {
    id: String(entry.id || '').trim(),
    title: String(entry.title || '').trim(),
    question: String(entry.question || entry.title || '').trim(),
    answer: String(entry.answer || '').trim(),
    keywords,
    created_at: entry.created_at || nowIso(),
    updated_at: entry.updated_at || nowIso(),
  };
}

function normalizeSourcePages(sourcePages) {
  if (!Array.isArray(sourcePages)) {
    return [];
  }
  return sourcePages
    .map((page, index) => ({
      page_number: Number(page.page_number) || index + 1,
      text: String(page.text || '').trim(),
    }))
    .filter((page) => page.text);
}

function normalizeDocument(document) {
  const content = String(document.content || '').trim();
  return {
    id: String(document.id || '').trim(),
    title: String(document.title || '').trim(),
    description: String(document.description || '').trim(),
    file_name: String(document.file_name || '').trim(),
    file_ext: String(document.file_ext || '').trim().toLowerCase(),
    mime_type: String(document.mime_type || '').trim(),
    target: document.target === 'legal_kb' ? 'legal_kb' : 'faq',
    content,
    source_pages: normalizeSourcePages(document.source_pages),
    extraction_method: String(document.extraction_method || 'text_upload').trim(),
    manual_review_required: Boolean(document.manual_review_required),
    low_ocr_supported: Boolean(document.low_ocr_supported),
    keywords: Array.isArray(document.keywords)
      ? document.keywords.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    created_at: document.created_at || nowIso(),
    updated_at: document.updated_at || nowIso(),
  };
}

function normalizeJob(job) {
  return {
    id: String(job.id || '').trim(),
    theme_id: String(job.theme_id || '').trim(),
    type: String(job.type || '').trim(),
    status: String(job.status || '').trim(),
    summary: String(job.summary || '').trim(),
    details: job.details && typeof job.details === 'object' ? job.details : {},
    created_at: job.created_at || nowIso(),
  };
}

function normalizeManifest(manifest) {
  const next = getDefaultManifest();
  const faqEntries = manifest?.faq_entries || {};
  const documents = manifest?.documents || {};
  next.schema_version = Number(manifest?.schema_version) || 1;
  next.updated_at = manifest?.updated_at || nowIso();
  next.faq_entries.fse = Array.isArray(faqEntries.fse) ? faqEntries.fse.map(normalizeFaqEntry) : [];
  next.faq_entries.conformites = Array.isArray(faqEntries.conformites)
    ? faqEntries.conformites.map(normalizeFaqEntry)
    : [];
  next.documents.fse = Array.isArray(documents.fse) ? documents.fse.map(normalizeDocument) : [];
  next.documents.conformites = Array.isArray(documents.conformites)
    ? documents.conformites.map(normalizeDocument)
    : [];
  next.jobs = Array.isArray(manifest?.jobs) ? manifest.jobs.map(normalizeJob).slice(0, MAX_JOBS) : [];
  return next;
}

async function readManifest() {
  if (supabaseStore.isEnabled()) {
    const value = await supabaseStore.read(MANIFEST_KEY);
    if (value && typeof value === 'object') {
      return normalizeManifest(value);
    }
  }

  await ensureManifestFile();
  try {
    const raw = await fsp.readFile(MANIFEST_FILE, 'utf8');
    return normalizeManifest(JSON.parse(raw));
  } catch {
    return getDefaultManifest();
  }
}

async function writeManifest(manifest) {
  const normalized = normalizeManifest({
    ...manifest,
    updated_at: nowIso(),
  });

  if (supabaseStore.isEnabled()) {
    await supabaseStore.write(MANIFEST_KEY, normalized);
  }

  await ensureManifestFile();
  await queueFileWrite(MANIFEST_FILE, JSON.stringify(normalized, null, 2));
  return clone(normalized);
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  return (values || [])
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

function renderFaqEntry(entry) {
  const keywords = entry.keywords.length ? `Mots-clés : ${entry.keywords.join(', ')}\n\n` : '';
  const title = entry.question || entry.title || 'Question';
  return [
    `### ${title}`,
    '',
    keywords ? keywords.trimEnd() : null,
    entry.answer,
  ].filter(Boolean).join('\n');
}

function renderFaqDocument(document) {
  return [
    `### ${document.title || document.file_name || 'Document ajouté via admin'}`,
    '',
    document.content,
  ].filter(Boolean).join('\n');
}

function buildFaqMarkdown(themeId, manifest) {
  const entries = manifest.faq_entries[themeId] || [];
  const documents = (manifest.documents[themeId] || []).filter((entry) => entry.target === 'faq');
  const blocks = [
    `# KB admin — ${themeId.toUpperCase()}`,
    '',
    `Mis à jour automatiquement depuis l'admin.`,
    '',
    ...entries.map(renderFaqEntry),
    ...documents.map(renderFaqDocument),
  ].filter(Boolean);

  if (blocks.length <= 2) {
    return '';
  }

  return blocks.join('\n\n').trim() + '\n';
}

function deleteIfExists(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }
}

async function materializeFaqFiles(manifest) {
  const knowledgeDir = runtimePaths.ensurePreferredKnowledgeDir();

  Object.entries(FAQ_FILE_NAMES).forEach(([themeId, fileName]) => {
    const payload = buildFaqMarkdown(themeId, manifest);
    const targetPath = path.join(knowledgeDir, fileName);
    if (!payload) {
      deleteIfExists(targetPath);
      return;
    }
    fs.writeFileSync(targetPath, payload, 'utf8');
  });
}

function detectLanguage(text) {
  if (/[\u0600-\u06FF]/.test(text)) {
    return 'ar';
  }
  if (/[¿¡ñÑ]/.test(text) || /\b(cómo|cuál|farmacia|gracias)\b/i.test(text)) {
    return 'es';
  }
  if (/[\u0400-\u04FF]/.test(text)) {
    return 'ru';
  }
  return 'fr';
}

function detectLegalDocumentType(label) {
  const value = String(label || '').toLowerCase();
  if (/\bloi\b/.test(value)) return 'loi';
  if (/dahir/.test(value)) return 'dahir';
  if (/decret|décret/.test(value)) return 'decret';
  if (/arrete|arrêté/.test(value)) return 'arrete';
  if (/circulaire/.test(value)) return 'circulaire';
  if (/guide|inspection|faq|procedure|procédure/.test(value)) return 'guide_pratique';
  return 'autre';
}

const LEGAL_TOPIC_RULES = [
  { pattern: /cndp|donnees personnelles|données personnelles|videosurveillance|video surveillance/i, topics: ['cndp', 'protection des données', 'officine'] },
  { pattern: /inspection|controle|contrôle|inspecteur/i, topics: ['inspection', 'contrôle', 'officine'] },
  { pattern: /stupefiant|stupéfiant|ordonnancier|registre/i, topics: ['stupefiants', 'registre', 'officine'] },
  { pattern: /ouverture|officine|local/i, topics: ['officine', 'ouverture d\'officine'] },
  { pattern: /cnss|amo|tiers payant|remboursement/i, topics: ['cnss', 'amo', 'tiers payant'] },
  { pattern: /employe|employé|salaire|licenciement|cnss social|travail/i, topics: ['droit du travail', 'cnss', 'pharmacie'] },
  { pattern: /ordre des pharmaciens|cnop|autorisation/i, topics: ['ordre des pharmaciens', 'autorisation d\'exercice'] },
];

function inferLegalTopics(text, fallbackKeywords) {
  const combined = `${text}\n${(fallbackKeywords || []).join(' ')}`;
  const topics = [];
  LEGAL_TOPIC_RULES.forEach((rule) => {
    if (rule.pattern.test(combined)) {
      rule.topics.forEach((topic) => {
        if (!topics.includes(topic)) {
          topics.push(topic);
        }
      });
    }
  });
  if (!topics.length) {
    topics.push('pharmacie');
  }
  return topics;
}

function extractKeywordCandidates(text) {
  const blacklist = new Set([
    'avec', 'dans', 'pour', 'mais', 'plus', 'tous', 'toutes', 'cette', 'cette', 'cela', 'comme',
    'vous', 'nous', 'leur', 'leurs', 'etre', 'sont', 'fait', 'faites', 'dans', 'sans', 'bien',
    'pharmacie', 'pharmacien', 'question', 'reponse', 'réponse', 'document', 'admin',
  ]);

  const counts = new Map();
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 3 && !blacklist.has(token))
    .forEach((token) => {
      counts.set(token, (counts.get(token) || 0) + 1);
    });

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([token]) => token);
}

function splitIntoParagraphs(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildChunkSummary(text) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  return compact.slice(0, 280);
}

function buildKeyRules(text) {
  const rules = [];
  String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter((line) => line.length > 20)
    .forEach((line) => {
      if (rules.length < 3 && !rules.includes(line)) {
        rules.push(line);
      }
    });
  return rules;
}

function chunkParagraphs(paragraphs, maxChars = 1100) {
  const chunks = [];
  let current = [];
  let currentLength = 0;

  paragraphs.forEach((paragraph) => {
    const nextLength = currentLength ? currentLength + 2 + paragraph.length : paragraph.length;
    if (current.length && nextLength > maxChars) {
      chunks.push(current.join('\n\n'));
      current = [paragraph];
      currentLength = paragraph.length;
      return;
    }
    current.push(paragraph);
    currentLength = nextLength;
  });

  if (current.length) {
    chunks.push(current.join('\n\n'));
  }

  return chunks;
}

function chunkDocumentPages(document) {
  const sourcePages = normalizeSourcePages(document.source_pages);
  if (sourcePages.length) {
    return sourcePages.flatMap((page) => {
      const paragraphs = splitIntoParagraphs(page.text);
      return chunkParagraphs(paragraphs.length ? paragraphs : [page.text]).map((content, index) => ({
        content,
        page_start: page.page_number,
        page_end: page.page_number,
        section_label: `Page ${page.page_number}${index > 0 ? `.${index + 1}` : ''}`,
      }));
    });
  }

  const paragraphs = splitIntoParagraphs(document.content);
  return chunkParagraphs(paragraphs.length ? paragraphs : [document.content]).map((content, index) => ({
    content,
    page_start: 1,
    page_end: 1,
    section_label: `Section ${index + 1}`,
  }));
}

function buildLegalChunksForDocument(document) {
  const title = document.title || document.file_name || 'Document conformité';
  const language = detectLanguage(document.content);
  const combinedLabel = `${title}\n${document.file_name}\n${document.content.slice(0, 2000)}`;
  const documentType = detectLegalDocumentType(combinedLabel);
  const keywords = uniqueNonEmpty([
    ...document.keywords,
    ...extractKeywordCandidates(`${title}\n${document.content}`),
  ]);
  const topics = inferLegalTopics(`${title}\n${document.content}`, keywords);
  const sections = chunkDocumentPages(document);
  const baseConfidence = document.extraction_method === 'azure_document_intelligence'
    ? 'high'
    : document.manual_review_required
    ? 'low'
    : 'medium';

  return sections.map((section, index) => {
    const sectionTitle = section.section_label || `Section ${index + 1}`;
    const summary = buildChunkSummary(section.content);
    return {
      metadata_schema_version: 2,
      chunk_id: `${document.id}__${String(index + 1).padStart(3, '0')}`,
      doc_id: document.id,
      source_document_kind: 'admin_upload',
      source_file: document.file_name,
      title,
      official_title: title,
      short_title: title,
      document_type: documentType,
      legal_domain: 'conformite pharmaceutique',
      language,
      section_path: sectionTitle,
      structure_path: sectionTitle,
      page_start: section.page_start,
      page_end: section.page_end,
      citation_label: `${title} — ${sectionTitle} — p. ${section.page_start}${section.page_end !== section.page_start ? `-${section.page_end}` : ''}`,
      topics,
      topic_tags: topics,
      retrieval_keywords: keywords,
      keywords,
      legal_summary: summary,
      clean_text: section.content,
      text: section.content,
      key_rules: buildKeyRules(section.content),
      user_questions: [],
      confidence: baseConfidence,
      manual_review_required: Boolean(document.manual_review_required),
      ocr_quality: document.extraction_method === 'azure_document_intelligence' ? 'high' : 'not_applicable',
      updated_at: document.updated_at,
    };
  });
}

async function materializeLegalChunks(manifest) {
  const chunksDir = runtimePaths.ensurePreferredLegalChunksDir();
  const documents = (manifest.documents.conformites || []).filter((entry) => entry.target === 'legal_kb');
  const activeFiles = new Set();

  documents.forEach((document) => {
    const fileName = `${ADMIN_CHUNK_PREFIX}${document.id}.chunks.json`;
    const chunks = buildLegalChunksForDocument(document);
    fs.writeFileSync(path.join(chunksDir, fileName), JSON.stringify({ chunks }, null, 2), 'utf8');
    activeFiles.add(fileName);
  });

  fs.readdirSync(chunksDir)
    .filter((file) => file.startsWith(ADMIN_CHUNK_PREFIX) && file.endsWith('.chunks.json'))
    .forEach((file) => {
      if (!activeFiles.has(file)) {
        deleteIfExists(path.join(chunksDir, file));
      }
    });
}

async function ensureMaterializedAssets() {
  const manifest = await readManifest();
  await materializeFaqFiles(manifest);
  await materializeLegalChunks(manifest);
  return manifest;
}

function listFaqEntries(manifest, themeId) {
  return clone(manifest.faq_entries[themeId] || []);
}

function listDocuments(manifest, themeId) {
  return clone(manifest.documents[themeId] || []);
}

function getRuntimeStatus() {
  const embeddingDeployment = String(
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || process.env.OPENAI_EMBEDDING_MODEL || '',
  ).trim();
  const azureOcrEnabled = Boolean(
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
  );

  return {
    preferred_data_dir: runtimePaths.getPreferredDataDir(),
    knowledge_dirs: runtimePaths.getKnowledgeDirCandidates(),
    legal_chunks_dirs: runtimePaths.getLegalChunksDirCandidates(),
    embedding: {
      active: Boolean(embeddingDeployment),
      deployment: embeddingDeployment || null,
      is_small_embedding: embeddingDeployment === 'text-embedding-3-small',
    },
    low_ocr: {
      active: azureOcrEnabled,
      provider: azureOcrEnabled ? 'azure_document_intelligence' : null,
      model: process.env.AZURE_DOCUMENT_MODEL || 'prebuilt-layout',
      fallback_model: process.env.AZURE_DOCUMENT_FALLBACK_MODEL || 'prebuilt-read',
    },
  };
}

function buildOverview(themeId, manifest) {
  return {
    theme_id: themeId,
    runtime: getRuntimeStatus(),
    faq_entries: listFaqEntries(manifest, themeId),
    documents: listDocuments(manifest, themeId),
    jobs: clone((manifest.jobs || []).filter((job) => !job.theme_id || job.theme_id === themeId).slice(0, MAX_JOBS)),
  };
}

function validateFaqPayload(payload) {
  const question = String(payload.question || payload.title || '').trim();
  const answer = String(payload.answer || '').trim();
  const title = String(payload.title || question).trim();
  const keywords = Array.isArray(payload.keywords)
    ? payload.keywords.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  if (!title) {
    throw new Error('Title is required');
  }
  if (!question) {
    throw new Error('Question is required');
  }
  if (!answer) {
    throw new Error('Answer is required');
  }

  return { title, question, answer, keywords };
}

async function upsertFaqEntry(themeId, payload, entryId = null) {
  const normalizedThemeId = normalizeThemeId(themeId);
  const manifest = await readManifest();
  const nextPayload = validateFaqPayload(payload);
  const entries = manifest.faq_entries[normalizedThemeId] || [];
  const existingIndex = entryId ? entries.findIndex((entry) => entry.id === entryId) : -1;
  const baseId = slugify(nextPayload.question || nextPayload.title) || `faq-${Date.now()}`;
  const id = existingIndex >= 0 ? entries[existingIndex].id : `${normalizedThemeId}-${baseId}`;
  const timestamps = existingIndex >= 0 ? entries[existingIndex] : { created_at: nowIso() };

  const nextEntry = normalizeFaqEntry({
    ...timestamps,
    ...nextPayload,
    id,
    updated_at: nowIso(),
  });

  if (existingIndex >= 0) {
    entries[existingIndex] = nextEntry;
  } else {
    entries.unshift(nextEntry);
  }

  manifest.faq_entries[normalizedThemeId] = entries;
  await writeManifest(manifest);
  await materializeFaqFiles(manifest);
  return nextEntry;
}

async function deleteFaqEntry(themeId, entryId) {
  const normalizedThemeId = normalizeThemeId(themeId);
  const manifest = await readManifest();
  const entries = manifest.faq_entries[normalizedThemeId] || [];
  const nextEntries = entries.filter((entry) => entry.id !== entryId);
  if (nextEntries.length === entries.length) {
    return false;
  }
  manifest.faq_entries[normalizedThemeId] = nextEntries;
  await writeManifest(manifest);
  await materializeFaqFiles(manifest);
  return true;
}

function validateUploadPayload(payload) {
  const fileName = String(payload.file_name || payload.fileName || '').trim();
  const mimeType = String(payload.mime_type || payload.mimeType || '').trim();
  const contentBase64 = String(payload.content_base64 || payload.contentBase64 || '').trim();
  const title = String(payload.title || '').trim();
  const description = String(payload.description || '').trim();

  if (!fileName || !contentBase64) {
    throw new Error('File is required');
  }

  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length) {
    throw new Error('Uploaded file is empty');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('Uploaded file exceeds size limit');
  }

  const ext = path.extname(fileName).toLowerCase();
  if (!['.txt', '.md', '.pdf'].includes(ext)) {
    throw new Error('Unsupported file type');
  }

  return {
    fileName,
    mimeType,
    contentBase64,
    buffer,
    ext,
    title: title || path.basename(fileName, ext),
    description,
  };
}

function extractTextFromBuffer(buffer, ext) {
  if (ext === '.md' || ext === '.txt') {
    return String(buffer.toString('utf8') || '').trim();
  }
  throw new Error('Binary extraction requires OCR');
}

async function pollAzureOperation(operationLocation, headers) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90_000) {
    const response = await fetch(operationLocation, { headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error?.message || 'Azure OCR polling failed');
    }
    if (payload.status === 'succeeded') {
      return payload.analyzeResult || {};
    }
    if (payload.status === 'failed') {
      throw new Error(payload.error?.message || 'Azure OCR analysis failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('Azure OCR timed out');
}

function buildAzureSourcePages(analyzeResult) {
  const pages = Array.isArray(analyzeResult.pages) ? analyzeResult.pages : [];
  const paragraphs = Array.isArray(analyzeResult.paragraphs) ? analyzeResult.paragraphs : [];
  const paragraphMap = new Map();

  paragraphs.forEach((paragraph) => {
    const content = String(paragraph?.content || '').trim();
    if (!content) {
      return;
    }
    const regions = Array.isArray(paragraph?.boundingRegions) ? paragraph.boundingRegions : [];
    const pageNumber = Number(regions[0]?.pageNumber) || 1;
    const bucket = paragraphMap.get(pageNumber) || [];
    bucket.push(content);
    paragraphMap.set(pageNumber, bucket);
  });

  return pages.map((page, index) => {
    const pageNumber = Number(page?.pageNumber) || index + 1;
    const lineTexts = Array.isArray(page?.lines)
      ? page.lines.map((line) => String(line?.content || '').trim()).filter(Boolean)
      : [];
    const paragraphTexts = paragraphMap.get(pageNumber) || [];
    const text = paragraphTexts.length ? paragraphTexts.join('\n\n') : lineTexts.join('\n');
    return {
      page_number: pageNumber,
      text: text.trim(),
    };
  }).filter((page) => page.text);
}

async function analyzePdfWithAzure(buffer, fileName) {
  const endpoint = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '').replace(/\/+$/, '');
  const key = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '').trim();
  const model = String(process.env.AZURE_DOCUMENT_MODEL || 'prebuilt-layout').trim();
  const fallbackModel = String(process.env.AZURE_DOCUMENT_FALLBACK_MODEL || 'prebuilt-read').trim();

  if (!endpoint || !key) {
    throw new Error('Azure Document Intelligence is not configured');
  }

  async function analyzeWithModel(modelId) {
    const url = `${endpoint}/documentintelligence/documentModels/${encodeURIComponent(modelId)}:analyze?api-version=2024-11-30`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'Ocp-Apim-Subscription-Key': key,
      },
      body: buffer,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || `Azure OCR request failed for ${modelId}`);
    }

    const operationLocation = response.headers.get('operation-location');
    if (!operationLocation) {
      throw new Error('Azure OCR did not return an operation-location header');
    }

    const analyzeResult = await pollAzureOperation(operationLocation, {
      'Ocp-Apim-Subscription-Key': key,
    });
    const sourcePages = buildAzureSourcePages(analyzeResult);
    const content = sourcePages.map((page) => page.text).join('\n\n').trim();
    const title = String(analyzeResult.documents?.[0]?.fields?.Title?.content || fileName).trim();

    return {
      title,
      content,
      source_pages: sourcePages,
      extraction_method: 'azure_document_intelligence',
      low_ocr_supported: true,
      manual_review_required: false,
      azure_model: modelId,
    };
  }

  try {
    return await analyzeWithModel(model);
  } catch (error) {
    if (!fallbackModel || fallbackModel === model) {
      throw error;
    }
    const fallback = await analyzeWithModel(fallbackModel);
    fallback.azure_model = fallbackModel;
    return fallback;
  }
}

async function saveUploadedDocument(themeId, payload) {
  const normalizedThemeId = normalizeThemeId(themeId);
  const upload = validateUploadPayload(payload);
  const manifest = await readManifest();
  const idBase = slugify(upload.title || upload.fileName) || `doc-${Date.now()}`;

  let extraction;
  if (upload.ext === '.pdf') {
    extraction = await analyzePdfWithAzure(upload.buffer, upload.fileName);
    if (!extraction.content) {
      throw new Error('Azure OCR returned no usable text');
    }
  } else {
    const content = extractTextFromBuffer(upload.buffer, upload.ext);
    if (!content) {
      throw new Error('Uploaded document contains no usable text');
    }
    extraction = {
      title: upload.title,
      content,
      source_pages: [],
      extraction_method: upload.ext === '.md' ? 'markdown_upload' : 'text_upload',
      low_ocr_supported: false,
      manual_review_required: false,
    };
  }

  const target = normalizedThemeId === 'conformites' ? 'legal_kb' : 'faq';
  const document = normalizeDocument({
    id: `${normalizedThemeId}-${idBase}`,
    title: extraction.title || upload.title,
    description: upload.description,
    file_name: upload.fileName,
    file_ext: upload.ext,
    mime_type: upload.mimeType || (upload.ext === '.pdf' ? 'application/pdf' : 'text/plain'),
    target,
    content: extraction.content,
    source_pages: extraction.source_pages,
    extraction_method: extraction.extraction_method,
    manual_review_required: extraction.manual_review_required,
    low_ocr_supported: extraction.low_ocr_supported,
    keywords: extractKeywordCandidates(`${upload.title}\n${extraction.content}`),
  });

  const documents = manifest.documents[normalizedThemeId] || [];
  manifest.documents[normalizedThemeId] = [document, ...documents.filter((entry) => entry.id !== document.id)];
  await writeManifest(manifest);
  await ensureMaterializedAssets();

  return document;
}

async function deleteDocument(themeId, documentId) {
  const normalizedThemeId = normalizeThemeId(themeId);
  const manifest = await readManifest();
  const documents = manifest.documents[normalizedThemeId] || [];
  const nextDocuments = documents.filter((entry) => entry.id !== documentId);
  if (nextDocuments.length === documents.length) {
    return false;
  }
  manifest.documents[normalizedThemeId] = nextDocuments;
  await writeManifest(manifest);
  await ensureMaterializedAssets();
  return true;
}

async function recordJob(job) {
  const manifest = await readManifest();
  const nextJob = normalizeJob({
    id: job.id || crypto.randomUUID(),
    ...job,
    created_at: job.created_at || nowIso(),
  });
  manifest.jobs = [
    nextJob,
    ...(manifest.jobs || []).filter((entry) => entry.id !== nextJob.id),
  ].slice(0, MAX_JOBS);
  await writeManifest(manifest);
  return nextJob;
}

module.exports = {
  ADMIN_CHUNK_PREFIX,
  FAQ_FILE_NAMES,
  buildLegalChunksForDocument,
  buildOverview,
  deleteDocument,
  deleteFaqEntry,
  ensureMaterializedAssets,
  getRuntimeStatus,
  listDocuments,
  listFaqEntries,
  materializeFaqFiles,
  materializeLegalChunks,
  normalizeThemeId,
  readManifest,
  recordJob,
  saveUploadedDocument,
  upsertFaqEntry,
  writeManifest,
  _test: {
    buildChunkSummary,
    buildFaqMarkdown,
    buildKeyRules,
    buildLegalChunksForDocument,
    buildOverview,
    chunkDocumentPages,
    chunkParagraphs,
    detectLanguage,
    detectLegalDocumentType,
    extractKeywordCandidates,
    inferLegalTopics,
    normalizeManifest,
  },
};
