/* Offline registration. The worker activates immediately, so notify on
 * controllerchange as well as updatefound (there may be no waiting worker).
 *
 * Update delivery (owner report 2026-10-15: "আপডেট করার পর ক্যাশে ক্লিয়ার
 * করলেই নতুন আপডেট দেখতাসি"): a browser may serve the worker script itself
 * from its HTTP cache during an update check, so a plain './sw.js' can look
 * "unchanged" for hours and the new build never lands. The registration URL
 * therefore carries the build number (SW_VERSION, kept equal to sw.js's
 * CACHE_VERSION and pinned by tests/sw-update-delivery.test.mjs): every
 * release registers a URL the browser has never cached, the check always
 * fetches the real script, and activate() swaps the whole cache. On top of
 * that, long-lived app windows re-check whenever they become visible. */
import { requestPersistentStorage } from './storage-safety.js';

export const SW_VERSION = 443;
const ACK_STORAGE_KEY = 'apc_sw_ack_version';
const CURRENT_CACHE = `active-plus-student-v${SW_VERSION}-minimal-education`;

function isSameBuildWorker(scriptURL) {
  if (!scriptURL) return false;
  try {
    const url = new URL(scriptURL, location.href);
    return Number(url.searchParams.get('v')) === SW_VERSION;
  } catch {
    return String(scriptURL).endsWith(`sw.js?v=${SW_VERSION}`);
  }
}

function alreadyAcknowledgedCurrentBuild() {
  try {
    return window.sessionStorage.getItem(ACK_STORAGE_KEY) === String(SW_VERSION);
  } catch {
    return false;
  }
}

/* The four staff panels own the staff half of the precache (see sw.js), so the
   registration URL names which shell this device needs. Every other page —
   the Student app, the login door, the privacy page — asks for the light one. */
const STAFF_PAGES = ['admin.html', 'manager.html', 'teacher.html', 'payment.html'];
function shellHint() {
  try {
    const page = location.pathname.split('/').pop() || 'index.html';
    return STAFF_PAGES.includes(page) ? 'staff' : 'student';
  } catch {
    return 'student';
  }
}

export function registerServiceWorker() {
  void requestPersistentStorage();
  if (!('serviceWorker' in navigator)) return;
  const initialControllerUrl = navigator.serviceWorker.controller?.scriptURL || '';
  let hadController = Boolean(navigator.serviceWorker.controller);
  let activeRegistration = null;

  const applyUpdateAndReload = async button => {
    if (button) {
      button.disabled = true;
      button.textContent = 'আপডেট হচ্ছে…';
    }
    try {
      window.sessionStorage.setItem(ACK_STORAGE_KEY, String(SW_VERSION));
    } catch { /* ignore storage errors */ }
    try {
      if (activeRegistration?.waiting) {
        activeRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      if ('caches' in window) {
        const keys = await window.caches.keys();
        const stale = keys.filter(key => key.startsWith('active-plus-student-v') && key !== CURRENT_CACHE);
        if (stale.length) await Promise.all(stale.map(key => window.caches.delete(key)));
      }
      await activeRegistration?.update().catch(() => {});
    } catch { /* proceed to reload */ }
    location.reload();
  };

  const showUpdate = (candidateUrl = '') => {
    if (!hadController || document.getElementById('apcUpdateBanner')) return;
    // If the page booted already controlled by this exact SW_VERSION (or the
    // user already clicked Refresh for SW_VERSION) and the candidate worker is
    // not a newer build, suppress duplicate update banners.
    if (isSameBuildWorker(initialControllerUrl) && (!candidateUrl || isSameBuildWorker(candidateUrl))) return;
    if (alreadyAcknowledgedCurrentBuild() && (!candidateUrl || isSameBuildWorker(candidateUrl))) return;

    const banner = document.createElement('div');
    banner.id = 'apcUpdateBanner'; banner.setAttribute('role', 'status');
    banner.style.cssText = 'position:fixed;z-index:99998;top:0;left:0;right:0;padding:12px 18px;background:#073b2c;color:white;display:flex;align-items:center;justify-content:space-between;gap:12px';
    const label = document.createElement('span'); label.textContent = 'নতুন সংস্করণ আছে';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'রিফ্রেশ করুন';
    button.style.cssText = 'min-width:48px;min-height:48px;padding:10px 18px;color:#073b2c;background:#fff;border:0;border-radius:8px;cursor:pointer';
    button.addEventListener('click', () => { void applyUpdateAndReload(button); });
    banner.append(label, button); document.body?.append(banner);
  };

  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'APC_CLIENT_VERSION_CHECK') {
      event.ports?.[0]?.postMessage({ version: SW_VERSION });
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const nextUrl = navigator.serviceWorker.controller?.scriptURL || '';
    showUpdate(nextUrl);
    hadController = true;
  });

  const register = () => navigator.serviceWorker.register(`./sw.js?v=${SW_VERSION}&shell=${shellHint()}`).then(registration => {
    activeRegistration = registration;
    if (registration.waiting) showUpdate(registration.waiting.scriptURL || '');
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') showUpdate(worker.scriptURL || '');
      });
    });
    /* Do not wait for the browser's own schedule: check now, and again
       whenever the app comes back to the front. */
    const recheck = () => { registration.update().catch(() => {}); };
    recheck();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') recheck();
    });
  }).catch(() => { /* App remains usable without service worker. */ });
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
