const path = require('path');
const express = require('express');
const { spawn } = require('child_process');

const storage = require('./storage');
const supabaseStore = require('./modules/supabase_store');
const twilioService = require('./twilio_service');
const medindex = require('./modules/medindex');
const monitoring = require('./modules/monitoring');
const consent = require('./modules/consent');
const onboardingFlow = require('./modules/onboarding_flow');
const adminAuth = require('./modules/admin_auth');
const cnss = require('./modules/cnss');
const legalKb = require('./modules/legal_kb');
const adminKbStore = require('./modules/admin_kb_store');
const runtimePaths = require('./modules/runtime_paths');
const stockAlerts = require('./modules/stock_alerts');

const router = express.Router();
const adminDir = path.join(__dirname, 'admin');

// ---------------------------------------------------------------------------
// Auth middleware — Bearer token in Authorization header
// ---------------------------------------------------------------------------

function extractToken(req) {
  const h = String(req.headers.authorization || '');
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  // Also accept cookie for browser navigation (no Authorization header on GET pages)
  const cookieHeader = String(req.headers.cookie || '');
  const m = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

async function requireAdminAuth(req, res, next) {
  const token = extractToken(req);
  const user = await adminAuth.verifySession(token);
  if (!user) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Non authentifié', redirect: '/admin/login' });
    }
    return res.redirect('/admin/login');
  }
  req.adminUser = user;
  next();
}

// Static assets served before auth (CSS, JS, images — not HTML pages)
router.use((req, res, next) => {
  const ext = require('path').extname(req.path).toLowerCase();
  if (['.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2'].includes(ext)) {
    return express.static(adminDir)(req, res, next);
  }
  next();
});

// Public routes (no auth required)
const PUBLIC_PATHS = ['/login', '/register', '/request-access',
  '/api/auth/login', '/api/auth/register', '/api/auth/request-access',
  '/api/auth/invite-info', '/api/auth/env-check'];

router.use((req, res, next) => {
  if (PUBLIC_PATHS.some(p => req.path === p || req.path.startsWith(p))) return next();
  requireAdminAuth(req, res, next);
});

// AMMPS role: restrict to /ammps and /api/ammps only
router.use((req, res, next) => {
  if (!req.adminUser || req.adminUser.role !== 'ammps') return next();
  const ammpsAllowed = req.path.startsWith('/ammps') || req.path.startsWith('/api/ammps') || req.path.startsWith('/api/auth');
  if (!ammpsAllowed) {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Accès restreint au portail AMMPS' });
    return res.redirect('/admin/ammps');
  }
  next();
});

// ---------------------------------------------------------------------------
// Auth routes (public)
// ---------------------------------------------------------------------------

router.get('/login', (req, res) => res.sendFile(path.join(adminDir, 'login.html')));
router.get('/register', (req, res) => res.sendFile(path.join(adminDir, 'register.html')));
router.get('/request-access', (req, res) => res.sendFile(path.join(adminDir, 'register.html')));

router.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '').trim();
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const user = await adminAuth.verifyPassword(email, password);
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects ou compte inactif' });

  const token = await adminAuth.createSession(user.id);
  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ token, user: adminAuth.publicUser(user) });
}));

router.post('/api/auth/logout', asyncHandler(async (req, res) => {
  const token = extractToken(req);
  if (token) await adminAuth.deleteSession(token);
  res.clearCookie('admin_token');
  res.json({ ok: true });
}));

router.get('/api/auth/me', asyncHandler(async (req, res) => {
  const token = extractToken(req);
  const user = await adminAuth.verifySession(token);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  res.json(adminAuth.publicUser(user));
}));

// TEMPORARY DIAGNOSTIC — remove after login is fixed
router.get('/api/auth/env-check', (req, res) => {
  const u1 = process.env.BLINK_ADMIN_EMAIL || '';
  const u2 = process.env.ADMIN_USERNAME    || '';
  const s  = process.env.ADMIN_SECRET      || '';
  res.json({
    BLINK_ADMIN_EMAIL: { set: u1.length > 0, length: u1.length, prefix: u1.slice(0, 6) + '…' },
    ADMIN_USERNAME:    { set: u2.length > 0, length: u2.length },
    ADMIN_SECRET:      { set: s.length > 0,  length: s.length },
  });
});

router.get('/api/auth/invite-info', asyncHandler(async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Token manquant' });
  const user = await adminAuth.getUserByInviteToken(token);
  if (!user) return res.status(404).json({ error: 'Lien invalide ou expiré' });
  if (user.invite_expires_at && new Date(user.invite_expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'Lien expiré' });
  }
  res.json({ email: user.email, name: user.name });
}));

router.post('/api/auth/register', asyncHandler(async (req, res) => {
  const token = String(req.body.token || '').trim();
  const password = String(req.body.password || '').trim();
  const name = String(req.body.name || '').trim();
  if (!token || !password) return res.status(400).json({ error: 'Token et mot de passe requis' });
  if (password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court (8 caractères min)' });

  const user = await adminAuth.acceptInvite(token, password);
  if (!user) return res.status(400).json({ error: 'Lien invalide ou expiré' });

  const sessionToken = await adminAuth.createSession(user.id);
  res.json({ token: sessionToken, user: adminAuth.publicUser(user) });
}));

router.post('/api/auth/request-access', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim();
  const name = String(req.body.name || '').trim();
  if (!email) return res.status(400).json({ error: 'Email requis' });

  try {
    const user = await adminAuth.requestAccess(email, name);
    console.info('[admin-auth] demande d\'accès reçue', { email, name });
    res.status(201).json({ ok: true, status: user.status });
  } catch (err) {
    const MAP = {
      already_active: 'Ce compte est déjà actif. Connectez-vous.',
      already_pending: 'Une demande est déjà en attente pour cet email.',
      already_invited: 'Une invitation a déjà été envoyée à cet email.',
    };
    res.status(409).json({ error: MAP[err.message] || err.message });
  }
}));

// ---------------------------------------------------------------------------
// User management routes (auth required — middleware above applies)
// ---------------------------------------------------------------------------

router.get('/users', (req, res) => res.sendFile(path.join(adminDir, 'users.html')));

router.get('/api/users', asyncHandler(async (req, res) => {
  const users = await adminAuth.getUsers();
  res.json(users.map(adminAuth.publicUser));
}));

router.post('/api/users/invite', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim();
  const name = String(req.body.name || '').trim();
  const role = ['superadmin', 'admin'].includes(req.body.role) ? req.body.role : 'admin';

  if (!email) return res.status(400).json({ error: 'Email requis' });

  try {
    const { token, user } = await adminAuth.createInviteToken(email, name, role);
    const base = String(process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const inviteUrl = `${base}/admin/register?token=${token}`;

    await sendInviteEmail(email, user.name, inviteUrl, req.adminUser.name);
    console.info('[admin-auth] invitation envoyée', { email, inviteUrl });
    res.status(201).json({ ok: true, invite_url: inviteUrl, user: adminAuth.publicUser(user) });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
}));

router.post('/api/users/:id/approve', asyncHandler(async (req, res) => {
  const result = await adminAuth.approveUser(req.params.id);
  if (!result) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const base = String(process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const inviteUrl = `${base}/admin/register?token=${result.token}`;
  await sendInviteEmail(result.user.email, result.user.name, inviteUrl, req.adminUser.name);

  res.json({ ok: true, invite_url: inviteUrl, user: adminAuth.publicUser(result.user) });
}));

router.put('/api/users/:id/status', asyncHandler(async (req, res) => {
  const status = String(req.body.status || '').trim();
  if (!['active', 'disabled'].includes(status)) return res.status(400).json({ error: 'Status invalide' });
  const user = await adminAuth.updateUserStatus(req.params.id, status);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(user);
}));

router.delete('/api/users/:id', asyncHandler(async (req, res) => {
  if (req.adminUser.role !== 'superadmin') return res.status(403).json({ error: 'Réservé au super-admin' });
  const ok = await adminAuth.deleteUser(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.status(204).send();
}));

// ── Email invitation helper ────────────────────────────────────────────────

async function sendInviteEmail(toEmail, toName, inviteUrl, fromName) {
  try {
    const { getContactEmailConfig, createTransport, sendContactLeadViaMicrosoftGraph } = require('./modules/contact_leads');
    const config = getContactEmailConfig();
    const subject = 'Invitation — Espace Admin Blink Premium';
    const html = `
<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:560px;line-height:1.6;">
  <h2 style="color:#18654b;">Vous avez été invité(e)</h2>
  <p>Bonjour ${toName || toEmail},</p>
  <p><strong>${fromName || 'Un administrateur'}</strong> vous invite à accéder à l'espace d'administration Blink Premium.</p>
  <p style="margin:24px 0;">
    <a href="${inviteUrl}" style="background:#18654b;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">
      Créer mon mot de passe →
    </a>
  </p>
  <p style="color:#6b7280;font-size:0.875rem;">Ce lien expire dans 72 heures.<br>Si vous n'attendiez pas cette invitation, ignorez cet email.</p>
</div>`.trim();
    const mail = { to: toEmail, from: config.from, subject, text: `${subject}\n\nLien : ${inviteUrl}\n(expire dans 72h)`, html };
    if (config.provider === 'msgraph') {
      await sendContactLeadViaMicrosoftGraph(mail, config);
    } else {
      const transport = createTransport(config);
      await transport.sendMail(mail);
    }
  } catch (err) {
    console.error('[admin-auth] échec envoi email invitation', { to: toEmail, error: err.message });
  }
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', '1', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function parseKeywords(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateThemePayload(body) {
  const title = String(body.title || '').trim();

  if (!title) {
    return { error: 'title is required' };
  }

  return {
    value: {
      title,
      active: parseBoolean(body.active),
      intro_message: String(body.intro_message || '').trim(),
      current_focus: String(body.current_focus || '').trim(),
      requires_auth: parseBoolean(body.requires_auth),
      allow_free_question:
        body.allow_free_question === undefined
          ? true
          : parseBoolean(body.allow_free_question),
      allow_subscription: parseBoolean(body.allow_subscription),
    },
  };
}

function validateTopicPayload(body) {
  const title = String(body.title || '').trim();

  if (!title) {
    return { error: 'title is required' };
  }

  return {
    value: {
      title,
      answer: String(body.answer || '').trim(),
      keywords: parseKeywords(body.keywords),
    },
  };
}

function validateFaqPublishPayload(body) {
  const title = String(body.title || body.question || '').trim();
  const question = String(body.question || body.title || '').trim();
  const answer = String(body.answer || '').trim();

  if (!title) {
    return { error: 'title is required' };
  }

  if (!question) {
    return { error: 'question is required' };
  }

  if (!answer) {
    return { error: 'answer is required' };
  }

  return {
    value: {
      title,
      question,
      answer,
      keywords: parseKeywords(body.keywords),
    },
  };
}

function validateSendMessagePayload(body) {
  const phone = String(body.phone || '').trim();
  const themeId = String(body.theme_id || '').trim();
  const customMessage = String(body.custom_message || '').trim();

  if (!phone) {
    return { error: 'phone is required' };
  }

  if (!themeId) {
    return { error: 'theme_id is required' };
  }

  return {
    value: {
      phone,
      themeId,
      customMessage,
    },
  };
}

function buildThemeOutboundMessage(theme, customMessage) {
  const lines = [theme.title];

  if (theme.intro_message) {
    lines.push(theme.intro_message);
  }

  if (theme.current_focus) {
    lines.push(`Focus actuel: ${theme.current_focus}`);
  }

  if (customMessage) {
    lines.push(customMessage);
  }

  return lines.join('\n\n');
}

function refreshThemeKnowledgeCaches(themeId) {
  if (themeId === 'fse' || themeId === 'conformites') {
    cnss.reloadFaqContext(themeId);
  }
  legalKb.invalidateCaches();
}

async function runLegalReindex(themeId) {
  const job = await adminKbStore.recordJob({
    theme_id: themeId,
    type: 'legal_reindex',
    status: 'running',
    summary: 'Réindexation conformité en cours',
    details: {
      embedding_deployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || process.env.OPENAI_EMBEDDING_MODEL || null,
      low_ocr_active: Boolean(
        process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
      ),
    },
  });

  const scriptPath = path.join(runtimePaths.ROOT_DIR, 'scripts', 'reindex_legal_kb.js');

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, '--skip-build', '--no-backup'], {
      cwd: runtimePaths.ROOT_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('error', async (error) => {
      await adminKbStore.recordJob({
        id: job.id,
        theme_id: themeId,
        type: 'legal_reindex',
        status: 'failed',
        summary: 'Réindexation conformité échouée',
        details: {
          error: error.message,
          stdout,
          stderr,
        },
      });
      reject(error);
    });

    child.on('close', async (code) => {
      if (code === 0) {
        let report = null;
        try {
          report = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() || 'null');
        } catch {}
        await adminKbStore.recordJob({
          id: job.id,
          theme_id: themeId,
          type: 'legal_reindex',
          status: 'success',
          summary: 'Réindexation conformité terminée',
          details: {
            code,
            report,
            stderr: stderr.trim() || null,
          },
        });
        resolve({ code, report, stderr: stderr.trim() || null });
        return;
      }

      const error = new Error(stderr.trim() || stdout.trim() || 'Legal reindex failed');
      await adminKbStore.recordJob({
        id: job.id,
        theme_id: themeId,
        type: 'legal_reindex',
        status: 'failed',
        summary: 'Réindexation conformité échouée',
        details: {
          code,
          stdout,
          stderr,
        },
      });
      reject(error);
    });
  });
}

async function appendMessageLogSafely(payload) {
  try {
    return await storage.appendMessageLog(payload);
  } catch (error) {
    console.warn(
      '[admin-message-log]',
      JSON.stringify({
        action: 'append_skipped',
        reason: error.code || error.message,
      }),
    );
    return null;
  }
}

async function updateMessageLogSafely(logId, patch) {
  if (!logId) {
    return null;
  }

  try {
    return await storage.updateMessageLog(logId, patch);
  } catch (error) {
    console.warn(
      '[admin-message-log]',
      JSON.stringify({
        action: 'update_skipped',
        logId,
        reason: error.code || error.message,
      }),
    );
    return null;
  }
}

router.get('/', (req, res) => {
  res.sendFile(path.join(adminDir, 'index.html'));
});

router.get('/themes', (req, res) => {
  res.sendFile(path.join(adminDir, 'themes.html'));
});

router.get('/content', (req, res) => {
  res.sendFile(path.join(adminDir, 'content.html'));
});

router.get('/crm', (req, res) => {
  res.sendFile(path.join(adminDir, 'crm.html'));
});

router.get('/templates', (req, res) => {
  res.sendFile(path.join(adminDir, 'templates.html'));
});

router.get('/monitoring', (req, res) => {
  res.sendFile(path.join(adminDir, 'monitoring.html'));
});

router.get('/refopposables', (req, res) => {
  res.sendFile(path.join(adminDir, 'refopposables.html'));
});

router.get('/identity', (req, res) => {
  res.sendFile(path.join(adminDir, 'identity.html'));
});

// ── Identity API ──────────────────────────────────────────────────────────────
function _identityDb() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

router.get('/api/identity/stats', asyncHandler(async (req, res) => {
  const db = _identityDb();
  if (!db) return res.json({ error: 'Supabase non configuré' });

  const [usersRes, visitsRes] = await Promise.all([
    db.from('user_identities').select('consent_status, last_seen_at'),
    db.from('user_visits').select('id', { count: 'exact', head: true }),
  ]);

  const users = usersRes.data || [];
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    total_users: users.length,
    accepted_consent: users.filter(u => u.consent_status === 'accepted').length,
    seen_today: users.filter(u => u.last_seen_at && u.last_seen_at.startsWith(today)).length,
    total_visits: visitsRes.count || 0,
  });
}));

router.get('/api/identity/users', asyncHandler(async (req, res) => {
  const db = _identityDb();
  if (!db) return res.json({ users: [] });
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
  const { data, error } = await db.from('user_identities')
    .select('id, phone_hash, profile_name, consent_status, first_seen_at, last_seen_at')
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data || [] });
}));

router.get('/api/identity/users/:userId', asyncHandler(async (req, res) => {
  const db = _identityDb();
  if (!db) return res.status(503).json({ error: 'Supabase non configuré' });
  const { data, error } = await db.from('user_identities')
    .select('id, phone_hash, profile_name, consent_status, consent_version, consent_channel, first_seen_at, last_seen_at, metadata')
    .eq('id', req.params.userId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
}));

router.get('/api/identity/users/:userId/visits', asyncHandler(async (req, res) => {
  const db = _identityDb();
  if (!db) return res.json({ visits: [] });
  const { data } = await db.from('user_visits')
    .select('id, page_url, referrer, source, campaign, visited_at')
    .eq('user_id', req.params.userId)
    .order('visited_at', { ascending: false })
    .limit(50);
  res.json({ visits: data || [] });
}));

router.get('/api/identity/users/:userId/events', asyncHandler(async (req, res) => {
  const db = _identityDb();
  if (!db) return res.json({ events: [] });
  const { data } = await db.from('user_events')
    .select('id, event_name, event_data, page_url, created_at')
    .eq('user_id', req.params.userId)
    .order('created_at', { ascending: false })
    .limit(50);
  res.json({ events: data || [] });
}));

router.get(
  '/api/twilio/status',
  asyncHandler(async (req, res) => {
    res.json(twilioService.getPublicTwilioStatus());
  }),
);

router.get(
  '/api/themes',
  asyncHandler(async (req, res) => {
    const themes = await storage.getThemes();
    res.json(themes);
  }),
);

router.get(
  '/api/themes/:id',
  asyncHandler(async (req, res) => {
    const theme = await storage.getTheme(req.params.id);

    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    res.json(theme);
  }),
);

router.post(
  '/api/themes',
  asyncHandler(async (req, res) => {
    const validation = validateThemePayload(req.body);

    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const theme = await storage.createTheme(validation.value);
    res.status(201).json(theme);
  }),
);

router.put(
  '/api/themes/:id',
  asyncHandler(async (req, res) => {
    const validation = validateThemePayload(req.body);

    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const theme = await storage.updateTheme(req.params.id, validation.value);

    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    res.json(theme);
  }),
);

router.delete(
  '/api/themes/:id',
  asyncHandler(async (req, res) => {
    const deleted = await storage.deleteTheme(req.params.id);

    if (!deleted) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    res.status(204).send();
  }),
);

router.get(
  '/api/content',
  asyncHandler(async (req, res) => {
    const themeId = String(req.query.theme_id || '').trim();

    if (!themeId) {
      res.status(400).json({ error: 'theme_id is required' });
      return;
    }

    const theme = await storage.getTheme(themeId);

    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    const topics = await storage.getTopics(themeId);
    res.json({ theme, topics });
  }),
);

router.get(
  '/api/kb',
  asyncHandler(async (req, res) => {
    const themeId = String(req.query.theme_id || '').trim();
    if (!themeId) {
      res.status(400).json({ error: 'theme_id is required' });
      return;
    }

    const theme = await storage.getTheme(themeId);
    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    await adminKbStore.ensureMaterializedAssets();
    const manifest = await adminKbStore.readManifest();
    res.json({
      theme,
      kb: adminKbStore.buildOverview(themeId, manifest),
    });
  }),
);

router.post(
  '/api/kb/faq',
  asyncHandler(async (req, res) => {
    const themeId = String(req.query.theme_id || '').trim();
    if (!themeId) {
      res.status(400).json({ error: 'theme_id is required' });
      return;
    }

    const theme = await storage.getTheme(themeId);
    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    const validation = validateFaqPublishPayload(req.body);
    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const entry = await adminKbStore.upsertFaqEntry(themeId, validation.value);
    refreshThemeKnowledgeCaches(themeId);
    const manifest = await adminKbStore.readManifest();
    res.status(201).json({
      theme,
      entry,
      kb: adminKbStore.buildOverview(themeId, manifest),
    });
  }),
);

router.put(
  '/api/kb/faq/:themeId/:entryId',
  asyncHandler(async (req, res) => {
    const theme = await storage.getTheme(req.params.themeId);
    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    const validation = validateFaqPublishPayload(req.body);
    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const entry = await adminKbStore.upsertFaqEntry(req.params.themeId, validation.value, req.params.entryId);
    refreshThemeKnowledgeCaches(req.params.themeId);
    const manifest = await adminKbStore.readManifest();
    res.json({
      theme,
      entry,
      kb: adminKbStore.buildOverview(req.params.themeId, manifest),
    });
  }),
);

router.delete(
  '/api/kb/faq/:themeId/:entryId',
  asyncHandler(async (req, res) => {
    const theme = await storage.getTheme(req.params.themeId);
    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    const deleted = await adminKbStore.deleteFaqEntry(req.params.themeId, req.params.entryId);
    if (!deleted) {
      res.status(404).json({ error: 'FAQ entry not found' });
      return;
    }

    refreshThemeKnowledgeCaches(req.params.themeId);
    const manifest = await adminKbStore.readManifest();
    res.json({
      ok: true,
      kb: adminKbStore.buildOverview(req.params.themeId, manifest),
    });
  }),
);

router.post(
  '/api/kb/upload',
  asyncHandler(async (req, res) => {
    const themeId = String(req.query.theme_id || '').trim();
    if (!themeId) {
      res.status(400).json({ error: 'theme_id is required' });
      return;
    }

    const theme = await storage.getTheme(themeId);
    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    let document;
    try {
      document = await adminKbStore.saveUploadedDocument(themeId, req.body);
    } catch (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    let reindex = null;
    if (themeId === 'conformites') {
      try {
        reindex = await runLegalReindex(themeId);
      } catch (error) {
        refreshThemeKnowledgeCaches(themeId);
        const manifest = await adminKbStore.readManifest();
        res.status(502).json({
          error: 'Legal reindex failed',
          details: error.message,
          document,
          kb: adminKbStore.buildOverview(themeId, manifest),
        });
        return;
      }
    }

    refreshThemeKnowledgeCaches(themeId);
    const manifest = await adminKbStore.readManifest();
    res.status(201).json({
      theme,
      document,
      reindex,
      kb: adminKbStore.buildOverview(themeId, manifest),
    });
  }),
);

router.delete(
  '/api/kb/documents/:themeId/:documentId',
  asyncHandler(async (req, res) => {
    const theme = await storage.getTheme(req.params.themeId);
    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    const deleted = await adminKbStore.deleteDocument(req.params.themeId, req.params.documentId);
    if (!deleted) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    let reindex = null;
    if (req.params.themeId === 'conformites') {
      try {
        reindex = await runLegalReindex(req.params.themeId);
      } catch (error) {
        refreshThemeKnowledgeCaches(req.params.themeId);
        const manifest = await adminKbStore.readManifest();
        res.status(502).json({
          error: 'Legal reindex failed',
          details: error.message,
          kb: adminKbStore.buildOverview(req.params.themeId, manifest),
        });
        return;
      }
    }

    refreshThemeKnowledgeCaches(req.params.themeId);
    const manifest = await adminKbStore.readManifest();
    res.json({
      ok: true,
      reindex,
      kb: adminKbStore.buildOverview(req.params.themeId, manifest),
    });
  }),
);

router.post(
  '/api/content',
  asyncHandler(async (req, res) => {
    const themeId = String(req.query.theme_id || '').trim();

    if (!themeId) {
      res.status(400).json({ error: 'theme_id is required' });
      return;
    }

    const theme = await storage.getTheme(themeId);

    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    const validation = validateTopicPayload(req.body);

    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const topic = await storage.createTopic(themeId, validation.value);
    res.status(201).json(topic);
  }),
);

router.put(
  '/api/content/:themeId/:topicId',
  asyncHandler(async (req, res) => {
    const theme = await storage.getTheme(req.params.themeId);

    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    const validation = validateTopicPayload(req.body);

    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const topic = await storage.updateTopic(
      req.params.themeId,
      req.params.topicId,
      validation.value,
    );

    if (!topic) {
      res.status(404).json({ error: 'Topic not found' });
      return;
    }

    res.json(topic);
  }),
);

router.delete(
  '/api/content/:themeId/:topicId',
  asyncHandler(async (req, res) => {
    const theme = await storage.getTheme(req.params.themeId);

    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    const deleted = await storage.deleteTopic(req.params.themeId, req.params.topicId);

    if (!deleted) {
      res.status(404).json({ error: 'Topic not found' });
      return;
    }

    res.status(204).send();
  }),
);

router.get(
  '/api/messages/logs',
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 25;
    const logs = await storage.listMessageLogs(limit);
    res.json(logs);
  }),
);

router.post(
  '/api/messages/send',
  asyncHandler(async (req, res) => {
    const validation = validateSendMessagePayload(req.body);

    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const { phone, themeId, customMessage } = validation.value;
    const theme = await storage.getTheme(themeId);

    if (!theme) {
      res.status(404).json({ error: 'Theme not found' });
      return;
    }

    const twilioStatus = twilioService.getPublicTwilioStatus();

    if (!twilioStatus.configured) {
      res.status(503).json({
        error: 'Twilio is not configured',
        required: [
          'TWILIO_ACCOUNT_SID',
          'TWILIO_AUTH_TOKEN',
          'TWILIO_MESSAGING_SERVICE_SID or TWILIO_WHATSAPP_FROM',
        ],
      });
      return;
    }

    const normalizedPhone = twilioService.normalizeWhatsAppAddress(phone);
    // Exiger un consentement explicite (OUI) pour l'envoi manuel.
    // TWILIO_ALLOW_MANUAL_SEND_WITHOUT_CONSENT=true uniquement pour les tests.
    const hasExplicitConsent = await storage.hasConsent(normalizedPhone);

    if (!hasExplicitConsent && !twilioStatus.allowManualSendWithoutConsent) {
      res.status(400).json({
        error:
          'Ce numero n\'a pas encore donne son consentement explicite (OUI). Demandez a l\'utilisateur de repondre OUI au bot en premier, ou activez TWILIO_ALLOW_MANUAL_SEND_WITHOUT_CONSENT=true pour les tests.',
        consent_required: true,
      });
      return;
    }

    const body = buildThemeOutboundMessage(theme, customMessage);
    const pendingLog = await appendMessageLogSafely({
      direction: 'outbound',
      phone: normalizedPhone,
      theme_id: theme.id,
      body,
      status: 'pending_local',
      metadata: {
        source: 'admin_manual_send',
        theme_title: theme.title,
      },
    });

    try {
      const twilioMessage = await twilioService.sendWhatsAppMessage({
        to: normalizedPhone,
        body,
      });

      const updatedLog = await updateMessageLogSafely(pendingLog && pendingLog.id, {
        status: twilioMessage.status || 'queued',
        provider_message_sid: twilioMessage.sid || null,
        metadata: {
          source: 'admin_manual_send',
          theme_title: theme.title,
          twilio_direction: twilioMessage.direction || null,
        },
      });

      res.status(201).json({
        ok: true,
        messageSid: twilioMessage.sid,
        status: twilioMessage.status,
        log: updatedLog,
      });
    } catch (error) {
      const failedLog = await updateMessageLogSafely(pendingLog && pendingLog.id, {
        status: 'failed',
        error_code: error.code || null,
        error_message: error.message,
      });

      res.status(502).json({
        error: 'Twilio send failed',
        details: error.message,
        code: error.code || null,
        log: failedLog,
      });
    }
  }),
);

// ---------------------------------------------------------------------------
// Consentement — Page + API liste complète
// ---------------------------------------------------------------------------

router.get('/consents', (req, res) => res.sendFile(path.join(adminDir, 'consents.html')));

/**
 * GET /admin/api/consents
 * Retourne la liste complète de tous les enregistrements de consentement.
 */
router.get('/api/consents', asyncHandler(async (req, res) => {
  const consents = await storage.getConsents();
  res.json(consents);
}));

// ---------------------------------------------------------------------------
// Consentement - Statut et templates Meta
// ---------------------------------------------------------------------------

/**
 * GET /admin/api/consent/status/:phone
 * Retourne le statut complet de consentement d'un utilisateur.
 * Inclut : consent_status, version, rôle déclaré, dates.
 */
router.get(
  '/api/consent/status/:phone',
  asyncHandler(async (req, res) => {
    const phone = twilioService.normalizeWhatsAppAddress(req.params.phone);
    const record = await storage.getConsentRecord(phone || req.params.phone);

    if (!record) {
      res.json({
        phone: phone || req.params.phone,
        consent_status: 'unknown',
        has_consent: false,
        record: null,
      });
      return;
    }

    const hasConsent = await storage.hasConsent(phone || req.params.phone);
    const pharmacist = await storage.getPharmacist(phone || req.params.phone);

    res.json({
      phone: record.phone,
      consent_status: record.consent_status,
      has_consent: hasConsent,
      consent_version: record.consent_version || null,
      channel: record.channel,
      accepted_at: record.accepted_at || null,
      refused_at: record.refused_at || null,
      revoked_at: record.revoked_at || null,
      role_declared: record.role_declared || null,
      role_label: record.role_declared ? (consent.ROLE_LABELS[record.role_declared] || record.role_declared) : null,
      pharmacist_role: pharmacist ? pharmacist.role : null,
      record,
    });
  }),
);

/**
 * GET /admin/api/consent/templates
 * Retourne les définitions des templates Meta WhatsApp Business prêts à soumettre.
 * Ces templates sont définis dans modules/consent.js et ne nécessitent pas de stockage.
 */
router.get(
  '/api/consent/templates',
  asyncHandler(async (req, res) => {
    res.json({
      current_version: consent.CONSENT_CURRENT_VERSION,
      templates: consent.META_TEMPLATES,
      note: 'Ces templates sont a soumettre via Twilio Content Template Builder ou Meta Business Manager. Categorie UTILITY pour conformite Meta.',
    });
  }),
);

router.get(
  '/api/onboarding-flow',
  asyncHandler(async (req, res) => {
    res.json({
      configured: onboardingFlow.isOnboardingFlowConfigured(),
      content_sid: onboardingFlow.getOnboardingFlowContentSid() || null,
      spec: onboardingFlow.buildOnboardingFlowSpec(),
      note: 'Le Flow 3 ecrans doit etre cree dans Twilio Content Template Builder, puis son Content SID doit etre renseigne dans TWILIO_ONBOARDING_FLOW_CONTENT_SID.',
    });
  }),
);

// ---------------------------------------------------------------------------
// CRM - Pharmacists
// ---------------------------------------------------------------------------

router.get(
  '/api/crm/pharmacists',
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const pharmacists = await storage.listPharmacists(limit);
    res.json(pharmacists);
  }),
);

router.get(
  '/api/crm/pharmacists/:phone',
  asyncHandler(async (req, res) => {
    const phone = twilioService.normalizeWhatsAppAddress(req.params.phone);
    const pharmacist = await storage.getPharmacist(phone || req.params.phone);
    if (!pharmacist) {
      res.status(404).json({ error: 'Pharmacist not found' });
      return;
    }
    res.json(pharmacist);
  }),
);

router.put(
  '/api/crm/pharmacists/:phone',
  asyncHandler(async (req, res) => {
    const phone = twilioService.normalizeWhatsAppAddress(req.params.phone);
    const existing = await storage.getPharmacist(phone || req.params.phone);
    if (!existing) {
      res.status(404).json({ error: 'Pharmacist not found' });
      return;
    }
    const updated = await storage.savePharmacist({
      ...existing,
      name: req.body.name !== undefined ? String(req.body.name || '').trim() || null : existing.name,
      pharmacy_name: req.body.pharmacy_name !== undefined ? String(req.body.pharmacy_name || '').trim() || null : existing.pharmacy_name,
      city: req.body.city !== undefined ? String(req.body.city || '').trim() || null : existing.city,
      role: req.body.role !== undefined ? String(req.body.role || '').trim() || null : existing.role,
      software: req.body.software !== undefined ? String(req.body.software || '').trim() || null : existing.software,
      software_pharmacy_id: req.body.software_pharmacy_id !== undefined ? String(req.body.software_pharmacy_id || '').trim() || null : existing.software_pharmacy_id,
    });
    res.json(updated);
  }),
);

router.get(
  '/api/crm/stats',
  asyncHandler(async (req, res) => {
    const [pharmacists, consents, subscriptions] = await Promise.all([
      storage.getPharmacists(),
      storage.getConsents(),
      storage.getSubscriptions(),
    ]);
    res.json({
      total_pharmacists: pharmacists.length,
      onboarding_completed: pharmacists.filter((p) => p.onboarding_completed).length,
      explicit_consents: consents.filter((c) => c.source === 'explicit_consent').length,
      total_subscriptions: subscriptions.length,
      by_software: {
        blink: pharmacists.filter((p) => p.software === 'blink').length,
        sobrus: pharmacists.filter((p) => p.software === 'sobrus').length,
        autre: pharmacists.filter((p) => p.software === 'autre').length,
        unknown: pharmacists.filter((p) => !p.software).length,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// MedIndex - Statut et test de recherche
// ---------------------------------------------------------------------------

router.get(
  '/api/medindex/status',
  asyncHandler(async (req, res) => {
    res.json({
      configured: medindex.isMedindexConfigured(),
      api_url: process.env.MEDINDEX_API_URL ? '(défini)' : null,
      note: medindex.isMedindexConfigured()
        ? 'API MedIndex configuree.'
        : 'Utilise la base locale de demonstration. Configurez MEDINDEX_API_URL et MEDINDEX_API_KEY.',
    });
  }),
);

router.get(
  '/api/medindex/search',
  asyncHandler(async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) {
      res.status(400).json({ error: 'q is required' });
      return;
    }
    const results = await medindex.searchMedication(query);
    res.json({ query, results, source: medindex.isMedindexConfigured() ? 'api' : 'local_demo' });
  }),
);

// ---------------------------------------------------------------------------
// Templates Twilio / Meta WhatsApp
// ---------------------------------------------------------------------------

// Liste des templates définis en local (stockage dans data/templates.json à terme).
// Pour l'instant, CRUD en mémoire sur une structure JSON simple.

function getTemplatesFilePath() {
  const storage_module = require('./storage');
  const path_module = require('path');
  return path_module.join(storage_module.DATA_DIR, 'templates.json');
}

async function readTemplates() {
  const fs = require('fs').promises;
  const filePath = getTemplatesFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeTemplates(templates) {
  const fs = require('fs').promises;
  await fs.writeFile(getTemplatesFilePath(), JSON.stringify(templates, null, 2));
}

router.get(
  '/api/templates',
  asyncHandler(async (req, res) => {
    const templates = await readTemplates();
    res.json(templates);
  }),
);

router.post(
  '/api/templates',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const body_text = String(req.body.body_text || '').trim();
    const language = String(req.body.language || 'fr').trim();
    const category = String(req.body.category || 'UTILITY').trim();
    const content_sid = String(req.body.content_sid || '').trim();

    if (!name || !body_text) {
      res.status(400).json({ error: 'name and body_text are required' });
      return;
    }

    const templates = await readTemplates();
    const newTemplate = {
      id: `tpl-${Date.now()}`,
      name,
      body_text,
      language,
      category,
      content_sid: content_sid || null,
      created_at: new Date().toISOString(),
    };
    templates.push(newTemplate);
    await writeTemplates(templates);
    res.status(201).json(newTemplate);
  }),
);

router.delete(
  '/api/templates/:id',
  asyncHandler(async (req, res) => {
    const templates = await readTemplates();
    const next = templates.filter((t) => t.id !== req.params.id);
    if (next.length === templates.length) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    await writeTemplates(next);
    res.status(204).send();
  }),
);

// Envoi d'un template Twilio Content API (si content_sid configuré)
router.post(
  '/api/templates/:id/send',
  asyncHandler(async (req, res) => {
    const templates = await readTemplates();
    const template = templates.find((t) => t.id === req.params.id);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const phone = String(req.body.phone || '').trim();
    if (!phone) {
      res.status(400).json({ error: 'phone is required' });
      return;
    }

    const twilioStatus = twilioService.getPublicTwilioStatus();
    if (!twilioStatus.configured) {
      res.status(503).json({ error: 'Twilio non configure' });
      return;
    }

    const normalizedPhone = twilioService.normalizeWhatsAppAddress(phone);
    const sendOptions = { to: normalizedPhone };

    if (template.content_sid) {
      sendOptions.contentSid = template.content_sid;
      if (req.body.variables) {
        sendOptions.contentVariables = req.body.variables;
      }
    } else {
      sendOptions.body = template.body_text;
    }

    try {
      const msg = await twilioService.sendWhatsAppMessage(sendOptions);
      await storage.appendMessageLog({
        direction: 'outbound',
        phone: normalizedPhone,
        body: template.body_text,
        status: msg.status || 'queued',
        provider_message_sid: msg.sid,
        metadata: { source: 'admin_template_send', template_id: template.id, template_name: template.name },
      });
      res.json({ ok: true, messageSid: msg.sid, status: msg.status });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  }),
);

// ---------------------------------------------------------------------------
// Monitoring - Statut des connecteurs
// ---------------------------------------------------------------------------

router.get(
  '/api/monitoring/status',
  asyncHandler(async (req, res) => {
    const [blinkStatus, sobrusStatus] = await Promise.all([
      monitoring.blink.testConnection(),
      monitoring.sobrus.testConnection(),
    ]);
    res.json({ blink: blinkStatus, sobrus: sobrusStatus });
  }),
);

router.get(
  '/api/monitoring/:software/stock',
  asyncHandler(async (req, res) => {
    const software = req.params.software === 'sobrus' ? 'sobrus' : 'blink';
    const connector = monitoring.getConnector(software);
    const pharmacyId = String(req.query.pharmacy_id || 'demo').trim();
    const alerts = await connector.getStockAlerts(pharmacyId);
    res.json({ software, pharmacy_id: pharmacyId, alerts });
  }),
);

router.get(
  '/api/monitoring/:software/sales',
  asyncHandler(async (req, res) => {
    const software = req.params.software === 'sobrus' ? 'sobrus' : 'blink';
    const connector = monitoring.getConnector(software);
    const pharmacyId = String(req.query.pharmacy_id || 'demo').trim();
    const sales = await connector.getSalesSummary(pharmacyId);
    res.json({ software, pharmacy_id: pharmacyId, sales });
  }),
);

// ---------------------------------------------------------------------------
// Références opposables — audit trail réponses IA
// ---------------------------------------------------------------------------

router.get(
  '/api/ref-opposables',
  asyncHandler(async (req, res) => {
    // Si RAILWAY_BACKEND_URL est défini (Vercel → proxy vers Railway)
    const railwayBase = String(process.env.RAILWAY_BACKEND_URL || '').replace(/\/+$/, '');
    if (railwayBase) {
      const https = require('https');
      const http = require('http');
      const qs = new URLSearchParams(req.query).toString();
      const targetUrl = `${railwayBase}/admin/api/ref-opposables${qs ? '?' + qs : ''}`;
      const { credentials } = getAdminCredentials ? {} : {};
      const creds = getAdminCredentials();
      const authHeader = creds.secret
        ? 'Basic ' + Buffer.from(`${creds.username}:${creds.secret}`).toString('base64')
        : null;
      const lib = targetUrl.startsWith('https') ? https : http;
      return new Promise((resolve) => {
        const proxyReq = lib.get(targetUrl, {
          headers: { ...(authHeader ? { Authorization: authHeader } : {}) },
        }, (proxyRes) => {
          let data = '';
          proxyRes.on('data', (c) => { data += c; });
          proxyRes.on('end', () => {
            try { res.json(JSON.parse(data)); } catch { res.status(502).json({ error: 'proxy parse error', raw: data.slice(0, 200) }); }
            resolve();
          });
        });
        proxyReq.on('error', (err) => { res.status(502).json({ error: err.message }); resolve(); });
      });
    }

    const { phone, theme_id, limit } = req.query;
    const records = await storage.listRefOpposables({
      phone: phone ? String(phone).trim() : undefined,
      theme_id: theme_id ? String(theme_id).trim() : undefined,
      limit: limit ? Math.min(parseInt(limit, 10) || 200, 5000) : 200,
    });
    res.json({ records, total: records.length });
  }),
);

// ---------------------------------------------------------------------------
// Stock Alerts — Admin UI + API
// ---------------------------------------------------------------------------

router.get('/stock-alerts', (req, res) => {
  res.sendFile(path.join(adminDir, 'stock-alerts.html'));
});

router.get('/api/stock-alerts/summary', asyncHandler(async (req, res) => {
  res.json(await stockAlerts.getDashboardSummary());
}));

router.get('/api/stock-alerts/templates', asyncHandler(async (req, res) => {
  res.json({
    categories: stockAlerts.ALERT_CATEGORIES,
    templates: stockAlerts.getTemplateRegistry(),
  });
}));

router.post('/api/stock-alerts/pharmacist-link', asyncHandler(async (req, res) => {
  const phone = twilioService.normalizeWhatsAppAddress(req.body.phone || '');
  const name = String(req.body.name || '').trim() || null;
  if (!phone) {
    return res.status(400).json({ error: 'Numero WhatsApp requis' });
  }

  const link = stockAlerts.buildPharmacistPortalUrl(phone, { name });
  res.status(201).json({
    phone,
    ...link,
  });
}));

router.get('/api/stock-alerts/organizations', asyncHandler(async (req, res) => {
  res.json(await stockAlerts.listOrganizations({
    status: req.query.status ? String(req.query.status).trim() : undefined,
    organization_type: req.query.source_type ? String(req.query.source_type).trim() : undefined,
  }));
}));

router.post('/api/stock-alerts/organizations/:id/status', asyncHandler(async (req, res) => {
  const status = String(req.body.status || '').trim();
  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }
  res.json(await stockAlerts.updateOrganizationStatus(req.params.id, status, req.adminUser));
}));

router.get('/api/stock-alerts/products', asyncHandler(async (req, res) => {
  res.json(await stockAlerts.listSupplierProducts({
    organization_id: req.query.organization_id ? String(req.query.organization_id).trim() : undefined,
    match_status: req.query.match_status ? String(req.query.match_status).trim() : undefined,
  }));
}));

router.post('/api/stock-alerts/products/:id/status', asyncHandler(async (req, res) => {
  const status = String(req.body.status || '').trim();
  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }
  res.json(await stockAlerts.updateSupplierProductStatus(
    req.params.id,
    status,
    req.adminUser,
    req.body.rejection_reason,
  ));
}));

router.get('/api/stock-alerts/uploads', asyncHandler(async (req, res) => {
  res.json(await stockAlerts.listUploadedFiles({
    organization_id: req.query.organization_id ? String(req.query.organization_id).trim() : undefined,
  }));
}));

router.get('/api/stock-alerts/alerts', asyncHandler(async (req, res) => {
  res.json(await stockAlerts.listStockAlerts({
    status: req.query.status ? String(req.query.status).trim() : undefined,
    source_type: req.query.source_type ? String(req.query.source_type).trim() : undefined,
    source_id: req.query.source_id ? String(req.query.source_id).trim() : undefined,
  }));
}));

router.post('/api/stock-alerts/alerts/:id/approve', asyncHandler(async (req, res) => {
  res.json(await stockAlerts.approveStockAlert(req.params.id, req.adminUser));
}));

router.post('/api/stock-alerts/alerts/:id/send', asyncHandler(async (req, res) => {
  res.json(await stockAlerts.sendStockAlert(req.params.id, req.adminUser, {
    batch_size: req.body.batch_size,
  }));
}));

router.get('/api/stock-alerts/audit', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 80, 250);
  res.json(await stockAlerts.listAuditLogs(limit));
}));

// ---------------------------------------------------------------------------
// AMMPS — Portail Autorité Sanitaire (read-only, regulatory_info alerts only)
// ---------------------------------------------------------------------------

router.get('/ammps', (req, res) => {
  res.sendFile(path.join(adminDir, 'ammps.html'));
});

router.get('/api/ammps/alerts', asyncHandler(async (req, res) => {
  const filters = { alert_type: 'regulatory_info' };
  if (req.query.status) filters.status = String(req.query.status).trim();
  res.json(await stockAlerts.listStockAlerts(filters));
}));

// ---------------------------------------------------------------------------
// Actu Médicaments — CRUD
// ---------------------------------------------------------------------------

const ACTUS_FILE = require('path').join(require('./storage').DATA_DIR, 'actus.json');

const DEFAULT_ACTUS = [
  { id: '1', titre: 'Rappel de lot — Médicament Exemple 1000mg cp séc.', type: 'rappels', desc: 'Lots XXXXX — défaut de conditionnement détecté. Retour pharmacie immédiat. (Données fictives)', labo: 'Laboratoire A', date: '2025-04-28', urgent: true, published: true, priceDir: '', priceVal: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: '2', titre: 'Nouveau — Exemple® 2,5mg génériques disponibles', type: 'nouveautes', desc: 'Génériques fictifs désormais commercialisés au Maroc. Prix indicatif : xxx DH. (Données fictives)', labo: 'Laboratoire B', date: '2025-04-30', urgent: false, published: true, priceDir: '', priceVal: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: '3', titre: 'Rupture — Produit Exemple® 100µg susp. p. inh.', type: 'ruptures', desc: "Tension d'approvisionnement signalée. Reprise prévue prochainement. (Données fictives)", labo: 'Laboratoire C', date: '2025-04-29', urgent: false, published: true, priceDir: '', priceVal: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: '4', titre: 'Baisse de prix — Produit X® 20mg', type: 'prix', desc: 'Nouveau prix public : xxx DH (au lieu de xxx DH). Application immédiate. (Données fictives)', labo: 'Laboratoire D', date: '2025-04-29', urgent: false, published: true, priceDir: 'down', priceVal: '15', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: '5', titre: 'Reprise — Médicament Y® 100µg', type: 'reprises', desc: 'Stocks reconstitués chez les grossistes. Disponibilité normalisée à partir de demain. (Données fictives)', labo: 'Laboratoire E', date: '2025-04-27', urgent: false, published: true, priceDir: '', priceVal: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: '6', titre: 'Hausse de prix — Produit Z® 40mg', type: 'prix', desc: 'Réajustement tarifaire validé par le Ministère. Nouveau PPM : xx DH. (Données fictives)', labo: 'Laboratoire D', date: '2025-04-26', urgent: false, published: true, priceDir: 'up', priceVal: '6', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: '7', titre: 'Nouveau — Vaccin Exemple® disponible', type: 'nouveautes', desc: 'Vaccin adapté aux variants récents. Ordonnance médicale requise. (Données fictives)', labo: 'Laboratoire F', date: '2025-04-25', urgent: false, published: true, priceDir: '', priceVal: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: '8', titre: 'Rappel — Médicament W® 40mg lots Q1 2026', type: 'rappels', desc: "Précaution suite à un défaut de stabilité observé. Retrait du marché en cours. (Données fictives)", labo: 'Laboratoire G', date: '2025-04-24', urgent: false, published: true, priceDir: '', priceVal: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

const ACTUS_KEY = 'actus';

async function readActus() {
  // Try Supabase first
  if (supabaseStore.isEnabled()) {
    try {
      const val = await supabaseStore.read(ACTUS_KEY);
      if (val !== null) return Array.isArray(val) ? val : DEFAULT_ACTUS;
    } catch {}
  }
  // File fallback
  try {
    return JSON.parse(await require('fs').promises.readFile(ACTUS_FILE, 'utf8'));
  } catch {
    return DEFAULT_ACTUS;
  }
}

async function writeActus(actus) {
  // Supabase primary write
  if (supabaseStore.isEnabled()) {
    const ok = await supabaseStore.write(ACTUS_KEY, actus);
    if (ok) {
      // Fire-and-forget file backup
      require('fs').promises.writeFile(ACTUS_FILE, JSON.stringify(actus, null, 2)).catch(() => {});
      return;
    }
  }
  // File fallback
  try {
    await require('fs').promises.writeFile(ACTUS_FILE, JSON.stringify(actus, null, 2));
  } catch (err) {
    if (err.code === 'EROFS' || err.code === 'ENOENT' || err.code === 'EACCES') {
      throw Object.assign(
        new Error('Stockage non disponible (filesystem read-only). Configurez Supabase pour persister les données.'),
        { status: 503 },
      );
    }
    throw err;
  }
}

router.get('/actu', (req, res) => res.sendFile(require('path').join(adminDir, 'actu.html')));

router.get('/api/actus', asyncHandler(async (req, res) => {
  res.json(await readActus());
}));

router.post('/api/actus', asyncHandler(async (req, res) => {
  const { titre, type, desc, labo, date, urgent, published, priceDir, priceVal } = req.body;
  if (!titre || !type) return res.status(400).json({ error: 'titre et type requis' });
  const actus = await readActus();
  const entry = {
    id: require('crypto').randomUUID(),
    titre: String(titre).trim(),
    type: String(type).trim(),
    desc: String(desc || '').trim(),
    labo: String(labo || '').trim(),
    date: String(date || new Date().toISOString().split('T')[0]),
    urgent: Boolean(urgent),
    published: published !== false,
    priceDir: String(priceDir || ''),
    priceVal: String(priceVal || ''),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  actus.unshift(entry);
  await writeActus(actus);
  res.status(201).json(entry);
}));

router.put('/api/actus/:id', asyncHandler(async (req, res) => {
  const actus = await readActus();
  const idx = actus.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Actu introuvable' });
  const { titre, type, desc, labo, date, urgent, published, priceDir, priceVal } = req.body;
  actus[idx] = {
    ...actus[idx],
    titre: String(titre || actus[idx].titre).trim(),
    type: String(type || actus[idx].type).trim(),
    desc: String(desc !== undefined ? desc : actus[idx].desc).trim(),
    labo: String(labo !== undefined ? labo : actus[idx].labo).trim(),
    date: String(date || actus[idx].date),
    urgent: urgent !== undefined ? Boolean(urgent) : actus[idx].urgent,
    published: published !== undefined ? Boolean(published) : actus[idx].published,
    priceDir: String(priceDir !== undefined ? priceDir : actus[idx].priceDir),
    priceVal: String(priceVal !== undefined ? priceVal : actus[idx].priceVal),
    updatedAt: new Date().toISOString(),
  };
  await writeActus(actus);
  res.json(actus[idx]);
}));

router.delete('/api/actus/:id', asyncHandler(async (req, res) => {
  const actus = await readActus();
  const next = actus.filter(a => a.id !== req.params.id);
  if (next.length === actus.length) return res.status(404).json({ error: 'Actu introuvable' });
  await writeActus(next);
  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// Static files (doit rester en dernier)
// ---------------------------------------------------------------------------

router.use(express.static(adminDir));

module.exports = router;
