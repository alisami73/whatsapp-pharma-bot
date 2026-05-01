'use strict';

const DEFAULT_PUBLIC_SITE_ORIGIN = 'https://blinkpremium.blinkpharmacie.ma';

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

module.exports = {
  DEFAULT_PUBLIC_SITE_ORIGIN,
  getPublicSiteOrigin,
  normalizePublicPath,
  buildPublicSiteUrl,
  buildPublicAssetUrl,
  appendLangQuery,
};
