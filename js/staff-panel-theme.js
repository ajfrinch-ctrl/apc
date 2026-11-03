/* Resolve the staff-panel root marker for shared layout rules.
   All four roles inherit the same Active Plus palette; this marker does not
   recolour a panel, grant access, change routes or alter capabilities. */

export const STAFF_PANEL_ROLES = Object.freeze(['teacher', 'manager', 'admin', 'payment']);

const ROLE_BY_FILE = Object.freeze({
  'teacher.html': 'teacher',
  'manager.html': 'manager',
  'admin.html': 'admin',
  'payment.html': 'payment'
});

export function staffRoleFromPath(pathname = '') {
  const file = String(pathname || '').split(/[?#]/, 1)[0].split('/').pop().toLowerCase();
  return ROLE_BY_FILE[file] || '';
}

export function applyStaffPanelTheme({
  root = typeof document !== 'undefined' ? document.documentElement : null,
  pathname = typeof window !== 'undefined' ? window.location.pathname : ''
} = {}) {
  if (!root?.dataset) return '';
  const role = staffRoleFromPath(pathname);
  if (!STAFF_PANEL_ROLES.includes(role)) return '';
  root.dataset.staffPanel = role;
  return role;
}

if (typeof document !== 'undefined') applyStaffPanelTheme();
