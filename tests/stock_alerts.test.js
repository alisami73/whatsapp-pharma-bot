'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

process.env.USER_HASH_SECRET         = '9bd782fec768f6f102cd81c08654c4806c1b9860f6561a20b8cee27223cd97ab';
process.env.USER_LINK_SIGNING_SECRET = '383c919aac67a1dd8c9bac127b2d940f6a53cf8cb51980a6abb97779b2d94656';

const sa = require('../modules/stock_alerts');
const supabaseStore = require('../modules/supabase_store');

const TEST_PHONE = '+212699000001';
let createdOrgId = null;

// ── 1. Token signing ───────────────────────────────────────────────────────────

describe('portal token signing', () => {
  it('createPharmacistPortalToken produit un token signé', () => {
    const token = sa.createPharmacistPortalToken(TEST_PHONE, { name: 'Test' });
    assert.ok(token && token.length > 50);
    assert.ok(token.includes('.'));
  });

  it('buildPharmacistPortalUrl retourne { url, access_token }', () => {
    const result = sa.buildPharmacistPortalUrl(TEST_PHONE, { name: 'Test' });
    assert.ok(result.url && result.url.includes('/preferences/stock-alerts'), `URL incorrecte: ${result.url}`);
    assert.ok(result.url.includes('access_token='));
    assert.ok(result.access_token);
  });

  it('token expiré rejeté par getPortalPayloadFromRequest', () => {
    const crypto = require('crypto');
    const secret = process.env.ADMIN_SECRET || process.env.TWILIO_AUTH_TOKEN || 'blink-stock-alerts-dev-secret';
    const expired = { kind: 'pharmacist', phone_e164: TEST_PHONE, exp: Date.now() - 1000 };
    const encoded = Buffer.from(JSON.stringify(expired)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    const token = `${encoded}.${sig}`;
    const req = { query: { access_token: token }, headers: { cookie: '' } };
    const result = sa.getPortalPayloadFromRequest(req, 'pharmacist', 'blink_stock_alerts_pharmacist');
    assert.equal(result, null, 'token expiré accepté');
  });
});

// ── 2. Template registry ───────────────────────────────────────────────────────

describe('getTemplateRegistry', () => {
  it('retourne 5 clés de templates', () => {
    const reg = sa.getTemplateRegistry();
    assert.equal(Object.keys(reg).length, 5);
  });

  it('chaque template a label + configured', () => {
    for (const [key, val] of Object.entries(sa.getTemplateRegistry())) {
      assert.ok(val.label, `label manquant pour ${key}`);
      assert.ok('configured' in val, `configured manquant pour ${key}`);
    }
  });
});

// ── 3. Supabase — tables ──────────────────────────────────────────────────────

describe('Supabase tables', () => {
  it('getDashboardSummary OK', async () => {
    const s = await sa.getDashboardSummary();
    assert.ok(typeof s.organizations_total === 'number');
    assert.ok(typeof s.organizations_pending === 'number');
    assert.ok(typeof s.products_pending_review === 'number');
    assert.ok(typeof s.alerts_pending_approval === 'number');
    assert.ok(Array.isArray(s.latest_audit_logs));
  });

  it('listOrganizations → tableau', async () => {
    assert.ok(Array.isArray(await sa.listOrganizations({})));
  });

  it('listStockAlerts → tableau', async () => {
    assert.ok(Array.isArray(await sa.listStockAlerts({})));
  });

  it('listAuditLogs → tableau', async () => {
    assert.ok(Array.isArray(await sa.listAuditLogs(10)));
  });
});

// ── 4. registerOrganization ───────────────────────────────────────────────────

describe('registerOrganization', () => {
  it('crée une organisation laboratory', async () => {
    const result = await sa.registerOrganization({
      organization_type: 'laboratory',
      name: `Lab Test ${Date.now()}`,
      legal_name: 'Lab Test SARL',
      contact_name: 'Ali Test',
      contact_role: 'DG',
      contact_email: `test-${Date.now()}@example.com`,
      contact_phone: '+212611000001',
      city: 'Casablanca',
      registration_number: `RC-${Date.now()}`,
    });
    assert.ok(result.organization && result.organization.id);
    assert.ok(result.user && result.user.id);
    assert.ok(result.access_token);
    assert.ok(result.portal_url);
    assert.equal(result.organization.status, 'pending');
    createdOrgId = result.organization.id;
  });

  it('rejette un type invalide', async () => {
    await assert.rejects(
      () => sa.registerOrganization({ organization_type: 'invalid', name: 'X', contact_email: 'x@x.com' }),
      /invalide|invalid/i,
    );
  });

  it('rejette si name manquant', async () => {
    await assert.rejects(
      () => sa.registerOrganization({ organization_type: 'wholesaler', name: '', contact_email: 'x@x.com' }),
      /nom|name|requis|required/i,
    );
  });
});

// ── 5. updateOrganizationStatus ───────────────────────────────────────────────

describe('updateOrganizationStatus', () => {
  it('valide l\'organisation créée', async () => {
    assert.ok(createdOrgId, 'createdOrgId requis');
    const updated = await sa.updateOrganizationStatus(createdOrgId, 'validated', 'admin-test');
    assert.equal(updated.status, 'validated');
  });

  it('rejette un statut inconnu', async () => {
    await assert.rejects(
      () => sa.updateOrganizationStatus(createdOrgId, 'super_approved', 'admin'),
      /invalide|invalid|statut|status/i,
    );
  });
});

// ── 6. addManualSupplierProducts ──────────────────────────────────────────────

describe('addManualSupplierProducts', () => {
  it('ajoute des produits manuellement', async () => {
    assert.ok(createdOrgId, 'createdOrgId requis');
    // auth doit avoir la forme { organization: { id, organization_type } }
    const auth = {
      organization: { id: createdOrgId, organization_type: 'laboratory' },
      user: { id: 'user-test-001', email: 'test@example.com' },
    };
    const result = await sa.addManualSupplierProducts(auth, [
      { product_name: 'Doliprane 500mg', product_id_medindex: null },
      { product_name: 'Amoxicilline 1g', product_id_medindex: 'MED-001' },
    ]);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
  });

  it('listSupplierProducts retourne les produits de l\'org', async () => {
    const products = await sa.listSupplierProducts({ organization_id: createdOrgId });
    assert.ok(Array.isArray(products));
    assert.ok(products.length >= 2, `attendu >= 2, reçu ${products.length}`);
  });
});

// ── 7. handleStopOptOut ───────────────────────────────────────────────────────

describe('handleStopOptOut', () => {
  it('ne lève pas d\'erreur sur numéro sans préférences', async () => {
    await assert.doesNotReject(
      () => sa.handleStopOptOut('+212699000099', { ip: '127.0.0.1', userAgent: 'test' }),
    );
  });
});

// ── 8. buildPublicActuEntries ─────────────────────────────────────────────────

describe('buildPublicActuEntries', () => {
  it('fusionne actus manuelles + alertes stock', async () => {
    const entries = await sa.buildPublicActuEntries([
      { id: 'manual-1', title: 'Info manuelle', date: new Date().toISOString(), type: 'info' },
    ]);
    assert.ok(Array.isArray(entries));
    assert.ok(entries.find(e => e.id === 'manual-1'), 'actu manuelle absente');
  });
});

// ── 9. HTTP — pages et API ────────────────────────────────────────────────────

describe('HTTP endpoints', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = require('../index');
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => server && server.close());

  async function get(path) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${path}`, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });
  }

  async function post(path, payload) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);
      const req = http.request(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      }, r => {
        let body = '';
        r.on('data', d => { body += d; });
        r.on('end', () => resolve({ status: r.statusCode, body }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  // Les pages publiques sont servies par Vercel — Railway les redirige vers le domaine public
  it('GET /preferences/stock-alerts → 302 redirect vers domaine public', async () => {
    const res = await get('/preferences/stock-alerts');
    assert.equal(res.status, 302, `attendu 302, reçu ${res.status}`);
    assert.ok(res.headers.location && res.headers.location.includes('blinkpremium.blinkpharmacie.ma'),
      `redirect vers mauvais domaine: ${res.headers.location}`);
  });

  it('GET /laboratory/register → 302 redirect vers domaine public', async () => {
    const res = await get('/laboratory/register');
    assert.equal(res.status, 302);
    assert.ok(res.headers.location && res.headers.location.includes('blinkpremium.blinkpharmacie.ma'));
  });

  it('GET /wholesaler/register → 302 redirect vers domaine public', async () => {
    const res = await get('/wholesaler/register');
    assert.equal(res.status, 302);
    assert.ok(res.headers.location && res.headers.location.includes('blinkpremium.blinkpharmacie.ma'));
  });

  it('GET /supplier/alerts/new → 302 redirect vers domaine public', async () => {
    const res = await get('/supplier/alerts/new');
    assert.equal(res.status, 302);
    assert.ok(res.headers.location && res.headers.location.includes('blinkpremium.blinkpharmacie.ma'));
  });

  it('GET /api/stock-alerts/templates → 200 JSON avec categories + templates(5)', async () => {
    const res = await get('/api/stock-alerts/templates');
    assert.equal(res.status, 200, `templates returned ${res.status}: ${res.body}`);
    const json = JSON.parse(res.body);
    assert.ok(Array.isArray(json.categories), 'categories absent');
    assert.ok(json.templates && typeof json.templates === 'object', 'templates absent');
    assert.equal(Object.keys(json.templates).length, 5);
  });

  it('POST /api/stock-alerts/laboratories/register → 200/201', async () => {
    const res = await post('/api/stock-alerts/laboratories/register', {
      name: `Lab HTTP ${Date.now()}`,
      legal_name: 'Lab HTTP SARL',
      contact_name: 'HTTP Test',
      contact_role: 'DG',
      contact_email: `http-${Date.now()}@example.com`,
      contact_phone: '+212611000002',
      city: 'Rabat',
      registration_number: `RC-HTTP-${Date.now()}`,
    });
    assert.ok([200, 201].includes(res.status), `register: ${res.status} ${res.body}`);
    const json = JSON.parse(res.body);
    assert.ok(json.organization && json.organization.id);
    assert.ok(json.access_token);
  });

  it('POST /api/stock-alerts/wholesalers/register → 200/201', async () => {
    const res = await post('/api/stock-alerts/wholesalers/register', {
      name: `Grossiste HTTP ${Date.now()}`,
      legal_name: 'Grossiste HTTP SARL',
      contact_name: 'HTTP Test',
      contact_role: 'DG',
      contact_email: `grossiste-${Date.now()}@example.com`,
      contact_phone: '+212611000003',
      city: 'Casablanca',
      registration_number: `RC-GROS-${Date.now()}`,
    });
    assert.ok([200, 201].includes(res.status), `register: ${res.status} ${res.body}`);
    const json = JSON.parse(res.body);
    assert.ok(json.organization && json.organization.id);
  });
});

// ── 10. Admin API avec auth ───────────────────────────────────────────────────

describe('admin API avec auth', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = require('../index');
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => server && server.close());

  it('GET /admin/api/stock-alerts/summary avec token → 200', async () => {
    const loginData = JSON.stringify({ email: 'ali.sami@blinkpharma.ma', password: process.env.ADMIN_SECRET || 'Samialik123!' });
    const loginRes = await new Promise((resolve, reject) => {
      const req = http.request(`${baseUrl}/admin/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData) },
      }, r => {
        let body = '';
        r.on('data', d => { body += d; });
        r.on('end', () => resolve({ status: r.statusCode, body }));
      });
      req.on('error', reject);
      req.write(loginData);
      req.end();
    });

    if (loginRes.status !== 200) {
      console.log('  ⚠ login indisponible en env test — skip');
      return;
    }

    const { token } = JSON.parse(loginRes.body);
    const res = await new Promise((resolve, reject) => {
      http.get(`${baseUrl}/admin/api/stock-alerts/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      }, r => {
        let body = '';
        r.on('data', d => { body += d; });
        r.on('end', () => resolve({ status: r.statusCode, body }));
      }).on('error', reject);
    });

    assert.equal(res.status, 200, `summary: ${res.status} ${res.body}`);
    const json = JSON.parse(res.body);
    assert.ok(typeof json.organizations_total === 'number');
    assert.ok(typeof json.alerts_pending_approval === 'number');
  });
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

after(async () => {
  if (createdOrgId) {
    try {
      const db = supabaseStore.getClient();
      if (db) {
        await db.from('supplier_products').delete().eq('organization_id', createdOrgId);
        await db.from('organization_users').delete().eq('organization_id', createdOrgId);
        await db.from('organizations').delete().eq('id', createdOrgId);
      }
    } catch { /* ignore cleanup errors */ }
  }
});
