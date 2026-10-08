/* Fail-safe entry loader: no credentials/storage/role decisions here.
 * A failed module must never turn the login form into a native GET request,
 * or leave a staff shell hidden with no explanation. */
(() => {
  const script = document.currentScript || document.querySelector('script[data-entry]');
  const entries = {
    student: './main.js', admin: './admin.js', manager: './manager.js',
    teacher: './teacher.js', payment: './payment.js'
  };
  const entry = entries[script?.dataset.entry];
  if (!entry) return;
  const moduleUrl = new URL(entry, script.src || document.baseURI || location.href).href;
  let failed = false;
  let timer;
  function message(text) {
    const authMessage = document.getElementById('authMessage');
    if (authMessage) { authMessage.hidden = false; authMessage.textContent = text; }
  }
  // Installed in <head>, before any form can be interacted with.
  document.addEventListener('submit', event => {
    if (event.target.id !== 'loginForm' || event.target.dataset.loginReady === 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    message(failed ? 'লগইন লোড হয়নি। নিচের আবার চেষ্টা করুন বাটন চাপুন।' : 'লগইন প্রস্তুত হচ্ছে — একটু পরে আবার চেষ্টা করুন।');
  }, true);
  function showFailure() {
    clearTimeout(timer);
    failed = true;
    document.querySelector('.launch-screen')?.remove();
    const loginButton = document.querySelector('#loginForm [type=submit]');
    if (loginButton) loginButton.disabled = false;
    if (document.getElementById('appEntryError')) return;
    const panel = document.createElement('section');
    panel.id = 'appEntryError';
    panel.className = 'entry-error';
    panel.setAttribute('role', 'alert');
    const title = document.createElement('h1');
    title.textContent = 'অ্যাপ চালু করা যায়নি';
    const copy = document.createElement('p');
    copy.textContent = 'প্রয়োজনীয় ফাইল লোড হয়নি। আপনার পুরোনো অ্যাকাউন্ট ও ডেটা মুছবেন না। সংযোগ চালু করে আবার চেষ্টা করুন।';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = 'আবার চেষ্টা করুন';
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      // Ask the normal worker lifecycle for the new release. No cache/storage reset.
      try {
        await Promise.race([
          navigator.serviceWorker?.getRegistration().then(reg => reg?.update()),
          new Promise(resolve => setTimeout(resolve, 2500))
        ]);
      } catch { /* an offline retry still uses the existing cache */ }
      location.reload();
    });
    const login = document.createElement('a');
    login.href = 'index.html'; login.textContent = 'লগইন পেজে যান';
    panel.append(title, copy, retry, login);
    (document.getElementById('authScreen') || document.body).append(panel);
  }
  function start() {
    timer = setTimeout(showFailure, 12000);
    const file = entry.replace('./', '');
    let el = document.querySelector(`script[type="module"][src*="${file}"]`);
    if (!el) {
      el = document.createElement('script');
      el.type = 'module';
      el.src = moduleUrl;
      document.head.append(el);
    }
    el.addEventListener('error', () => {
      console.warn('[Active Plus] entry module unavailable');
      showFailure();
    });
    el.addEventListener('load', () => {
      clearTimeout(timer);
      document.getElementById('appEntryError')?.remove();
      failed = false;
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
