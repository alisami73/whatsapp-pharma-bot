'use strict';

const crypto = require('crypto');
const xlsx = require('xlsx');

const supabaseStore = require('./supabase_store');
const medindex = require('./medindex');
const consent = require('./consent');
const twilioService = require('../twilio_service');

const TABLES = {
  organizations: 'organizations',
  organizationUsers: 'organization_users',
  pharmacistPreferences: 'pharmacist_alert_preferences',
  consentVersions: 'consent_versions',
  supplierProducts: 'supplier_products',
  uploadedFiles: 'uploaded_product_files',
  stockAlerts: 'stock_alerts',
  recipients: 'stock_alert_recipients',
  messageLogs: 'whatsapp_message_logs',
  auditLogs: 'audit_logs',
};

const ALERT_CATEGORIES = [
  'stock_recovery',
  'out_of_stock',
  'product_recall',
  'new_product',
  'regulatory_info',
];

const ALERT_STATUSES = ['draft', 'pending_approval', 'approved', 'sending', 'sent', 'cancelled'];
const ORG_TYPES = ['laboratory', 'wholesaler'];
const ORG_STATUSES = ['pending', 'validated', 'rejected', 'disabled'];
const PRODUCT_MATCH_STATUSES = ['validated', 'pending_manual_review', 'rejected'];
const PREFERENCE_STATUSES = ['active', 'revoked', 'paused', 'opted_out', 'pending'];
const FILE_PARSE_STATUSES = ['uploaded', 'parsed', 'pending_manual_review', 'failed'];
const RECIPIENT_STATUSES = [
  'eligible',
  'queued',
  'sent',
  'delivered',
  'failed',
  'skipped_no_consent',
  'skipped_opted_out',
];

const PHARMACIST_COOKIE = 'blink_stock_alerts_pharmacist';
const SUPPLIER_COOKIE = 'blink_stock_alerts_supplier';
const DEFAULT_BATCH_SIZE = Number(process.env.STOCK_ALERTS_BATCH_SIZE || 50);
const DEFAULT_PORTAL_TTL_MS = Number(process.env.STOCK_ALERTS_PORTAL_TTL_MS || 7 * 24 * 60 * 60 * 1000);

const PUBLIC_CATEGORY_META = {
  stock_recovery: { label: 'Reprise stock', color: '#2E7D32', icon: '✅' },
  out_of_stock: { label: 'Rupture', color: '#FF7043', icon: '📉' },
  product_recall: { label: 'Rappel', color: '#E53935', icon: '⚠️' },
  new_product: { label: 'Nouveau', color: '#3F51B5', icon: '💊' },
  regulatory_info: { label: 'Info réglementaire', color: '#8E24AA', icon: '📘' },
};

const TEMPLATE_KEYS = {
  stock_recovery_wholesaler: {
    env: 'TWILIO_TEMPLATE_STOCK_RECOVERY_WHOLESALER_SID',
    label: 'Stock recovery / wholesaler',
  },
  stock_recovery_laboratory: {
    env: 'TWILIO_TEMPLATE_STOCK_RECOVERY_LABORATORY_SID',
    label: 'Stock recovery / laboratory',
  },
  product_recall: {
    env: 'TWILIO_TEMPLATE_PRODUCT_RECALL_SID',
    label: 'Product recall',
  },
  out_of_stock: {
    env: 'TWILIO_TEMPLATE_OUT_OF_STOCK_SID',
    label: 'Out of stock',
  },
  regulatory_info: {
    env: 'TWILIO_TEMPLATE_REGULATORY_INFO_SID',
    label: 'Regulatory info / new product',
  },
};

function getDb() {
  const client = supabaseStore.getClient();
  if (!client) {
    throw Object.assign(new Error('Supabase is not configured for stock alerts.'), {
      code: 'SUPABASE_NOT_CONFIGURED',
      status: 503,
    });
  }
  return client;
}

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return error && (error.code === '42P01' || message.includes('does not exist') || message.includes('relation'));
}

function toAppError(error, fallbackMessage) {
  if (!error) {
    return new Error(fallbackMessage || 'Unknown stock alerts error');
  }

  if (error.status || error.code) {
    return error;
  }

  if (isMissingTableError(error)) {
    return Object.assign(
      new Error(
        'Les tables Supabase du module Stock Alerts sont absentes. Appliquez la migration supabase/migrations/20260502_stock_alerts.sql.',
      ),
      { code: 'MISSING_STOCK_ALERT_TABLES', status: 503 },
    );
  }

  return Object.assign(new Error(error.message || fallbackMessage || 'Stock alerts error'), {
    code: error.code || 'STOCK_ALERTS_ERROR',
    status: 500,
  });
}

function ensureValueInList(value, list, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return list.includes(normalized) ? normalized : fallback;
}

function normalizeOrgType(value) {
  return ensureValueInList(value, ORG_TYPES, 'laboratory');
}

function normalizeAlertType(value) {
  return ensureValueInList(value, ALERT_CATEGORIES, 'stock_recovery');
}

function normalizeAlertStatus(value) {
  return ensureValueInList(value, ALERT_STATUSES, 'draft');
}

function normalizeProductMatchStatus(value) {
  return ensureValueInList(value, PRODUCT_MATCH_STATUSES, 'pending_manual_review');
}

function normalizeRecipientStatus(value) {
  return ensureValueInList(value, RECIPIENT_STATUSES, 'eligible');
}

function base64UrlEncode(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function getPortalSecret() {
  return (
    process.env.STOCK_ALERTS_PORTAL_SECRET ||
    process.env.ADMIN_SECRET ||
    process.env.TWILIO_AUTH_TOKEN ||
    'blink-stock-alerts-dev-secret'
  );
}

function signPortalToken(payload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', getPortalSecret()).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyPortalToken(token, expectedKind) {
  const [encodedPayload, signature] = String(token || '').split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac('sha256', getPortalSecret())
    .update(encodedPayload)
    .digest('base64url');

  if (expectedSignature !== signature) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (expectedKind && payload.kind !== expectedKind) {
    return null;
  }

  if (!payload.exp || Number(payload.exp) < Date.now()) {
    return null;
  }

  return payload;
}

function parseCookies(headerValue) {
  return String(headerValue || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const eqIndex = part.indexOf('=');
      if (eqIndex === -1) {
        return acc;
      }
      const key = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function getCookieToken(req, cookieName) {
  const cookies = parseCookies(req && req.headers ? req.headers.cookie : '');
  return cookies[cookieName] || null;
}

function setPortalCookie(res, cookieName, token, ttlMs = DEFAULT_PORTAL_TTL_MS) {
  if (!res || typeof res.cookie !== 'function') {
    return;
  }

  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: ttlMs,
  });
}

function clearPortalCookie(res, cookieName) {
  if (!res || typeof res.clearCookie !== 'function') {
    return;
  }
  res.clearCookie(cookieName);
}

function normalizePhoneToE164(value) {
  const normalized = twilioService.normalizeWhatsAppAddress(value || '');
  return normalized.replace(/^whatsapp:/i, '') || '';
}

function derivePharmacistId(phoneE164) {
  return `pharm_${crypto.createHash('sha256').update(String(phoneE164 || '')).digest('hex').slice(0, 24)}`;
}

function getPublicBaseUrl() {
  return String(
    process.env.PUBLIC_SITE_ORIGIN ||
    process.env.PUBLIC_BASE_URL ||
    'http://localhost:3000'
  ).trim().replace(/\/+$/, '');
}

function buildPortalUrl(pathname, token) {
  const base = getPublicBaseUrl();
  return `${base}${pathname}?access_token=${encodeURIComponent(token)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeFreeText(value, maxLength = 2000) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeProductSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function isSpreadsheetUpload(fileName, mimeType) {
  const normalizedName = String(fileName || '').trim().toLowerCase();
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  return (
    /\.(xlsx|xls)$/i.test(normalizedName) ||
    normalizedMime.includes('spreadsheet') ||
    normalizedMime.includes('excel') ||
    normalizedMime.includes('officedocument')
  );
}

function buildParsedProductRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return [];
  }

  const sanitizedRows = rows
    .map((row) => (Array.isArray(row) ? row : [row]).map((cell) => String(cell || '').trim()))
    .filter((row) => row.some(Boolean));

  if (!sanitizedRows.length) {
    return [];
  }

  const header = sanitizedRows[0].map((value) => normalizeProductSearchText(value));
  const hasHeader = header.some((value) =>
    ['product', 'produit', 'nom', 'name', 'designation', 'dci', 'reference'].some((token) =>
      value.includes(token),
    ),
  );

  return sanitizedRows
    .slice(hasHeader ? 1 : 0)
    .map((row, index) => {
      const firstValue = row.find((cell) => cell) || '';
      return {
        row_number: index + 1,
        raw_values: row,
        raw_product_name: normalizeFreeText(firstValue, 240),
      };
    })
    .filter((row) => row.raw_product_name);
}

function parseSpreadsheetRowsFromBase64(base64Value) {
  const buffer = Buffer.from(String(base64Value || ''), 'base64');
  if (!buffer.length) {
    return [];
  }

  const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: false, raw: false });
  const firstSheetName = Array.isArray(workbook.SheetNames) ? workbook.SheetNames[0] : null;
  if (!firstSheetName || !workbook.Sheets[firstSheetName]) {
    return [];
  }

  const matrix = xlsx.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  return buildParsedProductRows(matrix);
}

function getAlertTemplateKey(alert) {
  const alertType = normalizeAlertType(alert.alert_type);
  const sourceType = normalizeOrgType(alert.source_type);

  if (alertType === 'stock_recovery') {
    return sourceType === 'laboratory'
      ? 'stock_recovery_laboratory'
      : 'stock_recovery_wholesaler';
  }

  if (alertType === 'new_product') {
    return 'regulatory_info';
  }

  return alertType;
}

function getTemplateRegistry() {
  return Object.entries(TEMPLATE_KEYS).map(([key, meta]) => ({
    key,
    label: meta.label,
    env: meta.env,
    content_sid: String(process.env[meta.env] || '').trim() || null,
    configured: Boolean(String(process.env[meta.env] || '').trim()),
  }));
}

function buildOptOutText() {
  return 'Reply STOP to unsubscribe.';
}

async function auditLog(payload) {
  try {
    const db = getDb();
    const row = {
      actor_type: normalizeFreeText(payload.actor_type || 'system', 40),
      actor_id: normalizeFreeText(payload.actor_id || 'system', 120),
      action: normalizeFreeText(payload.action || 'unknown', 80),
      entity_type: normalizeFreeText(payload.entity_type || 'unknown', 80),
      entity_id: normalizeFreeText(payload.entity_id || '', 120) || null,
      payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : {},
      created_at: payload.created_at || nowIso(),
    };
    const { error } = await db.from(TABLES.auditLogs).insert(row);
    if (error && !isMissingTableError(error)) {
      console.warn('[stock-alerts:audit]', error.message);
    }
  } catch (error) {
    console.warn('[stock-alerts:audit]', error.message);
  }
}

async function selectMany(builder, fallback = []) {
  const { data, error } = await builder;
  if (error) {
    if (isMissingTableError(error)) {
      return fallback;
    }
    throw toAppError(error);
  }
  return Array.isArray(data) ? data : fallback;
}

async function selectMaybeSingle(builder, fallback = null) {
  const { data, error } = await builder;
  if (error) {
    if (isMissingTableError(error)) {
      return fallback;
    }
    throw toAppError(error);
  }
  return data || fallback;
}

async function mutateSingle(builder) {
  const { data, error } = await builder;
  if (error) {
    throw toAppError(error);
  }
  if (Array.isArray(data)) {
    return data[0] || null;
  }
  return data || null;
}

async function listOrganizations(filters = {}) {
  const db = getDb();
  let query = db.from(TABLES.organizations).select('*').order('created_at', { ascending: false });
  if (filters.organization_type) {
    query = query.eq('organization_type', normalizeOrgType(filters.organization_type));
  }
  if (filters.status) {
    query = query.eq('status', ensureValueInList(filters.status, ORG_STATUSES, 'pending'));
  }
  return selectMany(query, []);
}

async function getOrganization(organizationId) {
  const db = getDb();
  return selectMaybeSingle(
    db.from(TABLES.organizations).select('*').eq('id', organizationId).maybeSingle(),
    null,
  );
}

async function listOrganizationUsers(organizationId) {
  const db = getDb();
  return selectMany(
    db.from(TABLES.organizationUsers).select('*').eq('organization_id', organizationId).order('created_at', {
      ascending: false,
    }),
    [],
  );
}

async function getOrganizationUser(userId) {
  const db = getDb();
  return selectMaybeSingle(
    db.from(TABLES.organizationUsers).select('*').eq('id', userId).maybeSingle(),
    null,
  );
}

async function updateOrganizationStatus(organizationId, status, actor) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!ORG_STATUSES.includes(normalized)) {
    throw Object.assign(new Error(`Statut invalide : "${status}". Valeurs acceptées : ${ORG_STATUSES.join(', ')}`), { status: 400 });
  }
  const nextStatus = normalized;
  const db = getDb();
  const organization = await mutateSingle(
    db
      .from(TABLES.organizations)
      .update({
        status: nextStatus,
        updated_at: nowIso(),
        approved_at: nextStatus === 'validated' ? nowIso() : null,
        approved_by: actor && actor.id ? actor.id : null,
      })
      .eq('id', organizationId)
      .select('*')
      .single(),
  );
  await auditLog({
    actor_type: 'admin',
    actor_id: actor && actor.id ? actor.id : 'admin',
    action: 'organization_status_updated',
    entity_type: 'organization',
    entity_id: organizationId,
    payload: { status: nextStatus },
  });
  return organization;
}

async function registerOrganization(payload) {
  const rawType = String(payload.organization_type || payload.source_type || '').trim().toLowerCase();
  if (!ORG_TYPES.includes(rawType)) {
    throw Object.assign(new Error(`Type d'organisation invalide : "${rawType}". Valeurs acceptées : ${ORG_TYPES.join(', ')}`), { status: 400 });
  }
  const rawName = normalizeFreeText(payload.name, 160);
  if (!rawName) {
    throw Object.assign(new Error('Le nom de l\'organisation est requis'), { status: 400 });
  }
  const organizationType = rawType;
  const db = getDb();
  const organization = await mutateSingle(
    db
      .from(TABLES.organizations)
      .insert({
        organization_type: organizationType,
        name: normalizeFreeText(payload.name, 160),
        legal_name: normalizeFreeText(payload.legal_name || payload.name, 160),
        registration_number: normalizeFreeText(payload.registration_number, 120) || null,
        contact_email: normalizeFreeText(payload.contact_email, 160) || null,
        contact_phone: normalizePhoneToE164(payload.contact_phone) || null,
        city: normalizeFreeText(payload.city, 120) || null,
        country: normalizeFreeText(payload.country || 'MA', 80),
        website: normalizeFreeText(payload.website, 240) || null,
        status: 'pending',
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      .select('*')
      .single(),
  );

  const user = await mutateSingle(
    db
      .from(TABLES.organizationUsers)
      .insert({
        organization_id: organization.id,
        full_name: normalizeFreeText(payload.contact_name, 160),
        email: normalizeFreeText(payload.contact_email, 160) || null,
        phone_e164: normalizePhoneToE164(payload.contact_phone) || null,
        role: normalizeFreeText(payload.contact_role || 'manager', 80),
        status: 'active',
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      .select('*')
      .single(),
  );

  const token = signPortalToken({
    kind: 'supplier',
    organization_id: organization.id,
    organization_type: organization.organization_type,
    user_id: user.id,
    email: user.email,
    phone_e164: user.phone_e164,
    iat: Date.now(),
    exp: Date.now() + DEFAULT_PORTAL_TTL_MS,
  });

  await auditLog({
    actor_type: 'supplier',
    actor_id: user.id,
    action: 'organization_registered',
    entity_type: 'organization',
    entity_id: organization.id,
    payload: { organization_type: organization.organization_type, name: organization.name },
  });

  return {
    organization,
    user,
    access_token: token,
    portal_url: buildPortalUrl('/supplier/alerts/new', token),
    products_url:
      organization.organization_type === 'laboratory'
        ? buildPortalUrl('/laboratory/register', token)
        : buildPortalUrl('/wholesaler/register', token),
  };
}

function createPharmacistPortalToken(phone, extra = {}) {
  const phoneE164 = normalizePhoneToE164(phone);
  return signPortalToken({
    kind: 'pharmacist',
    pharmacist_id: derivePharmacistId(phoneE164),
    phone_e164: phoneE164,
    name: extra.name || null,
    iat: Date.now(),
    exp: Date.now() + DEFAULT_PORTAL_TTL_MS,
  });
}

function buildPharmacistPortalUrl(phone, extra = {}) {
  const token = createPharmacistPortalToken(phone, extra);
  return {
    access_token: token,
    url: buildPortalUrl('/preferences/stock-alerts', token),
  };
}

function attachPortalAccessCookieIfPresent(req, res, kind, cookieName) {
  const token = String((req.query && req.query.access_token) || '').trim();
  if (!token) {
    return null;
  }
  const payload = verifyPortalToken(token, kind);
  if (!payload) {
    return null;
  }
  setPortalCookie(res, cookieName, token, Math.max(payload.exp - Date.now(), 60_000));
  return payload;
}

function getPortalPayloadFromRequest(req, kind, cookieName) {
  const token =
    String((req.query && req.query.access_token) || '').trim() ||
    getCookieToken(req, cookieName) ||
    '';
  return verifyPortalToken(token, kind);
}

function stripAccessTokenFromUrl(originalUrl) {
  const url = new URL(originalUrl, getPublicBaseUrl());
  url.searchParams.delete('access_token');
  return `${url.pathname}${url.search}`;
}

function redirectIfPortalTokenConsumed(req, res, kind, cookieName) {
  const payload = attachPortalAccessCookieIfPresent(req, res, kind, cookieName);
  if (!payload) {
    return null;
  }
  const cleanUrl = stripAccessTokenFromUrl(req.originalUrl || req.url || '/');
  return { payload, redirect: cleanUrl };
}

function requirePortalAuth(kind, cookieName) {
  return async (req, res, next) => {
    try {
      const fromQuery = attachPortalAccessCookieIfPresent(req, res, kind, cookieName);
      const payload = fromQuery || getPortalPayloadFromRequest(req, kind, cookieName);
      if (!payload) {
        return res.status(401).json({
          error: 'AUTH_REQUIRED',
          message: 'A secure access link is required.',
        });
      }

      if (kind === 'supplier') {
        const user = await getOrganizationUser(payload.user_id);
        if (!user) {
          clearPortalCookie(res, cookieName);
          return res.status(401).json({ error: 'SUPPLIER_SESSION_INVALID' });
        }
        const organization = await getOrganization(payload.organization_id);
        if (!organization) {
          clearPortalCookie(res, cookieName);
          return res.status(401).json({ error: 'SUPPLIER_ORGANIZATION_NOT_FOUND' });
        }
        req.stockAlertsAuth = {
          kind,
          payload,
          user,
          organization,
        };
      } else {
        req.stockAlertsAuth = {
          kind,
          payload,
          pharmacist: {
            pharmacist_id: payload.pharmacist_id || derivePharmacistId(payload.phone_e164),
            phone_e164: payload.phone_e164,
            name: payload.name || null,
          },
        };
      }

      next();
    } catch (error) {
      next(toAppError(error));
    }
  };
}

async function listSourcesForPreferences() {
  const organizations = await listOrganizations({ status: 'validated' });
  return organizations.map((organization) => ({
    id: organization.id,
    source_id: organization.id,
    source_type: organization.organization_type,
    name: organization.name,
    city: organization.city || null,
    status: organization.status,
  }));
}

async function listPharmacistPreferences(phoneE164) {
  const db = getDb();
  return selectMany(
    db
      .from(TABLES.pharmacistPreferences)
      .select('*')
      .eq('phone_e164', normalizePhoneToE164(phoneE164))
      .order('source_type', { ascending: true })
      .order('category', { ascending: true }),
    [],
  );
}

async function recordConsentVersion(row) {
  const db = getDb();
  const payload = {
    pharmacist_alert_preference_id: row.id || null,
    pharmacist_id: row.pharmacist_id,
    phone_e164: row.phone_e164,
    source_type: row.source_type,
    source_id: row.source_id,
    category: row.category,
    status: row.status,
    consent_text_version: row.consent_text_version || consent.CONSENT_CURRENT_VERSION,
    ip_address: row.ip_address || null,
    user_agent: row.user_agent || null,
    accepted_at: row.accepted_at || null,
    revoked_at: row.revoked_at || null,
    changed_at: nowIso(),
  };
  const { error } = await db.from(TABLES.consentVersions).insert(payload);
  if (error && !isMissingTableError(error)) {
    throw toAppError(error);
  }
}

async function upsertPharmacistPreferences(auth, selections, meta = {}) {
  const pharmacistId =
    (auth && auth.pharmacist && auth.pharmacist.pharmacist_id) ||
    derivePharmacistId(meta.phone_e164 || auth.payload.phone_e164);
  const phoneE164 =
    (auth && auth.pharmacist && auth.pharmacist.phone_e164) ||
    normalizePhoneToE164(meta.phone_e164 || auth.payload.phone_e164);

  const desiredMap = new Map();
  (Array.isArray(selections) ? selections : []).forEach((item) => {
    const sourceType = normalizeOrgType(item.source_type);
    const sourceId = normalizeFreeText(item.source_id, 120);
    const category = normalizeAlertType(item.category);
    const key = `${sourceType}:${sourceId}:${category}`;
    desiredMap.set(key, { sourceType, sourceId, category });
  });

  const existing = await listPharmacistPreferences(phoneE164);
  const existingByKey = new Map(
    existing.map((item) => [
      `${item.source_type}:${item.source_id}:${item.category}`,
      item,
    ]),
  );

  const db = getDb();

  for (const desired of desiredMap.values()) {
    const key = `${desired.sourceType}:${desired.sourceId}:${desired.category}`;
    const current = existingByKey.get(key);
    if (current && current.status === 'active') {
      continue;
    }

    const row = await mutateSingle(
      db
        .from(TABLES.pharmacistPreferences)
        .upsert(
          {
            pharmacist_id: pharmacistId,
            phone_e164: phoneE164,
            source_type: desired.sourceType,
            source_id: desired.sourceId,
            category: desired.category,
            status: 'active',
            accepted_at: current && current.accepted_at ? current.accepted_at : nowIso(),
            revoked_at: null,
            consent_text_version: meta.consent_text_version || consent.CONSENT_CURRENT_VERSION,
            ip_address: meta.ip_address || null,
            user_agent: meta.user_agent || null,
            updated_at: nowIso(),
          },
          {
            onConflict: 'phone_e164,source_type,source_id,category',
          },
        )
        .select('*')
        .single(),
    );
    await recordConsentVersion(row);
  }

  for (const existingRow of existing) {
    const key = `${existingRow.source_type}:${existingRow.source_id}:${existingRow.category}`;
    if (desiredMap.has(key)) {
      continue;
    }
    if (!['active', 'pending'].includes(existingRow.status)) {
      continue;
    }
    const row = await mutateSingle(
      db
        .from(TABLES.pharmacistPreferences)
        .update({
          status: 'revoked',
          revoked_at: nowIso(),
          consent_text_version: meta.consent_text_version || consent.CONSENT_CURRENT_VERSION,
          ip_address: meta.ip_address || null,
          user_agent: meta.user_agent || null,
          updated_at: nowIso(),
        })
        .eq('id', existingRow.id)
        .select('*')
        .single(),
    );
    await recordConsentVersion(row);
  }

  await auditLog({
    actor_type: 'pharmacist',
    actor_id: pharmacistId,
    action: 'pharmacist_preferences_updated',
    entity_type: 'pharmacist_alert_preferences',
    entity_id: pharmacistId,
    payload: {
      active_preferences: Array.from(desiredMap.values()),
      phone_e164: phoneE164,
    },
  });

  return listPharmacistPreferences(phoneE164);
}

async function buildPharmacistPreferencesPayload(auth) {
  const sources = await listSourcesForPreferences();
  const preferences = await listPharmacistPreferences(auth.pharmacist.phone_e164);
  return {
    pharmacist: auth.pharmacist,
    categories: ALERT_CATEGORIES,
    sources,
    preferences,
    consent_text_version: consent.CONSENT_CURRENT_VERSION,
  };
}

async function addManualSupplierProducts(auth, products) {
  const db = getDb();
  const organizationId = auth.organization.id;
  const created = [];
  for (const product of Array.isArray(products) ? products : []) {
    const productIdMedindex = normalizeFreeText(product.product_id_medindex || product.id, 120);
    const payload = {
      organization_id: organizationId,
      product_id_medindex: productIdMedindex,
      product_name: normalizeFreeText(product.product_name || product.name, 240),
      source: 'medindex_validated',
      match_status: 'validated',
      uploaded_file_id: null,
      raw_product_name: normalizeFreeText(product.product_name || product.name, 240),
      raw_row: {
        dci: product.dci || null,
        laboratory: product.laboratory || null,
        dosage: product.dosage || null,
      },
      validated_by: auth.user.id,
      validated_at: nowIso(),
      rejection_reason: null,
      updated_at: nowIso(),
    };

    // PostgREST ne peut pas résoudre ON CONFLICT sur un index partiel.
    // On tente d'abord de récupérer l'existant, sinon on insère.
    let row;
    if (productIdMedindex) {
      const { data: existing } = await db
        .from(TABLES.supplierProducts)
        .select('*')
        .eq('organization_id', organizationId)
        .eq('product_id_medindex', productIdMedindex)
        .maybeSingle();
      if (existing) {
        row = await mutateSingle(
          db.from(TABLES.supplierProducts)
            .update({ ...payload, updated_at: nowIso() })
            .eq('id', existing.id)
            .select('*')
            .single(),
        );
      } else {
        row = await mutateSingle(
          db.from(TABLES.supplierProducts)
            .insert({ ...payload, created_at: nowIso() })
            .select('*')
            .single(),
        );
      }
    } else {
      row = await mutateSingle(
        db.from(TABLES.supplierProducts)
          .insert({ ...payload, created_at: nowIso() })
          .select('*')
          .single(),
      );
    }
    created.push(row);
  }

  await auditLog({
    actor_type: 'supplier',
    actor_id: auth.user.id,
    action: 'supplier_products_added',
    entity_type: 'organization',
    entity_id: organizationId,
    payload: { count: created.length },
  });

  return created;
}

function parseDelimitedRows(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split('\n').filter(Boolean);
  if (!lines.length) {
    return [];
  }

  const delimiter = [';', ',', '\t']
    .map((candidate) => ({
      candidate,
      count: (lines[0].match(new RegExp(`\\${candidate}`, 'g')) || []).length,
    }))
    .sort((left, right) => right.count - left.count)[0].candidate;

  const rows = lines.map((line) => line.split(delimiter).map((cell) => String(cell || '').trim()));
  return buildParsedProductRows(rows);
}

async function matchProductsAgainstMedindex(rows) {
  const matched = [];
  for (const row of rows) {
    const results = await medindex.searchMedication(row.raw_product_name);
    const normalizedQuery = normalizeProductSearchText(row.raw_product_name);
    const exactMatch =
      results.find((item) => normalizeProductSearchText(item.name) === normalizedQuery) ||
      results.find((item) => normalizeProductSearchText(item.dci) === normalizedQuery);

    if (exactMatch) {
      matched.push({
        ...row,
        product_id_medindex: exactMatch.id,
        product_name: exactMatch.name,
        match_status: 'validated',
        candidates: results.slice(0, 5),
      });
      continue;
    }

    if (results.length === 1) {
      matched.push({
        ...row,
        product_id_medindex: results[0].id,
        product_name: results[0].name,
        match_status: 'validated',
        candidates: results,
      });
      continue;
    }

    matched.push({
      ...row,
      product_id_medindex: results[0] ? results[0].id : null,
      product_name: results[0] ? results[0].name : row.raw_product_name,
      match_status: results.length ? 'pending_manual_review' : 'rejected',
      candidates: results.slice(0, 5),
    });
  }
  return matched;
}

async function uploadSupplierProductText(auth, payload) {
  const db = getDb();
  const organizationId = auth.organization.id;
  const fileName = normalizeFreeText(payload.filename || 'products.csv', 240);
  const mimeType = normalizeFreeText(payload.mime_type || 'text/csv', 120);
  const fileText = String(payload.file_text || payload.text || '');
  const isSpreadsheet = isSpreadsheetUpload(fileName, mimeType);
  let rows = [];
  let parseNotes = null;

  try {
    rows = isSpreadsheet && payload.file_base64
      ? parseSpreadsheetRowsFromBase64(payload.file_base64)
      : parseDelimitedRows(fileText);
  } catch (error) {
    parseNotes = error && error.message ? error.message : 'Spreadsheet parsing failed';
    rows = [];
  }

  const uploadedFile = await mutateSingle(
    db
      .from(TABLES.uploadedFiles)
      .insert({
        organization_id: organizationId,
        organization_type: auth.organization.organization_type,
        filename: fileName,
        mime_type: mimeType,
        storage_path: null,
        file_size_bytes: Number(payload.file_size_bytes || fileText.length || 0),
        parse_status: rows.length ? 'uploaded' : 'failed',
        matched_count: 0,
        pending_count: 0,
        rejected_count: 0,
        notes: rows.length ? null : parseNotes || 'No parseable rows found',
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      .select('*')
      .single(),
  );

  if (!rows.length) {
    await auditLog({
      actor_type: 'supplier',
      actor_id: auth.user.id,
      action: 'supplier_product_file_uploaded',
      entity_type: 'uploaded_product_file',
      entity_id: uploadedFile.id,
      payload: { parse_status: 'failed', filename: fileName },
    });
    return { uploaded_file: uploadedFile, products: [] };
  }

  const matchedRows = await matchProductsAgainstMedindex(rows);
  const createdProducts = [];
  let validatedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;

  for (const row of matchedRows) {
    const normalizedStatus = normalizeProductMatchStatus(row.match_status);
    if (normalizedStatus === 'validated') {
      validatedCount += 1;
    } else if (normalizedStatus === 'pending_manual_review') {
      pendingCount += 1;
    } else {
      rejectedCount += 1;
    }

    const product = await mutateSingle(
      normalizedStatus === 'validated' && row.product_id_medindex
        ? mutateSingle(
            db
              .from(TABLES.supplierProducts)
              .upsert(
                {
                  organization_id: organizationId,
                  product_id_medindex: row.product_id_medindex,
                  product_name: row.product_name,
                  source: isSpreadsheet ? 'uploaded_excel' : 'uploaded_csv',
                  match_status: normalizedStatus,
                  uploaded_file_id: uploadedFile.id,
                  raw_product_name: row.raw_product_name,
                  raw_row: {
                    row_number: row.row_number,
                    values: row.raw_values,
                    candidates: row.candidates,
                  },
                  validated_by: auth.user.id,
                  validated_at: nowIso(),
                  rejection_reason: null,
                  created_at: nowIso(),
                  updated_at: nowIso(),
                },
                {
                  onConflict: 'organization_id,product_id_medindex',
                  ignoreDuplicates: false,
                },
              )
              .select('*')
              .single(),
          )
        : mutateSingle(
            db
              .from(TABLES.supplierProducts)
              .insert({
                organization_id: organizationId,
                product_id_medindex: row.product_id_medindex,
                product_name: row.product_name,
                source: isSpreadsheet ? 'uploaded_excel' : 'uploaded_csv',
                match_status: normalizedStatus,
                uploaded_file_id: uploadedFile.id,
                raw_product_name: row.raw_product_name,
                raw_row: {
                  row_number: row.row_number,
                  values: row.raw_values,
                  candidates: row.candidates,
                },
                validated_by: normalizedStatus === 'validated' ? auth.user.id : null,
                validated_at: normalizedStatus === 'validated' ? nowIso() : null,
                rejection_reason:
                  normalizedStatus === 'rejected' ? 'Aucune correspondance MedIndex fiable.' : null,
                created_at: nowIso(),
                updated_at: nowIso(),
              })
              .select('*')
              .single(),
          ),
    );
    createdProducts.push(product);
  }

  const parseStatus = pendingCount > 0 ? 'pending_manual_review' : 'parsed';
  const updatedFile = await mutateSingle(
    db
      .from(TABLES.uploadedFiles)
      .update({
        parse_status: parseStatus,
        matched_count: validatedCount,
        pending_count: pendingCount,
        rejected_count: rejectedCount,
        updated_at: nowIso(),
      })
      .eq('id', uploadedFile.id)
      .select('*')
      .single(),
  );

  await auditLog({
    actor_type: 'supplier',
    actor_id: auth.user.id,
    action: 'supplier_product_file_processed',
    entity_type: 'uploaded_product_file',
    entity_id: uploadedFile.id,
    payload: {
      parse_status: parseStatus,
      validated_count: validatedCount,
      pending_count: pendingCount,
      rejected_count: rejectedCount,
    },
  });

  return {
    uploaded_file: updatedFile,
    products: createdProducts,
  };
}

async function listSupplierProducts(filters = {}) {
  const db = getDb();
  let query = db.from(TABLES.supplierProducts).select('*').order('created_at', { ascending: false });
  if (filters.organization_id) {
    query = query.eq('organization_id', filters.organization_id);
  }
  if (filters.match_status) {
    query = query.eq('match_status', normalizeProductMatchStatus(filters.match_status));
  }
  return selectMany(query, []);
}

async function updateSupplierProductStatus(productId, status, actor, rejectionReason) {
  const db = getDb();
  const nextStatus = normalizeProductMatchStatus(status);
  const row = await mutateSingle(
    db
      .from(TABLES.supplierProducts)
      .update({
        match_status: nextStatus,
        validated_by: actor && actor.id ? actor.id : null,
        validated_at: nextStatus === 'validated' ? nowIso() : null,
        rejection_reason: nextStatus === 'rejected' ? normalizeFreeText(rejectionReason, 400) : null,
        updated_at: nowIso(),
      })
      .eq('id', productId)
      .select('*')
      .single(),
  );
  await auditLog({
    actor_type: 'admin',
    actor_id: actor && actor.id ? actor.id : 'admin',
    action: 'supplier_product_status_updated',
    entity_type: 'supplier_product',
    entity_id: productId,
    payload: { status: nextStatus, rejection_reason: rejectionReason || null },
  });
  return row;
}

async function listUploadedFiles(filters = {}) {
  const db = getDb();
  let query = db.from(TABLES.uploadedFiles).select('*').order('created_at', { ascending: false });
  if (filters.organization_id) {
    query = query.eq('organization_id', filters.organization_id);
  }
  return selectMany(query, []);
}

async function getValidatedProductForOrganization(organizationId, productIdMedindex) {
  const db = getDb();
  return selectMaybeSingle(
    db
      .from(TABLES.supplierProducts)
      .select('*')
      .eq('organization_id', organizationId)
      .eq('product_id_medindex', productIdMedindex)
      .eq('match_status', 'validated')
      .maybeSingle(),
    null,
  );
}

async function listStockAlerts(filters = {}) {
  const db = getDb();
  let query = db.from(TABLES.stockAlerts).select('*').order('created_at', { ascending: false });
  if (filters.status) {
    query = query.eq('status', normalizeAlertStatus(filters.status));
  }
  if (filters.source_type) {
    query = query.eq('source_type', normalizeOrgType(filters.source_type));
  }
  if (filters.source_id) {
    query = query.eq('source_id', filters.source_id);
  }
  return selectMany(query, []);
}

async function getStockAlert(alertId) {
  const db = getDb();
  return selectMaybeSingle(
    db.from(TABLES.stockAlerts).select('*').eq('id', alertId).maybeSingle(),
    null,
  );
}

async function createStockAlert(auth, payload) {
  const sourceType = normalizeOrgType(payload.source_type || auth.organization.organization_type);
  const productIdMedindex = normalizeFreeText(payload.product_id_medindex, 120);

  if (!productIdMedindex) {
    throw Object.assign(new Error('product_id_medindex is required'), { status: 400 });
  }

  const validatedProduct = await getValidatedProductForOrganization(auth.organization.id, productIdMedindex);
  if (!validatedProduct) {
    throw Object.assign(
      new Error('Only validated MedIndex products can be used for supplier alerts.'),
      { status: 400, code: 'PRODUCT_NOT_VALIDATED' },
    );
  }

  const initialStatus = normalizeAlertStatus(payload.status || 'draft');
  const safeStatus = initialStatus === 'approved' || initialStatus === 'sending' || initialStatus === 'sent'
    ? 'pending_approval'
    : initialStatus;

  const db = getDb();
  const alert = await mutateSingle(
    db
      .from(TABLES.stockAlerts)
      .insert({
        source_type: sourceType,
        source_id: auth.organization.id,
        product_id_medindex: productIdMedindex,
        product_name: validatedProduct.product_name || normalizeFreeText(payload.product_name, 240) || productIdMedindex,
        alert_type: normalizeAlertType(payload.alert_type),
        availability_status: normalizeFreeText(payload.availability_status || 'available', 80),
        available_quantity:
          payload.available_quantity === undefined || payload.available_quantity === null || payload.available_quantity === ''
            ? null
            : Number(payload.available_quantity),
        geographic_zone: normalizeFreeText(payload.geographic_zone, 160) || null,
        comment: normalizeFreeText(payload.comment, 1000) || null,
        target_segment: normalizeFreeText(payload.target_segment, 160) || null,
        scheduled_at: payload.scheduled_at || null,
        status: safeStatus,
        created_by: auth.user.id,
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      .select('*')
      .single(),
  );

  const eligibleRecipients = await computeEligibleRecipients(alert);

  await auditLog({
    actor_type: 'supplier',
    actor_id: auth.user.id,
    action: 'stock_alert_created',
    entity_type: 'stock_alert',
    entity_id: alert.id,
    payload: {
      status: alert.status,
      estimated_recipients: eligibleRecipients.length,
      alert_type: alert.alert_type,
    },
  });

  return {
    alert,
    estimated_recipients: eligibleRecipients.length,
  };
}

async function approveStockAlert(alertId, actor) {
  const db = getDb();
  const alert = await mutateSingle(
    db
      .from(TABLES.stockAlerts)
      .update({
        status: 'approved',
        approved_at: nowIso(),
        approved_by: actor && actor.id ? actor.id : null,
        updated_at: nowIso(),
      })
      .eq('id', alertId)
      .select('*')
      .single(),
  );

  await auditLog({
    actor_type: 'admin',
    actor_id: actor && actor.id ? actor.id : 'admin',
    action: 'stock_alert_approved',
    entity_type: 'stock_alert',
    entity_id: alertId,
    payload: { status: 'approved' },
  });

  return alert;
}

async function computeEligibleRecipients(alert) {
  const db = getDb();
  const organizationId = alert.source_id;
  const category = normalizeAlertType(alert.alert_type);

  const rows = await selectMany(
    db
      .from(TABLES.pharmacistPreferences)
      .select('*')
      .eq('source_type', normalizeOrgType(alert.source_type))
      .eq('source_id', organizationId)
      .eq('category', category)
      .eq('status', 'active'),
    [],
  );

  const deduped = new Map();
  rows.forEach((row) => {
    if (row.phone_e164) {
      deduped.set(row.phone_e164, row);
    }
  });
  return Array.from(deduped.values());
}

async function buildRecipientRows(alert, recipients, templateKey, variables) {
  return recipients.map((preference, index) => ({
    alert_id: alert.id,
    pharmacist_id: preference.pharmacist_id || derivePharmacistId(preference.phone_e164),
    phone_e164: preference.phone_e164,
    template_key: templateKey,
    variables,
    status: normalizeRecipientStatus('eligible'),
    batch_number: Math.floor(index / DEFAULT_BATCH_SIZE) + 1,
    created_at: nowIso(),
    updated_at: nowIso(),
  }));
}

function buildTemplateVariables(alert, organization) {
  return {
    '1': organization.name || 'Blink Pharma',
    '2': alert.product_name || alert.product_id_medindex,
    '3':
      normalizeFreeText(alert.comment, 160) ||
      normalizeFreeText(alert.availability_status, 120) ||
      'Information stock mise à jour',
    '4': normalizeFreeText(alert.geographic_zone, 80) || 'Maroc',
    '5': buildOptOutText(),
  };
}

async function persistRecipientRows(rows) {
  if (!rows.length) {
    return [];
  }
  const db = getDb();
  const { data, error } = await db.from(TABLES.recipients).insert(rows).select('*');
  if (error) {
    throw toAppError(error);
  }
  return Array.isArray(data) ? data : [];
}

async function logWhatsappMessage(payload) {
  const db = getDb();
  const { error } = await db.from(TABLES.messageLogs).insert({
    alert_id: payload.alert_id,
    recipient_id: payload.recipient_id || null,
    pharmacist_id: payload.pharmacist_id,
    phone_e164: payload.phone_e164,
    template_key: payload.template_key,
    variables: payload.variables || {},
    provider_message_sid: payload.provider_message_sid || null,
    status: payload.status || 'queued',
    sent_at: payload.sent_at || null,
    delivered_at: payload.delivered_at || null,
    failed_reason: payload.failed_reason || null,
    created_at: nowIso(),
  });
  if (error && !isMissingTableError(error)) {
    throw toAppError(error);
  }
}

async function updateRecipientStatusByMessageSid(messageSid, patch) {
  const db = getDb();
  return mutateSingle(
    db
      .from(TABLES.recipients)
      .update({
        status: normalizeRecipientStatus(patch.status || 'sent'),
        delivered_at: patch.delivered_at || null,
        failed_reason: patch.failed_reason || null,
        updated_at: nowIso(),
      })
      .eq('provider_message_sid', messageSid)
      .select('*')
      .maybeSingle(),
  );
}

async function updateMessageLogBySid(messageSid, patch) {
  const db = getDb();
  const { error } = await db
    .from(TABLES.messageLogs)
    .update({
      status: patch.status || 'sent',
      delivered_at: patch.delivered_at || null,
      failed_reason: patch.failed_reason || null,
    })
    .eq('provider_message_sid', messageSid);
  if (error && !isMissingTableError(error)) {
    throw toAppError(error);
  }
}

async function sendStockAlert(alertId, actor, options = {}) {
  const alert = await getStockAlert(alertId);
  if (!alert) {
    throw Object.assign(new Error('Alert not found'), { status: 404 });
  }

  if (alert.status !== 'approved' && alert.status !== 'sending') {
    throw Object.assign(new Error('Only approved alerts can be sent.'), {
      status: 400,
      code: 'ALERT_NOT_APPROVED',
    });
  }

  const organization = await getOrganization(alert.source_id);
  if (!organization) {
    throw Object.assign(new Error('Organization not found'), { status: 404 });
  }

  const templateKey = getAlertTemplateKey(alert);
  const templateMeta = TEMPLATE_KEYS[templateKey];
  const contentSid = templateMeta ? String(process.env[templateMeta.env] || '').trim() : '';
  if (!contentSid) {
    throw Object.assign(
      new Error(`Twilio template SID missing for ${templateKey}. Set ${templateMeta.env}.`),
      { status: 503, code: 'TWILIO_TEMPLATE_MISSING' },
    );
  }

  const recipients = await computeEligibleRecipients(alert);
  const variables = buildTemplateVariables(alert, organization);
  const recipientRows = await persistRecipientRows(await buildRecipientRows(alert, recipients, templateKey, variables));
  const batchSize = Math.max(1, Number(options.batch_size || DEFAULT_BATCH_SIZE));
  const db = getDb();

  await mutateSingle(
    db
      .from(TABLES.stockAlerts)
      .update({ status: 'sending', updated_at: nowIso() })
      .eq('id', alert.id)
      .select('*')
      .single(),
  );

  let sentCount = 0;
  let failedCount = 0;
  const results = [];

  for (let index = 0; index < recipientRows.length; index += batchSize) {
    const batch = recipientRows.slice(index, index + batchSize);
    for (const recipient of batch) {
      try {
        const twilioMessage = await twilioService.sendWhatsAppMessage({
          to: recipient.phone_e164,
          contentSid: contentSid,
          contentVariables: recipient.variables,
        });
        sentCount += 1;
        const updatedRecipient = await mutateSingle(
          db
            .from(TABLES.recipients)
            .update({
              status: 'sent',
              provider_message_sid: twilioMessage.sid || null,
              sent_at: nowIso(),
              updated_at: nowIso(),
            })
            .eq('id', recipient.id)
            .select('*')
            .single(),
        );
        await logWhatsappMessage({
          alert_id: alert.id,
          recipient_id: updatedRecipient.id,
          pharmacist_id: recipient.pharmacist_id,
          phone_e164: recipient.phone_e164,
          template_key: templateKey,
          variables: recipient.variables,
          provider_message_sid: twilioMessage.sid || null,
          status: twilioMessage.status || 'sent',
          sent_at: nowIso(),
        });
        results.push(updatedRecipient);
      } catch (error) {
        failedCount += 1;
        const failedReason = error && error.message ? error.message : 'Twilio send failed';
        const updatedRecipient = await mutateSingle(
          db
            .from(TABLES.recipients)
            .update({
              status: 'failed',
              failed_reason: failedReason,
              updated_at: nowIso(),
            })
            .eq('id', recipient.id)
            .select('*')
            .single(),
        );
        await logWhatsappMessage({
          alert_id: alert.id,
          recipient_id: updatedRecipient.id,
          pharmacist_id: recipient.pharmacist_id,
          phone_e164: recipient.phone_e164,
          template_key: templateKey,
          variables: recipient.variables,
          provider_message_sid: null,
          status: 'failed',
          failed_reason: failedReason,
        });
        results.push(updatedRecipient);
      }
    }
  }

  const finalStatus = failedCount && !sentCount ? 'approved' : 'sent';
  await mutateSingle(
    db
      .from(TABLES.stockAlerts)
      .update({
        status: finalStatus,
        sent_at: sentCount ? nowIso() : null,
        updated_at: nowIso(),
      })
      .eq('id', alert.id)
      .select('*')
      .single(),
  );

  await auditLog({
    actor_type: 'admin',
    actor_id: actor && actor.id ? actor.id : 'admin',
    action: 'stock_alert_sent',
    entity_type: 'stock_alert',
    entity_id: alert.id,
    payload: {
      template_key: templateKey,
      sent_count: sentCount,
      failed_count: failedCount,
    },
  });

  return {
    alert_id: alert.id,
    template_key: templateKey,
    sent_count: sentCount,
    failed_count: failedCount,
    recipients: results,
  };
}

async function handleStatusCallback(messageSid, messageStatus, metadata = {}) {
  if (!messageSid) {
    return null;
  }
  const nextStatus = messageStatus === 'delivered' ? 'delivered' : messageStatus === 'failed' ? 'failed' : 'sent';
  const patch = {
    status: nextStatus,
    delivered_at: nextStatus === 'delivered' ? nowIso() : null,
    failed_reason: metadata.error_message || metadata.failed_reason || null,
  };
  await updateRecipientStatusByMessageSid(messageSid, patch);
  await updateMessageLogBySid(messageSid, patch);
  return patch;
}

async function handleStopOptOut(phone, metadata = {}) {
  const phoneE164 = normalizePhoneToE164(phone);
  if (!phoneE164) {
    return { updated: 0 };
  }
  const db = getDb();
  const activeRows = await listPharmacistPreferences(phoneE164);
  let updated = 0;
  for (const row of activeRows) {
    if (row.status === 'opted_out') {
      continue;
    }
    const nextRow = await mutateSingle(
      db
        .from(TABLES.pharmacistPreferences)
        .update({
          status: 'opted_out',
          revoked_at: nowIso(),
          ip_address: metadata.ip_address || row.ip_address || null,
          user_agent: metadata.user_agent || row.user_agent || null,
          consent_text_version: consent.CONSENT_CURRENT_VERSION,
          updated_at: nowIso(),
        })
        .eq('id', row.id)
        .select('*')
        .single(),
    );
    await recordConsentVersion(nextRow);
    updated += 1;
  }

  await auditLog({
    actor_type: 'pharmacist',
    actor_id: derivePharmacistId(phoneE164),
    action: 'stop_opt_out',
    entity_type: 'pharmacist_alert_preferences',
    entity_id: phoneE164,
    payload: { updated_preferences: updated },
  });

  return { updated };
}

async function getDashboardSummary() {
  const [organizations, products, alerts, audits] = await Promise.all([
    listOrganizations(),
    listSupplierProducts(),
    listStockAlerts(),
    listAuditLogs(12),
  ]);

  return {
    organizations_total: organizations.length,
    organizations_pending: organizations.filter((row) => row.status === 'pending').length,
    products_pending_review: products.filter((row) => row.match_status === 'pending_manual_review').length,
    alerts_pending_approval: alerts.filter((row) => row.status === 'pending_approval').length,
    alerts_sent: alerts.filter((row) => row.status === 'sent').length,
    latest_audit_logs: audits,
    templates: getTemplateRegistry(),
  };
}

async function listAuditLogs(limit = 50) {
  const db = getDb();
  return selectMany(
    db.from(TABLES.auditLogs).select('*').order('created_at', { ascending: false }).limit(limit),
    [],
  );
}

function buildPublicHeadline(alert, organization) {
  const sourceLabel = organization && organization.organization_type === 'laboratory' ? 'Laboratoire' : 'Grossiste';
  const productName = alert.product_name || alert.product_id_medindex;
  switch (normalizeAlertType(alert.alert_type)) {
    case 'stock_recovery':
      return `${productName} de nouveau disponible`;
    case 'out_of_stock':
      return `Rupture signalée pour ${productName}`;
    case 'product_recall':
      return `Rappel produit: ${productName}`;
    case 'new_product':
      return `Nouveau produit validé: ${productName}`;
    case 'regulatory_info':
      return `Information réglementaire: ${productName}`;
    default:
      return `${sourceLabel}: ${productName}`;
  }
}

function buildPublicDescription(alert, organization) {
  const sourceName = organization ? organization.name : 'Blink Pharma';
  const zone = alert.geographic_zone ? `Zone: ${alert.geographic_zone}. ` : '';
  const qty =
    alert.available_quantity !== null && alert.available_quantity !== undefined
      ? `Quantité annoncée: ${alert.available_quantity}. `
      : '';
  const comment = normalizeFreeText(alert.comment, 240);
  if (comment) {
    return `${sourceName}. ${zone}${qty}${comment}`.trim();
  }
  return `${sourceName}. ${zone}${qty}Mise à jour publiée par un partenaire validé.`.trim();
}

async function buildPublicActuEntries(manualActus = []) {
  let alerts = [];
  try {
    alerts = await listStockAlerts();
  } catch (error) {
    if (error.code !== 'MISSING_STOCK_ALERT_TABLES') {
      console.warn('[stock-alerts:public-feed]', error.message);
    }
  }

  const organizations = await listOrganizations().catch(() => []);
  const organizationById = new Map(organizations.map((row) => [row.id, row]));
  const stockEntries = alerts
    .filter((alert) => ['approved', 'sending', 'sent'].includes(alert.status))
    .slice(0, 30)
    .map((alert) => {
      const organization = organizationById.get(alert.source_id);
      return {
        id: `stock-alert-${alert.id}`,
        titre: buildPublicHeadline(alert, organization),
        type: normalizeAlertType(alert.alert_type),
        desc: buildPublicDescription(alert, organization),
        labo: organization ? organization.name : 'Blink Pharma',
        source_name: organization ? organization.name : 'Blink Pharma',
        source_type: alert.source_type,
        date: String(alert.scheduled_at || alert.created_at || nowIso()).slice(0, 10),
        urgent: alert.alert_type === 'product_recall',
        published: true,
        priceDir: '',
        priceVal: '',
      };
    });

  const legacyEntries = (Array.isArray(manualActus) ? manualActus : []).filter((entry) => entry.published !== false);
  return [...stockEntries, ...legacyEntries].sort((left, right) => {
    const leftDate = new Date(left.date || left.createdAt || 0).getTime();
    const rightDate = new Date(right.date || right.createdAt || 0).getTime();
    return rightDate - leftDate;
  });
}

module.exports = {
  ALERT_CATEGORIES,
  ALERT_STATUSES,
  PHARMACIST_COOKIE,
  SUPPLIER_COOKIE,
  PUBLIC_CATEGORY_META,
  TEMPLATE_KEYS,
  getTemplateRegistry,
  buildPharmacistPortalUrl,
  createPharmacistPortalToken,
  getPortalPayloadFromRequest,
  redirectIfPortalTokenConsumed,
  requirePortalAuth,
  listOrganizations,
  listOrganizationUsers,
  getOrganization,
  updateOrganizationStatus,
  registerOrganization,
  listSourcesForPreferences,
  listPharmacistPreferences,
  buildPharmacistPreferencesPayload,
  upsertPharmacistPreferences,
  addManualSupplierProducts,
  uploadSupplierProductText,
  listSupplierProducts,
  listUploadedFiles,
  updateSupplierProductStatus,
  listStockAlerts,
  createStockAlert,
  approveStockAlert,
  computeEligibleRecipients,
  sendStockAlert,
  handleStatusCallback,
  handleStopOptOut,
  getDashboardSummary,
  listAuditLogs,
  buildPublicActuEntries,
};
