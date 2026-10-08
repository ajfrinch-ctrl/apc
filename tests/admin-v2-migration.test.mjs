/* Admin panel — V2 staged-cutover migration console.
   Covers the permission wiring (system hub card, hash route, seat) on the
   real admin.html + js/admin.js, and every console flow through an injected
   fake callable, so the UI is verified without Firebase. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { adminStudents } from '../js/admin-data.js';
import { ROSTER_KEY } from '../js/office-data.js';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/* ------------------------- unit flows (fake callable) ------------------- */

test('the console renders both tools and mounts only once per call', async () => {
  const ctx = await loadPage('admin.html');
  const { mountV2Migration } = await import('../js/admin-migration.js');
  const result = mountV2Migration({ mount: '#adminV2Migration', call: async () => ({}) });
  assert.equal(result.ok, true);
  assert.equal(ctx.$$('#adminV2Migration .v2-migration-card').length, 2, 'teacher + student cards');
  assert.equal(mountV2Migration({ mount: '#doesNotExist' }).ok, false);
});

test('teacher dry-run lists legacy usernames and writes nothing', async () => {
  const ctx = await loadPage('admin.html');
  const { mountV2Migration } = await import('../js/admin-migration.js');
  const calls = [];
  const call = async (name, data) => {
    calls.push([name, data]);
    return { ok: true, preview: true, usernames: ['rafiq', 'salma'], totalRows: 5 };
  };
  mountV2Migration({ mount: '#adminV2Migration', call });
  const card = ctx.$$('.v2-migration-card')[0];
  card.querySelector('button').click();
  await tick();
  assert.deepEqual(calls, [['adminProvisionV2Identities', {}]], 'dry-run passes no arguments');
  const items = [...ctx.$$('.v2-migration-card .v2-migration-list li')].map(li => li.textContent);
  assert.deepEqual(items, ['rafiq', 'salma']);
  assert.match(ctx.$$('.v2-migration-card [role="status"]')[0].textContent, /কিছু লেখা হয়নি/);
});

test('teacher verify enables apply only for migrated rows, and apply carries applyAssignments', async () => {
  const ctx = await loadPage('admin.html');
  const { mountV2Migration } = await import('../js/admin-migration.js');
  const calls = [];
  const call = async (name, data) => {
    calls.push([name, data]);
    if (data.username && !data.applyAssignments) {
      return {
        ok: true, username: data.username,
        linkedClaims: { role: 'teacher', status: 'active', teacherId: `uid-${data.username}` },
        assignments: [{ id: 'TAS-1' }],
        unresolved: [{ id: 'TAS-9', reason: 'teacher-not-active' }]
      };
    }
    return { ok: true, username: data.username, assignments: [{ id: 'TAS-1' }], unresolved: [] };
  };
  mountV2Migration({ mount: '#adminV2Migration', call });
  const card = ctx.$$('.v2-migration-card')[0];
  const input = card.querySelector('input');
  const buttons = [...card.querySelectorAll('button')];
  const verify = buttons.find(button => button.textContent.includes('যাচাই'));
  const apply = buttons.find(button => button.textContent.includes('প্রয়োগ'));
  assert.equal(apply.disabled, true, 'apply starts locked');

  input.value = '  Rafiq ';
  verify.click();
  await tick();
  assert.deepEqual(calls.at(-1), ['adminProvisionV2Identities', { username: 'rafiq' }], 'username is normalized before the call');
  assert.match(card.textContent, /teacherId=uid-rafiq/);
  assert.match(card.textContent, /অ্যাকাউন্ট সক্রিয় নয়/, 'unresolved reasons are translated');
  assert.equal(apply.disabled, false);

  apply.click();
  await tick();
  assert.deepEqual(calls.at(-1), ['adminProvisionV2Identities', { username: 'rafiq', applyAssignments: true }]);
  assert.match(card.querySelector('[role="status"]').textContent, /প্রয়োগ সম্পন্ন/);
});

test('a failed teacher verify never unlocks apply', async () => {
  const ctx = await loadPage('admin.html');
  const { mountV2Migration } = await import('../js/admin-migration.js');
  const call = async (name, data) => {
    if (data.applyAssignments) throw new Error('must never apply');
    throw Object.assign(new Error('শুধু সক্রিয় Teacher অ্যাকাউন্ট লিংক করা যায়।'), { code: 'failed-precondition' });
  };
  mountV2Migration({ mount: '#adminV2Migration', call });
  const card = ctx.$$('.v2-migration-card')[0];
  card.querySelector('input').value = 'ghost';
  [...card.querySelectorAll('button')].find(button => button.textContent.includes('যাচাই')).click();
  await tick();
  const apply = [...card.querySelectorAll('button')].find(button => button.textContent.includes('প্রয়োগ'));
  assert.equal(apply.disabled, true);
  assert.match(card.querySelector('[role="status"]').textContent, /যাচাই ব্যর্থ/);
});

test('student proposals require an explicit select → validate → apply sequence', async () => {
  const ctx = await loadPage('admin.html');
  const { mountV2Migration } = await import('../js/admin-migration.js');
  const calls = [];
  const call = async (name, data) => {
    calls.push([name, data]);
    if (data.preview) {
      return {
        ok: true, preview: true,
        proposals: [{
          studentId: 'STU-1', name: 'রাহিম', className: 'দশম শ্রেণি', group: 'বিজ্ঞান', mobile: '01712345678',
          candidates: [{ uid: 'uid-rahim', username: 'rahim', status: 'approved' }]
        }]
      };
    }
    if (!data.apply) return { ok: true, proposed: { id: data.uid, name: 'রাহিম', className: 'দশম শ্রেণি', group: 'বিজ্ঞান', status: 'approved' } };
    return { ok: true, applied: true };
  };
  mountV2Migration({ mount: '#adminV2Migration', call });
  const card = ctx.$$('.v2-migration-card')[1];
  const buttons = () => [...card.querySelectorAll('button')];
  const preview = buttons().find(button => button.textContent.includes('প্রস্তাব'));
  preview.click();
  await tick();
  assert.deepEqual(calls.at(-1), ['adminMigrateStudentToV2', { preview: true }]);
  const select = card.querySelector('select');
  assert.equal(select.options[0].textContent, '— বাছুন —', 'the placeholder option carries no uid');
  assert.equal(select.options[0].value, '', 'the placeholder value is empty, never its label');
  assert.deepEqual([...select.options].slice(1).map(option => option.value), ['uid-rahim']);
  const validate = buttons().find(button => button.textContent.includes('ভ্যালিডেট'));
  const apply = buttons().find(button => button.textContent.includes('প্রয়োগ'));
  assert.equal(validate.disabled, true, 'validate waits for a selection');
  assert.equal(apply.disabled, true, 'apply waits for validation');

  select.value = 'uid-rahim';
  select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(validate.disabled, false);
  validate.click();
  await tick();
  assert.deepEqual(calls.at(-1), ['adminMigrateStudentToV2', { studentId: 'STU-1', uid: 'uid-rahim' }]);
  assert.equal(apply.disabled, false);
  apply.click();
  await tick();
  assert.deepEqual(calls.at(-1), ['adminMigrateStudentToV2', { studentId: 'STU-1', uid: 'uid-rahim', apply: true }]);
  assert.match(card.querySelector('[role="status"]').textContent, /মাইগ্রেশন সম্পন্ন/);
});

/* --------------------- permission wiring on the real shell ---------------- */

test('the migration console lives in the সিস্টেম hub, opens by hash, and keeps the system seat lit', async () => {
  const ctx = await loadPage('admin.html', {
    seed: { 'activePlus.demo.autofill.v1': 'off', [ROSTER_KEY]: JSON.stringify(adminStudents) }
  });
  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);

  // The hub card is rendered for Admin and carries its capability.
  await ctx.waitFor(() => Boolean(ctx.$('#adminSystemMenu [data-admin-view="migration"]')));
  const card = ctx.$('#adminSystemMenu [data-admin-view="migration"]');
  assert.ok(card, 'the migration card is missing from the system hub');
  assert.equal(card.dataset.adminCap, 'security.manage');
  assert.match(card.textContent, /মাইগ্রেশন/);

  // The hash route opens the view and the সিস্টেম seat stays active.
  ctx.window.location.hash = '#migration';
  await ctx.waitFor(() => ctx.$('.admin-view[data-view-panel="migration"]').classList.contains('active'));
  assert.equal(ctx.$('.admin-bottom [aria-current="page"]').dataset.adminView, 'system');

  // The console mounted inside the view with both tools (renderAll may lag a
  // beat behind the navigation, so wait for the mount itself).
  await ctx.waitFor(() => ctx.$$('#adminV2Migration .v2-migration-card').length === 2);
  assert.equal(ctx.$$('#adminV2Migration .v2-migration-card').length, 2);
  ctx.window.location.hash = '';
});
