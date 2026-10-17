const observedSurfaces = new WeakSet();

/** Presentation-only status area. It stays in document flow and, on a home
 * page, follows the hero or the role's unboxed intro. */
export function mountStatusNotice(element) {
  let surface = document.getElementById('appStatusSurface');
  if (!surface) {
    surface = document.createElement('aside');
    surface.id = 'appStatusSurface';
    surface.setAttribute('aria-label', 'সংযোগ ও নোটিফিকেশন');
  }

  function place() {
    const auth = document.getElementById('authScreen');
    if (auth && !auth.hidden) {
      auth.append(surface);
      return;
    }
    const shell = document.querySelector('.app-shell:not([hidden]), .admin-shell:not([hidden]), .pay-shell:not([hidden])');
    if (!shell) {
      document.body?.prepend(surface);
      return;
    }
    const active = shell.querySelector('.view.active:not([hidden]), .manager-view.active:not([hidden]), .admin-view.active:not([hidden]), .teacher-view:not([hidden]), [data-pay-panel]:not([hidden])');
    const hero = active?.querySelector('[data-home-hero]');
    const intro = active?.querySelector('[data-home-intro]');
    const anchor = hero || intro;
    if (anchor && !anchor.closest('[hidden]') && !shell.querySelector('.pay-counter-minimal')) {
      anchor.insertAdjacentElement('afterend', surface);
      return;
    }
    if (active) active.prepend(surface);
    else shell.querySelector('main')?.prepend(surface);
  }

  if (element && !surface.contains(element)) surface.append(element);
  place();

  if (!observedSurfaces.has(surface)) {
    const auth = document.getElementById('authScreen');
    if (auth && typeof MutationObserver === 'function') {
      const authObserver = new MutationObserver(place);
      authObserver.observe(auth, { attributes: true, attributeFilter: ['hidden'] });
    }
    const main = document.querySelector('.app-main, .admin-main, .pay-main');
    if (main && typeof MutationObserver === 'function') {
      const viewObserver = new MutationObserver(place);
      viewObserver.observe(main, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    }
    observedSurfaces.add(surface);
  }
  return surface;
}
