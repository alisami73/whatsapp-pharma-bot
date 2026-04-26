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

  // Nameless CGU consent quick-reply drafts (created 2026-04-25/26 without friendlyName)
  'HXf9b7e08130ddc7d708ee2190ec8bab7c',
  'HXa15c0478e732fcdd4394e3f46bb0ac07',
  'HX06088b3fb5160b0e00d6375f0d49651f',
  'HX3ec61f4473acb2addeedb7f6e7065532',
  'HXbc6ac18e8ccf46a3384952685610441c',
  'HXe548ae1d5fd56f136aaebad3ceb6fd0f',
  'HXfbebd6379399080fa4dc490de9101339',
  'HX2d25eb43ff6cc88a93f94921082af9e9',
  'HX64c050d2b2ea783cda4f010c9ca46366',
  'HX28783fde06991d1f8656715d4335271c',
  'HX2b307f7f1f9c0f62ecfd311d1aca0c36',
  'HX2a4c9a245f75814843f03901a9dc6ebb',

  // Nameless role list-picker drafts (created 2026-04-25/26 — role step removed)
  'HX7305ac1dc57ca6a3299bcacb87e63d64',
  'HXf423906d7d73d743a6efcf4e160cca21',
  'HX0a2608569c0e61b8a461930f9d9599e0',
  'HXa0d1d880deae34c5ea1eb0758977b13c',
  'HX70c4aca931dfe8ddfaae86479a166420',
  'HXe46af540542aabb659a49b29a036441c',
  'HX3f9614e60eac85241e1b4e90ee26f373',
  'HXb0e4f41e67a80b7abd79a760ec459db5',
  'HXee2a5143cc8a1c255e2584e35746905e',
  'HX63ae26d984d59b291fc7d8204b2ff9e9',

  // Nameless benefits answer card draft (2026-04-26 — answer card flow removed)
  'HX9173e4b9ee4f0ddb3b7ddee825d7c241',

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
// Note: Twilio Content API v1 returns friendlyName=null for carousel templates
// created via the SDK — protect those by SID explicitly.
const PROTECTED_SIDS = new Set([
  // Explorer v2 — URL buttons, approved by Meta (UTILITY)
  'HX40472f02cdbffc6e62b27830dd4fac77', // blink_explorer_v2_fr ✅ approved
  'HXd4680df211d0e60366edb12972e0bfb7', // blink_explorer_v2_ar ✅ approved
  'HX797c30f7d5f63052bbb2e9de6a1250a1', // blink_explorer_v2_es ✅ approved
  // blink_explorer_v2_ru was rejected (Carousel+UTILITY not allowed for ru) — deleted
]);

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
  if (PROTECTED_SIDS.has(tmpl.sid)) return true;
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
