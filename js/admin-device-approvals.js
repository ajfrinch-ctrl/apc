/* Admin device-approval panel.
 *
 * STAGED — not connected to live sync or authorization yet. Pending devices
 * are tracked in localStorage; a real deployment would use a server-mediated
 * enrollment queue with out-of-band fingerprint verification (phone call).
 *
 * Flow:
 *   1. A device shows its fingerprint (device-fingerprint.js) and registers
 *      as pending in localStorage.
 *   2. Admin opens this panel, verifies each fingerprint over the phone.
 *   3. Admin approves: a random scope key is wrapped to the device's box
 *      public key and signed with the admin's signing key. The envelope JSON
 *      is shown on screen for the admin to read out / share with the device.
 *   4. The device enters the envelope (device-fingerprint.js), unwraps it,
 *      and is marked approved.
 *
 * Imports:
 *   sync/device-key-enrollment.js — key wrap, fingerprints, validation
 */
import {
  createDeviceKeyMaterial, createScopeKey, devicePublicKeyFingerprint,
  wrapScopeKey, validateDeviceKeyMaterial
} from '../sync/device-key-enrollment.js';

const PENDING_KEY = 'apc-pending-devices-v1';
const APPROVED_KEY = 'apc-approved-devices-v1';
const ADMIN_KEY = 'apc-admin-key-material-v1';
const SCOPE_ID = 'activeplus-sync-v1';

let adminMaterial = null; // in-memory: admin's own non-extractable CryptoKeys

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function readPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function writePending(list) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(list));
}
function readApproved() {
  try {
    const raw = localStorage.getItem(APPROVED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function writeApproved(list) {
  localStorage.setItem(APPROVED_KEY, JSON.stringify(list));
}

/** Ensure the admin has a full key pair (private keys in memory only).
 *  Private CryptoKeys cannot be serialized to localStorage, so a reload
 *  regenerates admin keys — acceptable for staged enrollment. */
async function ensureAdminMaterial() {
  if (adminMaterial && adminMaterial.signingPrivateKey && adminMaterial.boxPrivateKey) {
    return adminMaterial;
  }
  adminMaterial = await createDeviceKeyMaterial();
  localStorage.setItem(ADMIN_KEY, JSON.stringify({
    deviceId: adminMaterial.deviceId,
    boxPublicJwk: adminMaterial.boxPublicJwk,
    signingPublicJwk: adminMaterial.signingPublicJwk,
    boxFingerprint: adminMaterial.boxFingerprint,
    signingFingerprint: adminMaterial.signingFingerprint
  }));
  return adminMaterial;
}

/** Render the pending-device list and approval UI into the slot. */
export async function renderDeviceApprovals(slot) {
  await ensureAdminMaterial();
  const pending = readPending();
  const approved = readApproved();

  slot.innerHTML = `
    <div class="security-list">
      <div class="security-row">
        <div>
          <dt>অ্যাডমিন ডিভাইস আইডি</dt>
          <dd>${escapeHtml(adminMaterial.deviceId)}</dd>
        </div>
      </div>
      <div class="security-row">
        <div>
          <dt>অ্যাডমিন সাইনিং ফিঙ্গারপ্রিন্ট</dt>
          <dd class="fingerprint">${escapeHtml(adminMaterial.signingFingerprint)}</dd>
        </div>
      </div>
    </div>
    <p class="finance-hint">ফোনে ডিভাইস मालিকের সাথে কথা বলে ফিঙ্গারপ্রিন্ট যাচাই করুন, তারপর অনুমোদন বা অস্বীকার করুন।</p>
    <div class="staff-field">
      <label for="da-device-id">অনুমোদনের জন্য ডিভাইস আইডি (ফোনে পাওয়া কোড)</label>
      <input id="da-device-id" type="text" placeholder="ডিভাইস আইডি লিখুন">
    </div>
    <div class="staff-field">
      <label for="da-fingerprint">যাচাই করা ফিঙ্গারপ্রিন্ট (ফোনের মাধ্যমে পাওয়া কোড)</label>
      <input id="da-fingerprint" type="text" placeholder="ফিঙ্গারপ্রিন্ট লিখুন">
    </div>
    <div class="modal-actions" style="margin-bottom:12px">
      <button class="admin-btn primary" type="button" id="da-approve">ফিঙ্গারপ্রিন্ট যাচাই ও ডিভাইস অনুমোদন করুন</button>
      <button class="admin-btn ghost" type="button" id="da-reject">ডিভাইস সরান (অনুমোদন ছাড়া)</button>
    </div>
    <div id="da-envelope-box" class="staff-field" hidden>
      <label for="da-envelope">অনুমোদন কোড — ডিভাইসের কাছে এই কোডটি পাঠান</label>
      <textarea id="da-envelope" rows="4" readonly></textarea>
      <button class="mini-btn" type="button" id="da-copy-envelope">কপি করুন</button>
    </div>
    <h3>অনুমোদনের অপেক্ষায় থাকা ডিভাইস</h3>
    <div id="da-pending-list"></div>
    <h3>অনুমোদিত ডিভাইস</h3>
    <div id="da-approved-list"></div>
    <p id="da-status" role="status" aria-live="polite" class="finance-hint"></p>
  `;

  const status = slot.querySelector('#da-status');
  const pendingList = slot.querySelector('#da-pending-list');
  const approvedList = slot.querySelector('#da-approved-list');
  const envelopeBox = slot.querySelector('#da-envelope-box');
  const envelopeText = slot.querySelector('#da-envelope');
  const deviceIdInput = slot.querySelector('#da-device-id');
  const fingerprintInput = slot.querySelector('#da-fingerprint');

  function renderLists() {
    const pending = readPending();
    const approved = readApproved();

    pendingList.innerHTML = pending.length
      ? pending.map(d => `
        <div class="security-row">
          <div>
            <dt>${escapeHtml(d.deviceId)}</dt>
            <dd>এনক্রিপশন: ${escapeHtml(d.boxFingerprint?.slice(0, 24) ?? '—')}… · সাইনিং: ${escapeHtml(d.signingFingerprint?.slice(0, 24) ?? '—')}…</dd>
          </div>
        </div>`).join('')
      : '<p class="admin-empty">কোনো ডিভাইস অপেক্ষায় নেই।</p>';

    approvedList.innerHTML = approved.length
      ? approved.map(d => `
        <div class="security-row">
          <div>
            <dt>${escapeHtml(d.deviceId)}</dt>
            <dd>অনুমোদিত — কী হস্তান্তর করা যেতে পারে</dd>
          </div>
        </div>`).join('')
      : '<p class="admin-empty">কোনো ডিভাইস অনুমোদিত নেই।</p>';
  }

  renderLists();

  slot.querySelector('#da-approve')?.addEventListener('click', async () => {
    const deviceId = deviceIdInput?.value?.trim();
    const fingerprint = fingerprintInput?.value?.trim();
    if (!deviceId || !fingerprint) {
      status.textContent = 'ডিভাইস আইডি ও ফিঙ্গারপ্রিন্ট উভয়ই দিন।';
      return;
    }

    const pending = readPending();
    const device = pending.find(d => d.deviceId === deviceId);
    if (!device) {
      status.textContent = 'এই ডিভাইস আইডি অপেক্ষায় নেই। ডিভাইসের পক্ষ থেকে প্রথমে ফিঙ্গারপ্রিন্ট দেখান।';
      return;
    }

    // Verify fingerprint matches what the device reported (admin heard it over phone)
    if (device.boxFingerprint !== fingerprint && device.signingFingerprint !== fingerprint) {
      status.textContent = 'ফিঙ্গারপ্রিন্ট মেলেনি। ফোনে পুনরায় যাচাই করুন।';
      return;
    }

    try {
      // Generate a random scope key for this device
      const scopeKey = createScopeKey();

      // Wrap it for the device using the device's box public key
      const envelope = await wrapScopeKey({
        scopeKey,
        recipientUid: device.deviceId,
        deviceId: device.deviceId,
        scopeId: SCOPE_ID,
        epoch: 1,
        recipientPublicJwk: device.boxPublicJwk,
        verifiedRecipientFingerprint: device.boxFingerprint,
        issuerPrivateKey: adminMaterial.signingPrivateKey,
        issuerPublicJwk: adminMaterial.signingPublicJwk
      });

      // Show envelope to admin
      const envelopeJson = JSON.stringify(envelope, null, 2);
      envelopeText.value = envelopeJson;
      envelopeBox.hidden = false;

      // Move from pending to approved
      const updatedPending = pending.filter(d => d.deviceId !== deviceId);
      writePending(updatedPending);
      const newApproved = [...readApproved(), { deviceId: device.deviceId, fingerprints: { box: device.boxFingerprint, signing: device.signingFingerprint } }];
      writeApproved(newApproved);

      deviceIdInput.value = '';
      fingerprintInput.value = '';
      status.textContent = 'ডিভাইস অনুমোদিত। কোডটি ডিভাইসের কাছে পাঠান।';
      renderLists();
    } catch (error) {
      status.textContent = 'অনুমোদন করতে সমস্যা হয়েছে।';
      console.warn('[Active Plus] approve failed:', error?.message);
    }
  });

  slot.querySelector('#da-reject')?.addEventListener('click', () => {
    const deviceId = deviceIdInput?.value?.trim();
    if (!deviceId) {
      status.textContent = 'ডিভাইস আইডি দিন।';
      return;
    }
    const pending = readPending().filter(d => d.deviceId !== deviceId);
    writePending(pending);
    deviceIdInput.value = '';
    fingerprintInput.value = '';
    status.textContent = 'ডিভাইস সরানো হলো।';
    renderLists();
  });

  slot.querySelector('#da-copy-envelope')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(envelopeText.value);
      status.textContent = 'কোড কপি করা হলো।';
    } catch {
      status.textContent = 'কপি করা যায়নি।';
    }
  });
}

/** Called by a device when it first registers its fingerprint. Stores public
 *  metadata so the admin can see it in the approval panel. */
export async function registerPendingDevice(material) {
  if (!material || !material.deviceId || !material.boxPublicJwk) throw new Error('INVALID_DEVICE_MATERIAL');
  await validateDeviceKeyMaterial(material);
  const pending = readPending();
  if (!pending.find(d => d.deviceId === material.deviceId)) {
    pending.push({
      deviceId: material.deviceId,
      boxPublicJwk: material.boxPublicJwk,
      signingPublicJwk: material.signingPublicJwk,
      boxFingerprint: material.boxFingerprint,
      signingFingerprint: material.signingFingerprint,
      registeredAt: new Date().toISOString()
    });
    writePending(pending);
  }
}
