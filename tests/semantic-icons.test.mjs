import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {SEMANTIC_ART,iconArtwork} from '../js/icon-set.js';
const read=page=>new JSDOM(readFileSync(page+'.html','utf8')).window.document;
test('different student service choices have different icon artwork within each hub',()=>{
 const d=read('student');
 for(const hub of ['studentServices','routineHub','studySections','examTabs','classHub']){
  const images=[...d.querySelectorAll(`#${hub} button`)].map(b=>b.querySelector('svg image')?.getAttribute('href'));
  assert.ok(images.every(Boolean),hub);assert.equal(new Set(images).size,images.length,hub+' duplicates');
 }
});
test('every semantic icon has a distinct local SVG and no duplicated artwork',()=>{
 const files=Object.keys(SEMANTIC_ART).map(name=>{const art=iconArtwork(name);assert.equal(art.canonical,name);const path=`assets/icons/ai-3d/${name}.svg`;assert.ok(existsSync(path));return readFileSync(path,'utf8');});
 assert.equal(new Set(files).size,files.length);
});
test('More notification and office contact no longer show a wallet',()=>{
 const d=read('student');
 assert.equal(d.querySelector('#profileView [data-view="notification-settings"] svg').dataset.icon,'notification-settings');
 assert.equal(d.querySelector('#profileView [data-action="help"] svg').dataset.icon,'contact-office');
});
test('icon refresh preserves control routes, IDs and action attributes from approved checkpoint',()=>{
 const attrs=['id','data-view','data-action','data-teacher-view','data-manager-view','data-admin-view','data-pay-section','data-close-modal'];
 const controls=d=>[...d.querySelectorAll('button,a,input')].map(n=>Object.fromEntries(attrs.filter(a=>n.hasAttribute(a)).map(a=>[a,n.getAttribute(a)]))).filter(control=>Object.keys(control).length);
 for(const page of ['student','teacher','manager','admin','payment']){
  const current=read(page);
  if(page==='student'){
   /* Student settings remain inline in More on the approved layout: guard the
      single theme/device controls and logout, while app-architecture and
      view-routing cover the complete route set. */
   const now=controls(current);
   assert.equal(current.querySelector('#settingsView'),null,'More owns the settings controls without a duplicate Settings page');
   assert.equal(current.querySelectorAll('[data-view="settings"]').length,0,'More has no extra Settings route');
   assert.ok(now.some(control=>control.id==='moreDarkModeToggle'),'the More theme control remains addressable');
   assert.ok(now.some(control=>control.id==='moreTrustedDeviceToggle'),'trusted-device preference remains addressable');
   assert.ok(now.some(control=>control['data-action']==='logout'),'logout remains reachable');
   continue;
  }
  const old=new JSDOM(execFileSync('git',['show',`f2571fb:${page}.html`],{encoding:'utf8'})).window.document;
  const now=controls(current);
  if(page==='manager'||page==='admin'){
   if(page==='manager'){
    const approvalShortcut=now.filter(control=>control.id==='managerFinanceApprovalLink');
    assert.deepEqual(approvalShortcut,[{id:'managerFinanceApprovalLink'}], 'collection preview keeps its new approval shortcut');
   }
   const currentRoutes=new Set(now.filter(control=>control.id!=='managerFinanceApprovalLink').map(control=>JSON.stringify(control)));
   for(const control of controls(old))assert.ok(currentRoutes.has(JSON.stringify(control)),`${page} keeps existing route/control ${JSON.stringify(control)}`);
   const adviceRoute=page==='manager'?'data-manager-view':'data-admin-view';
   assert.ok(now.some(control=>control[adviceRoute]==='advice'),'daily advice remains reachable from More');
  }else assert.deepEqual(now,controls(old),page);
 }
});
