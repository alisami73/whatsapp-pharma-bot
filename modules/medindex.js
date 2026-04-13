/**
 * Module MedIndex - Recherche de médicaments au Maroc
 *
 * Interroge l'API MedIndex (configurable via variables d'environnement).
 * Bascule automatiquement sur une base locale de démonstration si l'API
 * n'est pas configurée, pour permettre un test immédiat sans clé API.
 *
 * Variables d'environnement attendues :
 *   MEDINDEX_API_URL  - URL de base de l'API (ex: https://api.medindex.ma/v1)
 *   MEDINDEX_API_KEY  - Clé d'authentification Bearer
 *   MEDINDEX_TIMEOUT_MS - Timeout en ms (défaut: 8000)
 */

'use strict';

const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getMedindexConfig() {
  return {
    apiUrl: String(process.env.MEDINDEX_API_URL || '').trim().replace(/\/+$/, ''),
    apiKey: String(process.env.MEDINDEX_API_KEY || '').trim(),
    timeout: Number(process.env.MEDINDEX_TIMEOUT_MS || 8000),
  };
}

function isMedindexConfigured() {
  const config = getMedindexConfig();
  return Boolean(config.apiUrl && config.apiKey);
}

// ---------------------------------------------------------------------------
// HTTP helper léger (pas de dépendance axios/node-fetch)
// ---------------------------------------------------------------------------

function httpGet(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return reject(new Error(`MedIndex: URL invalide: ${url}`));
    }

    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'GET',
      headers: Object.assign({ 'Accept': 'application/json', 'User-Agent': 'whatsapp-pharma-bot/1.0' }, headers),
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('MedIndex API timeout'));
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Normalisation des résultats API → format interne
// ---------------------------------------------------------------------------

function normalizeMedication(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: String(item.id || item.code || item.amm || ''),
    name: String(item.name || item.nom || item.denomination || item.label || ''),
    dci: String(item.dci || item.inn || item.substance || item.generic || ''),
    form: String(item.form || item.forme || item.pharmaceutical_form || ''),
    dosage: String(item.dosage || item.dosification || item.strength || ''),
    laboratory: String(item.laboratory || item.laboratoire || item.lab || item.manufacturer || ''),
    amm: String(item.amm || item.authorization_number || item.registration || ''),
    available: item.available !== false && item.disponible !== false && item.status !== 'unavailable',
    price: item.price || item.prix || item.ppv || null,
  };
}

// ---------------------------------------------------------------------------
// Recherche via l'API MedIndex
// ---------------------------------------------------------------------------

async function searchViaApi(query) {
  const config = getMedindexConfig();
  const url = `${config.apiUrl}/medications/search?q=${encodeURIComponent(query)}&limit=5&country=MA`;

  try {
    const result = await httpGet(url, { 'Authorization': `Bearer ${config.apiKey}` }, config.timeout);

    if (result.status !== 200) {
      console.warn(`[medindex] API HTTP ${result.status} pour la recherche "${query}"`);
      return null; // déclenche le fallback
    }

    // L'API peut renvoyer un tableau ou { results: [...] }
    const items = Array.isArray(result.data)
      ? result.data
      : Array.isArray(result.data && result.data.results) ? result.data.results
      : Array.isArray(result.data && result.data.data) ? result.data.data
      : [];

    return items.slice(0, 5).map(normalizeMedication).filter(Boolean);
  } catch (error) {
    console.error('[medindex] Erreur API:', error.message);
    return null; // déclenche le fallback
  }
}

// ---------------------------------------------------------------------------
// Base locale de démonstration (médicaments courants au Maroc)
// ---------------------------------------------------------------------------

const LOCAL_MEDICATIONS = [
  { id: 'para500', name: 'Paracétamol 500mg LAPROPHAN', dci: 'Paracétamol', form: 'Comprimé', dosage: '500mg', laboratory: 'LAPROPHAN', amm: 'MA-0001', available: true, price: 12 },
  { id: 'para1g', name: 'Paracétamol 1g SOTHEMA', dci: 'Paracétamol', form: 'Comprimé effervescent', dosage: '1g', laboratory: 'SOTHEMA', amm: 'MA-0002', available: true, price: 18 },
  { id: 'amox1g', name: 'Amoxicilline 1g SOTHEMA', dci: 'Amoxicilline', form: 'Comprimé dispersible', dosage: '1g', laboratory: 'SOTHEMA', amm: 'MA-0042', available: true, price: 45 },
  { id: 'amox500', name: 'Amoxicilline 500mg MAPHAR', dci: 'Amoxicilline', form: 'Gélule', dosage: '500mg', laboratory: 'MAPHAR', amm: 'MA-0043', available: true, price: 32 },
  { id: 'ibup400', name: 'Ibuprofène 400mg COOPER', dci: 'Ibuprofène', form: 'Comprimé pelliculé', dosage: '400mg', laboratory: 'COOPER', amm: 'MA-0156', available: true, price: 28 },
  { id: 'ibup200', name: 'Ibuprofène 200mg PHARMA5', dci: 'Ibuprofène', form: 'Comprimé', dosage: '200mg', laboratory: 'PHARMA5', amm: 'MA-0157', available: true, price: 22 },
  { id: 'metf850', name: 'Metformine 850mg PHARMA5', dci: 'Metformine', form: 'Comprimé', dosage: '850mg', laboratory: 'PHARMA5', amm: 'MA-0289', available: true, price: 18 },
  { id: 'metf500', name: 'Metformine 500mg LAPROPHAN', dci: 'Metformine', form: 'Comprimé', dosage: '500mg', laboratory: 'LAPROPHAN', amm: 'MA-0290', available: true, price: 14 },
  { id: 'ator20', name: 'Atorvastatine 20mg MAPHAR', dci: 'Atorvastatine', form: 'Comprimé pelliculé', dosage: '20mg', laboratory: 'MAPHAR', amm: 'MA-0445', available: false, price: 95 },
  { id: 'ator40', name: 'Atorvastatine 40mg SOTHEMA', dci: 'Atorvastatine', form: 'Comprimé pelliculé', dosage: '40mg', laboratory: 'SOTHEMA', amm: 'MA-0446', available: true, price: 125 },
  { id: 'omep20', name: 'Oméprazole 20mg COOPER', dci: 'Oméprazole', form: 'Gélule gastrorésistante', dosage: '20mg', laboratory: 'COOPER', amm: 'MA-0512', available: true, price: 55 },
  { id: 'amlod5', name: 'Amlodipine 5mg SOTHEMA', dci: 'Amlodipine', form: 'Comprimé', dosage: '5mg', laboratory: 'SOTHEMA', amm: 'MA-0621', available: true, price: 35 },
  { id: 'amlod10', name: 'Amlodipine 10mg LAPROPHAN', dci: 'Amlodipine', form: 'Comprimé', dosage: '10mg', laboratory: 'LAPROPHAN', amm: 'MA-0622', available: true, price: 48 },
  { id: 'aspirin500', name: 'Aspirine 500mg BAYER', dci: 'Acide acétylsalicylique', form: 'Comprimé effervescent', dosage: '500mg', laboratory: 'BAYER', amm: 'MA-0088', available: true, price: 15 },
  { id: 'warf5', name: 'Warfarine 5mg SOTHEMA', dci: 'Warfarine', form: 'Comprimé', dosage: '5mg', laboratory: 'SOTHEMA', amm: 'MA-0320', available: true, price: 42 },
  { id: 'digox25', name: 'Digoxine 0,25mg PHARMA5', dci: 'Digoxine', form: 'Comprimé', dosage: '0,25mg', laboratory: 'PHARMA5', amm: 'MA-0195', available: true, price: 38 },
  { id: 'amio200', name: 'Amiodarone 200mg MAPHAR', dci: 'Amiodarone', form: 'Comprimé', dosage: '200mg', laboratory: 'MAPHAR', amm: 'MA-0203', available: true, price: 72 },
  { id: 'pred5', name: 'Prednisolone 5mg LAPROPHAN', dci: 'Prednisolone', form: 'Comprimé', dosage: '5mg', laboratory: 'LAPROPHAN', amm: 'MA-0411', available: true, price: 28 },
  { id: 'losart50', name: 'Losartan 50mg COOPER', dci: 'Losartan', form: 'Comprimé pelliculé', dosage: '50mg', laboratory: 'COOPER', amm: 'MA-0589', available: true, price: 65 },
  { id: 'cipro500', name: 'Ciprofloxacine 500mg SOTHEMA', dci: 'Ciprofloxacine', form: 'Comprimé pelliculé', dosage: '500mg', laboratory: 'SOTHEMA', amm: 'MA-0378', available: true, price: 58 },
];

function normalizeForSearch(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function searchLocalFallback(query) {
  const q = normalizeForSearch(query);
  if (!q) return [];

  const scored = LOCAL_MEDICATIONS.map((med) => {
    const haystack = normalizeForSearch(
      [med.name, med.dci, med.laboratory, med.amm, med.form].join(' ')
    );
    let score = 0;
    if (haystack.includes(q)) score += 10;
    const tokens = q.split(/\s+/).filter(Boolean);
    tokens.forEach((token) => {
      if (haystack.includes(token)) score += 3;
    });
    return { med, score };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((entry) => entry.med);
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Recherche un médicament par nom commercial ou DCI.
 * @param {string} query - Nom à rechercher
 * @returns {Promise<Array>} Tableau de médicaments normalisés
 */
async function searchMedication(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  if (isMedindexConfigured()) {
    const apiResults = await searchViaApi(q);
    if (apiResults !== null) return apiResults;
    // Si l'API échoue → fallback local avec avertissement
    console.warn('[medindex] Bascule sur la base locale (API indisponible)');
  }

  return searchLocalFallback(q);
}

/**
 * Formate les résultats pour un message WhatsApp.
 * @param {Array} medications - Liste normalisée
 * @param {string} query - Terme recherché (pour affichage)
 * @returns {string} Texte formaté
 */
function formatSearchResults(medications, query) {
  if (!medications || !medications.length) {
    return [
      `Aucun medicament trouve pour "${query}".`,
      'Verifiez l\'orthographe ou essayez avec la DCI (substance active).',
      'Envoyez RETOUR pour revenir au menu.',
    ].join('\n\n');
  }

  const source = isMedindexConfigured() ? 'MedIndex' : 'Base locale demo';
  const lines = [`Resultats ${source} pour "${query}" :\n`];

  medications.forEach((med, index) => {
    const dispo = med.available ? '[OK]' : '[Rupture]';
    const prix = med.price ? ` | ${med.price} MAD` : '';
    lines.push(
      `${index + 1}. ${med.name}\n` +
      `   DCI: ${med.dci || '-'} | ${med.form || '-'} ${med.dosage || ''}\n` +
      `   ${dispo}${prix} | Lab: ${med.laboratory || '-'}`
    );
  });

  if (!isMedindexConfigured()) {
    lines.push('\n(Demo - configurez MEDINDEX_API_URL et MEDINDEX_API_KEY pour les donnees reelles)');
  }

  lines.push('\nAutre recherche : tapez le nom. Retour menu : RETOUR');

  return lines.join('\n');
}

module.exports = {
  isMedindexConfigured,
  searchMedication,
  formatSearchResults,
};
