/* Test-only stand-in for the CLOUD boundary of the global Admin
   initialization (js/admin-initialization.js → sync/sync-core.js).

   The unit tests that only need "what does the cloud say about the Admin
   account?" and "did the atomic claim happen?" install this fake rather than
   booting Firebase: no network, no CDN, no project. The REAL sync engine,
   the transaction and the hydration path are exercised with a fake transport
   in tests/admin-new-device-login.test.mjs and in the two-device harness.

   Semantics mirrored from js/realtime-sync.js:
     • an Admin record that exists decides on its own — the marker is a marker;
     • the claim is create-only: once a record exists, a second claim fails;
     • the marker is set after the record, never instead of it. */
import { registerHooks } from 'node:module';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';

/** An in-memory "cloud" shared by every device in one test file. */
export function createAdminCloud({ record = null, initialized = false } = {}) {
  const cloud = {
    record: record ? { ...record } : null,
    flag: Boolean(record) || initialized,
    claims: 0
  };
  cloud.state = () => ({
    ok: true,
    recordExists: Boolean(cloud.record),
    flag: cloud.flag,
    initialized: cloud.flag || Boolean(cloud.record)
  });
  cloud.claim = value => {
    cloud.claims += 1;
    // Create-only, exactly like the server-side transaction.
    if (cloud.record) return { ok: false, reason: 'admin-exists' };
    cloud.record = { ...value };
    cloud.flag = true;
    return { ok: true };
  };
  /* Login on a fresh device pulls the account down, like hydrateStaffAccounts. */
  cloud.hydrate = () => {
    if (cloud.record) {
      globalThis.localStorage?.setItem(STAFF_ACCOUNTS.admin.accountKey, JSON.stringify(cloud.record));
    }
    return { ok: true };
  };
  return cloud;
}

/** Pure-Node tests have no browser navigator; declare the connection state the
    way a device reports it. (jsdom pages already have a real navigator.) */
export function setOnline(value = true) {
  const nav = globalThis.navigator;
  if (!nav) {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { onLine: value } });
    return;
  }
  Object.defineProperty(nav, 'onLine', { configurable: true, value });
}

const STUB_SOURCE = `
/* The active cloud is read on every call, so a test can hand a device a
   different database without a second module instance. */
const active = () => {
  const cloud = globalThis.__apcTestAdminCloud;
  if (!cloud) throw new Error('no test admin cloud is installed');
  return cloud;
};
export const adminInitializationState = () => active().state();
export const claimFirstAdminAccount = record => active().claim(record);
export const firstAdminExistsOnline = async () => {
  const state = await active().state();
  return state.ok ? { ok: true, exists: state.initialized } : state;
};
export const hydrateStaffAccounts = () => active().hydrate();
export const hydrateUserIdentifiers = () => ({ ok: true, found: false });
export const startRealtimeSync = async () => ({ ok: true });
export const ensureCloudAuth = async () => ({});
`;

/** Install the fake boundary. Returns the hook handle to deregister. */
export function installAdminCloud(cloud) {
  globalThis.__apcTestAdminCloud = cloud;
  return registerHooks({
    load(url, context, nextLoad) {
      if (url.includes('/sync/sync-core.js')) {
        return { format: 'module', shortCircuit: true, source: STUB_SOURCE };
      }
      return nextLoad(url, context);
    }
  });
}

/** Point every device (and every later call) at another cloud. */
export function setAdminCloud(cloud) {
  globalThis.__apcTestAdminCloud = cloud;
  return cloud;
}

export function removeAdminCloud(hooks) {
  hooks?.deregister?.();
  delete globalThis.__apcTestAdminCloud;
}
