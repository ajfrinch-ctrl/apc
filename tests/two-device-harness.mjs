/* Two-device integration harness: runs the REAL app code in two isolated
   Node/jsdom processes ("device A" and "device B", each with its own
   localStorage and module graph) against a shared in-memory mock of the
   Firebase Realtime Database. The only change to the app code is the import
   specifier of the three Firebase CDN modules, which is rewritten to local
   mock modules that speak a tiny RTDB-compatible protocol over loopback HTTP.

   Everything else — the storage-write bridge, the sync/push/merge rules, the
   listeners, the login flows — is exercised exactly as shipped. */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_DIR = path.join(TESTS_DIR, '.two-device-run');
const REPO_DIR = path.dirname(TESTS_DIR);

/* -------------------------------------------------------------------------
   Mock Realtime Database — the shared "cloud" both devices connect to.
   Supports exactly what js/realtime-sync.js uses: get, set, onValue and
   anonymous sign-in (a no-op). Semantics: set overwrites the path subtree
   and notifies every listener whose path is the written path, its ancestor
   or its descendant.
   ---------------------------------------------------------------------- */

function getAt(tree, nodePath) {
  const keys = String(nodePath || '').split('/').filter(Boolean);
  let node = tree;
  for (const key of keys) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

// Match RTDB's key restrictions; accepting arbitrary JSON hid production
// failures for generated usernames such as test.admin.apc.
function validateFirebaseKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/[.#$\[\]/\u0000-\u001f\u007f]/.test(key)) {
      throw new Error('Invalid Firebase key: ' + key);
    }
    validateFirebaseKeys(child);
  }
}

// Firebase does not preserve empty JSON objects/arrays or null children.
function firebaseValue(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const items = value.map(firebaseValue);
    while (items.length && items.at(-1) == null) items.pop();
    return items.length ? items : null;
  }
  const entries = Object.entries(value).map(([key, child]) => [key, firebaseValue(child)]).filter(([, child]) => child != null);
  return entries.length ? Object.fromEntries(entries) : null;
}

function setAt(tree, nodePath, value) {
  validateFirebaseKeys(value);
  value = firebaseValue(value);
  const keys = String(nodePath || '').split('/').filter(Boolean);
  // Real Realtime Database refuses the PATH too: `examDb/exams/EXAM.260929` is
  // rejected before the value is looked at. The mock must be just as strict,
  // otherwise an unsafe path silently "works" in tests and fails in production.
  for (const key of keys) {
    if (/[.#$/\[\]]/.test(key)) throw new Error('Invalid Firebase key: ' + key);
  }
  if (!keys.length) throw new Error('mock rtdb: root writes are not supported');
  let node = tree;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (node[key] === null || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  const last = keys[keys.length - 1];
  if (value === null) delete node[last];
  else node[last] = value;
}

const affects = (listenerPath, writtenPath) =>
  !listenerPath || !writtenPath ||
  listenerPath === writtenPath ||
  listenerPath.startsWith(writtenPath + '/') ||
  writtenPath.startsWith(listenerPath + '/');

/* The mock enforces the DEPLOYED database.rules.json (through the local rules
   simulator) for the anonymous identity the app signs in with. A request the
   rules would refuse in production is refused here too and recorded in
   `ruleViolations`, so these end-to-end runs prove the shipped client and the
   shipped rules agree. */
const DEPLOYED_RULES = JSON.parse(readFileSync(path.join(REPO_DIR, 'database.rules.json'), 'utf8'));
const ANONYMOUS_DEVICE = { uid: 'mock-anon', token: { firebase: { sign_in_provider: 'anonymous' } } };

export async function startMockCloud() {
  const { createSimulator } = await import('./rtdb-rules-sim.mjs');
  const rules = createSimulator(DEPLOYED_RULES);
  const ruleViolations = [];
  const state = {};
  let revision = 0;
  let paused = false;
  let blocked = false;   // everything refused: a device that cannot reach the cloud
  const subscribers = new Set();
  const send = (sub, nodePath) => {
    const val = getAt(state, nodePath);
    try {
      sub.res.write(`data: ${JSON.stringify({ path: nodePath, exists: val !== undefined, val: val === undefined ? null : val })}\n\n`);
    } catch { subscribers.delete(sub); }
  };
  const broadcast = writtenPath => {
    for (const sub of subscribers) {
      if (affects(sub.path, writtenPath)) send(sub, sub.path);
    }
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (blocked && url.pathname !== '/control') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":"offline"}');
      return;
    }
    const readPath = url.searchParams.get('path') || '';
    if (req.method === 'GET' && (url.pathname === '/db' || url.pathname === '/events') &&
        readPath !== '.info/connected' && !rules.canRead(ANONYMOUS_DEVICE, readPath, state)) {
      ruleViolations.push({ op: 'read', path: readPath });
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end('{"error":"permission_denied"}');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/db') {
      const val = url.searchParams.get('path') === '.info/connected' ? true : getAt(state, url.searchParams.get('path'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ revision, exists: val !== undefined, val: val === undefined ? null : val }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/control') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const settings = JSON.parse(body || '{}');
        paused = settings.paused === true;
        blocked = settings.blocked === true;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ paused, blocked }));
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/db') {
      if (paused) {
        // Writes are refused, but reads and listeners stay alive: the device
        // keeps its outbox and must not lose the local change.
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end('{"error":"unavailable"}');
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { nodePath, value, expectedRevision } = JSON.parse(body);
          if (expectedRevision !== undefined && expectedRevision !== revision) {
            res.writeHead(409); res.end(); return;
          }
          // Key/path errors first (500, as before), then the security rules.
          const dryRun = structuredClone(state);
          setAt(dryRun, nodePath, value);
          if (!rules.canWrite(ANONYMOUS_DEVICE, nodePath, firebaseValue(value) ?? null, state)) {
            ruleViolations.push({ op: 'write', path: nodePath });
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end('{"error":"permission_denied"}');
            return;
          }
          revision += 1;
          setAt(state, nodePath, value);
          broadcast(nodePath);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"ok":true}');
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: String(error.message || error) }));
        }
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      const sub = { path: url.searchParams.get('path') || '', res };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      subscribers.add(sub);
      if (sub.path === '.info/connected') res.write('data: {"exists":true,"val":true}\n\n');
      else send(sub, sub.path);
      req.on('close', () => subscribers.delete(sub));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, state, ruleViolations, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

/* -------------------------------------------------------------------------
   Build a runnable copy of the app whose only difference is that the three
   Firebase CDN import specifiers point at the local mock modules.
   ---------------------------------------------------------------------- */

function buildAppCopy(cloudUrl) {
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(path.join(RUN_DIR, 'mock'), { recursive: true });
  cpSync(path.join(REPO_DIR, 'js'), path.join(RUN_DIR, 'js'), { recursive: true });
  // The student profile card's optional QR download is a static module import;
  // copy its local encoder too so the whole student feature chunk can boot in
  // the isolated device tree (a failed lazy import otherwise hides Routine).
  cpSync(path.join(REPO_DIR, 'vendor'), path.join(RUN_DIR, 'vendor'), { recursive: true });
  // The bridge imports its gate from ../sync and the SDK surface from
  // ../firebase; both must exist beside the copied js/ tree.
  cpSync(path.join(REPO_DIR, 'sync'), path.join(RUN_DIR, 'sync'), { recursive: true });
  mkdirSync(path.join(RUN_DIR, 'firebase'), { recursive: true });

  const mockAppUrl = pathToFileUrl(path.join(RUN_DIR, 'mock', 'firebase-app.mock.mjs'));
  const mockAuthUrl = pathToFileUrl(path.join(RUN_DIR, 'mock', 'firebase-auth.mock.mjs'));
  const mockDbUrl = pathToFileUrl(path.join(RUN_DIR, 'mock', 'firebase-database.mock.mjs'));
  const CDN = 'https://www.gstatic.com/firebasejs/12.2.1/';

  writeFileSync(path.join(RUN_DIR, 'mock', 'firebase-app.mock.mjs'),
    "export const initializeApp = () => ({ mock: 'app' });\n");
  writeFileSync(path.join(RUN_DIR, 'mock', 'firebase-auth.mock.mjs'),
    "const auth = { currentUser: null, authStateReady: async () => {} };\n" +
    "export const getAuth = () => auth;\n" +
    "export const browserLocalPersistence = {}; export async function setPersistence() {}\n" +
    "export async function signInAnonymously() { auth.currentUser = { uid: 'mock-anon' }; return { user: auth.currentUser }; }\n");
  writeFileSync(path.join(RUN_DIR, 'mock', 'firebase-database.mock.mjs'), `
/* Minimal RTDB client over loopback HTTP (see two-device-harness.mjs). */
const BASE = ${JSON.stringify(cloudUrl)};
const enc = encodeURIComponent;
export const getDatabase = () => ({});
export const ref = (db, nodePath) => ({ path: String(nodePath || '') });
export async function get(node) {
  const res = await fetch(BASE + '/db?path=' + enc(node.path));
  const data = await res.json();
  return { exists: () => data.exists, val: () => data.val };
}
export async function set(node, value) {
  const res = await fetch(BASE + '/db', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodePath: node.path, value })
  });
  if (!res.ok) throw new Error('mock rtdb set failed: ' + res.status);
}
export async function runTransaction(node, change) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const before = await fetch(BASE + '/db?path=' + enc(node.path)).then(res => res.json());
    const value = change(before.val);
    // The SDK aborts a transaction whose update function returns undefined and
    // leaves the stored value alone — the mock must not delete it instead.
    if (value === undefined) {
      return { committed: false, snapshot: { val: () => before.val, exists: () => before.val !== undefined } };
    }
    const res = await fetch(BASE + '/db', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodePath: node.path, value, expectedRevision: before.revision })
    });
    if (res.status === 409) continue;
    if (!res.ok) throw new Error('mock transaction failed: ' + res.status);
    return { committed: true, snapshot: { val: () => value, exists: () => value !== null } };
  }
  throw new Error('mock transaction retry limit');
}
export function onValue(node, callback) {
  const controller = new AbortController();
  (async () => {
    const res = await fetch(BASE + '/events?path=' + enc(node.path), { signal: controller.signal });
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\\n\\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const line = frame.split('\\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        callback({ exists: () => event.exists, val: () => event.val });
      }
    }
  })().catch(() => { /* stream closed when the device quits */ });
  return () => controller.abort();
}
`);

  /* These scenarios test data propagation between two signed-in phones, not
     the session gate (tests/login-sync-lifecycle.test.mjs covers that). The
     child's `boot` command marks the device as signed in; without the mark the
     real session check runs unchanged. */
  const sessionFile = path.join(RUN_DIR, 'js', 'sync-session.js');
  writeFileSync(sessionFile, readFileSync(sessionFile, 'utf8').replace(
    'export async function hasSyncSession() {',
    'export async function hasSyncSession() {\n  if (globalThis.__apcTwoDeviceSignedIn === true) return true;'));

  /* The app reaches Firebase only through firebase/firebase-init.js and
     firebase/firebase-services.js: replace exactly those two modules. */
  writeFileSync(path.join(RUN_DIR, 'firebase', 'firebase-init.js'),
    "export const firebaseApp = { mock: 'app' };\nexport const appCheckReady = Promise.resolve();\n");
  writeFileSync(path.join(RUN_DIR, 'firebase', 'firebase-services.js'),
    `export { getAuth, signInAnonymously, setPersistence, browserLocalPersistence } from ${JSON.stringify(mockAuthUrl)};\n` +
    `export { getDatabase, ref, get, set, runTransaction, onValue } from ${JSON.stringify(mockDbUrl)};\n` +
    "const unavailable = name => () => { throw new Error(name + ' is not available in the two-device harness'); };\n" +
    "export const signInWithEmailAndPassword = unavailable('signInWithEmailAndPassword');\n" +
    "export const updatePassword = unavailable('updatePassword');\n" +
    "export const getFirestore = unavailable('getFirestore'); export const doc = unavailable('doc'); export const getDoc = unavailable('getDoc');\n" +
    "export const getFunctions = () => ({});\n" +
    "export const httpsCallable = (functions, name) => async () => { throw new Error('functions/not-deployed: ' + name); };\n");

  const swap = (file, replacements) => {
    const target = path.join(RUN_DIR, 'js', file);
    let source = readFileSync(target, 'utf8');
    for (const [from, to] of replacements) source = source.split(from).join(to);
    writeFileSync(target, source);
  };
  swap('firebase-config.js', [[CDN + 'firebase-app.js', mockAppUrl]]);
  swap('realtime-sync.js', [
    [CDN + 'firebase-auth.js', mockAuthUrl],
    [CDN + 'firebase-database.js', mockDbUrl]
  ]);
  /* The version query would create a second module instance inside one
     process; the browser deduplicates by URL+query, so make Node match. */
  /* Every module must load ONE instance of the bridge: drop the cache-busting
     query in each copied file (Node, unlike the browser, keys modules by URL). */
  for (const name of readdirSync(path.join(RUN_DIR, 'js'))) {
    if (!name.endsWith('.js') || name === 'realtime-sync.js') continue;
    swap(name, [['./realtime-sync.js?v=20260929-fbaudit', './realtime-sync.js']]);
  }
}

function pathToFileUrl(p) {
  return 'file://' + path.resolve(p).split(path.sep).map(segment => encodeURIComponent(segment)).join('/');
}

/* -------------------------------------------------------------------------
   Device process control — spawn a child jsdom "phone" and talk JSON lines.
   ---------------------------------------------------------------------- */

/* Set only by the hardening test: a device that deliberately hits broken cloud
   paths logs the failures, which would bury the test runner's own output. The
   silencing happens inside the child process (tests/child-quiet-hook.mjs). */
let quietChildren = false;

export function buildDevices({ quietConsoleError = false } = {}) {
  quietChildren = quietConsoleError === true;
  return { buildAppCopy };
}

export class Device {
  constructor(name, cloudUrl) {
    this.name = name;
    this.cloudUrl = cloudUrl;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
  }

  start() {
    this.child = spawn(process.execPath, [
      '--import', pathToFileUrl(path.join(TESTS_DIR, 'child-quiet-hook.mjs')),
      path.join(TESTS_DIR, 'two-device-child.mjs')
    ], {
      cwd: REPO_DIR,
      env: {
        ...process.env,
        MOCK_CLOUD_URL: this.cloudUrl,
        DEVICE: this.name,
        ...(quietChildren ? { TWO_DEVICE_QUIET: '1' } : {})
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`[${this.name}:${message.cmd}] ${message.error}`));
        else pending.resolve(message.result);
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => {
      if (process.env.TWO_DEVICE_DEBUG) process.stderr.write(`[${this.name}] ${chunk}`);
    });
    this.child.on('exit', code => {
      for (const pending of this.pending.values()) pending.reject(new Error(`[${this.name}] device exited (${code})`));
      this.pending.clear();
    });
  }

  run(cmd, args = {}, timeout = 60000) {
    const id = String(this.nextId++);
    const payload = JSON.stringify({ id, cmd, args }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[${this.name}:${cmd}] timed out after ${timeout}ms`));
      }, timeout);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      this.child.stdin.write(payload);
    });
  }

  async stop() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    try { await this.run('quit', {}, 5000); } catch { /* already gone */ }
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
  }
}
