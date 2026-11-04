import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';

// All consumers must share one module instance and its single-flight gates.
test('all cloud bridge imports use the current release version', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const version = sw.match(/const CACHE_VERSION = (\d+);/)?.[1];
  assert.ok(version);
  let imports = 0;
  for (const file of readdirSync(new URL('../js/', import.meta.url)).filter(name => name.endsWith('.js'))) {
    const source = readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\.\.\/sync\/sync-core\.js\?v=([^'"\s]+)/g)) {
      imports++;
      assert.equal(match[1], version, `${file} must use the same bridge as login and Admin`);
    }
  }
  assert.ok(imports > 2);
});

test('role-specific cloud hydrations do not incorrectly share another role flight', async t => {
  const requests = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  globalThis.__bridgeHydrationTest = async options => {
    requests.push(options.roles?.join(',') || 'all');
    await gate;
    return { ok: true };
  };
  const hook = registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('/js/realtime-sync.js')) return {
        format: 'module', shortCircuit: true,
        source: 'export const hydrateStaffAccounts = options => globalThis.__bridgeHydrationTest(options);'
      };
      return nextLoad(url, context);
    }
  });
  t.after(() => { hook.deregister(); delete globalThis.__bridgeHydrationTest; });
  const bridge = await import('../sync/sync-core.js?bridge-flight-test');
  const a = bridge.hydrateStaffAccounts({ roles: ['admin'] });
  const duplicate = bridge.hydrateStaffAccounts({ roles: ['admin'] });
  const b = bridge.hydrateStaffAccounts({ roles: ['teacher'] });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(requests.sort(), ['admin', 'teacher']);
  release();
  await Promise.all([a, duplicate, b]);
});
