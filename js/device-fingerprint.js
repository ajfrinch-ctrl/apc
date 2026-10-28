/* Device fingerprint display + wrapped-key envelope entry.
 *
 * STAGED — not connected to live sync or authorization yet. Private keys are
 * non-extractable CryptoKeys kept in memory for this session only; public
 * metadata is kept in localStorage so the fingerprint survives a reload for
 * display purposes. On reload the device must re-enroll (new keys) until a
 * proper key-recovery path is added.
 *
 * Imports:
 *   sync/device-key-enrollment.js — ECDH/P-256 key wrap, fingerprints, validation
 *   sync/device-key-store.js      — IndexedDB key store (staged, optional)
 */
import {
  createDeviceKeyMaterial, createScopeKey, devicePublicKeyFingerprint,
  unwrapScopeKey, validateDeviceKeyMaterial
} from '../sync/device-key-enrollment.js';
import { saveDeviceKeyMaterial, loadDeviceKeyMaterial } from '../sync/device-key-store.js';
import { registerPendingDevice } from './admin-device-approvals.js';

const LOCAL_KEY = 'apc-device-fingerprint-v1';
const DEVICE_ID_KEY = 'apc-device-id-v1';
const SCOPE_ID = 'activeplus-sync-v1';

let currentMaterial = null; // in-memory only: non-extractable CryptoKeys

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

/** Load or create the device's key material, then render the fingerprint page. */
export async function renderDeviceFingerprint(slot) {
  slot.innerHTML = `
    <div class="security-list">
      <div class="security-row">
        <div>
          <dt>ডিভাইস আইডি</dt>
          <dd id="df-device-id">লোড হচ্ছে…</dd>
        </div>
        <button class="mini-btn" type="button" id="df-copy-device-id">কপি করুন</button>
      </div>
      <div class="security-row">
        <div>
          <dt>এনক্রিপশন কী ফিঙ্গারপ্রিন্ট</dt>
          <dd id="df-box-fingerprint" class="fingerprint">লোড হচ্ছে…</dd>
        </div>
        <button class="mini-btn" type="button" id="df-copy-box">কপি করুন</button>
      </div>
      <div class="security-row">
        <div>
          <dt>সাইনিং কী ফিঙ্গারপ্রিন্ট</dt>
          <dd id="df-signing-fingerprint" class="fingerprint">লোড হচ্ছে…</dd>
        </div>
        <button class="mini-btn" type="button" id="df-copy-signing">কপি করুন</button>
      </div>
    </div>
    <p class="finance-hint">ফোনে অ্যাডমিনকে ডিভাইস আইডি ও ফিঙ্গারপ্রিন্ট দুটি পড়ুন। অ্যাডমিন যাচাই করার পর আপনি একটি অনুমোদন কোড পাবেন, নিচে সেই কোড দিন।</p>
    <div class="staff-field">
      <label for="df-envelope">অ্যাডমিন থেকে পাওয়া অনুমোদন কোড এখানে লিখুন বা পেস্ট করুন</label>
      <textarea id="df-envelope" rows="4" placeholder="অনুমোদন কোড এখানে লিখুন"></textarea>
    </div>
    <button class="admin-btn primary" type="button" id="df-unwrap">কী অনুমোদন করুন ও সংরক্ষণ করুন</button>
    <p id="df-status" role="status" aria-live="polite" class="finance-hint"></p>
  `;

  const status = slot.querySelector('#df-status');
  const show = (id, value) => { const e = slot.querySelector(id); if (e) e.textContent = value; };

  const copyFrom = (id, source, successMsg) => {
    const btn = slot.querySelector(id);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(source);
        status.textContent = successMsg;
      } catch {
        status.textContent = 'কপি করা যায়নি।';
      }
    });
  };

  try {
    const stored = localStorage.getItem(LOCAL_KEY);
    if (stored) {
      const meta = JSON.parse(stored);
      currentMaterial = {
        deviceId: meta.deviceId,
        boxPublicJwk: meta.boxPublicJwk,
        signingPublicJwk: meta.signingPublicJwk,
        boxFingerprint: meta.boxFingerprint,
        signingFingerprint: meta.signingFingerprint
        // private keys are missing — envelope unwrapping won't work until re-enrollment
      };
    } else {
      currentMaterial = await createDeviceKeyMaterial();
      localStorage.setItem(LOCAL_KEY, JSON.stringify({
        deviceId: currentMaterial.deviceId,
        boxPublicJwk: currentMaterial.boxPublicJwk,
        signingPublicJwk: currentMaterial.signingPublicJwk,
        boxFingerprint: currentMaterial.boxFingerprint,
        signingFingerprint: currentMaterial.signingFingerprint
      }));
      localStorage.setItem(DEVICE_ID_KEY, currentMaterial.deviceId);
      // Register as pending so the admin can see this device for approval.
      try { await registerPendingDevice(currentMaterial); } catch { /* admin panel may not be loaded */ }
    }

    show('#df-device-id', currentMaterial.deviceId);
    show('#df-box-fingerprint', currentMaterial.boxFingerprint);
    show('#df-signing-fingerprint', currentMaterial.signingFingerprint);

    const hasPrivate = Boolean(currentMaterial.boxPrivateKey && currentMaterial.signingPrivateKey);

    copyFrom('#df-copy-device-id', currentMaterial.deviceId, 'ডিভাইস আইডি কপি করা হলো');
    copyFrom('#df-copy-box', currentMaterial.boxFingerprint, 'এনক্রিপশন ফিঙ্গারপ্রিন্ট কপি করা হলো');
    copyFrom('#df-copy-signing', currentMaterial.signingFingerprint, 'সাইনিং ফিঙ্গারপ্রিন্ট কপি করা হলো');

    const unwrapBtn = slot.querySelector('#df-unwrap');
    const envelopeInput = slot.querySelector('#df-envelope');

    if (!hasPrivate) {
      unwrapBtn.disabled = true;
      unwrapBtn.textContent = 'নতুন সেশনে কী তৈরি করতে পৃষ্ঠা রিলোড করুন';
      status.textContent = 'নিরাপদ নন-এক্সট্র্যাক্টেবল কী শুধু এই সেশনেই থাকে। পৃষ্ঠা রিলোড করলে নতুন ডিভাইস আইডি তৈরি হবে।';
    }

    unwrapBtn?.addEventListener('click', async () => {
      const raw = envelopeInput?.value?.trim();
      if (!raw) { status.textContent = 'অনুমোদন কোড দিন।'; return; }
      let envelope;
      try { envelope = JSON.parse(raw); } catch { status.textContent = 'কোডটি সঠিক JSON নয়।'; return; }

      try {
        const scopeKey = await unwrapScopeKey(envelope, {
          recipientUid: currentMaterial.deviceId,
          deviceId: currentMaterial.deviceId,
          scopeId: SCOPE_ID,
          epoch: 1,
          devicePrivateKey: currentMaterial.boxPrivateKey,
          devicePublicJwk: currentMaterial.boxPublicJwk,
          trustedIssuerPublicJwk: currentMaterial.signingPublicJwk,
          trustedIssuerFingerprint: currentMaterial.signingFingerprint
        });
        await saveDeviceKeyMaterial(currentMaterial.deviceId, currentMaterial);
        localStorage.setItem('apc-device-approved-v1', '1');
        status.textContent = 'ডিভাইস অনুমোদিত ও কী সংরক্ষণ করা হলো।';
        envelopeInput.value = '';
      } catch (error) {
        status.textContent = 'অনুমোদন কোড সঠিক নেই বা ডিভাইস মিলেনি।';
        console.warn('[Active Plus] unwrap failed:', error?.message);
      }
    });
  } catch (error) {
    status.textContent = 'ফিঙ্গারপ্রিন্ট লোড করা যায়নি।';
    console.warn('[Active Plus] device fingerprint failed:', error?.message);
  }
}
