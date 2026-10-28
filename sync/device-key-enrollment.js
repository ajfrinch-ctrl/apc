/* STAGED cryptographic building blocks for per-device enrollment.
 *
 * This module is NOT connected to the live login, sync or authorization rules.
 * A trusted Admin must compare the recipient's public-key fingerprint out of
 * band before wrapping a random, scope-specific 256-bit key. The recipient
 * must already trust the Admin signing key/fingerprint independently of the
 * server that stores the envelope. Cryptography here cannot grant access,
 * approve devices, provision identities, revoke old keys, or authorize a row.
 */
const VERSION = 1;
const ALGORITHM = 'ECDH-P256-HKDF-SHA256-AES256GCM-ES256';
const encoder = new TextEncoder();
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

function cryptoApi() {
  const api = globalThis.crypto;
  if (!api?.subtle || typeof api.getRandomValues !== 'function') throw new Error('SECURE_CRYPTO_REQUIRED');
  return api;
}
function randomBytes(length) { return cryptoApi().getRandomValues(new Uint8Array(length)); }
function encode(bytes) {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return globalThis.btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value, length) {
  if (typeof value !== 'string' || !B64URL.test(value)) throw new Error('INVALID_KEY_ENVELOPE');
  let bytes;
  try {
    const raw = globalThis.atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  } catch { throw new Error('INVALID_KEY_ENVELOPE'); }
  if (bytes.length !== length || encode(bytes) !== value) throw new Error('INVALID_KEY_ENVELOPE');
  return bytes;
}
function publicJwk(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('INVALID_DEVICE_PUBLIC_KEY');
  // Decode + re-encode to reject malformed/non-canonical coordinates. The
  // WebCrypto import below also validates that they lie on the P-256 curve.
  decode(jwk.x, 32); decode(jwk.y, 32);
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}
async function importPublic(jwk, algorithm, usages) {
  return cryptoApi().subtle.importKey('jwk', publicJwk(jwk), { name: algorithm, namedCurve: 'P-256' }, true, usages);
}
function validateMetadata({ recipientUid, deviceId, scopeId, epoch }) {
  if (typeof recipientUid !== 'string' || !SAFE_ID.test(recipientUid) ||
      typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId) ||
      typeof scopeId !== 'string' || !SAFE_ID.test(scopeId) ||
      !Number.isSafeInteger(epoch) || epoch < 1) throw new Error('INVALID_KEY_METADATA');
  decode(deviceId, 16); // canonical 128-bit device identifier
}
function assertPrivate(key, algorithm, usage) {
  if (!key || key.type !== 'private' || key.extractable || key.algorithm?.name !== algorithm ||
      key.algorithm?.namedCurve !== 'P-256' || !key.usages?.includes(usage)) throw new Error('INVALID_PRIVATE_KEY');
}
function headerArray(envelope) {
  const ephemeral = publicJwk(envelope.ephemeralPublicJwk);
  return [
    envelope.version, envelope.algorithm, envelope.recipientUid, envelope.deviceId, envelope.scopeId,
    envelope.epoch, envelope.recipientFingerprint, envelope.issuerFingerprint,
    ephemeral.kty, ephemeral.crv, ephemeral.x, ephemeral.y, envelope.salt, envelope.iv
  ];
}
function headerBytes(envelope) { return encoder.encode(JSON.stringify(headerArray(envelope))); }
function signedBytes(envelope) { return encoder.encode(JSON.stringify([...headerArray(envelope), envelope.ciphertext])); }

/** Full SHA-256 fingerprint; compare via a separate trusted channel. */
export async function devicePublicKeyFingerprint(jwk) {
  const pub = publicJwk(jwk);
  // P-256 point validation must precede trusting a fingerprint from a server.
  await importPublic(pub, 'ECDH', []);
  return encode(new Uint8Array(await cryptoApi().subtle.digest('SHA-256', encoder.encode(JSON.stringify(pub)))));
}

/** Private keys are non-extractable CryptoKeys, not strings or localStorage. */
export async function createDeviceKeyMaterial() {
  const api = cryptoApi();
  const [box, signing] = await Promise.all([
    api.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
    api.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  ]);
  const boxPublicJwk = publicJwk(await api.subtle.exportKey('jwk', box.publicKey));
  const signingPublicJwk = publicJwk(await api.subtle.exportKey('jwk', signing.publicKey));
  return {
    deviceId: encode(randomBytes(16)),
    boxPrivateKey: box.privateKey,
    boxPublicJwk,
    boxFingerprint: await devicePublicKeyFingerprint(boxPublicJwk),
    signingPrivateKey: signing.privateKey,
    signingPublicJwk,
    signingFingerprint: await devicePublicKeyFingerprint(signingPublicJwk)
  };
}

/** Check that stored non-extractable private keys still match both public keys. */
export async function validateDeviceKeyMaterial(material) {
  if (!material || typeof material.deviceId !== 'string' || !DEVICE_ID.test(material.deviceId)) throw new Error('INVALID_DEVICE_KEY_MATERIAL');
  decode(material.deviceId, 16);
  assertPrivate(material.boxPrivateKey, 'ECDH', 'deriveBits');
  assertPrivate(material.signingPrivateKey, 'ECDSA', 'sign');
  const box = await importPublic(material.boxPublicJwk, 'ECDH', []);
  const signer = await importPublic(material.signingPublicJwk, 'ECDSA', ['verify']);
  if (await devicePublicKeyFingerprint(material.boxPublicJwk) !== material.boxFingerprint ||
      await devicePublicKeyFingerprint(material.signingPublicJwk) !== material.signingFingerprint) {
    throw new Error('INVALID_DEVICE_KEY_MATERIAL');
  }
  const api = cryptoApi();
  const challenge = randomBytes(32);
  const signature = await api.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, material.signingPrivateKey, challenge);
  if (!await api.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, signer, signature, challenge)) {
    throw new Error('INVALID_DEVICE_KEY_MATERIAL');
  }
  const ephemeral = await api.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const a = new Uint8Array(await api.subtle.deriveBits({ name: 'ECDH', public: ephemeral.publicKey }, material.boxPrivateKey, 256));
  const b = new Uint8Array(await api.subtle.deriveBits({ name: 'ECDH', public: box }, ephemeral.privateKey, 256));
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) difference |= a[i] ^ b[i];
  a.fill(0); b.fill(0);
  if (difference) throw new Error('INVALID_DEVICE_KEY_MATERIAL');
  return true;
}

/** Create a fresh random scope key locally; never derive it from source code. */
export function createScopeKey() { return randomBytes(32); }

async function envelopeKey(privateKey, publicKey, salt, info, usage) {
  const api = cryptoApi();
  const bits = await api.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  try {
    const shared = await api.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return await api.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info }, shared,
      { name: 'AES-GCM', length: 256 }, false, [usage]
    );
  } finally {
    new Uint8Array(bits).fill(0); // best effort; JavaScript cannot guarantee erasure of all copies
  }
}

/**
 * Issuer wraps a scope key only for a separately verified device fingerprint.
 * Authorization and actual Admin approval remain the caller/server's job.
 */
export async function wrapScopeKey({ scopeKey, recipientUid, deviceId, scopeId, epoch,
  recipientPublicJwk, verifiedRecipientFingerprint, issuerPrivateKey, issuerPublicJwk }) {
  validateMetadata({ recipientUid, deviceId, scopeId, epoch });
  if (!(scopeKey instanceof Uint8Array) || scopeKey.length !== 32) throw new Error('INVALID_SCOPE_KEY');
  assertPrivate(issuerPrivateKey, 'ECDSA', 'sign');
  const recipientFingerprint = await devicePublicKeyFingerprint(recipientPublicJwk);
  if (recipientFingerprint !== verifiedRecipientFingerprint) throw new Error('RECIPIENT_FINGERPRINT_MISMATCH');
  const issuerFingerprint = await devicePublicKeyFingerprint(issuerPublicJwk);
  const recipientKey = await importPublic(recipientPublicJwk, 'ECDH', []);
  const issuerKey = await importPublic(issuerPublicJwk, 'ECDSA', ['verify']);
  const api = cryptoApi();
  const ephemeral = await api.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const envelope = {
    version: VERSION, algorithm: ALGORITHM, recipientUid, deviceId, scopeId, epoch,
    recipientFingerprint, issuerFingerprint,
    ephemeralPublicJwk: publicJwk(await api.subtle.exportKey('jwk', ephemeral.publicKey)),
    salt: encode(randomBytes(32)), iv: encode(randomBytes(12))
  };
  const aad = headerBytes(envelope);
  const key = await envelopeKey(ephemeral.privateKey, recipientKey, decode(envelope.salt, 32), aad, 'encrypt');
  envelope.ciphertext = encode(new Uint8Array(await api.subtle.encrypt(
    { name: 'AES-GCM', iv: decode(envelope.iv, 12), additionalData: aad }, key, scopeKey
  )));
  const signature = await api.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, issuerPrivateKey, signedBytes(envelope));
  // Reject an accidental mismatched issuer pair before publishing anything.
  if (!await api.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, issuerKey, signature, signedBytes(envelope))) {
    throw new Error('ISSUER_KEY_MISMATCH');
  }
  envelope.signature = encode(new Uint8Array(signature));
  return envelope;
}

/** Recipient verifies the issuer and expected device/scope/epoch before use. */
export async function unwrapScopeKey(envelope, { recipientUid, deviceId, scopeId, epoch,
  devicePrivateKey, devicePublicJwk, trustedIssuerPublicJwk, trustedIssuerFingerprint }) {
  validateMetadata({ recipientUid, deviceId, scopeId, epoch });
  assertPrivate(devicePrivateKey, 'ECDH', 'deriveBits');
  if (!envelope || envelope.version !== VERSION || envelope.algorithm !== ALGORITHM ||
      envelope.recipientUid !== recipientUid || envelope.deviceId !== deviceId ||
      envelope.scopeId !== scopeId || envelope.epoch !== epoch) throw new Error('KEY_METADATA_MISMATCH');
  const ownFingerprint = await devicePublicKeyFingerprint(devicePublicJwk);
  const issuerFingerprint = await devicePublicKeyFingerprint(trustedIssuerPublicJwk);
  if (envelope.recipientFingerprint !== ownFingerprint || issuerFingerprint !== trustedIssuerFingerprint ||
      envelope.issuerFingerprint !== trustedIssuerFingerprint) throw new Error('KEY_FINGERPRINT_MISMATCH');
  const salt = decode(envelope.salt, 32), iv = decode(envelope.iv, 12);
  const ciphertext = decode(envelope.ciphertext, 48); // 32-byte key + 16-byte GCM tag
  const signature = decode(envelope.signature, 64);
  const issuerKey = await importPublic(trustedIssuerPublicJwk, 'ECDSA', ['verify']);
  const api = cryptoApi();
  if (!await api.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, issuerKey, signature, signedBytes(envelope))) {
    throw new Error('INVALID_ISSUER_SIGNATURE');
  }
  const ephemeralKey = await importPublic(envelope.ephemeralPublicJwk, 'ECDH', []);
  const aad = headerBytes(envelope);
  const key = await envelopeKey(devicePrivateKey, ephemeralKey, salt, aad, 'decrypt');
  const plain = new Uint8Array(await api.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext));
  if (plain.length !== 32) throw new Error('INVALID_SCOPE_KEY');
  return plain;
}
