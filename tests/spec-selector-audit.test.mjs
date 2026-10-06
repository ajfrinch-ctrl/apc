/* The browser specs cannot run without a Chromium download, but their selectors
   must still point at controls the app really builds. tools/spec-selector-audit.mjs
   resolves every `#id` and `[data-*="value"]` in tests/*.spec.cjs against the six
   pages, the preview page and every module's runtime DOM; this test keeps that at
   zero stale references, so a control that moves house can never leave a silent
   hole in the acceptance suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('every spec selector points at markup the app really builds', () => {
  // execFileSync throws on a non-zero exit, which is --strict's stale-reference signal.
  const output = execFileSync(process.execPath, ['tools/spec-selector-audit.mjs', '--strict'], {
    cwd: root, encoding: 'utf8'
  });
  assert.match(output, /0 unresolved selector\(s\)/, 'the audit still reports stale spec selectors');
  assert.match(output, /\d+ specs scanned/, 'the audit ran over the browser specs');
});

test('the audit notices a selector the app does not build', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const target = path.join(root, 'tests', 'payment-panel.spec.cjs');
  const original = readFileSync(target, 'utf8');
  try {
    writeFileSync(target, original + "\n// audit self-check\ntest('probe', async ({ page }) => { await page.locator('#noSuchControlAnywhere'); });\n");
    assert.throws(() => execFileSync(process.execPath, ['tools/spec-selector-audit.mjs', '--strict'], { cwd: root, encoding: 'utf8' }));
  } finally {
    writeFileSync(target, original);
  }
});
