'use strict';

/**
 * scripts/create_explorer_v2_templates.js
 *
 * Creates the 4 Explorer v2 carousel templates (URL buttons) in Twilio.
 * Run once, then submit each template for Meta UTILITY approval.
 *
 * After approval, copy the SIDs into APPROVED_V2_SIDS in modules/explorer/index.js.
 *
 * Usage:
 *   node scripts/create_explorer_v2_templates.js [--dry-run]
 */

require('dotenv').config();
const twilio = require('twilio');
const { buildExplorerV2Spec } = require('../modules/explorer/index');

const DRY_RUN = process.argv.includes('--dry-run');
const client  = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  for (const lang of ['fr', 'ar', 'es', 'ru']) {
    const spec = buildExplorerV2Spec(lang);
    console.log(`\n── ${spec.friendlyName} ──────────────────────────`);
    console.log('Cards:');
    spec.types['twilio/carousel'].cards.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.title}`);
      console.log(`     btn: "${c.actions[0].title}" → ${c.actions[0].url}`);
    });

    if (DRY_RUN) { console.log('  [DRY RUN — skipped]'); continue; }

    try {
      // Delete existing v2 if present (idempotent re-run)
      const existing = await client.content.v1.contents.list({ limit: 500 });
      const old = existing.find(t => t.friendlyName === spec.friendlyName);
      if (old) {
        await client.content.v1.contents(old.sid).remove();
        console.log(`  ♻️  Deleted existing ${old.sid}`);
      }

      const created = await client.content.v1.contents.create(spec);
      console.log(`  ✅ Created: ${created.sid}`);
      console.log(`  👉 Submit for approval as UTILITY — name: ${spec.friendlyName}`);
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
    }
  }

  console.log('\n── NEXT STEPS ──────────────────────────────────────────');
  console.log('1. In Twilio Console → Content Templates → submit each blink_explorer_v2_* for approval');
  console.log('2. Category: UTILITY (service info, not promotional)');
  console.log('3. Once approved, copy SIDs into APPROVED_V2_SIDS in modules/explorer/index.js');
  console.log('4. Run: node scripts/cleanup_deprecated_templates.js --dry-run (then without --dry-run)');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
