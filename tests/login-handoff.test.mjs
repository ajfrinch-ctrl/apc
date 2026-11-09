/* Owner request 2026-11-08: the sign-in hand-off wording ("এডমিন প্যানেলে নেওয়া
   হচ্ছে…" and friends) must not live on the login screen — it belongs to the
   loading screen of the panel that is opening.

   Verified in Chromium first: the login form printed the line and called
   location.replace() in the same tick, so the message never even painted. These
   tests pin the new contract on the real modules and the real pages. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  STAFF_HANDOFF, staffHandoffLine, writeHandoffNote, takeHandoffNote,
  HANDOFF_NOTE_KEY, HANDOFF_NOTE_TTL_MS
} from '../js/login-handoff.js';

const loginSource = readFileSync(new URL('../js/login.js', import.meta.url), 'utf8');
const launchSource = readFileSync(new URL('../js/launch-screen.js', import.meta.url), 'utf8');
const authCss = readFileSync(new URL('../css/ui-auth.css', import.meta.url), 'utf8');
const walletCss = readFileSync(new URL('../css/ui-wallet.css', import.meta.url), 'utf8');
const PANELS = { 'admin.html': 'admin', 'teacher.html': 'teacher', 'manager.html': 'manager', 'payment.html': 'payment' };

const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));

/* The module talks to globalThis.window, the way it does in the browser. */
function browserWindow() {
  const dom = new JSDOM('<!doctype html><body data-panel="admin"></body>', { url: 'http://localhost/admin.html' });
  contexts.push({ window: dom.window });
  const previous = globalThis.window;
  globalThis.window = dom.window;
  dom.window.addEventListener('pagehide', () => { globalThis.window = previous; });
  return dom.window;
}

test('every staff panel owns its own hand-off line', () => {
  const expected = {
    admin: 'এডমিন প্যানেলে নেওয়া হচ্ছে…',
    manager: 'ম্যানেজার প্যানেলে নেওয়া হচ্ছে…',
    teacher: 'শিক্ষক প্যানেলে নেওয়া হচ্ছে…',
    payment: 'পেমেন্ট প্যানেলে নেওয়া হচ্ছে…'
  };
  for (const [role, line] of Object.entries(expected)) {
    assert.equal(STAFF_HANDOFF[role].loading, line);
    assert.equal(staffHandoffLine(role), line, `${role} keeps its own wording`);
    assert.match(line, /[অ-হ]/, `${role} wording stays in Bangla`);
  }
  assert.notEqual(staffHandoffLine('admin'), staffHandoffLine('teacher'), 'panels are not told apart by a shared phrase');
  assert.equal(staffHandoffLine('unknown'), '');
});

test('closing another panel is mentioned only when it really happened', () => {
  assert.equal(staffHandoffLine('admin', 'teacher'),
    'এডমিন প্যানেলে নেওয়া হচ্ছে… — এই ডিভাইসের আগের শিক্ষক প্যানেল সেশনটি বন্ধ হয়েছে');
  assert.equal(staffHandoffLine('admin', ''), 'এডমিন প্যানেলে নেওয়া হচ্ছে…', 'no note without a previous session');
  assert.equal(staffHandoffLine('admin', 'admin'), 'এডমিন প্যানেলে নেওয়া হচ্ছে…', 'the same role is not a switch');
});

test('the note crosses exactly one navigation, once, and only for its own panel', () => {
  const window = browserWindow();
  writeHandoffNote('admin', 'teacher');
  assert.ok(window.sessionStorage.getItem(HANDOFF_NOTE_KEY), 'the signing-in tab leaves a note');
  const raw = JSON.parse(window.sessionStorage.getItem(HANDOFF_NOTE_KEY));
  assert.equal(raw.role, 'admin');
  assert.equal(raw.previousRole, 'teacher');
  assert.deepEqual(Object.keys(raw).sort(), ['at', 'previousRole', 'role'],
    'copy only — no credentials, ids or role authority cross the navigation');

  assert.equal(takeHandoffNote('admin'), staffHandoffLine('admin', 'teacher'));
  assert.equal(takeHandoffNote('admin'), '', 'the note is consumed by the first read');
  assert.equal(window.sessionStorage.getItem(HANDOFF_NOTE_KEY), null);
});

test('a stale or foreign note never relabels the loading screen', () => {
  const window = browserWindow();
  writeHandoffNote('admin');
  assert.equal(takeHandoffNote('teacher'), '', 'the teacher page ignores the admin note');
  assert.equal(window.sessionStorage.getItem(HANDOFF_NOTE_KEY), null, 'and clears it anyway');

  window.sessionStorage.setItem(HANDOFF_NOTE_KEY, JSON.stringify({ role: 'admin', at: Date.now() - HANDOFF_NOTE_TTL_MS - 1 }));
  assert.ok(HANDOFF_NOTE_TTL_MS <= 30_000, 'the note expires quickly');
  assert.equal(takeHandoffNote('admin'), '', 'an expired note is discarded');

  window.sessionStorage.setItem(HANDOFF_NOTE_KEY, 'not json');
  assert.equal(takeHandoffNote('admin'), '', 'a corrupt note is ignored, never thrown');

  const broken = browserWindow();
  Object.defineProperty(broken, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
  assert.doesNotThrow(() => writeHandoffNote('admin'), 'private mode cannot break sign-in');
  assert.equal(takeHandoffNote('admin'), '');
});

test('the login screen no longer prints a success hand-off message', () => {
  assert.doesNotMatch(loginSource, /setAuthMessage\(`\$\{STAFF_LABEL\[role\]\}ে নেওয়া হচ্ছে/u,
    'the success line is gone from the login form');
  assert.match(loginSource, /writeHandoffNote\(role, previous\[0\] \|\| ''\)/u,
    'the login form leaves the note for the loading screen');
  const enterStaffPanel = loginSource.slice(loginSource.indexOf('async function enterStaffPanel'));
  const body = enterStaffPanel.slice(0, enterStaffPanel.indexOf('async function handleStaffLogin'));
  assert.match(body, /window\.location\.replace\(staffPanelPath\(role\)\)/u);
  assert.ok(body.indexOf('writeHandoffNote') < body.indexOf('location.replace'), 'the note is written before the navigation');
  assert.doesNotMatch(body, /setAuthMessage\([^)]*success/u, 'nothing success-coloured is shown on the way out');
});

test('failure and permission messages stay on the login screen', () => {
  for (const copy of [
    'আপনার অ্যাকাউন্ট অনুমোদনের অপেক্ষায় আছে।',
    'সেশন সংরক্ষণ করা যায়নি',
    'ইউজারনেম বা পাসওয়ার্ড সঠিক নয়'
  ]) {
    assert.match(loginSource, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${copy} still reaches the form`);
  }
});

test('the loading screen shows the note above the tagline and cleans up', () => {
  assert.match(launchSource, /className = 'launch-screen__handoff'/u);
  assert.match(launchSource, /handoff\.hidden = true/u, 'hidden until a note arrives');
  assert.match(launchSource, /screen\.append\(logo, tagline, handoff\)/u, 'logo, tagline, then the hand-off line');
  assert.match(launchSource, /takeHandoffNote\(document\.body\.dataset\.panel \|\| ''\)/u,
    'each panel asks for a note addressed to itself');
  assert.match(launchSource, /screen\.dataset\.handoff = '1'/u, 'the state is observable');
  assert.match(launchSource, /\.catch\(\(\) => ''\)/u, 'a failing module cannot block the loading screen');
  assert.match(launchSource, /1200/u, 'the lookup is bounded, so a slow phone still paints');
  assert.match(authCss, /\.launch-screen \.launch-screen__handoff\{[^}]*border-radius:999px/u, 'the line reads as a pill');
  assert.match(walletCss, /html\[data-theme="dark"\] \.launch-screen \.launch-screen__handoff/u,
    'the pill is themed, not only light');
});

test('each staff page declares the panel the loading screen belongs to', () => {
  for (const [page, panel] of Object.entries(PANELS)) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const body = html.match(/<body[^>]*>/u)[0];
    assert.match(body, new RegExp(`data-panel="${panel}"`), `${page} declares its panel`);
  }
  const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(indexHtml.match(/<body[^>]*>/u)[0], /data-panel=/u,
    'the login page never claims a panel of its own');
});
