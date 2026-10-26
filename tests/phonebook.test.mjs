import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import { ROSTER_KEY } from '../js/office-data.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
import {
  normalizeBdPhone,
  buildTelHref,
  buildWhatsappUrl,
  buildPhonebookDraftText,
  groupStudentsForYellowPages,
  countDirectoryPhones
} from '../js/phonebook.js';

test('normalizeBdPhone, buildTelHref and buildWhatsappUrl validate Bangla/ASCII numbers and block unsafe input', () => {
  const normBn = normalizeBdPhone('০১৭১২-৩৪৫৬৭৮');
  assert.equal(normBn.valid, true);
  assert.equal(normBn.local, '01712345678');
  assert.equal(normBn.e164, '+8801712345678');
  assert.equal(normBn.waDigits, '8801712345678');
  assert.equal(normBn.formattedBn, '০১৭১২-৩৪৫৬৭৮');

  const normIntl = normalizeBdPhone('+880 1819 998877');
  assert.equal(normIntl.valid, true);
  assert.equal(normIntl.local, '01819998877');
  assert.equal(buildTelHref('+880 1819 998877'), 'tel:+8801819998877');
  assert.equal(buildWhatsappUrl('01819998877'), 'https://wa.me/8801819998877');
  assert.match(buildWhatsappUrl('01819998877', 'আসসালামু আলাইকুম'), /^https:\/\/wa\.me\/8801819998877\?text=/);

  // Rejects invalid / unsafe input
  for (const bad of ['', '12345', 'javascript:alert(1)', '01212345678', '+12025550123']) {
    assert.equal(normalizeBdPhone(bad).valid, false, `must reject ${bad}`);
    assert.equal(buildTelHref(bad), '');
    assert.equal(buildWhatsappUrl(bad, 'হ্যালো'), '');
  }
});

test('buildPhonebookDraftText crafts distinct Bengali templates for guardian, student and staff', () => {
  const guardianDue = buildPhonebookDraftText('due', {
    recipientKind: 'guardian',
    name: 'রাইসা ইসলাম',
    className: 'দশম শ্রেণি',
    group: 'বিজ্ঞান',
    dueAmount: 1500,
    dueMonth: 'অক্টোবর ২০২৬'
  });
  assert.match(guardianDue, /আপনার সন্তান রাইসা ইসলাম \(দশম শ্রেণি · বিজ্ঞান\)/);
  assert.match(guardianDue, /৳১,৫০০/);
  assert.match(guardianDue, /অক্টোবর ২০২৬/);

  const studentAbsence = buildPhonebookDraftText('absence', {
    recipientKind: 'student',
    name: 'তানভীর আহমেদ',
    className: 'নবম শ্রেণি'
  });
  assert.match(studentAbsence, /তানভীর আহমেদ/);
  assert.match(studentAbsence, /নির্ধারিত ক্লাসে উপস্থিত ছিলে না/);

  const staffCoord = buildPhonebookDraftText('class_coord', {
    recipientKind: 'staff',
    name: 'মাহমুদ হাসান',
    roleLabel: 'শিক্ষক'
  });
  assert.match(staffCoord, /মাহমুদ হাসান \(শিক্ষক\)/);
  assert.match(staffCoord, /ক্লাস ও রুটিন সমন্বয়ের/);

  assert.equal(buildPhonebookDraftText('direct', { recipientKind: 'guardian', name: 'রাইসা' }), '');
});

test('groupStudentsForYellowPages orders classes canonically and searches Bangla/English digits & guardian names', () => {
  const sample = [
    { id: 'AP-1002', name: 'সাদিয়া আক্তার', fatherName: 'কামরুল হাসান', className: 'দশম শ্রেণি', group: 'বিজ্ঞান', mobile: '01711000002', guardianMobile: '01811000002', status: 'approved' },
    { id: 'AP-1001', name: 'আরিফ রহমান', fatherName: 'রফিকুল ইসলাম', className: 'অষ্টম শ্রেণি', group: 'A', mobile: '01711000001', guardianMobile: '01911000001', status: 'approved' },
    { id: 'AP-1003', name: 'নাবিল করিম', fatherName: 'আব্দুল করিম', className: 'নবম শ্রেণি', group: 'মানবিক', mobile: '01611000003', guardianMobile: '01511000003', status: 'pending' },
    { id: 'AP-1004', name: 'বাতিল আবেদন', className: 'অষ্টম শ্রেণি', mobile: '01799999999', status: 'rejected' }
  ];

  const all = groupStudentsForYellowPages(sample);
  assert.equal(all.totalMatched, 3, 'rejected applications stay out of Yellow Pages');
  assert.deepEqual(all.groups.map(g => g.className), ['অষ্টম শ্রেণি', 'নবম শ্রেণি', 'দশম শ্রেণি']);

  // Search by Bangla digits of guardian mobile
  const byBnPhone = groupStudentsForYellowPages(sample, { query: '০১৮১১০০০০০২' });
  assert.equal(byBnPhone.totalMatched, 1);
  assert.equal(byBnPhone.groups[0].students[0].id, 'AP-1002');

  // Search by father/guardian name
  const byFather = groupStudentsForYellowPages(sample, { query: 'রফিকুল' });
  assert.equal(byFather.totalMatched, 1);
  assert.equal(byFather.groups[0].students[0].id, 'AP-1001');

  // Filter by class + status
  const pendingOnly = groupStudentsForYellowPages(sample, { statusFilter: 'pending' });
  assert.equal(pendingOnly.totalMatched, 1);
  assert.equal(pendingOnly.groups[0].className, 'নবম শ্রেণি');

  const counts = countDirectoryPhones(sample, [{ fullName: 'টিচার ১', mobile: '01755667788', status: 'active' }]);
  assert.equal(counts.studentPhoneCount, 6);
  assert.equal(counts.staffPhoneCount, 1);
});

test('Admin Panel Phonebook (#phonebook) mounts Yellow Pages class groups, staff tab, tel: links and WhatsApp draft composer', async () => {
  const roster = [
    { id: 'AP-201', name: 'রাইসা ইসলাম', fatherName: 'শফিকুল ইসলাম', className: 'দশম শ্রেণি', group: 'বিজ্ঞান', mobile: '01712345678', guardianMobile: '01812345679', status: 'approved', monthlyFee: 2000 },
    { id: 'AP-202', name: 'তানভীর হাসান', fatherName: 'জাহাঙ্গীর আলম', className: 'অষ্টম শ্রেণি', group: 'A', mobile: '01911223344', guardianMobile: '01911223344', status: 'pending' }
  ];
  const ctx = await loadPage('admin.html', {
    seed: {
      'activePlus.demo.autofill.v1': 'off',
      [ROSTER_KEY]: JSON.stringify(roster),
      [STAFF_ACCOUNTS.teacher.accountKey]: JSON.stringify({
        role: 'teacher',
        username: 'teacher.apc',
        fullName: 'মাহমুদ স্যার',
        mobile: '01677889900',
        status: 'active'
      })
    }
  });
  const openedUrls = [];
  ctx.window.open = (url, target, features) => {
    openedUrls.push({ url, target, features });
    return { opener: null };
  };

  await provisionStaff('admin');
  seedStaffSession(ctx.window, 'admin');
  await import('../js/admin.js');
  await ctx.waitFor(() => ctx.$('#adminShell').hidden === false);

  assert.equal(ctx.$('.admin-view[data-view-panel="dashboard"] .phonebook-hub-card'), null,
    'Home does not duplicate the Phonebook shortcut');
  ctx.click(ctx.$('.admin-bottom [data-admin-view="more"]'));
  const hubCard = ctx.$('.admin-view[data-view-panel="more"] [data-admin-view="phonebook"]');
  assert.ok(hubCard, 'Yellow Pages Phonebook remains available from More');
  ctx.click(hubCard);

  await ctx.waitFor(() => ctx.$('.admin-view.active')?.dataset.viewPanel === 'phonebook');
  await ctx.waitFor(() => ctx.$$('#adminPhonebookMount [data-yp-student-card]').length === 2);

  const mount = ctx.$('#adminPhonebookMount');
  const sections = [...mount.querySelectorAll('[data-yp-class-section]')].map(s => s.dataset.ypClassSection);
  assert.deepEqual(sections, ['অষ্টম শ্রেণি', 'দশম শ্রেণি']);

  // Verify tel: link & direct WhatsApp on Guardian row
  const raisaCard = mount.querySelector('[data-yp-student-card="AP-201"]');
  const guardianRow = raisaCard.querySelector('[data-yp-contact-key="student:AP-201:guardian"]');
  assert.equal(guardianRow.querySelector('a.yp-action-btn.is-call').getAttribute('href'), 'tel:+8801812345679');

  ctx.click(guardianRow.querySelector('[data-yp-action="wa-direct"]'));
  assert.equal(openedUrls.at(-1)?.url, 'https://wa.me/8801812345679');
  assert.equal(openedUrls.at(-1)?.features, 'noopener,noreferrer');

  // Open Bengali WhatsApp Draft Composer and switch to Due Fee template
  ctx.click(guardianRow.querySelector('[data-yp-action="toggle-draft"]'));
  await ctx.waitFor(() => Boolean(mount.querySelector('[data-yp-draft-tray="student:AP-201:guardian"]')));
  ctx.click(mount.querySelector('[data-yp-template="due"]'));
  const textarea = mount.querySelector('[data-yp-draft-input="student:AP-201:guardian"]');
  assert.match(textarea.value, /রাইসা ইসলাম/);
  assert.match(textarea.value, /৳২,০০০/);

  ctx.click(mount.querySelector('[data-yp-action="send-draft"]'));
  assert.match(openedUrls.at(-1)?.url || '', /^https:\/\/wa\.me\/8801812345679\?text=/);
  assert.match(decodeURIComponent(openedUrls.at(-1).url), /৳২,০০০/);

  // Switch to Staff Directory tab
  ctx.click(mount.querySelector('[data-yp-tab="staff"]'));
  await ctx.waitFor(() => mount.querySelectorAll('[data-yp-staff-card]').length >= 1);
  assert.match(mount.textContent, /মাহমুদ স্যার/);
  assert.ok(mount.querySelector('a.yp-action-btn.is-call[href="tel:+8801677889900"]'));

  ctx.window.close();
});

test('Manager Panel Phonebook (#phonebook) opens from Home and More and filters by class & search', async () => {
  const roster = [
    { id: 'M-101', name: 'ফারহানা নূর', fatherName: 'নূরুল আমিন', className: 'একাদশ শ্রেণি', group: 'বিজ্ঞান', mobile: '01722334455', guardianMobile: '01822334455', status: 'approved', monthlyFee: 1800 },
    { id: 'M-102', name: 'সাকিব আল হাসান', fatherName: 'মাসুদ রানা', className: 'নবম শ্রেণি', group: 'ব্যবসায়', mobile: '01533445566', guardianMobile: '01633445566', status: 'approved', monthlyFee: 1500 }
  ];
  const ctx = await loadPage('manager.html', {
    seed: {
      [ROSTER_KEY]: JSON.stringify(roster),
      [STAFF_ACCOUNTS.teacher.accountKey]: JSON.stringify({
        role: 'teacher',
        username: 'teacher.apc',
        fullName: 'রাশেদ স্যার',
        mobile: '01788990011',
        status: 'active'
      })
    }
  });
  await provisionStaff('manager');
  seedStaffSession(ctx.window, 'manager');
  await import('../js/manager.js');
  await ctx.waitFor(() => ctx.$('#managerShell').hidden === false);

  ctx.click(ctx.$('.manager-view[data-view-panel="dashboard"] [data-manager-view="phonebook"]'));
  await ctx.waitFor(() => ctx.$('.manager-view.active')?.dataset.viewPanel === 'phonebook');
  await ctx.waitFor(() => ctx.$$('#managerPhonebookMount [data-yp-student-card]').length === 2);

  const mount = ctx.$('#managerPhonebookMount');
  // Class pill filter
  ctx.click(mount.querySelector('[data-yp-class="একাদশ শ্রেণি"]'));
  assert.equal(mount.querySelectorAll('[data-yp-student-card]').length, 1);
  assert.equal(mount.querySelector('[data-yp-student-card]').dataset.ypStudentCard, 'M-101');

  // Search filter reset
  ctx.click(mount.querySelector('[data-yp-class="all"]'));
  ctx.type(mount.querySelector('[data-yp-search]'), '০১৬৩৩৪৪৫৫৬৬');
  assert.equal(mount.querySelectorAll('[data-yp-student-card]').length, 1);
  assert.equal(mount.querySelector('[data-yp-student-card]').dataset.ypStudentCard, 'M-102');

  assert.deepEqual(ctx.jsdomErrors, []);
  ctx.window.close();
});
