import test from 'node:test';
import assert from 'node:assert/strict';
import { studentIdCardSVG } from '../js/student-profile-card.js';

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
  assert.match(back, /017••••••78/);
  assert.doesNotMatch(back, /ঠিকানা|—/);
  assert.match(back, /ব্যবহারের শর্ত/);
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
  const idLine = textAt(svg, 54, 336);
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

test('card exports embed the Bengali face so a shared PNG is not rendered in a fallback font', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../js/student-profile-card.js', import.meta.url), 'utf8');
  assert.match(source, /assets\/fonts\/NotoSansBengali-Variable\.woff2/);
  assert.match(source, /@font-face\{font-family:'Noto Sans Bengali';src:url\(data:font\/woff2;base64,/);
  assert.doesNotMatch(source, /link\[href\*="Noto"\]/, 'the old inline-style guess never found the face');
});
