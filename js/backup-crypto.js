/* Backup encryption: new exports use a user-chosen passphrase and AES-256-GCM.
   The passphrase is never stored or sent to a server. Version 1 (plaintext) and
   version 2 (the retired public institutional key) remain readable only, so
   existing backups can be restored; they must not be represented as secret. */

export const BACKUP_VERSION = 3;
export const BACKUP_PBKDF2_ITERATIONS = 600000;
export const BACKUP_PASSPHRASE_MIN_LENGTH = 12;
const LEGACY_BACKUP_KEY = 'active-plus-backup-aes-256-gcm-v2-institutional-seal';
const LEGACY_ITERATIONS = 100000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function validBackupPassphrase(value) {
  return typeof value === 'string' && value.trim().length >= BACKUP_PASSPHRASE_MIN_LENGTH && value.length <= 256;
}

function cryptoApi() {
  const api = globalThis.crypto;
  if (!api?.subtle || typeof api.getRandomValues !== 'function') throw new Error('BACKUP_CRYPTO_UNAVAILABLE');
  return api;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function base64ToBytes(text) {
  if (typeof text !== 'string' || !text || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('INVALID_ENCRYPTED_BACKUP');
  }
  const binary = globalThis.atob(text);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function deriveKey(secret, salt, iterations, usages) {
  const subtle = cryptoApi().subtle;
  const base = await subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

// Authenticated header: changing a timestamp or merge provenance must not
// silently alter downstream restore/merge decisions while leaving GCM valid.
export function backupHeaderAdditionalData(payload) {
  if (payload?.kind !== 'active-plus-backup' || payload.version !== BACKUP_VERSION || payload.encrypted !== true ||
      payload.algorithm !== 'AES-256-GCM' || payload.kdf !== 'PBKDF2-SHA256' ||
      payload.iterations !== BACKUP_PBKDF2_ITERATIONS || typeof payload.createdAt !== 'string' || payload.createdAt.length > 128 ||
      (payload.mergedFrom !== undefined && (!Array.isArray(payload.mergedFrom) || payload.mergedFrom.length > 4 ||
        payload.mergedFrom.some(value => typeof value !== 'string' || value.length > 128)))) {
    throw new Error('INVALID_BACKUP_FORMAT');
  }
  return encoder.encode(JSON.stringify([
    payload.kind, payload.version, payload.encrypted, payload.algorithm, payload.kdf,
    payload.iterations, payload.createdAt, payload.mergedFrom ?? null
  ]));
}

/** New exports always require an actual passphrase; there is no public-key fallback. */
export async function encryptBackupData(data, { passphrase, createdAt = new Date().toISOString(), mergedFrom } = {}) {
  if (!validBackupPassphrase(passphrase)) throw new Error('BACKUP_PASSPHRASE_REQUIRED');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_BACKUP_DATA');
  const api = cryptoApi();
  const salt = api.getRandomValues(new Uint8Array(16));
  const iv = api.getRandomValues(new Uint8Array(12));
  const header = {
    kind: 'active-plus-backup',
    version: BACKUP_VERSION,
    encrypted: true,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: BACKUP_PBKDF2_ITERATIONS,
    createdAt,
    ...(Array.isArray(mergedFrom) ? { mergedFrom: mergedFrom.filter(item => typeof item === 'string').slice(0, 4) } : {})
  };
  const additionalData = backupHeaderAdditionalData(header);
  const key = await deriveKey(passphrase, salt, BACKUP_PBKDF2_ITERATIONS, ['encrypt']);
  const ciphertext = await api.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, encoder.encode(JSON.stringify(data)));
  return {
    ...header,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

/** Decrypt a v3 or legacy v2 file, or return a legacy v1 payload's data. */
export async function decryptBackupData(payload, { passphrase = '' } = {}) {
  if (!payload || payload.kind !== 'active-plus-backup') throw new Error('INVALID_BACKUP_KIND');
  if (payload.version === 1 || (payload.version === undefined && payload.encrypted !== true)) {
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) throw new Error('INVALID_BACKUP_DATA');
    return payload.data;
  }
  if (payload.encrypted !== true || ![2, BACKUP_VERSION].includes(payload.version)) throw new Error('INVALID_BACKUP_VERSION');
  if (payload.version === BACKUP_VERSION && !validBackupPassphrase(passphrase)) throw new Error('BACKUP_PASSPHRASE_REQUIRED');
  const additionalData = payload.version === BACKUP_VERSION ? backupHeaderAdditionalData(payload) : undefined;
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  if (salt.length < 8 || (payload.version === BACKUP_VERSION && salt.length !== 16) || iv.length !== 12 || ciphertext.length <= 16) {
    throw new Error('INVALID_ENCRYPTED_BACKUP');
  }
  const secret = payload.version === 2 ? LEGACY_BACKUP_KEY : passphrase;
  const iterations = payload.version === 2 ? LEGACY_ITERATIONS : BACKUP_PBKDF2_ITERATIONS;
  const key = await deriveKey(secret, salt, iterations, ['decrypt']);
  const plain = await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv, ...(additionalData ? { additionalData } : {}) }, key, ciphertext);
  const data = JSON.parse(decoder.decode(plain));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_DECRYPTED_DATA');
  return data;
}
