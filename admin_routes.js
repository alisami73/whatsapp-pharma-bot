const path = require('path');
const express = require('express');

const storage = require('./storage');
const twilioService = require('./twilio_service');
const medindex = require('./modules/medindex');
const monitoring = require('./modules/monitoring');
const consent = require('./modules/consent');

const router = express.Router();
const adminDir = path.join(__dirname, 'admin');

// ---------------------------------------------------------------------------
// Authentification HTTP Basic pour l'interface d'administration
//
// Si ADMIN_SECRET est défini dans les variables d'environnement, toutes les
// routes /admin/* nécessitent un login HTTP Basic :
//   - Utilisateur : "admin"
//   - Mot de passe : valeur de ADMIN_SECRET
//
// Si ADMIN_SECRET n'est pas défini, l'admin est accessible sans restriction
// (acceptable en dev local, à éviter en production).
// ---------------------------------------------------------------------------

function getAdminCredentials() {
  return {
    username: String(process.env.ADMIN_USERNAME || 'admin').trim(),
    secret: String(process.env.ADMIN_SECRET || '').trim(),
  };
}

function requireAdminAuth(req, res, next) {
  const { username, secret } = getAdminCredentials();

  // Pas de secret configuré → accès libre avec avertissement
  if (!secret) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[admin-auth] ADMIN_SECRET non défini — interface admin accessible sans authentification');
    }
    return next();
  }

  const authHeader = String(req.headers.authorization || '');

  if (authHeader.startsWith('Basic ')) {
    const encoded = authHeader.slice('Basic '.length);
    let decoded;
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
      decoded = '';
    }
    // Format : "<username>:<secret>" — le username peut contenir @ . & etc.
    const colonIndex = decoded.indexOf(':');
    if (colonIndex !== -1) {
      const user = decoded.slice(0, colonIndex);
      const pass = decoded.slice(colonIndex + 1);
      if (user === username && pass === secret) {
        return next();
      }
    }
  }

  // Demander les credentials
  res.set('WWW-Authenticate', 'Basic realm="Admin WhatsApp Pharma"');
  res.status(401).send('Authentification requise');
}

// Appliquer le middleware d'auth à toutes les routes admin
router.use(requireAdminAuth);

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
// Static files (doit rester en dernier)
// ---------------------------------------------------------------------------

router.use(express.static(adminDir));

module.exports = router;
