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
test('every 3D icon image across all panels exists on disk and every action card / settings row has an icon',()=>{
 for(const page of ['index','student','teacher','manager','admin','payment']){
  const d=read(page);
  for(const img of d.querySelectorAll('svg[data-icon-set="active-plus-soft3d"] image')){
   const href=(img.getAttribute('href')||'').split('?')[0];
   assert.match(href,/^assets\/icons\/ai-3d\/[\w-]+\.(svg|png)$/,`${page}.html invalid 3D icon href: ${href}`);
   assert.ok(existsSync(href),`${page}.html references missing 3D icon file: ${href}`);
  }
  for(const card of d.querySelectorAll('.teacher-action-card,.pay-tile,.more-menu-row,.admin-more-item,.settings-row-link')){
   const iconWrap=card.querySelector('.teacher-action-art,.pay-tile-icon,.more-row-icon,.admin-more-icon,.settings-icon,.apc-icon');
   const svg=iconWrap?.querySelector('svg');
   const img=svg?.querySelector('image');
   const href=(img?.getAttribute('href')||'').split('?')[0];
   assert.ok(iconWrap&&svg&&img&&existsSync(href),`${page}.html card/row missing 3D icon: ${card.textContent.trim().slice(0,40)}`);
  }
 }
});
test('icon refresh preserves control routes, IDs and action attributes from approved checkpoint',()=>{
 const attrs=['id','data-view','data-action','data-panel-view','data-close-modal'];
 /* ২০২৬-১১-০২: চার স্টাফ প্যানেলের রুট-অ্যাট্রিবিউট এখন এক — `data-panel-view`।
    পুরোনো checkpoint-এ সেটি `data-teacher-view`/`data-manager-view`/
    `data-admin-view`/`data-pay-section` নামে ছিল, তাই তুলনার সময় সেগুলোকে
    alias হিসেবে একই কী-তে মাপা হয়। */
 const LEGACY_ROUTES=['data-teacher-view','data-manager-view','data-admin-view','data-pay-section'];
 const controls=d=>[...d.querySelectorAll('button,a,input')].map(n=>{
  const out=Object.fromEntries(attrs.filter(a=>n.hasAttribute(a)).map(a=>[a,n.getAttribute(a)]));
  for(const legacy of LEGACY_ROUTES) if(n.hasAttribute(legacy)) out['data-panel-view']=n.getAttribute(legacy);
  return out;
 }).filter(control=>Object.keys(control).length);
 const readCheckpoint=page=>{
  for(const ref of ['f2571fb','c7aa9b0','HEAD']){
   try{return execFileSync('git',['show',`${ref}:${page}.html`],{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{/* try next */}
  }
  return readFileSync(page+'.html','utf8');
 };
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
  const old=new JSDOM(readCheckpoint(page)).window.document;
  /* The teacher's existing "পরীক্ষা নিন" hint now targets the explicit online-exams route;
     both routes resolve to the same panel, but notifications and task links use online-exams. */
  if(page==='teacher') old.querySelector('.admin-bottom [data-panel-view="exam"]')?.setAttribute('data-panel-view','online-exams');
  const now=controls(current);
  if(page==='manager'||page==='admin'){
   if(page==='manager'){
    const approvalShortcut=now.filter(control=>control.id==='managerFinanceApprovalLink');
    assert.deepEqual(approvalShortcut,[{id:'managerFinanceApprovalLink'}], 'collection preview keeps its new approval shortcut');
   }
   /* Owner request 2026-10-28: the "শ্রেণি চ্যাট ও মডারেশন" console is removed
      from both staff panels, so its shortcuts are the retired controls here. */
   /* ২০২৬-১১-০২: পাসওয়ার্ডের আলাদা রো বিলুপ্ত — সেটিংসের অ্যাকাউন্ট গ্রুপে
      ইনলাইন ফর্ম (`#managerPasswordForm`) সব প্যানেলে এক। */
   const retiredChat = control => control.id === 'classChatTopbarButton'
    || control.id === 'managerChangePassword'
    || control['data-panel-view'] === 'class-chat';
   const currentRoutes=new Set(now.filter(control=>control.id!=='managerFinanceApprovalLink').map(control=>JSON.stringify(control)));
   for(const control of controls(old).filter(c=>c.id!=='managerFinanceApprovalLink'&&!retiredChat(c)))assert.ok(currentRoutes.has(JSON.stringify(control)),`${page} keeps existing route/control ${JSON.stringify(control)}`);
   const adviceRoute=page==='manager'?'data-panel-view':'data-panel-view';
   assert.ok(now.some(control=>control[adviceRoute]==='advice'),'daily advice remains reachable from More');
  }else if(page==='teacher'){
   /* 2026-10-20 navigation restructure: the main navigation, every view, ID and
      existing control stay untouched; the grouped ক্লাস hub and the labelled
      আরও menus only add shortcuts whose attribute signatures already exist as
      canonical routes. 2026-10-21 owner order removes the student list screen
      and its students nav seat entirely, so that single retired control is
      excluded from the preserved-set check; every other approved control must
      still exist (subset rule, the same one Manager/Admin use). */
   /* ২০২৬-১১-০২: পাসওয়ার্ড বদলের আলাদা রো/বাটন বিলুপ্ত — এখন সেটিংসের
      অ্যাকাউন্ট গ্রুপে ইনলাইন ফর্ম (`#teacherPasswordForm`)। */
   const retired = control => control['data-panel-view'] === 'students'
    || control.id === 'teacherChangePassword'
    || (typeof control.id === 'string' && control.id.startsWith('teacherStudent'));
   const currentRoutes=new Set(now.map(control=>JSON.stringify(control)));
   for(const control of controls(old)){
    if(retired(control)) continue;
    assert.ok(currentRoutes.has(JSON.stringify(control)),`teacher keeps existing route/control ${JSON.stringify(control)}`);
   }
  }else {
   /* ২০২৬-১১-০২: কাউন্টার এখন নিজের প্রোফাইল স্ক্রিন পেয়েছে (Admin/Teacher/
      Manager-এর মতোই) — checkpoint-এর প্রতিটি কন্ট্রোল অপরিবর্তিত থাকতে হবে,
      নতুনটি শুধু যোগ হতে পারে। */
   /* The counter's own logout button now lives in the shared account group
      (rendered by js/staff-account-forms.js), so the static page no longer
      carries it — the same one-form rule as the other three panels. */
   const retired = control => control.id === 'payMoreLogout';
   const currentRoutes=new Set(now.map(control=>JSON.stringify(control)));
   for(const control of controls(old).filter(before=>!retired(before))) assert.ok(currentRoutes.has(JSON.stringify(control)),`${page} keeps existing route/control ${JSON.stringify(control)}`);
   assert.ok(currentRoutes.has(JSON.stringify({ 'data-panel-view': 'profile' })),
    'the counter keeps one door to its own profile (its own screen, like the other three panels)');
  }
 }
});
