/* Reserve the actual fixed-bar heights, including safe areas and loaded fonts.
   Only the main panel scrolls; neither view animations nor long forms move the bars.
   All viewports keep bottom nav fixed bottom (no sidebar); desktop ≥1024px is wide
   but navigation stays bottom-row, so footer height is always reserved. */
export function initFixedShell() {
  const DESKTOP_MQ = '(min-width: 1024px)';
  const isDesktop = () => {
    try { return window.matchMedia(DESKTOP_MQ).matches; } catch { return false; }
  };
  const bars = [];
  const shells = [];
  for (const [shellSelector, headerSelector, footerSelector] of [
    ['#appShell', '#studentHeader', '.bottom-nav'],
    ['#adminShell', '.app-topbar', '.admin-bottom'],
    ['#teacherShell', '.app-topbar', '.admin-bottom'],
    ['#managerShell', '.app-topbar', '.admin-bottom'],
    ['#payShell', '.app-topbar', '.admin-bottom']
  ]) {
    const shell = document.querySelector(shellSelector);
    if (!shell) continue;
    shells.push(shell);
    for (const [selector, variable] of [[headerSelector, '--shell-header-height'], [footerSelector, '--shell-footer-height']]) {
      const element = shell.querySelector(selector) || (selector === '.app-topbar' ? document.querySelector(selector) : null);
      // fallback: global selector if not inside shell (payShell may share topbar outside)
      const el = shell.querySelector(selector) || document.querySelector(shellSelector + ' ' + selector) || document.querySelector(selector);
      // keep reference to element if found and variable is header (we still need both)
      // Prefer element inside shell
      let target = shell.querySelector(selector);
      if (!target && selector === '.app-topbar') target = shell.querySelector('.app-topbar') || document.querySelector('.app-topbar');
      if (!target) target = shell.querySelector(footerSelector);
      // Actually push both header/footer separately
    }
  }
  // Rebuild bars correctly (previous loop helper broken by fallback attempt — rebuild cleanly)
  bars.length = 0;
  const configs = [
    ['#appShell', '#studentHeader', '.bottom-nav'],
    ['#adminShell', '.app-topbar', '.admin-bottom'],
    ['#teacherShell', '.app-topbar', '.admin-bottom'],
    ['#managerShell', '.app-topbar', '.admin-bottom'],
    ['#payShell', '.app-topbar', '.admin-bottom']
  ];
  for (const [shellSel, headerSel, footerSel] of configs) {
    const shell = document.querySelector(shellSel);
    if (!shell) continue;
    const header = shell.querySelector(headerSel) || shell.querySelector('.app-topbar');
    const footer = shell.querySelector(footerSel);
    if (header) bars.push({ shell, element: header, variable: '--shell-header-height', kind: 'header' });
    if (footer) bars.push({ shell, element: footer, variable: '--shell-footer-height', kind: 'footer' });
  }
  const studentShell = document.querySelector('#appShell');
  const studentMain = document.querySelector('#appMain');
  const setSize = (shell, name, value) => {
    if (shell.style.getPropertyValue(name) !== value) shell.style.setProperty(name, value);
  };
  const ceilSize = el => Math.ceil(el.getBoundingClientRect().height);
  const ceilWidth = el => Math.ceil(el.getBoundingClientRect().width);

  let raf = 0;
  let timer = 0;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { raf = 0; measure(); });
    }, 60);
  };

  const measure = () => {
    const desktop = isDesktop();
    // Top offset (notice/status strip outside shell)
    if (studentShell && !studentShell.hidden) {
      const top = Math.max(0, Math.ceil(studentShell.getBoundingClientRect().top + window.scrollY));
      setSize(studentShell, '--shell-top-offset', `${top}px`);
      const available = Math.floor(studentMain?.getBoundingClientRect().height || 0);
      if (available > 0) setSize(studentShell, '--student-home-height', `${available}px`);
      // Also expose student home height formula uses footer 0 on desktop, so available grows correctly
    }
    for (const { shell, element, variable, kind } of bars) {
      if (kind === 'header') {
        const h = ceilSize(element);
        if (h > 0) setSize(shell, variable, `${h}px`);
      } else if (kind === 'footer') {
        const h = ceilSize(element);
        if (h > 0) setSize(shell, variable, `${h}px`);
        setSize(shell, '--sidebar-width', '0px');
      }
    }
    for (const s of shells) {
      if (s.style.getPropertyValue('--sidebar-width') !== '0px') setSize(s, '--sidebar-width', '0px');
    }
  };

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(schedule);
    for (const { element } of bars) observer.observe(element, { box: 'border-box' });
    if (studentShell) observer.observe(document.body);
    if (studentMain) observer.observe(studentMain, { box: 'border-box' });
    // Also observe sidebars on desktop — width changes at breakpoints
    for (const s of shells) {
      const nav = s.querySelector('.bottom-nav, .admin-bottom');
      if (nav) observer.observe(nav, { box: 'border-box' });
    }
  }
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  // Media query change (sidebar ↔ bottom-bar flip)
  try {
    const mq = window.matchMedia(DESKTOP_MQ);
    if (mq.addEventListener) mq.addEventListener('change', schedule);
    else if (mq.addListener) mq.addListener(schedule);
  } catch {}
  document.fonts?.ready.then(schedule);
  measure();
}
