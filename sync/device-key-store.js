/* STAGED, local-only IndexedDB storage for non-extractable device CryptoKeys.
 * No localStorage/plaintext fallback: if structured-clone or storage is blocked,
 * enrollment fails rather than exporting private key material. Not yet wired to
 * any live identity, UI, or sync path. Clearing browser data loses these keys;
 * the operator must re-enroll that device through the future approval flow. */
import { validateDeviceKeyMaterial } from './device-key-enrollment.js';

const DB_NAME = 'apc-device-key-store-v1';
const STORE_NAME = 'deviceKeys';
const USER_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;

function checkIds(userId, deviceId) {
  if (typeof userId !== 'string' || !USER_ID.test(userId) || typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) {
    throw new Error('INVALID_DEVICE_IDENTITY');
  }
}
function openDatabase(factory) {
  if (!factory || typeof factory.open !== 'function') return Promise.reject(new Error('DEVICE_KEY_STORAGE_UNAVAILABLE'));
  return new Promise((resolve, reject) => {
    let rejected = false;
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: ['userId', 'deviceId'] });
    };
    request.onsuccess = () => { if (rejected) request.result.close(); else resolve(request.result); };
    request.onerror = () => { rejected = true; reject(new Error('DEVICE_KEY_STORAGE_UNAVAILABLE')); };
    request.onblocked = () => { rejected = true; reject(new Error('DEVICE_KEY_STORAGE_BLOCKED')); };
  });
}
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error('DEVICE_KEY_STORAGE_WRITE_FAILED'));
    tx.onerror = () => {}; // abort handler gives one sanitized error
  });
}
function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('DEVICE_KEY_STORAGE_READ_FAILED'));
  });
}

/** Save once: never silently replace an enrolled device's existing keys. */
export async function saveDeviceKeyMaterial(userId, material, { indexedDB = globalThis.indexedDB } = {}) {
  checkIds(userId, material?.deviceId);
  await validateDeviceKeyMaterial(material);
  const db = await openDatabase(indexedDB);
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(tx);
    try {
      tx.objectStore(STORE_NAME).add({ userId, deviceId: material.deviceId, material });
    } catch {
      try { tx.abort(); } catch { /* transaction may already have stopped */ }
      await done.catch(() => {});
      throw new Error('DEVICE_KEY_STORAGE_WRITE_FAILED');
    }
    await done;
  } finally { db.close(); }
}

/** A missing record is not a new approval; the caller must re-enroll. */
export async function loadDeviceKeyMaterial(userId, deviceId, { indexedDB = globalThis.indexedDB } = {}) {
  checkIds(userId, deviceId);
  const db = await openDatabase(indexedDB);
  let record;
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const done = transactionDone(tx);
    [record] = await Promise.all([requestValue(tx.objectStore(STORE_NAME).get([userId, deviceId])), done]);
  } finally { db.close(); }
  if (!record) return null;
  if (record.userId !== userId || record.deviceId !== deviceId || record.material?.deviceId !== deviceId) {
    throw new Error('INVALID_DEVICE_KEY_MATERIAL');
  }
  await validateDeviceKeyMaterial(record.material);
  return record.material;
}
