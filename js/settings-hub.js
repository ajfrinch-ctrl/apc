/* One Settings structure for every role (docs/APP-ARCHITECTURE.md §29).

   Every panel's Settings surface — Student আরও → সেটিংস, Teacher/Manager প্রোফাইল,
   Admin অ্যাকাউন্ট and the Cash Counter's আরও — is the same five groups in the same
   order:

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
  profile: ['#managerProfileCard', '#teacherProfileCard', '#adminProfileCard', '[data-action="edit-profile"]'],
  password: ['#managerChangePassword', '#teacherChangePassword', '#adminPasswordForm'],
  logout: ['#adminAccountLogout', '#payMoreLogout', '[data-action="logout"]'],
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

function infoRow({ key, label, hint, value }) {
  const node = document.createElement('div');
  node.className = 'settings-info';
  node.dataset.settingsRow = key;
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
 * @param {{ mount: Element|string, role?: string, actions?: object, session?: object }} options
 */
export function mountSettingsHub({ mount, role = 'student', actions = {}, session = null } = {}) {
  const root = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!root) return { groups: [], mounted: false };
  root.dataset.settingsHub = role;

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
        list().append(infoRow({ key: 'device', label: 'এই ডিভাইস', hint: 'লগইন এই ডিভাইসেই বাঁধা থাকে', value: session?.device || 'বিশ্বস্ত' }));
      }
      if (!present(section, 'session')) {
        list().append(infoRow({ key: 'session', label: 'সেশন', hint: session?.hint || 'ডিভাইস-বাউন্ড সেশন', value: session?.value || '—' }));
      }
      if (!present(section, 'password-policy') && session?.password) {
        list().append(infoRow({ key: 'password-policy', label: 'পাসওয়ার্ড নীতি', hint: session.password }));
      }
    }

    if (group.key === 'data') {
      if (!present(section, 'offline')) {
        list().append(infoRow({ key: 'offline', label: 'অফলাইন ডেটা', hint: 'ইন্টারনেট ছাড়াও সব কাজ এই ডিভাইসে সংরক্ষিত থাকে', value: 'এই ডিভাইসে' }));
      }
      if (!present(section, 'storage')) {
        list().append(infoRow({ key: 'storage', label: 'সংরক্ষিত আকার', hint: 'অ্যাপের ডেটা — এই ডিভাইসে', value: storedSize() }));
      }
    }
  }

    return { groups: SETTINGS_GROUPS.map(group => group.key), mounted: true };
}
