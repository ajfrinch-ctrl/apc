/* Counter financial reports only. The full generic student/academic/report
   catalog is NOT mounted here. Roster/ledger remain private to this adapter;
   returned tables are explicit financial/identity allowlists, contacts masked. */
import { listDocumentsStrict } from './database.js';
import { financeRepository, monthLabel, isFinalizedTransaction, latinDigits } from './finance-data.js';
import { periodRange, txTime, inRange, isoDay, formatDate } from './report-sources.js';
import { assertCounterActor } from './counter-data.js';
import { counterContacts } from './counter-privacy.js';
import { paymentMethods, feeCategories } from './admin-data.js';

const report = (id,title,mode,period='all') => Object.freeze({id,title,mode,period});
// Every existing Fee/Cash report type, with counter-specific privacy-safe builds.
export const COUNTER_PAYMENT_REPORTS = Object.freeze([
 report('fee.daily','দৈনিক ফি আদায়','collection','daily'),
 report('fee.weekly','সাপ্তাহিক ফি আদায়','collection','weekly'),
 report('fee.monthly','মাসিক ফি আদায়','collection','monthly'),
 report('fee.custom','নির্দিষ্ট সময়ের ফি আদায়','collection','custom'),
 report('fee.student-wise','শিক্ষার্থীভিত্তিক পেমেন্ট','student'),
 report('fee.class-wise','শ্রেণিভিত্তিক আদায়ের সারাংশ','class'),
 report('fee.batch-wise','ব্যাচভিত্তিক আদায়ের সারাংশ','batch'),
 report('fee.due-list','বকেয়া তালিকা','due','monthly'),
 report('fee.due-collection','বকেয়া থেকে আদায়','due-collection','monthly'),
 report('fee.transactions','সব পেমেন্ট ট্রানজ্যাকশন','transactions'),
 report('fee.receipts','রসিদ তালিকা','receipts'),
 report('fee.payment-status','পরিশোধের অবস্থা','payment-status','monthly'),
 report('cash.daily-collection','দৈনিক কাউন্টার সংগ্রহ','counter','daily'),
 report('cash.counter-wise','কাউন্টারভিত্তিক আদায়ের সারাংশ','counter-group','monthly'),
 report('cash.history','পেমেন্টের ইতিহাস','transactions'),
 report('cash.pending','অনুমোদন বাকি পেমেন্ট','pending'),
 report('cash.approved','অনুমোদিত পেমেন্ট','approved'),
 report('cash.rejected','বাতিল পেমেন্ট','rejected'),
 report('cash.closing','কাউন্টার ক্লোজিং','closing','daily'),
 report('cash.own-history','নিজের কাউন্টারের পেমেন্ট','own')
]);
const num = value => String(value).replace(/\d/g,d=>'০১২৩৪৫৬৭৮৯'[d]);
const money = value => `৳${num(Number(value || 0).toLocaleString('en-US'))}`;
const status = tx => tx.status==='pending'?'অনুমোদন বাকি':tx.status==='rejected'?'বাতিল':'অনুমোদিত';
const rollOf = row => String(row?.uniqueRoll ?? row?.uniqueRollNo ?? row?.rollNo ?? row?.rollNumber ?? row?.roll ?? '');
const total = rows => rows.reduce((sum,row)=>sum+Number(row.amount || 0),0);
const own = (tx,username) => tx.counterUsername ? tx.counterUsername===username : tx.collectedBy==='পেমেন্ট কাউন্টার';
const table = (title,columns,rows) => ({title,columns:columns.map(label=>({label,width:label.includes('মাস্ক')?1.9:label==='Transaction ID'?1.3:label==='শিক্ষার্থী'?1.4:label==='ফি / মাস'?1.4:1})),rows});
function validDay(value) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
 const date=new Date(`${value}T12:00:00`);return Number.isFinite(date.getTime()) && isoDay(date.getTime())===value;
}
function filtersFor(definition,input,now) {
 const period=input.period || definition.period;
 if(!['all','daily','weekly','monthly','custom'].includes(period)) throw new Error('সময়কাল সঠিক নয়।');
 const today=isoDay(now.getTime());
 const fields={date:input.date || today,week:input.week || today,month:input.month || today.slice(0,7),from:input.from || today,to:input.to || today};
 if((period==='daily'&&!validDay(fields.date)) || (period==='weekly'&&!validDay(fields.week)) ||
    (period==='monthly'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(fields.month)) ||
    (period==='custom'&&(!validDay(fields.from)||!validDay(fields.to)||fields.from>fields.to))) throw new Error('সঠিক তারিখ/মাসের সীমা দিন।');
 const approval=input.approval || 'all', method=input.method || 'all', feeType=input.feeType || 'all';
 if(!['all','pending','approved','rejected'].includes(approval) || !['all',...paymentMethods].includes(method) || !['all',...feeCategories].includes(feeType)) throw new Error('রিপোর্টের ফিল্টার সঠিক নয়।');
 if(input.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new Error('সঠিক মাস দিন।');
 const range=periodRange(period,fields,now.getTime());
 const billingDate=new Date(`${input.month || (period==='monthly'?fields.month:today.slice(0,7))}-01T12:00:00`);
 return {period,range,billingMonth:monthLabel(billingDate),studentId:String(input.studentId || '').trim(),approval,method,feeType,includeMobile:input.includeMobile===true};
}
function contactColumns(include) {return include?['মোবাইল (মাস্ক)','অভিভাবক (মাস্ক)']:[];}
function contacts(student,include) {if(!include)return [];const fields=counterContacts(student);return [fields.mobileMasked,fields.guardianMobileMasked];}
function transactionTable(rows,students,includeMobile) {
 return table('লেনদেনের তালিকা',['তারিখ','Transaction ID','রসিদ','Student ID','শিক্ষার্থী','ফি / মাস','টাকা','মাধ্যম','অবস্থা',...contactColumns(includeMobile)],rows.map(tx=>[
  tx.date || formatDate(txTime(tx)),tx.transactionNo || tx.id,tx.receiptNo || '—',tx.studentId,tx.studentName || students.get(tx.studentId)?.name || '—',
  `${tx.feeType || '—'} / ${tx.month || '—'}`,money(tx.amount),tx.method || '—',status(tx),...contacts(students.get(tx.studentId),includeMobile)
 ]));
}
function groupedTable(rows,key,title) {
 const groups=new Map();
 for(const tx of rows) {
  const name=String(key(tx) || 'নির্ধারিত নয়');
  const entry=groups.get(name) || {count:0,paid:0,pending:0,rejected:0};entry.count++;
  if(isFinalizedTransaction(tx))entry.paid+=Number(tx.amount || 0);else if(tx.status==='pending')entry.pending++;else entry.rejected++;
  groups.set(name,entry);
 }
 return table(title,[title,'লেনদেন','অনুমোদিত আদায়','অনুমোদন বাকি','বাতিল'],[...groups].map(([name,row])=>[name,num(row.count),money(row.paid),num(row.pending),num(row.rejected)]));
}
export async function buildCounterPaymentReport(reportId,input={}) {
 const username=await assertCounterActor();
 const definition=COUNTER_PAYMENT_REPORTS.find(item=>item.id===reportId);if(!definition)throw new Error('শুধু পেমেন্ট-সংক্রান্ত রিপোর্ট দেখা যাবে।');
 const now=new Date(),filters=filtersFor(definition,input,now);
 const people=listDocumentsStrict('students',row=>Boolean(row && typeof row.id==='string' && row.id));
 const records=await financeRepository.listTransactions({ role: 'payment' });
 const students=new Map(people.map(row=>[row.id,row]));
 if(filters.studentId && !students.has(filters.studentId) && !records.some(tx=>tx.studentId===filters.studentId)) throw new Error('নির্বাচিত শিক্ষার্থী পাওয়া যায়নি।');
 if(definition.mode==='student' && !filters.studentId)throw new Error('একজন শিক্ষার্থী সার্চ করে নির্বাচন করুন।');
 let rows=records.filter(tx=>inRange(txTime(tx),filters.range) && (!filters.studentId || tx.studentId===filters.studentId) &&
   (filters.approval==='all' || (tx.status || 'approved')===filters.approval) && (filters.method==='all'||tx.method===filters.method) && (filters.feeType==='all'||tx.feeType===filters.feeType));
 if(['pending','approved','rejected'].includes(definition.mode))rows=rows.filter(tx=>(tx.status || 'approved')===definition.mode);
 if(definition.mode==='own')rows=rows.filter(tx=>own(tx,username));
 if(['counter','counter-group','closing'].includes(definition.mode))rows=rows.filter(tx=>tx.collectedBy==='পেমেন্ট কাউন্টার' || tx.counterUsername);
 rows.sort((a,b)=>(txTime(b)||0)-(txTime(a)||0));
 const approved=rows.filter(isFinalizedTransaction),pending=rows.filter(tx=>tx.status==='pending'),rejected=rows.filter(tx=>tx.status==='rejected');
 const result={id:definition.id,title:definition.title,period:filters.range.label,summary:[['লেনদেন',num(rows.length)],['অনুমোদিত আদায়',money(total(approved))],['অনুমোদন বাকি',num(pending.length)],['বাতিল',num(rejected.length)]],tables:[],notes:[]};
 if(['class','batch','counter-group'].includes(definition.mode)) {
  const key=definition.mode==='class'?tx=>tx.className || students.get(tx.studentId)?.className:definition.mode==='batch'?tx=>students.get(tx.studentId)?.group:tx=>tx.counterUsername || tx.collectedBy;
  result.tables.push(groupedTable(rows,key,definition.mode==='class'?'শ্রেণি':definition.mode==='batch'?'ব্যাচ':'কাউন্টার'));
 } else if(['due','due-collection','payment-status'].includes(definition.mode)) {
  const selected=people.filter(student=>!filters.studentId || student.id===filters.studentId), balances=[];let unknown=0;
  for(const student of selected) {
   const fee=student.monthlyFee;
   if(fee===null || fee===undefined || fee==='' || !Number.isFinite(Number(fee)) || Number(fee)<0) {unknown++;continue;}
   const tuition=records.filter(tx=>tx.studentId===student.id && tx.feeType==='মাসিক বেতন' && tx.month===filters.billingMonth && isFinalizedTransaction(tx));
   const paid=total(tuition),due=Math.max(0,Number(fee)-paid);
   if(definition.mode==='due' && due<=0)continue;
   const during=tuition.filter(tx=>inRange(txTime(tx),filters.range)),before=tuition.filter(tx=>(txTime(tx)||0)<filters.range.from);
   const opening=Math.max(0,Number(fee)-total(before)),collected=Math.min(opening,total(during));
   balances.push({student,fee:Number(fee),paid,due,opening,collected,closing:Math.max(0,opening-total(during))});
  }
  const collection=definition.mode==='due-collection';
  result.period=filters.billingMonth;
  result.summary=[['শিক্ষার্থী',num(balances.length)],['নির্ধারিত ফি',money(balances.reduce((s,row)=>s+row.fee,0))],['পরিশোধিত',money(balances.reduce((s,row)=>s+row.paid,0))],['বকেয়া',money(balances.reduce((s,row)=>s+row.due,0))]];
  const columns=['Student ID','শিক্ষার্থী','ইউনিক রোল',...(collection?['শুরুর বকেয়া','বকেয়া থেকে আদায়','অবশিষ্ট বকেয়া']:['নির্ধারিত ফি','পরিশোধিত','বকেয়া','অবস্থা']),...contactColumns(filters.includeMobile)];
  result.tables.push(table(definition.title,columns,balances.map(row=>[row.student.id,row.student.name || row.student.nameEn || '—',rollOf(row.student),...(collection?[money(row.opening),money(row.collected),money(row.closing)]:[money(row.fee),money(row.paid),money(row.due),row.due<=0?'পরিশোধিত':row.paid>0?'আংশিক পরিশোধ':'অপরিশোধিত']),...contacts(row.student,filters.includeMobile)])));
  if(unknown)result.notes.push(`${num(unknown)} জনের মাসিক ফি নির্ধারিত নেই; কোনো অনুমানভিত্তিক বকেয়া গণনা করা হয়নি।`);
 } else {
  if(['collection','closing'].includes(definition.mode))result.tables.push(groupedTable(rows,tx=>tx.method,'মাধ্যম'));
  result.tables.push(transactionTable(rows,students,filters.includeMobile));
  if(definition.mode==='student') {
   const student=students.get(filters.studentId);
   result.notes.push(`Student ID: ${filters.studentId}${student?` · ${student.name || student.nameEn || '—'}`:''}`);
  }
 }
 if(!result.tables.some(item=>item.rows.length))result.notes.push('এই ফিল্টারে কোনো পেমেন্টের তথ্য পাওয়া যায়নি।');
 result.notes.push('শুধু অনুমোদিত পেমেন্ট চূড়ান্ত আদায়ে গণনা করা হয়েছে।');
 if(definition.mode==='closing')result.notes.push('এই রিপোর্ট সংগ্রহের হিসাব; নগদ খরচ বা উদ্বোধনী ব্যালেন্স এই লেজারে নথিভুক্ত নেই।');
 return result;
}
// CSV is made from the same safe data as the HTML/PDF, with spreadsheet formula
// injection protection. No private snapshot or full contact is ever exported.
export function counterReportCSV(result) {
 const cell=value=>{let text=String(value??'');if(/^\s*[=+\-@]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
 const lines=[[result.title,result.period],...result.summary];
 for(const item of result.tables)lines.push([item.title],item.columns.map(column=>column.label),...item.rows);
 lines.push(...result.notes.map(note=>[note]));
 return '\ufeff'+lines.map(row=>row.map(cell).join(',')).join('\r\n');
}
