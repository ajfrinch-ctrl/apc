import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('protected sync architecture is present', () => {
  for (const path of [
    'sync/sync-core.js','sync/sync-config.js','sync/sync-auth.js','sync/sync-queue.js',
    'sync/sync-retry.js','sync/sync-status.js','sync/sync-guard.js',
    'firebase/firebase-init.js','firebase/firebase-config.js','firebase/firebase-services.js',
    'sync/SYNC-PROTECTION.md'
  ]) assert.ok(read(path).length > 0, path + ' exists');
});

test('Firebase initialization is centralized and idempotent', () => {
  const init = read('firebase/firebase-init.js');
  assert.match(init, /getApps\(\)\.length\s*\?\s*getApp\(\)\s*:\s*initializeApp/);
});

test('UI entry uses the protected Sync facade', () => {
  assert.match(read('js/realtime-sync-entry.js'), /\.\.\/sync\/sync-core\.js/);
  assert.match(read('js/login.js'), /\.\.\/sync\/sync-core\.js/);
});

test('destructive storage reset is absent from protected sync layer', () => {
  for (const path of [
    'sync/sync-core.js','sync/sync-guard.js','sync/sync-queue.js',
    'sync/sync-retry.js','sync/sync-status.js'
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /localStorage\.clear\s*\(|indexedDB\.deleteDatabase\s*\(/);
  }
});

test('PWA shell contains the protected sync zone and a new cache version', () => {
  const sw = read('sw.js');
  assert.match(sw, /const CACHE_VERSION = 157/);
  for (const path of ['firebase/firebase-config.js','firebase/firebase-init.js','firebase/firebase-services.js','sync/sync-core.js','sync/sync-guard.js']) {
    assert.match(sw, new RegExp(path.replace(/[.*+?^$()|[\]\\]/g, '\\$&')));
  }
});