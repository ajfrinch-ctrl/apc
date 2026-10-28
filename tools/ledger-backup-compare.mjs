#!/usr/bin/env node
/* Phase 12: compare TWO-FOUR Admin backup snapshots without merging. A missing
 * record is a coverage gap, never evidence of deletion or permission to union;
 * a changed record is a conflict, never a timestamp-based winner. No network,
 * credential lookup, Firebase SDK, localStorage, output file or data mutation. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { PreflightInputError, readLegacyBackupCollections, readPreflightInputFile } from './ledger-migration-preflight.mjs';
import { promptBackupPassphrase } from './backup-passphrase-prompt.mjs';
const require = createRequire(import.meta.url);
const { METHODS } = require('../functions/staged-payment-core.cjs');
const SAFE = /^[A-Za-z0-9_-]{1,128}$/;
const safe = value => typeof value === 'string' && SAFE.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (result, code) => { result[code] = (result[code] || 0) + 1; };
const invalid = () => { throw new PreflightInputError(); };
const MAX_SNAPSHOTS = 4;

function stable(value, depth = 0) {
  if (depth > 64) invalid();
  if (Array.isArray(value)) return value.map(item => stable(item, depth + 1));
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key], depth + 1)]));
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return value;
  invalid();
}
function indexRows(rows, kind, blockers) {
  const result = new Map();
  for (const row of rows) {
    if (!object(row) || !safe(row.id)) { count(blockers, `${kind}IdInvalid`); continue; }
    if (result.has(row.id)) { count(blockers, `${kind}IdDuplicateWithinBackup`); continue; }
    result.set(row.id, { row, fingerprint: JSON.stringify(stable(row)) });
  }
  return result;
}
function disagreements(indexes, kind, blockers) {
  const ids = new Set(indexes.flatMap(index => [...index.keys()]));
  for (const id of ids) {
    const copies = indexes.map(index => index.get(id)).filter(Boolean);
    if (copies.length !== indexes.length) count(blockers, `${kind}CoverageGap`);
    if (new Set(copies.map(copy => copy.fingerprint)).size > 1) count(blockers, `${kind}Conflict`);
  }
  return ids.size;
}

/** The returned shape has ONLY fixed count fields/codes; no file names, IDs,
 * receipts, names, phones, references, amounts or source timestamps. */
export function compareLedgerBackups(backups, { passphrases = [] } = {}) {
  if (!Array.isArray(backups) || backups.length < 2 || backups.length > MAX_SNAPSHOTS || !Array.isArray(passphrases)) invalid();
  const blockers = {}, studentIndexes = [], transactionIndexes = [];
  const receiptOwners = new Map(), referenceOwners = new Map();
  for (const [index, backup] of backups.entries()) {
    const { students, transactions } = readLegacyBackupCollections(backup, { passphrase: passphrases[index] || '' });
    // Timestamps are informational only. Never elect a winner from createdAt.
    const stamp = backup.createdAt;
    if (typeof stamp !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(stamp) ||
        !Number.isFinite(Date.parse(stamp)) ||
        new Date(stamp).toISOString().slice(0, 19) !== stamp.slice(0, 19))
      count(blockers, 'backupTimestampInvalid');
    const indexedStudents = indexRows(students, 'student', blockers);
    const indexedTransactions = indexRows(transactions, 'transaction', blockers);
    studentIndexes.push(indexedStudents);
    transactionIndexes.push(indexedTransactions);
    for (const [id, { row }] of indexedTransactions) {
      if (!safe(row.receiptNo)) count(blockers, 'receiptNumberInvalid');
      else {
        if (!receiptOwners.has(row.receiptNo)) receiptOwners.set(row.receiptNo, new Set());
        receiptOwners.get(row.receiptNo).add(id);
      }
      if (!METHODS.includes(row.method)) count(blockers, 'paymentMethodInvalid');
      else if (row.method !== 'নগদ (Cash)') {
        if (typeof row.trxRef !== 'string' || !/^[A-Za-z0-9._:/-]{1,120}$/.test(row.trxRef)) {
          count(blockers, 'processorReferenceInvalid');
        } else {
          const reference = `${row.method}\0${row.trxRef.toLowerCase()}`;
          if (!referenceOwners.has(reference)) referenceOwners.set(reference, new Set());
          referenceOwners.get(reference).add(id);
        }
      }
    }
  }
  const studentsDistinct = disagreements(studentIndexes, 'student', blockers);
  const transactionsDistinct = disagreements(transactionIndexes, 'transaction', blockers);
  for (const ids of receiptOwners.values()) if (ids.size > 1) count(blockers, 'receiptNumberCollision');
  for (const ids of referenceOwners.values()) if (ids.size > 1) count(blockers, 'processorReferenceCollision');
  const sorted = Object.fromEntries(Object.entries(blockers).sort(([a], [b]) => a.localeCompare(b)));
  const blockerTotal = Object.values(sorted).reduce((sum, n) => sum + n, 0);
  return Object.freeze({ kind: 'apc-ledger-backup-comparison', version: 1,
    counts: { backups: backups.length, studentsDistinct, transactionsDistinct },
    blockerTotal, blockers: sorted, cleanComparison: blockerTotal === 0,
    mergePerformed: false, importAllowed: false, sourceCompletenessVerified: false,
    outstanding: ['A missing row may be an unsynced write or a deletion; do not union automatically',
      'Resolve conflicts with source devices and signed financial/processor evidence',
      'Run the per-backup migration preflight and verify Auth UID links before any import plan'] });
}

async function main(args) {
  if (args.length < 4 || args.length > 2 * MAX_SNAPSHOTS || args.length % 2 !== 0 ||
      args.some((value, index) => index % 2 === 0 && value !== '--backup')) invalid();
  const backups = [];
  for (let index = 1; index < args.length; index += 2) backups.push(readPreflightInputFile(args[index]));
  const passphrases = [];
  for (const [index, backup] of backups.entries()) passphrases.push(await promptBackupPassphrase(backup, `Backup ${index + 1}`));
  const report = compareLedgerBackups(backups, { passphrases });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.cleanComparison ? 0 : 2;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write('Backup comparison input invalid or interactive passphrase unavailable; no data was merged or written.\n');
    process.exitCode = 1;
  });
}
