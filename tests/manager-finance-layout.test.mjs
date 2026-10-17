import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const document = page => new JSDOM(read(`${page}.html`)).window.document;
const css = read('css/ui-wallet.css');
const foundation = read('css/foundation.css');
const buildVersion = Number(read('sw.js').match(/const CACHE_VERSION = (\d+)/)?.[1]);

function rgb(hex) { return hex.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16)); }
function luminance(hex) {
  const [r, g, b] = rgb(hex).map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return .2126 * r + .7152 * g + .0722 * b;
}
function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + .05) / (darker + .05);
}

test('shared palette uses the green reference and keeps text above AA contrast', () => {
  assert.match(foundation, /--color-primary:#0e7a55;--color-primary-hover:#0b6548;/);
  assert.match(foundation, /--pay-hero-a:#0e7a55;--pay-hero-b:#0b6548;--pay-on-hero:#fff;--pay-on-hero-soft:#e4f4ec;/);
  assert.ok(contrast('#0e7a55', '#ffffff') >= 4.5, 'green action text on white');
  assert.ok(contrast('#e4f4ec', '#0e7a55') >= 4.5, 'soft hero text on the green hero');
  const lightGradient = foundation.match(/--pay-hero-gradient:([^;]+);/)[1].match(/#[\da-f]{6}/gi);
  const darkFoundation = foundation.split('html[data-theme=dark]{')[1];
  const darkGradient = darkFoundation.match(/--pay-hero-gradient:([^;]+);/)[1].match(/#[\da-f]{6}/gi);
  assert.equal(lightGradient.length, 3, 'light hero blends green, teal, and indigo');
  assert.equal(darkGradient.length, 3, 'AMOLED hero keeps the three-tone blend');
  for (const color of lightGradient) assert.ok(contrast('#e4f4ec', color) >= 4.5, `light hero text on ${color}`);
  for (const color of darkGradient) assert.ok(contrast('#c3ead4', color) >= 4.5, `dark hero text on ${color}`);
  for (const page of ['student', 'manager', 'teacher', 'admin', 'payment']) {
    assert.match(read(`${page}.html`), new RegExp(String.raw`css/ui-wallet\.css\?v=${buildVersion}`), `${page} uses the shared visual layer`);
  }
});

test('shared topbar and staff home heroes use the shared green brand surface', () => {
  assert.match(css, /\.app-topbar \{\s*background: var\(--pay-hero-a\); color: var\(--pay-on-hero\);/);
  assert.match(css, /\.app-shell \.app-topbar \{\s*background: var\(--pay-hero-a\); color: var\(--pay-on-hero\);/);
  assert.match(css, /\.admin-hero \{[\s\S]*?background: var\(--pay-hero-gradient\)/);
  assert.match(css, /\.manager-kpi-grid > \.admin-stat-tile \{[^}]*background: color-mix\(in srgb, var\(--tone/);
  assert.match(css, /\.manager-kpi-grid \.tile-value \{ color: var\(--color-text\); \}/);
  assert.match(css, /\.teacher-summary \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});

test('Manager finance is a four-segment compact workspace, with the approval preview in collection', () => {
  const manager = document('manager');
  const tabs = [...manager.querySelectorAll('#managerFinanceSegments [data-finance-segment]')];
  assert.deepEqual(tabs.map(tab => tab.dataset.financeSegment), ['collection', 'approval', 'due', 'history']);
  assert.deepEqual(tabs.map(tab => tab.textContent.trim()), ['আদায়', 'অনুমোদন', 'বকেয়া', 'ইতিহাস']);
  assert.deepEqual([...manager.querySelectorAll('[data-finance-panel]')].map(panel => panel.dataset.financePanel),
    ['collection', 'approval', 'due', 'history']);
  for (const id of ['mgrFinanceTotal', 'mgrFinanceMonth', 'mgrFinanceDue', 'mgrFinancePending']) {
    assert.ok(manager.getElementById(id)?.closest('.manager-finance-overview'), `#${id} belongs to the compact overview`);
  }
  assert.ok(manager.getElementById('managerCollectionPendingList')?.closest('[data-finance-panel="collection"]'));
  assert.ok(manager.getElementById('managerFinanceApprovalLink')?.closest('[data-finance-panel="collection"]'));
  assert.ok(manager.querySelector('.manager-finance-details[open]') === null, 'secondary collection metrics start collapsed');
  assert.ok(manager.getElementById('managerCashList')?.closest('[data-finance-panel="approval"]'), 'full review queue remains in Manager approval');
  assert.match(read('js/manager.js'), /managerFinanceApprovalLink[\s\S]*financeSegment = 'approval'/);
  assert.match(read('js/manager.js'), /managerCollectionPendingList[\s\S]*collectionPaymentCard/);
  assert.match(css, /\.manager-finance-tabs \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
});

test('green finance refinements do not leak Manager work into other role routes', () => {
  const manager = document('manager');
  const admin = document('admin');
  const teacher = document('teacher');
  const student = document('student');
  assert.ok(manager.querySelector('[data-view-panel="finance"]'));
  assert.equal(admin.querySelector('[data-view-panel="finance"]'), null);
  assert.equal(teacher.querySelector('[data-view-panel="finance"]'), null);
  assert.equal(student.querySelector('[data-view-panel="finance"]'), null);
  assert.equal(student.querySelector('#settingsView'), null, 'Student preferences remain inline in More');
  assert.equal(student.querySelector('[data-view="settings"]'), null, 'no separate Student Settings route was added');
  assert.ok(student.querySelector('#profileView #moreDarkModeToggle'));
  assert.ok(student.querySelector('#profileView #moreTrustedDeviceToggle'));
});
