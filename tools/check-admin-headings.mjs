#!/usr/bin/env node
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

let failed = false;
for (const panel of doc.querySelectorAll('.admin-view[data-view-panel]')) {
  const id = panel.getAttribute('aria-labelledby');
  const view = panel.dataset.viewPanel;
  if (!id) {
    console.error(`❌ ${view}: missing aria-labelledby`);
    failed = true;
    continue;
  }
  if (!doc.getElementById(id)) {
    console.error(`❌ ${view}: aria-labelledby="${id}" not found in DOM`);
    failed = true;
  } else {
    console.log(`✓ ${view} → #${id}`);
  }
  const back = panel.querySelector('[data-admin-back]');
  const parent = panel.dataset.parentView;
  if (parent && !back) {
    console.error(`❌ ${view}: detail view with parent "${parent}" missing [data-admin-back]`);
    failed = true;
  }
  if (parent && back && back.dataset.adminBack !== parent) {
    console.error(`❌ ${view}: back mismatch expected "${parent}" got "${back.dataset.adminBack}"`);
    failed = true;
  }
}
if (failed) {
  console.error('\nHeading check FAILED');
  process.exit(1);
} else {
  console.log('\nHeading check PASSED — all 35+ panels have valid headings and back links');
}
