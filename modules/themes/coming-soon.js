'use strict';

/**
 * modules/themes/coming-soon.js
 *
 * Handler générique "Bientôt disponible" pour les thèmes sans KB ni connecteur configurés.
 * Utilisé par : medindex, regulations (jusqu'à réception de leur KB)
 *
 * Retourne le message traduit + 2 boutons footer.
 */

const { t } = require('../i18n');
const { appendTextFooter, sendAIResponseWithFooter } = require('../shared/footer');

/**
 * Envoie le message "Bientôt disponible" avec le footer 2 boutons.
 * Si l'interactif échoue, retourne le texte pour fallback TwiML.
 *
 * @param {string} to
 * @param {string} lang
 * @returns {{ sent: boolean, text: string }}
 */
async function handleComingSoon(to, lang) {
  const text = t('coming_soon', lang);

  const result = await sendAIResponseWithFooter(to, lang, text);
  return { sent: Boolean(result), text: appendTextFooter(text, lang) };
}

module.exports = { handleComingSoon };
