/* One Settings structure for the staff roles and Cash Counter
   (docs/APP-ARCHITECTURE.md §29). The Student keeps its compact inline controls
   inside আরও (no duplicate Settings page); this hub serves Teacher/Manager
   প্রোফাইল, Admin অ্যাকাউন্ট and the Cash Counter's আরও with the same five groups
   in the same order:

     অ্যাকাউন্ট   প্রোফাইল · পাসওয়ার্ড · লগআউট
     নোটিফিকেশন  চালু/বন্ধ · অনুমতি · ব্যাকগ্রাউন্ড · শব্দ · প্রিভিউ · ইতিহাস
     অ্যাপ        ইনস্টল · থিম
     নিরাপত্তা    এই ডিভাইস · সেশন · পাসওয়ার্ড নীতি
     ডেটা        অফলাইন ডেটা · সংরক্ষিত আকার

   Sync status is deliberately NOT a row: §8 keeps it on the topbar's own border
   colour, and the standing rule forbids visible sync text anywhere else.

   The group keys are the contract; a group's *content* stays with whichever module
   already owns that work (js/notification-settings.js, js/install.js,
   js/appearance.js, the panel's own profile/password/logout controls). This module
   therefore only fills what a page does not already own — a row is marked
   `data-settings-row="<key>"` — and it never creates a second control for a key the
   page already has. It is idempotent: mounting twice changes nothing.

   Presentation and wiring only — no storage key, no permission and no role rule is
   added here. */

import { initNotificationSettings } from './notification-settings.js';
import { installApp } from './install.js';
import { getTheme, setTheme } from './appearance.js';
import { iconElement } from './icons.js';
import { toBanglaNumber as bn } from './ui.js';

/** The canonical structure. Order is part of the contract. */
export const SETTINGS_GROUPS = Object.freeze([
  Object.freeze({ key: 'account', label: 'অ্যাকাউন্ট' }),
  Object.freeze({ key: 'notification', label: 'নোটিফিকেশন' }),
  Object.freeze({ key: 'app', label: 'অ্যাপ' }),
  Object.freeze({ key: 'security', label: 'নিরাপত্তা' }),
  Object.freeze({ key: 'data', label: 'ডেটা' })
]);

/** Which rows each group owns. Keys are stable so markup and tests agree. */
export const SETTINGS_ROWS = Object.freeze({
  account: Object.freeze(['profile', 'password', 'logout']),
  app: Object.freeze(['install', 'theme']),
  security: Object.freeze(['device', 'session', 'password-policy']),
  data: Object.freeze(['offline', 'storage'])
});

/* Controls that already existed before the hub and keep their own ids. A key is
   "already there" when the page carries either the row marker or one of these, so
   no panel ever shows the same setting twice. */
const EXISTING = Object.freeze({
  profile: ['#adminProfileForm', '#teacherProfileForm', '#managerProfileForm', '#paymentProfileForm',
    '#managerProfileCard', '#teacherProfileCard', '#adminProfileCard', '[data-action="edit-profile"]'],
  password: ['#adminPasswordForm', '#teacherPasswordForm', '#managerPasswordForm', '#paymentPasswordForm'],
  logout: ['#adminAccountLogout', '#payMoreLogout', '#teacherAccountLogout', '#managerAccountLogout', '[data-action="logout"]'],
  install: ['[data-action="install"]', '[data-install]', '#installButton'],
  theme: ['#darkModeToggle', '[data-theme-toggle]', '[data-settings-toggle="theme"]'],
  device: ['#trustedDeviceToggle'],
  offline: ['[data-action="show-offline"]']
});

/* ---- small builders (the same classes the panels already style) ------------- */

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function icon(name, tone) {
  const wrap = element('span', `settings-icon${tone ? ' ' + tone : ''}`);
  wrap.setAttribute('aria-hidden', 'true');
  wrap.append(iconElement(name, 'apc-icon-svg'));
  return wrap;
}

function row({ key, iconName, tone, label, hint, action }) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'settings-row-link';
  node.dataset.settingsRow = key;
  node.append(icon(iconName, tone));
  const copy = element('span', 'settings-copy');
  copy.append(element('strong', '', label), element('small', '', hint));
  node.append(copy, icon('chevron-right'));
  if (action) node.addEventListener('click', action);
  return node;
}

function toggleRow({ key, iconName, tone, label, hint, checked, onChange }) {
  const label_ = document.createElement('label');
  label_.className = 'settings-toggle';
  label_.dataset.settingsRow = key;
  label_.append(icon(iconName, tone));
  const copy = element('span', 'settings-copy');
  copy.append(element('strong', '', label), element('small', '', hint));
  const switchWrap = element('span', 'toggle-switch');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  input.dataset.settingsToggle = key;
  switchWrap.append(input, element('i'));
  label_.append(copy, switchWrap);
  input.addEventListener('change', () => onChange?.(input.checked));
  return label_;
}

function infoRow({ key, iconName, tone, label, hint, value }) {
  const node = document.createElement('div');
  node.className = 'settings-info';
  node.dataset.settingsRow = key;
  if (iconName) node.append(icon(iconName, tone));
  const copy = element('span', 'settings-copy');
  copy.append(element('strong', '', label), element('small', '', hint));
  node.append(copy);
  if (value != null) node.append(element('span', 'settings-value', value));
  return node;
}

/* ---- runtime facts --------------------------------------------------------- */

/** This device's app-data footprint, in the same units every device shows. */
export function storedSize() {
  let bytes = 0;
  try {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index) || '';
      if (!key.startsWith('activePlus')) continue;
      bytes += (key.length + String(window.localStorage.getItem(key) || '').length) * 2;
    }
  } catch { return ''; }
  if (!bytes) return '০ বাইট';
  const units = ['বাইট', 'কিলোবাইট', 'মেগাবাইট'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${bn(Math.round(value * 10) / 10)} ${units[unit]}`;
}

/* ---- the hub --------------------------------------------------------------- */

/**
 * Fill a panel's Settings surface with the canonical five groups.
 * Existing content is respected: a row is added only when its key is missing.
 * @param {{ mount: Element|string, role?: string, actions?: object, session?: object, onGroupNavigate?: function }} options
 */
export function mountSettingsHub({ mount, role = 'student', actions = {}, session = null, onGroupNavigate = null } = {}) {
  const root = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!root) return { groups: [], mounted: false };
  root.dataset.settingsHub = role;
  // Admin can route each group as a full page; other portals keep their
  // existing local group behaviour and use the same controls and content.
  root.__apcNavigateSettingsGroup = typeof onGroupNavigate === 'function' ? onGroupNavigate : null;

  const groupFor = key => {
    let section = root.querySelector(`[data-settings-group="${key}"]`);
    if (!section) {
      section = element('div', 'profile-section');
      section.dataset.settingsGroup = key;
      root.append(section);
    }
    return section;
  };
  /* A key is "already there" when the surface carries its row marker or one of
     the controls that predate the hub. The search stays inside the surface: a
     button with the same intent elsewhere in the page (the Student's আরও menu
     also edits the profile) must not make the hub skip the row here. */
  const present = (section, key) => Boolean(
    section.querySelector(`[data-settings-row="${key}"]`) ||
    (EXISTING[key] || []).some(selector => root.querySelector(selector))
  );

  for (const group of SETTINGS_GROUPS) {
    const section = groupFor(group.key);
    const list = () => section.querySelector('.settings-list') || section.appendChild(element('div', 'settings-list'));

    if (group.key === 'account') {
      if (!present(section, 'profile') && actions.profile) {
        list().append(row({ key: 'profile', iconName: 'user', tone: 'mint', label: 'প্রোফাইল', hint: 'নিজের তথ্য দেখুন ও হালনাগাদ করুন', action: actions.profile }));
      }
      if (!present(section, 'password') && actions.password) {
        list().append(row({ key: 'password', iconName: 'lock', tone: 'amber', label: 'পাসওয়ার্ড', hint: 'নিজের লগইন পাসওয়ার্ড বদলান', action: actions.password }));
      }
      if (!present(section, 'logout') && actions.logout) {
        list().append(row({ key: 'logout', iconName: 'logout', tone: 'danger', label: 'লগআউট', hint: 'এই ডিভাইস থেকে সেশন শেষ করুন', action: actions.logout }));
      }
    }

    if (group.key === 'notification') {
      /* js/notification-settings.js owns this group and renders its own sections:
         the hub only hands it a mount point. */
      let notificationMount = section.querySelector('.notification-settings-mount');
      if (!notificationMount && !section.querySelector('[data-settings-row="notification-link"]')) {
        notificationMount = element('div', 'notification-settings-mount');
        section.append(notificationMount);
      }
      if (notificationMount) {
        section.dataset.settingsOwner = 'notification';
        initNotificationSettings({ mount: notificationMount });
      }
    }

    if (group.key === 'app') {
      if (!present(section, 'install')) {
        list().append(row({ key: 'install', iconName: 'smartphone', tone: 'green', label: 'অ্যাপ ইনস্টল করুন', hint: 'হোম স্ক্রিন থেকে দ্রুত খুলতে অ্যাপ হিসেবে যোগ করুন', action: () => { void installApp(); } }));
      }
      if (!present(section, 'theme')) {
        list().append(toggleRow({
          key: 'theme', iconName: 'moon', tone: 'purple', label: 'গাঢ় থিম', hint: 'AMOLED কালো — চোখের আরাম ও ব্যাটারি সাশ্রয়',
          checked: getTheme() === 'dark',
          onChange: on => { setTheme(on ? 'dark' : 'light'); }
        }));
      }
    }

    if (group.key === 'security') {
      if (!present(section, 'device')) {
        list().append(infoRow({ key: 'device', iconName: 'smartphone', tone: 'mint', label: 'এই ডিভাইস', hint: 'লগইন এই ডিভাইসেই বাঁধা থাকে', value: session?.device || 'বিশ্বস্ত' }));
      }
      if (!present(section, 'session')) {
        list().append(infoRow({ key: 'session', iconName: 'lock', tone: 'purple', label: 'সেশন', hint: session?.hint || 'ডিভাইস-বাউন্ড সেশন', value: session?.value || '—' }));
      }
      if (!present(section, 'password-policy') && session?.password) {
        list().append(infoRow({ key: 'password-policy', iconName: 'shield', tone: 'mint', label: 'পাসওয়ার্ড নীতি', hint: session.password }));
      }
    }

    if (group.key === 'data') {
      if (!present(section, 'offline')) {
        list().append(infoRow({ key: 'offline', iconName: 'offline-data', tone: 'mint', label: 'অফলাইন ডেটা', hint: 'ইন্টারনেট ছাড়াও সব কাজ এই ডিভাইসে সংরক্ষিত থাকে', value: 'এই ডিভাইসে' }));
      }
      if (!present(section, 'storage')) {
        list().append(infoRow({ key: 'storage', iconName: 'data', tone: 'green', label: 'সংরক্ষিত আকার', hint: 'অ্যাপের ডেটা — এই ডিভাইসে', value: storedSize() }));
      }
    }
  }

  const EXISTING_ROW_ICONS = {
    profile: 'user',
    password: 'lock',
    logout: 'logout',
    install: 'smartphone',
    theme: 'moon',
    device: 'smartphone',
    session: 'lock',
    'password-policy': 'shield',
    offline: 'offline-data',
    storage: 'data'
  };
  root.querySelectorAll('[data-settings-row]').forEach(rowEl => {
    const key = rowEl.dataset.settingsRow || '';
    const iconName = EXISTING_ROW_ICONS[key];
    if (!iconName) return;
    const iconSlot = rowEl.querySelector('.settings-icon');
    if (iconSlot && !iconSlot.querySelector('svg')) {
      iconSlot.append(iconElement(iconName, 'apc-icon-svg'));
    }
    if (rowEl.classList.contains('settings-row-link') && rowEl.querySelectorAll('.settings-icon').length === 1) {
      rowEl.append(icon('chevron-right'));
    }
  });

  paintGroupHub(root);
  return { groups: SETTINGS_GROUPS.map(group => group.key), mounted: true };
}

const GROUP_ICONS = Object.freeze({
  account: 'user', notification: 'bell', app: 'smartphone', security: 'lock', data: 'reports'
});
const GROUP_SUBTITLES = Object.freeze({
  account: 'প্রোফাইল তথ্য, লগইন পাসওয়ার্ড পরিবর্তন ও লগআউট',
  notification: 'নোটিফিকেশন চালু/বন্ধ, ব্রাউজার অনুমতি, শব্দ, প্রিভিউ ও ইতিহাস',
  app: 'গাঢ় থিম (দিন/রাত) পরিবর্তন ও হোম স্ক্রিনে অ্যাপ ইনস্টল',
  security: 'বিশ্বস্ত ডিভাইস ও সেশন নিরাপত্তা তথ্য দেখুন',
  data: 'অফলাইন ডেটা সংরক্ষণ ও স্টোরেজ ব্যবহারের তথ্য'
});

function paintGroupHub(root) {
  if (root.dataset.settingsGrouped === '1') return;
  root.dataset.settingsGrouped = '1';
  SETTINGS_GROUPS.forEach(group => {
    const section = root.querySelector(`[data-settings-group="${group.key}"]`);
    if (!section) return;
    if (!section.querySelector('.settings-group-title')) {
      const head = element('div', 'settings-group-head');
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'pay-back settings-hub-back';
      back.dataset.settingsHubBack = '1';
      back.setAttribute('aria-label', 'সেটিংস গ্রুপে ফিরুন');
      /* A real back glyph, never a bare text arrow: .pay-back paints for
         the dark hero band (white on a translucent chip), which on a
         group's white card left this button effectively invisible — the
         "cannot go back" dead end reported on the Admin profile. The
         settings-hub-back skin below repaints it for surfaces. */
      back.append(iconElement('back', 'apc-icon-svg'));
      const title = element('h2', 'settings-group-title', group.label);
      head.append(back, title);
      section.prepend(head);
    }
    root.append(section);
    section.hidden = true;
  });
  let nav = root.querySelector('[data-settings-groups]');
  if (!nav) {
    const isTeacher = root.dataset.settingsHub === 'teacher';
    const isManager = root.dataset.settingsHub === 'manager';
    const isPayment = root.dataset.settingsHub === 'payment';
    const isActionCardHub = isTeacher || isManager || isPayment;
    nav = element('nav', isActionCardHub ? 'teacher-home-actions settings-group-grid' : 'pay-grid is-2 settings-group-grid');
    nav.dataset.settingsGroups = 'true';
    nav.setAttribute('aria-label', 'সেটিংস গ্রুপ');
    SETTINGS_GROUPS.forEach(group => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.settingsOpen = group.key;
      if (isActionCardHub) {
        button.className = `teacher-action-card${group.key === 'notification' ? ' is-accent' : ''}`;
        const body = element('span', 'teacher-action-body');
        const titleEl = element('span', 'teacher-action-title pay-tile-label', group.label);
        if (isManager || isPayment) {
          titleEl.dataset.actionSub = GROUP_SUBTITLES[group.key] || '';
          body.append(titleEl);
        } else {
          body.append(titleEl, element('span', 'teacher-action-sub', GROUP_SUBTITLES[group.key] || ''));
        }
        const iconHost = element('span', 'teacher-action-art pay-tile-icon');
        iconHost.setAttribute('aria-hidden', 'true');
        iconHost.append(iconElement(GROUP_ICONS[group.key] || 'settings', 'apc-icon-svg'));
        button.append(body, iconHost);
      } else {
        button.className = 'pay-tile';
        const iconHost = element('span', 'pay-tile-icon');
        iconHost.setAttribute('aria-hidden', 'true');
        iconHost.append(iconElement(GROUP_ICONS[group.key] || 'settings', 'apc-icon-svg'));
        button.append(iconHost, element('span', 'pay-tile-label', group.label));
      }
      nav.append(button);
    });
    root.prepend(nav);
  }
  const showGroup = key => {
    nav.hidden = Boolean(key);
    root.querySelectorAll('[data-settings-open]').forEach(btn => {
      const active = btn.dataset.settingsOpen === key;
      btn.classList.toggle('is-open', active);
      btn.setAttribute('aria-expanded', active ? 'true' : 'false');
    });
    root.querySelectorAll('[data-settings-group]').forEach(section => {
      section.hidden = section.dataset.settingsGroup !== key;
    });
  };
  root.addEventListener('click', event => {
    const open = event.target.closest('[data-settings-open]');
    if (open) {
      const targetKey = open.dataset.settingsOpen || '';
      if (root.__apcNavigateSettingsGroup) {
        root.__apcNavigateSettingsGroup(targetKey);
        return;
      }
      const targetSection = root.querySelector(`[data-settings-group="${targetKey}"]`);
      const alreadyOpen = Boolean(targetSection && !targetSection.hidden);
      const canToggleClose = root.dataset.settingsHub === 'teacher' || root.dataset.settingsHub === 'manager' || root.dataset.settingsHub === 'admin' || root.dataset.settingsHub === 'payment';
      showGroup(canToggleClose && alreadyOpen ? '' : targetKey);
      return;
    }
    if (event.target.closest('[data-settings-hub-back]')) {
      if (root.__apcNavigateSettingsGroup) root.__apcNavigateSettingsGroup('');
      else showGroup('');
    }
  });
  root.__apcShowSettingsGroup = showGroup;
}

/** Return a mounted hub to its group menu — no group left open. Panels call
 *  this when their Settings surface is (re-)entered, so a group opened on an
 *  earlier visit never greets the person again ("the part I clicked before
 *  is still showing"). Safe on a hub that was never grouped. */
export function resetSettingsHub(mount) {
  const root = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!root) return false;
  if (typeof root.__apcShowSettingsGroup === 'function') {
    root.__apcShowSettingsGroup('');
    return true;
  }
  const nav = root.querySelector('[data-settings-groups]');
  if (nav) nav.hidden = false;
  root.querySelectorAll('[data-settings-group]').forEach(section => { section.hidden = true; });
  return Boolean(nav);
}

/** Student More keeps one copy of each control, with live device/storage facts. */
export function mountStudentMoreSettings({ mount, session = {} } = {}) {
  const root = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!root) return;
  for (const item of [
    { key: 'session', label: 'সেশন', hint: session.hint, value: session.value },
    { key: 'storage', label: 'সংরক্ষিত আকার', hint: 'অ্যাপের ডেটা — এই ডিভাইসে', value: storedSize() }
  ]) {
    if (root.querySelector(`[data-settings-row="${item.key}"]`)) continue;
    const node = infoRow(item);
    node.classList.add('more-menu-row');
    node.prepend(icon(item.key === 'session' ? 'lock' : 'reports', 'mint'));
    root.append(node);
  }
}
