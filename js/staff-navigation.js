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

const ROUTE_ALIASES = Object.freeze({
  admin: Object.freeze({ system: 'more', profile: 'more', settings: 'more', data: 'more', backup: 'more', audit: 'more', security: 'more', migration: 'more', roles: 'more', content: 'more', advice: 'more', phonebook: 'more' }),
  teacher: Object.freeze({ 'class-chat': 'academic', exam: 'academic', 'online-exams': 'academic', notice: 'academic', courses: 'academic', 'lecture-sheets': 'academic', 'routine-view': 'academic', reports: 'finance', marks: 'academic', attendance: 'academic', profile: 'more', settings: 'more', advice: 'more' }),
  manager: Object.freeze({ 'class-chat': 'more', 'academic-records': 'academic', classes: 'academic', teachers: 'work', notices: 'academic', routine: 'academic', exams: 'academic', courses: 'academic', 'lecture-sheets': 'academic', results: 'academic', reports: 'more', phonebook: 'more', profile: 'more', settings: 'more', advice: 'more' }),
  payment: Object.freeze({ profile: 'more', reports: 'academic' })
});

export function staffTabForRoute(role, route) {
  const normalizedRole = String(role || '').toLowerCase();
  const mapping = STAFF_NAV_ROUTES[normalizedRole];
  if (!mapping) return '';
  const exact = Object.keys(mapping).find(key => mapping[key] === route);
  return exact || ROUTE_ALIASES[normalizedRole]?.[route] || '';
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
