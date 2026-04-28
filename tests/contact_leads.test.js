'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const contactLeads = require('../modules/contact_leads');

test('contact lead validation requires the core contact fields and validates phone format', () => {
  const missing = contactLeads.validateContactLead({
    nom: '',
    pharmacie: '',
    telephone: '',
  });

  assert.equal(missing.valid, false);
  assert.deepEqual(missing.fieldErrors, {
    nom: 'required',
    pharmacie: 'required',
    telephone: 'required',
  });

  const invalidPhone = contactLeads.validateContactLead({
    nom: 'Dr Test',
    pharmacie: 'Pharmacie Demo',
    telephone: '123',
  });

  assert.equal(invalidPhone.valid, false);
  assert.equal(invalidPhone.fieldErrors.telephone, 'invalid_phone');
});

test('contact lead email targets contact@blinkpharma.ma and includes structured content', () => {
  const config = contactLeads.getContactEmailConfig({
    CONTACT_SMTP_HOST: 'smtp.example.com',
    CONTACT_SMTP_PORT: '587',
    CONTACT_FORM_FROM: 'Blink Pharma <no-reply@blinkpharma.ma>',
  });

  const mail = contactLeads.buildContactLeadMail(
    {
      nom: 'Dr Ahmed Benali',
      pharmacie: 'Pharmacie Al Amal',
      telephone: '+212661095271',
      ville: 'Casablanca',
      logiciel: 'pharmawin',
      message: 'Merci de me rappeler demain matin.',
      lang: 'es',
      sourcePage: '/site/contact.html?lang=es',
    },
    {
      ip: '203.0.113.10',
      referer: 'https://whatsapp-pharma-bot-production.up.railway.app/site/contact.html?lang=es',
      userAgent: 'Mozilla/5.0',
      submittedAt: '2026-04-26T19:15:00.000Z',
    },
    config,
  );

  assert.equal(mail.to, 'contact@blinkpharma.ma');
  assert.equal(mail.from, 'Blink Pharma <no-reply@blinkpharma.ma>');
  assert.match(mail.subject, /Nouvelle demande de demo Blink Premium - Pharmacie Al Amal/);
  assert.match(mail.text, /Nom complet : Dr Ahmed Benali/);
  assert.match(mail.text, /Telephone WhatsApp : \+212661095271/);
  assert.match(mail.text, /Langue : es/);
  assert.match(mail.html, /Pharmacie Al Amal/);
  assert.match(mail.html, /Nouvelle demande de demo Blink Premium/);
});

test('contact email config supports Microsoft 365 STARTTLS settings', () => {
  const config = contactLeads.getContactEmailConfig({
    CONTACT_SMTP_HOST: 'smtp.office365.com',
    CONTACT_SMTP_PORT: '587',
    CONTACT_SMTP_SECURE: 'false',
    CONTACT_SMTP_REQUIRE_TLS: 'true',
    CONTACT_SMTP_USER: 'contact@blinkpharma.ma',
    CONTACT_SMTP_PASS: 'secret',
  });

  assert.equal(config.host, 'smtp.office365.com');
  assert.equal(config.port, 587);
  assert.equal(config.secure, false);
  assert.equal(config.requireTLS, true);
  assert.equal(config.user, 'contact@blinkpharma.ma');
  assert.equal(config.pass, 'secret');
  assert.equal(config.from, 'contact@blinkpharma.ma');
  assert.equal(config.to, 'contact@blinkpharma.ma');
});

test('contact email config auto-selects Microsoft Graph when configured', () => {
  const config = contactLeads.getContactEmailConfig({
    CONTACT_FORM_TO: 'contact@blinkpharma.ma',
    CONTACT_FORM_FROM: 'Blink Pharma <contact@blinkpharma.ma>',
    CONTACT_GRAPH_TENANT_ID: 'tenant-123',
    CONTACT_GRAPH_CLIENT_ID: 'client-123',
    CONTACT_GRAPH_CLIENT_SECRET: 'secret-123',
  });

  assert.equal(config.provider, 'msgraph');
  assert.equal(config.graphTenantId, 'tenant-123');
  assert.equal(config.graphClientId, 'client-123');
  assert.equal(config.graphClientSecret, 'secret-123');
  assert.equal(config.graphUser, 'contact@blinkpharma.ma');
  assert.equal(config.isConfigured, true);
});

test('contact lead Microsoft Graph payload preserves subject, HTML body, and recipients', () => {
  const config = contactLeads.getContactEmailConfig({
    CONTACT_EMAIL_PROVIDER: 'msgraph',
    CONTACT_FORM_TO: 'contact@blinkpharma.ma',
    CONTACT_FORM_FROM: 'Blink Pharma <contact@blinkpharma.ma>',
    CONTACT_GRAPH_TENANT_ID: 'tenant-123',
    CONTACT_GRAPH_CLIENT_ID: 'client-123',
    CONTACT_GRAPH_CLIENT_SECRET: 'secret-123',
    CONTACT_GRAPH_USER: 'contact@blinkpharma.ma',
  });

  const mail = contactLeads.buildContactLeadMail(
    {
      nom: 'Dr Ahmed Benali',
      pharmacie: 'Pharmacie Al Amal',
      telephone: '+212661095271',
      ville: 'Casablanca',
      logiciel: 'pharmawin',
      message: 'Merci de me rappeler demain matin.',
      lang: 'fr',
      sourcePage: '/site/contact.html',
    },
    {
      ip: '203.0.113.10',
      referer: 'https://whatsapp-pharma-bot-production.up.railway.app/site/contact.html',
      userAgent: 'Mozilla/5.0',
      submittedAt: '2026-04-28T10:05:00.000Z',
    },
    config,
  );

  const graphPayload = contactLeads.buildMicrosoftGraphMessage(mail);

  assert.equal(graphPayload.message.subject, mail.subject);
  assert.equal(
    graphPayload.message.toRecipients[0].emailAddress.address,
    'contact@blinkpharma.ma',
  );
  assert.equal(graphPayload.message.body.contentType, 'HTML');
  assert.match(graphPayload.message.body.content, /Pharmacie Al Amal/);
  assert.equal(graphPayload.saveToSentItems, true);
});

test('incomplete SMTP auth is treated as a configuration error', () => {
  assert.throws(
    () =>
      contactLeads.createTransport(
        contactLeads.getContactEmailConfig({
          CONTACT_SMTP_HOST: 'smtp.office365.com',
          CONTACT_SMTP_PORT: '587',
          CONTACT_SMTP_USER: 'contact@blinkpharma.ma',
        }),
      ),
    (error) => {
      assert.equal(error.code, 'CONTACT_EMAIL_AUTH_INCOMPLETE');
      assert.equal(contactLeads.isContactEmailConfigError(error), true);
      return true;
    },
  );
});
