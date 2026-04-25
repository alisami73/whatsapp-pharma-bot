'use strict';

require('dotenv').config({ quiet: true });

const { buildLanguageSpec } = require('../modules/interactive');

const CONTENT_API_URL = 'https://content.twilio.com/v1/Content';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildPayload() {
  const spec = buildLanguageSpec();

  return {
    friendly_name: spec.friendlyName,
    language: spec.language,
    types: spec.types,
  };
}

async function createTemplate() {
  const accountSid = requiredEnv('TWILIO_ACCOUNT_SID');
  const authToken = requiredEnv('TWILIO_AUTH_TOKEN');
  const payload = buildPayload();

  const response = await fetch(CONTENT_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Twilio Content API error (${response.status}): ${JSON.stringify(data)}`);
  }

  console.log(JSON.stringify({
    sid: data.sid,
    friendly_name: data.friendly_name,
    approval_create: data.links && data.links.approval_create,
    approval_fetch: data.links && data.links.approval_fetch,
  }, null, 2));
}

async function main() {
  if (process.argv.includes('--print')) {
    console.log(JSON.stringify(buildPayload(), null, 2));
    return;
  }

  await createTemplate();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
