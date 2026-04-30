'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'admin_users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'admin_sessions.json');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;       // 72 hours

// ── In-memory fallback (Vercel read-only filesystem) ──────────────────────
// On Vercel serverless, writes to data/ fail silently. We keep everything
// in-memory within the process lifetime so auth still works per invocation.

const MEM_SESSIONS = new Map(); // token → { user_id, expires_at }
const MEM_USERS    = new Map(); // email → user object

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

async function createUser({ email, name, role = 'admin', status = 'active', password = null }) {
  const users = await getUsers();
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: crypto.randomUUID(),
    email: email.toLowerCase().trim(),
    name: String(name || email).trim(),
    role,
    status, // 'active' | 'pending' | 'invited' | 'disabled'
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
  const envEmail  = String(process.env.ADMIN_USERNAME || '').replace('&', '@').toLowerCase().trim();
  const envSecret = String(process.env.ADMIN_SECRET   || '').trim();
  if (envEmail && envSecret && inputEmail === envEmail && inputPass === envSecret) {
    const superAdmin = {
      id: 'superadmin-env', email: envEmail, name: 'Super Admin',
      role: 'superadmin', status: 'active', last_login_at: new Date().toISOString(),
    };
    MEM_USERS.set(envEmail, superAdmin);
    return superAdmin;
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

// ── Sessions ───────────────────────────────────────────────────────────────

async function getSessions() {
  return readJson(SESSIONS_FILE, []);
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();

  // Always store in memory (works on Vercel)
  MEM_SESSIONS.set(token, { user_id: userId, expires_at: expiresAt });

  // Also persist to file when possible (Railway)
  const sessions = (await getSessions()).filter(s => new Date(s.expires_at).getTime() > now);
  sessions.push({ token, user_id: userId, created_at: new Date().toISOString(), expires_at: expiresAt });
  await writeJson(SESSIONS_FILE, sessions);

  return token;
}

async function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const now = Date.now();

  // Check in-memory first (always works, survives Vercel within same warm instance)
  const memSess = MEM_SESSIONS.get(token);
  if (memSess && new Date(memSess.expires_at).getTime() > now) {
    const userId = memSess.user_id;
    // Env superadmin lives only in memory
    if (userId === 'superadmin-env') {
      const envEmail = String(process.env.ADMIN_USERNAME || '').replace('&', '@').toLowerCase().trim();
      const u = MEM_USERS.get(envEmail);
      return u || null;
    }
    const user = await findById(userId);
    if (user && user.status === 'active') return user;
  }

  // Fallback: file-based sessions (Railway persistent)
  const sessions = await getSessions();
  const session = sessions.find(s => s.token === token);
  if (!session || new Date(session.expires_at).getTime() < now) return null;
  // Re-cache in memory for subsequent checks
  MEM_SESSIONS.set(token, { user_id: session.user_id, expires_at: session.expires_at });
  const user = await findById(session.user_id);
  if (!user || user.status !== 'active') return null;
  return user;
}

async function deleteSession(token) {
  MEM_SESSIONS.delete(token);
  const sessions = await getSessions();
  await writeJson(SESSIONS_FILE, sessions.filter(s => s.token !== token));
}

// ── Invitations ────────────────────────────────────────────────────────────

async function createInviteToken(email, name, role = 'admin') {
  const token = crypto.randomBytes(24).toString('hex');
  const expires_at = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const users = await getUsers();
  const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase().trim());

  if (idx !== -1) {
    if (users[idx].status === 'active') throw new Error('Cet email est déjà un utilisateur actif');
    users[idx].status = 'invited';
    users[idx].invite_token = token;
    users[idx].invite_expires_at = expires_at;
    users[idx].name = name || users[idx].name;
    await saveUsers(users);
    return { token, user: users[idx] };
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: crypto.randomUUID(),
    email: email.toLowerCase().trim(),
    name: String(name || email).trim(),
    role,
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
  const email = String(process.env.ADMIN_USERNAME || '').replace('&', '@').trim();
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
    // Always sync password from env on startup so env change takes effect
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
