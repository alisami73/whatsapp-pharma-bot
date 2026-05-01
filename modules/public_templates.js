'use strict';

const twilioService = require('../twilio_service');
const interactive = require('./interactive');
const explorer = require('./explorer');
const answerCards = require('./answer_cards');

function isAutoProvisionEnabled() {
  const raw = String(process.env.AUTO_PROVISION_PUBLIC_TEMPLATES || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

async function ensureExplorerTemplates() {
  const results = [];
  for (const lang of ['fr', 'ar', 'es', 'ru']) {
    const cacheKey = `explorer_v4_${lang}`;
    try {
      const sid = await interactive.resolveTemplate(cacheKey, () => explorer.buildExplorerV3Spec(lang));
      results.push({ kind: 'explorer', lang, sid });
    } catch (error) {
      console.error(`[public_templates] explorer bootstrap failed for ${lang}: ${error.message}`);
      results.push({ kind: 'explorer', lang, sid: null, error: error.message });
    }
  }
  return results;
}

async function ensurePublicTemplates() {
  if (!isAutoProvisionEnabled()) {
    console.log('[public_templates] AUTO_PROVISION_PUBLIC_TEMPLATES disabled');
    return [];
  }

  if (!twilioService.isTwilioConfigured()) {
    console.log('[public_templates] Twilio not configured; skipping template bootstrap');
    return [];
  }

  console.log('[public_templates] Bootstrapping public WhatsApp templates...');

  const explorerResults = await ensureExplorerTemplates();
  const answerCardResults = await answerCards.ensureAnswerCardTemplates();
  const combined = [...explorerResults, ...answerCardResults];

  const okCount = combined.filter((item) => item.sid).length;
  const failCount = combined.length - okCount;
  console.log(`[public_templates] Bootstrap complete: ${okCount} ok, ${failCount} failed`);
  return combined;
}

module.exports = {
  ensureExplorerTemplates,
  ensurePublicTemplates,
  isAutoProvisionEnabled,
};
