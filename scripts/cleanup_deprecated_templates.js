'use strict';

/**
 * scripts/cleanup_deprecated_templates.js
 *
 * Deletes deprecated / unused Twilio Content templates to free quota.
 *
 * WHEN TO RUN:
 *   Phase 1 (now): run to clean up role, menu, debug templates
 *   Phase 2 (after explorer_v2 approved): uncomment PHASE_2_SIDS block and re-run
 *
 * Usage:
 *   node scripts/cleanup_deprecated_templates.js [--dry-run]
 */

require('dotenv').config();
const twilio = require('twilio');

const DRY_RUN = process.argv.includes('--dry-run');
const client  = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ── PHASE 1 — already deprecated (safe to delete now) ─────────────────────────
const DEPRECATED_SIDS = new Set([
  // Benefits FAQ v1 — replaced by v2
  'HX01bacb94b4484ccf7a268865439accdb', // blink_benefits_faq_v1_fr
  'HXd94ea788e7dc9b37f33a9b5e1a1e5074', // blink_benefits_faq_v1_ar
  'HXe96feee33bef32e03c97e08260c17ace', // blink_benefits_faq_v1_es
  'HXe9949cebe0b68cfbebaec095d00ab434', // blink_benefits_faq_v1_ru

  // Explorer v1 — replaced by v2 (URL buttons). UNCOMMENT after v2 approved by Meta:
  // 'HXd9eb17cff40280a0f7ad94978d2625ee', // blink_explorer_carousel_v1_fr
  // 'HX0f8860dfebafb971e29f12fb28a8ae2e', // blink_explorer_carousel_v1_ar
  // 'HX72b8a6ba16a01b5056eb27c0323b2feb', // blink_explorer_carousel_v1_es
  // 'HX80bc43cb8ec1cae4da7da24f0157fac2', // blink_explorer_carousel_v1_ru
]);

const DEPRECATED_PREFIXES = [
  'blink_role_v3_',                 // role step removed from onboarding
  'blink_menu_v2_',                 // sendMenuScreen never called
  'blink_explorer_carousel_v2_',    // debug templates 2026-04-26
  'blink_explorer_carousel_v3_',    // debug templates 2026-04-26
  'copy_blink_explorer_carousel_',  // manual copies of debug templates
  'blink_software_v5_',             // old software carousel versions
  'blink_software_v4_',
  'blink_software_v3_',
  // Software + Benefits FAQ carousels — replaced by web pages (URL button flow).
  // UNCOMMENT after explorer_v2 approved and web pages live:
  // 'blink_software_carousel_v6_',  // software sub-carousel → now web page
  // 'blink_benefits_faq_v2_',       // benefits FAQ carousel → now web page
];

// ── Templates that must NEVER be deleted ──────────────────────────────────────
const PROTECTED_PREFIXES = [
  'blink_language_v3',              // language selection — stays in WhatsApp
  'blink_consent_v2_',              // CGU consent — stays in WhatsApp
  'blink_consent_v3_',
  'blink_explorer_carousel_v1_',    // explorer v1 — keep until v2 approved
  'blink_explorer_v2_',             // explorer v2 — new URL-button carousel
  'blink_software_carousel_v6_',    // keep until web flow confirmed live
  'blink_benefits_faq_v2_',         // keep until web flow confirmed live
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

  const toDelete   = all.filter((t) => !isProtected(t) && isDeprecated(t));
  const protected_ = all.filter((t) => isProtected(t));
  const unknown    = all.filter((t) => !isProtected(t) && !isDeprecated(t));

  console.log('── PROTECTED (will not touch) ──────────────────────────────');
  protected_.forEach((t) => console.log(`  ✅ ${t.friendlyName || '(no name)'} (${t.sid})`));

  if (unknown.length) {
    console.log('\n── UNKNOWN (not in either list — review manually) ──────────');
    unknown.forEach((t) => console.log(`  ❓ ${t.friendlyName || '(no name)'} (${t.sid}) status=${t.approvalRequests?.status || '?'}`));
  }

  console.log(`\n── TO DELETE (${toDelete.length}) ────────────────────────────────────`);
  if (!toDelete.length) { console.log('  Nothing to delete.'); return; }

  toDelete.forEach((t) => console.log(`  🗑  ${t.friendlyName || '(no name)'} (${t.sid})`));

  if (DRY_RUN) {
    console.log('\nDRY RUN — no templates deleted. Re-run without --dry-run to proceed.');
    return;
  }

  console.log('\nDeleting...');
  let deleted = 0, failed = 0;
  for (const t of toDelete) {
    try {
      await client.content.v1.contents(t.sid).remove();
      console.log(`  ✅ Deleted: ${t.friendlyName || '(no name)'} (${t.sid})`);
      deleted++;
    } catch (err) {
      console.error(`  ❌ Failed:  ${t.friendlyName || '(no name)'} (${t.sid}) — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Deleted: ${deleted}  Failed: ${failed}`);
  console.log(`Templates remaining: ${all.length - deleted}`);
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
