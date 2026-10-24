/* Immediate Service Worker cache busting for browsers trapped on an older
   cache-first APP_SHELL release. Reads the target build version from its own
   ?v= script tag (falling back to the current release pin) so it never
   drifts behind SW_VERSION / CACHE_VERSION. */
(function refreshStaleAppShellCache() {
  const DEFAULT_VERSION = 424;
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
  const RELOAD_FLAG = `apc_sw_refreshed_v${TARGET_VERSION}`;
  void (async () => {
    try {
      const keys = await window.caches.keys();
      const stale = keys.filter(key => {
        if (!key.startsWith('active-plus-student-v') || key === TARGET_CACHE) return false;
        const match = key.match(/^active-plus-student-v(\d+)-/);
        return !match || Number(match[1]) < TARGET_VERSION;
      });
      if (!stale.length) return;
      await Promise.all(stale.map(key => window.caches.delete(key)));
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.register(`./sw.js?v=${TARGET_VERSION}`);
        await reg.update();
      }
      try {
        window.sessionStorage.setItem('apc_sw_ack_version', String(TARGET_VERSION));
      } catch { /* ignore storage restrictions */ }
      if (window.sessionStorage.getItem(RELOAD_FLAG) !== '1') {
        window.sessionStorage.setItem(RELOAD_FLAG, '1');
        window.location.reload();
      }
    } catch {
      /* Ignore offline/storage restriction errors */
    }
  })();
})();
