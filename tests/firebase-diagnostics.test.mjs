/* The login-page sync diagnostic (js/firebase-diagnostics.js) exists for the
   exact device that has NO app account yet — a regression here hides the one
   tool that explains "sync হচ্ছে না" and its cure. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the diagnostic tool is wired into the login page (it used to be dead code)', () => {
  const html = read('../index.html');
  assert.match(html, /<script src="js\/firebase-diagnostic-ui\.js\?v=[^"]+"/,
    'index.html loads firebase-diagnostic-ui.js — the button users press when sync fails');
  assert.ok(html.includes('auth-card'), 'the button mounts under the auth card');
});

test('the diagnostic never depends on an app login (fresh-device diagnosis is its job)', () => {
  const pullsSession = /(?:import\s*\(|from\s*)['"][^'"]*sync-session\.js['"]/;
  const callsSession = /hasSyncSession\s*\(/;
  for (const file of ['../js/firebase-diagnostics.js', '../js/firebase-online-test.js']) {
    const source = read(file);
    assert.equal(pullsSession.test(source), false,
      `${file} must not import sync-session — the sync ENGINE gates on it, the DIAGNOSTIC does not`);
    assert.equal(callsSession.test(source), false);
  }
});

test('the probe path in the diagnostic matches the deployed rules node', () => {
  const source = read('../js/firebase-diagnostics.js');
  assert.ok(source.includes("'activePlusSync/v1/system/connectivityProbe'"),
    'write probe targets the rules-provided node');
  const rules = JSON.parse(read('../database.rules.json'));
  assert.ok(rules.rules.activePlusSync.v1.system.connectivityProbe.$probeKey,
    'database.rules.json carries the probe path');
});

test('failure codes map to actionable, stage-specific explanations', async t => {
  globalThis.window = globalThis.window || {};
  t.after(() => { if (Object.keys(globalThis.window).length === 0) delete globalThis.window; });
  const { explainDiagnosticError } = await import('../js/firebase-diagnostics.js');
  const cases = [
    [{ code: 'auth/operation-not-allowed' }, 'anonymous-auth-disabled'],
    [{ code: 'auth/admin-restricted-operation' }, 'anonymous-auth-disabled'],
    [{ code: 'permission-denied' }, 'rules-denied'],
    [{ code: 'PERMISSION_DENIED' }, 'rules-denied'],
    [{ code: 'auth/invalid-api-key' }, 'invalid-api-key'],
    [{ message: 'Requests are missing an App Check token' }, 'app-check'],
    [{ code: 'auth/network-request-failed' }, 'network'],
    [{ code: 'something-else-entirely' }, 'unknown']
  ];
  for (const [error, reason] of cases) {
    const explanation = explainDiagnosticError(error);
    assert.equal(explanation.reason, reason, `${JSON.stringify(error)} → ${reason}`);
  }
  assert.match(explainDiagnosticError({ code: 'auth/operation-not-allowed' }).guidance, /Anonymous/);
  assert.match(explainDiagnosticError({ code: 'permission-denied' }).guidance, /firebase deploy --only database/);
});

test('an offline device short-circuits cleanly with a Bengali message and stages', async () => {
  const { diagnoseFirebaseSync } = await import('../js/firebase-diagnostics.js');
  // Node's navigator has no onLine (undefined) — the diagnostic must treat it as offline.
  const result = await diagnoseFirebaseSync();
  assert.equal(result.error, 'ডিভাইস বর্তমানে অফলাইনে আছে');
  assert.deepEqual(result.stages.map(stage => [stage.id, stage.ok]), [['device-online', false]]);
});

test('the legacy result shape stays intact for firebase-diagnostic-ui.js', async () => {
  const { diagnoseFirebaseSync } = await import('../js/firebase-diagnostics.js');
  const result = await diagnoseFirebaseSync();
  for (const field of ['sdk', 'databaseURL', 'authentication', 'firebaseConnection', 'databaseRead', 'databaseWrite', 'localStorageProtected', 'error']) {
    assert.ok(Object.hasOwn(result, field), `result keeps ${field}`);
  }
  assert.equal(typeof result.guidance, 'string');
});
