const {
  handleTwilioWhatsappStatusCallback,
} = require('../../../../twilio_status_callback_webhook');

module.exports = async (req, res) => {
  await handleTwilioWhatsappStatusCallback(req, res);
};
