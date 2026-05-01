#!/usr/bin/env node
'use strict';

/**
 * scripts/setup_supabase.js
 *
 * One-time setup: creates the bot_kv_store table in Supabase and migrates
 * existing local JSON files into it.
 *
 * Usage:
 *   node scripts/setup_supabase.js          — migrate only missing keys
 *   node scripts/setup_supabase.js --force  — overwrite existing keys
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const TABLE = 'bot_kv_store';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FORCE = process.argv.includes('--force');

const DDL = `
CREATE TABLE IF NOT EXISTS bot_kv_store (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Disable RLS (service role bypasses it anyway, but keep it explicit)
ALTER TABLE bot_kv_store DISABLE ROW LEVEL SECURITY;
`;

// key → filename in DATA_DIR
const MIGRATIONS = [
  { key: 'themes',       file: 'themes.json' },
  { key: 'content',      file: 'content.json' },
  { key: 'users',        file: 'users.json' },
  { key: 'consents',     file: 'consents.json' },
  { key: 'subscriptions',file: 'subscriptions.json' },
  { key: 'messageLogs',  file: 'message_logs.json' },
  { key: 'pharmacists',  file: 'pharmacists.json' },
  { key: 'refOpposables',file: 'ref_opposables.json' },
  { key: 'actus',        file: 'actus.json' },
  { key: 'interactive_templates', file: 'interactive_templates.json' },
];

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌  SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis dans .env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  console.log('=== Setup Supabase Storage ===\n');
  console.log(`URL:      ${SUPABASE_URL}`);
  console.log(`DATA_DIR: ${DATA_DIR}`);
  console.log(`Mode:     ${FORCE ? 'force (écrase les données existantes)' : 'safe (ignore les clés déjà présentes)'}\n`);

  // ── 1. Check table exists ──────────────────────────────────────────────────
  const { error: checkErr } = await supabase.from(TABLE).select('key').limit(1);

  if (checkErr) {
    const msg = String(checkErr.message || '');
    if (checkErr.code === '42P01' || msg.includes('does not exist')) {
      console.log('❌  Table "bot_kv_store" introuvable dans Supabase.\n');
      console.log('Créez-la en 30 secondes dans le SQL Editor de votre projet Supabase :');
      console.log(`  https://supabase.com/dashboard/project/${SUPABASE_URL.split('.')[0].replace('https://', '')}/sql/new\n`);
      console.log('Collez et exécutez ce SQL :\n');
      console.log('─'.repeat(60));
      console.log(DDL.trim());
      console.log('─'.repeat(60));
      console.log('\nRelancez ensuite : node scripts/setup_supabase.js\n');
      process.exit(0);
    }
    console.error('❌  Erreur de connexion Supabase:', checkErr.message);
    process.exit(1);
  }

  console.log('✅  Table "bot_kv_store" trouvée.\n');

  // ── 2. Migrate JSON files ──────────────────────────────────────────────────
  console.log('Migration des fichiers JSON → Supabase...\n');

  let migrated = 0;
  let skipped  = 0;
  let failed   = 0;

  for (const { key, file } of MIGRATIONS) {
    const filePath = path.join(DATA_DIR, file);

    // Load local data
    let localData = null;
    if (fs.existsSync(filePath)) {
      try {
        localData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        console.log(`  ⚠️   ${key}: fichier illisible (${e.message}), ignoré.`);
        skipped++;
        continue;
      }
    }

    if (localData === null) {
      console.log(`  ⚪  ${key}: pas de fichier local, ignoré.`);
      skipped++;
      continue;
    }

    // Check if already in Supabase
    if (!FORCE) {
      const { data: existing } = await supabase
        .from(TABLE)
        .select('updated_at')
        .eq('key', key)
        .maybeSingle();
      if (existing) {
        const count = Array.isArray(localData)
          ? localData.length
          : Object.keys(localData).length;
        console.log(`  ⚠️   ${key}: déjà présent (${existing.updated_at}) — ${count} entrée(s) ignorées. Utilisez --force pour écraser.`);
        skipped++;
        continue;
      }
    }

    // Upsert
    const { error: upsertErr } = await supabase
      .from(TABLE)
      .upsert({ key, value: localData, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    if (upsertErr) {
      console.error(`  ❌  ${key}: erreur — ${upsertErr.message}`);
      failed++;
    } else {
      const count = Array.isArray(localData)
        ? localData.length
        : Object.keys(localData).length;
      console.log(`  ✅  ${key}: ${count} entrée(s) migrées.`);
      migrated++;
    }
  }

  // ── 3. Summary ─────────────────────────────────────────────────────────────
  console.log('\n=== Résultat ===');
  console.log(`  Migré:   ${migrated}`);
  console.log(`  Ignoré:  ${skipped}`);
  console.log(`  Erreurs: ${failed}`);

  if (failed > 0) {
    console.log('\n⚠️  Certaines migrations ont échoué. Vérifiez les erreurs ci-dessus.');
    process.exit(1);
  }

  console.log('\n✅  Migration terminée.');
  console.log('   Le bot utilisera désormais Supabase comme stockage primaire (avec fallback fichier).');
  console.log('   Redémarrez le serveur pour activer la connexion.\n');
}

main().catch((err) => {
  console.error('Erreur fatale:', err.message);
  process.exit(1);
});
