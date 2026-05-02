'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadAdminKbStore(tempDir) {
  process.env.DATA_DIR = tempDir;
  delete require.cache[require.resolve('../modules/runtime_paths')];
  delete require.cache[require.resolve('../modules/admin_kb_store')];
  return require('../modules/admin_kb_store');
}

test('upsertFaqEntry matérialise une FAQ FSE persistée depuis l’admin', async () => {
  const originalDataDir = process.env.DATA_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-kb-fse-'));
  const adminKbStore = loadAdminKbStore(tempDir);

  try {
    const entry = await adminKbStore.upsertFaqEntry('fse', {
      title: 'Définition FSE',
      question: "C'est quoi la FSE ?",
      answer: 'La FSE remplace progressivement la feuille de soins papier.',
      keywords: ['fse', 'definition'],
    });

    assert.match(entry.id, /^fse-/);

    const faqPath = path.join(tempDir, 'knowledge', 'fse_admin_faq.md');
    assert.equal(fs.existsSync(faqPath), true);

    const content = fs.readFileSync(faqPath, 'utf8');
    assert.match(content, /C'est quoi la FSE \?/);
    assert.match(content, /remplace progressivement la feuille de soins papier/i);
  } finally {
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('saveUploadedDocument génère des chunks admin pour le thème conformites', async () => {
  const originalDataDir = process.env.DATA_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-kb-legal-'));
  const adminKbStore = loadAdminKbStore(tempDir);

  try {
    await adminKbStore.saveUploadedDocument('conformites', {
      title: 'Guide inspection pharmacie',
      file_name: 'inspection.txt',
      mime_type: 'text/plain',
      content_base64: Buffer.from([
        'Inspection en pharmacie',
        '',
        'Préparer le registre, l’ordonnancier et les documents affichés.',
        '',
        'Le pharmacien doit vérifier les pièces de l’officine avant la visite.',
      ].join('\n')).toString('base64'),
    });

    const chunkDir = path.join(tempDir, 'legal_kb', 'chunks');
    const files = fs.readdirSync(chunkDir).filter((file) => file.startsWith('admin_upload__'));
    assert.equal(files.length, 1);

    const payload = JSON.parse(fs.readFileSync(path.join(chunkDir, files[0]), 'utf8'));
    assert.ok(Array.isArray(payload.chunks));
    assert.ok(payload.chunks.length >= 1);
    assert.match(payload.chunks[0].citation_label, /Guide inspection pharmacie/i);
    assert.ok(payload.chunks[0].topics.includes('inspection'));
  } finally {
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
