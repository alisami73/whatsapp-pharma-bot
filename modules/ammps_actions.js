'use strict';

const supabaseStore = require('./supabase_store');

const TABLE = 'ammps_actions';

function getDb() {
  return supabaseStore.getClient();
}

function nowIso() {
  return new Date().toISOString();
}

function trim(v, max = 500) {
  const s = String(v || '').trim();
  return max ? s.slice(0, max) : s;
}

async function selectMany(builder) {
  const { data, error } = await builder;
  if (error) {
    if (error.code === '42P01') return []; // table not found — migration not run yet
    throw Object.assign(new Error(error.message || 'DB error'), { status: 500 });
  }
  return Array.isArray(data) ? data : [];
}

async function mutateSingle(builder, errMsg = 'DB error') {
  const { data, error } = await builder;
  if (error) {
    if (error.code === '42P01') {
      throw Object.assign(
        new Error('La table ammps_actions n\'existe pas encore. Exécutez la migration 20260504_ammps_actions.sql dans Supabase.'),
        { status: 503, code: 'MIGRATION_REQUIRED' },
      );
    }
    throw Object.assign(new Error(error.message || errMsg), { status: 500 });
  }
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function listActions(filters = {}) {
  const db = getDb();
  let q = db.from(TABLE).select('*').order('created_at', { ascending: false });
  if (filters.action_type) q = q.eq('action_type', filters.action_type);
  if (filters.status)      q = q.eq('status', filters.status);
  return selectMany(q);
}

async function getAction(id) {
  const safeId = trim(id, 120);
  if (!safeId) {
    return null;
  }

  const db = getDb();
  return mutateSingle(
    db.from(TABLE).select('*').eq('id', safeId).maybeSingle(),
    'Échec du chargement de l\'action AMMPS',
  );
}

async function createRecall(adminUser, payload) {
  const title = trim(payload.product_name, 240);
  if (!title) throw Object.assign(new Error('Nom du produit requis'), { status: 400 });

  const db = getDb();
  return mutateSingle(
    db.from(TABLE).insert({
      action_type:      'recall',
      status:           'published',
      title,
      product_name:     title,
      batch_number:     trim(payload.batch_number, 120) || null,
      lab_name:         trim(payload.lab_name, 240)     || null,
      recall_date:      payload.recall_date             || null,
      recall_reason:    trim(payload.recall_reason, 2000) || null,
      geographic_scope: trim(payload.geographic_scope, 160) || 'national',
      created_by_name:  adminUser?.name  || adminUser?.email || 'AMMPS',
      created_by_id:    adminUser?.id    || 'ammps',
      created_at:       nowIso(),
      updated_at:       nowIso(),
    }).select('*').single(),
    'Échec de la création du retrait de lot',
  );
}

async function createWarning(adminUser, payload) {
  const title = trim(payload.title, 240);
  if (!title) throw Object.assign(new Error('Titre requis'), { status: 400 });

  const db = getDb();
  return mutateSingle(
    db.from(TABLE).insert({
      action_type:      'warning',
      status:           'published',
      title,
      reference_number: trim(payload.reference_number, 120) || null,
      warning_content:  trim(payload.warning_content, 4000) || null,
      effective_date:   payload.effective_date              || null,
      geographic_scope: trim(payload.geographic_scope, 160) || 'national',
      created_by_name:  adminUser?.name  || adminUser?.email || 'AMMPS',
      created_by_id:    adminUser?.id    || 'ammps',
      created_at:       nowIso(),
      updated_at:       nowIso(),
    }).select('*').single(),
    'Échec de la création de l\'avertissement',
  );
}

async function deleteAction(id) {
  const db = getDb();
  const { error } = await db.from(TABLE).delete().eq('id', id);
  if (error) throw Object.assign(new Error(error.message || 'Échec de la suppression'), { status: 500 });
  return { ok: true };
}

async function updateStatus(id, status) {
  const valid = ['draft', 'published', 'archived'];
  if (!valid.includes(status)) throw Object.assign(new Error('Statut invalide'), { status: 400 });
  const db = getDb();
  return mutateSingle(
    db.from(TABLE).update({ status, updated_at: nowIso() }).eq('id', id).select('*').single(),
    'Échec de la mise à jour',
  );
}

module.exports = { listActions, getAction, createRecall, createWarning, deleteAction, updateStatus };
