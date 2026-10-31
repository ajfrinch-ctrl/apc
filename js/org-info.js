/* Institute details — ONE reader, ONE painter, for every surface.
 *
 * The single source of truth is the app-settings document
 * (KEYS.settings → js/config.js DEFAULT_APP_SETTINGS), written only by
 * Admin → Settings → ব্র্যান্ডিং ও যোগাযোগ তথ্য (js/admin.js). Until this
 * module existed that document was read by the receipt/report writers but the
 * Dashboard's institute card, the top-bar tagline of the staff panels and the
 * student Help sheet were hard-coded copies, so an address change never
 * reached them.
 *
 * Every consumer now does one of two things:
 *   • documents (receipts, reports, ID cards, letterheads) read
 *     readOrgInfo() at generation time, or
 *   • live surfaces carry a data-org-* hook and are repainted by
 *     applyOrgInfo(), which runs at boot, after a successful save and on every
 *     cross-tab/cross-device settings update.
 *
 * No institute text is written here: nothing but the defaults already owned by
 * js/config.js ever becomes a fallback.
 */
import { DEFAULT_APP_SETTINGS, STORAGE_KEYS } from './config.js';
import { loadAppConfig } from './storage.js';

/** Fired on window after the settings document has been written. */
export const APP_CONFIG_SAVED_EVENT = 'apc-app-config-saved';
/** Fired on window after applyOrgInfo() repainted a surface. */
export const ORG_INFO_APPLIED_EVENT = 'apc-org-info-applied';

const text = value => String(value ?? '').replace(/\s+/gu, ' ').trim();

function pick(value, fallback) {
  const clean = text(value);
  return clean || fallback;
}

/**
 * Read the current institute record. Always freshly from storage — never a
 * cached snapshot — so a caller can never paint a stale address.
 */
export function readOrgInfo() {
  let cfg = {};
  try { cfg = loadAppConfig() || {}; } catch { cfg = {}; }
  return Object.freeze({
    name: 'Active Plus Coaching',
    tagline: pick(cfg.tagline, DEFAULT_APP_SETTINGS.tagline),
    address: pick(cfg.campusAddress, DEFAULT_APP_SETTINGS.campusAddress),
    helpline: pick(cfg.helplineMobile, DEFAULT_APP_SETTINGS.helplineMobile),
    whatsapp: pick(cfg.whatsappNumber, DEFAULT_APP_SETTINGS.whatsappNumber),
    email: pick(cfg.officialEmail, DEFAULT_APP_SETTINGS.officialEmail)
  });
}

/** "address · phone · email" — the one-line form used by cards and footers. */
export function orgContactLine(info = readOrgInfo()) {
  return [info.address, info.helpline, info.email].filter(Boolean).join(' · ');
}

const intlDigits = value => {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits.startsWith('880') ? digits : digits.startsWith('0') ? `880${digits.slice(1)}` : digits;
};

/** WhatsApp deep link for the current number (empty when unset). */
export function orgWhatsappUrl(info = readOrgInfo()) {
  const digits = intlDigits(info.whatsapp);
  return digits ? `https://wa.me/${digits}` : '';
}

/** tel: link for the helpline (empty when unset). */
export function orgTelUrl(info = readOrgInfo()) {
  const digits = intlDigits(info.helpline);
  return digits ? `tel:+${digits}` : '';
}

/**
 * Paint every live surface inside `root` from one freshly read record.
 *
 * Hooks (all optional, any number of nodes per hook):
 *   [data-org-name]       institute name
 *   [data-org-tagline]    slogan
 *   [data-org-address]    campus address only
 *   [data-org-helpline]   helpline number
 *   [data-org-email]      official e-mail
 *   [data-org-contact]    address · helpline · email
 *   [data-org-whatsapp]   href of an <a> is set to the wa.me link
 *   [data-org-live]       a section to show once the record is painted
 *   [data-fixed-tagline]  the shared top-bar slogan (all panels)
 *   [data-institute-name] / [data-institute-addr]
 *                         the Admin Dashboard institute card (legacy hooks)
 */
export function applyOrgInfo(root = document, info = readOrgInfo()) {
  if (!root || typeof root.querySelectorAll !== 'function') return info;
  const setText = (selector, value) => {
    root.querySelectorAll(selector).forEach(node => {
      if (node.textContent !== value) node.textContent = value;
    });
  };

  setText('[data-org-name], [data-institute-name]', info.name);
  setText('[data-org-tagline], [data-fixed-tagline]', info.tagline);
  setText('[data-org-address]', info.address);
  setText('[data-org-helpline]', info.helpline);
  setText('[data-org-email]', info.email);
  setText('[data-org-contact], [data-institute-addr]', orgContactLine(info));

  const waHref = orgWhatsappUrl(info);
  root.querySelectorAll('[data-org-whatsapp]').forEach(node => {
    const isLink = node.tagName === 'A';
    if (!waHref) {
      if (isLink) node.removeAttribute('href');
      node.hidden = true;
      return;
    }
    node.hidden = false;
    if (isLink) node.setAttribute('href', waHref);
    else {
      const label = String(node.dataset.orgWhatsapp || '').trim();
      node.textContent = label || info.whatsapp;
    }
  });

  const telHref = orgTelUrl(info);
  root.querySelectorAll('[data-org-tel]').forEach(node => {
    if (node.tagName === 'A' && telHref) node.setAttribute('href', telHref);
  });
  root.querySelectorAll('[data-org-email-mail]').forEach(node => {
    if (node.tagName === 'A' && info.email) node.setAttribute('href', `mailto:${info.email}`);
  });

  root.querySelectorAll('[data-org-live]').forEach(node => { node.hidden = false; });

  // Letterhead-ish blocks (receipts/ID card previews) that only need the
  // address line refreshed while they are on screen.
  root.querySelectorAll('[data-org-address-line]').forEach(node => {
    node.textContent = orgContactLine(info);
  });

  if (typeof window !== 'undefined' && window.dispatchEvent) {
    try {
      window.dispatchEvent(new CustomEvent(ORG_INFO_APPLIED_EVENT, { detail: { info } }));
    } catch { /* non-browser environment */ }
  }
  return info;
}

let installed = false;
const hosts = new Set();

/**
 * Repaint now, then keep repainting:
 *   • same tab  — Admin → Settings dispatches APP_CONFIG_SAVED_EVENT;
 *   • other tabs / synced devices — the `storage` event (the settings key is
 *     shared by every panel of this origin);
 *   • returning to the tab (bfcache) — `pageshow`.
 * Safe to call more than once; only one set of listeners is installed.
 */
export function initOrgInfo({ root = null } = {}) {
  if (root) hosts.add(root);
  applyOrgInfo(root || document);
  if (installed || typeof window === 'undefined') return readOrgInfo();
  installed = true;
  const repaint = () => {
    applyOrgInfo(document);
    hosts.forEach(host => { if (host.isConnected) applyOrgInfo(host); });
  };
  window.addEventListener(APP_CONFIG_SAVED_EVENT, repaint);
  window.addEventListener('storage', event => {
    // key === null means the whole store was cleared/replaced.
    if (!event || event.key === null || event.key === STORAGE_KEYS.appConfig) repaint();
  });
  window.addEventListener('pageshow', repaint);
  return readOrgInfo();
}

/** Exposed for tests: drop the installed listeners between environments. */
export function resetOrgInfoListeners() {
  installed = false;
  hosts.clear();
}
