'use strict';

const https = require('https');

function getAuthHeader() {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials are missing.');
  }
  return 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
}

function assertFriendlyName(spec) {
  const friendlyName = String(spec && spec.friendlyName ? spec.friendlyName : '').trim();
  if (!friendlyName) {
    throw new Error('Twilio content templates must always define a non-empty friendlyName.');
  }
  return friendlyName;
}

function api(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const bodyString = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'content.twilio.com',
      path,
      method,
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
            return;
          }
          reject(new Error(parsed.message || `${method} ${path} failed with ${res.statusCode}`));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (bodyString) {
      req.write(bodyString);
    }
    req.end();
  });
}

async function createTemplate(spec) {
  const friendlyName = assertFriendlyName(spec);
  return api('POST', '/v1/Content', {
    friendly_name: friendlyName,
    language: spec.language,
    variables: spec.variables,
    types: spec.types,
  });
}

async function listTemplates(limit = 500) {
  const result = await api('GET', `/v1/Content?PageSize=${Math.max(1, Math.min(Number(limit) || 500, 1000))}`);
  return Array.isArray(result.contents) ? result.contents : [];
}

async function findTemplateByFriendlyName(friendlyName) {
  const safeFriendlyName = String(friendlyName || '').trim();
  if (!safeFriendlyName) {
    return null;
  }
  const templates = await listTemplates(500);
  return templates.find((template) =>
    String(template.friendly_name || template.friendlyName || '').trim() === safeFriendlyName,
  ) || null;
}

async function deleteTemplate(templateSid) {
  const sid = String(templateSid || '').trim();
  if (!sid) {
    throw new Error('templateSid is required');
  }
  return api('DELETE', `/v1/Content/${sid}`);
}

module.exports = {
  assertFriendlyName,
  createTemplate,
  listTemplates,
  findTemplateByFriendlyName,
  deleteTemplate,
};
