/* Load-budget guard: the student panel's first paint must stay small.

   Measured 2026-10-10, before/after the performance pass:

     first paint   117 requests / 2050.5 KB raw / 721.2 KB gzip
               ->   52 requests /  928.4 KB raw / 405.4 KB gzip

   The budget below pins the *shape* of that win so a future change set cannot
   silently drag the exam engine or the report builders back into the
   parser-blocking boot graph:

     • eager JS closure of js/main.js  ≤ 40 modules / 300 KB raw
       (35 modules / 279.2 KB today; js/notification-rules.js is the largest
        member at 37.6 KB and is deliberately eager for the birthday look)
     • every production page links the fifteen canonical stylesheets
     • the shipped font stays WOFF2 (a TTF-only @font-face would cost +214 KB)

   Run: node tools/load-budget.mjs        (exit 1 when a budget is broken) */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BUDGETS = {
  eagerModules: 40,
  eagerRawKB: 300,
  stylesheets: 15
};

function staticImports(file) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { return []; }
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  const out = [];
  let match;
  while ((match = re.exec(src))) {
    const spec = match[1] || match[2];
    if (!spec || !spec.startsWith('.')) continue;
    let target = path.resolve(path.dirname(file), spec.split('?')[0]);
    if (!target.endsWith('.js')) target += '.js';
    out.push(target);
  }
  return out;
}

export function eagerClosure(entry = 'js/main.js') {
  const seen = new Set();
  const stack = [path.join(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop();
    const rel = path.relative(ROOT, file);
    if (seen.has(rel)) continue;
    seen.add(rel);
    stack.push(...staticImports(file));
  }
  let raw = 0;
  for (const rel of seen) raw += readFileSync(path.join(ROOT, rel)).length;
  return { modules: seen.size, rawKB: raw / 1024, files: seen };
}

export function checkBudgets() {
  const problems = [];
  const { modules, rawKB } = eagerClosure();
  if (modules > BUDGETS.eagerModules) {
    problems.push(`eager JS closure grew to ${modules} modules (budget ${BUDGETS.eagerModules}) — a feature module leaked back into the boot graph`);
  }
  if (rawKB > BUDGETS.eagerRawKB) {
    problems.push(`eager JS closure grew to ${rawKB.toFixed(1)} KB raw (budget ${BUDGETS.eagerRawKB} KB)`);
  }
  const foundation = readFileSync(path.join(ROOT, 'css/foundation.css'), 'utf8');
  if (!/format\('woff2'\)/.test(foundation)) {
    problems.push('css/foundation.css no longer serves the WOFF2 font first');
  }
  const order = readFileSync(path.join(ROOT, 'css/design-system.css'), 'utf8')
    .match(/@import\s+url\(\s*['"]\.\/([^'")]+)/g) || [];
  if (order.length !== BUDGETS.stylesheets) {
    problems.push(`design-system.css declares ${order.length} sheets, expected ${BUDGETS.stylesheets}`);
  }
  return { problems, eager: { modules, rawKB } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, eager } = checkBudgets();
  console.log(`eager boot graph: ${eager.modules} modules, ${eager.rawKB.toFixed(1)} KB raw`);
  if (problems.length) {
    console.error('LOAD BUDGET BROKEN:');
    for (const problem of problems) console.error('  -', problem);
    process.exit(1);
  }
  console.log('ok — first-paint load budget holds');
}
