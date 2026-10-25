/* Immediate Service Worker cache cleanup for browsers upgrading from an older
   APP_SHELL release. Reads the target build version from its own ?v= script
   tag (falling back to the current release pin) so it never drifts behind
   SW_VERSION / CACHE_VERSION, and defers worker registration until after
   window.load so precaching never starves initial CSS/JS rendering. */
(function refreshStaleAppShellCache() {
  const DEFAULT_VERSION = 427;
  if (typeof window === 'undefined' || !('caches' in window)) return;
  const scriptEl = document.currentScript || document.querySelector('script[src*="cache-refresh.js"]');
  let parsed = DEFAULT_VERSION;
  try {
    const v = Number(new URL(scriptEl?.src || '', window.location.href).searchParams.get('v'));
    if (Number.isSafeInteger(v) && v > 0) parsed = v;
  } catch {
    /* keep default version */
  }
  const TARGET_VERSION = parsed;
  const TARGET_CACHE = `active-plus-student-v${TARGET_VERSION}-minimal-education`;

  void (async () => {
    try {
      // If a legacy unversioned worker (e.g. v53 './sw.js' with no ?v= query)
      // still controls this origin, unregister it immediately so it cannot
      // re-populate its old cache while the new page finishes loading.
      if ('serviceWorker' in navigator) {
        const ctrlUrl = navigator.serviceWorker.controller?.scriptURL || '';
        if (ctrlUrl && !ctrlUrl.includes('?v=')) {
          const oldReg = await navigator.serviceWorker.getRegistration();
          if (oldReg) await oldReg.unregister().catch(() => {});
        }
      }

      const keys = await window.caches.keys();
      const stale = keys.filter(key => {
        if (!key.startsWith('active-plus-student-v') || key === TARGET_CACHE) return false;
        const match = key.match(/^active-plus-student-v(\d+)-/);
        return !match || Number(match[1]) < TARGET_VERSION;
      });
      if (!stale.length) return;

      await Promise.all(stale.map(key => window.caches.delete(key)));
      try {
        window.sessionStorage.setItem('apc_sw_ack_version', String(TARGET_VERSION));
      } catch { /* ignore storage restrictions */ }

      // Register the new Service Worker only AFTER window.load so its offline
      // APP_SHELL precache never competes with first-paint CSS/JS on mobile links.
      if ('serviceWorker' in navigator) {
        const registerAfterLoad = () => {
          navigator.serviceWorker.register(`./sw.js?v=${TARGET_VERSION}`)
            .then(reg => reg.update())
            .catch(() => {});
        };
        if (document.readyState === 'complete') registerAfterLoad();
        else window.addEventListener('load', registerAfterLoad, { once: true });
      }
    } catch {
      /* Ignore offline/storage restriction errors */
    }
  })();
})();
