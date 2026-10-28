/* Reuse the existing, stateful Admin feature mounts in their routed detail
   screens. Moving a node (never cloning it) preserves its listeners, form
   values and the storage/auth logic owned by the original feature modules. */

const $ = selector => document.querySelector(selector);
const detailSlot = view => $(`.admin-view[data-view-panel="${view}"] [data-admin-detail-slot]`);

function placeAcademics(view) {
  const root = $('#adminAcademics');
  const hub = $('.admin-view[data-view-panel="academics"]');
  if (!root || !hub) return;
  const key = ({ 'academics-add': 'add', 'academics-subjects': 'subjects', 'academics-mapping': 'mapping' })[view];
  const destination = key ? detailSlot(view) : hub;
  if (destination && root.parentElement !== destination) destination.append(root);
  if (key && destination) root.dataset.openAcademicCard = key;
  else delete root.dataset.openAcademicCard;
}

function placeMigration(view) {
  const root = $('#adminV2Migration');
  const hub = $('.admin-view[data-view-panel="migration"]');
  if (!root || !hub) return;
  const index = ({ 'migration-teacher': 0, 'migration-student': 1 })[view];
  const destination = index !== undefined ? detailSlot(view) : hub;
  if (destination && root.parentElement !== destination) destination.append(root);
  root.querySelectorAll('.v2-migration-card').forEach((card, i) => {
    card.classList.toggle('is-open', Boolean(destination) && index === i);
  });
}

function placeProfile(view) {
  const root = $('[data-settings-hub="admin"]');
  const hub = $('.admin-view[data-view-panel="profile"]');
  const identity = $('#adminProfileCard');
  if (!root || !hub) return;
  const groups = ['account', 'notification', 'app', 'security', 'data'];
  const key = groups.find(group => view === `profile-${group}`) || '';
  const destination = key ? detailSlot(view) : hub;
  if (!destination) return;

  // The identity card belongs to Account; the same edit button and forms are
  // moved with it, not duplicated. Keep the original order in the hub on exit.
  if (key === 'account' && identity) destination.append(identity);
  else if (identity && identity.parentElement !== hub) hub.insertBefore(identity, root.parentElement === hub ? root : null);
  if (root.parentElement !== destination) destination.append(root);
  if (!key && identity && identity.nextElementSibling !== root) hub.insertBefore(identity, root);
  root.__apcShowSettingsGroup?.(key);
}

/** Called only after the route/capability guard has accepted the destination. */
export function activateAdminDetail(view) {
  placeAcademics(view);
  placeMigration(view);
  placeProfile(view);
  placeDeviceFingerprint(view);
  placeSecurityDevices(view);
}

/** Render the current device's own key fingerprint into the detail slot. */
function placeDeviceFingerprint(view) {
  if (view !== 'device-fingerprint') return;
  const slot = detailSlot(view);
  if (!slot) return;
  import('./device-fingerprint.js').then(mod => {
    mod.renderDeviceFingerprint(slot);
  }).catch(err => {
    slot.innerHTML = `<p class="admin-empty">ফিঙ্গারপ্রিন্ট লোড করা যায়নি।</p>`;
    console.warn('[Active Plus] device fingerprint render failed:', err?.message);
  });
}

/** Render the admin device-approval list into the detail slot. */
function placeSecurityDevices(view) {
  if (view !== 'security-devices') return;
  const slot = detailSlot(view);
  if (!slot) return;
  import('./admin-device-approvals.js').then(mod => {
    mod.renderDeviceApprovals(slot);
  }).catch(err => {
    slot.innerHTML = `<p class="admin-empty">ডিভাইস তালিকা লোড করা যায়নি।</p>`;
    console.warn('[Active Plus] device approvals render failed:', err?.message);
  });
}

/** Move the dynamic Role/Security cards their existing renderers generated to
    their matching full-screen slots, preserving any listeners on the cards. */
export function placeRenderedDetails(host, attribute, prefix) {
  if (!host) return;
  host.querySelectorAll(`[data-${attribute}]`).forEach(panel => {
    const key = panel.getAttribute(`data-${attribute}`);
    const destination = detailSlot(`${prefix}-${key}`);
    if (!destination) { panel.remove(); return; }
    panel.hidden = false;
    destination.replaceChildren(panel);
  });
}
