/* Scoped counter report UI. Domain results are already privacy-minimised;
   HTML, PDF and CSV consume the SAME safe tables, not a raw roster snapshot. */
import { COUNTER_PAYMENT_REPORTS, buildCounterPaymentReport, counterReportCSV } from './counter-report-data.js';
import { searchCounterStudents, assertCounterActor } from './counter-data.js';
import { createReport, addKeyValues, addTable, addNote, buildReport, renderPagesPDF } from './report-layout.js';
import { EMPTY_MESSAGE } from './report-catalog.js';
import { downloadBlob } from './exam-pdf.js';

export function mountCounterReports(root) {
 const el=(tag,text='',cls='')=>{const node=document.createElement(tag);node.textContent=text;if(cls)node.className=cls;return node;};
 const state={version:0,searchVersion:0,selected:null,matches:[],pdf:null,result:null};
 const form=el('form','','counter-report-form'), choices=el('select');choices.name='report';
 choices.append(new Option('রিপোর্ট নির্বাচন করুন',''));for(const def of COUNTER_PAYMENT_REPORTS)choices.append(new Option(def.title,def.id));
 const reportLabel=el('label','রিপোর্টের ধরন');reportLabel.append(choices);form.append(reportLabel);
 const period=el('select');period.name='period';
 for(const [value,label] of [['all','সব সময়'],['daily','দৈনিক'],['weekly','সাপ্তাহিক'],['monthly','মাসিক'],['custom','নির্দিষ্ট তারিখ']])period.append(new Option(label,value));
 const periodLabel=el('label','সময়কাল');periodLabel.append(period);form.append(periodLabel);
 const dates=el('div','','form-grid-2');form.append(dates);
 const fields={};
 for(const [name,label,type] of [['date','তারিখ','date'],['week','সপ্তাহের একটি দিন','date'],['month','মাস','month'],['from','শুরু','date'],['to','শেষ','date']]) {
  const wrap=el('label',label),input=el('input');input.name=name;input.type=type;
  const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  input.value=type==='month'?today.slice(0,7):today;wrap.append(input);fields[name]={input,wrap};dates.append(wrap);
 }
 const updateDates=()=>{const def=COUNTER_PAYMENT_REPORTS.find(item=>item.id===choices.value), balance=['due','due-collection','payment-status'].includes(def?.mode);for(const [name,value] of Object.entries(fields))value.wrap.hidden=!((name==='month'&&balance)||(period.value==='custom'?['from','to'].includes(name):period.value===name || (period.value==='daily'&&name==='date') || (period.value==='weekly'&&name==='week') || (period.value==='monthly'&&name==='month')));};
 period.addEventListener('change',updateDates);
 const studentLabel=el('label','শিক্ষার্থী (ঐচ্ছিক)');
 const studentInput=el('input');studentInput.type='search';studentInput.name='studentQuery';studentInput.placeholder='নাম / ID / রোল / শিক্ষার্থী বা অভিভাবকের মোবাইল';studentInput.autocomplete='off';
 studentLabel.append(studentInput);form.append(studentLabel);
 const results=el('div','','counter-report-matches'), selected=el('p','','finance-hint');form.append(results,selected);
 studentInput.addEventListener('input',async()=>{
  const version=++state.searchVersion;state.selected=null;state.matches=[];results.replaceChildren();selected.textContent='';
  if([...studentInput.value.trim()].length<2)return;
  try {
   const matches=await searchCounterStudents(studentInput.value);
   if(version!==state.searchVersion || !root.isConnected)return;
   state.matches=matches;
   for(const match of matches) {
    const button=el('button',`${match.name} · ${match.id}`,'fee-search-result');button.type='button';
    button.addEventListener('click',()=>{state.selected=match;selected.textContent=`${match.name} · ${match.id}`;results.replaceChildren();studentInput.value='';});results.append(button);
   }
  }catch{selected.textContent='শিক্ষার্থী সার্চ সম্পন্ন হয়নি।';}
 });
 const contacts=el('label','','counter-report-contact-option'),checkbox=el('input');checkbox.type='checkbox';checkbox.name='includeMobile';
 contacts.append(checkbox,document.createTextNode('প্রয়োজন হলে মাস্ক করা মোবাইল দেখান'));form.append(contacts);
 const status=el('p','','finance-error');status.hidden=true;status.setAttribute('role','alert');
 const generate=el('button','রিপোর্ট তৈরি করুন','admin-btn primary');generate.type='submit';form.append(generate,status);
 const preview=el('div','','counter-report-preview');
 root.replaceChildren(form,preview);
 choices.addEventListener('change',()=>{
  const def=COUNTER_PAYMENT_REPORTS.find(item=>item.id===choices.value);if(def)period.value=def.period;
  studentLabel.firstChild.textContent=def?.mode==='student'?'শিক্ষার্থী (নির্বাচন আবশ্যক)':'শিক্ষার্থী (ঐচ্ছিক)';
  updateDates();resetResult();
 });
 function resetResult(){state.pdf=null;state.result=null;preview.replaceChildren();}
 function reset(){++state.version;++state.searchVersion;state.selected=null;state.matches=[];resetResult();results.replaceChildren();selected.textContent='';studentInput.value='';status.textContent='';status.hidden=true;generate.disabled=false;generate.textContent='রিপোর্ট তৈরি করুন';}
 const download=async(format)=>{
  try{await assertCounterActor();if(!state.result)return;
   const stamp=new Date().toISOString().slice(0,10),name=`ActivePlus_${state.result.id.replace(/[^a-z0-9.-]/gi,'_')}_${stamp}`;
   if(format==='pdf'&&state.pdf)downloadBlob(state.pdf,name+'.pdf');
   else if(format==='csv')downloadBlob(new Blob([counterReportCSV(state.result)],{type:'text/csv;charset=utf-8'}),name+'.csv');
  }catch{reset();}
 };
 form.addEventListener('submit',async event=>{
  event.preventDefault();const version=++state.version;status.hidden=true;generate.disabled=true;generate.textContent='রিপোর্ট তৈরি হচ্ছে…';resetResult();
  try {
   if(!choices.value)throw new Error('একটি পেমেন্ট রিপোর্ট নির্বাচন করুন।');
   if(studentInput.value.trim()&&!state.selected)throw new Error('সার্চের ফলাফল থেকে শিক্ষার্থী নির্বাচন করুন অথবা সার্চ মুছুন।');
   const filter={period:period.value,studentId:state.selected?.id || '',includeMobile:checkbox.checked};
   for(const [name,value] of Object.entries(fields))if(!value.wrap.hidden)filter[name]=value.input.value;
   const report=await buildCounterPaymentReport(choices.value,filter);
   /* The same honest empty state the other panels use (§Report Center): nothing
      matched means the preview still opens and says so, and the PDF says it too. */
   const empty=!(report.tables||[]).some(item=>(item.rows||[]).length);
   const doc=createReport({title:report.title,period:report.period,subtitle:'পেমেন্ট রিপোর্ট · ব্যক্তিগত তথ্য সীমিত'});
   addKeyValues(doc,report.summary,{columns:2});
   for(const item of report.tables)addTable(doc,{title:item.title,columns:item.columns,rows:item.rows});
   for(const note of report.notes)addNote(doc,note);
   if(empty)addNote(doc,EMPTY_MESSAGE);
   const rendered=await buildReport(doc),pdf=await renderPagesPDF(rendered.pages);
   await assertCounterActor();
   if(version!==state.version)return;
   state.result=report;state.pdf=pdf;
   const actions=el('div','','modal-actions'),pdfButton=el('button','PDF ডাউনলোড','admin-btn primary'),csvButton=el('button','CSV ডাউনলোড','admin-btn ghost');
   pdfButton.type=csvButton.type='button';pdfButton.dataset.counterDownload='pdf';csvButton.dataset.counterDownload='csv';
   pdfButton.addEventListener('click',()=>{void download('pdf');});csvButton.addEventListener('click',()=>{void download('csv');});actions.append(pdfButton,csvButton);
   // Mobile-readable financial preview, not a whole A4 sheet scaled to a
   // postage stamp. PDF still comes from the same privacy-safe report tables.
   const pages=el('div','','rc-pdf-preview counter-financial-preview');pages.setAttribute('role','document');
   pages.append(el('h3',report.title),el('p',report.period,'finance-hint'));
   const summary=el('dl','','counter-report-summary');
   for(const [label,value] of report.summary){const item=el('div');item.append(el('dt',label),el('dd',value));summary.append(item);}pages.append(summary);
   for(const item of report.tables){
    pages.append(el('h3',item.title));const wrap=el('div','','counter-report-table-scroll'),table=el('table','','counter-financial-table'),head=el('thead'),headRow=el('tr'),body=el('tbody');
    for(const column of item.columns)headRow.append(el('th',column.label));head.append(headRow);table.append(head);
    for(const values of item.rows){const row=el('tr');values.forEach((value,index)=>{const cell=el('td',String(value??''));cell.dataset.label=item.columns[index]?.label||'';row.append(cell);});body.append(row);}table.append(body);wrap.append(table);pages.append(wrap);
   }
   for(const note of report.notes)pages.append(el('p',note,'finance-hint'));
   if(empty){const notice=el('p',EMPTY_MESSAGE,'rc-preview-notice');notice.dataset.reportEmpty='1';preview.append(notice);}
   preview.append(actions,pages);
  }catch(error){if(version===state.version){status.textContent=error?.message || 'রিপোর্ট তৈরি হয়নি।';status.hidden=false;}}
  finally{if(version===state.version){generate.disabled=false;generate.textContent='রিপোর্ট তৈরি করুন';}}
 });
 updateDates();
 /* Report Centre deep links (e.g. হোম → আজকের ক্লোজিং) preselect a report; the
    builder still runs only on an explicit Generate. */
 const preset=id=>{if(!COUNTER_PAYMENT_REPORTS.some(def=>def.id===id))return false;choices.value=id;choices.dispatchEvent(new Event('change'));resetResult();return true;};
 return {reset,preset};
}
