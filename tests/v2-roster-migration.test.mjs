/* Tests for the legacy roster → V2 migration helper
   (functions/v2-roster-migration.js). Roster re-keying is a privacy boundary:
   a student matched to the wrong account would inherit another student's
   records, so the helper may only PROPOSE matches by mobile; applying a match
   is always an explicit Admin decision verified server-side. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeMobile,
  legacyStudentRows,
  mobileProposals,
  v2StudentRecord
} = require('../functions/v2-roster-migration.js');

const LEGACY = {
  'STU-1': { id: 'STU-1', name: 'রাহিম', mobile: '01712-345 678', guardianMobile: '০১৮১২৩৪৫৬৭৯', className: 'দশম শ্রেণি', group: 'বিজ্ঞান' },
  'STU-2': { id: 'STU-2', name: 'করিম', mobile: '+8801912345678', className: 'নবম শ্রেণি', group: '' },
  'STU-3': { id: 'STU-3', name: 'জামিল', mobile: '', className: '', group: '' },
  '../evil': { id: '../evil', name: ' forged', mobile: '01700000000', className: 'X' },
  'STU-4': { name: 'id less row', mobile: '01711111111', className: 'অষ্টম শ্রেণি' }
};
const ACCOUNTS = [
  { uid: 'uid-rahim', username: 'rahim', fullName: 'রাহিম উদ্দিন', mobile: '01712345678', status: 'approved', role: 'student' },
  { uid: 'uid-guardian', username: 'g1', fullName: 'অভিভাবক', mobile: '01812345679', status: 'pending', role: 'student' },
  { uid: 'uid-karim', username: 'karim', fullName: 'করিম', mobile: '01912345678', status: 'approved', role: 'student' },
  { uid: '../bad', username: 'bad', fullName: 'x', mobile: '01999999999', status: 'approved', role: 'student' }
];

test('normalizeMobile folds Bengali digits, separators and +880 prefixes', () => {
  assert.equal(normalizeMobile('01712-345 678'), '01712345678');
  assert.equal(normalizeMobile('০১৮১২৩৪৫৬৭৯'), '01812345679');
  assert.equal(normalizeMobile('+8801912345678'), '01912345678');
  assert.equal(normalizeMobile('8801912345678'), '01912345678');
  assert.equal(normalizeMobile(''), '');
});

test('legacyStudentRows keeps only safe, id-consistent rows', () => {
  const keys = legacyStudentRows(LEGACY).map(([key]) => key).sort();
  assert.deepEqual(keys, ['STU-1', 'STU-2', 'STU-3', 'STU-4']);
  assert.deepEqual(legacyStudentRows(null), []);
  assert.deepEqual(legacyStudentRows([1, 2]), []);
});

test('mobileProposals matches own and guardian mobiles, never unsafe uids', () => {
  const proposals = mobileProposals(LEGACY, ACCOUNTS);
  const byId = new Map(proposals.map(item => [item.studentId, item]));
  assert.deepEqual(byId.get('STU-1').candidates.map(candidate => candidate.uid).sort(), ['uid-guardian', 'uid-rahim']);
  assert.equal(byId.get('STU-2').candidates[0].uid, 'uid-karim', '+880 mobile still matches');
  assert.deepEqual(byId.get('STU-3').candidates, [], 'no mobile → no proposal');
  assert.equal(byId.has('../evil'), false, 'unsafe record keys never reach proposals');
  for (const item of proposals) {
    for (const candidate of item.candidates) assert.notEqual(candidate.uid, '../bad');
  }
});

test('v2StudentRecord re-keys under the uid and keeps provenance', () => {
  const record = v2StudentRecord(LEGACY['STU-1'], { uid: 'uid-rahim', accountStatus: 'approved', now: 123 });
  assert.equal(record.id, 'uid-rahim', 'the V2 row id is the uid, not the legacy id');
  assert.equal(record.legacyStudentId, 'STU-1');
  assert.equal(record.className, 'দশম শ্রেণি');
  assert.equal(record.group, 'বিজ্ঞান');
  assert.equal(record.mobile, '01712345678');
  assert.equal(record.status, 'approved');
  assert.equal(record.migratedFromLegacy, true);
  assert.equal(record.migratedAt, 123);
});

test('v2StudentRecord fails closed on unsafe or unverified input', () => {
  assert.throws(() => v2StudentRecord(LEGACY['STU-1'], { uid: '../evil', accountStatus: 'approved' }));
  assert.throws(() => v2StudentRecord(null, { uid: 'uid-1', accountStatus: 'approved' }));
  assert.throws(() => v2StudentRecord(LEGACY['STU-1'], { uid: 'uid-1', accountStatus: 'active' }), /student status/);
  assert.throws(() => v2StudentRecord(LEGACY['STU-1'], { uid: 'uid-1', accountStatus: '' }));
  assert.throws(() => v2StudentRecord(LEGACY['STU-3'], { uid: 'uid-1', accountStatus: 'approved' }), /no class/);
});

test('a pending account migrates as pending, staying out of the practice lane', () => {
  const record = v2StudentRecord(LEGACY['STU-2'], { uid: 'uid-2', accountStatus: 'pending' });
  assert.equal(record.status, 'pending');
});
