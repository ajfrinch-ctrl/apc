/* অ্যাকাউন্ট গ্রুপ — একই ফর্ম, চারটি স্টাফ প্যানেলে
   (মালিক-নির্দেশ ২০২৬-১১-০২: universal staff panel, ধাপ A)

   আগে অ্যাকাউন্ট গ্রুপ চার প্যানেলে চার রকম ছিল: Admin-এ ইনলাইন প্রোফাইল ফর্ম ও
   পাসওয়ার্ড ফর্ম, Teacher/Manager-এ শুধু রো-লিংক, Cash Counter-এ শুধু তথ্য-সারি।
   এখন Admin-এর ইনলাইন রূপটাই একমাত্র রূপ — এই মডিউল সেটাই তিনটি প্যানেলে বসায়।

   এখানে কোনো নতুন capability তৈরি হয় না: সব কিছু আগের public API দিয়েই লেখা হয় —
   readStaffAccount / updateStaffProfile / changeStaffPassword — এবং ডিরেক্টরি
   স্টাফের নিজের রেকর্ডে মিরর করা হয় আগের মতোই (staff-self-edit-এর নিয়ম)।

   মার্কআপ ঠিক এক: শুধু id-র উপসর্গ ভূমিকা অনুযায়ী বদলায়, তাই একই CSS, একই
   `data-settings-row` কী, একই ভ্যালিডেশন। লগআউট বাটনের id প্যানেল দেয় (পুরোনো
   id-গুলো অপরিবর্তিত থাকে, যাতে পুরোনো হ্যান্ডলার ভাঙে না)। */

import { iconElement } from './icons.js';
import { changeStaffPassword, readStaffAccount, updateStaffProfile } from './staff-auth.js';

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SESSION_COPY = Object.freeze({
  admin: 'এই ডিভাইসে লগইন করা আছেন। কাজ শেষ হলে লগআউট করুন।',
  teacher: 'এই ডিভাইসে লগইন করা আছেন। কাজ শেষ হলে লগআউট করুন।',
  manager: 'এই ডিভাইসে লগইন করা আছেন। কাজ শেষ হলে লগআউট করুন।',
  payment: 'এই ডিভাইসে লগইন করা আছেন। কাজ শেষ হলে লগআউট করুন।'
});

/** The one account group, as markup. No panel-specific variation. */
export function staffAccountMarkup({ role, logoutId, session } = {}) {
  const id = suffix => `${role}${suffix}`;
  return `<div class="settings-list">
      <article class="admin-card staff-account-card">
        <header class="admin-card-head">
          <div><h2>আমার তথ্য হালনাগাদ</h2><p class="admin-card-hint">নাম, মোবাইল ও ইমেইল বদলানো যায় — লগইন আইডি ও স্টাফ আইডি অপরিবর্তিত থাকে।</p></div>
        </header>
        <form id="${id('ProfileForm')}" data-settings-row="profile" class="staff-form" novalidate autocomplete="off">
          <div class="staff-form-grid">
            <div class="staff-field">
              <label for="${id('ProfileName')}">পূর্ণ নাম *</label>
              <input id="${id('ProfileName')}" name="fullName" type="text" autocomplete="name" maxlength="100" required>
            </div>
            <div class="staff-field">
              <label for="${id('ProfileMobile')}">মোবাইল নম্বর *</label>
              <input id="${id('ProfileMobile')}" name="mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX">
            </div>
            <div class="staff-field">
              <label for="${id('ProfileEmail')}">ইমেইল (ঐচ্ছিক)</label>
              <input id="${id('ProfileEmail')}" name="email" type="email" autocomplete="email" maxlength="254">
            </div>
            <div class="staff-field">
              <label for="${id('ProfileUserId')}">লগইন আইডি</label>
              <div class="auto-id-preview" id="${id('ProfileUserId')}" role="status" aria-live="polite">—</div>
              <small>স্বয়ংক্রিয়ভাবে তৈরি — নামের প্রথম অংশ + ভূমিকা + .apc</small>
            </div>
          </div>
          <p class="finance-error" id="${id('ProfileError')}" role="alert" hidden></p>
          <button class="admin-btn primary" type="submit">তথ্য সংরক্ষণ করুন</button>
        </form>
      </article>
      <article class="admin-card staff-account-card">
        <header class="admin-card-head">
          <div><h2>নিজের পাসওয়ার্ড বদল</h2><p class="admin-card-hint">নিরাপত্তার জন্য বর্তমান পাসওয়ার্ড দিয়ে নিশ্চিত করে নতুন পাসওয়ার্ড দিন।</p></div>
        </header>
        <form id="${id('PasswordForm')}" data-settings-row="password" class="staff-form" novalidate autocomplete="off">
          <div class="staff-form-grid">
            <div class="staff-field">
              <label for="${id('CurrentPassword')}">বর্তমান পাসওয়ার্ড *</label>
              <input id="${id('CurrentPassword')}" name="currentPassword" type="password" autocomplete="current-password" minlength="6" maxlength="32" required>
            </div>
            <div class="staff-field">
              <label for="${id('NewPassword')}">নতুন পাসওয়ার্ড *</label>
              <input id="${id('NewPassword')}" name="newPassword" type="password" autocomplete="new-password" minlength="6" maxlength="32" required>
              <small>৬–৩২ অক্ষর</small>
            </div>
            <div class="staff-field">
              <label for="${id('ConfirmPassword')}">নতুন পাসওয়ার্ড নিশ্চিত করুন *</label>
              <input id="${id('ConfirmPassword')}" name="confirmPassword" type="password" autocomplete="new-password" minlength="6" maxlength="32" required>
            </div>
          </div>
          <p class="finance-error" id="${id('PasswordError')}" role="alert" hidden></p>
          <button class="admin-btn primary" type="submit">পাসওয়ার্ড বদল করুন</button>
        </form>
      </article>
      <article class="admin-card admin-session-card">
        <div class="admin-session-copy"><h2>সেশন</h2><p>${escapeHtml(session || SESSION_COPY[role] || SESSION_COPY.admin)}</p></div>
        <button class="admin-btn ghost admin-logout-btn" type="button" data-settings-row="logout" id="${logoutId || id('AccountLogout')}">${iconElement('logout', 'apc-glyph-icon').outerHTML} লগআউট</button>
      </article>
    </div>`;
}

/**
 * Fill (and wire) the account group of a settings hub with the one inline form.
 * Runs BEFORE mountSettingsHub so the hub sees the rows already present and
 * never adds a second control for the same setting.
 *
 * @param {object} options
 * @param {string|Element} options.hub  the `.settings-hub` root
 * @param {string} options.role         admin | teacher | manager | payment
 * @param {string} [options.logoutId]   the panel's existing logout button id
 * @param {Function} [options.onLogout]
 * @param {Function} [options.current]  returns the already-loaded account (optional)
 * @param {Function} [options.toast]
 */
export function mountStaffAccountGroup({ hub, role, logoutId, onLogout, current, toast } = {}) {
  const root = typeof hub === 'string' ? document.querySelector(hub) : hub;
  if (!root || !role) return null;
  const section = root.querySelector('[data-settings-group="account"]');
  if (!section) return null;
  if (section.dataset.accountForms === '1') return section;
  section.dataset.accountForms = '1';

  const present = section.querySelector('[data-settings-row="profile"]') || section.querySelector('[data-settings-row="password"]');
  if (present) return section; // the page already carries the one canonical form

  const say = message => { if (typeof toast === 'function') toast(message); };
  section.insertAdjacentHTML('beforeend', staffAccountMarkup({ role, logoutId }));

  const $ = selector => section.querySelector(selector);
  const profileForm = $(`#${role}ProfileForm`);
  const passwordForm = $(`#${role}PasswordForm`);
  const profileError = $(`#${role}ProfileError`);
  const passwordError = $(`#${role}PasswordError`);
  const loginId = $(`#${role}ProfileUserId`);

  let account = null;
  const fill = data => {
    account = data || null;
    if (!profileForm) return;
    profileForm.fullName.value = data?.fullName || '';
    profileForm.mobile.value = data?.mobile || '';
    profileForm.email.value = data?.email || '';
    if (loginId) loginId.textContent = data?.username || '—';
  };
  try {
    const seed = typeof current === 'function' ? current() : null;
    if (seed) fill(seed);
  } catch { /* the async read below is the source of truth */ }
  void (async () => {
    try {
      const loaded = await readStaffAccount(role);
      if (loaded) fill({ ...loaded, ...(account || {}) });
    } catch { /* keep the blank form: the person can type it in */ }
  })();

  profileForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (profileError) { profileError.hidden = true; profileError.textContent = ''; }
    if (!profileForm.reportValidity()) return;
    const data = Object.fromEntries(new FormData(profileForm));
    const patch = { fullName: String(data.fullName || '').trim().replace(/\s+/g, ' ') };
    const mobile = String(data.mobile || '').trim();
    const email = String(data.email || '').trim().toLowerCase();
    if (mobile) patch.mobile = mobile;
    if (email) patch.email = email;
    /* A Staff Directory sign-in edits its own directory record (mirrored
       everywhere it is shown); a device role account edits itself. */
    let directoryEdit = null;
    try {
      const { mirrorSelfProfileToDirectory } = await import('./staff-directory.js');
      directoryEdit = await mirrorSelfProfileToDirectory(String(account?.username || '').trim().toLowerCase(), patch);
    } catch { directoryEdit = null; }
    if (!directoryEdit?.found) {
      const result = await updateStaffProfile(role, patch);
      if (!result?.ok) {
        if (profileError) { profileError.textContent = result?.error || 'তথ্য সংরক্ষণ করা হয়নি।'; profileError.hidden = false; }
        return;
      }
    } else if (!directoryEdit.ok) {
      if (profileError) { profileError.textContent = 'ডিরেক্টরিতে সংরক্ষণ করা হয়নি — স্টোরেজ পরীক্ষা করুন।'; profileError.hidden = false; }
      return;
    }
    fill({ ...(account || {}), ...patch });
    say('প্রোফাইল হালনাগাদ করা হয়েছে');
  });

  passwordForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (passwordError) { passwordError.hidden = true; passwordError.textContent = ''; }
    if (!passwordForm.reportValidity()) return;
    const data = Object.fromEntries(new FormData(passwordForm));
    const next = String(data.newPassword || '');
    const confirm = String(data.confirmPassword || '');
    if (next !== confirm) {
      if (passwordError) { passwordError.textContent = 'দুইবার লেখা নতুন পাসওয়ার্ড মিলছে না।'; passwordError.hidden = false; }
      return;
    }
    const result = await changeStaffPassword(role, String(data.currentPassword || ''), next, confirm);
    if (!result?.ok) {
      if (passwordError) { passwordError.textContent = result?.error || 'পাসওয়ার্ড বদল করা যায়নি।'; passwordError.hidden = false; }
      return;
    }
    passwordForm.reset();
    say('পাসওয়ার্ড বদল করা হয়েছে');
  });

  section.querySelector('[data-settings-row="logout"]')?.addEventListener('click', () => {
    if (typeof onLogout === 'function') onLogout();
  });

  return section;
}
