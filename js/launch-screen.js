/* A bounded, presentation-only launch screen. Never gates authentication/sync. */
(() => {
  const screen = document.createElement('div');
  screen.className = 'launch-screen';
  screen.setAttribute('role', 'status');
  screen.setAttribute('aria-label', 'অ্যাপ খুলছে');
  const logo = document.createElement('img');
  // Resolve relative to this script so nested pages use the same brand asset.
  logo.src = new URL('../assets/icons/logo-128.png', document.currentScript.src).href;
  logo.alt = 'Active Plus Coaching';
  logo.width = logo.height = 144;
  const tagline = document.createElement('p');
  tagline.className = 'launch-screen__tagline';
  tagline.textContent = 'শিখতে থাকো, এগিয়ে যাও';
  /* The sign-in hand-off line ("এডমিন প্যানেলে নেওয়া হচ্ছে…") belongs here, not on
     the login screen the user is leaving (owner request 2026-11-08). It is read
     from a one-shot note the signing-in tab left behind; direct visits and plain
     refreshes carry no note and keep the neutral brand line only. */
  const handoff = document.createElement('p');
  handoff.className = 'launch-screen__handoff';
  handoff.hidden = true;
  screen.append(logo, tagline, handoff);
  document.body.prepend(screen);

  const withTimeout = (promise, ms) => Promise.race([
    promise, new Promise(resolve => setTimeout(() => resolve(''), ms))
  ]);
  withTimeout(import(new URL('./login-handoff.js', document.currentScript.src).href)
    .then(mod => mod.takeHandoffNote(document.body.dataset.panel || ''))
    .catch(() => ''), 1200).then(line => {
    if (!line || !screen.isConnected) return;
    handoff.textContent = line;
    handoff.hidden = false;
    screen.dataset.handoff = '1';
  });
  /* Boot-failure escape hatch: keep the login link out of the normal loading
     state, but reveal it after a long stall. This deferred script still wires
     it even if the panel module itself fails. */
  const bootLink = document.getElementById('managerBootLink');
  const managerBootScreen = document.getElementById('managerBootScreen');
  if (bootLink) {
    bootLink.addEventListener('click', () => window.location.assign('./index.html'));
    if (managerBootScreen) setTimeout(() => {
      if (managerBootScreen.isConnected && bootLink.isConnected) bootLink.hidden = false;
    }, 12000);
  }
  const started = performance.now();
  let timer;
  const dismiss = () => { clearTimeout(timer); screen.remove(); };
  const ready = () => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, Math.max(0, 400 - (performance.now() - started)));
  };
  timer = setTimeout(dismiss, 2800);
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready, {once:true});
  // Keyboard users never have to wait for a visual introduction.
  document.addEventListener('keydown', dismiss, {once:true});
  window.addEventListener('pagehide', dismiss, {once:true});
})();
