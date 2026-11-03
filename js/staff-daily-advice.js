/* One shared daily-advice bank for the four staff portals.
 * A section key, not the signed-in role, selects the message. The Dhaka date
 * selects a stable item, so every role viewing the same section on the same
 * date sees the same sentence. Presentation only: no storage or permissions.
 */
import { quoteDateKey, quoteDayNumber } from './daily-quote.js';

export const STAFF_ADVICE_BANK = Object.freeze({
  home: Object.freeze([
    'আজকের কাজ শুরু করুন অগ্রাধিকার ঠিক করে—গুরুত্বপূর্ণ কাজ আগে শেষ করুন।',
    'প্রতিটি শিক্ষার্থীর অগ্রগতি ছোট ছোট নিয়মিত পদক্ষেপে গড়ে ওঠে।',
    'আজকের কাজ শেষে অসম্পূর্ণ বিষয়গুলো নোট করে রাখুন, পরের দিনের শুরু সহজ হবে।',
    'সময়মতো তথ্য হালনাগাদ রাখলে পুরো প্রতিষ্ঠানের কাজ আরও নির্ভুল হয়।',
    'শিক্ষার্থী ও অভিভাবকের সঙ্গে স্পষ্ট যোগাযোগই আস্থার ভিত্তি।',
    'আজ অন্তত একটি কাজ আরও সহজ ও সুশৃঙ্খল করার উপায় খুঁজুন।',
    'দলগত সমন্বয় ভালো হলে শিক্ষার্থীর শেখা ও সেবার মান দুটোই বাড়ে।'
  ]),
  work: Object.freeze([
    'প্রতিটি রেকর্ড সংরক্ষণের আগে নাম, শ্রেণি ও প্রয়োজনীয় তথ্য মিলিয়ে নিন।',
    'অপেক্ষমাণ কাজ নিয়মিত পর্যালোচনা করুন, যেন কোনো আবেদন অযথা আটকে না থাকে।',
    'কাজ সম্পন্ন হলে সংশ্লিষ্ট তথ্য ও অবস্থা সঙ্গে সঙ্গে হালনাগাদ করুন।',
    'কোনো তথ্য অস্পষ্ট হলে অনুমান না করে সংশ্লিষ্ট ব্যক্তির সঙ্গে নিশ্চিত হয়ে নিন।',
    'দায়িত্ব ভাগ করার সময় কাজের অগ্রাধিকার ও সময়সীমা স্পষ্ট করে দিন।',
    'একই কাজ বারবার না করে বিদ্যমান তালিকা ও রেকর্ড আগে যাচাই করুন।'
  ]),
  academic: Object.freeze([
    'পাঠ পরিকল্পনা, ক্লাস রুটিন ও সিলেবাসের অগ্রগতি নিয়মিত মিলিয়ে নিন।',
    'পরীক্ষার প্রশ্নে জ্ঞান, অনুধাবন ও প্রয়োগ—তিন ধরনের দক্ষতার ভারসাম্য রাখুন।',
    'ফলাফল প্রকাশের পর সাধারণ ভুলগুলো চিহ্নিত করে পরবর্তী ক্লাসে আলোচনা করুন।',
    'শিক্ষার্থীদের প্রশ্ন করতে উৎসাহ দিন—সক্রিয় অংশগ্রহণ শেখাকে স্থায়ী করে।',
    'লেকচার শিট ও নোট প্রকাশের আগে শ্রেণি, বিষয় ও সংস্করণ যাচাই করুন।',
    'উপস্থিতি ও মূল্যায়নের ধারাবাহিক তথ্য শিক্ষার্থীর অগ্রগতি বুঝতে সাহায্য করে।',
    'দুর্বল অধ্যায়গুলো চিহ্নিত করে ছোট অনুশীলনের মাধ্যমে পুনরায় শেখার সুযোগ দিন।'
  ]),
  finance: Object.freeze([
    'প্রতিটি লেনদেনের পরিমাণ, তারিখ ও রসিদ মিলিয়ে হিসাব সংরক্ষণ করুন।',
    'দৈনিক আদায় ও বকেয়ার সারাংশ মিলিয়ে অমিল থাকলে দ্রুত যাচাই করুন।',
    'রিপোর্টে কোনো সংখ্যা অস্বাভাবিক মনে হলে উৎস রেকর্ড দেখে নিশ্চিত হোন।',
    'অনুমোদন ও হিসাবের তথ্য আলাদা করে যাচাই করলে ভুল কমে যায়।',
    'মাসিক সারাংশ তৈরির আগে সংশ্লিষ্ট দিনের লেনদেন সম্পূর্ণ হয়েছে কি না দেখুন।',
    'আর্থিক তথ্য শেয়ার করার সময় প্রয়োজনীয় সীমিত তথ্যই ব্যবহার করুন।'
  ]),
  more: Object.freeze([
    'অ্যাকাউন্টের তথ্য হালনাগাদ রাখুন এবং শক্তিশালী পাসওয়ার্ড ব্যবহার করুন।',
    'অচেনা ডিভাইস বা অস্বাভাবিক লগইন দেখলে দ্রুত নিরাপত্তা যাচাই করুন।',
    'গুরুত্বপূর্ণ সেটিংস পরিবর্তনের আগে বর্তমান অবস্থা বুঝে নিন।',
    'অফলাইন কাজের পর সংযোগ ফিরে এলে সিঙ্ক সম্পন্ন হয়েছে কি না যাচাই করুন।',
    'প্রতিষ্ঠানের তথ্য ও নথি ব্যবহারে গোপনীয়তা বজায় রাখুন।',
    'প্রয়োজনীয় নোটিফিকেশন চালু রাখুন, অপ্রয়োজনীয় নোটিফিকেশন কমিয়ে দিন।'
  ])
});

const SECTION_ALIASES = Object.freeze({
  dashboard: 'home', 'admin-dashboard': 'home', 'manager-dashboard': 'home',
  classes: 'work', students: 'work', staff: 'work', phonebook: 'work',
  academic: 'academic', academics: 'academic', exam: 'academic', exams: 'academic',
  'online-exams': 'academic', marks: 'academic', attendance: 'academic',
  homework: 'academic', suggestion: 'academic', routine: 'academic',
  'routine-view': 'academic', courses: 'academic', 'lecture-sheets': 'academic',
  notice: 'academic', notices: 'academic', results: 'academic',
  payment: 'finance', reports: 'finance', collection: 'finance',
  profile: 'more', settings: 'more', security: 'more', roles: 'more',
  data: 'more', backup: 'more', content: 'more', advice: 'more',
  system: 'more', more: 'more'
});

export function normalizeStaffAdviceSection(section = 'home') {
  const key = String(section || 'home').trim().toLowerCase();
  return SECTION_ALIASES[key] || (STAFF_ADVICE_BANK[key] ? key : 'home');
}

export function pickStaffSectionAdvice(section = 'home', now = Date.now()) {
  const key = normalizeStaffAdviceSection(section);
  const list = STAFF_ADVICE_BANK[key] || STAFF_ADVICE_BANK.home;
  try {
    const day = quoteDayNumber(quoteDateKey(now));
    const index = ((day % list.length) + list.length) % list.length;
    return list[index] || STAFF_ADVICE_BANK.home[0];
  } catch {
    return STAFF_ADVICE_BANK.home[0];
  }
}
