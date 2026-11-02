/* Shared five-seat staff navigation contract.
 * Each entry page keeps its existing, permission-checked route names. This
 * adapter maps those routes to the same visible five tabs without granting
 * capabilities or changing the route/session security boundary.
 */
export const STAFF_NAV_TABS = Object.freeze([
  Object.freeze({ key: 'home', label: 'হোম', icon: 'home' }),
  Object.freeze({ key: 'work', label: 'কাজ', icon: 'work' }),
  Object.freeze({ key: 'academic', label: 'একাডেমিক', icon: 'book' }),
  Object.freeze({ key: 'finance', label: 'হিসাব', icon: 'wallet' }),
  Object.freeze({ key: 'more', label: 'আরও', icon: 'more' })
]);

export const STAFF_NAV_ROUTES = Object.freeze({
  admin: Object.freeze({ home: 'dashboard', work: 'staff', academic: 'academics', finance: 'reports', more: 'more' }),
  teacher: Object.freeze({ home: 'home', work: 'classes', academic: 'academic', finance: 'reports', more: 'more' }),
  manager: Object.freeze({ home: 'dashboard', work: 'students', academic: 'academic', finance: 'finance', more: 'more' }),
  payment: Object.freeze({ home: 'home', work: 'students', academic: 'reports', finance: 'payment', more: 'more' })
});

export function staffTabForRoute(role, route) {
  const mapping = STAFF_NAV_ROUTES[String(role || '').toLowerCase()];
  if (!mapping) return '';
  return Object.keys(mapping).find(key => mapping[key] === route) || '';
}

export function syncStaffNavigation(role, route, root = typeof document !== 'undefined' ? document : null) {
  if (!root?.querySelectorAll) return '';
  const activeTab = staffTabForRoute(role, route);
  root.querySelectorAll('[data-staff-tab]').forEach(button => {
    const active = Boolean(activeTab && button.dataset.staffTab === activeTab);
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  return activeTab;
}
