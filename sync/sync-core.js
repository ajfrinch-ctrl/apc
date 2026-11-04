import { assertCloudAccess } from './cloud-access.js';
// Protected Sync Core facade.
// UI imports this boundary; the Firebase implementation is loaded lazily.
//
// IMPORTANT: hydration is single-flight at this boundary. Login, first-use
// setup, reconnect and background sync must not run the same credential
// hydration concurrently or race to rewrite local state.
const implementation = async () => {
  assertCloudAccess();
  return import('../js/realtime-sync.js');
};

const staffHydrationFlights = new Map();
const identityHydrationFlights = new Map();
let adminStateFlight = null;
let adminClaimFlight = null;

function identityFlightKey(options = {}) {
  return JSON.stringify([
    String(options?.identifier || ''),
    String(options?.password || '')
  ]);
}

function hydrateStaffAccountsOnce(options = {}) {
  // A role-specific login read must never be coalesced with a different role
  // or a full hydration, which could return before its requested role is read.
  const roles = Array.isArray(options.roles) ? [...new Set(options.roles)].sort() : null;
  const key = JSON.stringify([Boolean(options.preserveLocalAdmin), roles]);
  if (staffHydrationFlights.has(key)) return staffHydrationFlights.get(key);
  const flight = implementation()
    .then(m => m.hydrateStaffAccounts(options))
    .finally(() => { staffHydrationFlights.delete(key); });
  staffHydrationFlights.set(key, flight);
  return flight;
}

function hydrateUserIdentifiersOnce(options = {}) {
  const key = identityFlightKey(options);
  if (identityHydrationFlights.has(key)) return identityHydrationFlights.get(key);
  const flight = implementation()
    .then(m => m.hydrateUserIdentifiers(options))
    .finally(() => { identityHydrationFlights.delete(key); });
  identityHydrationFlights.set(key, flight);
  return flight;
}

/* The first-use gate is asked once per page load while the answer is in flight
   (the login page checks at startup, before showing its login screen, and again
   before it lets the creation form submit). */
function adminInitializationStateOnce() {
  if (adminStateFlight) return adminStateFlight;
  adminStateFlight = implementation()
    .then(m => m.adminInitializationState())
    .finally(() => { adminStateFlight = null; });
  return adminStateFlight;
}

/* Creating the institution's Admin Account is a single write: two clicks (or
   two tabs) must never race into two cloud claims. */
function claimFirstAdminAccountOnce(...args) {
  if (adminClaimFlight) return adminClaimFlight;
  adminClaimFlight = implementation()
    .then(m => m.claimFirstAdminAccount(...args))
    .finally(() => { adminClaimFlight = null; });
  return adminClaimFlight;
}

/* The factory reset is one destructive sweep: a double click must never start
   a second wipe while the first one is still running. */
let resetFlight = null;
function resetCloudDatabaseOnce(...args) {
  if (resetFlight) return resetFlight;
  resetFlight = implementation()
    .then(m => m.resetCloudDatabase(...args))
    .finally(() => { resetFlight = null; });
  return resetFlight;
}

export const SyncService = Object.freeze({
  start: (...args) => implementation().then(m => m.startRealtimeSync(...args)),
  syncNow: (...args) => implementation().then(m => m.startRealtimeSync(...args)),
  ensureCloudAuth: (...args) => implementation().then(m => m.ensureCloudAuth(...args)),
  hydrateStaffAccounts: (...args) => hydrateStaffAccountsOnce(...args),
  firstAdminExistsOnline: (...args) => implementation().then(m => m.firstAdminExistsOnline(...args)),
  adminInitializationState: (...args) => adminInitializationStateOnce(...args),
  claimFirstAdminAccount: (...args) => claimFirstAdminAccountOnce(...args),
  resetCloudDatabase: (...args) => resetCloudDatabaseOnce(...args),
  hydrateUserIdentifiers: (...args) => hydrateUserIdentifiersOnce(...args),
  usernameTakenOnline: (...args) => implementation().then(m => m.usernameTakenOnline(...args)),
  registerStudentAtomicallyOnline: (...args) => implementation().then(m => m.registerStudentAtomicallyOnline(...args)),
  syncRegistrationDecisionOnline: (...args) => implementation().then(m => m.syncRegistrationDecisionOnline(...args)),
  refreshStudentApprovalOnline: (...args) => implementation().then(m => m.refreshStudentApprovalOnline(...args)),
  pollRegistrationFeedOnline: (...args) => implementation().then(m => m.pollRegistrationFeedOnline(...args)),
  getServerTimeMs: (...args) => implementation().then(m => m.getServerTimeMs(...args)),
  getStatus: () => ({ ...document.documentElement.dataset })
});

export const startRealtimeSync = (...args) => implementation().then(m => m.startRealtimeSync(...args));
export const ensureCloudAuth = (...args) => implementation().then(m => m.ensureCloudAuth(...args));
export const hydrateStaffAccounts = (...args) => hydrateStaffAccountsOnce(...args);
export const firstAdminExistsOnline = (...args) => implementation().then(m => m.firstAdminExistsOnline(...args));
export const adminInitializationState = (...args) => adminInitializationStateOnce(...args);
export const claimFirstAdminAccount = (...args) => claimFirstAdminAccountOnce(...args);
export const resetCloudDatabase = (...args) => resetCloudDatabaseOnce(...args);
export const hydrateUserIdentifiers = (...args) => hydrateUserIdentifiersOnce(...args);
export const registerStudentAtomicallyOnline = (...args) => implementation().then(m => m.registerStudentAtomicallyOnline(...args));
export const syncRegistrationDecisionOnline = (...args) => implementation().then(m => m.syncRegistrationDecisionOnline(...args));
export const refreshStudentApprovalOnline = (...args) => implementation().then(m => m.refreshStudentApprovalOnline(...args));
export const pollRegistrationFeedOnline = (...args) => implementation().then(m => m.pollRegistrationFeedOnline(...args));
export const getServerTimeMs = (...args) => implementation().then(m => m.getServerTimeMs(...args));
