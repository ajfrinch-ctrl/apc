/* Shared five-seat staff navigation contract.
 * Each entry page keeps its existing, permission-checked route names. This
 * adapter maps those routes to the same visible five tabs without granting
 * capabilities or changing the route/session security boundary.
 */
export const STAFF_NAV_TABS = Object.freeze([
  Object.freeze({ key: 'home', label: 'হোম', icon: 'home' }),
  Object.freeze({ key: 'work', label: 'কাজ', icon: 'staff' }),
  Object.freeze({ key: 'academic', label: 'একাডেমিক', icon: 'book' }),
  Object.freeze({ key: 'finance', label: 'হিসাব', icon: 'wallet' }),
  Object.freeze({ key: 'more', label: 'আরও', icon: 'more' })
]);

export const STAFF_NAV_ROUTES = Object.freeze({
  admin: Object.freeze({ home: 'dashboard', work: 'staff', academic: 'academics', finance: 'reports', more: 'more' }),
  teacher: Object.freeze({ home: 'home', work: 'classes', academic: 'academic', finance: null, more: 'more' }),
  manager: Object.freeze({ home: 'dashboard', work: 'students', academic: 'academic', finance: 'finance', more: 'more' }),
  payment: Object.freeze({ home: 'home', work: 'students', academic: null, finance: 'payment', more: 'more' })
});

const ROUTE_ALIASES = Object.freeze({
  admin: Object.freeze({
    system: 'more', students: 'work', 'class-chat': 'more', profile: 'more', settings: 'more',
    data: 'more', 'data-stats': 'more', 'data-danger': 'more', backup: 'more',
    'backup-export': 'more', 'backup-restore': 'more', audit: 'more', 'audit-log': 'more',
    'audit-exam': 'more', security: 'more', 'security-owner': 'more', 'security-password': 'more',
    'security-protected': 'more', 'security-boundaries': 'more', 'security-devices': 'more',
    'device-fingerprint': 'more', migration: 'more', 'migration-teacher': 'more',
    'migration-student': 'more', roles: 'more', 'roles-admin': 'more', 'roles-manager': 'more',
    'roles-teacher': 'more', 'roles-payment': 'more', 'roles-student': 'more', content: 'more',
    'content-lecture-sheets': 'more', 'content-notices': 'more', 'content-records': 'more',
    advice: 'more', 'advice-editor': 'more', phonebook: 'more',
    'settings-branding': 'more', 'settings-classes': 'more', 'settings-broadcast': 'more',
    'settings-maintenance': 'more', 'profile-account': 'more', 'profile-notification': 'more',
    'profile-app': 'more', 'profile-security': 'more', 'profile-data': 'more',
    'academics-add': 'academic', 'academics-subjects': 'academic', 'academics-mapping': 'academic'
  }),
  teacher: Object.freeze({ 'class-chat': 'academic', exam: 'academic', homework: 'academic', suggestion: 'academic', routine: 'academic', 'online-exams': 'academic', notice: 'academic', courses: 'academic', 'lecture-sheets': 'academic', 'routine-view': 'academic', reports: 'academic', marks: 'academic', attendance: 'academic', 'routine-today': 'academic', 'routine-tomorrow': 'academic', 'routine-weekly': 'academic', 'routine-class': 'academic', 'routine-exam': 'academic', 'routine-changed': 'academic', 'routine-holiday': 'academic', 'routine-important': 'academic', 'routine-other': 'academic', profile: 'more', settings: 'more', advice: 'more' }),
  manager: Object.freeze({ 'class-chat': 'more', 'academic-records': 'academic', classes: 'academic', teachers: 'work', notices: 'academic', routine: 'academic', 'routine-today': 'academic', 'routine-tomorrow': 'academic', 'routine-weekly': 'academic', 'routine-class': 'academic', 'routine-exam': 'academic', 'routine-changed': 'academic', 'routine-holiday': 'academic', 'routine-important': 'academic', 'routine-other': 'academic', exams: 'academic', courses: 'academic', 'lecture-sheets': 'academic', results: 'academic', reports: 'more', phonebook: 'more', profile: 'more', settings: 'more', advice: 'more' }),
  payment: Object.freeze({ profile: 'more', reports: 'finance' })
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


/**
 * Bind the shared five-tab click engine. Role panels supply only their existing
 * guarded route adapter; this handler owns the common tab event contract and
 * captures the event before any legacy per-button listener can double-navigate.
 */
export function bindStaffNavigation({ role, root = typeof document !== 'undefined' ? document : null, onNavigate } = {}) {
  const normalizedRole = String(role || '').toLowerCase();
  if (!STAFF_NAV_ROUTES[normalizedRole] || !root?.addEventListener || typeof onNavigate !== 'function') return false;
  const handler = event => {
    const button = event.target?.closest?.('.staff-bottom-nav [data-staff-tab]');
    if (!button || button.disabled) return;
    const route = STAFF_NAV_ROUTES[normalizedRole][button.dataset.staffTab];
    if (!route) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onNavigate(route, button);
  };
  root.addEventListener('click', handler, true);
  return true;
}
