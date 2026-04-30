'use strict';

/**
 * scripts/create_explorer_v2_templates.js  (now creates v3 templates)
 *
 * Creates the 4 Explorer v3 carousel templates (URL buttons with relay URLs) in Twilio.
 * Run once, then submit each template for Meta UTILITY approval via the Twilio Console.
 * The bot auto-creates and caches these on first use via resolveTemplate — this script
 * is only needed to pre-create them or force a rebuild.
 *
 * Usage:
 *   node scripts/create_explorer_v2_templates.js [--dry-run]
 */

require('dotenv').config();
const https = require('https');
const { buildExplorerV3Spec } = require('../modules/explorer/index');

const DRY_RUN = process.argv.includes('--dry-run');

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(
      process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN
    ).toString('base64');
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'content.twilio.com',
      path, method,
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  const listRes = await api('GET', '/v1/Content?PageSize=500', null);
  const existing = listRes.body.contents || [];

  for (const lang of ['fr', 'ar', 'es', 'ru']) {
    const spec = buildExplorerV3Spec(lang);
    console.log(`\n── ${spec.friendlyName} ──────────────────────────`);
    console.log('Cards:');
    spec.types['twilio/carousel'].cards.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.title}`);
      console.log(`     btn: "${c.actions[0].title}" → ${c.actions[0].url}`);
    });

    if (DRY_RUN) { console.log('  [DRY RUN — skipped]'); continue; }

    const old = existing.find(t => t.friendly_name === spec.friendlyName);
    if (old) {
      await api('DELETE', `/v1/Content/${old.sid}`, null);
      console.log(`  ♻️  Deleted existing ${old.sid}`);
    }

    try {
      const r = await api('POST', '/v1/Content', {
        friendly_name: spec.friendlyName,
        language:      spec.language,
        types:         spec.types,
      });
      if (r.status === 201) {
        console.log(`  ✅ Created: ${r.body.sid}  (friendly_name: ${r.body.friendly_name})`);
        console.log(`  👉 Submit for approval as UTILITY — name: ${spec.friendlyName}`);
      } else {
        console.error(`  ❌ Error ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
    }
  }

  console.log('\n── NEXT STEPS ──────────────────────────────────────────');
  console.log('1. In Twilio Console → Content Templates → submit each blink_explorer_v3_* for approval');
  console.log('2. Category: UTILITY (service info, not promotional)');
  console.log('3. The bot caches SIDs automatically — no code change needed after approval');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
