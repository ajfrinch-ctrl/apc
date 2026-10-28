import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { KEYS } from '../js/database.js';
import { decryptBackupDataSync, preflightLedgerMigration } from '../tools/ledger-migration-preflight.mjs';

test('Admin export uses a private passphrase and remains compatible with offline preflight and restore', async t => {
  const passphrase = 'synthetic-backup-passphrase-2026';
  const ctx = await loadPage('admin.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  t.after(() => ctx.window.close());
  const roster = [{ id: 'OLD-01', name: 'Student One', className: 'দশম শ্রেণি', monthlyFee: 1500 }];
  const payments = [{ id: 'T-01', studentId: 'OLD-01', amount: 1500,
    receiptNo: 'C-2026-T-01', month: 'অক্টোবর ২০২৬', feeType: 'মাসিক বেতন',
    method: 'নগদ (Cash)', status: 'pending' }];
  ctx.window.localStorage.setItem(KEYS.students, JSON.stringify(roster));
  ctx.window.localStorage.setItem(KEYS.transactions, JSON.stringify(payments));
  ctx.window.localStorage.setItem(KEYS.account, JSON.stringify({ passwordHash: 'PRIVATE-HASH' }));
  await provisionStaff('admin'); seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell')?.hidden === false);
  await ctx.waitFor(() => ctx.$('#adminMoreMenu [data-admin-view="data"]')?.dataset.navWired === '1');
  const active = () => ctx.$('.admin-view.active')?.dataset.viewPanel;
  ctx.click(ctx.$('.admin-bottom-item[data-admin-view="more"]'));
  ctx.click(ctx.$('#adminMoreMenu [data-admin-view="data"]'));
  ctx.click(ctx.$('#adminDataMenu [data-admin-view="backup"]'));
  ctx.click(ctx.$('[data-view-panel="backup"] [data-admin-view="backup-export"]'));
  await ctx.waitFor(() => active() === 'backup-export');
  const rosterBeforeExport = ctx.window.localStorage.getItem(KEYS.students);
  const paymentsBeforeExport = ctx.window.localStorage.getItem(KEYS.transactions);
  let exported = null, download;
  const originalGlobalURL = globalThis.URL;
  globalThis.URL = ctx.window.URL;
  t.after(() => { globalThis.URL = originalGlobalURL; });
  ctx.window.URL.createObjectURL = blob => { exported = blob; return 'blob:apc-test'; };
  ctx.window.URL.revokeObjectURL = () => {};
  const originalClick = ctx.window.HTMLAnchorElement.prototype.click;
  ctx.window.HTMLAnchorElement.prototype.click = function click() { download = this.download; };
  t.after(() => { ctx.window.HTMLAnchorElement.prototype.click = originalClick; });
  // No public fallback and no download for an absent or mismatched secret.
  ctx.click(ctx.$('#backupExportButton'));
  assert.equal(exported, null);
  assert.match(ctx.$('#backupExportStatus').textContent, /১২/);
  ctx.type(ctx.$('#backupExportPassphrase'), passphrase);
  ctx.type(ctx.$('#backupExportPassphraseConfirm'), 'wrong-synthetic-passphrase');
  ctx.click(ctx.$('#backupExportButton'));
  assert.equal(exported, null);
  assert.match(ctx.$('#backupExportStatus').textContent, /মিলছে না/);
  ctx.type(ctx.$('#backupExportPassphraseConfirm'), passphrase);
  ctx.click(ctx.$('#backupExportButton'));
  await ctx.waitFor(() => Boolean(exported));
  const raw = await new Promise((resolve, reject) => {
    const reader = new ctx.window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(exported);
  });
  const payload = JSON.parse(raw);
  assert.match(download, /^APC-backup-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(payload.kind, 'active-plus-backup');
  assert.equal(payload.version, 3);
  assert.equal(payload.iterations, 600000);
  assert.equal(payload.encrypted, true);
  assert.equal(payload.algorithm, 'AES-256-GCM');
  assert.equal(payload.data, undefined, 'plaintext data object is never exposed in the backup file');
  assert.equal(raw.includes('Student One'), false, 'raw backup file does not expose student names');
  assert.equal(raw.includes('OLD-01'), false, 'raw backup file does not expose student IDs');
  assert.equal(raw.includes('C-2026-T-01'), false, 'raw backup file does not expose receipt numbers');
  assert.equal(raw.includes('PRIVATE-HASH'), false, 'raw backup file does not expose password hashes');

  assert.equal(raw.includes(passphrase), false, 'the passphrase is never put in the backup');
  assert.equal(ctx.$('#backupExportPassphrase').value, '', 'passphrase input is cleared after export');
  for (let i = 0; i < ctx.window.localStorage.length; i++) {
    assert.equal((ctx.window.localStorage.getItem(ctx.window.localStorage.key(i)) || '').includes(passphrase), false,
      'passphrase is not stored in localStorage');
  }
  assert.throws(() => decryptBackupDataSync(payload), 'the former public fallback cannot open v3');
  assert.throws(() => decryptBackupDataSync(payload, { passphrase: 'wrong-synthetic-password' }));
  const decryptedData = decryptBackupDataSync(payload, { passphrase });
  assert.equal(decryptedData[KEYS.students], rosterBeforeExport);
  assert.equal(decryptedData[KEYS.transactions], paymentsBeforeExport);
  assert.equal(decryptedData[KEYS.account], undefined, 'do not export account password hashes');
  assert.equal(ctx.window.localStorage.getItem(KEYS.students), rosterBeforeExport);
  assert.equal(ctx.window.localStorage.getItem(KEYS.transactions), paymentsBeforeExport);
  const report = preflightLedgerMigration(payload, { kind: 'apc-reviewed-student-links', version: 1,
    links: [{ legacyStudentId: 'OLD-01', uid: 'UID-01' }] }, { passphrase });
  assert.equal(report.importAllowed, false);
  assert.equal(JSON.stringify(report).includes('UID-01'), false);

  // Verify 1-click restore from its separate detail decrypts and restores localStorage.
  ctx.click(ctx.$('[data-view-panel="backup-export"] [data-admin-back]'));
  await ctx.waitFor(() => active() === 'backup');
  ctx.click(ctx.$('[data-view-panel="backup"] [data-admin-view="backup-restore"]'));
  await ctx.waitFor(() => active() === 'backup-restore');
  ctx.window.localStorage.setItem(KEYS.students, '[]');
  ctx.window.localStorage.setItem(KEYS.transactions, '[]');
  const fileInput = ctx.$('#backupFileInput');
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: [{ text: async () => raw }]
  });
  ctx.type(ctx.$('#backupRestorePassphrase'), 'wrong-synthetic-password');
  fileInput.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.waitFor(() => (ctx.$('#backupStatus')?.textContent || '').includes('ডিক্রিপ্ট করা যায়নি'));
  assert.equal(ctx.window.localStorage.getItem(KEYS.students), '[]', 'wrong passphrase leaves existing data intact');
  ctx.type(ctx.$('#backupRestorePassphrase'), passphrase);
  ctx.click(ctx.$('#backupRestoreButton'));
  await ctx.waitFor(() => Boolean(ctx.$('#adminModalBody [data-modal-action="restore"]')));
  ctx.click(ctx.$('#adminModalBody [data-modal-action="restore"]'));
  await ctx.waitFor(() => ctx.window.localStorage.getItem(KEYS.students) === rosterBeforeExport);
  assert.equal(ctx.window.localStorage.getItem(KEYS.transactions), paymentsBeforeExport);

  // Verify tampered encrypted backup is rejected
  const tampered = { ...payload, ciphertext: payload.ciphertext.slice(0, -4) + 'AAAA' };
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: [{ text: async () => JSON.stringify(tampered) }]
  });
  ctx.type(ctx.$('#backupRestorePassphrase'), passphrase);
  fileInput.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.waitFor(() => (ctx.$('#backupStatus')?.textContent || '').includes('ডিক্রিপ্ট করা যায়নি'));
});

test('backup allowlist stays limited to non-credential collections', () => {
  const source = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const BACKUP_KEYS ='), source.indexOf('const bn ='));
  for (const name of ['students', 'transactions', 'notices', 'routine', 'teaching', 'exams', 'settings'])
    assert.match(block, new RegExp(`KEYS\\.${name}\\b`));
  for (const name of ['account', 'accounts', 'usernames', 'studentProfile'])
    assert.doesNotMatch(block, new RegExp(`KEYS\\.${name}\\b`));
});
