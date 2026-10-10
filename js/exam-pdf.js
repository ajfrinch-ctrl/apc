/* Offline, directly downloaded, paginated PDFs. Canvas shapes Bengali text using
   the bundled font. No print dialog or external PDF service.
   An MCQ question paper looks like a real exam paper: the questions run down the
   left column and then the right one, each with its own A/B/C/D options (the same
   letters the student sees in the app), and the footer carries the page number.
   The answer key keeps its own pages after the question pages. */
import { toBanglaNumber as bn } from './ui.js';
import { EXAM_TYPES, totalMarks, classExamDate, examCodeOf, examDurationMinutes, examDateOf, examStageLabel } from './exam-data.js';
import { BRAND_NAME, BRAND_TAGLINE, brandLogoLargeSrc } from './brand.js';
let assets;
export async function loadAssets() {
  if (!assets) assets = Promise.all([
    new FontFace('ExamBangla', `url("${new URL('../assets/fonts/NotoSansBengali-Variable.woff2', import.meta.url).href}")`, { weight: '100 900' }).load().then(font => document.fonts.add(font)),
    (async () => { const logo = new Image(); logo.src = brandLogoLargeSrc(import.meta.url); await logo.decode(); return logo; })()
  ]).catch(error => { assets = null; throw error; });
  return assets;
}
export function pagesPDF(pages) {
  if (!pages.length) throw new Error('No PDF pages');
  const encoder = new TextEncoder(), chunks = [], offsets = [0]; let length = 0;
  const append = data => { const bytes = typeof data === 'string' ? encoder.encode(data) : data; chunks.push(bytes); length += bytes.length; };
  const object = (id, ...parts) => { offsets[id] = length; append(`${id} 0 obj\n`); parts.forEach(append); append('\nendobj\n'); };
  append('%PDF-1.4\n'); append(new Uint8Array([37, 226, 227, 207, 211, 10]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  pages.forEach((p, i) => {
    const id = 3 + i * 3, stream = `q\n595.28 0 0 841.89 0 0 cm\n/Im${i} Do\nQ`;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im${i} ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(id + 1, `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream');
    object(id + 2, `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
  });
  const xref = length, count = 3 + pages.length * 3;
  append(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) append(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  append(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function wrapText(ctx, text, width) {
  const lines = [], segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('bn', { granularity: 'grapheme' }) : null;
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (ctx.measureText(`${line} ${word}`).width > width && line) { lines.push(line); line = ''; }
      if (ctx.measureText(word).width > width) {
        for (const segment of segmenter ? [...segmenter.segment(word)].map(item => item.segment) : Array.from(word)) { if (ctx.measureText(line + segment).width > width) { lines.push(line); line = ''; } line += segment; }
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

/* The MCQ option letters, exactly as the student sees them in the app
   ('ABCD'[index] in js/student-exams.js): A, B, C, D … so the printed paper and
   the on-screen exam never disagree about an option. */
export function optionLetter(index) {
  return 'ABCDEFGH'[index] || String(index + 1);
}

/* `২৫-০৮-২০২৬` for the printed header (Asia/Dhaka, the exam's own day). */
export function examDateShortLabel(exam) {
  const key = examDateOf(exam);
  const [year, month, day] = String(key).split('-');
  return year ? bn(`${day}-${month}-${year}`) : '—';
}
export function timeOf(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return bn(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).format(Number(value)));
}

/* Where the next question goes in a two-column paper. `top`/`bottom` are the
   column bounds, `y` the current cursor and `blockHeight` the question plus its
   options. A block that fits in a column but not in what is left of this one
   moves to the next column, so options are never split from their question; a
   block taller than a whole column has nowhere better to go and continues. */
export function columnAdvance({ y, top, bottom, blockHeight }) {
  if (blockHeight > bottom - top) return 'stay';
  return y + blockHeight > bottom ? 'next-column' : 'stay';
}

/* Shared A4 canvas renderer. Each page: branded header (no page number — it
   lives in the footer), content area, footer with paper label and page number. */
export async function downloadExamPDF(exam, { solutions = false, attempt = null, authorPreview = false } = {}) {
  if (solutions && Date.now() < exam.endAt) throw new Error('সঠিক উত্তরসহ PDF সবার পরীক্ষা শেষ হলে পাওয়া যাবে।');
  if (!authorPreview && (exam.status !== 'published' || Date.now() < exam.startAt)) throw new Error('প্রশ্ন এখনও প্রকাশের সময় হয়নি।');
  const [font, logo] = await loadAssets(), canvas = document.createElement('canvas'); canvas.width = 1240; canvas.height = 1754;
  /* The printed code is the paper's permanent identity: it appears on every
     page footer, so a printed sheet can always be traced back to one record. */
  const code = examCodeOf(exam);
  const identity = [
    ['পরীক্ষার কোড', code],
    ['শ্রেণি', exam.className || 'সব শ্রেণি'],
    ['বিষয়', `${exam.subject}${exam.subjectCode ? ` (${exam.subjectCode})` : ''}`],
    ['পরীক্ষার ধরন', EXAM_TYPES[exam.type] || exam.type],
    ['অধ্যায়', exam.chapterName || '—'],
    ['Batch', exam.batchName || exam.group || '—'],
    ['পরীক্ষার তারিখ', examDateShortLabel(exam)],
    ['সময়', `${timeOf(exam.startAt)} – ${timeOf(exam.endAt)}`],
    ['সময়কাল', `${bn(examDurationMinutes(exam))} মিনিট`],
    ['মোট প্রশ্ন', bn((exam.questions || []).length)],
    ['পূর্ণমান', bn(totalMarks(exam))],
    ['পাস নম্বর', bn(Number(exam.passingMarks) || Math.round(totalMarks(exam) * (Number(exam.passPercent) || 33) / 100))],
    ['প্রতি ভুলে কাটা', exam.type === 'mcq' ? bn(Number(exam.negativeMarks ?? exam.negative) || 0) : 'প্রযোজ্য নয়'],
    ['অবস্থা', examStageLabel(exam)]
  ];
  const ctx = canvas.getContext('2d'), pages = [];
  const W = canvas.width, LEFT = 62, RIGHT = W - 62, CONTENT_W = RIGHT - LEFT;
  const FOOT_Y = 1690, BOTTOM = 1652;
  /* Two-column flow for MCQ question papers: the left column fills first, then
     the right one on the same page, then the next page starts a new left column. */
  const GUTTER = 46, COL_W = (CONTENT_W - GUTTER) / 2;
  let colIndex = 0, colTop = 190, columnMode = false;
  const columnX = () => LEFT + colIndex * (COL_W + GUTTER);

  const beginPage = ({ part = null } = {}) => {
    pageNo++;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, canvas.height);
    ctx.drawImage(logo, 62, 42, 72, 72);
    ctx.fillStyle = '#04795a'; ctx.font = '700 30px ExamBangla'; ctx.fillText(BRAND_NAME, 150, 80);
    ctx.font = '22px ExamBangla'; ctx.fillText(BRAND_TAGLINE, 150, 113);
    if (part) {
      ctx.font = '700 22px ExamBangla'; ctx.textAlign = 'right';
      ctx.fillText(part, RIGHT, 82);
      ctx.fillText(exam.title, RIGHT, 113);
      ctx.textAlign = 'left';
    }
    ctx.strokeStyle = '#d9e7e0'; ctx.beginPath(); ctx.moveTo(LEFT, 140); ctx.lineTo(RIGHT, 140); ctx.stroke();
    return 190;
  };

  const renderFooter = () => {
    ctx.font = '18px ExamBangla'; ctx.fillStyle = '#596960';
    const label = `${partSolutions ? 'সঠিক উত্তরপত্র' : 'প্রশ্নপত্র'} • ${code} • ${BRAND_NAME}`;
    ctx.fillText(label, LEFT, FOOT_Y);
    if (pageNo) {
      ctx.textAlign = 'right';
      ctx.fillText(totalPages ? `পৃষ্ঠা ${bn(pageNo)} / ${bn(totalPages)}` : `পৃষ্ঠা ${bn(pageNo)}`, RIGHT, FOOT_Y);
      ctx.textAlign = 'left';
    }
    ctx.strokeStyle = '#e2ece7'; ctx.beginPath(); ctx.moveTo(LEFT, FOOT_Y - 34); ctx.lineTo(RIGHT, FOOT_Y - 34); ctx.stroke();
  };

  let dryRun = false, dryCount = 0;
  const finishPage = async () => {
    if (dryRun) { dryCount++; return; } // pass 1: only count the pages
    renderFooter();
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PDF তৈরি হয়নি')), 'image/jpeg', .9));
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  };

  let y = 0, pageNo = 0, totalPages = 0, partSolutions = false;
  const QUESTION_GAP = 16;

  const drawParagraph = async (content, { bold = false, size = 25, width = CONTENT_W, x = LEFT, color = '#1e2f28' } = {}) => {
    ctx.font = `${bold ? '700 ' : ''}${size}px ExamBangla`;
    const lineHeight = size === 25 ? 39 : 36;
    for (const line of wrapText(ctx, content, width)) {
      if (y > BOTTOM) { await finishPage(); y = beginPage({ part: partSolutions ? 'উত্তরপত্র' : 'প্রশ্নপত্র' }); ctx.font = `${bold ? '700 ' : ''}${size}px ExamBangla`; }
      ctx.fillStyle = color; ctx.fillText(line, x, y); y += lineHeight;
    }
    y += 10;
  };

  /* Move on in a two-column part: left → right on the same page, right → a new
     page. The vertical cursor returns to the top of the target column. */
  const nextColumn = async () => {
    if (columnMode && colIndex === 0) { colIndex = 1; y = colTop; return; }
    await finishPage();
    y = beginPage({ part: partSolutions ? 'উত্তরপত্র' : 'প্রশ্নপত্র' });
    colTop = y; colIndex = 0;
  };
  const ensureRoom = async height => { if (y + height > BOTTOM) await nextColumn(); };

  /* One MCQ in a column: the question and its own options, kept together with at
     least the first option row. Short options share a line in pairs, like a
     printed paper; long ones take a full line instead of being cut off. */
  const drawColumnQuestion = async (number, question, options) => {
    const letterGap = 32;
    ctx.font = '700 24px ExamBangla';
    const headLines = wrapText(ctx, `${bn(number)}. ${question.text} [${bn(question.marks)}]`, COL_W);
    ctx.font = '24px ExamBangla';
    const pairsFit = options.length > 1
      && options.every(option => ctx.measureText(option.text).width <= (COL_W - 20) / 2 - letterGap);
    const perRow = pairsFit ? 2 : 1;
    const cellW = (COL_W - (perRow === 2 ? 20 : 0)) / perRow;
    const rows = [];
    for (let index = 0; index < options.length; index += perRow) {
      const cells = options.slice(index, index + perRow).map((option, offset) => ({
        letter: optionLetter(index + offset),
        lines: wrapText(ctx, option.text, cellW - letterGap)
      }));
      rows.push({ cells, height: Math.max(32, ...cells.map(cell => cell.lines.length * 31)) });
    }
    const headHeight = headLines.length * 32;
    const blockHeight = headHeight + rows.reduce((sum, row) => sum + row.height + 6, 0) + 14;
    /* A question and its options move together: a printed paper never leaves half
       an answer set at the foot of one column. Only a block taller than a whole
       column (a very long question) is allowed to continue over. */
    if (columnAdvance({ y, top: colTop, bottom: BOTTOM, blockHeight }) === 'next-column') await nextColumn();
    for (const line of headLines) {
      await ensureRoom(32);
      ctx.fillStyle = '#143b30'; ctx.font = '700 24px ExamBangla';
      ctx.fillText(line, columnX(), y); y += 32;
    }
    for (const row of rows) {
      await ensureRoom(row.height + 6);
      row.cells.forEach((cell, index) => {
        const x = columnX() + index * cellW;
        ctx.fillStyle = '#04795a'; ctx.beginPath();
        ctx.arc(x + 11.5, y - 8, 11.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '700 14px ExamBangla'; ctx.textAlign = 'center';
        ctx.fillText(cell.letter, x + 11.5, y - 3); ctx.textAlign = 'left';
        ctx.fillStyle = '#1e2f28'; ctx.font = '24px ExamBangla';
        cell.lines.forEach((line, lineIndex) => ctx.fillText(line, x + letterGap, y + lineIndex * 31));
      });
      y += row.height + 6;
    }
    y += 14;
  };

  const drawOptionGrid = async (question, options) => {
    const qid = question.id;
    const columnWidth = (CONTENT_W - 34) / 2;
    for (let row = 0; row < Math.ceil(options.length / 2); row++) {
      if (y + 46 > BOTTOM) { await finishPage(); y = beginPage({ part: partSolutions ? 'উত্তরপত্র' : 'প্রশ্নপত্র' }); }
      const cells = [];
      for (let col = 0; col < 2; col++) {
        const index = row * 2 + col;
        if (index >= options.length) break;
        cells.push({ option: options[index], x: LEFT + col * (columnWidth + 34), width: columnWidth });
      }
      const answer = partSolutions ? options.findIndex(o => o.id === question.answer) : -1;
      const chosen = solutions && attempt ? options.findIndex(o => o.id === attempt?.answers?.[qid]) : -1;
      const heights = cells.map(({ option, width }) => {
        ctx.font = '24px ExamBangla';
        return Math.max(30, wrapText(ctx, option.text, width - 44).length * 32);
      });
      const rowHeight = Math.max(40, ...heights);
      cells.forEach(({ option, x, width }, cellIndex) => {
        const letter = 'ABCD'[row * 2 + cellIndex];
        const isAnswer = solutions && answer === row * 2 + cellIndex;
        const isChosen = solutions && chosen === row * 2 + cellIndex;
        ctx.strokeStyle = '#c9d8d0'; ctx.lineWidth = 1.4;
        if (solutions && isAnswer) { ctx.fillStyle = '#e7f4ec'; ctx.fillRect(x - 10, y - 24, width + 6, rowHeight + 8); }
        ctx.fillStyle = '#04795a'; ctx.beginPath();
        ctx.arc(x + 11, y - 8, 11.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '700 14px ExamBangla'; ctx.textAlign = 'center';
        ctx.fillText(letter, x + 11, y - 3); ctx.textAlign = 'left';
        ctx.font = '24px ExamBangla'; ctx.fillStyle = '#1e2f28';
        if (isChosen) ctx.font = '700 24px ExamBangla';
        wrapText(ctx, option.text, width - 44).forEach((line, i) => ctx.fillText(line, x + 32, y + i * 32));
      });
      y += rowHeight + 8;
    }
    y += 10;
  };

  /* The paper's own identity card: every field a printed sheet must carry so
     the exam can be traced without the app (code, class, subject + subject
     code, type, chapter, date, duration, question count and marks). */
  const drawIdentity = async () => {
    const rowH = 34, labelW = 250, colW = (CONTENT_W - labelW) / 2;
    await drawParagraph(`পরীক্ষার নাম: ${exam.title}`, { bold: true, color: '#143b30' });
    for (let index = 0; index < identity.length; index += 2) {
      if (y + rowH > BOTTOM) { await finishPage(); y = beginPage({ part: partSolutions ? 'উত্তরপত্র' : 'প্রশ্নপত্র' }); }
      for (let column = 0; column < 2; column++) {
        const row = identity[index + column];
        if (!row) continue;
        const x = LEFT + column * (colW + 10);
        ctx.fillStyle = '#f2f7f3'; ctx.fillRect(x, y - 24, colW, rowH - 4);
        ctx.fillStyle = '#596960'; ctx.font = '20px ExamBangla';
        ctx.fillText(String(row[0]), x + 10, y);
        ctx.fillStyle = '#143b30'; ctx.font = '700 20px ExamBangla';
        ctx.fillText(String(row[1]).slice(0, 40), x + labelW - 30, y);
      }
      y += rowH;
    }
    y += 8;
  };
  const drawHead = async () => {
    await drawIdentity();
    if (exam.type !== 'mcq') await drawParagraph(`পরের দিন ক্লাসে পরীক্ষা: ${classExamDate(exam.startAt)}। খাতায় উত্তর লিখবে; অনলাইনে লিখিত উত্তর জমা নয়।`);
    else await drawParagraph(`সর্বনিম্ন মোট নম্বর ০। প্রথম প্রবেশের সীমা ${bn(exam.lateMinutes)} মিনিট।`);
    if (attempt) await drawParagraph(`শিক্ষার্থী: ${attempt.name} • চেষ্টা: ${bn(attempt.number)} • প্রাপ্ত নম্বর: ${attempt.score === undefined ? 'জমা অপেক্ষমাণ' : bn(attempt.score)}`);
    if (exam.instructions) await drawParagraph(exam.instructions);
  };

  const questions = attempt?.order?.length ? attempt.order.map(item => exam.questions.find(q => q.id === item.id)) : exam.questions;
  const optionsFor = q => {
    const order = attempt?.order?.find(item => item.id === q.id)?.options;
    return order ? order.map(id => q.options.find(o => o.id === id)) : q.options;
  };

  /* ---------- Page bodies (rendered twice: dry pass counts, real pass draws) ---------- */
  const renderQuestionPart = async () => {
    partSolutions = false;
    // A real exam paper runs an MCQ paper in two columns; written answers need
    // the full width, so they keep the single-column flow.
    columnMode = exam.type === 'mcq';
    colIndex = 0;
    y = beginPage({ part: 'প্রশ্নপত্র' });
    await drawHead();
    colTop = y;   // the columns start under the heading block
    for (const [i, q] of questions.entries()) {
      if (q.options) { await drawColumnQuestion(i + 1, q, optionsFor(q)); continue; }
      // Written questions need the full width; an option-less question inside a
      // two-column paper (an older record) still stays inside its column.
      if (y + 120 > BOTTOM) { await finishPage(); y = beginPage({ part: 'প্রশ্নপত্র' }); }
      await drawParagraph(`${bn(i + 1)}. ${q.text} [${bn(q.marks)} নম্বর]`, columnMode
        ? { bold: true, color: '#143b30', width: COL_W, x: columnX() }
        : { bold: true, color: '#143b30' });
      y += 4;
    }
    await finishPage();
  };

  const renderAnswerPart = async () => {
    // উত্তরপত্র: a compact answer-key grid first, then per-question details,
    // all single-column so the chosen/right option highlighting stays readable.
    partSolutions = true;
    columnMode = false;
    y = beginPage({ part: 'উত্তরপত্র' });
    ctx.font = '700 28px ExamBangla'; ctx.fillStyle = '#143b30';
    ctx.fillText(exam.title, LEFT, y); y += 32;
    ctx.font = '21px ExamBangla'; ctx.fillStyle = '#596960';
    ctx.fillText(`${exam.subject} • ${bn(questions.length)}টি প্রশ্ন • পূর্ণমান: ${bn(totalMarks(exam))}`, LEFT, y); y += 30;
    if (attempt) {
      ctx.font = '700 22px ExamBangla'; ctx.fillStyle = '#143b30';
      ctx.fillText(`শিক্ষার্থী: ${attempt.name} • চেষ্টা: ${bn(attempt.number)} • প্রাপ্ত নম্বর: ${attempt.score === undefined ? 'জমা অপেক্ষমাণ' : bn(attempt.score)}`, LEFT, y); y += 30;
    }
    if (exam.instructions) {
      ctx.font = '19px ExamBangla'; ctx.fillStyle = '#596960';
      wrapText(ctx, exam.instructions, CONTENT_W).forEach(line => { ctx.fillText(line, LEFT, y); y += 28; });
    }
    y += 16;
    const cellW = CONTENT_W / 6;
    questions.forEach((q, i) => {
      const col = i % 6, row = Math.floor(i / 6);
      const x = LEFT + col * cellW, yy = y + row * 56;
      ctx.fillStyle = '#f2f7f3'; ctx.fillRect(x, yy - 22, cellW - 12, 42);
      ctx.fillStyle = '#143b30'; ctx.font = '700 20px ExamBangla';
      ctx.fillText(`${bn(i + 1)}.`, x + 10, yy + 5);
      ctx.fillStyle = '#04795a'; ctx.beginPath();
      ctx.arc(x + 52, yy - 2, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 14px ExamBangla'; ctx.textAlign = 'center';
      ctx.fillText(q.answer ?? '—', x + 52, yy + 3); ctx.textAlign = 'left';
    });
    y += Math.ceil(questions.length / 6) * 56 + 20;
    for (const [i, q] of questions.entries()) {
      if (y + 120 > BOTTOM) { await finishPage(); y = beginPage({ part: 'উত্তরপত্র' }); }
      /* Every answer-key row names the question twice: by position (no.) and by
         its permanent record id, so a paper can be marked against the record. */
      await drawParagraph(`${bn(i + 1)}. ${q.text} [${bn(q.marks)} নম্বর] — আইডি ${q.uid || q.id || '—'}`, { bold: true, color: '#143b30' });
      if (q.options) {
        const opts = optionsFor(q);
        await drawOptionGrid(q, opts);
        const chosen = opts.findIndex(o => o.id === attempt?.answers?.[q.id]);
        const right = opts.findIndex(o => o.id === q.answer);
        const correct = chosen >= 0 && chosen === right;
        const rightOption = opts[right];
        await drawParagraph(
          rightOption ? `সঠিক উত্তর: ${rightOption.id}. ${rightOption.text}` : 'সঠিক উত্তর: —',
          { size: 19, color: '#3d8660' }
        );
        await drawParagraph(
          chosen < 0 ? 'তোমার উত্তর: অনুত্তরিত' : `তুমি ${'ABCD'[chosen]} উত্তরটি দিয়েছ${correct ? ' — সঠিক' : ' — ভুল'}`,
          { size: 19, color: correct ? '#3d8660' : '#a33e30' }
        );
      } else if (q.answerText) {
        await drawParagraph(`মডেল উত্তর: ${q.answerText}`, { size: 19, color: '#3d8660' });
      }
    }
    await finishPage();
  };

  /* Pass 1 (dry): exact page counts per part — no footer, no JPEG. */
  dryRun = true;
  pageNo = 0; await renderQuestionPart();
  const questionTotal = Math.max(1, dryCount);
  let answerTotal = 0;
  if (solutions) { dryCount = 0; pageNo = 0; await renderAnswerPart(); answerTotal = Math.max(1, dryCount); }
  dryRun = false;

  /* Pass 2 (real): draw with true "পৃষ্ঠা n / মোট" footers; answers on their own pages. */
  totalPages = questionTotal; pageNo = 0;
  await renderQuestionPart();
  if (solutions) {
    totalPages = answerTotal; pageNo = 0;
    await renderAnswerPart();
  }

  const blob = pagesPDF(pages);
  downloadBlob(blob, `ActivePlus-${exam.type}-${solutions ? 'solutions' : 'questions'}-${exam.id.slice(-8)}.pdf`);
  return blob;
}
