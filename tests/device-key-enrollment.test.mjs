import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceKeyMaterial, createScopeKey, devicePublicKeyFingerprint, validateDeviceKeyMaterial,
  wrapScopeKey, unwrapScopeKey } from '../sync/device-key-enrollment.js';
import { saveDeviceKeyMaterial, loadDeviceKeyMaterial } from '../sync/device-key-store.js';

async function fixture() {
  const [admin, device, other] = await Promise.all([
    createDeviceKeyMaterial(), createDeviceKeyMaterial(), createDeviceKeyMaterial()
  ]);
  const scopeKey = createScopeKey();
  const issue = {
    scopeKey, recipientUid: 'student-123', deviceId: device.deviceId,
    scopeId: 'student-123', epoch: 4, recipientPublicJwk: device.boxPublicJwk,
    verifiedRecipientFingerprint: device.boxFingerprint,
    issuerPrivateKey: admin.signingPrivateKey, issuerPublicJwk: admin.signingPublicJwk
  };
  const receive = {
    recipientUid: issue.recipientUid, deviceId: issue.deviceId, scopeId: issue.scopeId, epoch: issue.epoch,
    devicePrivateKey: device.boxPrivateKey, devicePublicJwk: device.boxPublicJwk,
    trustedIssuerPublicJwk: admin.signingPublicJwk, trustedIssuerFingerprint: admin.signingFingerprint
  };
  return { admin, device, other, scopeKey, issue, receive };
}

function alter(value) { return (value[0] === 'A' ? 'B' : 'A') + value.slice(1); }

test('device keys are non-extractable and a verified Admin can wrap a random scoped AES key', async () => {
  const { admin, device, scopeKey, issue, receive } = await fixture();
  for (const key of [admin.signingPrivateKey, device.signingPrivateKey, device.boxPrivateKey]) {
    assert.equal(key.extractable, false);
    await assert.rejects(crypto.subtle.exportKey('jwk', key));
  }
  assert.equal(await devicePublicKeyFingerprint(device.boxPublicJwk), device.boxFingerprint);
  assert.equal(await validateDeviceKeyMaterial(device), true);
  await assert.rejects(validateDeviceKeyMaterial({ ...device, boxPrivateKey: admin.boxPrivateKey }), /INVALID_DEVICE_KEY_MATERIAL/);
  await assert.rejects(validateDeviceKeyMaterial({ ...device, signingPrivateKey: admin.signingPrivateKey }), /INVALID_DEVICE_KEY_MATERIAL/);
  await assert.rejects(saveDeviceKeyMaterial('student-123', device, { indexedDB: null }), /DEVICE_KEY_STORAGE_UNAVAILABLE/);
  await assert.rejects(loadDeviceKeyMaterial('student-123', device.deviceId, { indexedDB: null }), /DEVICE_KEY_STORAGE_UNAVAILABLE/);
  const one = await wrapScopeKey(issue);
  const two = await wrapScopeKey(issue);
  assert.notEqual(one.iv, two.iv);
  assert.notEqual(one.salt, two.salt);
  assert.notDeepEqual(one.ephemeralPublicJwk, two.ephemeralPublicJwk);
  assert.notEqual(one.ciphertext, two.ciphertext);
  assert.equal(JSON.stringify(one).includes(Buffer.from(scopeKey).toString('base64')), false);
  assert.deepEqual(await unwrapScopeKey(one, receive), scopeKey);
});

test('envelopes reject unverified devices, wrong identities, epochs, keys and tampering', async () => {
  const { admin, device, other, issue, receive } = await fixture();
  await assert.rejects(wrapScopeKey({ ...issue, verifiedRecipientFingerprint: other.boxFingerprint }), /RECIPIENT_FINGERPRINT_MISMATCH/);
  await assert.rejects(wrapScopeKey({ ...issue, issuerPrivateKey: other.signingPrivateKey }), /ISSUER_KEY_MISMATCH/);
  const envelope = await wrapScopeKey(issue);
  for (const override of [{ recipientUid: 'someone-else' }, { deviceId: other.deviceId },
    { scopeId: 'different-scope' }, { epoch: 5 }]) {
    await assert.rejects(unwrapScopeKey(envelope, { ...receive, ...override }), /KEY_METADATA_MISMATCH/);
  }
  await assert.rejects(unwrapScopeKey(envelope, { ...receive, devicePrivateKey: other.boxPrivateKey }));
  await assert.rejects(unwrapScopeKey(envelope, { ...receive, devicePublicJwk: other.boxPublicJwk }), /KEY_FINGERPRINT_MISMATCH/);
  await assert.rejects(unwrapScopeKey(envelope, { ...receive, trustedIssuerPublicJwk: other.signingPublicJwk }), /KEY_FINGERPRINT_MISMATCH/);
  await assert.rejects(unwrapScopeKey({ ...envelope, ciphertext: alter(envelope.ciphertext) }, receive), /INVALID_ISSUER_SIGNATURE/);
  await assert.rejects(unwrapScopeKey({ ...envelope, iv: alter(envelope.iv) }, receive), /INVALID_ISSUER_SIGNATURE/);
  await assert.rejects(unwrapScopeKey({ ...envelope, signature: alter(envelope.signature) }, receive), /INVALID_ISSUER_SIGNATURE/);
  assert.notEqual(admin.signingFingerprint, device.signingFingerprint);
});

test('an untrusted issuer cannot forge approval even when it knows the device public key', async () => {
  const { other, issue, receive } = await fixture();
  const forged = await wrapScopeKey({ ...issue, issuerPrivateKey: other.signingPrivateKey, issuerPublicJwk: other.signingPublicJwk });
  forged.issuerFingerprint = receive.trustedIssuerFingerprint;
  await assert.rejects(unwrapScopeKey(forged, receive), /INVALID_ISSUER_SIGNATURE/);
});

test('missing secure randomness fails closed', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const subtle = globalThis.crypto.subtle;
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle } });
    assert.throws(() => createScopeKey(), /SECURE_CRYPTO_REQUIRED/);
    await assert.rejects(createDeviceKeyMaterial(), /SECURE_CRYPTO_REQUIRED/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});
