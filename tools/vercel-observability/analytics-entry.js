import { inject } from '@vercel/analytics';

const PAGE_PATHS = new Set([
  '/', '/index.html', '/student.html', '/admin.html', '/teacher.html',
  '/manager.html', '/payment.html', '/privacy.html'
]);

function safePagePath() {
  const path = window.location.pathname;
  return PAGE_PATHS.has(path) ? path : '/other';
}

function removePrivateUrlParts(event) {
  if (!event || typeof event !== 'object') return null;
  const page = safePagePath();
  return { type: event.type, url: `${window.location.origin}${page}` };
}

function isLocalPreview() {
  const host = window.location.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
    host.endsWith('.e2b.app') || host.endsWith('.e2b.dev');
}

// Auto pageviews are limited to static panel names; query strings, fragments,
// student identifiers, route state, and custom event properties are never sent.
// Local/Arena previews have no Vercel ingestion endpoint, so do not request it.
if (!isLocalPreview()) inject({ beforeSend: removePrivateUrlParts });
