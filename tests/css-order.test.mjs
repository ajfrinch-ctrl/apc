/* The fifteen stylesheets are linked directly by every production page (no
   @import waterfall), so the canonical order lives in css/design-system.css
   and in each page's <head>. tools/css-order-check.mjs compares the two; this
   test fails the suite the moment they drift. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAll, canonicalOrder } from '../tools/css-order-check.mjs';

test('every production page links the canonical stylesheet order', () => {
  const { order, problems } = checkAll();
  assert.equal(order.length, 15, 'design-system.css declares fifteen sheets');
  assert.deepEqual(problems, []);
});

test('the canonical order still ends with the Pay skin', () => {
  const order = canonicalOrder();
  assert.equal(order[0], 'foundation.css', 'palette/structure first');
  assert.equal(order.at(-1), 'ui-wallet.css', 'the Pay skin stays last');
});
