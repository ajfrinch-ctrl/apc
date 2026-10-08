/* Factory reset (docs/FACTORY-RESET.md) — the pieces a unit test can reach:
   the local wipe, the sync-boundary wiring and the Admin-panel entry point.
   The cloud-side deletion rights are covered by tests/interim-sync-rules.test.mjs
   and tests/rtdb-path-coverage.test.mjs; the first-use login flow that a
   finished reset reopens is covered by tests/first-admin-setup.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearLocalAppData } from '../js/factory-reset.js';
import { KEYS, STAFF_KEYS } from '../js/database.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

function storageFrom(initial) {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key: index => Array.from(data.keys())[index] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    clear: () => data.clear()
  };
}

test('the local wipe removes every app-owned key and leaves foreign storage alone', () => {
  const local = storageFrom({
    [KEYS.students]: '[]',
    [KEYS.accounts]: '{}',
    [KEYS.usernames]: '{}',
    [KEYS.settings]: '{}',
    [KEYS.studentProfile]: '{}',
    [STAFF_KEYS.adminAccount]: '{}',
    [STAFF_KEYS.adminSession]: '{}',
    'activePlus.device.v1': 'dev-1',
    'activePlus.deviceKey.v1': 'key-1',
    'active-plus-session-v1': '{}',
    'active-plus-appearance-v2': '{}',
    'other-site-key': 'keep me'
  });
  const session = storageFrom({ 'activePlus.roleWorkspace.v2': 'x', 'unrelated': '1' });
  globalThis.window = { localStorage: local, sessionStorage: session };

  const removed = clearLocalAppData();

  assert.equal(local.getItem('other-site-key'), 'keep me', 'foreign keys stay');
  assert.equal(session.getItem('unrelated'), null, 'session storage is cleared entirely');
  for (const key of [KEYS.students, KEYS.accounts, KEYS.usernames, KEYS.settings,
    STAFF_KEYS.adminAccount, STAFF_KEYS.adminSession,
    'activePlus.device.v1', 'active-plus-session-v1', 'active-plus-appearance-v2']) {
    assert.equal(local.getItem(key), null, `${key} removed`);
  }
  assert.ok(removed.includes(KEYS.students), 'the report lists removed keys');
  assert.equal(local.length, 1, 'only the foreign key survives');
});

test('a blocked storage never throws — the reset still finishes', () => {
  const broken = {
    get length() { throw new Error('blocked'); },
    key() { throw new Error('blocked'); },
    getItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  globalThis.window = {
    localStorage: broken,
    get sessionStorage() { throw new Error('blocked'); }
  };
  assert.deepEqual(clearLocalAppData(), []);
});

test('the sync boundary exposes the cloud wipe (single-flight facade)', async () => {
  const core = await import('../sync/sync-core.js');
  assert.equal(typeof core.resetCloudDatabase, 'function');
  assert.equal(typeof core.SyncService.resetCloudDatabase, 'function');
  const source = read('../js/realtime-sync.js');
  assert.match(source, /export async function resetCloudDatabase/, 'the bridge implements it');
  assert.match(source, /stopRealtimeSync\(\)/, 'listeners stop before the wipe');
  assert.match(source, /adminInitialized/, 'the initialization marker is part of the wipe');
});

test('the Admin panel carries the reset entry point (and the dead stub is gone)', () => {
  const html = read('../admin.html');
  assert.match(html, /id="factoryResetButton"/, 'the reset button exists');
  assert.equal(html.includes('resetAllLocalDataButton'), false, 'the disabled stub is removed');
  const js = read('../js/admin.js');
  assert.match(js, /factoryResetButton.*openFactoryReset/s, 'the button is wired');
  assert.match(js, /resetCloudDatabase/, 'the flow reaches the sync boundary');
  assert.match(js, /clearLocalAppData/, 'and finishes with the local wipe');
});
