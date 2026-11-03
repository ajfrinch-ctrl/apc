/* Guard: every production page must link the stylesheets in exactly the order
   css/design-system.css declares them.

   The pages stopped @import-ing the fifteen stylesheets from design-system.css
   and link them directly instead, so the browser's preload scanner fetches all
   fifteen in parallel instead of walking a render-blocking serial waterfall.
   That puts the canonical order in two places, so this checker fails the build
   (tests/css-order.test.mjs) the moment they drift apart: a page missing a
   sheet, carrying an extra one, or reordering them.

   Usage: node tools/css-order-check.mjs   (exit 1 on drift) */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'admin.html', 'manager.html', 'teacher.html', 'payment.html'];

/* Pages may append their own scoped sheet after the canonical fifteen. Only the
   teacher panel does: css/teacher-panel.css is the Tailwind build, wrapped in
   `.teacher-reference` (the body class only teacher.html carries) with preflight
   off, so it cannot reach another portal. Keeping it out of design-system.css
   keeps the other four portals on exactly the same fifteen-sheet cascade. */
export const PAGE_SCOPED_SHEETS = Object.freeze({
  'teacher.html': Object.freeze(['staff-panel-theme.css', 'teacher-panel.css']),
  'admin.html': Object.freeze(['staff-panel-theme.css']),
  'manager.html': Object.freeze(['staff-panel-theme.css']),
  'payment.html': Object.freeze(['staff-panel-theme.css'])
});

export function canonicalOrder() {
  const css = readFileSync(path.join(ROOT, 'css/design-system.css'), 'utf8');
  return [...css.matchAll(/@import\s+url\(\s*['"]\.\/([^'")]+)['"]?\s*\)/g)].map(match => match[1]);
}

export function pageStylesheets(page) {
  const html = readFileSync(path.join(ROOT, page), 'utf8');
  return [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="css\/([^"?]+)(?:\?[^"]*)?"/g)]
    .map(match => match[1]);
}

export function checkAll() {
  const order = canonicalOrder();
  const problems = [];
  for (const page of PAGES) {
    const links = pageStylesheets(page);
    const canonicalLinks = links.slice(0, order.length);
    const extras = links.slice(order.length);
    const expectedExtras = PAGE_SCOPED_SHEETS[page] || [];
    if (canonicalLinks.join(',') !== order.join(',') || extras.join(',') !== expectedExtras.join(',')) {
      const missing = order.filter(name => !links.includes(name));
      const extra = links.filter(name => !order.includes(name));
      const reordered = !missing.length && !extra.length;
      problems.push({
        page,
        missing,
        extra,
        reordered,
        extras,
        expected: order,
        actual: links
      });
    }
  }
  return { order, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { order, problems } = checkAll();
  if (problems.length) {
    console.error(`stylesheet order drifted from css/design-system.css (${order.length} sheets):`);
    for (const problem of problems) {
      console.error(`  ${problem.page}:`);
      if (problem.missing.length) console.error(`    missing:  ${problem.missing.join(', ')}`);
      if (problem.extra.length) console.error(`    extra:    ${problem.extra.join(', ')}`);
      if (problem.reordered) console.error('    order differs from the canonical @import order');
    }
    process.exit(1);
  }
  console.log(`ok — ${PAGES.length} pages link all ${order.length} stylesheets in canonical order`);
}
