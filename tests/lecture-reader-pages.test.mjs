/* Turning pages in the student A4 reader: buttons, arrow keys and a finger.

   Owner decision 2026-11-09: the reader pages are swipeable on a phone, and the
   same page turn answers the ◀ ▶ buttons and the arrow keys on a keyboard, so
   one counter and one scroll position stay true whichever input was used. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { openStudentLectureReaderModal } from '../js/lecture-sheet-pdf.js';

let ctx;

before(async () => {
  ctx = await loadPage('student.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
});
after(() => ctx?.window.close());

/* A document long enough to need more than one A4 page. */
const longDoc = () => ({
  type: 'doc',
  content: Array.from({ length: 40 }, (_, index) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: `অনুচ্ছেদ ${index + 1} — কাগজে জায়গা নেওয়া একটি বাক্য।` }]
  }))
});

const counter = () => ctx.$('#apcStudentLectureReader [data-slr-counter]')?.textContent || '';

const swipe = (node, fromX, toX) => {
  const make = (type, x) => {
    const event = new ctx.window.Event(type, { bubbles: true });
    Object.defineProperty(event, 'touches', { value: type === 'touchstart' ? [{ clientX: x, clientY: 300 }] : [] });
    Object.defineProperty(event, 'changedTouches', { value: type === 'touchend' ? [{ clientX: x, clientY: 300 }] : [] });
    return event;
  };
  node.dispatchEvent(make('touchstart', fromX));
  node.dispatchEvent(make('touchend', toX));
};

test('the reader starts on page one of a multi-page sheet', async () => {
  await openStudentLectureReaderModal({ id: 'READ-1', title: 'সোয়াইপ শিট', docJson: longDoc(), pageSettings: {} });
  assert.match(counter(), /পৃষ্ঠা ১ \/ ২/, 'two pages are laid out');
});

test('a left flick turns forward and a right flick turns back', async () => {
  const pages = ctx.$('#apcStudentLectureReader [data-slr-pages]');
  assert.ok(pages, 'the page area accepts touches');
  swipe(pages, 300, 180);
  assert.match(counter(), /পৃষ্ঠা ২ \/ ২/, 'a leftward swipe goes to the next page');
  swipe(pages, 180, 300);
  assert.match(counter(), /পৃষ্ঠা ১ \/ ২/, 'a rightward swipe comes back');
});

test('a vertical drag on a long page never turns it', async () => {
  const pages = ctx.$('#apcStudentLectureReader [data-slr-pages]');
  const start = new ctx.window.Event('touchstart', { bubbles: true });
  Object.defineProperty(start, 'touches', { value: [{ clientX: 220, clientY: 500 }] });
  const end = new ctx.window.Event('touchend', { bubbles: true });
  Object.defineProperty(end, 'changedTouches', { value: [{ clientX: 250, clientY: 200 }] });
  pages.dispatchEvent(start);
  pages.dispatchEvent(end);
  assert.match(counter(), /পৃষ্ঠা ১ \/ ২/, 'scrolling a page is not a page turn');
});

test('the arrow keys turn the same page and Escape closes the reader', async () => {
  ctx.window.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.match(counter(), /পৃষ্ঠা ২ \/ ২/);
  ctx.window.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.match(counter(), /পৃষ্ঠা ১ \/ ২/);
  ctx.window.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(ctx.$('#apcStudentLectureReader'), null, 'Escape leaves the reader');
});

test('the page bar still carries its own buttons', async () => {
  await openStudentLectureReaderModal({ id: 'READ-2', title: 'বাটন শিট', docJson: longDoc(), pageSettings: {} });
  ctx.click(ctx.$('#apcStudentLectureReader [data-slr-nav="next"]'));
  assert.match(counter(), /পৃষ্ঠা ২ \/ ২/);
  ctx.click(ctx.$('#apcStudentLectureReader [data-slr-nav="prev"]'));
  assert.match(counter(), /পৃষ্ঠা ১ \/ ২/);
  ctx.click(ctx.$('#apcStudentLectureReader [data-slr-close]'));
});
