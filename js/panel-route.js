/* Which page of a panel is open is kept in the URL hash, so a browser refresh
   (or an accidental Back) reopens the same page instead of the panel's first
   tab. Staff panels share this one helper; the student app keeps its own router
   in js/shell.js. */

/** The page name in the current URL hash, or '' when there is none. */
export function routeName(hash = window.location.hash) {
  return String(hash || '').replace(/^#/, '').replace(/^\/+/, '').trim();
}

/** Remember the page that is open now. Replaces the entry: Back still means
    "leave the panel", never "walk through every page I visited". */
export function rememberRoute(name) {
  const route = String(name || '').trim();
  if (!route || typeof window === 'undefined' || !window.history?.replaceState) return;
  const target = `#${route}`;
  if (window.location.hash === target) return;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + target);
}

/** Run `handler(pageName)` when the hash changes (a hand-typed link, a shared
    URL, or the browser's Back into a page of this panel). */
export function onRouteChange(handler) {
  window.addEventListener('hashchange', () => {
    const name = routeName();
    if (name) handler(name);
  });
}
