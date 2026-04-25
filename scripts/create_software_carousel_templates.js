'use strict';

require('dotenv').config({ quiet: true });

const { getSoftwareTemplateArtifacts } = require('../modules/themes/software');

const CONTENT_API_URL = 'https://content.twilio.com/v1/Content';
const LANGS = ['fr', 'ar', 'es', 'ru'];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toApiPayload(lang) {
  const { spec, approvalNote } = getSoftwareTemplateArtifacts(lang);

  return {
    lang,
    approval_note: approvalNote,
    payload: {
      friendly_name: spec.friendlyName,
      language: spec.language,
      types: spec.types,
    },
  };
}

async function createTemplate(entry) {
  const accountSid = requiredEnv('TWILIO_ACCOUNT_SID');
  const authToken = requiredEnv('TWILIO_AUTH_TOKEN');

  const response = await fetch(CONTENT_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(entry.payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Twilio Content API error (${response.status}) for ${entry.lang}: ${JSON.stringify(data)}`);
  }

  return {
    lang: entry.lang,
    sid: data.sid,
    friendly_name: data.friendly_name,
    approval_create: data.links && data.links.approval_create,
    approval_fetch: data.links && data.links.approval_fetch,
  };
}

async function main() {
  const payloads = LANGS.map(toApiPayload);

  if (process.argv.includes('--print')) {
    console.log(JSON.stringify(payloads, null, 2));
    return;
  }

  const created = [];
  for (const entry of payloads) {
    created.push(await createTemplate(entry));
  }

  console.log(JSON.stringify(created, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
