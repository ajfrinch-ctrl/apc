/* A registration record is the source of truth for who applied; the roster row
   is only the projection the Admin/Manager list renders. When a row is missing
   (sample rows seeded by an old device, a roster write that never landed) the
   Admin panel rebuilds it from the registration record — additively. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { mergeAccountRecordsIntoRoster, accountToRosterStudent, quarantineShippedSampleRows, SAMPLE_ROW_BACKUP_KEY } from '../js/office-data.js';
import { KEYS } from '../js/database.js';

const account = (overrides = {}) => ({
  username: 'jahin',
  status: 'approved',
  registrationMobile: '01711111111',
  createdAt: '2026-10-30T13:00:25.932Z',
  student: {
    id: '261030001',
    name: 'নতুন শিক্ষার্থী',
    className: 'দশম শ্রেণি',
    group: 'বিজ্ঞান',
    studentMobile: '01711111111'
  },
  ...overrides
});

test('a registration without its roster row is restored instead of staying invisible', async () => {
  const ctx = await loadPage('admin.html', { seed: { [KEYS.students]: '[]' } });
  const outcome = mergeAccountRecordsIntoRoster([account()]);
  assert.equal(outcome.added, 1);
  const roster = JSON.parse(ctx.window.localStorage.getItem(KEYS.students));
  assert.equal(roster.length, 1);
  assert.equal(roster[0].id, '261030001');
  assert.equal(roster[0].name, 'নতুন শিক্ষার্থী');
  assert.equal(roster[0].status, 'approved');
  assert.equal(roster[0].username, 'jahin');
});

test('an existing reviewed roster row keeps its decision, edits and contact details', async () => {
  const reviewed = {
    id: '261030001',
    username: 'jahin',
    name: 'নতুন শিক্ষার্থী',
    className: 'দশম শ্রেণি',
    mobile: '01999999999',
    status: 'pending',
    reviewNote: '',
    reviewedBy: 'admin'
  };
  const ctx = await loadPage('admin.html', { seed: { [KEYS.students]: JSON.stringify([reviewed]) } });
  const outcome = mergeAccountRecordsIntoRoster([account()]);
  const roster = JSON.parse(ctx.window.localStorage.getItem(KEYS.students));
  assert.equal(roster.length, 1, 'no duplicate row');
  assert.equal(roster[0].reviewedBy, 'admin', 'review history kept');
  assert.equal(roster[0].mobile, '01999999999', 'locally corrected contact kept');
  assert.equal(outcome.added, 0);
});

test('rows the registration records do not mention are never deleted', async () => {
  const other = { id: '260810021', name: 'পুরনো শিক্ষার্থী', className: 'নবম শ্রেণি', status: 'approved' };
  const ctx = await loadPage('admin.html', { seed: { [KEYS.students]: JSON.stringify([other]) } });
  mergeAccountRecordsIntoRoster([account()]);
  const roster = JSON.parse(ctx.window.localStorage.getItem(KEYS.students));
  assert.deepEqual(roster.map(row => row.id).sort(), ['260810021', '261030001']);
  assert.ok(ctx.window.localStorage.getItem(KEYS.students));
});

test('an account record without a student id is ignored rather than guessed', () => {
  assert.equal(accountToRosterStudent({ username: 'ghost', status: 'approved', student: {} }), null);
  const outcome = mergeAccountRecordsIntoRoster([{ username: 'ghost', status: 'approved', student: {} }]);
  assert.equal(outcome.added, 0);
});

/* The sample roster shipped in the code is fixture data; when it reaches the
   shared list it must be backed up on the device and removed, without touching
   a real student who merely reuses an identifier. */
test('a shipped sample row is backed up on the device and removed from the list', async () => {
  const sample = {
    id: '260810021', name: 'তহমিদ হাসান', mobile: '01811223344', className: 'দশম শ্রেণি', status: 'approved'
  };
  const ctx = await loadPage('admin.html', { seed: { [KEYS.students]: JSON.stringify([sample]) } });
  const outcome = quarantineShippedSampleRows();
  assert.equal(outcome.removed, 1);
  assert.deepEqual(JSON.parse(ctx.window.localStorage.getItem(KEYS.students)), []);
  const backup = JSON.parse(ctx.window.localStorage.getItem(SAMPLE_ROW_BACKUP_KEY));
  assert.equal(backup[0].rows[0].id, '260810021', 'removal is reversible from this device');
});

test('a real student who only reuses a sample identifier is untouched', async () => {
  const real = {
    id: '260810021', name: 'আসল শিক্ষার্থী', mobile: '01712345678', className: 'দশম শ্রেণি', status: 'approved'
  };
  const ctx = await loadPage('admin.html', { seed: { [KEYS.students]: JSON.stringify([real]) } });
  assert.equal(quarantineShippedSampleRows().removed, 0);
  assert.equal(JSON.parse(ctx.window.localStorage.getItem(KEYS.students)).length, 1);
  assert.equal(ctx.window.localStorage.getItem(SAMPLE_ROW_BACKUP_KEY), null);
});

test('the sample fingerprints stay identical to the design fixture they guard', async () => {
  const [{ SHIPPED_SAMPLE_ROSTER }, { adminStudents }] = await Promise.all([
    import('../js/sample-roster-signatures.js'),
    import('../js/admin-data.js')
  ]);
  const shipped = SHIPPED_SAMPLE_ROSTER.map(row => `${row.id}|${row.name}|${row.mobile}`).sort();
  const fixture = adminStudents.map(row => `${row.id}|${row.name}|${row.mobile}`).sort();
  assert.deepEqual(shipped, fixture);
});
