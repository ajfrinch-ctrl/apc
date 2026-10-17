/* A bounded, presentation-only launch screen. Never gates authentication/sync. */
(() => {
  const screen = document.createElement('div');
  screen.className = 'launch-screen';
  screen.setAttribute('role', 'status');
  screen.setAttribute('aria-label', 'অ্যাপ খুলছে');
  const logo = document.createElement('img');
  logo.src = 'assets/icons/logo-128.png';
  logo.alt = 'Active Plus Coaching';
  logo.width = logo.height = 144;
  const tagline = document.createElement('p');
  tagline.textContent = 'শিখতে থাকো, এগিয়ে যাও';
  screen.append(logo, tagline);
  document.body.prepend(screen);
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
