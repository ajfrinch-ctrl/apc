import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function runOnHost(hostname, provider = '') {
  // A fresh process models a fresh browser origin and ensures that no client or
  // session can be carried over from a production-host test. Network is
  // deliberately blocked; this never contacts the production project.
  const program = `
    globalThis.location = { hostname: ${JSON.stringify(hostname)}, search: '' };
    globalThis.__APC_CLOUD_PROVIDER__ = ${JSON.stringify(provider)};
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('network blocked by test'); };
    const config = await import('./sync/supabase-config.js');
    const direct = await import('./sync/supabase-transport.js');
    let directBlocked = false;
    try { direct.getSupabaseClient(); } catch { directBlocked = true; }
    let explicitBlocked = false;
    if (${JSON.stringify(provider)} === 'supabase') {
      const transport = await import('./sync/realtime-transport.js');
      try { await transport.get(transport.ref({}, 'activePlusSync/v1/students')); }
      catch { explicitBlocked = true; }
    }
    console.log(JSON.stringify({ configured: config.isSupabaseConfigured(), directBlocked, explicitBlocked, calls }));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    cwd: root, encoding: 'utf8', timeout: 15000
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split('\n').at(-1));
}

test('preview cannot construct or explicitly select the production Supabase client', () => {
  assert.deepEqual(runOnHost('8080-sandbox.e2b.app', 'supabase'), {
    configured: false, directBlocked: true, explicitBlocked: true, calls: 0
  });
  assert.equal(runOnHost('8080-SANDBOX.E2B.APP').directBlocked, true);
});

test('the production and local existing Supabase configuration stays enabled', () => {
  for (const host of ['active-plus-coaching.vercel.app', 'localhost']) {
    const result = runOnHost(host);
    assert.equal(result.configured, true, host);
    assert.equal(result.directBlocked, false, host);
    assert.equal(result.calls, 0, host);
  }
});
