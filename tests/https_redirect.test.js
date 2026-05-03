'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../index');

const { enforceHttps } = app.locals.httpsRedirect;

function createResponseDouble() {
  return {
    headers: {},
    redirected: null,
    set(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    redirect(status, location) {
      this.redirected = { status, location };
      return this;
    },
  };
}

test('production requests on HTTP are redirected to HTTPS for public hosts', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const req = {
      secure: false,
      headers: { host: 'blinkpremium.blinkpharmacie.ma' },
      path: '/actu.html',
      originalUrl: '/actu.html?lang=fr',
    };
    const res = createResponseDouble();
    let nextCalled = false;

    enforceHttps(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.deepEqual(res.redirected, {
      status: 301,
      location: 'https://blinkpremium.blinkpharmacie.ma/actu.html?lang=fr',
    });
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test('production requests on localhost are not redirected', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const req = {
      secure: false,
      headers: { host: 'localhost:3000' },
      path: '/actu.html',
      originalUrl: '/actu.html',
    };
    const res = createResponseDouble();
    let nextCalled = false;

    enforceHttps(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.redirected, null);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test('production requests already on HTTPS keep serving content and emit HSTS', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const req = {
      secure: true,
      headers: { host: 'blinkpremium.blinkpharmacie.ma' },
      path: '/health',
      originalUrl: '/health',
    };
    const res = createResponseDouble();
    let nextCalled = false;

    enforceHttps(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.redirected, null);
    assert.equal(
      res.headers['strict-transport-security'],
      'max-age=31536000',
    );
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});
