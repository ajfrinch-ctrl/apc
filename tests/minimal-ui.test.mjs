import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=p=>readFileSync(p,'utf8');
const pages=['index','admin','manager','teacher','payment','offline-roles'];
test('every page has one new entry and no legacy icon dependencies',()=>{
 for(const page of pages){const s=read(`${page}.html`);assert.equal((s.match(/rel="stylesheet"/g)||[]).length,1);assert.match(s,/css\/design-system.css/);assert.doesNotMatch(s,/<use\b|<symbol\b|icon-sprite|assets\/icons\/(glass|admin)\//);}
 for(const file of readdirSync('js').filter(f=>f.endsWith('.js')))assert.doesNotMatch(read(`js/${file}`),/<use\b|assets\/icons\/(glass|admin)\//);
});
test('new presentation has no storage or Firebase API and no legacy imports',()=>{
 const s=read('js/icons.js');assert.doesNotMatch(s,/localStorage|indexedDB|firebase|realtime-sync/);
 // One active screen-only skin, never stacked notebook/glass/modern skins.
 // Structural sheets retain the flat rendering and print fallbacks.
 const SKIN='ui-wallet.css';
 const imports=[...read('css/design-system.css').matchAll(/@import\s+url\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)].map(m=>m[1]);
 for(const f of ['foundation','ui-layout','ui-components','ui-forms','ui-features'])assert.ok(imports.includes(`${f}.css`),`design-system.css no longer loads ${f}.css`);
 assert.ok(imports.includes(SKIN),'design-system.css no longer loads the wallet skin');
 for(const f of imports){assert.doesNotMatch(f,/aurora|glass|ui-interior|ui-modern|student-notebook/,`legacy theme imported: ${f}`);assert.ok(existsSync(`css/${f}`),`missing stylesheet: ${f}`);}
 for(const f of ['design-system.css',...imports].filter(f=>f!==SKIN))assert.doesNotMatch(read(`css/${f}`),/gradient\(|backdrop-filter/,`${f} brings back gradients or glass blur outside the skin`);
});
// Baseline includes upstream single-flight sync fix merged from main; the UI does not modify it.
test('protected core and all new and protected assets cached',()=>{
 const sw=read('sw.js');
 for(const dir of ['firebase','sync'])for(const file of readdirSync(dir).filter(f=>f.endsWith('.js'))){const p=`${dir}/${file}`;assert.ok(sw.includes(`'./${p}'`),p);} // byte-equality with baseline 13ab90a dropped: that commit is not in this repository's history, and sync/cloud-access.js now changes by owner decision (docs/INTERIM-ANONYMOUS-SYNC.md)
 for(const f of ['design-system','foundation','ui-layout','ui-components','ui-forms','ui-features','ui-wallet'])assert.ok(sw.includes(`'./css/${f}.css'`));
 assert.ok(sw.includes("'./js/realtime-sync.js'"));assert.ok(sw.includes("'./js/icons.js'"));assert.match(sw,/CACHE_VERSION = 157/);
 const added=execFileSync('git',['diff','--unified=0','--','js','sw.js'],{encoding:'utf8'}).split('\n').filter(l=>l.startsWith('+')).join('\n');assert.doesNotMatch(added,/localStorage\.clear\s*\(|indexedDB\.deleteDatabase\s*\(/);
});
test('no panel keeps a standing offline-workspace or sync-not-connected notice',()=>{
 // The school asked for lean pages: only the work at hand. A permanent banner
 // that says the backend is not connected belongs in docs, not on screen.
 for(const page of ['index','admin','manager','teacher','payment'])assert.doesNotMatch(read(`${page}.html`),/Offline workspace|manager-local-notice/);
 assert.doesNotMatch(read('css/ui-components.css'),/manager-local-notice/);
});
test('precache URLs are unique and all local shell assets exist',()=>{
 const shell=read('sw.js').split('const APP_SHELL = [')[1].split('];')[0];
 const paths=[...shell.matchAll(/'\.\/([^']+)'/g)].map(m=>m[1]);
 assert.equal(paths.length,new Set(paths).size,'Cache.addAll rejects duplicate URLs');
 for(const path of paths)readFileSync(path);
 for(const path of ['js/status-surface.js','js/ui-accessibility.js','js/print-tokens.js','css/ui-status.css'])assert.ok(paths.includes(path));
});
