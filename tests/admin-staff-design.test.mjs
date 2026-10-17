/* Admin Staff design — the staff list speaks Bengali end to end, each role
   tag carries its own tone, and protected / inactive cards are visibly
   different states instead of identical white boxes.

   Static guards on the shipped files (the management behaviour — create,
   edit, status, delete-with-history — lives in admin-staff-management):
     • the toolbar labels and the create action are Bengali, and the page
       explains itself under the title
     • card and More-menu actions are Bengali; "Staff ID", "Login User ID"
       and "Protected" stay, as tests and the login flow name them so
     • css/ui-wallet.css tones the role tags and separates the protected /
       inactive card states using foundation tokens only
     • avatars show two initials, matching the profile and overview avatars
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('the staff toolbar and create action speak Bengali under a subtitled title', () => {
  const html = read('admin.html');
  const view = html.slice(html.indexOf('data-view-panel="staff"'), html.indexOf('data-view-panel="system"'));
  assert.match(view, /class="staff-page-sub"/, 'the page says what lives here');
  assert.ok(view.includes('<p class="staff-filter-label">রোল</p>'), 'role filter is labelled in Bengali');
  assert.ok(view.includes('<p class="staff-filter-label">স্ট্যাটাস</p>'), 'status filter is labelled in Bengali');
  assert.ok(view.includes('id="staffSort"'), 'the staff list exposes a labelled sort control');
  assert.ok(view.includes('নতুন স্টাফ তৈরি করুন'), 'the create action says what it does');
  assert.doesNotMatch(view, /স্টাফ ক্রিয়েট|staff-filter-label">Role<|staff-filter-label">Status</, 'no leftover English/awkward labels');
});

test('staff card and More-menu actions are Bengali, identifiers untouched', () => {
  const js = read('js/staff-management.js');
  for (const label of ['দেখুন', 'সম্পাদনা', 'বিস্তারিত', 'কম দেখান', 'আরও', 'পাসওয়ার্ড রিসেট', 'নিষ্ক্রিয় করুন', 'সক্রিয় করুন', 'স্থগিত করুন', 'মুছে ফেলুন']) {
    assert.ok(js.includes(label), `action "${label}" is Bengali`);
  }
  assert.doesNotMatch(js, /<span>View<\/span>|<span>Edit<\/span>|<span>More<\/span>|<span>Reset Password<\/span>|<span>Suspend<\/span>|<span>Delete<\/span>/,
    'no English card actions remain');
  assert.match(js, /staff-card-details[^`]*\$\{detailsOpen \? '' : ' hidden'\}/,
    'secondary staff information is collapsed by default');
  assert.match(js, /aria-expanded="\$\{detailsOpen\}"/, 'the detail toggle exposes its state to assistive technology');
  assert.ok(js.includes('Staff ID:'), 'the permanent Staff ID label stays');
  assert.ok(js.includes('Protected'), 'the protected marker other suites look for stays');
  assert.match(js, /const initialsOf =/, 'avatars share the two-initial rule');
});

test('the card summary includes mobile, details include activity, and More actions live in a sheet', () => {
  const js = read('js/staff-management.js');
  const card = js.slice(js.indexOf('function staffCard(record)'), js.indexOf('function renderList()'));
  assert.match(card, /class="staff-card-summary-line"[\s\S]*?staff-id-badge[\s\S]*?staff-tag role-[\s\S]*?staff-card-mobile-summary[\s\S]*?className/,
    'summary carries Staff ID, role and mobile beside the name while status remains visible');
  assert.ok(card.includes("record.mobile || 'মোবাইল নেই'"), 'the collapsed summary states when a mobile number is missing');
  const detailsStart = card.indexOf('class="staff-card-details"');
  const actionsStart = card.indexOf('class="staff-card-actions"');
  assert.ok(detailsStart >= 0 && actionsStart > detailsStart, 'View/Edit/More render within the details disclosure');
  assert.ok(card.includes('class="staff-password-note"'), 'expanded details contain an explicit security note');
  assert.match(card, /পাসওয়ার্ড এখানে দেখানো হয় না|প্রথম লগইনে পাসওয়ার্ড বদল করতে হবে/,
    'no real password is rendered; the user is told how password protection works');
  assert.ok(card.includes('class="staff-recent-activity"'), 'expanded details include recent account activity');
  assert.ok(js.includes('record.history.slice(-2).reverse()'), 'recent activity comes from the record history');

  const actions = js.slice(js.indexOf('function staffMoreActionsHtml'), js.indexOf('function staffCard(record)'));
  assert.match(actions, /!record\.protected[\s\S]*?data-staff-action="delete"/,
    'protected System Owner does not get destructive status/delete actions');
  assert.match(js, /openModal\('স্টাফ অ্যাকশন',[\s\S]*?\{ sheet: true \}/,
    'More opens the existing shared modal in sheet mode');
  assert.ok(js.includes('restoreMoreTriggerFocus'), 'closing the sheet restores keyboard focus');
});

test('new staff creation is a real three-step wizard; edit remains a single save form', () => {
  const js = read('js/staff-management.js');
  const form = js.slice(js.indexOf('function staffFormHtml'), js.indexOf('function collectForm'));
  assert.ok(form.includes('data-staff-create-step="${step}"'), 'the step helper stamps each section with its state');
  for (const step of ['stepAttrs(1)', 'stepAttrs(2)', 'stepAttrs(3)']) assert.ok(form.includes(step), `${step} renders`);
  assert.ok(form.includes('data-staff-step-next') && form.includes('data-staff-step-back'), 'step navigation is explicit');
  assert.ok(form.includes('data-staff-create-footer'), 'submit appears only at the final step');
  assert.ok(js.includes('function validateCreateStep(form, step)'), 'each transition validates its own data');
  assert.ok(js.includes('function showCreateStep(form, requestedStep)'), 'step state updates are centralized');
  assert.match(js, /aria-current="step"/, 'the current step is announced to assistive technology');
  const css = read('css/ui-wallet.css');
  assert.ok(css.includes('.staff-create-progress {'), 'the progress indicator has dedicated styling');
  assert.ok(css.includes('.staff-step-actions .admin-btn {'), 'mobile step buttons keep usable tap targets');
});

test('the create/edit form buttons take the foot of the modal, never a squeezed column', () => {
  const js = read('js/staff-management.js');
  const form = js.slice(js.indexOf('function staffFormHtml'), js.indexOf('function collectForm'));
  assert.match(form, /class="staff-form-footer"/, 'the form ends in its own footer');
  assert.match(form, /\$\{editing \? 'তথ্য সংরক্ষণ করুন' : 'স্টাফ অ্যাকাউন্ট তৈরি করুন'\}/, 'the submit label stays');
  assert.match(form, /data-staff-modal="close">বাতিল</, 'the cancel label stays');

  const css = read('css/ui-wallet.css');
  assert.ok(css.includes('.staff-modal .staff-form-footer {'), 'the footer is restacked by the skin');
  assert.match(css, /\.staff-modal \.staff-form-footer \{\s*display: block; position: sticky;/,
    'the footer stacks and pins to the modal foot instead of joining the 2-col grid');
  const section = css.slice(css.indexOf('/* 27 ')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(section, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, 'footer colours belong in foundation.css');
});

test('the staff dialog scrolls only its body and its actions share the row half-and-half', () => {
  const css = read('css/ui-wallet.css');
  assert.ok(css.includes('.staff-modal { display: flex; flex-direction: column; overflow: hidden; }'),
    'the staff modal is a header-over-body column');
  assert.ok(css.includes('.staff-modal .admin-modal-body { overflow-y: auto; min-height: 0; }'),
    'only the body scrolls, so the title and close control stay put');
  assert.ok(css.includes('.staff-modal .staff-form-footer .modal-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }'),
    'সাবমিট and বাতিল share the full-width row half-and-half (owner choice 2026-10-14)');
  const section = css.slice(css.indexOf('/* 28 ')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(section, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, 'dialog colours belong in foundation.css');
});

test('the skin tones role tags and separates protected / inactive cards with tokens only', () => {
  const css = read('css/ui-wallet.css');
  for (const role of ['admin', 'manager', 'teacher', 'cash-counter']) {
    assert.ok(css.includes(`.staff-tag.role-${role} {`), `role tag "${role}" is toned`);
  }
  assert.ok(css.includes('.staff-card.is-protected {'), 'protected cards are marked');
  assert.ok(css.includes('.staff-card.is-inactive {'), 'inactive cards recede');
  assert.ok(css.includes('.staff-modal.is-more-sheet .staff-more-item.danger {'), 'the delete row reads as danger inside its sheet');
  assert.ok(css.includes('.staff-modal-backdrop.is-more-sheet .staff-modal {'), 'More is anchored as a bottom sheet');
  assert.ok(css.includes('.staff-recent-activity-list {'), 'recent activity is styled as a readable event list');
  const section = css.slice(css.indexOf('/* 21 ')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(section, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, 'staff colours belong in foundation.css');
});
