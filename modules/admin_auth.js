'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'admin_users.json');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;       // 72 hours

// ── Signed-token helpers (stateless — works on Vercel + Railway) ───────────
// Format: "v1.<base64url_payload>.<base64url_sig>"
// The payload is JSON containing {uid, email, name, role, exp}.
// Signing key = ADMIN_SECRET (falls back to a fixed default — set the env var).

function _signingKey() {
  return String(process.env.ADMIN_SECRET || process.env.SESSION_SECRET || 'blink-admin-default-secret');
}

function _signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', _signingKey()).update(data).digest('base64url');
  return 'v1.' + data + '.' + sig;
}

function _verifyToken(token) {
  if (!token || !token.startsWith('v1.')) return null;
  const rest   = token.slice(3); // strip "v1."
  const dot    = rest.lastIndexOf('.');
  if (dot < 1) return null;
  const data   = rest.slice(0, dot);
  const sig    = rest.slice(dot + 1);
  const expected = crypto.createHmac('sha256', _signingKey()).update(data).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── File helpers ───────────────────────────────────────────────────────────

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Silently ignore on read-only filesystems (Vercel)
  }
}

// ── Password ───────────────────────────────────────────────────────────────

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(String(password)).digest('hex');
}

// ── Users ──────────────────────────────────────────────────────────────────

async function getUsers() {
  return readJson(USERS_FILE, []);
}

async function saveUsers(users) {
  await writeJson(USERS_FILE, users);
}

function publicUser(u) {
  const { password_hash, password_salt, ...pub } = u;
  return pub;
}

async function findByEmail(email) {
  const users = await getUsers();
  return users.find(u => u.email.toLowerCase() === email.toLowerCase().trim()) || null;
}

async function findById(id) {
  const users = await getUsers();
  return users.find(u => u.id === id) || null;
}

async function createUser({ email, name, role = 'admin', status = 'active', password = null, pages = null }) {
  const users = await getUsers();
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: crypto.randomUUID(),
    email: email.toLowerCase().trim(),
    name: String(name || email).trim(),
    role,
    pages: Array.isArray(pages) && pages.length > 0 ? pages : null,
    status,
    password_hash: password ? hashPassword(password, salt) : null,
    password_salt: salt,
    invite_token: null,
    invite_expires_at: null,
    created_at: new Date().toISOString(),
    last_login_at: null,
  };
  users.push(user);
  await saveUsers(users);
  return user;
}

async function verifyPassword(email, password) {
  const inputEmail = String(email || '').toLowerCase().trim();
  const inputPass  = String(password || '');

  // ── Env-var superadmin — works on any filesystem (Vercel included) ────────
  // Supports both ADMIN_USERNAME=ali.sami@blinkpharma.ma (@ directly)
  // and the older ADMIN_USERNAME=ali.sami&blinkpharma.ma (& as @ workaround).
  const rawUsername = String(process.env.BLINK_ADMIN_EMAIL || process.env.ADMIN_USERNAME || '');
  const envEmail    = rawUsername.replace('&', '@').toLowerCase().trim();
  const envSecret   = String(process.env.ADMIN_SECRET || '').trim();

  console.log('[admin-auth] login attempt:', {
    inputEmail,
    envEmail_prefix: envEmail ? envEmail.slice(0, 8) + '…' : '(not set)',
    envEmail_length: envEmail.length,
    inputEmail_length: inputEmail.length,
    email_match:     inputEmail === envEmail,
    envSecret_length: envSecret.length,
    inputPass_length: inputPass.length,
    pass_match:      inputPass === envSecret,
  });

  if (envEmail && envSecret && inputEmail === envEmail && inputPass === envSecret) {
    return {
      id: 'superadmin-env', email: envEmail, name: 'Super Admin',
      role: 'superadmin', status: 'active', last_login_at: new Date().toISOString(),
    };
  }

  // ── Regular file-based users ───────────────────────────────────────────────
  const user = await findByEmail(inputEmail);
  if (!user || user.status !== 'active' || !user.password_hash) return null;
  if (hashPassword(inputPass, user.password_salt) !== user.password_hash) return null;
  const users = await getUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx !== -1) {
    users[idx].last_login_at = new Date().toISOString();
    await saveUsers(users);
  }
  return user;
}

// ── Sessions (stateless signed tokens) ────────────────────────────────────

async function createSession(userId) {
  // Build the user snapshot for embedding in the token
  let snapshot;
  if (userId === 'superadmin-env') {
    const envEmail = String(process.env.BLINK_ADMIN_EMAIL || process.env.ADMIN_USERNAME || '').replace('&', '@').toLowerCase().trim();
    snapshot = { uid: userId, email: envEmail, name: 'Super Admin', role: 'superadmin' };
  } else {
    const u = await findById(userId);
    if (!u) throw new Error('User not found');
    snapshot = { uid: u.id, email: u.email, name: u.name, role: u.role };
  }
  snapshot.exp = Date.now() + SESSION_TTL_MS;
  return _signToken(snapshot);
}

async function verifySession(token) {
  if (!token || typeof token !== 'string') return null;

  // ── Signed stateless token (v1.*) — primary path ──────────────────────────
  const payload = _verifyToken(token);
  if (payload) {
    if (payload.uid === 'superadmin-env') {
      // Validate the env secret is still configured
      const envEmail = String(process.env.BLINK_ADMIN_EMAIL || process.env.ADMIN_USERNAME || '').replace('&', '@').toLowerCase().trim();
      if (!envEmail || payload.email !== envEmail) return null;
      return { id: 'superadmin-env', email: payload.email, name: payload.name || 'Super Admin', role: 'superadmin', status: 'active' };
    }
    // File-based user: verify they're still active
    const user = await findById(payload.uid);
    if (user && user.status === 'active') return user;
    return null;
  }

  return null;
}

async function deleteSession(_token) {
  // Stateless tokens can't be revoked server-side without a denylist.
  // On Railway, we could maintain a denylist file; on Vercel that's impractical.
  // Logout is handled client-side by clearing localStorage.
  return;
}

// ── Invitations ────────────────────────────────────────────────────────────

async function createInviteToken(email, name, role = 'admin', pages = null) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires_at = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const users = await getUsers();
  const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase().trim());
  const normalizedPages = Array.isArray(pages) && pages.length > 0 ? pages : null;

  if (idx !== -1) {
    if (users[idx].status === 'active') throw new Error('Cet email est déjà un utilisateur actif');
    users[idx].status = 'invited';
    users[idx].invite_token = token;
    users[idx].invite_expires_at = expires_at;
    users[idx].name = name || users[idx].name;
    users[idx].pages = normalizedPages;
    await saveUsers(users);
    return { token, user: users[idx] };
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: crypto.randomUUID(),
    email: email.toLowerCase().trim(),
    name: String(name || email).trim(),
    role,
    pages: normalizedPages,
    status: 'invited',
    password_hash: null,
    password_salt: salt,
    invite_token: token,
    invite_expires_at: expires_at,
    created_at: new Date().toISOString(),
    last_login_at: null,
  };
  users.push(user);
  await saveUsers(users);
  return { token, user };
}

async function acceptInvite(token, password) {
  const users = await getUsers();
  const idx = users.findIndex(u => u.invite_token === token);
  if (idx === -1) return null;
  if (!['invited', 'pending'].includes(users[idx].status)) return null;
  if (users[idx].invite_expires_at && new Date(users[idx].invite_expires_at).getTime() < Date.now()) return null;

  const salt = crypto.randomBytes(16).toString('hex');
  users[idx].password_hash = hashPassword(password, salt);
  users[idx].password_salt = salt;
  users[idx].status = 'active';
  users[idx].invite_token = null;
  users[idx].invite_expires_at = null;
  await saveUsers(users);
  return users[idx];
}

async function getUserByInviteToken(token) {
  const users = await getUsers();
  return users.find(u => u.invite_token === token) || null;
}

// ── Access requests ────────────────────────────────────────────────────────

async function requestAccess(email, name) {
  const existing = await findByEmail(email);
  if (existing) {
    if (existing.status === 'active') throw new Error('already_active');
    if (existing.status === 'pending') throw new Error('already_pending');
    if (existing.status === 'invited') throw new Error('already_invited');
    throw new Error('already_exists');
  }
  return createUser({ email, name, role: 'admin', status: 'pending' });
}

async function approveUser(userId) {
  const users = await getUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return null;
  const token = crypto.randomBytes(24).toString('hex');
  users[idx].status = 'invited';
  users[idx].invite_token = token;
  users[idx].invite_expires_at = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  await saveUsers(users);
  return { user: users[idx], token };
}

async function updateUserStatus(userId, status) {
  const users = await getUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return null;
  users[idx].status = status;
  await saveUsers(users);
  return publicUser(users[idx]);
}

async function deleteUser(userId) {
  const users = await getUsers();
  const next = users.filter(u => u.id !== userId);
  if (next.length === users.length) return false;
  await saveUsers(next);
  return true;
}

// ── Bootstrap super-admin from env vars ───────────────────────────────────

async function bootstrapSuperAdmin() {
  const email = String(process.env.BLINK_ADMIN_EMAIL || process.env.ADMIN_USERNAME || '').replace('&', '@').trim();
  const password = String(process.env.ADMIN_SECRET || '').trim();
  if (!email || !password) return;

  const users = await getUsers();
  const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());

  if (idx === -1) {
    const salt = crypto.randomBytes(16).toString('hex');
    users.push({
      id: crypto.randomUUID(),
      email: email.toLowerCase(),
      name: 'Super Admin',
      role: 'superadmin',
      status: 'active',
      password_hash: hashPassword(password, salt),
      password_salt: salt,
      invite_token: null,
      invite_expires_at: null,
      created_at: new Date().toISOString(),
      last_login_at: null,
    });
    await saveUsers(users);
    console.info('[admin-auth] super-admin créé depuis ADMIN_USERNAME/ADMIN_SECRET');
  } else {
    const salt = crypto.randomBytes(16).toString('hex');
    users[idx].password_hash = hashPassword(password, salt);
    users[idx].password_salt = salt;
    users[idx].status = 'active';
    users[idx].role = 'superadmin';
    await saveUsers(users);
  }
}

module.exports = {
  getUsers,
  createUser,
  verifyPassword,
  createSession,
  verifySession,
  deleteSession,
  createInviteToken,
  acceptInvite,
  getUserByInviteToken,
  requestAccess,
  approveUser,
  updateUserStatus,
  deleteUser,
  bootstrapSuperAdmin,
  publicUser,
};
