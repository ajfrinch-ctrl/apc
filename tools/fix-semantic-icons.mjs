/* Repair service identity only. Never touch routes, labels, handlers or layout. */
import {readFileSync,writeFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {iconMarkup} from '../js/icons.js';
const routes={
 'routine-today':'routine-today','routine-tomorrow':'routine-tomorrow','routine-weekly':'routine-weekly','routine-class':'classes','routine-exam':'routine-exam','routine-changed':'routine-changed','routine-holiday':'routine-holiday','routine-important':'routine-important','routine-other':'routine-other',
 'suggestion':'suggestion','materials':'materials','model-test':'model-test','study-practice':'practice','study-results':'result','study-other':'study-other','exam-upcoming':'exam-upcoming','exam-live':'exam-live','exam-done':'exam-done','exam-instant':'exam-instant','exam-papers':'exam-practice','exam-practice':'exam-practice','exam-recent':'exam-recent','exam-bank':'exam-bank','exam-other':'exam-other','exam-results':'result',
 'class-today':'class-today','class-upcoming':'class-upcoming','class-record':'class-record','class-subjects':'class-subjects','class-notes':'class-notes','class-materials':'class-materials','class-other':'class-other','my-courses':'book','notification-settings':'notification-settings'
};
const labels=[['নোটিফিকেশন সেটিংস','notification-settings'],['শিক্ষক বা অফিসে যোগাযোগ','contact-office'],['ব্যক্তিগত তথ্য হালনাগাদ','profile-edit'],['অফলাইন ডেটা','offline-data'],['নম্বর এন্ট্রি','marks-entry'],['পরীক্ষা তৈরি','exam-create'],['ফলাফল','result'],['উপকরণ','materials'],['নোটিশ দিন','notice'],['সাজেশন','suggestion'],['উপস্থিতি','attendance'],['অনুমোদন বাকি','approval'],['নিবন্ধন অপেক্ষমাণ','pending-user'],['নিষ্ক্রিয়','inactive-user'],['বাতিল','rejected-user']];
for(const page of ['student','teacher','manager','admin','payment']){
 const file=page+'.html',source=readFileSync(file,'utf8'),dom=new JSDOM(source);const nodes=[...dom.window.document.querySelectorAll('svg[data-icon]')];let i=0;
 const result=source.replace(/<svg\b[^>]*data-icon="[^"]*"[^>]*>[\s\S]*?<\/svg>/g,original=>{
  const svg=nodes[i++],control=svg.closest('button,a,label');
  if(!control || svg!==control.querySelector('svg') || svg.closest('.pay-back,.more-chevron,.modal-close'))return original;
  const text=control.textContent.trim(),route=['data-view','data-panel-view','data-action'].map(a=>control.getAttribute(a)).find(Boolean);
  let name=routes[route];
  if(!name)name=labels.find(([label])=>text.startsWith(label))?.[1];
  if(!name)return original;
  const replacement=iconMarkup(name,svg.getAttribute('class')||'',{variant:svg.dataset.iconStyle||'color'});
  // Keep accessibility and any non-artwork attributes from the original SVG.
  const open=original.slice(0,original.indexOf('>')+1).replace(/data-icon="[^"]*"/,`data-icon="${name}"`);
  return open+replacement.slice(replacement.indexOf('>')+1);
 });writeFileSync(file,result);dom.window.close();
}
