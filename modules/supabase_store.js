'use strict';

/**
 * modules/supabase_store.js
 *
 * Supabase-backed KV store for bot data persistence.
 * Mirrors the readJson/writeJson API from storage.js so the migration is transparent.
 *
 * Table: bot_kv_store (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ)
 * Run scripts/setup_supabase.js once to create the table and migrate existing JSON files.
 */

const { createClient } = require('@supabase/supabase-js');

const TABLE = 'bot_kv_store';
let _client = null;
let _availablePromise = null; // settled once, reused for all callers

function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

function isEnabled() {
  return Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_KEY ||
        process.env.SUPABASE_ANON_KEY),
  );
}

// Returns true if the bot_kv_store table is reachable.
// Result is cached for the lifetime of the process.
function checkAvailable() {
  if (_availablePromise) return _availablePromise;
  _availablePromise = (async () => {
    const client = getClient();
    if (!client) return false;
    try {
      const { error } = await client.from(TABLE).select('key').limit(1);
      if (error) {
        const msg = String(error.message || '');
        if (error.code === '42P01' || msg.includes('does not exist')) {
          console.warn(
            '[supabase-store] Table "bot_kv_store" introuvable. ' +
              'Lancez: node scripts/setup_supabase.js',
          );
        } else {
          console.warn('[supabase-store] Vérification échouée:', msg);
        }
        return false;
      }
      console.info('[supabase-store] Connecté — Supabase est le stockage primaire.');
      return true;
    } catch (err) {
      console.warn('[supabase-store] Connexion échouée:', err.message);
      return false;
    }
  })();
  return _availablePromise;
}

async function read(key) {
  if (!(await checkAvailable())) return null;
  const client = getClient();
  try {
    const { data, error } = await client
      .from(TABLE)
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? data.value : null;
  } catch (err) {
    console.warn(`[supabase-store] read("${key}") échoué:`, err.message);
    return null;
  }
}

async function write(key, value) {
  if (!(await checkAvailable())) return false;
  const client = getClient();
  try {
    const { error } = await client
      .from(TABLE)
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.warn(`[supabase-store] write("${key}") échoué:`, err.message);
    return false;
  }
}

module.exports = { isEnabled, checkAvailable, read, write, getClient };
