/* Global Admin initialization — one Admin Account for the whole institution.

   The Admin Account is created ONCE, for the coaching centre, and lives in the
   cloud database; the copy in localStorage is only this device's working copy.
   Everything that decides "does an Admin Account exist?" therefore asks the
   cloud, and only a *verified* answer may open the first-use creation screen:

     APP START → this device has an Admin record?  → Login   (never Create)
               → the cloud says an Admin exists?   → Login   (never Create)
               → the cloud verified NO Admin       → first-use creation screen
               → the cloud cannot be verified      → Login + "internet required"

   `adminInitializationStatus()` is read-only and never writes anything.
   `claimFirstAdmin()` is the single atomic step that creates the institution's
   Admin account: Realtime Database runs the transaction on the server, so when
   two fresh devices submit at the same moment exactly one commits and the other
   is told to log in with the existing Admin account instead.

   Scope: only the cloud boundary is touched here. No local storage, session,
   roster, theme, role or sync behaviour is changed by this module. */

import { LEGACY_CLOUD_ENABLED } from '../sync/cloud-access.js';

/* The bridge is loaded lazily, exactly like the login page loads it: a device
   with no internet or a blocked CDN must still open the app normally. */
const SYNC_CORE_URL = '../sync/sync-core.js?v=20261006-admin-init';
const STATE_BUDGET_MS = 8000;
const CLAIM_BUDGET_MS = 12000;

/** The Admin Account already exists — creation is closed, login is the way in. */
export const ADMIN_EXISTS_MESSAGE =
  'প্রথম Admin Account ইতিমধ্যে তৈরি হয়েছে — PLEASE LOGIN WITH EXISTING ADMIN ACCOUNT.';

/** The cloud could not be asked, so "no Admin exists" may not be concluded. */
export const ADMIN_VERIFY_REQUIRED_MESSAGE =
  'Existing Admin Account আছে কি না যাচাই করতে ইন্টারনেট সংযোগ দরকার (Internet connection required) — ইন্টারনেট চালু করে আবার চেষ্টা করুন।';

/** Verification succeeded, but the atomic cloud claim could not be completed. */
export const ADMIN_CLAIM_FAILED_MESSAGE =
  'Admin Account ক্লাউডে সংরক্ষণ করা যায়নি — ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।';

function withDeadline(promise, what, budget) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out`)), budget);
    })
  ]).finally(() => clearTimeout(timer));
}

function offline() {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

/**
 * The institution's Admin initialization status, straight from the cloud.
 *
 * Resolves to
 *   { ok: true,  initialized, flag, recordExists }   — verified answer
 *   { ok: false, reason: 'offline' | 'cloud-paused' | 'admin-check-failed' }
 *
 * `initialized` is true when the global flag is set OR when an Admin record
 * already exists: a database written by an older release (the record without
 * the flag) is never mistaken for "no Admin".
 */
export async function adminInitializationStatus({ budget = STATE_BUDGET_MS } = {}) {
  if (!LEGACY_CLOUD_ENABLED) return { ok: false, reason: 'cloud-paused' };
  if (offline()) return { ok: false, reason: 'offline' };
  try {
    const bridge = await withDeadline(import(SYNC_CORE_URL), 'admin state import', budget);
    const status = await withDeadline(bridge.adminInitializationState(), 'admin state', budget);
    return status && typeof status === 'object' ? status : { ok: false, reason: 'admin-check-failed' };
  } catch (error) {
    console.warn('[Active Plus] Admin initialization check unavailable:', error?.message || error);
    return { ok: false, reason: 'admin-check-failed' };
  }
}

/**
 * Atomically claim the institution's one Admin Account for `account`.
 *
 * Resolves to
 *   { ok: true }                              — this device created the Admin
 *   { ok: false, reason: 'admin-exists' }     — another device got there first
 *   { ok: false, reason: 'offline' | … }      — nothing was written
 */
export async function claimFirstAdmin(account, { budget = CLAIM_BUDGET_MS } = {}) {
  if (!LEGACY_CLOUD_ENABLED) return { ok: false, reason: 'cloud-paused' };
  if (offline()) return { ok: false, reason: 'offline' };
  if (!account || typeof account !== 'object') return { ok: false, reason: 'invalid-account' };
  try {
    const bridge = await withDeadline(import(SYNC_CORE_URL), 'admin claim import', budget);
    const claim = await withDeadline(bridge.claimFirstAdminAccount(account), 'admin claim', budget);
    return claim && typeof claim === 'object' ? claim : { ok: false, reason: 'claim-failed' };
  } catch (error) {
    console.warn('[Active Plus] Admin account claim unavailable:', error?.message || error);
    return { ok: false, reason: 'claim-failed' };
  }
}
