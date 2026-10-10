/* Static audit: every Playwright spec's selectors must exist somewhere real —
   in a page's markup or in the DOM a module builds at runtime. Run with:
     node tools/spec-selector-audit.mjs            (report)
     node tools/spec-selector-audit.mjs --strict   (non-zero exit on a stale ref)
   This is a maintenance tool, not a test: the browser specs themselves cannot run
   in every environment (no Chromium download), so this catches the class of
   failure the architecture work can introduce — a spec pointing at a control that
   moved house.

   Deliberate exceptions are marked in the source with the word `legacy` on the
   same line (e.g. js/main.js removing a banner left by an older build); a stale
   pointer from a redesign carries no such marker and is reported. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => readFileSync(path.join(root, file), 'utf8');

const PAGES = ['index.html', 'admin.html', 'manager.html', 'teacher.html', 'payment.html', 'offline-roles.html'];
/* Markup can also live in a referenced preview page (a design snapshot a spec
   points at); scan every page in the repo so those selectors resolve too. */
const ALL_PAGES = readdirSync(root).filter(file => file.endsWith('.html'));
const previewRoot = path.join(root, 'preview');
const previews = existsSync(previewRoot)
  ? readdirSync(previewRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => readdirSync(path.join(previewRoot, entry.name))
      .filter(file => file.endsWith('.html'))
      .map(file => `preview/${entry.name}/${file}`))
  : [];   // preview/ is untracked: design snapshots stay out of the repository
const pageSource = Object.fromEntries([...ALL_PAGES, ...previews].map(page => [page, read(page)]));
/* Every module's source, so an id/attribute a page builds at runtime still counts. */
const jsFiles = readdirSync(path.join(root, 'js')).filter(file => file.endsWith('.js'));
const jsSource = jsFiles.map(file => read(`js/${file}`)).join('\n');
const cssSource = readdirSync(path.join(root, 'css')).filter(file => file.endsWith('.css'))
  .map(file => read(`css/${file}`)).join('\n');

const idsIn = source => new Set([...source.matchAll(/\bid\s*[:=]\s*["']([A-Za-z][\w-]*)["']/g)].map(match => match[1]));
const htmlIds = new Set(Object.values(pageSource).flatMap(source => [...idsIn(source)]));
const runtimeIds = idsIn(jsSource);
/* Ids a module builds per record (`id="activity-${name}"`): the literal part is a
   prefix, so any spec id starting with it is real but cannot be enumerated. */
const dynamicIdPrefixes = [...jsSource.matchAll(/\bid\s*=\s*["'`]([A-Za-z][\w-]*)\$\{/g)].map(match => match[1]);
const dynamicAttrPrefixes = [...jsSource.matchAll(/\b(data-[\w-]+)\s*=\s*["'`][^"'`]*\$\{/g)].map(match => match[1]);

const attrValues = (source, attribute) =>
  new Set([...source.matchAll(new RegExp(`\\b${attribute}\\s*[:=]\\s*["']([^"']+)["']`, 'g'))].map(match => match[1]));
const htmlData = attribute => new Set(Object.values(pageSource).flatMap(source => [...attrValues(source, attribute)]));
const jsData = attribute => attrValues(jsSource, attribute);

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* A value a module passes to a helper (`button('use-template', …)`) or keeps in
   an ID constant (`const LOCK_CARD_ID = 'apcPanelLock'`) is real but not markup.
   Ids need an id-shaped declaration to count as built; an attribute value may
   legitimately arrive as a helper argument or be composed from a literal prefix. */
const quoted = value => new RegExp('["\'`]' + escape(value) + '["\'`]').test(jsSource);
const idConstant = value => new RegExp('(?:ID|Id)\\w*\\s*=\\s*["\'`]' + escape(value) + '["\'`]').test(jsSource);
const composed = value => [...Array(value.length)].some((_, index) => index >= 2 && quoted(value.slice(0, index)));
const known = {
  id: value => htmlIds.has(value) || runtimeIds.has(value)
    || dynamicIdPrefixes.some(prefix => value.startsWith(prefix)),
  attribute: (attribute, value) =>
    htmlData(attribute).has(value) || jsData(attribute).has(value)
    || dynamicAttrPrefixes.includes(attribute),
  builtId: value => idConstant(value),
  builtAttribute: value => quoted(value) || composed(value)
};

/* Which page a spec drives — from goto() calls, else "any page" (a shared helper). */
function targetsOf(spec) {
  const source = read(`tests/${spec}`);
  const pages = new Set([...source.matchAll(/goto\(\s*['"`]\/?([\w./-]+\.html)/g)].map(match => match[1]));
  return { source, pages: pages.size ? [...pages] : ['any page'] };
}

const problems = [];
/* Selectors whose value a module builds at run time (helper-built attributes,
   ids held in constants): real, just not statically enumerable. */
const dynamic = [];
for (const spec of readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.spec.cjs'))) {
  const { source, pages } = targetsOf(spec);
  const seen = new Set();

  /* #id inside any locator / page.locator / evaluate selector string. */
  for (const match of source.matchAll(/locator\(\s*[`'"]([^`'"]+)[`'"]/g)) {
    const selector = match[1];
    if (selector.includes('${')) continue; // built at run time; nothing to resolve
    /* A locator asserted to be absent is a design claim, not a stale pointer:
       `toHaveCount(0)` / `toBeHidden()` on the same statement. */
    const line = source.slice(source.lastIndexOf('\n', match.index) + 1, source.indexOf('\n', match.index));
    if (/toHaveCount\(\s*0\s*\)|toBeHidden\(/.test(line)) continue;
    for (const [, id] of selector.matchAll(/#([A-Za-z][\w-]*)/g)) {
      if (seen.has('id:' + id)) continue;
      seen.add('id:' + id);
      if (known.id(id)) continue;
      /* An id the spec fabricates in the page under test (`.id = 'probe'`) is
         part of the test, not a reference to app markup. */
      if (new RegExp('\\.id\\s*=\\s*["\'`]' + id + '["\'`]').test(source)) continue;
      (known.builtId(id) ? dynamic : problems).push({ spec, kind: 'id', value: id, pages });
    }
    /* data-*="value" pairs inside a locator. */
    for (const [, attribute, value] of selector.matchAll(/\[(data-[\w-]+)\s*=\s*["']?([^\]"']+)["']?\]/g)) {
      const key = `${attribute}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (known.attribute(attribute, value)) continue;
      (known.builtAttribute(value) ? dynamic : problems).push({ spec, kind: attribute, value, pages });
    }
  }
}

/* A module may keep a guarded reference to a control that has been retired by a
   relocation (its own home now owns the work). Not a defect by itself — the test
   suite asserts those panels no longer carry the markup — but it must be visible
   so the leftover cannot quietly become a second interface again. */
const deadRefs = new Map();
for (const file of jsFiles) {
  const source = read(`js/${file}`);
  for (const match of source.matchAll(/[\$(]\s*['"]#([A-Za-z][\w-]*)['"]/g)) {
    const id = match[1];
    if (htmlIds.has(id) || runtimeIds.has(id)) continue;
    if (dynamicIdPrefixes.some(prefix => id.startsWith(prefix))) continue;
    /* A lookup whose id is built by concatenation (`#navDot-` + type) cannot be
       enumerated; markup provides the leaves the loop actually paints. */
    const tail = source.slice(match.index + match[0].length, match.index + match[0].length + 12);
    if (tail.startsWith(' ' + '+') || tail.startsWith('+') || tail.startsWith('`')) continue;
    const line = source.slice(source.lastIndexOf('\n', match.index) + 1, source.indexOf('\n', match.index));
    if (/legacy/i.test(line)) continue;
    if (!deadRefs.has(file)) deadRefs.set(file, []);
    deadRefs.get(file).push(id);
  }
}

const bySpec = new Map();
for (const problem of problems) {
  if (!bySpec.has(problem.spec)) bySpec.set(problem.spec, []);
  bySpec.get(problem.spec).push(problem);
}
for (const [spec, list] of bySpec) {
  console.log(`\n${spec} (${list[0].pages.join('+') || 'any'})`);
  for (const problem of list) console.log(`   ${problem.kind} → ${problem.value}`);
}
if (deadRefs.size) {
  console.log('\nGuarded module references to retired markup (no selector can resolve them):');
  for (const [file, list] of deadRefs) { const unique = [...new Set(list)]; console.log(`   js/${file}: ${unique.length} — ${unique.slice(0, 6).join(', ')}${unique.length > 6 ? ' …' : ''}`); }
}
const dynamicBySpec = new Map();
for (const item of dynamic) {
  if (!dynamicBySpec.has(item.spec)) dynamicBySpec.set(item.spec, []);
  dynamicBySpec.get(item.spec).push(item);
}
if (dynamicBySpec.size) {
  console.log('\nBuilt at run time (resolved by their module, listed for review):');
  for (const [spec, list] of dynamicBySpec) {
    console.log(`   ${spec}: ${[...new Set(list.map(item => item.value))].join(', ')}`);
  }
}
console.log(`\n${problems.length} unresolved selector(s) in ${bySpec.size} spec file(s); ${dynamic.length} built at run time; ${readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.spec.cjs')).length} specs scanned`);

if (process.argv.includes('--strict') && problems.length) process.exit(1);
