'use strict';

const DEFAULT_PUBLIC_SITE_ORIGIN = 'https://blinkpremium.blinkpharmacie.ma';
const PUBLIC_SITE_PAGE_PATHS = new Set([
  '/',
  '/index.html',
  '/premium.html',
  '/contact.html',
  '/actu.html',
  '/fse.html',
  '/conformite.html',
  '/data-cndp.html',
  '/cgu.html',
]);

function trimOrigin(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getPublicSiteOrigin() {
  return (
    trimOrigin(process.env.PUBLIC_SITE_ORIGIN) ||
    trimOrigin(process.env.PUBLIC_BASE_URL) ||
    DEFAULT_PUBLIC_SITE_ORIGIN
  );
}

function normalizePublicPath(pathname = '/') {
  const raw = String(pathname || '/').trim();
  if (!raw || raw === '/') return '/';

  const withoutOrigin = raw.replace(/^[a-z]+:\/\/[^/]+/i, '');
  const withoutSitePrefix = withoutOrigin.replace(/^\/?site(?=\/|$)/i, '');
  const cleaned = withoutSitePrefix.replace(/^\/+/, '');
  return cleaned ? `/${cleaned}` : '/';
}

function buildPublicSiteUrl(pathname = '/', search = '') {
  return `${getPublicSiteOrigin()}${normalizePublicPath(pathname)}${String(search || '')}`;
}

function buildPublicAssetUrl(pathname) {
  return buildPublicSiteUrl(pathname);
}

function appendLangQuery(lang) {
  return lang && lang !== 'fr' ? `?lang=${encodeURIComponent(lang)}` : '';
}

function getPublicSiteHost() {
  try {
    return new URL(getPublicSiteOrigin()).host.toLowerCase();
  } catch {
    return '';
  }
}

function getRequestHosts(req) {
  const forwardedHosts = String(req?.headers?.['x-forwarded-host'] || '')
    .split(',')
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const directHost = String(req?.headers?.host || '').trim().toLowerCase();

  return Array.from(new Set([
    ...(directHost ? [directHost] : []),
    ...forwardedHosts,
  ]));
}

function getRequestHost(req) {
  return getRequestHosts(req)[0] || '';
}

function getRequestProto(req) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')
    .map((value) => String(value || '').trim().toLowerCase())
    .find(Boolean);

  if (forwardedProto) {
    return forwardedProto;
  }

  const cfVisitor = String(req?.headers?.['cf-visitor'] || '').trim();
  const cfMatch = cfVisitor.match(/"scheme":"(https?|wss?)"/i);
  if (cfMatch?.[1]) {
    return cfMatch[1].toLowerCase();
  }

  return String(req?.protocol || '').trim().toLowerCase();
}

function isHttpsRequest(req) {
  const proto = getRequestProto(req);
  return proto === 'https' || proto === 'wss';
}

function isCloudflareProxiedRequest(req) {
  const cfRay = String(req?.headers?.['cf-ray'] || '').trim();
  const cfVisitor = String(req?.headers?.['cf-visitor'] || '').trim();
  const cdnLoop = String(req?.headers?.['cdn-loop'] || '').trim().toLowerCase();
  return Boolean(cfRay || cfVisitor || cdnLoop.includes('cloudflare'));
}

function isPublicSiteRequestHost(req) {
  const publicHost = getPublicSiteHost();
  const requestHosts = getRequestHosts(req);
  return Boolean(publicHost && requestHosts.some((host) => host === publicHost));
}

function isPublicSitePath(pathname = '/') {
  const original = String(pathname || '/').trim();
  const normalized = normalizePublicPath(original);

  if (PUBLIC_SITE_PAGE_PATHS.has(normalized)) {
    return true;
  }

  return (
    original.startsWith('/site/') ||
    original.startsWith('/answers/')
  );
}

function buildPublicRequestRedirectUrl(req) {
  if (!req || !isPublicSitePath(req.path || req.originalUrl || '/')) {
    return null;
  }

  const path = normalizePublicPath(req.path || req.originalUrl || '/');
  const search = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

  if (isPublicSiteRequestHost(req)) {
    if (!isHttpsRequest(req)) {
      return buildPublicSiteUrl(path, search);
    }
    return null;
  }

  if (isCloudflareProxiedRequest(req)) {
    if (!isHttpsRequest(req)) {
      return buildPublicSiteUrl(path, search);
    }
    return null;
  }

  return buildPublicSiteUrl(path, search);
}

module.exports = {
  DEFAULT_PUBLIC_SITE_ORIGIN,
  PUBLIC_SITE_PAGE_PATHS,
  getPublicSiteOrigin,
  getPublicSiteHost,
  getRequestHosts,
  getRequestHost,
  getRequestProto,
  isHttpsRequest,
  isCloudflareProxiedRequest,
  isPublicSiteRequestHost,
  isPublicSitePath,
  buildPublicRequestRedirectUrl,
  normalizePublicPath,
  buildPublicSiteUrl,
  buildPublicAssetUrl,
  appendLangQuery,
};
