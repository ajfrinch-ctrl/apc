import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { encryptBackupData, decryptBackupData } from '../js/backup-crypto.js';
import { prepareBackupRestore, applyBackupRestore } from '../js/backup-restore.js';
import { encryptBackupPayload, unwrapBackupPayload } from '../js/backup-merge.js';
import { decryptBackupDataSync, preflightLedgerMigration } from '../tools/ledger-migration-preflight.mjs';
import { compareLedgerBackups } from '../tools/ledger-backup-compare.mjs';

const passphrase = 'synthetic-backup-password-2026';
const data = {
  'activePlus.admin.students.v1': JSON.stringify([{ id: 'S1', name: 'Synthetic' }]),
  'activePlus.admin.transactions.v1': JSON.stringify([])
};
const links = { kind: 'apc-reviewed-student-links', version: 1, links: [] };

test('backup security modules are in the offline app shell', () => {
  const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(worker, /['"]\.\/js\/backup-crypto\.js['"]/);
  assert.match(worker, /['"]\.\/js\/backup-restore\.js['"]/);
});

function legacyV2(value) {
  // Generate a synthetic old-format backup only; this public constant is never
  // used by the application to encrypt a new backup.
  const source = readFileSync(new URL('../js/backup-crypto.js', import.meta.url), 'utf8');
  const legacy = source.match(/const LEGACY_BACKUP_KEY = '([^']+)'/)[1];
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', pbkdf2Sync(legacy, salt, 100000, 32, 'sha256'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]);
  return { kind: 'active-plus-backup', version: 2, encrypted: true,
    salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: encrypted.toString('base64') };
}

test('v3 requires a real passphrase, randomizes encryption, and rejects wrong passwords and tampering', async () => {
  await assert.rejects(encryptBackupData(data), /PASSPHRASE_REQUIRED/);
  await assert.rejects(encryptBackupData(data, { passphrase: '            ' }), /PASSPHRASE_REQUIRED/);
  const first = await encryptBackupData(data, { passphrase });
  const second = await encryptBackupData(data, { passphrase });
  assert.equal(first.version, 3);
  assert.equal(first.iterations, 600000);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
  assert.equal(JSON.stringify(first).includes(passphrase), false);
  assert.equal(JSON.stringify(first).includes('Synthetic'), false);
  assert.deepEqual(await decryptBackupData(first, { passphrase }), data);
  assert.deepEqual(decryptBackupDataSync(first, { passphrase }), data);
  await assert.rejects(decryptBackupData(first, { passphrase: 'wrong-synthetic-password' }));
  assert.throws(() => decryptBackupDataSync(first, { passphrase: 'wrong-synthetic-password' }));
  await assert.rejects(decryptBackupData({ ...first, iterations: 1 }, { passphrase }), /INVALID_BACKUP_FORMAT/);
  const forgedDate = { ...first, createdAt: '2099-01-01T00:00:00.000Z' };
  await assert.rejects(decryptBackupData(forgedDate, { passphrase }), 'timestamp is authenticated');
  assert.throws(() => decryptBackupDataSync(forgedDate, { passphrase }), 'offline tools authenticate it too');
  const raw = Buffer.from(first.ciphertext, 'base64'); raw[0] ^= 1;
  await assert.rejects(decryptBackupData({ ...first, ciphertext: raw.toString('base64') }, { passphrase }));
});

test('restore rejects malformed collections before writing and rolls back a failed write', async () => {
  for (const invalid of [null, [], 'not-an-object']) {
    await assert.rejects(decryptBackupData({ kind: 'active-plus-backup', version: 1, data: invalid }));
  }
  assert.throws(() => prepareBackupRestore({ students: null }, ['students']));
  assert.throws(() => prepareBackupRestore({ unrelated: 'value' }, ['students']));
  const entries = prepareBackupRestore({ students: '[1]', transactions: '[2]', account: 'ignored' }, ['students', 'transactions']);
  assert.deepEqual(entries, [['students', '[1]'], ['transactions', '[2]']]);
  const values = new Map([['students', '[old-students]'], ['transactions', '[old-transactions]']]);
  let failOnce = true;
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) {
      if (key === 'transactions' && failOnce) { failOnce = false; throw new Error('quota'); }
      values.set(key, value);
    },
    removeItem: key => values.delete(key)
  };
  assert.throws(() => applyBackupRestore(storage, entries), /BACKUP_RESTORE_FAILED/);
  assert.deepEqual(Object.fromEntries(values), { transactions: '[old-transactions]', students: '[old-students]' });
  applyBackupRestore(storage, entries);
  assert.equal(values.get('students'), '[1]');
  assert.equal(values.get('transactions'), '[2]');
  assert.equal(values.has('account'), false);
  const brokenStorage = {
    getItem: () => 'old',
    setItem: key => { if (key === 'transactions') throw new Error('disk unavailable'); },
    removeItem: () => { throw new Error('disk unavailable'); }
  };
  assert.throws(() => applyBackupRestore(brokenStorage, entries), /BACKUP_RESTORE_ROLLBACK_FAILED/);
});

test('legacy v1/v2 remain read-only compatible and the merge tool writes only v3', async () => {
  const oldPlain = { kind: 'active-plus-backup', version: 1, createdAt: '2026-01-01T00:00:00.000Z', data };
  const oldEncrypted = { ...legacyV2(data), createdAt: '2026-01-01T00:00:00.000Z' };
  for (const old of [oldPlain, oldEncrypted]) {
    assert.deepEqual(await decryptBackupData(old), data);
    assert.deepEqual(decryptBackupDataSync(old), data);
    assert.deepEqual((await unwrapBackupPayload(old)).data, data);
  }
  await assert.rejects(encryptBackupPayload(data), /PASSPHRASE_REQUIRED/);
  const next = await encryptBackupPayload(data, oldPlain.createdAt, { mergedFrom: [oldPlain.createdAt] }, passphrase);
  assert.equal(next.version, 3);
  assert.deepEqual((await unwrapBackupPayload(next, 'synthetic', passphrase)).data, data);
  await assert.rejects(unwrapBackupPayload(next, 'synthetic'), /ডিক্রিপ্ট/);
  assert.deepEqual(next.mergedFrom, [oldPlain.createdAt]);
});

test('offline preflight and comparison accept v3 only with the correct supplied passphrase', async () => {
  const encrypted = await encryptBackupData(data, { passphrase, createdAt: '2026-01-01T00:00:00.000Z' });
  assert.throws(() => preflightLedgerMigration(encrypted, links));
  assert.equal(preflightLedgerMigration(encrypted, links, { passphrase }).importAllowed, false);
  assert.throws(() => compareLedgerBackups([encrypted, encrypted]));
  const report = compareLedgerBackups([encrypted, encrypted], { passphrases: [passphrase, passphrase] });
  assert.equal(report.cleanComparison, true);
  assert.equal(report.mergePerformed, false);
  assert.equal(JSON.stringify(report).includes('Synthetic'), false);
});

test('offline CLI refuses v3 without an interactive terminal and never echoes the backup', async t => {
  const encrypted = await encryptBackupData(data, { passphrase });
  const dir = mkdtempSync(join(tmpdir(), 'apc-backup-v3-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const backup = join(dir, 'backup.json'), mapping = join(dir, 'links.json');
  writeFileSync(backup, JSON.stringify(encrypted));
  writeFileSync(mapping, JSON.stringify(links));
  const tool = new URL('../tools/ledger-migration-preflight.mjs', import.meta.url);
  const run = spawnSync(process.execPath, [tool.pathname, '--backup', backup, '--links', mapping], { encoding: 'utf8', timeout: 5000 });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr.includes(passphrase), false);
  assert.equal(run.stderr.includes('Synthetic'), false);
});
