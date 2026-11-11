import { injectSpeedInsights } from '@vercel/speed-insights';

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
  return { type: event.type, url: `${window.location.origin}${page}`, route: page };
}

function isLocalPreview() {
  const host = window.location.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
    host.endsWith('.e2b.app') || host.endsWith('.e2b.dev');
}

// Track vitals only for an allow-listed static page name. Hashes, queries,
// record identifiers, and app state are deliberately excluded from telemetry.
// Local/Arena previews have no Vercel ingestion endpoint, so do not request it.
if (!isLocalPreview()) {
  injectSpeedInsights({ route: safePagePath(), beforeSend: removePrivateUrlParts });
}
