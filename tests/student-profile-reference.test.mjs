import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { studentIdCardSVG, cardPrintMarkup } from '../js/student-profile-card.js';

test('ID card uses the exact stored ID, safely escapes text, and has APC branding', () => {
  const svg = studentIdCardSVG({ id: '000000000000000123', name: '<script>alert(1)</script>', className: 'দশম শ্রেণি' });
  assert.match(svg, /000000000000000123/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /Active Plus Coaching/);
  assert.match(svg, /<svg\b/);
  assert.match(svg, /শিখতে থাকো, এগিয়ে যাও/);
  assert.doesNotMatch(svg, /<script|shownId|স্ক্যান/);
});

test('back repeats real ID and omits unavailable details without fabricated placeholders', () => {
  const back = studentIdCardSVG({ id: 'AP-42', guardianMobile: '01712345678' }, '', 'back');
  assert.match(back, /AP-42/);
  assert.match(back, /০১৭১২৩৪৫৬৭৮/, 'the guardian number is readable in full and in Bangla digits');
  assert.doesNotMatch(back, /•/, 'no masked digits on the owner\'s own card');
  assert.doesNotMatch(back, /ঠিকানা|—/);
  assert.match(back, /ব্যবহারের শর্ত/);
});

test('the front names a mobile number, and the QR carries name, ID and class as plain text', async () => {
  const student = { id: '260810021', name: 'রাইসা আক্তার', className: 'দশম শ্রেণি', group: 'বিজ্ঞান', studentMobile: '01811223344' };
  const front = studentIdCardSVG(student);
  assert.match(front, /মোবাইল/);
  assert.match(front, /০১৮১১২২৩৩৪৪/);
  const { studentIdQRPayload } = await import('../js/student-profile-card.js');
  const payload = studentIdQRPayload(student);
  assert.equal(payload.split('\n').length, 4);
  assert.match(payload, /^Active Plus Coaching\nনাম: রাইসা আক্তার\nআইডি: 260810021\nশ্রেণি: দশম শ্রেণি · বিজ্ঞান$/);
  const back = studentIdCardSVG(student, '', 'back');
  assert.match(back, /shape-rendering="crispEdges"/);
});

test('the QR also names the school, the date of birth and the guardian', async () => {
  const { studentIdQRPayload } = await import('../js/student-profile-card.js');
  const student = {
    id: '260810021', name: 'রাইসা আক্তার', className: 'দশম শ্রেণি', group: 'বিজ্ঞান',
    institution: 'ধানমন্ডি সরকারি উচ্চ বিদ্যালয়', birthDate: '2009-08-15', guardianName: 'মোঃ রফিকুল ইসলাম',
  };
  const lines = studentIdQRPayload(student).split('\n');
  assert.deepEqual(lines, [
    'Active Plus Coaching',
    'নাম: রাইসা আক্তার',
    'আইডি: 260810021',
    'শ্রেণি: দশম শ্রেণি · বিজ্ঞান',
    'স্কুল / কলেজ: ধানমন্ডি সরকারি উচ্চ বিদ্যালয়',
    'জন্ম তারিখ: ১৫/০৮/২০০৯',
    'অভিভাবক: মোঃ রফিকুল ইসলাম',
  ], 'every stored detail is spelled out in Bangla digits, offline');
  const withFather = studentIdQRPayload({ id: '1', name: 'ক', className: 'নবম শ্রেণি', fatherName: 'আবুল কালাম' });
  assert.match(withFather, /অভিভাবক: আবুল কালাম$/, 'the father stands in when no guardian is stored');
  const blank = studentIdQRPayload({ id: '1', name: 'ক', className: 'নবম শ্রেণি', institution: '', birthDate: '', guardianName: '' });
  assert.equal(blank.split('\n').length, 4, 'empty fields are dropped instead of printing a dash');
});

test('the QR payload stays inside the symbol size the card can print', async () => {
  const { studentIdQRPayload } = await import('../js/student-profile-card.js');
  const long = {
    id: '260810021', name: 'মোঃ আব্দুল্লাহ আল মামুন হোসেন চৌধুরী', className: 'দ্বাদশ শ্রেণি', group: 'ব্যবসায় শিক্ষা',
    institution: 'শহীদ স্মৃতি সরকারি কলেজ, মিরপুর, ঢাকা', birthDate: '2007-01-30', guardianName: 'মোঃ শাহজাহান আলী আহমেদ',
  };
  const bytes = new TextEncoder().encode(studentIdQRPayload(long)).length;
  assert.ok(bytes <= 440, `payload stays within the 73-module budget (was ${bytes})`);
  assert.match(studentIdQRPayload(long), /আইডি: 260810021/, 'the ID is never shortened');
  const back = studentIdCardSVG(long, '', 'back');
  assert.match(back, /width="224" height="224" viewBox="0 0 \d+ \d+"/, 'the QR keeps its large, scannable box');
});

test('missing IDs are not replaced with another number', () => {
  const svg = studentIdCardSVG({ studentMobile: '01812345678' });
  assert.match(svg, /আইডি নেই/);
  assert.doesNotMatch(svg, /01812345678/);
  const back = studentIdCardSVG({ studentMobile: '01812345678' }, '', 'back');
  assert.match(back, /আইডি পাওয়া যায়নি/);
  assert.doesNotMatch(back, /shape-rendering="crispEdges"/, 'no misleading QR without an ID');
});


const textAt = (svg, x, y) => {
  const tag = svg.match(new RegExp(`<text[^>]*x="${x}"[^>]*y="${y}"[^>]*>([^<]*)</text>`));
  return tag ? tag[1] : null;
};

test('portrait layout fits long names and long IDs while keeping the full ID', () => {
  const id = '000000000000000000000000123456789';
  const svg = studentIdCardSVG({ id, name: 'অত্যন্ত দীর্ঘ শিক্ষার্থীর পূর্ণ নাম যেটি কার্ডে থাকবে', className: 'দশম শ্রেণি' });
  assert.match(svg, new RegExp(id));
  const idLine = textAt(svg, 54, 344);
  assert.equal(idLine, id, 'the identifier is never shortened, elided or replaced');
  assert.doesNotMatch(idLine, /…/);
  const nameLines = [...svg.matchAll(/<text x="132" y="(\d+)" font-size="([\d.]+)" font-weight="700"[^>]*>([^<]*)<\/text>/g)];
  assert.equal(nameLines.length, 2, 'a long name wraps onto two lines and no further');
  assert.match(nameLines.at(-1)[3], /…$/, 'the second line ends with an ellipsis instead of overflowing');
  assert.ok(Number(nameLines[0][2]) < 20, 'the name steps down a size before it wraps');
  assert.doesNotMatch(svg, /x="132"[^>]*textLength/, 'Bengali clusters are never condensed with textLength');
});

test('the card keeps one warm identity palette and the app Bengali face', () => {
  const front = studentIdCardSVG({ id: '260810021', name: 'রাইসা আক্তার', className: 'দশম শ্রেণি', group: 'বিজ্ঞান' });
  const back = studentIdCardSVG({ id: '260810021' }, '', 'back');
  for (const svg of [front, back]) {
    assert.match(svg, /viewBox="0 0 360 570"/);
    assert.match(svg, /font-family="'Noto Sans Bengali'/, 'the shipped Bengali face is requested by name');
    assert.match(svg, /xml:space="preserve"/, 'Bengali words keep their spaces in every renderer');
    assert.match(svg, /#fbf7ee/, 'ivory paper body');
    assert.match(svg, /#0e6b4a/, 'brand green');
    assert.match(svg, /#c9922f/, 'brass accent');
    assert.doesNotMatch(svg, /#d9eafa|#c3dcf2|#52708a|#eef6fd/, 'the old pale-blue palette is gone');
  }
  assert.match(back, /ব্যবহারের শর্ত/);
});

test('the header stacks the logo above the institute name above the slogan', () => {
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const svg = studentIdCardSVG({ id: '1', name: 'ক' }, '', 'front', logo);
  const badge = svg.indexOf('<image x=');
  const institute = svg.indexOf('Active Plus Coaching</text>');
  const slogan = svg.indexOf('শিখতে থাকো, এগিয়ে যাও');
  assert.ok(badge > -1 && institute > -1 && slogan > -1);
  assert.ok(badge < institute, 'logo first');
  assert.ok(institute < slogan, 'then the institute, then the slogan');
  assert.match(svg, /<text x="180" y="88" font-size="16"[^>]*>Active Plus Coaching</);
  assert.match(svg, /<text x="180" y="105" font-size="10.5"[^>]*>শিখতে থাকো, এগিয়ে যাও</);
});

test('the card carries the institute\'s own logo, never an invented mark', () => {
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const withLogo = studentIdCardSVG({ id: '260810021', name: 'রাইসা আক্তার' }, '', 'front', logo);
  const backWithLogo = studentIdCardSVG({ id: '260810021' }, '', 'back', logo);
  for (const svg of [withLogo, backWithLogo]) {
    assert.match(svg, /<image x="\d+(\.\d+)?" y="\d+(\.\d+)?" width="\d+(\.\d+)?" height="\d+(\.\d+)?" href="data:image\/png;base64,/);
  }
  assert.doesNotMatch(withLogo, /M180 20 158 31/, 'the drawn fallback yields once the real mark is available');
  const withoutLogo = studentIdCardSVG({ id: '260810021', name: 'রাইসা আক্তার' });
  assert.match(withoutLogo, /M180 20 158 31/, 'first paint keeps a drawn badge instead of an empty tile');
  assert.equal(studentIdCardSVG({ id: '1' }, '', 'front', 'javascript:alert(1)').includes('javascript:'), false, 'only image data URIs are accepted');
});

test('the runtime loads the shipped logo file, not a copy', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../js/student-profile-card.js', import.meta.url), 'utf8');
  assert.match(source, /const BRAND_MARK = 'assets\/icons\/logo-128\.png'/);
  assert.match(source, /export function cardLogoDataUri\(\)/);
});

test('card exports embed the Bengali face so a shared PNG is not rendered in a fallback font', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../js/student-profile-card.js', import.meta.url), 'utf8');
  assert.match(source, /assets\/fonts\/NotoSansBengali-Variable\.woff2/);
  assert.match(source, /@font-face\{font-family:'Noto Sans Bengali';src:url\(data:font\/woff2;base64,/);
  assert.doesNotMatch(source, /link\[href\*="Noto"\]/, 'the old inline-style guess never found the face');
});

test('a print job carries both faces on one sheet, not only the visible side', () => {
  const student = { id: '260810021', name: 'রাইসা আক্তার', className: 'দশম শ্রেণি', group: 'বিজ্ঞান', institution: 'ধানমন্ডি সরকারি উচ্চ বিদ্যালয়' };
  const markup = cardPrintMarkup(student);
  assert.equal((markup.match(/class="student-id-print-face"/g) || []).length, 2, 'front and back are both printed');
  assert.match(markup, /data-print-side="front"[^]*সামনের পাশ/);
  assert.match(markup, /data-print-side="back"[^]*পেছনের পাশ/);
  assert.equal((markup.match(/viewBox="0 0 360 570"/g) || []).length, 2, 'each face is a full card');
  assert.match(markup, /shape-rendering="crispEdges"/, 'the printed back keeps its QR');
  assert.match(markup, /০১৮১১২২৩৩৪৪|260810021/, 'the printed card keeps the real ID');
});

test('the print sheet replaces the page instead of printing the app chrome', () => {
  const css = readFileSync(new URL('../css/ui-features.css', import.meta.url), 'utf8');
  assert.match(css, /body\.student-card-printing > :not\(#studentIdCardPrintRoot\)\s*\{[^}]*display:\s*none/, 'only the print sheet is left on the page');
  assert.match(css, /#studentIdCardPrintRoot \.student-id-print-face\s*\{[^}]*width:\s*76mm/, 'both faces print at card size');
  assert.match(css, /body\.student-card-printing #studentIdCardPrintRoot\s*\{[^}]*display:\s*flex/, 'the two faces sit side by side');
  assert.doesNotMatch(css, /#studentIdCardView > :not\(#studentIdCardPreview\)/, 'the old one-sided print rule is gone');
  assert.doesNotMatch(css, /@media print\s*\{\s*body \* \{ visibility: hidden/, 'no unscoped print rule hides every other page');
});
