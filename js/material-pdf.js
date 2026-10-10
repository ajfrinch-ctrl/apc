/* Offline activity sheet: the work's own details rendered to a branded PDF
   with the bundled Bangla font — no image files, no network, no print dialog.
   The payment portal is the only place that produces image receipts. */
import { toBanglaNumber as bn } from './ui.js';
import { ACTIVITY_TYPES, displayDate, todayISO } from './teaching-data.js';
import { loadAssets, pagesPDF, downloadBlob, wrapText } from './exam-pdf.js';
import { loadWatermark, drawWatermark } from './brand.js';

export const materialFileName = activity => `ActivePlus-material-${activity.type || 'work'}-${todayISO()}.pdf`;

export async function activitySheetPDF(activity) {
  const [font, logo] = await loadAssets(), canvas = document.createElement('canvas');
  const wm = await loadWatermark();
  canvas.width = 1240; canvas.height = 1754;
  const ctx = canvas.getContext('2d'), pages = [];
  const W = canvas.width, LEFT = 62, RIGHT = W - 62, CONTENT_W = RIGHT - LEFT;
  const FOOT_Y = 1690, BOTTOM = 1652;
  const type = ACTIVITY_TYPES[activity.type] || { label: 'শিক্ষার কাজ' };

  const beginPage = () => {
    pageNo++;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, canvas.height);
    drawWatermark(ctx, W, canvas.height, wm);
    ctx.drawImage(logo, 62, 42, 72, 72);
    ctx.fillStyle = '#04795a'; ctx.font = '700 30px ExamBangla'; ctx.fillText('Active Plus Coaching', 150, 80);
    ctx.font = '22px ExamBangla'; ctx.fillText('শিখতে থাকো, এগিয়ে যাও', 150, 113);
    ctx.font = '700 22px ExamBangla'; ctx.textAlign = 'right';
    ctx.fillText('শিক্ষার্থী উপকরণ', RIGHT, 82);
    ctx.fillText(`${activity.subject || ''}${activity.className ? ` • ${activity.className}` : ''}`, RIGHT, 113);
    ctx.textAlign = 'left';
    ctx.strokeStyle = '#d9e7e0'; ctx.beginPath(); ctx.moveTo(LEFT, 140); ctx.lineTo(RIGHT, 140); ctx.stroke();
    return 190;
  };

  const renderFooter = () => {
    ctx.font = '18px ExamBangla'; ctx.fillStyle = '#596960';
    ctx.fillText(`${type.label} • Active Plus Coaching`, LEFT, FOOT_Y);
    ctx.textAlign = 'right';
    ctx.fillText(totalPages ? `পৃষ্ঠা ${bn(pageNo)} / ${bn(totalPages)}` : `পৃষ্ঠা ${bn(pageNo)}`, RIGHT, FOOT_Y);
    ctx.textAlign = 'left';
    ctx.strokeStyle = '#e2ece7'; ctx.beginPath(); ctx.moveTo(LEFT, FOOT_Y - 34); ctx.lineTo(RIGHT, FOOT_Y - 34); ctx.stroke();
  };

  let dryRun = false, dryCount = 0;
  const finishPage = async () => {
    if (dryRun) { dryCount++; return; }
    renderFooter();
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PDF তৈরি হয়নি')), 'image/jpeg', .9));
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  };

  let y = 0, pageNo = 0, totalPages = 0;

  const section = async heading => {
    if (y + 70 > BOTTOM) { await finishPage(); y = beginPage(); }
    ctx.font = '700 26px ExamBangla'; ctx.fillStyle = '#143b30';
    ctx.fillText(heading, LEFT, y); y += 22;
    ctx.strokeStyle = '#cfe3d9'; ctx.beginPath(); ctx.moveTo(LEFT, y); ctx.lineTo(RIGHT, y); ctx.stroke(); y += 38;
  };
  const line = async (content, { bold = false, size = 24, color = '#1e2f28', indent = 0, gap = 10 } = {}) => {
    ctx.font = `${bold ? '700 ' : ''}${size}px ExamBangla`;
    const lineHeight = Math.round(size * 1.55);
    for (const text of wrapText(ctx, content, CONTENT_W - indent)) {
      if (y > BOTTOM) { await finishPage(); y = beginPage(); ctx.font = `${bold ? '700 ' : ''}${size}px ExamBangla`; }
      ctx.fillStyle = color; ctx.fillText(text, LEFT + indent, y); y += lineHeight;
    }
    y += gap;
  };

  const render = async () => {
    y = beginPage();
    await line(activity.title || type.label, { bold: true, size: 30 });
    await line(`${type.label} • বিষয়: ${activity.subject || '—'} • ${activity.className || '—'}${activity.group ? ` • ${activity.group}` : ''}`, { color: '#596960' });
    if (activity.date) await line(`${activity.type === 'homework' ? 'জমার শেষ সময়' : activity.type === 'routine' ? 'ক্লাসের সময়' : 'নির্ধারিত তারিখ'}: ${displayDate(activity.date)}${activity.time ? ` • ${activity.time}` : ''}${activity.duration ? ` • ${activity.duration} মিনিট` : ''}`);
    if (activity.room) await line(`স্থান: ${activity.room}`);
    if (activity.totalMarks) await line(`পূর্ণমান: ${bn(activity.totalMarks)}`);
    if (activity.teacherName) await line(`শিক্ষক: ${activity.teacherName}`, { color: '#596960' });
    y += 8;
    if ((activity.details || '').trim()) {
      await section('বিস্তারিত নির্দেশনা');
      for (const paragraph of String(activity.details).split('\n')) await line(paragraph, { size: 25, gap: 14 });
    }
    await finishPage();
  };

  /* Pass 1 counts pages exactly, pass 2 stamps the true footer totals. */
  dryRun = true; await render();
  totalPages = Math.max(1, dryCount); dryRun = false;
  await render();

  const blob = pagesPDF(pages);
  downloadBlob(blob, materialFileName(activity));
  return blob;
}
