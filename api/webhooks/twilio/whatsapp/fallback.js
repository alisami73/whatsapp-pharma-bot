const {
  handleFallbackTwilioWhatsappWebhook,
} = require('../../../../twilio_whatsapp_webhooks');

module.exports = async (req, res) => {
  await handleFallbackTwilioWhatsappWebhook(req, res);
};
