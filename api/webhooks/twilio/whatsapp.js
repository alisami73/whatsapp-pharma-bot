const {
  handlePrimaryTwilioWhatsappWebhook,
} = require('../../../twilio_whatsapp_webhooks');

module.exports = async (req, res) => {
  await handlePrimaryTwilioWhatsappWebhook(req, res);
};
