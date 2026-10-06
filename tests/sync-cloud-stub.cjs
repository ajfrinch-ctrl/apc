/* Cloud-boundary stub for tests/sync-e2e.spec.cjs.

   The real app, the real sync engine (js/realtime-sync.js), the real durable
   outbox, localStorage and the UI all run untouched. Only the Firebase SDK —
   i.e. the network boundary — is replaced, so the check works with no network
   and can flip the link on and off on demand.

   Exports the stub as source text; the spec serves it in place of
   https://www.gstatic.com/firebasejs/12.2.1/firebase-*.js.
   One shared state object (`window.__cloud`) across every module instance:
   each SDK URL is its own ES module, and traffic must be counted in one place.
   Control it from the page with window.__cloudOnline() / window.__cloudOffline().
*/
module.exports.STUB_SOURCE = String.raw`
/* Stand-in Firebase SDK for the end-to-end sync check.
   ONLY the cloud boundary is faked: the app's own sync engine, outbox,
   localStorage and UI all run for real. It exposes window.__cloud so the check
   can inspect traffic and flip the link on and off. */
const state = window.__cloud ||= {
  data: {},
  listeners: new Map(),
  connected: false,
  failWrites: false,
  failReads: false,
  writes: [],
  reads: [],
  transactions: [],
  signedIn: false
};

const apps = window.__stubApps ||= [];
export function initializeApp(options, name = '[DEFAULT]') { const app = { name, options }; apps.push(app); return app; }
export function getApps() { return apps; }
export function getApp() { return apps[0]; }

export const browserLocalPersistence = 'local';
export function getAuth(app) { return (app.auth ||= { currentUser: null, authStateReady: async () => {} }); }
export async function signInAnonymously(auth) {
  if (state.failAuth) throw Object.assign(new Error('auth unreachable'), { code: 'auth/network-request-failed' });
  auth.currentUser = { uid: 'stub-anon', isAnonymous: true };
  state.signedIn = true;
  return { user: auth.currentUser };
}
export async function signInWithEmailAndPassword(auth, email) {
  auth.currentUser = { uid: 'stub-user', email };
  return { user: auth.currentUser };
}
export async function updatePassword() {}
export async function setPersistence() {}

export function getDatabase(app) { return (app.db ||= { root: 'stub' }); }
export function ref(db, path) { return { path: String(path || '/').replace(/^\/+/, '') }; }

const parts = path => String(path).split('/').filter(Boolean);
function readPath(path) {
  let node = state.data;
  for (const part of parts(path)) { if (node == null || typeof node !== 'object') return null; node = node[part]; }
  return node === undefined ? null : node;
}
function writePath(path, value) {
  const keys = parts(path);
  const last = keys.pop();
  let node = state.data;
  for (const key of keys) { if (typeof node[key] !== 'object' || node[key] === null) node[key] = {}; node = node[key]; }
  if (value === null) delete node[last]; else node[last] = JSON.parse(JSON.stringify(value));
  notify(path);
}
function snapshot(path) {
  const value = readPath(path);
  return { val: () => (value === undefined ? null : value), exists: () => value !== null && value !== undefined,
    key: parts(path).pop() || null };
}
function notify(path) {
  for (const [watched, entries] of state.listeners) {
    const related = watched === path || watched.startsWith(path + '/') || path.startsWith(watched + '/');
    if (!related) continue;
    for (const entry of entries) queueMicrotask(() => entry.callback(snapshot(watched)));
  }
}
/** Flip the socket; the engine's .info/connected listener sees it exactly like Firebase's. */
function setConnected(connected) {
  state.connected = connected;
  for (const entries of (state.listeners.get('.info/connected') || [])) entries.callback({ val: () => connected, exists: () => true });
}
window.__cloudOnline = () => { state.failReads = false; state.failWrites = false; setConnected(true); };
window.__cloudOffline = () => { state.failWrites = true; setConnected(false); };
window.__cloudDown = () => { state.failReads = true; state.failWrites = true; setConnected(false); };

export async function get(node) {
  state.reads.push(node.path);
  if (state.failReads) throw Object.assign(new Error('network'), { code: 'NETWORK_ERROR' });
  return snapshot(node.path);
}
export async function set(node, value) {
  state.writes.push({ path: node.path, value });
  if (state.failWrites) throw Object.assign(new Error('network'), { code: 'NETWORK_ERROR' });
  writePath(node.path, value);
  return undefined;
}
export async function runTransaction(node, update) {
  state.transactions.push(node.path);
  if (state.failWrites) throw Object.assign(new Error('network'), { code: 'NETWORK_ERROR' });
  const next = update(readPath(node.path));
  if (next !== undefined && next !== null) writePath(node.path, next);
  return { committed: next !== undefined, snapshot: snapshot(node.path) };
}
export function onValue(node, callback) {
  const entry = { callback };
  if (!state.listeners.has(node.path)) state.listeners.set(node.path, new Set());
  state.listeners.get(node.path).add(entry);
  if (node.path === '.info/connected') callback({ val: () => state.connected, exists: () => true });
  else queueMicrotask(() => callback(snapshot(node.path)));
  return () => state.listeners.get(node.path)?.delete(entry);
}

/* Firestore / Functions / Messaging are not part of this check. */
export function getFirestore(app) { return (app.firestore ||= {}); }
export function doc(db, ...path) { return { path: path.join('/') }; }
export async function getDoc() { return { exists: () => false, data: () => null }; }
export function getFunctions(app) { return (app.functions ||= {}); }
export function httpsCallable() { return async () => { throw new Error('functions are not part of this check'); }; }
export function getMessaging() { return {}; }
export function onMessage() {}
export async function getToken() { throw new Error('messaging is not part of this check'); }
export function isSupported() { return Promise.resolve(false); }

// The app signs in anonymously on boot; a connected socket follows.
queueMicrotask(() => setConnected(true));
`;
