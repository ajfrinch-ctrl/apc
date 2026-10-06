/* Active Plus Coaching — Report Center
   Fresh implementation. The previous category/card/report-selection UI is removed.
   Data builders, permissions and the existing PDF engine are reused only as
   data/calculation services; this file owns the new Report Center workflow.

   Workflow:
   Select Report → Select Filter → Generate Report → Final PDF → Preview → Download PDF
*/
import {
  REPORTS, FILTER_META, filterOptions, validateFilters, buildReportDocument, EMPTY_MESSAGE
} from './report-catalog.js';
import { resolveActor, actorScope, enforceAccess } from './report-access.js';
import { loadSnapshot } from './report-sources.js';
import { buildReport, renderPagesPDF } from './report-layout.js';
import { downloadBlob } from './exam-pdf.js';

const el = (tag, cls = '', text = '') => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const slug = value => String(value || 'Report')
  .replace(/[^\p{L}\p{N}]+/gu, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 70) || 'Report';

const reportFileName = definition => `ActivePlus_${slug(definition.title)}_${today()}.pdf`;

const optionLabel = (definition, key, value, options) => {
  if (!value || value === 'all') return '';
  if (key === 'period') {
    const labels = { all:'সব সময়', daily:'Daily', weekly:'Weekly', monthly:'Monthly', custom:'Custom Date Range' };
    return labels[value] || value;
  }
  return (options?.[FILTER_META[key]?.options] || []).find(item => String(item.value) === String(value))?.label || String(value);
};

function collectFilters(form) {
  const filters = {};
  for (const field of form.querySelectorAll('[data-filter]')) {
    const key = field.dataset.filter;
    if (field.value !== '') filters[key] = field.value;
  }
  if (filters.period === 'daily') filters.date = form.querySelector('[name="date"]')?.value || '';
  if (filters.period === 'weekly') filters.week = form.querySelector('[name="week"]')?.value || '';
  if (filters.period === 'monthly') filters.month = form.querySelector('[name="month"]')?.value || '';
  if (filters.period === 'custom') {
    filters.from = form.querySelector('[name="from"]')?.value || '';
    filters.to = form.querySelector('[name="to"]')?.value || '';
  }
  if (filters.class) filters.className = filters.class;
  if (filters.student) filters.studentId = filters.student;
  if (filters.exam) filters.examId = filters.exam;
  return filters;
}

function filterSummary(definition, filters, options) {
  const parts = [];
  for (const key of definition.filters || []) {
    const value = filters[key];
    if (value && value !== 'all') {
      const label = optionLabel(definition, key, value, options);
      if (label) parts.push(`${FILTER_META[key]?.label || key}: ${label}`);
    }
  }
  if (filters.period === 'daily' && filters.date) parts.push(`তারিখ: ${filters.date}`);
  if (filters.period === 'weekly' && filters.week) parts.push(`সপ্তাহ: ${filters.week}`);
  if (filters.period === 'monthly' && filters.month) parts.push(`মাস: ${filters.month}`);
  if (filters.period === 'custom' && (filters.from || filters.to)) parts.push(`তারিখ: ${filters.from || '—'} → ${filters.to || '—'}`);
  return parts;
}

/* Filters that name exactly one record rather than a slice of them. */
const SINGLE_FILTERS = new Set(['student', 'exam']);

function setSelectOptions(select, items, { single = false } = {}) {
  // A single-record filter leads with an empty choice, so the dropdown opens
  // asking the question instead of quietly reporting on everybody.
  select.replaceChildren();
  select.append(new Option(single ? 'নির্বাচন করুন' : 'সব', single ? '' : 'all'));
  for (const item of items || []) select.append(new Option(item.label, item.value));
}

function addField(form, key, options, filters, defaultPeriod) {
  const meta = FILTER_META[key];
  if (!meta) return;
  const wrap = el('label', 'rc-field');
  wrap.dataset.filter = key;
  const title = el('span', 'rc-label', meta.label);
  wrap.append(title);

  if (meta.type === 'period') {
    const select = el('select', 'rc-control');
    select.dataset.filter = key;
    select.name = key;
    for (const item of [
      ['all','সব সময়'],['daily','Daily (একদিন)'],['weekly','Weekly (সপ্তাহ)'],
      ['monthly','Monthly (মাস)'],['custom','Custom Date Range']
    ]) select.append(new Option(item[1], item[0]));
    /* A report that is defined as daily/weekly/monthly/custom opens on that
       period, not on "all time" — otherwise "Daily Fee Collection" would
       quietly generate a different report than its name promises. */
    select.value = filters[key] || defaultPeriod || 'all';
    wrap.append(select);
    form.append(wrap);
    return;
  }

  const select = el('select', 'rc-control');
  select.dataset.filter = key;
  select.name = key;
  const optionKey = meta.options;
  /* A report that requires one specific student (or one specific exam) must not
     offer "all": the user asked to pick a person, and silently reporting on
     everybody instead is worse than asking again. */
  const single = SINGLE_FILTERS.has(key);
  setSelectOptions(select, options?.[optionKey] || [], { single });
  select.value = filters[key] || (single ? '' : 'all');
  wrap.append(select);
  form.append(wrap);
}

function addPeriodExtra(form, period) {
  form.querySelector('.rc-period-extra')?.remove();
  if (!['daily','weekly','monthly','custom'].includes(period)) return;
  const box = el('div', 'rc-period-extra');

  if (period === 'daily') {
    box.append(el('label','rc-field', ''));
    const field = box.lastChild;
    field.dataset.extra = 'date';
    field.append(el('span','rc-label','তারিখ'));
    const input = el('input','rc-control');
    input.type='date'; input.name='date'; input.value=today();
    field.append(input);
  } else if (period === 'weekly') {
    const field = el('label','rc-field','');
    field.append(el('span','rc-label','সপ্তাহ শুরু'));
    const input=el('input','rc-control'); input.type='date'; input.name='week'; field.append(input); box.append(field);
  } else if (period === 'monthly') {
    const field = el('label','rc-field','');
    field.append(el('span','rc-label','মাস'));
    const input=el('input','rc-control'); input.type='month'; input.name='month'; field.append(input); box.append(field);
  } else {
    for (const [name,label] of [['from','From Date'],['to','To Date']]) {
      const field=el('label','rc-field',''); field.append(el('span','rc-label',label));
      const input=el('input','rc-control'); input.type='date'; input.name=name; field.append(input); box.append(field);
    }
  }
  form.append(box);
}

class ReportCenter {
  constructor(root, options={}) {
    this.root=root; this.panel=options.panel || '';
    this.actor=null; this.scope=null; this.catalog=[]; this.options=null;
    this.definition=null; this.filters={}; this.pdfBlob=null; this.pdfUrl=null;
  }

  async start({soft=false}={}) {
    const actor=await resolveActor();
    this.actor=actor;
    if (!actor) {
      this.root.replaceChildren(el('p','rc-note','রিপোর্ট দেখতে হলে লগইন করতে হবে।'));
      return this;
    }
    this.scope=actorScope(actor);
    this.catalog=REPORTS.filter(report => (report.roles || []).includes(actor.role));
    this.options=filterOptions(loadSnapshot(), actor, this.scope);
    this.render();
    return this;
  }

  render(restore='') {
    this.revokePdf();
    this.root.className='report-center-new';
    this.root.replaceChildren();

    const head=el('header','rc-head');
    head.append(el('p','rc-eyebrow','REPORT CENTER'));
    head.append(el('h2','rc-title','Report Center'));
    this.root.append(head);

    const form=el('form','rc-form');
    form.noValidate=true;
    this.form=form;

    const reportField=el('label','rc-field rc-report-field');
    reportField.append(el('span','rc-label','Select Report'));
    const reportSelect=el('select','rc-control');
    reportSelect.name='report'; reportSelect.required=true;
    reportSelect.append(new Option('Select Report',''));
    for (const report of this.catalog) {
      reportSelect.append(new Option(report.title,report.id));
    }
    // Coming back from a preview reopens the report the user had chosen.
    const chosen = restore || this.lastReportId || '';
    if ([...reportSelect.options].some(option => option.value === chosen)) reportSelect.value = chosen;
    reportField.append(reportSelect); form.append(reportField);

    this.dynamic=el('div','rc-dynamic-filters');
    form.append(this.dynamic);

    const actions=el('div','rc-actions');
    const generate=el('button','rc-generate','Generate Report');
    generate.type='submit';
    actions.append(generate); form.append(actions);

    const status=el('p','rc-status'); status.hidden=true;
    form.append(status);
    this.status=status;
    this.root.append(form);

    reportSelect.addEventListener('change',()=>this.selectReport(reportSelect.value));
    form.addEventListener('submit',event=>{event.preventDefault();this.generate();});

    this.selectReport(reportSelect.value);
  }

  selectReport(id) {
    this.definition=this.catalog.find(item=>item.id===id) || null;
    this.lastReportId=this.definition?.id || '';
    this.filters={};
    this.dynamic.replaceChildren();
    if (!this.definition) return;

    for (const key of this.definition.filters || []) addField(this.dynamic, key, this.options, this.filters, this.definition.defaultPeriod);
    /* `[data-filter="period"]` is the <label> wrapping the select, so the value
       has to be read off the control inside it — reading it off the label
       yields undefined and the date inputs would never appear. */
    const periodField=this.dynamic.querySelector('[data-filter="period"]');
    const periodSelect=periodField?.querySelector('.rc-control') || null;
    if (periodSelect) {
      periodSelect.addEventListener('change',()=>{
        addPeriodExtra(this.dynamic,periodSelect.value);
      });
      addPeriodExtra(this.dynamic,periodSelect.value);
    }
  }

  async generate() {
    if (!this.definition) {
      this.showStatus('একটি Report নির্বাচন করুন।','error'); return;
    }
    this.clearStatus();
    this.setBusy(true);
    try {
      const filters=collectFilters(this.form);
      const validation=validateFilters(this.definition,filters);
      if (validation) throw new Error(validation);

      const gate=enforceAccess(this.definition,this.actor,filters);
      const result=await buildReportDocument(this.definition,{
        filters:gate.filters, actor:this.actor, scope:gate.scope, snapshot:loadSnapshot()
      });

      const summary=filterSummary(this.definition,gate.filters,this.options);
      if (summary.length) result.doc.scopeLines=[...(result.doc.scopeLines||[]),...summary];

      if (result.empty) {
        /* One wording, defined once (js/report-catalog.js). It travels inside the
           document, so the PDF says it too. */
        result.doc.blocks.push({ type:'note', text:EMPTY_MESSAGE });
      }

      /* One final document becomes one PDF Blob. The exact same Blob is used
         for both the Preview iframe and Download PDF. */
      const rendered=await buildReport(result.doc);
      const blob=await renderPagesPDF(rendered.pages);
      this.openPreview(blob, rendered.html, { empty: result.empty });
    } catch(error) {
      if (error?.code==='FORBIDDEN') this.showStatus(error.message || 'এই রিপোর্ট দেখার অনুমতি নেই।','error');
      else this.showStatus(error?.message || 'Report তৈরি করা যায়নি।','error');
    } finally {
      this.setBusy(false);
    }
  }

  openPreview(blob, previewHtml = '', { empty = false } = {}) {
    this.revokePdf();
    this.pdfBlob=blob;
    this.pdfUrl=URL.createObjectURL(blob);

    const preview=el('section','rc-preview');
    const bar=el('div','rc-preview-head');
    const back=el('button','rc-back','Back');
    back.type='button';
    back.addEventListener('click',()=>this.closePreview());
    const title=el('strong','rc-preview-title',this.definition?.title || 'PDF Preview');
    bar.append(back,title);
    preview.append(bar);

    /* Use the report engine's own measured HTML pages for the on-screen
       preview. This avoids relying on the device's embedded PDF viewer, which
       can render an object-URL PDF as a blank frame on some mobile Chrome
       builds. The downloaded file is still the exact PDF built from the same
       pages. */
    /* An empty result is not a blank page: it states the one empty message, and
       the PDF page underneath carries the same line. */
    if (empty) {
      const notice=el('p','rc-preview-notice',EMPTY_MESSAGE);
      notice.dataset.reportEmpty='1';
      preview.append(notice);
    }

    const previewBody=el('div','rc-pdf-preview');
    previewBody.setAttribute('role','document');
    previewBody.innerHTML=previewHtml || '<p class="rc-preview-empty">রিপোর্ট প্রিভিউ তৈরি করা যায়নি।</p>';
    preview.append(previewBody);

    const download=el('button','rc-download','Download PDF');
    download.type='button';
    download.addEventListener('click',()=>downloadBlob(this.pdfBlob,reportFileName(this.definition)));
    preview.append(download);

    this.root.replaceChildren(preview);

  }

  closePreview() {
    this.revokePdf();
    this.pdfBlob=null;
    this.render(this.definition?.id || '');
  }

  revokePdf() {
    if (this.pdfUrl) URL.revokeObjectURL(this.pdfUrl);
    this.pdfUrl=null;
  }

  showStatus(message,tone='error') {
    this.status.hidden=false; this.status.dataset.tone=tone; this.status.textContent=message;
  }
  clearStatus() { if(this.status){this.status.hidden=true;this.status.textContent='';} }
  setBusy(busy) {
    const button=this.form?.querySelector('.rc-generate');
    if(button){button.disabled=busy;button.textContent=busy?'Generating Report…':'Generate Report';}
  }

  refreshOptions() {
    if (!this.actor) return;
    this.options=filterOptions(loadSnapshot(),this.actor,this.scope);
    if (this.definition) this.selectReport(this.definition.id);
  }
}

const instances=new WeakMap();

export async function mountReports(root,options={}) {
  if (!root) return null;
  const instance=new ReportCenter(root,options);
  instances.set(root,instance);
  return instance.start();
}

export async function refreshReports(root) {
  const instance=instances.get(root);
  if (!instance) return mountReports(root,{});
  return instance.start({soft:true});
}
