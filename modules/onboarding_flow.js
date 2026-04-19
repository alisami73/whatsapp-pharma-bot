'use strict';

const ENTRY_CHOICES = ['faq', 'medicaments', 'logiciel', 'services'];
const ROLE_CHOICES = ['titulaire', 'adjoint', 'autre', 'skip'];
const CONSENT_CHOICES = ['accept', 'refuse'];

function getOnboardingFlowContentSid() {
  return String(process.env.TWILIO_ONBOARDING_FLOW_CONTENT_SID || '').trim();
}

function isOnboardingFlowConfigured() {
  // Le Flow doit être EXPLICITEMENT activé via TWILIO_ONBOARDING_FLOW_ENABLED=true
  // Si la variable est absente ou différente de 'true', on bascule sur le fallback texte.
  // Cela évite les rejets silencieux de Meta quand le template est en attente d'approbation.
  const enabledFlag = String(process.env.TWILIO_ONBOARDING_FLOW_ENABLED || '').trim().toLowerCase();
  if (enabledFlag !== 'true') {
    return false;
  }
  return Boolean(getOnboardingFlowContentSid());
}

function buildOnboardingFlowSpec() {
  return {
    id: 'assistant_pharmacie_onboarding_v1',
    launch: {
      content_sid_env: 'TWILIO_ONBOARDING_FLOW_CONTENT_SID',
      content_sid: getOnboardingFlowContentSid() || null,
    },
    screens: [
      {
        id: 'consent_screen',
        title: 'Avant de commencer',
        field: 'consent_choice',
        options: [
          { value: 'accept', label: "J'accepte" },
          { value: 'refuse', label: 'Je refuse' },
        ],
      },
      {
        id: 'role_screen',
        title: 'Quel est votre role dans l\'officine ?',
        field: 'role_choice',
        options: [
          { value: 'titulaire', label: 'Pharmacien titulaire' },
          { value: 'adjoint', label: 'Pharmacien adjoint / collaborateur' },
          { value: 'autre', label: 'Autre role' },
          { value: 'skip', label: 'Passer' },
        ],
      },
      {
        id: 'home_screen',
        title: 'Bienvenue !',
        field: 'entry_choice',
        options: [
          { value: 'faq', label: 'FAQ' },
          { value: 'medicaments', label: 'Medicaments' },
          { value: 'logiciel', label: 'Logiciel' },
          { value: 'services', label: 'Services' },
        ],
      },
    ],
  };
}

function parseInteractiveData(rawValue) {
  if (!rawValue) {
    return null;
  }

  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return rawValue;
  }

  try {
    const parsed = JSON.parse(String(rawValue));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function extractInteractiveData(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const candidates = [
    body.InteractiveData,
    body.interactiveData,
    body.FlowData,
    body.flowData,
    body.FlowActionPayload,
    body.flow_action_payload,
    body.SubmissionData,
    body.submission_data,
    body.ButtonPayload,
    body.Payload,
    body.Body,
  ];

  for (const candidate of candidates) {
    const parsed = parseInteractiveData(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function flattenInteractiveData(value, target = {}) {
  if (!value || typeof value !== 'object') {
    return target;
  }

  Object.entries(value).forEach(([key, entryValue]) => {
    if (entryValue === null || entryValue === undefined) {
      return;
    }

    if (Array.isArray(entryValue)) {
      target[key] = entryValue;
      return;
    }

    if (typeof entryValue !== 'object') {
      target[key] = entryValue;
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entryValue, 'value') && typeof entryValue.value !== 'object') {
      target[key] = entryValue.value;
      return;
    }

    flattenInteractiveData(entryValue, target);
  });

  return target;
}

function normalizeChoice(value, allowedValues) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : null;
}

function parseFlowSubmission(rawInteractiveData) {
  const parsed = parseInteractiveData(rawInteractiveData);

  if (!parsed) {
    return null;
  }

  const flat = flattenInteractiveData(parsed);
  const consentChoice = normalizeChoice(flat.consent_choice, CONSENT_CHOICES);
  const roleChoice = normalizeChoice(flat.role_choice, ROLE_CHOICES);
  const entryChoice = normalizeChoice(flat.entry_choice, ENTRY_CHOICES);

  if (!consentChoice && !roleChoice && !entryChoice) {
    return null;
  }

  return {
    consent_choice: consentChoice,
    role_choice: roleChoice,
    entry_choice: entryChoice,
    raw: parsed,
    flat,
  };
}

function mapRoleChoiceToStoredRole(roleChoice) {
  if (roleChoice === 'titulaire' || roleChoice === 'adjoint' || roleChoice === 'autre') {
    return roleChoice;
  }

  return null;
}

module.exports = {
  ENTRY_CHOICES,
  getOnboardingFlowContentSid,
  isOnboardingFlowConfigured,
  buildOnboardingFlowSpec,
  extractInteractiveData,
  parseInteractiveData,
  parseFlowSubmission,
  mapRoleChoiceToStoredRole,
};
