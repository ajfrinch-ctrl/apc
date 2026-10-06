/* Admin Panel capability layer — a read-only projection of the role boundary
   that already exists in this repository.

   Sources of truth (never modified by this file):
     • firestore.rules      — Admin owns reports, settings, notices, routine,
                              transactions and exam records; a Manager may
                              approve/reject a student (and, by owner
                              decision 2026-09-30, the Admin too — see
                              js/registration-review.js) and is the only role
                              that may publish/reject a pending exam.
     • functions/index.js   — "Manager is the only role allowed to publish or
                              reject pending exam records."
     • manager.html         — the separate approval portal (students + exams).
     • teacher.html / payment.html — their own panels, each with its own role.

   The module adds no storage key, no role and no business rule. It converts the
   role the signed-in staff account already carries into the set of Admin Panel
   views, menus, cards, shortcuts, actions and routes that may exist for that
   role, and provides the helpers used to enforce it on both sides of the app:

     1. UI visibility  — mark anything role-specific with `data-admin-cap`;
                         `enforceCapabilities()` removes what is not granted.
     2. Access control — `Access.allowsView()` guards `setView()`, the hash
                         route and every deep link.

   Removing an element (instead of styling it away) keeps unauthorised markup,
   data and handlers out of the DOM entirely, so a hidden feature can never be
   reached by keyboard, inspect-element or a copied URL.

   ---------------------------------------------------------------------------
   Admin Panel scope (System Control + Staff + Permissions + Security + Data +
   Reports + Settings)
   ---------------------------------------------------------------------------
   Daily operations are NOT Admin territory and are deliberately not granted
   here — they stay in the panel that owns them:

     • fee collection / cash-counter entry  → payment.html (Cash Counter)
     • routine entry, daily notices         → manager.html (Manager)
     • student approval, exam publish       → manager.html (Manager)
     • class teaching, homework, attendance → teacher.html (Teacher)
*/

/** Every capability the Admin Panel can expose. Keys are stable strings so
 *  markup (`data-admin-cap`), the view map and tests all speak one language. */
export const CAPABILITIES = Object.freeze({
  /* System-level sections the Admin Panel owns. */
  DASHBOARD: 'dashboard.view',
  STAFF_MANAGE: 'staff.manage',
  ROLES_MANAGE: 'roles.manage',
  STUDENTS_VIEW: 'students.view',
  STUDENTS_MANAGE: 'students.manage',
  REPORTS_VIEW: 'reports.view',
  DATA_MANAGE: 'data.manage',
  BACKUP_MANAGE: 'backup.manage',
  SECURITY_MANAGE: 'security.manage',
  SETTINGS_MANAGE: 'settings.manage',
  PROFILE_VIEW: 'profile.view',

  /* Student registration approval: Manager and — by owner decision
     2026-09-30 — Admin (js/registration-review.js is the shared path). */
  STUDENTS_APPROVE: 'students.approve',

  /* Kept so the existing role boundary stays readable in one place. None of
     these is granted to Admin: they belong to the Manager / Teacher / Cash
     Counter panels and to their own portals. */
  FINANCE_VIEW: 'finance.view',
  FINANCE_COLLECT: 'finance.collect',
  NOTICES_MANAGE: 'notices.manage',
  ROUTINE_MANAGE: 'routine.manage',
  CLASSES_MANAGE: 'classes.manage',
  APP_MANAGE: 'app.manage',
  EXAMS_VIEW: 'exams.view',
  EXAMS_PUBLISH: 'exams.publish',
  TEACHING_PANEL: 'teaching.panel',
  PAYMENT_PANEL: 'payment.panel'
});

/* The Admin role: system control, staff management, permissions, security,
   data, backup, reports, settings and the student overview. Daily collection,
   routine entry, notice publishing and teaching are intentionally absent. */
const ADMIN = Object.freeze([
  CAPABILITIES.DASHBOARD,
  CAPABILITIES.STAFF_MANAGE,
  CAPABILITIES.ROLES_MANAGE,
  CAPABILITIES.STUDENTS_VIEW,
  CAPABILITIES.STUDENTS_MANAGE,
  CAPABILITIES.STUDENTS_APPROVE,
  CAPABILITIES.REPORTS_VIEW,
  CAPABILITIES.DATA_MANAGE,
  CAPABILITIES.BACKUP_MANAGE,
  CAPABILITIES.SECURITY_MANAGE,
  CAPABILITIES.SETTINGS_MANAGE,
  CAPABILITIES.PROFILE_VIEW
]);

/* Kept for completeness so the same helper can drive any staff panel later.
   They are never granted inside admin.html. */
const MANAGER = Object.freeze([
  CAPABILITIES.STUDENTS_VIEW,
  CAPABILITIES.STUDENTS_APPROVE,
  CAPABILITIES.EXAMS_VIEW,
  CAPABILITIES.EXAMS_PUBLISH,
  CAPABILITIES.REPORTS_VIEW
]);

const TEACHER = Object.freeze([CAPABILITIES.TEACHING_PANEL, CAPABILITIES.ROUTINE_MANAGE, CAPABILITIES.EXAMS_VIEW]);
const PAYMENT = Object.freeze([CAPABILITIES.PAYMENT_PANEL, CAPABILITIES.FINANCE_COLLECT, CAPABILITIES.STUDENTS_VIEW]);
const STUDENT = Object.freeze([]);

export const ROLE_CAPABILITIES = Object.freeze({
  admin: ADMIN,
  manager: MANAGER,
  teacher: TEACHER,
  payment: PAYMENT,
  student: STUDENT
});

/** Which capability unlocks each Admin Panel view (route guard). `system` is
 *  the hub the four system screens are reached through (see ADMIN_SYSTEM_NAV). */
export const VIEW_CAPABILITIES = Object.freeze({
  dashboard: CAPABILITIES.DASHBOARD,
  staff: CAPABILITIES.STAFF_MANAGE,
  roles: CAPABILITIES.ROLES_MANAGE,
  students: CAPABILITIES.STUDENTS_VIEW,
  reports: CAPABILITIES.REPORTS_VIEW,
  system: CAPABILITIES.SETTINGS_MANAGE,
  data: CAPABILITIES.DATA_MANAGE,
  backup: CAPABILITIES.BACKUP_MANAGE,
  security: CAPABILITIES.SECURITY_MANAGE,
  academics: CAPABILITIES.SETTINGS_MANAGE,
  settings: CAPABILITIES.SETTINGS_MANAGE,
  profile: CAPABILITIES.PROFILE_VIEW
});

/** The bottom bar: হোম · স্টাফ · রিপোর্ট · সিস্টেম · ডেটা · অ্যাকাউন্ট.
 *  `order` keeps the tab order stable no matter which entries survive the
 *  capability filter. */
export const ADMIN_BOTTOM_NAV = Object.freeze([
  { view: 'dashboard', label: 'হোম', icon: 'dashboard', capability: CAPABILITIES.DASHBOARD, order: 1 },
  { view: 'staff', label: 'স্টাফ', icon: 'staff', capability: CAPABILITIES.STAFF_MANAGE, order: 2 },
  { view: 'reports', label: 'রিপোর্ট', icon: 'reports', capability: CAPABILITIES.REPORTS_VIEW, order: 3 },
  { view: 'system', label: 'সিস্টেম', icon: 'settings', capability: CAPABILITIES.SETTINGS_MANAGE, order: 4 },
  { view: 'data', label: 'ডেটা', icon: 'data', capability: CAPABILITIES.DATA_MANAGE, order: 5 },
  { view: 'profile', label: 'অ্যাকাউন্ট', icon: 'profile', capability: CAPABILITIES.PROFILE_VIEW, order: 6 }
]);

/** সিস্টেম hub cards — each opens a screen that already owns its work. */
export const ADMIN_SYSTEM_NAV = Object.freeze([
  { view: 'roles', label: 'Roles & Permissions', hint: 'রোলভিত্তিক অনুমতির ম্যাট্রিক্স', icon: 'roles', capability: CAPABILITIES.ROLES_MANAGE, order: 1 },
  { view: 'security', label: 'সিকিউরিটি', hint: 'সেশন, পাসওয়ার্ড নীতি ও সুরক্ষিত অ্যাকাউন্ট', icon: 'security', capability: CAPABILITIES.SECURITY_MANAGE, order: 2 },
  { view: 'settings', label: 'সিস্টেম সেটিংস', hint: 'অ্যাপ কন্ট্রোল, ব্র্যান্ডিং ও নোটিশ', icon: 'settings', capability: CAPABILITIES.SETTINGS_MANAGE, order: 3 },
  { view: 'academics', label: 'ক্লাস ও বিষয়', hint: 'ক্লাস, বিষয় ও শিক্ষক ম্যাপিংয়ের একক কেন্দ্র', icon: 'settings', capability: CAPABILITIES.SETTINGS_MANAGE, order: 4 }
]);

/** ডেটা hub cards — data management, then the one backup screen. */
export const ADMIN_DATA_NAV = Object.freeze([
  { view: 'backup', label: 'ব্যাকআপ ও রিস্টোর', hint: 'সম্পূর্ণ ব্যাকআপ নিন ও ফিরিয়ে আনুন', icon: 'backup', capability: CAPABILITIES.BACKUP_MANAGE, order: 1 }
]);

/** Which seat lights up for a view that lives inside a hub. */
export const VIEW_SEAT = Object.freeze({
  roles: 'system', security: 'system', settings: 'system', academics: 'system',
  backup: 'data',
  students: 'dashboard'
});

/** Dashboard tiles show system sections only, generated from the capabilities
 *  the signed-in role holds. No daily cash/fee entry tile. */
export const ADMIN_FEATURE_TILES = Object.freeze([
  { view: 'staff', label: 'স্টাফ ম্যানেজমেন্ট', icon: 'staff', capability: CAPABILITIES.STAFF_MANAGE, order: 1 },
  { view: 'students', label: 'নিবন্ধন অনুমোদন', icon: 'approval', capability: CAPABILITIES.STUDENTS_VIEW, order: 2 },
  { view: 'reports', label: 'রিপোর্ট', icon: 'reports', capability: CAPABILITIES.REPORTS_VIEW, order: 3 },
  { view: 'roles', label: 'Roles & Permissions', icon: 'roles', capability: CAPABILITIES.ROLES_MANAGE, order: 4 },
  { view: 'security', label: 'সিকিউরিটি', icon: 'security', capability: CAPABILITIES.SECURITY_MANAGE, order: 5 },
  { view: 'settings', label: 'সিস্টেম সেটিংস', icon: 'settings', capability: CAPABILITIES.SETTINGS_MANAGE, order: 6 },
  { view: 'data', label: 'Data Management', icon: 'data', capability: CAPABILITIES.DATA_MANAGE, order: 7 },
  { view: 'backup', label: 'Backup & Restore', icon: 'backup', capability: CAPABILITIES.BACKUP_MANAGE, order: 8 },
  { view: 'profile', label: 'Admin Profile', icon: 'profile', capability: CAPABILITIES.PROFILE_VIEW, order: 9 }
]);

export function capabilitiesForRole(role) {
  const key = String(role || '').trim().toLowerCase();
  return new Set(ROLE_CAPABILITIES[key] || []);
}

/**
 * Access object for one role. Cheap to build, safe to keep around, and the
 * single gate used by both the renderer and the router.
 */
export function createAccess(role) {
  const capabilities = capabilitiesForRole(role);
  return {
    role: String(role || '').trim().toLowerCase(),
    capabilities,
    has(capability) {
      return Boolean(capability) && capabilities.has(capability);
    },
    /** Route guard: a view is openable only while its capability is granted. */
    allowsView(view) {
      const key = String(view || '').trim();
      if (!key) return false;
      const capability = VIEW_CAPABILITIES[key];
      return capability ? this.has(capability) : false;
    },
    /** First bottom-bar tab this role may open — the fallback destination. */
    defaultView() {
      const first = ADMIN_BOTTOM_NAV
        .filter(entry => entry.capability === null || this.has(entry.capability))
        .sort((a, b) => a.order - b.order)[0];
      return first ? first.view : 'dashboard';
    },
    /** Entries (bottom bar / more menu / dashboard tiles) this role may see. */
    allowEntries(entries) {
      return entries
        .filter(entry => entry.capability === null || this.has(entry.capability))
        .sort((a, b) => a.order - b.order);
    }
  };
}

/** Capability required by a view, or null when the view is unknown. */
export function viewCapability(view) {
  return VIEW_CAPABILITIES[String(view || '').trim()] || null;
}

/** Route in the URL hash (admin.html#staff). Empty when absent/unknown. */
export function routeFromHash(hash) {
  const key = String(hash || '').replace(/^#/, '').replace(/^\/+/, '').trim();
  if (!key) return null;
  return Object.hasOwn(VIEW_CAPABILITIES, key) ? key : null;
}

/**
 * Remove every role-specific element and view the access object does not grant.
 * Removal (not `hidden`, not `opacity`) is deliberate: the markup, the data and
 * the handlers leave the DOM, so nothing can be reached by keyboard, by a
 * copied URL or by dev-tools.
 */
export function enforceCapabilities({ root, access } = {}) {
  const scope = root || document;
  const removed = { elements: [], views: [] };

  scope.querySelectorAll('[data-admin-cap]').forEach(element => {
    const capability = element.dataset.adminCap;
    if (!capability || access.has(capability)) return;
    removed.elements.push(element);
    element.remove();
  });

  scope.querySelectorAll('.admin-view[data-view-panel]').forEach(section => {
    const capability = viewCapability(section.dataset.viewPanel);
    if (!capability || access.has(capability)) return;
    removed.views.push(section.dataset.viewPanel);
    section.remove();
  });

  return removed;
}
