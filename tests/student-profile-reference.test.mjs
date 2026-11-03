import test from 'node:test';
import assert from 'node:assert/strict';
import { studentIdCardSVG } from '../js/student-profile-card.js';

test('ID card uses the exact stored ID, safely escapes text, and has APC branding', () => {
  const svg = studentIdCardSVG({ id: '000000000000000123', name: '<script>alert(1)</script>', className: 'দশম শ্রেণি' });
  assert.match(svg, /000000000000000123/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /<svg[^>]+viewBox="0 0 360 570"/);
  assert.doesNotMatch(svg, /data:image\/png;base64,/);
  assert.match(svg, /শিখতে থাকো, এগিয়ে যাও/);
  assert.doesNotMatch(svg, /<script|shownId|স্ক্যান/);
});

test('back repeats real ID and omits unavailable details without fabricated placeholders', () => {
  const back = studentIdCardSVG({ id: 'AP-42', guardianMobile: '01712345678' }, '', 'back');
  assert.doesNotMatch(back, /AP-42/, 'the ID is encoded in the QR rather than printed again on the back');
  assert.notEqual(back, studentIdCardSVG({ id: 'AP-43', guardianMobile: '01712345678' }, '', 'back'), 'the QR payload changes with the stored ID');
  assert.match(back, /017••••••78/, 'the guardian phone is masked on the card');
  assert.match(back, /স্ক্যান করে Student ID দেখুন/);
  assert.match(back, /ব্যবহারের শর্ত/);
});

test('missing IDs are not replaced with another number', () => {
  const svg = studentIdCardSVG({ studentMobile: '01812345678' });
  assert.match(svg, /STUDENT ID/);
  assert.match(svg, />—<\/text>/, 'a missing ID is shown as an em dash, never a substitute number');
  assert.doesNotMatch(svg, /01812345678/);
});


test('portrait layout fits long names and long IDs while keeping the full ID', () => {
  const svg = studentIdCardSVG({ id: '000000000000000000000000123456789', name: 'অত্যন্ত দীর্ঘ শিক্ষার্থীর পূর্ণ নাম যেটি কার্ডে থাকবে', className: 'দশম শ্রেণি' });
  assert.match(svg, /000000000000000000000000123456789/);
  assert.match(svg, /textLength="320"/);
  assert.match(svg, /textLength="260"/);
  assert.match(svg, /y="383"/);
});
