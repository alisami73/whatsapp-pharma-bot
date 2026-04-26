'use strict';

/**
 * scripts/cleanup_deprecated_templates.js
 *
 * Deletes deprecated / unused Twilio Content templates to free quota.
 * Run AFTER Benefits FAQ v2 templates are approved by Meta.
 *
 * Usage:
 *   node scripts/cleanup_deprecated_templates.js [--dry-run]
 */

require('dotenv').config();
const twilio = require('twilio');

const DRY_RUN = process.argv.includes('--dry-run');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

// ── Deprecated SIDs (known) ───────────────────────────────────────────────────
// Benefits FAQ v1 — replaced by v2 ("Voir les détails" button)
const DEPRECATED_SIDS = new Set([
  'HX01bacb94b4484ccf7a268865439accdb', // blink_benefits_faq_v1_fr
  'HXd94ea788e7dc9b37f33a9b5e1a1e5074', // blink_benefits_faq_v1_ar
  'HXe96feee33bef32e03c97e08260c17ace', // blink_benefits_faq_v1_es
  'HXe9949cebe0b68cfbebaec095d00ab434', // blink_benefits_faq_v1_ru
]);

// ── Deprecated friendlyName prefixes ─────────────────────────────────────────
const DEPRECATED_PREFIXES = [
  'blink_role_v3_',                 // role step removed from onboarding
  'blink_menu_v2_',                 // sendMenuScreen never called
  'blink_explorer_carousel_v2_',    // debug templates from 2026-04-26
  'blink_explorer_carousel_v3_',    // debug templates from 2026-04-26
  'copy_blink_explorer_carousel_',  // manual copies of debug templates
  'blink_software_v5_',             // old software carousel versions
  'blink_software_v4_',
  'blink_software_v3_',
];

// ── Templates that must NEVER be deleted ─────────────────────────────────────
const PROTECTED_PREFIXES = [
  'blink_language_v3',
  'blink_software_carousel_v6_',
  'blink_explorer_carousel_v1_',
  'blink_consent_v2_',
  'blink_benefits_faq_v2_',
];

function isProtected(tmpl) {
  const name = tmpl.friendlyName || '';
  return PROTECTED_PREFIXES.some((p) => name.startsWith(p));
}

function isDeprecated(tmpl) {
  if (DEPRECATED_SIDS.has(tmpl.sid)) return true;
  const name = tmpl.friendlyName || '';
  return DEPRECATED_PREFIXES.some((p) => name.startsWith(p));
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no deletions)' : 'LIVE'}\n`);
  console.log('Fetching all templates from Twilio...');

  const all = await client.content.v1.contents.list({ limit: 500 });
  console.log(`Total templates in account: ${all.length}\n`);

  const toDelete  = all.filter((t) => !isProtected(t) && isDeprecated(t));
  const protected_ = all.filter((t) => isProtected(t));
  const unknown   = all.filter((t) => !isProtected(t) && !isDeprecated(t));

  console.log('── PROTECTED (will not touch) ──────────────────────────────');
  protected_.forEach((t) => console.log(`  ✅ ${t.friendlyName} (${t.sid})`));

  if (unknown.length) {
    console.log('\n── UNKNOWN (not in either list — review manually) ──────────');
    unknown.forEach((t) => console.log(`  ❓ ${t.friendlyName} (${t.sid}) status=${t.approvalRequests?.status || '?'}`));
  }

  console.log(`\n── TO DELETE (${toDelete.length}) ────────────────────────────────────`);
  if (!toDelete.length) {
    console.log('  Nothing to delete.');
    return;
  }

  toDelete.forEach((t) => console.log(`  🗑  ${t.friendlyName} (${t.sid})`));

  if (DRY_RUN) {
    console.log('\nDRY RUN — no templates deleted. Re-run without --dry-run to proceed.');
    return;
  }

  console.log('\nDeleting...');
  let deleted = 0;
  let failed  = 0;
  for (const t of toDelete) {
    try {
      await client.content.v1.contents(t.sid).remove();
      console.log(`  ✅ Deleted: ${t.friendlyName} (${t.sid})`);
      deleted++;
    } catch (err) {
      console.error(`  ❌ Failed:  ${t.friendlyName} (${t.sid}) — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Deleted: ${deleted}  Failed: ${failed}`);
  console.log(`Templates remaining: ${all.length - deleted}`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
