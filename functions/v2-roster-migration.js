'use strict';

/* Roster migration helpers for the staged V2 cutover.
 *
 * The legacy bridge stores roster rows under their own local record ids
 * (`activePlusSync/v1/students/{recordId}`) with no link to any Firebase Auth
 * account. V2 addresses a student's own paths by claim
 * (`studentQuestionBank/{studentId}`, studentId === Auth uid), so each legacy
 * row must be EXPLICITLY re-keyed under the matching account's uid by an
 * Admin decision — a wrong match is a privacy breach, so nothing here
 * auto-links on mobile alone. Mobile numbers only produce *proposals*. */

const SAFE_KEY = /^[A-Za-z0-9_-]{1,128}$/;
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const safeKey = value => typeof value === 'string' && SAFE_KEY.test(value);
const cleanText = (value, max = 200) => String(value ?? '').normalize('NFC').trim().slice(0, max);

/* Same normalization as the server-side phone handling: Bengali digits,
 * spaces/parentheses stripped, +880/880 prefixes folded to the local form. */
function normalizeMobile(value) {
  let mobile = String(value ?? '').trim().replace(/[০-৯]/g, digit => '০১২৩৪৫৬৭৮৯'.indexOf(digit));
  mobile = mobile.replace(/[\s()+-]/g, '');
  if (mobile.startsWith('+880')) mobile = `0${mobile.slice(4)}`;
  else if (mobile.startsWith('880')) mobile = `0${mobile.slice(3)}`;
  return mobile;
}

function legacyStudentRows(legacyValue) {
  const rows = object(legacyValue) ? Object.entries(legacyValue) : [];
  return rows.filter(([key, row]) => safeKey(key) && object(row) && (!row.id || String(row.id) === key));
}

/**
 * Proposal index for the dry-run preview: legacy row id -> candidate accounts
 * whose Firestore profile mobile (or the legacy row's guardian mobile) matches
 * after normalization. Proposals only — an Admin must confirm each one.
 */
function mobileProposals(legacyValue, accounts = []) {
  const byMobile = new Map();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (!account || !safeKey(account.uid)) continue;
    const mobile = normalizeMobile(account.mobile);
    if (!mobile) continue;
    if (!byMobile.has(mobile)) byMobile.set(mobile, []);
    byMobile.get(mobile).push({ uid: account.uid, username: cleanText(account.username, 32), fullName: cleanText(account.fullName, 100), status: cleanText(account.status, 20) });
  }
  const proposals = [];
  for (const [recordId, row] of legacyStudentRows(legacyValue)) {
    const mobiles = [...new Set([normalizeMobile(row.mobile), normalizeMobile(row.guardianMobile)].filter(Boolean))];
    const candidates = [...new Map(mobiles.flatMap(mobile => byMobile.get(mobile) || []).map(entry => [entry.uid, entry])).values()];
    proposals.push({ studentId: recordId, name: cleanText(row.name, 100), className: cleanText(row.className, 80), group: cleanText(row.group, 80), mobile: mobiles[0] || '', candidates });
  }
  return proposals;
}

/**
 * Build the V2 roster row for one confirmed match. Fails closed unless every
 * side verifies: safe ids, a real legacy row, and an account status that the
 * caller already validated against Firestore/Auth. `id` becomes the uid so the
 * row satisfies the V2 key-binding rules; the legacy record id is preserved as
 * provenance, never lost.
 */
function v2StudentRecord(legacyRow, { uid, accountStatus, now = Date.now() } = {}) {
  if (!safeKey(uid)) throw new TypeError('unsafe uid');
  if (!object(legacyRow)) throw new TypeError('legacy student row missing');
  if (!['approved', 'pending', 'rejected'].includes(String(accountStatus || ''))) {
    throw new TypeError('account status must be a verified student status');
  }
  const className = cleanText(legacyRow.className, 80);
  if (!className) throw new TypeError('legacy student row has no class');
  const record = {
    id: uid,
    legacyStudentId: cleanText(legacyRow.id, 128),
    name: cleanText(legacyRow.name, 100),
    mobile: normalizeMobile(legacyRow.mobile),
    guardianMobile: normalizeMobile(legacyRow.guardianMobile),
    className,
    group: cleanText(legacyRow.group, 80),
    status: String(accountStatus),
    migratedFromLegacy: true,
    migratedAt: Number(now)
  };
  /* V2 projections gate on `status === 'approved'`; the legacy roster carried
   * no such field, so keep anything else out of the practice lane by default. */
  return record;
}

module.exports = {
  safeKey,
  normalizeMobile,
  legacyStudentRows,
  mobileProposals,
  v2StudentRecord
};
