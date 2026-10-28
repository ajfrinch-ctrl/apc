#!/usr/bin/env node
/* Phase 11: OFFLINE, read-only inventory of a local Admin backup and an
 * operator-prepared legacy-ID -> Firebase-UID link file. No Firebase SDK,
 * database adapter, export writer, network request or ID auto-matching.
 * A clean report NEVER authorizes import: Auth ownership, deletion history,
 * reconciliation and emulator tests must still be done by an operator. */
import { readFileSync, statSync } from 'node:fs';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { BACKUP_PBKDF2_ITERATIONS as CURRENT_BACKUP_ITERATIONS, validBackupPassphrase, backupHeaderAdditionalData } from '../js/backup-crypto.js';
import { promptBackupPassphrase } from './backup-passphrase-prompt.mjs';
const require = createRequire(import.meta.url);
const { FEE_TYPES, METHODS, MONTHS } = require('../functions/staged-payment-core.cjs');

const BACKUP_SECRET = 'active-plus-backup-aes-256-gcm-v2-institutional-seal';
const BACKUP_PBKDF2_ITERATIONS = 100000;
const STUDENTS = 'activePlus.admin.students.v1';
const TRANSACTIONS = 'activePlus.admin.transactions.v1';
const SAFE = /^[A-Za-z0-9_-]{1,128}$/;
const MONTH = new RegExp(`^(?:${MONTHS.join('|')}) [০-৯]{4}$`);
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_ROWS = 100_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = value => typeof value === 'string' && SAFE.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const text = value => typeof value === 'string' && value === value.trim() && value.length > 0;
const money = value => Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000;
const count = (counts, key) => { counts[key] = (counts[key] || 0) + 1; };

export class PreflightInputError extends Error {
  constructor() { super('Invalid preflight input. Use an unmodified Admin backup and a reviewed link file.'); this.name = 'PreflightInputError'; }
}
const invalid = () => { throw new PreflightInputError(); };
export function decryptBackupDataSync(payload, { passphrase = '' } = {}) {
  if (!object(payload) || payload.kind !== 'active-plus-backup') invalid();
  if ([2, 3].includes(payload.version) && payload.encrypted === true) {
    if (typeof payload.salt !== 'string' || typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') invalid();
    if (payload.version === 3 && (!validBackupPassphrase(passphrase) ||
        payload.algorithm !== 'AES-256-GCM' || payload.kdf !== 'PBKDF2-SHA256' || payload.iterations !== CURRENT_BACKUP_ITERATIONS)) invalid();
    try {
      // Buffer.from(base64) is permissive; reject malformed/noncanonical input.
      const decode = text => {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) invalid();
        return Buffer.from(text, 'base64');
      };
      const salt = decode(payload.salt);
      const iv = decode(payload.iv);
      const raw = decode(payload.ciphertext);
      if (salt.length < 8 || (payload.version === 3 && salt.length !== 16) || iv.length !== 12 || raw.length <= 16) invalid();
      const key = pbkdf2Sync(payload.version === 3 ? passphrase : BACKUP_SECRET, salt,
        payload.version === 3 ? CURRENT_BACKUP_ITERATIONS : BACKUP_PBKDF2_ITERATIONS, 32, 'sha256');
      const tag = raw.subarray(raw.length - 16);
      const enc = raw.subarray(0, raw.length - 16);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      if (payload.version === 3) decipher.setAAD(backupHeaderAdditionalData(payload));
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
      const data = JSON.parse(plain);
      if (!object(data)) invalid();
      return data;
    } catch { invalid(); }
  }
  if (payload.version === 1 && object(payload.data)) return payload.data;
  invalid();
}
export function readLegacyBackupCollections(payload, options = {}) {
  const data = decryptBackupDataSync(payload, options);
  if (typeof data[STUDENTS] !== 'string' || typeof data[TRANSACTIONS] !== 'string') invalid();
  try {
    const students = JSON.parse(data[STUDENTS]);
    const transactions = JSON.parse(data[TRANSACTIONS]);
    if (!Array.isArray(students) || !Array.isArray(transactions) ||
        students.length > MAX_ROWS || transactions.length > MAX_ROWS) invalid();
    return { students, transactions };
  } catch { invalid(); }
}
function parseLinks(input) {
  if (!object(input) || input.kind !== 'apc-reviewed-student-links' || input.version !== 1 ||
      !Array.isArray(input.links) || input.links.length > MAX_ROWS) invalid();
  return input.links;
}

/** No identifiers or PII appear in the returned report, even on error. */
export function preflightLedgerMigration(backup, linksFile, options = {}) {
  const { students, transactions } = readLegacyBackupCollections(backup, options);
  const links = parseLinks(linksFile);
  const blockers = {}, studentIds = new Set(), linkById = new Map(), uids = new Set();
  const statuses = { pending: 0, approved: 0, rejected: 0, absent: 0, invalid: 0 };
  const transactionIds = new Set(), receipts = new Set(), references = new Set();

  for (const row of students) {
    if (!object(row) || !safeId(row.id)) { count(blockers, 'studentIdInvalid'); continue; }
    if (studentIds.has(row.id)) count(blockers, 'studentIdDuplicate');
    studentIds.add(row.id);
    if (!text(row.className) || row.className.length > 80) count(blockers, 'studentClassInvalid');
    if (row.monthlyFee == null || row.monthlyFee === '') count(blockers, 'monthlyFeeMissing');
    else if (!money(row.monthlyFee)) count(blockers, 'monthlyFeeInvalid');
  }
  for (const link of links) {
    if (!object(link) || Object.keys(link).some(key => !['legacyStudentId', 'uid'].includes(key)) ||
        !safeId(link.legacyStudentId) || !safeId(link.uid)) { count(blockers, 'mappingInvalid'); continue; }
    if (linkById.has(link.legacyStudentId)) count(blockers, 'mappingLegacyIdDuplicate');
    if (uids.has(link.uid)) count(blockers, 'mappingUidDuplicate');
    if (!studentIds.has(link.legacyStudentId)) count(blockers, 'mappingOrphan');
    linkById.set(link.legacyStudentId, link.uid);
    uids.add(link.uid);
  }
  for (const studentId of studentIds) if (!linkById.has(studentId)) count(blockers, 'mappingMissing');

  for (const row of transactions) {
    if (!object(row)) { count(blockers, 'transactionMalformed'); statuses.invalid++; continue; }
    if (!safeId(row.id)) count(blockers, 'transactionIdInvalid');
    else {
      if (transactionIds.has(row.id)) count(blockers, 'transactionIdDuplicate');
      transactionIds.add(row.id);
    }
    if (!safeId(row.studentId) || !studentIds.has(row.studentId)) count(blockers, 'transactionStudentOrphan');
    else if (!linkById.has(row.studentId)) count(blockers, 'transactionStudentUnmapped');
    if (!safeId(row.receiptNo)) count(blockers, 'receiptNumberMissingOrInvalid');
    else {
      if (receipts.has(row.receiptNo)) count(blockers, 'receiptNumberDuplicate');
      receipts.add(row.receiptNo);
    }
    if (!Number.isSafeInteger(row.amount) || row.amount <= 0 || row.amount > 10_000_000)
      count(blockers, 'amountRequiresReview'); // never auto-round or infer currency
    if (!FEE_TYPES.includes(row.feeType)) count(blockers, 'feeTypeInvalid');
    if (!MONTH.test(row.month || '')) count(blockers, 'monthInvalid');
    if (!METHODS.includes(row.method)) count(blockers, 'paymentMethodInvalid');
    if (row.method !== 'নগদ (Cash)' && METHODS.includes(row.method)) {
      if (typeof row.trxRef !== 'string' || !/^[A-Za-z0-9._:/-]{1,120}$/.test(row.trxRef))
        count(blockers, 'processorReferenceUnverified');
      else {
        const referenceKey = `${row.method}\0${row.trxRef.toLowerCase()}`;
        if (references.has(referenceKey)) count(blockers, 'processorReferenceDuplicate');
        references.add(referenceKey);
      }
    }
    if (row.status == null) { statuses.absent++; count(blockers, 'reviewStatusAbsent'); }
    else if (['pending', 'approved', 'rejected'].includes(row.status)) {
      statuses[row.status]++;
      if (row.status !== 'pending' && (!text(row.reviewedBy) || !Array.isArray(row.reviewHistory) || !row.reviewHistory.length))
        count(blockers, 'reviewAuditMissing');
    } else { statuses.invalid++; count(blockers, 'reviewStatusInvalid'); }
  }
  const sorted = Object.fromEntries(Object.entries(blockers).sort(([a], [b]) => a.localeCompare(b)));
  const blockerTotal = Object.values(sorted).reduce((sum, value) => sum + value, 0);
  return Object.freeze({ kind: 'apc-ledger-preflight-report', version: 1,
    counts: { students: students.length, transactions: transactions.length, submittedLinks: links.length,
      distinctStudentIds: studentIds.size, distinctTransactionIds: transactionIds.size, statuses },
    blockerTotal, blockers: sorted,
    cleanInventory: blockerTotal === 0,
    importAllowed: false, // Always false: this tool cannot attest Firebase Auth ownership or completeness.
    outstanding: ['Verify every mapping against real Auth/Firestore identity',
      'Reconcile receipt totals and processor/cash evidence with historical deletions',
      'Run dev emulator rules, role, concurrency and restore tests before planning import']
  });
}

export function readPreflightInputFile(path) {
  try {
    const file = statSync(path);
    if (!file.isFile() || file.size > MAX_FILE_BYTES) invalid();
    const bytes = readFileSync(path);
    if (bytes.byteLength > MAX_FILE_BYTES) invalid();
    return JSON.parse(bytes.toString('utf8'));
  } catch { invalid(); }
}
async function main(args) {
  if (args.length !== 4 || args[0] !== '--backup' || args[2] !== '--links') invalid();
  const backup = readPreflightInputFile(args[1]);
  const passphrase = await promptBackupPassphrase(backup);
  const report = preflightLedgerMigration(backup, readPreflightInputFile(args[3]), { passphrase });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.cleanInventory ? 0 : 2;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write('Preflight input invalid or interactive passphrase unavailable; no data was written or imported.\n');
    process.exitCode = 1;
  });
}
