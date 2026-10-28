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
export function rememberRoute(name, { mode = 'replace', state } = {}) {
  if (mode === 'keep') return;
  const route = String(name || '').trim();
  if (!route || typeof window === 'undefined') return;
  const target = `#${route}`;
  const url = window.location.pathname + window.location.search + target;
  if (window.location.hash === target && mode === 'replace') return;
  const nextState = state !== undefined ? state : window.history.state;
  if (mode === 'push' && window.history?.pushState) {
    window.history.pushState(nextState, '', url);
  } else if (window.history?.replaceState) {
    window.history.replaceState(nextState, '', url);
  }
}

/** Push a new history entry for user-driven navigation (so Back walks the stack). */
export function pushRoute(name, state) {
  return rememberRoute(name, { mode: 'push', state });
}

/** Run `handler(pageName)` when the hash changes (a hand-typed link, a shared
    URL, or the browser's Back into a page of this panel). An empty hash
    reopens the panel's default tab so the URL and the visible view never
    disagree; unknown hashes are refused by the caller's route guard. */
export function onRouteChange(handler) {
  window.addEventListener('hashchange', () => {
    handler(routeName());
  });
}
