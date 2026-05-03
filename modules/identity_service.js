'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

let _client = null;

function _getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

function isEnabled() {
  return Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) &&
    process.env.USER_HASH_SECRET,
  );
}

function normalizePhone(phone) {
  if (!phone) return null;
  return String(phone).trim().replace(/^whatsapp:/i, '').replace(/\s/g, '');
}

function hashPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('hashPhone: phone required');
  const secret = process.env.USER_HASH_SECRET;
  if (!secret) throw new Error('USER_HASH_SECRET not configured');
  return crypto.createHmac('sha256', secret).update(normalized).digest('hex');
}

function hashIp(ip) {
  if (!ip || ip === 'unknown') return null;
  const secret = process.env.USER_HASH_SECRET;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(String(ip)).digest('hex');
}

async function findOrCreateUserFromWhatsApp({ From, WaId, ProfileName } = {}) {
  const client = _getClient();
  if (!client) return null;

  let phone_hash;
  try {
    phone_hash = hashPhone(From);
  } catch {
    return null;
  }

  const { data: existing, error: findErr } = await client
    .from('user_identities')
    .select('*')
    .eq('phone_hash', phone_hash)
    .maybeSingle();

  if (findErr) {
    console.error('[identity] findUser error:', findErr.message);
    return null;
  }

  if (existing) {
    const patch = { last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (ProfileName && existing.profile_name !== ProfileName) patch.profile_name = ProfileName;
    if (WaId && existing.whatsapp_wa_id !== WaId) patch.whatsapp_wa_id = WaId;
    await client.from('user_identities').update(patch).eq('id', existing.id);
    return { ...existing, ...patch };
  }

  const { data: created, error: createErr } = await client
    .from('user_identities')
    .insert({
      phone_hash,
      whatsapp_wa_id: WaId || null,
      whatsapp_from: From || null,
      profile_name: ProfileName || null,
      consent_status: 'unknown',
    })
    .select()
    .single();

  if (createErr) {
    console.error('[identity] createUser error:', createErr.message);
    return null;
  }
  return created;
}

async function updateConsent(userId, { consent_status, consent_version, consent_hash, consent_channel } = {}) {
  const client = _getClient();
  if (!client || !userId) return null;
  const { data, error } = await client
    .from('user_identities')
    .update({
      consent_status,
      consent_version: consent_version || null,
      consent_hash: consent_hash || null,
      consent_channel: consent_channel || 'whatsapp',
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();
  if (error) console.error('[identity] updateConsent error:', error.message);
  return data || null;
}

async function updateLastSeen(userId) {
  const client = _getClient();
  if (!client || !userId) return;
  await client
    .from('user_identities')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', userId);
}

async function getUserById(userId) {
  const client = _getClient();
  if (!client || !userId) return null;
  const { data, error } = await client
    .from('user_identities')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) console.error('[identity] getUserById error:', error.message);
  return data || null;
}

async function getUserByPhoneHash(phoneHash) {
  const client = _getClient();
  if (!client || !phoneHash) return null;
  const { data, error } = await client
    .from('user_identities')
    .select('*')
    .eq('phone_hash', phoneHash)
    .maybeSingle();
  if (error) console.error('[identity] getUserByPhoneHash error:', error.message);
  return data || null;
}

module.exports = {
  isEnabled,
  normalizePhone,
  hashPhone,
  hashIp,
  findOrCreateUserFromWhatsApp,
  updateConsent,
  updateLastSeen,
  getUserById,
  getUserByPhoneHash,
};
