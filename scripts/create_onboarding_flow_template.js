'use strict';

require('dotenv').config();

const CONTENT_API_URL = 'https://content.twilio.com/v1/Content';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildOptions(options) {
  return JSON.stringify(options.map((option) => ({
    id: option.id,
    title: option.title,
  })));
}

function buildPayload() {
  return {
    friendly_name: process.env.TWILIO_ONBOARDING_FLOW_FRIENDLY_NAME || 'assistant_pharmacie_onboarding_v2',
    language: 'fr',
    types: {
      'twilio/flows': {
        type: 'OTHER',
        body: 'Bienvenue sur Assistant Pharmacie. Commencez votre parcours.',
        button_text: 'Commencer',
        subtitle: 'Onboarding',
        pages: [
          {
            id: 'language_screen',
            next_page_id: 'consent_screen',
            title: 'Choisissez votre langue',
            layout: [
              {
                type: 'TEXT_BODY',
                text: 'Selectionnez la langue de votre parcours.',
              },
              {
                type: 'SINGLE_SELECT',
                name: 'language_choice',
                label: 'Votre langue',
                text: 'Choisissez une option',
                required: true,
                options: buildOptions([
                  { id: 'fr', title: 'Francais' },
                  { id: 'ar', title: 'العربية' },
                ]),
              },
            ],
          },
          {
            id: 'consent_screen',
            next_page_id: 'role_screen',
            title: 'Avant de commencer',
            layout: [
              {
                type: 'TEXT_BODY',
                text: [
                  'Pour utiliser ce service, vous confirmez que :',
                  '- vous etes pharmacien ou utilisez ce service sous votre responsabilite',
                  '- vous acceptez de recevoir des messages WhatsApp lies aux services actifs',
                  '- vous validez les informations avant de les appliquer',
                  '- vous respectez les limites de votre role',
                ].join('\n'),
              },
              {
                type: 'SINGLE_SELECT',
                name: 'consent_choice',
                label: 'Votre choix',
                text: 'Selectionnez une option',
                required: true,
                options: buildOptions([
                  { id: 'accept', title: "J'accepte" },
                  { id: 'refuse', title: 'Je refuse' },
                ]),
              },
            ],
          },
          {
            id: 'role_screen',
            next_page_id: 'home_screen',
            title: "Quel est votre role dans l'officine ?",
            layout: [
              {
                type: 'SINGLE_SELECT',
                name: 'role_choice',
                label: 'Votre role',
                text: 'Selectionnez une option',
                required: true,
                options: buildOptions([
                  { id: 'titulaire', title: 'Pharmacien titulaire' },
                  { id: 'adjoint', title: 'Pharmacien adjoint / collaborateur' },
                  { id: 'autre', title: 'Autre role' },
                  { id: 'skip', title: 'Passer' },
                ]),
              },
            ],
          },
          {
            id: 'home_screen',
            next_page_id: null,
            title: 'Bienvenue !',
            layout: [
              {
                type: 'TEXT_BODY',
                text: "Je suis votre assistant pharmacie. Comment puis-je vous aider aujourd'hui ?",
              },
              {
                type: 'SINGLE_SELECT',
                name: 'entry_choice',
                label: 'Choisissez un acces',
                text: 'Selectionnez une option',
                required: true,
                options: buildOptions([
                  { id: 'faq', title: 'FAQ' },
                  { id: 'medicaments', title: 'Medicaments' },
                  { id: 'logiciel', title: 'Logiciel' },
                  { id: 'services', title: 'Services' },
                ]),
              },
            ],
          },
        ],
      },
    },
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
