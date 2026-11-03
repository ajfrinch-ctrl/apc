/* আটটি চার-প্যানেল নিয়ম, এক জায়গায় যাচাই করা হয় — আচরণ নয়, চুক্তি।

   মালিক-নির্দেশ ২০২৬-১১-০২ (ধাপ C ও D):
     ১. `data-panel-entry` — নোটিশ · লেকচার · চ্যাট · রিপোর্টের একটাই এন্ট্রি-চুক্তি
     ২. `data-cap` — এক gate, সব প্যানেলে; অনুমতি নেই মানে লুকানো **এবং** নিষ্ক্রিয়
     ৩. হোমের দরজা রুল-ভিত্তিক: প্যানেলের নিজের রুট-তালিকার বাইরে একটি দরজাও নয়
     ৪. নতুন capability নেই — শুধু `ROLE_CAPABILITIES`-এ যা আছে
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  ENTRY_CAPABILITIES, ENTRY_KINDS, PANEL_ROLES, applyCapabilityGate,
  applyHomeDoorRules, entryReport, panelCapabilities
} from '../js/panel-capabilities.js';
import { CAPABILITIES, ROLE_CAPABILITIES } from '../js/admin-permissions.js';

const html = file => readFileSync(file, 'utf8');
const doc = file => new JSDOM(html(file)).window.document;
const PANELS = Object.freeze({
  admin: 'admin.html',
  teacher: 'teacher.html',
  manager: 'manager.html',
  payment: 'payment.html'
});

test('the four staff panels are the only panels this gate serves', () => {
  assert.deepEqual([...PANEL_ROLES], ['admin', 'teacher', 'manager', 'payment']);
  assert.deepEqual([...ENTRY_KINDS], ['notice', 'lecture', 'chat', 'report']);
  /* jsdom's document is the default root; a detached document yields no rows. */
  assert.deepEqual(entryReport(new JSDOM('<p>no entries</p>').window.document), []);
});

test('every capability the entry map names is a declared capability — none is invented', () => {
  const declared = new Set(Object.values(CAPABILITIES));
  for (const [kind, capability] of Object.entries(ENTRY_CAPABILITIES)) {
    if (capability === null) continue;
    assert.ok(declared.has(capability), `${kind} names an undeclared capability ${capability}`);
  }
});

test('one entry contract: notice · lecture · chat · report carry the same shape everywhere', () => {
  for (const [role, file] of Object.entries(PANELS)) {
    const entries = entryReport(doc(file));
    if (role === 'payment') {
      assert.equal(entries.length, 0, 'the Cash Counter owns none of the four feature entries');
      continue;
    }
    assert.ok(entries.length >= 3, `${role} carries the shared feature entries`);
    for (const entry of entries) {
      assert.ok(ENTRY_KINDS.includes(entry.kind), `${role}: unknown entry kind ${entry.kind}`);
      assert.ok(entry.shape, `${role}/${entry.kind}: icon and an accessible name are the shared shape`);
      if (entry.card) assert.ok(entry.subtitle, `${role}/${entry.kind}: a card door carries its one-line subtitle`);
      assert.equal(entry.blocked, false, `${role}/${entry.kind}: a fresh page ships no blocked entry`);
    }
    const kinds = new Set(entries.map(entry => entry.kind));
    /* Admin keeps notice/lecture entries on the content hub and chat in the
       topbar; its report screen is the bottom-bar seat, so no report card —
       the contract is the shared shape wherever an entry exists. */
    const required = role === 'admin' ? ['chat', 'notice', 'lecture'] : ['chat', 'notice', 'report'];
    for (const kind of required) assert.ok(kinds.has(kind), `${role} has a ${kind} entry`);
  }
});

test('the lecture entry is gated by the one real capability and the counter never carries it', () => {
  for (const role of ['admin', 'teacher', 'manager']) {
    assert.ok(panelCapabilities(role).has(CAPABILITIES.CONTENT_LECTURE_SHEETS), `${role} may author lecture sheets`);
    const lecture = entryReport(doc(PANELS[role])).filter(entry => entry.kind === 'lecture');
    assert.ok(lecture.length >= 1, `${role} has a lecture entry`);
    for (const entry of lecture) assert.equal(entry.capability, CAPABILITIES.CONTENT_LECTURE_SHEETS);
  }
  assert.equal(panelCapabilities('payment').has(CAPABILITIES.CONTENT_LECTURE_SHEETS), false);
  assert.equal(entryReport(doc('payment.html')).filter(entry => entry.kind === 'lecture').length, 0);
});

test('a blocked gate hides AND disables an entry, and re-allows it unchanged', () => {
  const document = doc('teacher.html');
  const lecture = document.querySelector('[data-panel-entry="lecture"]');
  assert.ok(lecture, 'the teacher lecture entry exists');

  const blocked = applyCapabilityGate({ root: document, role: 'payment' });
  assert.ok(blocked.blocked.includes(CAPABILITIES.CONTENT_LECTURE_SHEETS));
  assert.equal(lecture.dataset.gateBlocked, '1');
  assert.equal(lecture.hidden, true);
  assert.equal(lecture.disabled, true);
  assert.equal(lecture.getAttribute('aria-hidden'), 'true');
  assert.equal(lecture.getAttribute('tabindex'), '-1');

  const allowed = applyCapabilityGate({ root: document, role: 'teacher' });
  assert.equal(allowed.blocked.length, 0, 'the teacher keeps every gate it owns');
  assert.equal(lecture.dataset.gateBlocked, undefined);
  assert.equal(lecture.hidden, false);
  assert.equal(lecture.disabled, false);
  assert.equal(lecture.getAttribute('aria-hidden'), null);
});

test('home doors follow the rule table: a route the panel cannot open never shows', () => {
  const document = doc('teacher.html');
  const home = document.querySelector('#teacherHome');
  const doors = [...home.querySelectorAll('[data-panel-view]')].map(door => door.dataset.panelView);
  assert.ok(doors.length >= 4, 'the teacher home has its doors');

  /* Owner rule: a door for a route this panel does not own is hidden, not just
     unstyled — so a copy-paste of another panel's home cannot leak a way in. */
  const first = home.querySelector('[data-panel-view]');
  const kept = first.dataset.panelView;
  const result = applyHomeDoorRules({ root: home, role: 'teacher', routes: doors.filter(route => route !== kept) });
  assert.deepEqual(result.blocked, [kept]);
  assert.equal(first.hidden, true);
  assert.equal(first.dataset.homeBlocked, '1');

  const restored = applyHomeDoorRules({ root: home, role: 'teacher', routes: doors });
  assert.equal(restored.blocked.length, 0);
  assert.equal(first.hidden, false);
  assert.equal(first.dataset.homeBlocked, undefined);
});

test('the gate reads only the declared role table — never a hard-coded list', () => {
  for (const role of PANEL_ROLES) {
    const held = panelCapabilities(role);
    const declared = new Set(ROLE_CAPABILITIES[role] || []);
    assert.deepEqual([...held].sort(), [...declared].sort(), `${role} reads ROLE_CAPABILITIES`);
  }
  assert.deepEqual([...panelCapabilities('nobody')], [], 'an unknown role holds nothing');
});

test('each panel wires the one gate at boot — no panel boots without it', () => {
  const wiring = {
    'js/teacher.js': "applyPanelCapabilities({ role: 'teacher'",
    'js/manager.js': "role: 'manager'",
    'js/payment.js': "applyPanelCapabilities({ role: 'payment'",
    'js/admin.js': "role: 'admin'"
  };
  for (const [file, needle] of Object.entries(wiring)) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /applyPanelCapabilities\(/, `${file} imports and calls the gate`);
    assert.ok(source.includes(needle), `${file} names its own role`);
  }
});


test('re-allowing a capability restores the original disabled, hidden and accessibility state', () => {
  const document = new JSDOM(`
    <button id="pre-disabled" data-cap="${CAPABILITIES.CONTENT_LECTURE_SHEETS}" disabled aria-hidden="false" tabindex="-1">disabled before gate</button>
    <button id="pre-hidden" data-cap="${CAPABILITIES.CONTENT_LECTURE_SHEETS}" hidden>hidden before gate</button>
  `).window.document;
  const disabled = document.querySelector('#pre-disabled');
  const hidden = document.querySelector('#pre-hidden');

  applyCapabilityGate({ root: document, role: 'payment' });
  assert.equal(disabled.hidden, true);
  assert.equal(disabled.disabled, true);
  assert.equal(disabled.getAttribute('aria-hidden'), 'true');
  assert.equal(disabled.getAttribute('tabindex'), '-1');
  assert.equal(hidden.hidden, true);

  applyCapabilityGate({ root: document, role: 'teacher' });
  assert.equal(disabled.hidden, false);
  assert.equal(disabled.disabled, true, 'a control disabled before the gate stays disabled');
  assert.equal(disabled.getAttribute('aria-hidden'), 'false', 'an existing accessibility state is restored');
  assert.equal(disabled.getAttribute('tabindex'), '-1', 'an existing tabindex is restored');
  assert.equal(hidden.hidden, true, 'an element hidden before the gate stays hidden');
});

test('home route rules restore an element’s original hidden state instead of exposing it', () => {
  const document = new JSDOM('<section id="home"><button id="door" data-panel-view="private" hidden aria-hidden="false">private</button></section>').window.document;
  const home = document.querySelector('#home');
  const door = document.querySelector('#door');

  applyHomeDoorRules({ root: home, role: 'teacher', routes: [] });
  assert.equal(door.hidden, true);
  assert.equal(door.getAttribute('aria-hidden'), 'true');

  applyHomeDoorRules({ root: home, role: 'teacher', routes: ['private'] });
  assert.equal(door.hidden, true, 'a route becoming permitted must not reveal content that was initially hidden');
  assert.equal(door.getAttribute('aria-hidden'), 'false');
});
