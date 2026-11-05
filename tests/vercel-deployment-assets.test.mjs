import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Vercel documents .vercelignore as using gitignore-style patterns. Check the
// actual rules, not just the existence of assets in the source checkout: an
// unanchored directory name can silently exclude a nested browser SDK.
test('Vercel ignore rules retain browser SDKs but exclude root backend files', () => {
  const temp = mkdtempSync(join(tmpdir(), 'apc-vercel-ignore-'));
  try {
    execFileSync('git', ['init', '-q', temp]);
    writeFileSync(join(temp, '.gitignore'), readFileSync(new URL('../.vercelignore', import.meta.url)));
    const ignored = path => {
      const result = spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: temp });
      assert.ok(result.status === 0 || result.status === 1, `git check-ignore failed for ${path}`);
      return result.status === 0;
    };
    for (const path of ['vendor/supabase/sdk.js', 'vendor/firebase/sdk.js', 'sync/supabase-transport.js']) {
      assert.equal(ignored(path), false, `${path} must be deployed`);
    }
    assert.equal(ignored('supabase/config.toml'), true, 'root Supabase backend files remain excluded');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
