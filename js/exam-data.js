/* Local exam workflow adapter, NOT secure online authentication/proctoring.
   A production API must own authorization, time, answer keys and accepted submissions. */
import { teachingRepository, DEMO_TEACHER } from './teaching-data.js';
import { isTeacherAssigned, subjectsForTeacherClass } from './teacher-assignments.js';
import { isSubjectEnabled, academicCodes, chapterByName, ensureChapter as ensureAcademicChapter } from './academics.js';
import { allocateExamCode, examCodeParts, orderPaperForAttempt, timeLabel } from './exam-core.js';
import { hasStaffSession, readStaffAccount } from './staff-auth.js';
import { enabledClasses } from './config.js';
import { KEYS, readRaw, writeRaw, newId } from './database.js';
import { questionBank } from './question-bank.js';
export const EXAM_KEY = KEYS.exams;
export const EXAM_TYPES = Object.freeze({ mcq: 'MCQ', written: 'লিখিত', short: 'সংক্ষিপ্ত উত্তর' });
/* Draft → Review (pending) → Approved → Published → Completed → Archived.
   `rejected` is the correction branch off Review, and every status that ever
   existed stays in this map, so old records keep loading unchanged. */
export const EXAM_STATUSES = Object.freeze({
  draft: 'খসড়া',
  pending: 'অনুমোদনের অপেক্ষায়',
  approved: 'অনুমোদিত — প্রকাশের অপেক্ষায়',
  rejected: 'সংশোধনের জন্য ফেরত',
  published: 'প্রকাশিত',
  completed: 'সম্পন্ন',
  archived: 'আর্কাইভ'
});
/* The six stages a paper is talked about in the UI. They are *views* of the
   seven stored statuses plus the clock, so no stored record has to be rewritten
   (and none is lost): draft → scheduled → published → running → completed →
   archived. `rejected` stays the correction stop on the same line. */
export const EXAM_STAGES = Object.freeze({
  draft: 'খসড়া',
  scheduled: 'নির্ধারিত',
  published: 'প্রকাশিত',
  running: 'চলছে',
  completed: 'সম্পন্ন',
  archived: 'সংরক্ষিত'
});
export function examStageKey(exam, now = Date.now()) {
  const status = String(exam?.status || '');
  if (status === 'rejected') return 'scheduled';
  if (status === 'archived') return 'archived';
  if (status === 'draft') return 'draft';
  if (status === 'pending' || status === 'approved') return 'scheduled';
  if (status === 'completed') return 'completed';
  const startAt = Number(exam?.startAt), endAt = Number(exam?.endAt);
  if (status === 'published') {
    if (Number.isFinite(startAt) && now < startAt) return 'scheduled';
    if (Number.isFinite(endAt) && now < endAt) return 'running';
    return 'completed';
  }
  return 'draft';
}
export const examStageLabel = (exam, now) => EXAM_STAGES[examStageKey(exam, now)] || EXAM_STAGES.draft;
export const isRunningExam = (exam, now) => examStageKey(exam, now) === 'running';
export const examTimeLabel = value => timeLabel(value);
/* The workflow line a reviewer reads on screen (rejected is a branch, not a
   step on the happy path). */
export const EXAM_STATUS_ORDER = Object.freeze(['draft', 'pending', 'approved', 'published', 'completed', 'archived']);
/* A student may only ever see these two statuses; the rest are staff-only. */
export const STUDENT_VISIBLE_STATUSES = Object.freeze(['published', 'completed']);
/* Question text may change while the paper is still being prepared. */
export const EDITABLE_STATUSES = Object.freeze(['draft', 'rejected', 'pending']);
export const SUBMITTABLE_STATUSES = Object.freeze(['draft', 'rejected']);
export const PUBLISHABLE_STATUSES = Object.freeze(['draft', 'pending', 'approved']);
export const DELETABLE_STATUSES = Object.freeze(['draft', 'rejected', 'archived']);
export const isStudentVisibleExam = exam => STUDENT_VISIBLE_STATUSES.includes(exam?.status);
export const isLiveExam = exam => isStudentVisibleExam(exam);
export const isEditableExam = exam => EDITABLE_STATUSES.includes(exam?.status);
export const TEACHER_ACTOR = Object.freeze({ role: 'teacher', id: DEMO_TEACHER.id });
export const ADMIN_ACTOR = Object.freeze({ role: 'admin', id: 'ADMIN' });
export const MANAGER_ACTOR = Object.freeze({ role: 'manager', id: 'MANAGER' });
const fail = text => { throw new Error(text); };
const number = text => Number(String(text).replace(/[০-৯]/g, d => '০১২৩৪৫৬৭৮৯'.indexOf(d)));
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
export const totalMarks = exam => round(exam.questions.reduce((sum, q) => sum + q.marks, 0));
export const MCQ_MARKS = 1; // every MCQ question is worth exactly one mark
export const MCQ_30_SAMPLE = `প্রশ্ন: বাংলাদেশের রাজধানী কোনটি?
A: ঢাকা
B: চট্টগ্রাম
C: খুলনা
D: রাজশাহী
উত্তর: A
---
প্রশ্ন: বাংলাদেশের জাতীয় ফুল কোনটি?
A: গোলাপ
B: শাপলা
C: বেলি
D: জবা
উত্তর: B
---
প্রশ্ন: বাংলাদেশের জাতীয় ফল কোনটি?
A: আম
B: কাঁঠাল
C: কলা
D: লিচু
উত্তর: B
---
প্রশ্ন: বাংলাদেশের জাতীয় পশু কোনটি?
A: হাতি
B: সিংহ
C: রয়েল বেঙ্গল টাইগার
D: হরিণ
উত্তর: C
---
প্রশ্ন: বাংলাদেশের জাতীয় পাখি কোনটি?
A: কোকিল
B: ময়না
C: টিয়া
D: দোয়েল
উত্তর: D
---
প্রশ্ন: ৫ + ৭ = কত?
A: ১১
B: ১২
C: ১৩
D: ১৪
উত্তর: B
---
প্রশ্ন: ১২ × ৮ = কত?
A: ৮৪
B: ৯২
C: ৯৬
D: ১০৪
উত্তর: C
---
প্রশ্ন: ১০০ এর বর্গমূল কত?
A: ৫
B: ১০
C: ২০
D: ২৫
উত্তর: B
---
প্রশ্ন: সমকোণী ত্রিভুজের একটি কোণ কত ডিগ্রি?
A: ৪৫°
B: ৬০°
C: ৯০°
D: ১২০°
উত্তর: C
---
প্রশ্ন: বৃত্তের সম্পূর্ণ কোণের পরিমাপ কত?
A: ৯০°
B: ১৮০°
C: ২৭০°
D: ৩৬০°
উত্তর: D
---
প্রশ্ন: পানির রাসায়নিক সংকেত কোনটি?
A: CO2
B: H2O
C: NaCl
D: O2
উত্তর: B
---
প্রশ্ন: বাতাসের প্রধান উপাদান কোনটি?
A: অক্সিজেন
B: নাইট্রোজেন
C: কার্বন ডাই-অক্সাইড
D: হাইড্রোজেন
উত্তর: B
---
প্রশ্ন: সৌরজগতের বৃহত্তম গ্রহ কোনটি?
A: পৃথিবী
B: মঙ্গল
C: বৃহস্পতি
D: শনি
উত্তর: C
---
প্রশ্ন: সূর্যের সবচেয়ে নিকটতম গ্রহ কোনটি?
A: বুধ
B: শুক্র
C: পৃথিবী
D: মঙ্গল
উত্তর: A
---
প্রশ্ন: মানবদেহের সবচেয়ে বড় অঙ্গ কোনটি?
A: যকৃত
B: ত্বক
C: হৃৎপিণ্ড
D: ফুসফুস
উত্তর: B
---
প্রশ্ন: উদ্ভিদের খাদ্য তৈরির প্রক্রিয়ার নাম কী?
A: শ্বসন
B: প্রস্বেদন
C: সালোকসংশ্লেষণ
D: ব্যাপন
উত্তর: C
---
প্রশ্ন: বলের একক কী?
A: জুল
B: ওয়াট
C: নিউটন
D: প্যাসকেল
উত্তর: C
---
প্রশ্ন: আলোর গতিবেগ প্রতি সেকেন্ডে প্রায় কত কিমি?
A: ১ লাখ
B: ২ লাখ
C: ৩ লাখ
D: ৪ লাখ
উত্তর: C
---
প্রশ্ন: কম্পিউটারের মস্তিষ্ক বলা হয় কোনটিকে?
A: RAM
B: CPU
C: Hard Disk
D: Monitor
উত্তর: B
---
প্রশ্ন: WWW এর পূর্ণরূপ কী?
A: World Wide Web
B: World Wide War
C: World Web Wide
D: Web World Wide
উত্তর: A
---
প্রশ্ন: বাংলা ভাষার মূল উৎস কোনটি?
A: সংস্কৃত
B: প্রাকৃত
C: বৈদিক
D: পালি
উত্তর: B
---
প্রশ্ন: 'গীতাঞ্জলি' কাব্যের রচয়িতা কে?
A: কাজী নজরুল ইসলাম
B: রবীন্দ্রনাথ ঠাকুর
C: মাইকেল মধুসূদন দত্ত
D: জসীমউদ্দীন
উত্তর: B
---
প্রশ্ন: বাংলাদেশের স্বাধীনতা দিবস কোনটি?
A: ২১শে ফেব্রুয়ারি
B: ২৬শে মার্চ
C: ১৬ই ডিসেম্বর
D: পহেলা বৈশাখ
উত্তর: B
---
প্রশ্ন: বাংলাদেশের বিজয় দিবস কোনটি?
A: ২৬শে মার্চ
B: ২১শে ফেব্রুয়ারি
C: ৭ই মার্চ
D: ১৬ই ডিসেম্বর
উত্তর: D
---
প্রশ্ন: আন্তর্জাতিক মাতৃভাষা দিবস কোনটি?
A: ২১শে ফেব্রুয়ারি
B: ২৬শে মার্চ
C: ১৬ই ডিসেম্বর
D: ৭ই মার্চ
উত্তর: A
---
প্রশ্ন: মুজিবনগর সরকার কোন তারিখে শপথ গ্রহণ করে?
A: ৭ মার্চ ১৯৭১
B: ২৬ মার্চ ১৯৭১
C: ১০ এপ্রিল ১৯৭১
D: ১৭ এপ্রিল ১৯৭১
উত্তর: D
---
প্রশ্ন: বাংলাদেশের সংবিধানের মূলনীতি কয়টি?
A: ৩টি
B: ৪টি
C: ৫টি
D: ৬টি
উত্তর: B
---
প্রশ্ন: পৃথিবীর দীর্ঘতম নদী কোনটি?
A: আমাজন
B: নীল নদ
C: ইয়াংসিকিয়াং
D: মিসিসিপি
উত্তর: B
---
প্রশ্ন: বিশ্বের সর্বোচ্চ পর্বতশৃঙ্গ কোনটি?
A: কে-টু
B: কাঞ্চনজঙ্ঘা
C: মাউন্ট এভারেস্ট
D: মাকালু
উত্তর: C
---
প্রশ্ন: সুন্দরবনের প্রধান বৃক্ষ কোনটি?
A: শাল
B: সেগুন
C: সুন্দরী
D: গরান
উত্তর: C`;

export const MCQ_SAMPLE_TEMPLATES = Object.freeze([
  ['বাংলা — সাহিত্য', 'প্রশ্ন: রবীন্দ্রনাথ ঠাকুর কোন গ্রন্থের জন্য নোবেল পুরস্কার পান?\nA: গীতাঞ্জলি\nB: সোনার তরী\nC: বলাকা\nD: মানসী\nউত্তর: A'],
  ['বাংলা — ব্যাকরণ', 'প্রশ্ন: “বিদ্যালয়” শব্দের সন্ধিবিচ্ছেদ কোনটি?\nA: বিদ্যা + আলয়\nB: বিদ্য + আলয়\nC: বিদ্যা + লয়\nD: বিদ + আলয়\nউত্তর: A'],
  ['English — Grammar', 'প্রশ্ন: Choose the correct sentence.\nA: He go to school.\nB: He goes to school.\nC: He going school.\nD: He gone school.\nউত্তর: B'],
  ['English — Vocabulary', 'প্রশ্ন: What is the synonym of “rapid”?\nA: Slow\nB: Weak\nC: Fast\nD: Late\nউত্তর: C'],
  ['গণিত — মৌলিক', 'প্রশ্ন: ১২ × ৮ = কত?\nA: ৮৬\nB: ৯৬\nC: ১০৬\nD: ১১৬\nউত্তর: B'],
  ['গণিত — ভগ্নাংশ', 'প্রশ্ন: ১/২ + ১/৪ = কত?\nA: ১/৪\nB: ২/৪\nC: ৩/৪\nD: ৪/৪\nউত্তর: C'],
  ['গণিত — শতকরা', 'প্রশ্ন: ২০০-এর ২৫% কত?\nA: ২৫\nB: ৪০\nC: ৫০\nD: ৭৫\nউত্তর: C'],
  ['গণিত — বীজগণিত', 'প্রশ্ন: x + ৭ = ১২ হলে x-এর মান কত?\nA: ৩\nB: ৪\nC: ৫\nD: ৬\nউত্তর: C'],
  ['বিজ্ঞান — পদার্থ', 'প্রশ্ন: বলের SI একক কোনটি?\nA: জুল\nB: নিউটন\nC: ওয়াট\nD: প্যাসকেল\nউত্তর: B'],
  ['বিজ্ঞান — রসায়ন', 'প্রশ্ন: পানির রাসায়নিক সংকেত কোনটি?\nA: CO₂\nB: O₂\nC: H₂O\nD: NaCl\nউত্তর: C'],
  ['বিজ্ঞান — জীববিজ্ঞান', 'প্রশ্ন: উদ্ভিদের খাদ্য তৈরির প্রধান প্রক্রিয়া কোনটি?\nA: শ্বসন\nB: সালোকসংশ্লেষণ\nC: বাষ্পীভবন\nD: পরাগায়ন\nউত্তর: B'],
  ['বিজ্ঞান — মানবদেহ', 'প্রশ্ন: মানুষের হৃদপিণ্ডে কয়টি প্রকোষ্ঠ থাকে?\nA: ২\nB: ৩\nC: ৪\nD: ৫\nউত্তর: C'],
  ['বাংলাদেশ — মুক্তিযুদ্ধ', 'প্রশ্ন: বাংলাদেশের স্বাধীনতা দিবস কবে?\nA: ২১ ফেব্রুয়ারি\nB: ২৬ মার্চ\nC: ১৬ ডিসেম্বর\nD: ১৭ এপ্রিল\nউত্তর: B'],
  ['বাংলাদেশ — বিজয়', 'প্রশ্ন: বাংলাদেশের বিজয় দিবস কবে?\nA: ২৬ মার্চ\nB: ১৫ আগস্ট\nC: ১৬ ডিসেম্বর\nD: ২১ ফেব্রুয়ারি\nউত্তর: C'],
  ['বাংলাদেশ — ভূগোল', 'প্রশ্ন: বাংলাদেশের দীর্ঘতম সমুদ্রসৈকত কোথায়?\nA: কুয়াকাটা\nB: কক্সবাজার\nC: পতেঙ্গা\nD: সেন্ট মার্টিন\nউত্তর: B'],
  ['বাংলাদেশ — সংবিধান', 'প্রশ্ন: বাংলাদেশের সংবিধান কার্যকর হয় কবে?\nA: ২৬ মার্চ ১৯৭১\nB: ১৬ ডিসেম্বর ১৯৭১\nC: ৪ নভেম্বর ১৯৭২\nD: ১৬ ডিসেম্বর ১৯৭২\nউত্তর: D'],
  ['বিশ্ব — ভূগোল', 'প্রশ্ন: পৃথিবীর বৃহত্তম মহাদেশ কোনটি?\nA: আফ্রিকা\nB: ইউরোপ\nC: এশিয়া\nD: অস্ট্রেলিয়া\nউত্তর: C'],
  ['বিশ্ব — মহাসাগর', 'প্রশ্ন: পৃথিবীর বৃহত্তম মহাসাগর কোনটি?\nA: আটলান্টিক\nB: ভারত\nC: প্রশান্ত\nD: আর্কটিক\nউত্তর: C'],
  ['ICT — কম্পিউটার', 'প্রশ্ন: CPU-এর পূর্ণরূপ কী?\nA: Central Processing Unit\nB: Computer Primary Unit\nC: Central Program Utility\nD: Control Processing User\nউত্তর: A'],
  ['ICT — ইন্টারনেট', 'প্রশ্ন: WWW-এর পূর্ণরূপ কী?\nA: World Wide Web\nB: World Web Window\nC: Wide World Wire\nD: Web World Work\nউত্তর: A'],
  ['ICT — নিরাপত্তা', 'প্রশ্ন: শক্তিশালী পাসওয়ার্ডের বৈশিষ্ট্য কোনটি?\nA: শুধু নাম\nB: শুধু জন্মতারিখ\nC: বিভিন্ন ধরনের অক্ষর ও সংখ্যা\nD: শুধু 123456\nউত্তর: C'],
  ['সাধারণ জ্ঞান — বিজ্ঞান', 'প্রশ্ন: সূর্যের সবচেয়ে কাছের গ্রহ কোনটি?\nA: শুক্র\nB: পৃথিবী\nC: বুধ\nD: মঙ্গল\nউত্তর: C'],
  ['সাধারণ জ্ঞান — মহাকাশ', 'প্রশ্ন: পৃথিবীর একমাত্র প্রাকৃতিক উপগ্রহ কোনটি?\nA: সূর্য\nB: চাঁদ\nC: মঙ্গল\nD: শুক্র\nউত্তর: B'],
  ['ভূগোল — জলবায়ু', 'প্রশ্ন: বৃষ্টিপাত পরিমাপের যন্ত্র কোনটি?\nA: ব্যারোমিটার\nB: রেইন গেজ\nC: থার্মোমিটার\nD: অ্যানিমোমিটার\nউত্তর: B'],
  ['ইতিহাস — প্রাচীন', 'প্রশ্ন: মিশরের বিখ্যাত প্রাচীন স্থাপনা কোনটি?\nA: পিরামিড\nB: কলোসিয়াম\nC: তাজমহল\nD: বিগ বেন\nউত্তর: A'],
  ['নৈতিক শিক্ষা', 'প্রশ্ন: সত্য কথা বলার বিপরীত আচরণ কোনটি?\nA: সততা\nB: ন্যায়পরায়ণতা\nC: মিথ্যাচার\nD: সহমর্মিতা\nউত্তর: C'],
  ['ব্যবসায় শিক্ষা', 'প্রশ্ন: সম্পদের মালিকানার প্রমাণ হিসেবে কোনটি ব্যবহৃত হয়?\nA: সম্পদ দলিল\nB: উপস্থিতি খাতা\nC: রুটিন\nD: বিজ্ঞাপন\nউত্তর: A'],
  ['অর্থনীতি', 'প্রশ্ন: চাহিদা সাধারণত কোন বিষয়ের সঙ্গে সম্পর্কিত?\nA: ক্রেতার ইচ্ছা ও ক্রয়ক্ষমতা\nB: শুধু উৎপাদন\nC: শুধু কর\nD: শুধু রপ্তানি\nউত্তর: A'],
  ['জীবনদক্ষতা', 'প্রশ্ন: পরীক্ষার প্রস্তুতিতে কোন পদ্ধতিটি বেশি সহায়ক?\nA: শেষ রাতে সব পড়া\nB: নিয়মিত পরিকল্পিত অনুশীলন\nC: পড়া বাদ দেওয়া\nD: শুধু অনুমান করা\nউত্তর: B'],
  ['পরিবেশ', 'প্রশ্ন: পরিবেশ রক্ষায় কোন কাজটি সহায়ক?\nA: বৃক্ষরোপণ\nB: প্লাস্টিক পোড়ানো\nC: নদীতে বর্জ্য ফেলা\nD: অযথা পানি অপচয়\nউত্তর: A']
]);
/* Sample questions for the other two exam types, in the same shape the teacher
   pastes: a question line, a marks line, and `---` between questions. */
export const WRITTEN_SAMPLE_TEMPLATES = Object.freeze([
  ['বাংলা — প্রবন্ধ', 'প্রশ্ন: “দেশপ্রেম” শিরোনামে একটি প্রবন্ধ লেখো।\nনম্বর: ১০\n---\nপ্রশ্ন: “সোনার তরী” কবিতার মূলভাব নিজের ভাষায় লেখো।\nনম্বর: ৫'],
  ['English — Paragraph', 'প্রশ্ন: Write a paragraph on “Our National Flag”.\nনম্বর: ১০\n---\nপ্রশ্ন: Write a short composition on “Your Daily Routine”.\nনম্বর: ৫'],
  ['গণিত — সমাধান', 'প্রশ্ন: সমাধান করো: ৩x + ৫ = ২০।\nনম্বর: ৫\n---\nপ্রশ্ন: একটি আয়তাকার বাগানের দৈর্ঘ্য ১২ মিটার ও প্রস্থ ৮ মিটার হলে ক্ষেত্রফল নির্ণয় করো।\nনম্বর: ১০'],
  ['বিজ্ঞান — ব্যাখ্যা', 'প্রশ্ন: সালোকসংশ্লেষণ প্রক্রিয়া ধাপে ধাপে ব্যাখ্যা করো।\nনম্বর: ১০\n---\nপ্রশ্ন: পানির তিনটি অবস্থার পরিবর্তন উদাহরণসহ লেখো।\nনম্বর: ৫'],
  ['বাংলাদেশ — মুক্তিযুদ্ধ', 'প্রশ্ন: মুক্তিযুদ্ধে বাংলাদেশের জনগণের ভূমিকা আলোচনা করো।\nনম্বর: ১০\n---\nপ্রশ্ন: ৭ মার্চের ভাষণের তাৎপর্য লেখো।\nনম্বর: ৫'],
  ['ICT — ব্যবহার', 'প্রশ্ন: কম্পিউটারের প্রধান অংশগুলো চিত্রসহ বর্ণনা করো।\nনম্বর: ১০\n---\nপ্রশ্ন: ইন্টারনেট ব্যবহারে নিরাপত্তার পাঁচটি নিয়ম লেখো।\nনম্বর: ৫']
]);

export const SHORT_SAMPLE_TEMPLATES = Object.freeze([
  ['বাংলা — সংক্ষিপ্ত', 'প্রশ্ন: “বিদ্যালয়” শব্দের সন্ধিবিচ্ছেদ কী?\nনম্বর: ১\n---\nপ্রশ্ন: এক কথায় প্রকাশ করো: যা বলা হয়নি।\nনম্বর: ২'],
  ['English — Short answer', 'প্রশ্ন: What is the past form of “go”?\nনম্বর: ১\n---\nপ্রশ্ন: Write two uses of a dictionary.\nনম্বর: ২'],
  ['গণিত — সংক্ষিপ্ত', 'প্রশ্ন: ২০০-এর ২৫% কত?\nনম্বর: ১\n---\nপ্রশ্ন: ৪৮ ও ৬০-এর গসাগু নির্ণয় করো।\nনম্বর: ২'],
  ['বিজ্ঞান — সংক্ষিপ্ত', 'প্রশ্ন: বলের SI একক কী?\nনম্বর: ১\n---\nপ্রশ্ন: মরিচা পড়ার দুইটি কারণ লেখো।\nনম্বর: ২'],
  ['বাংলাদেশ — সংক্ষিপ্ত', 'প্রশ্ন: বাংলাদেশের স্বাধীনতা দিবস কবে?\nনম্বর: ১\n---\nপ্রশ্ন: ভাষা আন্দোলনের তাৎপর্য দুই বাক্যে লেখো।\nনম্বর: ২'],
  ['ICT — সংক্ষিপ্ত', 'প্রশ্ন: CPU-এর পূর্ণরূপ কী?\nনম্বর: ১\n---\nপ্রশ্ন: ইমেইল ব্যবহারের দুইটি সুবিধা লেখো।\nনম্বর: ২']
]);

/** The sample question sets the teacher picks from, one list per exam type. */
export const EXAM_SAMPLE_TEMPLATES = Object.freeze({
  mcq: MCQ_SAMPLE_TEMPLATES,
  written: WRITTEN_SAMPLE_TEMPLATES,
  short: SHORT_SAMPLE_TEMPLATES
});

/* One ready-made template per exam type: what the teacher copies, pastes and
   edits. Each type keeps its own shape — MCQ has no marks line (the mark is
   fixed at 1), the written and short-answer templates show their own marks. */
export const examTemplate = type => ({
  mcq: 'প্রশ্ন: বাংলাদেশের রাজধানী কোনটি?\nA: ঢাকা\nB: চট্টগ্রাম\nC: খুলনা\nD: রাজশাহী\nউত্তর: A\n---\nপ্রশ্ন: ৫ + ৩ = কত?\nA: ৬\nB: ৭\nC: ৮\nD: ৯\nউত্তর: C',
  written: 'প্রশ্ন: “দেশপ্রেম” শিরোনামে একটি প্রবন্ধ লেখো।\nনম্বর: ১০\n---\nপ্রশ্ন: পরিবেশ রক্ষায় গাছের গুরুত্ব লেখো।\nনম্বর: ৫',
  short: 'প্রশ্ন: ২০০-এর ২৫% কত?\nনম্বর: ১\n---\nপ্রশ্ন: বলের SI একক কী?\nনম্বর: ২'
})[type];

export function parseQuestions(text, type) {
  if (!Object.hasOwn(EXAM_TYPES, type)) fail('পরীক্ষার ধরন নির্বাচন করুন।');
  if (!String(text).trim() || String(text).length > 150000) fail('প্রশ্নের টেমপ্লেট পূরণ করুন (সর্বোচ্চ ১৫০,০০০ অক্ষর)।');
  const blocks = String(text).trim().split(/^\s*---+\s*$/m).filter(b => b.trim());
  if (!blocks.length || blocks.length > 100) fail('একটি পরীক্ষায় ১–১০০টি প্রশ্ন দিন।');
  const questions = blocks.map((block, i) => {
    const fields = {};
    for (const line of block.trim().split('\n').filter(l => l.trim())) {
      const match = line.match(/^\s*(প্রশ্ন|নম্বর|উত্তর|Question|Marks|Answer|[A-D])\s*[:：]\s*(.*?)\s*$/i);
      if (!match) fail(`প্রশ্ন ${i + 1}: টেমপ্লেটের প্রতিটি লাইন “প্রশ্ন:”, “নম্বর:” বা নির্ধারিত অপশন দিয়ে শুরু করুন।`);
      let key = match[1].toLowerCase();
      key = ({ 'প্রশ্ন': 'question', 'নম্বর': 'marks', 'উত্তর': 'answer' })[key] || key;
      if (Object.hasOwn(fields, key)) fail(`প্রশ্ন ${i + 1}: একই ঘর দুবার দেওয়া হয়েছে।`);
      fields[key] = match[2];
    }
    const label = `প্রশ্ন ${i + 1}`;
    if (type === 'mcq' && fields.marks !== undefined && number(fields.marks) !== MCQ_MARKS) fail(`${label}: MCQ-তে প্রতি প্রশ্নের নম্বর ১ নির্ধারিত — “নম্বর:” লাইনটি বাদ দিন।`);
    if (type !== 'mcq' && (fields.answer || ['a', 'b', 'c', 'd'].some(k => fields[k]))) fail(`${label}: লিখিত/সংক্ষিপ্ত পরীক্ষায় অপশন বা উত্তর দেবেন না।`);
    return {
      id: `q${i + 1}`,
      ...cleanQuestion({
        text: fields.question,
        marks: type === 'mcq' ? MCQ_MARKS : fields.marks,
        options: type === 'mcq' ? ['A', 'B', 'C', 'D'].map(id => ({ id, text: fields[id.toLowerCase()] })) : undefined,
        answer: fields.answer
      }, type, label)
    };
  });
  if (totalMarks({ questions }) > 10000) fail('মোট নম্বর সর্বোচ্চ ১০,০০০ হতে পারে।');
  return questions;
}
/* ---------- Date-wise identity ------------------------------------------- */
const examDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The Asia/Dhaka calendar date a timestamp belongs to, as 'YYYY-MM-DD'. */
export function dhakaDateKey(value = Date.now()) {
  const parts = examDateFormatter.formatToParts(new Date(Number(value)));
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
/** The date the paper is actually sat: MCQ on its start date, class papers on
    the next class day — the same rule the classroom workflow already used. */
export function examDateFor(type, startAt) {
  return type === 'mcq' ? dhakaDateKey(startAt) : classExamDate(startAt);
}
/** Which date group a stored exam belongs to. Records saved before this
    workflow existed carry no examDate and are placed by their own schedule. */
export function examDateOf(exam) {
  const stored = String(exam?.examDate || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
  const startAt = Number(exam?.startAt);
  return Number.isFinite(startAt) ? examDateFor(exam?.type, startAt) : '';
}
export function examDurationMinutes(exam) {
  if (Number.isFinite(exam?.durationMinutes)) return exam.durationMinutes;
  const startAt = Number(exam?.startAt), endAt = Number(exam?.endAt);
  return Number.isFinite(startAt) && Number.isFinite(endAt) && endAt > startAt ? Math.round((endAt - startAt) / 60000) : 0;
}
export const examQuestionUid = (exam, question, index = 0) => question?.uid || `${exam.id}-q${index + 1}`;
/** One question together with the exam context the archive must show with it.
    This is the read-only projection used by the UI and by reports — it never
    writes anything back into the exam record. */
export function questionRecord(exam, question) {
  return {
    uid: examQuestionUid(exam, question, exam.questions.indexOf(question)),
    id: question.id,
    examId: exam.id,
    examName: exam.title,
    examDate: examDateOf(exam),
    subject: exam.subject,
    className: exam.className,
    group: exam.group || '',
    totalQuestions: exam.questions.length,
    marks: question.marks,
    totalMarks: totalMarks(exam),
    duration: examDurationMinutes(exam),
    createdBy: exam.createdBy || exam.teacherName || '',
    createdAt: Number(exam.createdAt) || 0,
    status: exam.status,
    text: question.text,
    options: question.options ? question.options.map(option => ({ ...option })) : null,
    answer: question.answer || ''
  };
}
/** The canonical shape of a question — exactly what the paste template has to
    reproduce. Extra identity fields (uid/examId/context) are additive and
    never take part in this comparison, so old records keep loading as-is. */
export function questionSignature(questions) {
  return JSON.stringify((questions || []).map(question => ({
    id: question?.id,
    text: question?.text,
    marks: question?.marks,
    options: question?.options ? question.options.map(option => ({ id: option.id, text: option.text })) : null,
    answer: question?.answer ?? null
  })));
}
/** Validates one question (new or edited) against the same rules the pasted
    template is held to. */
export function cleanQuestion(input, type, label = 'প্রশ্ন') {
  const text = String(input?.text ?? '').trim();
  if (!text || text.length > 1200) fail(`${label}: প্রশ্নের লেখা দিন (সর্বোচ্চ ১২০০ অক্ষর)।`);
  if (type === 'mcq') {
    const options = (input?.options || [])
      .map(option => ({ id: String(option?.id || '').trim().toUpperCase(), text: String(option?.text ?? '').trim() }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const answer = String(input?.answer ?? '').trim().toUpperCase();
    if (options.length !== 4 || options.map(option => option.id).join('') !== 'ABCD' || options.some(option => !option.text || option.text.length > 500) || !['A', 'B', 'C', 'D'].includes(answer)) fail(`${label}: চারটি অপশন ও সঠিক উত্তর A/B/C/D দিন।`);
    if (new Set(options.map(option => option.text)).size !== 4) fail(`${label}: একই অপশন একাধিকবার দেওয়া যাবে না।`);
    return { text, marks: MCQ_MARKS, options, answer };
  }
  const marks = number(input?.marks);
  if (!Number.isFinite(marks) || marks <= 0 || marks > 1000 || round(marks) !== marks) fail(`${label}: নম্বর ১ থেকে ১০০০-এর মধ্যে পূর্ণসংখ্যা দিন।`);
  /* A short/written question may carry the model answer (shown only in the
     answer key). It is additive: the paste template and the stored signature
     never depended on it, so older papers load exactly as before. */
  const answerText = String(input?.answerText ?? '').trim().slice(0, 1200);
  return answerText ? { text, marks, answerText } : { text, marks };
}
/** Rebuild the paste template from the question records, so editing or
    deleting one question keeps template and records in lock-step. */
export function serializeQuestions(questions, type) {
  if (!Object.hasOwn(EXAM_TYPES, type)) fail('পরীক্ষার ধরন নির্বাচন করুন।');
  return questions.map(question => type === 'mcq'
    ? [`প্রশ্ন: ${question.text}`, ...question.options.map(option => `${option.id}: ${option.text}`), `উত্তর: ${question.answer}`].join('\n')
    : [`প্রশ্ন: ${question.text}`, `নম্বর: ${question.marks}`].join('\n')).join('\n---\n');
}
/** The exam facts a question was written against. Kept small on purpose:
    everything that changes often (status, totals) is derived from the exam. */
function questionContext(exam) {
  const context = { examDate: examDateOf(exam), subject: exam.subject, className: exam.className };
  if (exam.group) context.group = exam.group;
  return context;
}
/** Gives every question a unique, stable id and a copy of its exam context.
    Existing uids are kept, so an edited question keeps its identity. */
export function restampExamQuestions(exam, previous = []) {
  const keptUids = new Map((previous || [])
    .map((question, index) => [question?.id || `q${index + 1}`, question?.uid])
    .filter(([, uid]) => typeof uid === 'string' && uid));
  const seen = new Set();
  exam.questions = (exam.questions || []).map((question, index) => {
    let uid = question.uid || keptUids.get(question.id) || '';
    let attempt = 0;
    while (!uid || seen.has(uid)) { attempt += 1; uid = `${exam.id}-q${index + 1}${attempt > 1 ? `-${attempt}` : ''}`; }
    seen.add(uid);
    return { ...question, id: `q${index + 1}`, uid, examId: exam.id, context: questionContext(exam) };
  });
  return exam.questions;
}
/** Read-time view of a stored exam: fills in the date-wise identity fields a
    record saved before this workflow did not have. Additive only — nothing is
    removed and the canonical question data is left untouched. */
export function normalizeExam(exam) {
  if (!exam || typeof exam !== 'object') return exam;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(exam.examDate || ''))) exam.examDate = examDateOf(exam);
  if (!Number.isFinite(exam.durationMinutes)) exam.durationMinutes = examDurationMinutes(exam);
  if (typeof exam.createdBy !== 'string' || !exam.createdBy) exam.createdBy = String(exam.teacherName || '').trim();
  if (exam.createdByRole !== 'teacher' && exam.createdByRole !== 'manager') exam.createdByRole = 'teacher';
  if (exam.questionOrder !== 'fixed') exam.questionOrder = 'shuffle';
  if (exam.optionOrder !== 'fixed') exam.optionOrder = 'shuffle';
  if (typeof exam.chapterId !== 'string') exam.chapterId = '';
  if (typeof exam.chapterName !== 'string') exam.chapterName = '';
  if (typeof exam.topic !== 'string') exam.topic = '';
  if (typeof exam.batchId !== 'string') exam.batchId = '';
  if (typeof exam.batchName !== 'string') exam.batchName = String(exam.group || '');
  if (!Number.isFinite(exam.passingMarks)) exam.passingMarks = Math.round(totalMarks(exam) * (Number(exam.passPercent) || 33) / 100);
  if (!Number.isFinite(exam.negativeMarks)) exam.negativeMarks = Number(exam.negative) || 0;
  if (typeof exam.startTime !== 'string') exam.startTime = timeLabel(exam.startAt);
  if (typeof exam.endTime !== 'string') exam.endTime = timeLabel(exam.endAt);
  if (exam.questions) restampExamQuestions(exam, exam.questions);
  return exam;
}

export function classExamDate(startAt) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(startAt);
  const get = type => parts.find(p => p.type === type).value;
  const date = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00+06:00`);
  date.setTime(date.getTime() + 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
/* Exams saved before the class picker existed carry no className and stay
   visible to every class; new exams name the class they belong to. */
export function examMatchesClass(exam, className) {
  return !exam.className || exam.className === className;
}
export function examMatchesStudent(exam, student) {
  const normalize = value => String(value || '').normalize('NFC').trim().replace(/\s*বিভাগ$/, '').trim();
  return examMatchesClass(exam, student?.className) && (!exam.group || normalize(exam.group) === normalize(student?.group));
}
export function validateExam(input) {
  const title = String(input.title || '').trim(), subject = String(input.subject || '').trim();
  if (!title || title.length > 150 || !subject || subject.length > 80) fail('পরীক্ষার নাম ও একটি বিষয় দিন।');
  const className = String(input.className || '').trim(), group = String(input.group || '').trim();
  if (className && !enabledClasses.includes(className)) fail('সঠিক শ্রেণি নির্বাচন করুন।');
  if (group.length > 80) fail('Batch/Group সর্বোচ্চ ৮০ অক্ষরের মধ্যে দিন।');
  const startAt = Number(input.startAt), endAt = Number(input.endAt), lateMinutes = input.type === 'mcq' ? Number(input.lateMinutes ?? 10) : 0, negative = Number(input.negative ?? 0), passPercent = Number(input.passPercent ?? 33);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt || endAt - startAt > 86400000 || startAt < 1577836800000 || endAt > 4102444800000) fail('সঠিক শুরু ও শেষ সময় দিন; সময়কাল সর্বোচ্চ ২৪ ঘণ্টা।');
  if (input.type === 'mcq' && (!Number.isInteger(lateMinutes) || lateMinutes < 1 || lateMinutes * 60000 > endAt - startAt)) fail('দেরিতে প্রবেশের সীমা ১ মিনিট থেকে পরীক্ষার সময়কালের মধ্যে দিন।');
  if (!Number.isFinite(negative) || negative < 0 || negative > 1000 || round(negative) !== negative) fail('ভুল উত্তরে কাটা নম্বর ০–১০০০-এর মধ্যে দিন।');
  if (!Number.isFinite(passPercent) || passPercent < 1 || passPercent > 100) fail('পাসের হার ১–১০০ শতাংশ দিন।');
  const instructions = String(input.instructions || '').trim();
  if (instructions.length > 2000) fail('নির্দেশনা সর্বোচ্চ ২০০০ অক্ষরে দিন।');
  const questions = parseQuestions(input.template, input.type);
  /* New fields are all optional and length-capped, so a record saved by an
     older build still validates untouched. */
  const chapterName = String(input.chapterName || '').trim().slice(0, 120);
  const chapterId = String(input.chapterId || '').trim().slice(0, 120);
  const topic = String(input.topic || '').trim().slice(0, 120);
  const batchName = String(input.batchName ?? input.group ?? '').trim().slice(0, 80);
  const orderMode = value => (value === 'fixed' ? 'fixed' : 'shuffle');
  const marks = totalMarks({ questions });
  return {
    title, subject, className, group, type: input.type, startAt, endAt, lateMinutes,
    negative: input.type === 'mcq' ? negative : 0, passPercent, instructions,
    chapterName, chapterId, topic, batchName,
    passingMarks: Number.isFinite(Number(input.passingMarks))
      ? Math.max(0, Math.min(marks, round(Number(input.passingMarks))))
      : Math.round(marks * passPercent / 100),
    negativeMarks: input.type === 'mcq' ? negative : 0,
    questionOrder: orderMode(input.questionOrder), optionOrder: orderMode(input.optionOrder),
    startTime: timeLabel(startAt), endTime: timeLabel(endAt),
    template: input.template, questions,
    /* Date-wise identity of the record: the calendar date the paper belongs
       to (Asia/Dhaka) and how long the window lasts. Re-derived on every
       save, so changing the date re-files the record on the new day. */
    examDate: examDateFor(input.type, startAt),
    durationMinutes: Math.round((endAt - startAt) / 60000)
  };
}
function read() {
  const raw = readRaw(EXAM_KEY);
  if (raw === null) return { version: 1, exams: [], attempts: [] };
  let db; try { db = JSON.parse(raw); } catch { fail('পরীক্ষার সংরক্ষিত ডেটা ক্ষতিগ্রস্ত। ডেটা না মুছে সহায়তা নিন।'); }
  if (db?.version !== 1 || !Array.isArray(db.exams) || !Array.isArray(db.attempts)) fail('পরীক্ষার ডেটা সঠিক নয়।');
  const ids = new Set();
  for (const e of db.exams) {
    if (!e || typeof e.id !== 'string' || ids.has(e.id) || !Object.hasOwn(EXAM_STATUSES, e.status) || typeof e.teacherId !== 'string' || !Array.isArray(e.participants)) fail('পরীক্ষার ডেটা সঠিক নয়।');
    if (e.participants.some(p => !p || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.className !== 'string') || (e.absentIds !== undefined && (!Array.isArray(e.absentIds) || e.absentIds.some(id => typeof id !== 'string')))) fail('পরীক্ষার শিক্ষার্থী তালিকা সঠিক নয়।');
    ids.add(e.id); const fields = validateExam(e);
    /* Compared field by field: a stored question may carry extra identity
       fields (uid/examId/context) that the paste template does not produce. */
    if (questionSignature(fields.questions) !== questionSignature(e.questions)) fail('সংরক্ষিত প্রশ্ন সঠিক নেই।');
    normalizeExam(e);
  }
  const attemptIds = new Set(), attemptNumbers = new Set();
  for (const a of db.attempts) {
    const e = db.exams.find(e => e.id === a?.examId);
    if (!e || typeof a.id !== 'string' || attemptIds.has(a.id) || typeof a.studentId !== 'string' || !['active', 'queued', 'submitted'].includes(a.status) || ![1, 2].includes(a.number) || !a.answers || typeof a.answers !== 'object' || !Array.isArray(a.order) || !Number.isFinite(a.startedAt)) fail('পরীক্ষার উত্তর/ফলাফলের ডেটা সঠিক নয়।');
    const attemptKey = `${e.id}/${a.studentId}/${a.number}`;
    if (attemptNumbers.has(attemptKey) || typeof a.name !== 'string' || typeof a.className !== 'string') fail('পরীক্ষার প্রচেষ্টার ডেটা সঠিক নয়।');
    attemptNumbers.add(attemptKey); attemptIds.add(a.id);
    if (e.type === 'mcq' && (a.order.length !== e.questions.length || new Set(a.order.map(q => q?.id)).size !== e.questions.length || a.order.some(q => !q || !e.questions.some(item => item.id === q.id) || !Array.isArray(q.options) || [...q.options].sort().join('') !== 'ABCD'))) fail('সংরক্ষিত প্রশ্নের ক্রম সঠিক নয়।');
    if (a.status !== 'active' && !Number.isFinite(a.finishedAt)) fail('উত্তরপত্রের জমার সময় সঠিক নয়।');
    if (e.type === 'mcq' && Object.entries(a.answers).some(([id, option]) => !e.questions.some(q => q.id === id && q.options.some(o => o.id === option)))) fail('সংরক্ষিত উত্তর সঠিক নয়।');
    if (a.status === 'submitted' && e.type === 'mcq' && Object.entries(scoreAttempt(e, a)).some(([key, value]) => a[key] !== value)) fail('সংরক্ষিত ফলাফল উত্তরের সঙ্গে মিলছে না।');
    if (a.status === 'submitted' && (!Number.isFinite(a.score) || a.score < 0 || a.score > totalMarks(e))) fail('সংরক্ষিত ফলাফল সঠিক নয়।');
  }
  return db;
}
async function mutate(fn) {
  const task = () => { const db = read(); fn(db); stampExamCodes(db); writeRaw(EXAM_KEY, JSON.stringify(db)); window.dispatchEvent(new Event('exam-data-updated')); return db; };
  return navigator.locks ? navigator.locks.request(EXAM_KEY, task) : task();
}
function examById(db, id) { const e = db.exams.find(e => e.id === id); if (!e) fail('পরীক্ষাটি পাওয়া যায়নি।'); return e; }
function teacherOwns(exam, actor) {
  if (actor?.role !== 'teacher' || actor.id !== exam.teacherId || !isTeacherAssigned('teacher.apc', exam.className, exam.group || '')) fail('শুধু দায়িত্বপ্রাপ্ত শিক্ষক এবং Manager-assigned class এই কাজ করতে পারবেন।');
}
function requireManager(actor) { if (actor?.role !== 'manager') fail('শুধু Manager পরীক্ষা অনুমোদন করতে পারবেন।'); }
async function requireRoleSession(role) {
  if (!(await hasStaffSession(role))) fail(`সক্রিয় ${role === 'teacher' ? 'Teacher' : 'Manager'} session ছাড়া এই কাজ করা যাবে না।`);
  const account = await readStaffAccount(role);
  if (!account || ['disabled', 'inactive', 'rejected'].includes(account.status) || account.accountStatus === 'disabled') fail(`সক্রিয় ${role === 'teacher' ? 'Teacher' : 'Manager'} profile ছাড়া এই কাজ করা যাবে না।`);
}
function eligibleParticipant(exam, student) {
  const found = (exam.participants || []).find(person => person.id === student?.id);
  if (!found) fail('শুধু পরীক্ষার অনুমোদিত participant পরীক্ষা দিতে পারবে।');
  return { id: found.id, name: found.name, className: found.className, group: found.group || '' };
}
/* Whether an exam's questions may still be changed. Publishing (or any
   answer already saved against it) locks the paper for good. */
function assertCanEditPaper(exam, db, actor) {
  if (!EDITABLE_STATUSES.includes(exam.status)) fail('প্রকাশিত/সম্পন্ন/আর্কাইভ করা পরীক্ষার প্রশ্ন বদলানো যাবে না।');
  if (db.attempts.some(a => a.examId === exam.id)) fail('উত্তর বা ফলাফল থাকা পরীক্ষার প্রশ্ন বদলানো যাবে না।');
  if (actor?.role === 'teacher') teacherOwns(exam, actor);
  else if (actor?.role !== 'manager') fail('শিক্ষক বা Manager প্রশ্ন বদলাতে পারবেন।');
}
const examHasOpenAttempts = (db, id) => db.attempts.some(a => a.examId === id && ['active', 'queued'].includes(a.status));
function examSnapshot(db, actor) { return actor?.role === 'teacher' ? teacherExamSnapshot(db, actor) : db; }
/** Who is asking: a Teacher writes their own papers, a Manager every paper. */
async function paperActor(actor) {
  if (actor?.role !== 'teacher' && actor?.role !== 'manager') fail('শিক্ষক বা Manager প্রশ্ন তৈরি ও সম্পাদনা করতে পারবেন।');
  await requireRoleSession(actor.role);
  const account = await readStaffAccount(actor.role);
  const name = String(account?.fullName || account?.username || '').trim();
  if (!name) fail(`${actor.role === 'teacher' ? 'Teacher' : 'Manager'} profile পাওয়া যায়নি।`);
  return name;
}
async function managerActor(actor) {
  requireManager(actor);
  await requireRoleSession('manager');
  const account = await readStaffAccount('manager');
  const name = String(account?.fullName || account?.username || '').trim();
  if (!name) fail('Manager profile পাওয়া যায়নি।');
  return name;
}
/** Same clock time, moved to the next day when the old slot has passed. */
function nextOccurrence(startAt, now) {
  const source = new Date(Number(startAt) || Number(now));
  const next = new Date(Number(now) + 86400000);
  next.setHours(source.getHours(), source.getMinutes(), 0, 0);
  if (next.getTime() <= Number(now)) next.setTime(next.getTime() + 86400000);
  return next.getTime();
}
function teacherExamSnapshot(db, actor = TEACHER_ACTOR) {
  const exams = db.exams.filter(exam => exam.teacherId === actor.id && isTeacherAssigned('teacher.apc', exam.className, exam.group || ''));
  const ids = new Set(exams.map(exam => exam.id));
  return { ...db, exams, attempts: db.attempts.filter(attempt => ids.has(attempt.examId)) };
}
function attemptById(db, id, studentId) {
  const a = db.attempts.find(a => a.id === id && a.studentId === studentId);
  if (!a) fail('এই উত্তরপত্র পাওয়া যায়নি।'); return a;
}
/** Register a chapter typed into a paper into Academic Setup (idempotent).
    The chapter then appears in every cascading picker, exam or course. */
export async function ensureChapter(className, subjectName, chapterName, actor = 'SYSTEM') {
  const name = String(chapterName || '').trim();
  if (!name) return null;
  try { return await ensureAcademicChapter(className, subjectName, name); }
  catch { return chapterByName(className, subjectName, name); }
}

function academicCodesSafe(className, subjectName) {
  try { return academicCodes(className, subjectName) || {}; } catch { return {}; }
}
/** The Exam Code a record carries; a record without one shows a preview built
    from its own type/date/class/subject until the next write stamps it. */
export function examCodeOf(exam) {
  const stored = String(exam?.code || '').trim();
  if (stored) return stored;
  const codes = academicCodesSafe(exam?.className, exam?.subject);
  const generated = allocateExamCode([], {
    type: exam?.type, startAt: exam?.startAt, examDate: exam?.examDate,
    classCode: exam?.classCode || codes.classCode, subjectCode: exam?.subjectCode || codes.subjectCode
  });
  return generated.code;
}
/** Permanent codes are handed out exactly once, oldest record first, so the
    serials never collide and a rescheduled/renamed paper keeps its code. */
export function stampExamCodes(db) {
  let changed = false;
  for (const exam of [...(db?.exams || [])].reverse()) {
    if (String(exam.code || '').trim()) continue;
    const codes = academicCodesSafe(exam.className, exam.subject);
    const allocated = allocateExamCode(db.exams.filter(row => row !== exam), {
      type: exam.type, startAt: exam.startAt, examDate: exam.examDate,
      classCode: exam.classCode || codes.classCode, subjectCode: exam.subjectCode || codes.subjectCode
    });
    exam.code = allocated.code;
    exam.classCode = exam.classCode || allocated.classCode;
    exam.subjectCode = exam.subjectCode || allocated.subjectCode;
    exam.codeLockedAt = Number(exam.codeLockedAt) || Date.now();
    changed = true;
  }
  for (const exam of db?.exams || []) {
    const parts = examCodeParts(exam.code);
    if (!exam.classCode && parts.classCode) { exam.classCode = parts.classCode; changed = true; }
    if (!exam.subjectCode && parts.subjectCode) { exam.subjectCode = parts.subjectCode; changed = true; }
  }
  return changed;
}
/** One exam located by its printed code (archive + paper search). */
export const examByCode = (db, code) => (db?.exams || []).find(exam => String(exam.code || '').toUpperCase() === String(code || '').trim().toUpperCase()) || null;
export function scoreAttempt(exam, attempt) {
  let score = 0, correct = 0, wrong = 0, unanswered = 0;
  for (const q of exam.questions) {
    const answer = attempt.answers[q.id];
    if (!answer) unanswered++; else if (answer === q.answer) { correct++; score += q.marks; } else { wrong++; score -= exam.negative; }
  }
  return { score: round(Math.max(0, score)), correct, wrong, unanswered };
}
export function firstAttemptMean(db, examId) {
  const first = db.attempts.filter(a => a.examId === examId && a.number === 1 && a.status === 'submitted');
  return first.length ? first.reduce((sum, a) => sum + a.score, 0) / first.length : null;
}
export function retryEligibility(db, exam, studentId, now = Date.now()) {
  const attempts = db.attempts.filter(a => a.examId === exam.id && a.studentId === studentId);
  const first = attempts.find(a => a.number === 1 && a.status === 'submitted');
  const mean = firstAttemptMean(db, exam.id);
  return exam.type === 'mcq' && isLiveExam(exam) && now < exam.endAt && attempts.length === 1 && !!first && mean !== null && first.score < mean;
}
export function gradeFor(score, total, passPercent = 33) {
  const percent = total ? score / total * 100 : 0;
  if (percent < passPercent) return 'F';
  return percent >= 80 ? 'A+' : percent >= 70 ? 'A' : percent >= 60 ? 'A−' : percent >= 50 ? 'B' : percent >= 40 ? 'C' : 'D';
}
export function examResults(db, exam) {
  const best = new Map();
  for (const a of db.attempts.filter(a => a.examId === exam.id && a.status === 'submitted')) {
    if (!best.has(a.studentId) || a.score > best.get(a.studentId).score) best.set(a.studentId, a);
  }
  const rows = [...best.values()].sort((a, b) => b.score - a.score || a.finishedAt - b.finishedAt);
  return rows.map((a, index) => ({ ...a, rank: rows.findIndex(other => other.score === a.score) + 1, grade: gradeFor(a.score, totalMarks(exam), exam.passPercent) }));
}
export const examRepository = {
  async list(actor) {
    const db = read();
    if (actor?.role === 'teacher') return teacherExamSnapshot(db, actor);
    return db;
  },
  async listStudents() { return teachingRepository.listStudents(); },
  /* Idempotent: gives every stored paper its permanent Exam Code. Called when
     the examination screens open, so an old local file is ready to print. */
  async ensureCodes() {
    return mutate(db => { stampExamCodes(db); });
  },
  /* Chapters are shared with Academic Setup: an exam keeps a real chapter row
     (id + name) instead of a free-text string. */
  async registerChapter(className, subjectName, chapterName) {
    return ensureChapter(className, subjectName, chapterName);
  },
  async saveDraft(input, actor = TEACHER_ACTOR) {
    /* Manager-created papers belong to the Manager; a Teacher's paper stays
       theirs, and both can be edited while the paper is still a draft. */
    const name = await paperActor(actor);
    const fields = validateExam(input);
    if (actor.role === 'teacher') {
      const username = String((await readStaffAccount('teacher'))?.username || 'teacher.apc');
      if (!isTeacherAssigned(username, fields.className, fields.group)) fail('এই class/batch-এর জন্য Manager assignment নেই।');
      /* Subject-level scope: the teacher must hold the subject in that class.
         A legacy assignment whose subjects are not part of the Admin structure
         (or an exam that already carried this subject) keeps working — the
         structure only gates new selections. */
      const assignedSubjects = subjectsForTeacherClass(username, fields.className);
      const academic = assignedSubjects.filter(name => isSubjectEnabled(fields.className, name));
      const sameAsStored = input.id && read().exams.some(exam => exam.id === input.id && exam.subject === fields.subject);
      if (!sameAsStored && academic.length && !academic.some(name => String(name).toLowerCase() === String(fields.subject).toLowerCase())) {
        fail(`এই ক্লাসে আপনার “${fields.subject}” বিষয়ের বরাদ্দ নেই। Manager প্রথমে বিষয়টি বরাদ্দ করুন।`);
      }
    }
    const db = await mutate(db => {
      const old = input.id ? examById(db, input.id) : null;
      if (old) assertCanEditPaper(old, db, actor);
      const now = Date.now();
      const exam = {
        ...(old || {}),
        ...fields,
        id: old?.id || newId('E'),
        teacherId: actor.role === 'teacher' ? actor.id : (old?.teacherId || ''),
        teacherName: actor.role === 'teacher' ? name : (old?.teacherName || ''),
        status: 'draft',
        reviewNote: '',
        createdAt: old?.createdAt || now,
        updatedAt: now,
        createdBy: old?.createdBy || name,
        createdByRole: old?.createdByRole || actor.role,
        updatedBy: name,
        participants: old?.participants || [],
        submittedAt: undefined,
        approvedAt: undefined,
        approvedBy: undefined,
        publishedAt: undefined,
        publishedBy: undefined,
        unpublishedAt: undefined,
        completedAt: undefined,
        archivedAt: undefined,
        archivedFrom: undefined
      };
      restampExamQuestions(exam, old?.questions);
      if (old) db.exams[db.exams.indexOf(old)] = exam; else db.exams.unshift(exam);
    });
    return examSnapshot(db, actor);
  },
  async requestApproval(id, actor = TEACHER_ACTOR) {
    const name = await paperActor(actor);
    const db = await mutate(db => {
      const exam = examById(db, id);
      if (actor.role === 'teacher') teacherOwns(exam, actor);
      if (!SUBMITTABLE_STATUSES.includes(exam.status)) fail('এই পরীক্ষা ইতিমধ্যে পাঠানো/প্রকাশ করা হয়েছে।');
      validateExam(exam);
      if (exam.startAt <= Date.now()) fail('পরীক্ষার শুরুর সময় ভবিষ্যতে দিন।');
      exam.status = 'pending'; exam.reviewNote = ''; exam.submittedAt = Date.now();
      exam.updatedAt = Date.now(); exam.updatedBy = name;
    });
    return examSnapshot(db, actor);
  },
  /* Manager decisions: approve (Review → Approved), publish (→ Published,
     optionally with the final negative marking) and reject (back to the
     teacher with a note). */
  async review(id, decision, options = {}, actor) {
    const name = await managerActor(actor);
    const students = decision === 'publish' ? await teachingRepository.listApprovedStudents() : [];
    const db = await mutate(db => {
      const exam = examById(db, id);
      if (decision === 'approve') {
        if (!['draft', 'pending', 'rejected'].includes(exam.status)) fail('শুধু খসড়া বা পর্যালোচনার অপেক্ষায় থাকা পরীক্ষা অনুমোদন করা যাবে।');
        validateExam(exam);
        if (exam.startAt <= Date.now()) fail('শুরুর সময় পেরিয়ে গেছে। সময় বদলে সংশোধনের জন্য ফেরত দিন।');
        exam.status = 'approved'; exam.approvedAt = Date.now(); exam.approvedBy = name; exam.reviewNote = '';
      } else if (decision === 'publish') {
        if (!PUBLISHABLE_STATUSES.includes(exam.status)) fail('এই পরীক্ষা এখন প্রকাশ করা যাবে না।');
        if (exam.startAt <= Date.now()) fail('শুরুর সময় পেরিয়েছে। সংশোধনের জন্য শিক্ষককে ফেরত দিন।');
        const validated = validateExam({ ...exam, negative: options.negative ?? exam.negative });
        exam.negative = validated.negative;
        exam.status = 'published'; exam.publishedAt = Date.now(); exam.publishedBy = name;
        if (!exam.approvedAt) { exam.approvedAt = Date.now(); exam.approvedBy = name; }
        if (exam.resultsPublished === undefined) exam.resultsPublished = false;
        const matched = students.filter(student => examMatchesStudent(exam, student)).map(s => ({ id: s.id, name: s.name, className: s.className, group: s.group || '' }));
        /* Existing participants and their answers are never dropped. */
        exam.participants = [...new Map([...(exam.participants || []), ...matched].map(person => [person.id, person])).values()];
      } else if (decision === 'reject') {
        if (!['draft', 'pending', 'approved'].includes(exam.status)) fail('শুধু পর্যালোচনার অপেক্ষায় থাকা পরীক্ষা ফেরত দেওয়া যাবে।');
        const note = String(options.note || '').trim();
        if (!note || note.length > 500) fail('সংশোধনের কারণ লিখুন (সর্বোচ্চ ৫০০ অক্ষর)।');
        exam.status = 'rejected'; exam.reviewNote = note; exam.reviewedAt = Date.now(); exam.reviewedBy = name;
      } else fail('সঠিক সিদ্ধান্ত নির্বাচন করুন।');
      exam.updatedAt = Date.now(); exam.updatedBy = name;
    });
    /* A published MCQ paper joins the question bank the moment it goes live,
       so every taken paper is on the shelf a student can practise later.
       Already-shelved content is skipped, so re-publishing is a no-op. */
    if (decision === 'publish') {
      const published = db.exams.find(e => e.id === id);
      if (published?.type === 'mcq') await questionBank.saveFromExam(published, name);
    }
    return db;
  },
  async approve(id, actor = MANAGER_ACTOR) { return examRepository.review(id, 'approve', {}, actor); },
  async publish(id, actor = MANAGER_ACTOR) { return examRepository.review(id, 'publish', {}, actor); },
  /* Unpublish keeps the questions, participants and every saved answer — it
     only takes the paper out of the students' list until it is published
     again. A paper with work in flight cannot be pulled at all. */
  async unpublish(id, actor = MANAGER_ACTOR) {
    const name = await managerActor(actor);
    return mutate(db => {
      const exam = examById(db, id);
      if (exam.status !== 'published') fail('শুধু প্রকাশিত পরীক্ষা Unpublish করা যাবে।');
      if (examHasOpenAttempts(db, id)) fail('চলমান বা জমা অপেক্ষমাণ উত্তর থাকা অবস্থায় Unpublish করা যাবে না।');
      exam.status = 'approved'; exam.unpublishedAt = Date.now(); exam.unpublishedBy = name;
      exam.updatedAt = Date.now(); exam.updatedBy = name;
    });
  },
  async complete(id, actor = MANAGER_ACTOR) {
    const name = await managerActor(actor);
    return mutate(db => {
      const exam = examById(db, id);
      if (!isLiveExam(exam)) fail('শুধু প্রকাশিত পরীক্ষা সম্পন্ন হিসেবে চিহ্নিত করা যাবে।');
      if (Number(exam.endAt) > Date.now()) fail('পরীক্ষার নির্ধারিত সময় শেষ হলে সম্পন্ন করা যাবে।');
      if (examHasOpenAttempts(db, id)) fail('অপেক্ষমাণ উত্তর জমা হওয়ার পর সম্পন্ন করুন।');
      exam.status = 'completed'; exam.completedAt = Date.now(); exam.completedBy = name;
      exam.updatedAt = Date.now(); exam.updatedBy = name;
    });
  },
  /* Archiving is the safe way to retire a paper: nothing is deleted and the
     status it came from is remembered for Restore. */
  async archive(id, actor = MANAGER_ACTOR) {
    const name = await managerActor(actor);
    return mutate(db => {
      const exam = examById(db, id);
      if (exam.status === 'archived') fail('পরীক্ষাটি আগেই আর্কাইভ করা হয়েছে।');
      if (examHasOpenAttempts(db, id)) fail('চলমান উত্তর থাকা অবস্থায় আর্কাইভ করা যাবে না।');
      exam.archivedFrom = exam.archivedFrom || exam.status;
      exam.status = 'archived'; exam.archivedAt = Date.now(); exam.archivedBy = name;
      exam.updatedAt = Date.now(); exam.updatedBy = name;
    });
  },
  async restore(id, actor = MANAGER_ACTOR) {
    const name = await managerActor(actor);
    return mutate(db => {
      const exam = examById(db, id);
      if (exam.status !== 'archived') fail('শুধু আর্কাইভ করা পরীক্ষা ফিরিয়ে আনা যাবে।');
      const previous = EXAM_STATUSES[exam.archivedFrom] && exam.archivedFrom !== 'archived' ? exam.archivedFrom : 'draft';
      exam.status = previous === 'published' ? 'approved' : previous;
      exam.restoredAt = Date.now(); exam.restoredBy = name;
      exam.updatedAt = Date.now(); exam.updatedBy = name;
    });
  },
  /* Changing the date re-files the record under the new day; the questions,
     participants and answers all stay exactly as they were. */
  async reschedule(id, options = {}, actor = MANAGER_ACTOR) {
    const name = await managerActor(actor);
    return mutate(db => {
      const exam = examById(db, id);
      if (exam.status === 'archived') fail('আর্কাইভ করা পরীক্ষার তারিখ বদলানো যাবে না।');
      if (db.attempts.some(a => a.examId === id)) fail('উত্তর বা ফলাফল থাকা পরীক্ষার তারিখ বদলানো যাবে না।');
      const validated = validateExam({
        ...exam,
        startAt: Number(options.startAt ?? exam.startAt),
        endAt: Number(options.endAt ?? exam.endAt)
      });
      Object.assign(exam, {
        startAt: validated.startAt, endAt: validated.endAt,
        examDate: validated.examDate, durationMinutes: validated.durationMinutes,
        updatedAt: Date.now(), updatedBy: name
      });
      restampExamQuestions(exam, exam.questions);
    });
  },
  /* Duplicate copies the whole question set into a fresh draft — the way an
     old paper becomes next week's exam. New uids are issued, the source paper
     is never touched. */
  async duplicate(id, actor = MANAGER_ACTOR, options = {}) {
    const name = await paperActor(actor);
    const username = actor.role === 'teacher' ? String((await readStaffAccount('teacher'))?.username || 'teacher.apc') : '';
    return mutate(db => {
      const source = examById(db, id);
      if (actor.role === 'teacher') {
        if (source.teacherId && source.teacherId !== actor.id) fail('অন্য শিক্ষকের পরীক্ষা Duplicate করা যাবে না।');
        if (!isTeacherAssigned(username, String(options.className ?? source.className ?? ''), String(options.group ?? source.group ?? ''))) fail('এই class/batch-এর জন্য Manager assignment নেই।');
      }
      const now = Date.now();
      const requestedStart = Number(options.startAt);
      const sourceStart = Number(source.startAt), sourceEnd = Number(source.endAt);
      const startAt = Number.isFinite(requestedStart) && requestedStart > now
        ? requestedStart
        : (sourceStart > now + 60000 ? sourceStart : nextOccurrence(sourceStart || now, now));
      const windowMs = Math.max(3600000, Number.isFinite(sourceEnd) && Number.isFinite(sourceStart) ? sourceEnd - sourceStart : 0);
      const endAt = Number(options.endAt) > startAt ? Number(options.endAt) : startAt + windowMs;
      const fields = validateExam({
        ...source,
        title: String(options.title || `${source.title} (কপি)`).trim().slice(0, 150),
        className: options.className ?? source.className,
        group: options.group ?? source.group,
        subject: options.subject ?? source.subject,
        startAt, endAt
      });
      const copy = {
        ...source, ...fields,
        id: newId('E'),
        /* A copy is a new paper: the code is issued fresh by stampExamCodes. */
        code: '', codeLockedAt: undefined,
        teacherId: actor.role === 'teacher' ? actor.id : '',
        teacherName: actor.role === 'teacher' ? name : '',
        status: 'draft', reviewNote: '',
        createdAt: now, updatedAt: now,
        createdBy: name, createdByRole: actor.role, updatedBy: name,
        participants: [], absentIds: [],
        submittedAt: undefined, approvedAt: undefined, approvedBy: undefined,
        publishedAt: undefined, publishedBy: undefined, unpublishedAt: undefined,
        completedAt: undefined, archivedAt: undefined, archivedFrom: undefined,
        resultsPublished: false, resultsPublishedAt: undefined,
        copiedFrom: source.id
      };
      restampExamQuestions(copy, []);
      delete copy.demoFixture;
      db.exams.unshift(copy);
    });
  },
  /* A published paper is never deleted outright: unpublish or archive first,
     and a paper anyone has answered cannot be deleted at all. */
  async deleteExam(id, actor = MANAGER_ACTOR) {
    await paperActor(actor);
    return mutate(db => {
      const exam = examById(db, id);
      if (actor.role === 'teacher') teacherOwns(exam, actor);
      /* Answered papers are never removed, whatever their workflow status. */
      if (db.attempts.some(a => a.examId === id)) fail('উত্তর বা ফলাফল থাকা পরীক্ষা মুছে ফেলা যাবে না।');
      if (!DELETABLE_STATUSES.includes(exam.status)) fail('প্রকাশিত পরীক্ষা সরাসরি মুছবে না — আগে Unpublish বা Archive করুন।');
      db.exams = db.exams.filter(item => item.id !== id);
    });
  },
  /* Single-question editing from the View Questions screen. The paste
     template is rebuilt from the records, so both stay in step. */
  async updateQuestion(id, uid, patch = {}, actor = MANAGER_ACTOR) {
    const name = await paperActor(actor);
    return mutate(db => {
      const exam = examById(db, id);
      assertCanEditPaper(exam, db, actor);
      const index = exam.questions.findIndex((question, position) => examQuestionUid(exam, question, position) === uid);
      if (index < 0) fail('প্রশ্নটি পাওয়া যায়নি।');
      const current = exam.questions[index];
      exam.questions[index] = cleanQuestion({
        text: patch.text ?? current.text,
        marks: patch.marks ?? current.marks,
        options: patch.options ?? current.options,
        answer: patch.answer ?? current.answer
      }, exam.type, `প্রশ্ন ${index + 1}`);
      exam.template = serializeQuestions(exam.questions, exam.type);
      exam.updatedAt = Date.now(); exam.updatedBy = name;
      restampExamQuestions(exam, exam.questions);
    });
  },
  async addQuestion(id, question = {}, actor = MANAGER_ACTOR) {
    const name = await paperActor(actor);
    return mutate(db => {
      const exam = examById(db, id);
      assertCanEditPaper(exam, db, actor);
      if (exam.questions.length >= 100) fail('একটি পরীক্ষায় সর্বোচ্চ ১০০টি প্রশ্ন রাখা যাবে।');
      const clean = cleanQuestion(question, exam.type, `প্রশ্ন ${exam.questions.length + 1}`);
      const questions = [...exam.questions, clean];
      if (totalMarks({ questions }) > 10000) fail('মোট নম্বর সর্বোচ্চ ১০,০০০ হতে পারে।');
      exam.questions = questions;
      exam.template = serializeQuestions(questions, exam.type);
      exam.updatedAt = Date.now(); exam.updatedBy = name;
      restampExamQuestions(exam, exam.questions);
    });
  },
  async deleteQuestion(id, uid, actor = MANAGER_ACTOR) {
    const name = await paperActor(actor);
    return mutate(db => {
      const exam = examById(db, id);
      assertCanEditPaper(exam, db, actor);
      if (exam.questions.length <= 1) fail('পরীক্ষায় অন্তত একটি প্রশ্ন থাকতে হবে।');
      const remaining = exam.questions.filter((question, position) => examQuestionUid(exam, question, position) !== uid);
      if (remaining.length === exam.questions.length) fail('প্রশ্নটি পাওয়া যায়নি।');
      exam.questions = remaining;
      exam.template = serializeQuestions(remaining, exam.type);
      exam.updatedAt = Date.now(); exam.updatedBy = name;
      restampExamQuestions(exam, exam.questions);
    });
  },
  async publishResults(id, actor = MANAGER_ACTOR) {
    requireManager(actor);
    await requireRoleSession('manager');
    return mutate(db => {
      const exam = examById(db, id);
      if (!isLiveExam(exam) || Date.now() < exam.endAt) fail('পরীক্ষা শেষ হওয়ার আগে ফলাফল প্রকাশ করা যাবে না।');
      if (exam.resultsPublished) fail('ফলাফল ইতিমধ্যে প্রকাশিত হয়েছে।');
      if (db.attempts.some(attempt => attempt.examId === id && ['active', 'queued'].includes(attempt.status))) fail('অপেক্ষমাণ/অফলাইন উত্তর জমা শেষ না হওয়া পর্যন্ত ফলাফল প্রকাশ করা যাবে না।');
      if (exam.type !== 'mcq') {
        const recorded = new Set(db.attempts.filter(attempt => attempt.examId === id && attempt.status === 'submitted').map(attempt => attempt.studentId));
        const absent = new Set(exam.absentIds || []);
        if (exam.participants.some(person => !recorded.has(person.id) && !absent.has(person.id))) fail('সব অংশগ্রহণকারীর নম্বর বা অনুপস্থিতির রেকর্ড সম্পন্ন হয়নি।');
      }
      exam.resultsPublished = true; exam.resultsPublishedAt = Date.now();
    });
  },
  async deleteDraft(id, actor = TEACHER_ACTOR) {
    /* Kept for callers of the old name; the rules now live in deleteExam. */
    return examRepository.deleteExam(id, actor);
  },
  async startAttempt(examId, student) {
    return mutate(db => {
      const e = examById(db, examId), person = eligibleParticipant(e, student), now = Date.now();
      if (e.type !== 'mcq' || !isLiveExam(e) || now < e.startAt || now >= e.endAt) fail('এখন পরীক্ষা শুরু করা যাবে না।');
      if (!examMatchesStudent(e, person)) fail('এই পরীক্ষা তোমার শ্রেণি/ব্যাচের জন্য নয়.');
      if (!e.participants?.some(item => item.id === person.id)) fail('এই পরীক্ষার অংশগ্রহণকারী তালিকায় তোমার নাম নেই।');
      const own = db.attempts.filter(a => a.examId === e.id && a.studentId === person.id);
      if (own.some(a => a.status === 'active')) return;
      if (!own.length && now > e.startAt + e.lateMinutes * 60000) fail('দেরিতে প্রবেশের সময়সীমা শেষ।');
      if (own.length && !retryEligibility(db, e, person.id, now)) fail('দ্বিতীয় সুযোগের যোগ্যতা নেই বা সময় শেষ।');
      /* The same student resuming the same attempt always sees the same paper:
         the order is seeded, not random. */
      const attemptId = newId('A');
      const order = orderPaperForAttempt(e, person.id, attemptId);
      db.attempts.push({ id: attemptId, examId, studentId: person.id, name: person.name, className: person.className, number: own.length + 1, status: 'active', startedAt: now, savedAt: now, order, answers: {} });
      if (!e.participants.some(s => s.id === person.id)) e.participants.push(person);
    });
  },
  async saveAnswer(attemptId, studentId, questionId, optionId) {
    const receivedAt = Date.now();
    return mutate(db => {
      const a = attemptById(db, attemptId, studentId), e = examById(db, a.examId);
      if (a.status !== 'active' || receivedAt >= e.endAt) fail('সময় শেষ বা উত্তরপত্র জমা হয়েছে।');
      const q = e.questions.find(q => q.id === questionId);
      if (!q || !q.options.some(o => o.id === optionId)) fail('উত্তরের অপশন সঠিক নয়।');
      a.answers[questionId] = optionId; a.savedAt = receivedAt;
    });
  },
  async finishAttempt(attemptId, studentId) {
    return mutate(db => {
      const a = attemptById(db, attemptId, studentId), e = examById(db, a.examId);
      if (a.status !== 'active') return;
      a.finishedAt = Math.min(Date.now(), e.endAt); a.status = navigator.onLine === false ? 'queued' : 'submitted';
      if (a.status === 'submitted') Object.assign(a, scoreAttempt(e, a));
    });
  },
  async syncStudent(studentId) {
    return mutate(db => {
      for (const a of db.attempts.filter(a => a.studentId === studentId && a.status !== 'submitted')) {
        const e = examById(db, a.examId);
        if (a.status === 'active' && Date.now() >= e.endAt) { a.finishedAt = e.endAt; a.status = 'queued'; }
        if (a.status === 'queued' && navigator.onLine !== false) { a.status = 'submitted'; Object.assign(a, scoreAttempt(e, a)); }
      }
    });
  },
  async markWrittenAbsent(examId, student, actor = TEACHER_ACTOR) {
    await requireRoleSession('teacher');
    const db = await mutate(db => {
      const e = examById(db, examId); teacherOwns(e, actor); const person = eligibleParticipant(e, student);
      if (!examMatchesStudent(e, person) || !e.participants.some(item => item.id === person.id)) fail('শিক্ষার্থী এই পরীক্ষার assigned class/batch roster-এ নেই।');
      if (e.resultsPublished) fail('Manager ফলাফল প্রকাশ করেছেন; নম্বর আর পরিবর্তন করা যাবে না।');
      if (!isLiveExam(e) || e.type === 'mcq' || Date.now() < new Date(`${classExamDate(e.startAt)}T00:00:00+06:00`).getTime()) fail('ক্লাসে পরীক্ষার দিন থেকে উপস্থিতি দেওয়া যাবে।');
      if (db.attempts.some(a => a.examId === e.id && a.studentId === person.id)) fail('এই শিক্ষার্থীর নম্বর আছে; অনুপস্থিত করা যাবে না।');
      e.absentIds = [...new Set([...(e.absentIds || []), person.id])];
      if (!e.participants.some(s => s.id === person.id)) e.participants.push(person);
    });
    return teacherExamSnapshot(db, actor);
  },
  async saveWrittenScore(examId, student, questionScores, actor = TEACHER_ACTOR) {
    await requireRoleSession('teacher');
    const db = await mutate(db => {
      const e = examById(db, examId); teacherOwns(e, actor); const person = eligibleParticipant(e, student);
      if (!examMatchesStudent(e, person) || !e.participants.some(item => item.id === person.id)) fail('শিক্ষার্থী এই পরীক্ষার assigned class/batch roster-এ নেই।');
      if (e.resultsPublished) fail('Manager ফলাফল প্রকাশ করেছেন; নম্বর আর পরিবর্তন করা যাবে না।');
      if (!isLiveExam(e) || e.type === 'mcq' || Date.now() < new Date(`${classExamDate(e.startAt)}T00:00:00+06:00`).getTime()) fail('ক্লাসে পরীক্ষার দিন থেকে নম্বর দেওয়া যাবে।');
      if (e.questions.some(q => !Object.hasOwn(questionScores, q.id) || !['string', 'number'].includes(typeof questionScores[q.id]) || !String(questionScores[q.id]).trim() || !Number.isFinite(Number(questionScores[q.id])) || round(Number(questionScores[q.id])) !== Number(questionScores[q.id]) || Number(questionScores[q.id]) < 0 || Number(questionScores[q.id]) > q.marks)) fail('প্রতিটি প্রশ্নের নম্বর শূন্য থেকে পূর্ণমানের মধ্যে দিন।');
      const score = round(e.questions.reduce((sum, q) => sum + Number(questionScores[q.id]), 0));
      let a = db.attempts.find(a => a.examId === e.id && a.studentId === person.id);
      if (!a) { a = { id: newId('A'), examId, studentId: person.id, name: person.name, className: person.className, number: 1, startedAt: Date.now(), order: [], answers: {} }; db.attempts.push(a); }
      const cleanScores = Object.fromEntries(e.questions.map(q => [q.id, Number(questionScores[q.id])]));
      Object.assign(a, { score, questionScores: cleanScores, status: 'submitted', finishedAt: Date.now() });
      e.absentIds = (e.absentIds || []).filter(id => id !== person.id);
      if (!e.participants.some(s => s.id === person.id)) e.participants.push(person);
    });
    return teacherExamSnapshot(db, actor);
  }
};
export function watchExams(callback) {
  window.addEventListener('storage', e => { if (e.key === EXAM_KEY || e.key === null) callback(); });
  window.addEventListener('exam-data-updated', callback);
}
