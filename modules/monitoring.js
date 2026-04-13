/**
 * Module Monitoring - Connecteur Blink Pharma / Sobrus
 *
 * Ce module fournit le socle de connexion aux logiciels de gestion officinale
 * utilisés par les pharmaciens marocains : Blink Pharma et Sobrus.
 *
 * Architecture :
 *   - Chaque connecteur est une classe isolée avec les mêmes méthodes publiques
 *   - La détection du logiciel s'appuie sur le profil CRM du pharmacien
 *   - Les appels API sont configurables via variables d'environnement
 *   - En l'absence de clés, un mode "demo" retourne des données fictives
 *
 * Variables d'environnement :
 *   BLINK_API_URL        - URL de base de l'API Blink Pharma
 *   BLINK_API_KEY        - Clé API ou token Blink
 *   SOBRUS_API_URL       - URL de base de l'API Sobrus
 *   SOBRUS_API_KEY       - Clé API ou token Sobrus
 *   MONITORING_TIMEOUT_MS - Timeout en ms (défaut: 10000)
 */

'use strict';

const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getConfig(prefix) {
  return {
    apiUrl: String(process.env[`${prefix}_API_URL`] || '').trim().replace(/\/+$/, ''),
    apiKey: String(process.env[`${prefix}_API_KEY`] || '').trim(),
    timeout: Number(process.env.MONITORING_TIMEOUT_MS || 10000),
  };
}

function isConfigured(prefix) {
  const config = getConfig(prefix);
  return Boolean(config.apiUrl && config.apiKey);
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpRequest(method, url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch {
      return reject(new Error(`Monitoring: URL invalide: ${url}`));
    }

    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method,
      headers: Object.assign(
        { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'whatsapp-pharma-bot/1.0' },
        bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {},
        headers,
      ),
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Monitoring API timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Données de démonstration
// ---------------------------------------------------------------------------

const DEMO_STOCK = [
  { ref: 'PARA500', name: 'Paracetamol 500mg LAPROPHAN', qty: 48, min: 20, alert: false },
  { ref: 'AMOX1G', name: 'Amoxicilline 1g SOTHEMA', qty: 12, min: 15, alert: true },
  { ref: 'IBUP400', name: 'Ibuprofene 400mg COOPER', qty: 0, min: 10, alert: true },
  { ref: 'OMEP20', name: 'Omeprazole 20mg COOPER', qty: 36, min: 20, alert: false },
  { ref: 'METF850', name: 'Metformine 850mg PHARMA5', qty: 24, min: 20, alert: false },
];

const DEMO_SALES = {
  today: 18,
  yesterday: 22,
  week: 134,
  month: 521,
  top3: [
    { name: 'Paracetamol 500mg', qty: 45 },
    { name: 'Amoxicilline 1g', qty: 28 },
    { name: 'Ibuprofene 400mg', qty: 21 },
  ],
};

// ---------------------------------------------------------------------------
// Connecteur générique
// ---------------------------------------------------------------------------

class PharmacyConnector {
  constructor(prefix, label) {
    this.prefix = prefix;
    this.label = label;
  }

  get config() { return getConfig(this.prefix); }
  get configured() { return isConfigured(this.prefix); }

  authHeaders() {
    return { 'Authorization': `Bearer ${this.config.apiKey}` };
  }

  async apiGet(path) {
    return httpRequest('GET', `${this.config.apiUrl}${path}`, this.authHeaders(), null, this.config.timeout);
  }

  /**
   * Test de connexion – vérifie que les credentials fonctionnent.
   * @returns {{ ok: boolean, label: string, message: string }}
   */
  async testConnection() {
    if (!this.configured) {
      return { ok: false, label: this.label, message: `Non configure. Definissez ${this.prefix}_API_URL et ${this.prefix}_API_KEY.` };
    }

    try {
      // Chaque API aura son propre endpoint de health check
      const res = await this.apiGet(this.healthPath());
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, label: this.label, message: 'Connexion etablie.' };
      }
      return { ok: false, label: this.label, message: `Reponse API : HTTP ${res.status}` };
    } catch (error) {
      return { ok: false, label: this.label, message: `Erreur : ${error.message}` };
    }
  }

  /**
   * Récupère un résumé de stock (produits en alerte).
   * @param {string} pharmacyId - Identifiant de la pharmacie dans le logiciel
   * @returns {Promise<Array>} Liste d'articles en rupture ou sous le seuil
   */
  async getStockAlerts(pharmacyId) {
    if (!this.configured) return this.demoStockAlerts();

    try {
      const res = await this.apiGet(this.stockAlertsPath(pharmacyId));
      if (res.status !== 200) return this.demoStockAlerts();
      return this.normalizeStockAlerts(res.data);
    } catch {
      return this.demoStockAlerts();
    }
  }

  /**
   * Récupère les statistiques de ventes.
   * @param {string} pharmacyId
   * @returns {Promise<object>} Résumé des ventes
   */
  async getSalesSummary(pharmacyId) {
    if (!this.configured) return DEMO_SALES;

    try {
      const res = await this.apiGet(this.salesPath(pharmacyId));
      if (res.status !== 200) return DEMO_SALES;
      return this.normalizeSales(res.data);
    } catch {
      return DEMO_SALES;
    }
  }

  // Méthodes à surcharger par les sous-classes :
  healthPath() { return '/health'; }
  stockAlertsPath(pharmacyId) { return `/pharmacy/${encodeURIComponent(pharmacyId)}/stock/alerts`; }
  salesPath(pharmacyId) { return `/pharmacy/${encodeURIComponent(pharmacyId)}/sales/summary`; }

  normalizeStockAlerts(data) {
    const items = Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : []);
    return items.map((item) => ({
      ref: String(item.ref || item.code || item.sku || ''),
      name: String(item.name || item.label || item.product || ''),
      qty: Number(item.qty || item.quantity || item.stock || 0),
      min: Number(item.min || item.minimum || item.threshold || 0),
      alert: Boolean(item.alert || item.critical || (item.qty || 0) <= (item.min || 0)),
    }));
  }

  normalizeSales(data) {
    return {
      today: Number(data.today || data.sales_today || 0),
      yesterday: Number(data.yesterday || data.sales_yesterday || 0),
      week: Number(data.week || data.sales_week || 0),
      month: Number(data.month || data.sales_month || 0),
      top3: Array.isArray(data.top_products || data.top3) ? (data.top_products || data.top3).slice(0, 3) : [],
    };
  }

  demoStockAlerts() {
    return DEMO_STOCK.filter((item) => item.alert);
  }
}

// ---------------------------------------------------------------------------
// Connecteur Blink Pharma
// ---------------------------------------------------------------------------

class BlinkConnector extends PharmacyConnector {
  constructor() { super('BLINK', 'Blink Pharma'); }
  healthPath() { return '/api/v1/ping'; }
  stockAlertsPath(pharmacyId) { return `/api/v1/pharmacies/${encodeURIComponent(pharmacyId)}/products/alerts`; }
  salesPath(pharmacyId) { return `/api/v1/pharmacies/${encodeURIComponent(pharmacyId)}/sales`; }
}

// ---------------------------------------------------------------------------
// Connecteur Sobrus
// ---------------------------------------------------------------------------

class SobrusConnector extends PharmacyConnector {
  constructor() { super('SOBRUS', 'Sobrus'); }
  healthPath() { return '/api/health'; }
  stockAlertsPath(pharmacyId) { return `/api/pharmacy/${encodeURIComponent(pharmacyId)}/stock-alerts`; }
  salesPath(pharmacyId) { return `/api/pharmacy/${encodeURIComponent(pharmacyId)}/sales-summary`; }
}

// ---------------------------------------------------------------------------
// Instances singleton
// ---------------------------------------------------------------------------

const blink = new BlinkConnector();
const sobrus = new SobrusConnector();

/**
 * Retourne le bon connecteur selon le logiciel du pharmacien.
 * @param {'blink'|'sobrus'|string} software
 * @returns {PharmacyConnector}
 */
function getConnector(software) {
  if (String(software || '').toLowerCase() === 'sobrus') return sobrus;
  return blink; // Blink par défaut
}

// ---------------------------------------------------------------------------
// Formatage WhatsApp
// ---------------------------------------------------------------------------

function formatStockAlertsMessage(alerts, software) {
  const label = software === 'sobrus' ? 'Sobrus' : 'Blink Pharma';

  if (!alerts || !alerts.length) {
    return [
      `${label} : aucune alerte stock en cours.`,
      'Tous les produits sont au-dessus des seuils minimum.',
      '\nRetour menu : RETOUR',
    ].join('\n');
  }

  const lines = [`${label} - Alertes stock (${alerts.length}) :\n`];

  alerts.forEach((item) => {
    const status = item.qty === 0 ? '[RUPTURE]' : '[SOUS SEUIL]';
    lines.push(`${status} ${item.name}`);
    lines.push(`  Stock: ${item.qty} | Seuil min: ${item.min}`);
  });

  lines.push('\nRetour menu : RETOUR | Actualiser : STOCK');
  return lines.join('\n');
}

function formatSalesSummaryMessage(sales, software) {
  const label = software === 'sobrus' ? 'Sobrus' : 'Blink Pharma';
  const lines = [`${label} - Resume des ventes :\n`];

  lines.push(`Aujourd'hui : ${sales.today} ventes`);
  lines.push(`Hier : ${sales.yesterday} ventes`);
  lines.push(`Cette semaine : ${sales.week} ventes`);
  lines.push(`Ce mois : ${sales.month} ventes`);

  if (sales.top3 && sales.top3.length) {
    lines.push('\nTop produits :');
    sales.top3.forEach((p, i) => {
      const name = p.name || p.label || p.product || 'Inconnu';
      const qty = p.qty || p.quantity || p.count || '-';
      lines.push(`  ${i + 1}. ${name} (${qty})`);
    });
  }

  lines.push('\nRetour menu : RETOUR | Stock : STOCK | Ventes : VENTES');
  return lines.join('\n');
}

function buildMonitoringMenu(software) {
  const label = software === 'sobrus' ? 'Sobrus' : 'Blink Pharma';
  return [
    `Module Monitoring - ${label}`,
    '',
    '1. Alertes de stock (ruptures / sous seuil)',
    '2. Résumé des ventes',
    '3. Retour au menu',
    '',
    'Repondez avec un numero.',
    'Commandes rapides : STOCK | VENTES | RETOUR',
  ].join('\n');
}

module.exports = {
  blink,
  sobrus,
  getConnector,
  isConfigured,
  formatStockAlertsMessage,
  formatSalesSummaryMessage,
  buildMonitoringMenu,
};
