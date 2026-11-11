/* কেন্দ্রীয় Work Registry — শিক্ষক প্যানেলের একমাত্র "কী তৈরি করা যায়" সত্য।

   প্রতিটি এন্ট্রি Student Panel-এর একটি বাস্তব ফিচারের সঙ্গে যুক্ত, এবং তার
   সব তথ্য এখানেই ঘোষিত: কোন ক্যাটাগরি, কোন ফিল্ড বাধ্যতামূলক, কোন Form খোলে,
   কোন repository/database path লেখা হয়, কে প্রকাশ করতে পারে, Admin/Manager
   অনুমোদন লাগে কি না, আর প্রকাশিত হলে Student Panel-এর কোন view-তে দেখা যায়।

   এই মডিউল শুধু ডেটা ও ঠিকানা — কোনো DOM নেই, কোনো লেখা (write) নেই। তাই
   enrollment ছাড়াই পুরো registry যাচাই করা যায় (tests/work-registry.test.mjs)।

   নিয়ম: এখানে যা নেই, Teacher Panel থেকে তা তৈরি করা যায় না। নতুন ফিচার
   যোগ করতে হলে আগে তার repository ও Student view যাচাই করে এখানে একটি
   সম্পূর্ণ এন্ট্রি যোগ করতে হবে — নাহলে validateWorkRegistry() ব্যর্থ হবে। */

/** স্টুডেন্ট প্যানেলের বাস্তব view-নাম (student.html-এর data-view-panel)। */
export const STUDENT_VIEWS = Object.freeze({
  home: 'home', homework: 'homework', suggestion: 'suggestion', questionBank: 'question-bank',
  materials: 'materials', myCourses: 'my-courses', modelTest: 'model-test',
  studyPractice: 'study-practice', studyResults: 'study-results', studyOther: 'study-other',
  exams: 'exams', examUpcoming: 'exam-upcoming', examLive: 'exam-live',
  examResults: 'exam-results', examBank: 'exam-bank', examPractice: 'exam-practice',
  routine: 'routine', routineToday: 'routine-today', routineWeekly: 'routine-weekly',
  classAttendance: 'class-attendance', classNotes: 'class-notes',
  classMaterials: 'class-materials', classes: 'classes',
  noticeBoard: 'notice-board', classChat: 'class-chat', notifications: 'notification-settings',
  profile: 'profile', myProfile: 'my-profile', idCard: 'student-id-card',
  fee: 'student-fee', reports: 'reports', settings: 'profile'
});

/* কাজের চারটি অবস্থা-পরিবার (Teacher Panel-এ দেখানো হয়):
     খসড়া → অনুমোদনের অপেক্ষায় → প্রকাশিত | ফিরিয়ে দেওয়া → আর্কাইভ
   মানগুলো সরাসরি store-এর status-এর সঙ্গে মেলে, নতুন কোনো status বানানো হয়নি। */
export const WORK_STATUSES = Object.freeze({
  draft: { label: 'খসড়া', tone: 'draft', order: 0 },
  pending: { label: 'অনুমোদনের অপেক্ষায়', tone: 'pending', order: 1 },
  approved: { label: 'অনুমোদিত', tone: 'approved', order: 2 },
  published: { label: 'প্রকাশিত', tone: 'published', order: 3 },
  rejected: { label: 'ফিরিয়ে দেওয়া', tone: 'rejected', order: 4 },
  completed: { label: 'সম্পন্ন', tone: 'completed', order: 5 },
  archived: { label: 'আর্কাইভ', tone: 'archived', order: 6 }
});

export const WORK_STATUS_FILTERS = Object.freeze(['all', 'draft', 'pending', 'published', 'rejected', 'archived']);

export function statusMeta(status) {
  return WORK_STATUSES[String(status || '')] || { label: String(status || '—'), tone: 'unknown', order: 99 };
}

/** অনুমোদন নীতি: সরাসরি প্রকাশ, নাকি Admin/Manager ছাড়া অসম্ভব। */
export const APPROVAL = Object.freeze({
  /* শিক্ষক নিজেই প্রকাশ করতে পারেন — বিদ্যমান repository-র status flag। */
  DIRECT: 'direct',
  /* শিক্ষক কেবল খসড়া/জমা দিতে পারেন; প্রকাশ করে Admin/Manager
     (ইতিমধ্যে বিদ্যমান exam-data.js approval workflow)। */
  ADMIN_MANAGER: 'admin-manager'
});

/** যে ফিচার Teacher তৈরি করেন না — registry-তে থাকলেও শুধু-পঠন। */
export const OWNERS = Object.freeze({
  TEACHER: 'teacher',
  MANAGER: 'manager',
  ADMIN: 'admin',
  PAYMENT: 'payment',
  STUDENT: 'student',
  SYSTEM: 'system'
});

/* ফর্মের ফিল্ড-আইডি → বাংলা লেবেল ও ধরন। Feature-এর requiredFields/
   optionalFields এই আইডিগুলোই ব্যবহার করে; Form Component আসল ফর্মটি খোলে। */
export const FIELD_LABELS = Object.freeze({
  class: 'শ্রেণি', subject: 'বিষয়', group: 'বিভাগ / ব্যাচ', students: 'নির্দিষ্ট শিক্ষার্থী',
  title: 'শিরোনাম', details: 'বিবরণ', date: 'তারিখ', time: 'সময়', duration: 'সময়কাল (মিনিট)',
  totalMarks: 'পূর্ণমান', chapter: 'অধ্যায়', questionType: 'প্রশ্নের ধরন', question: 'প্রশ্ন',
  options: 'অপশন', answer: 'সঠিক উত্তর', explanation: 'ব্যাখ্যা', attachment: 'সংযুক্তি (লিংক)',
  target: 'কোন শ্রেণি/শিক্ষার্থী পাবে', priority: 'গুরুত্ব', exam: 'পরীক্ষা', marks: 'নম্বর',
  room: 'রুম / স্থান', content: 'বিষয়বস্তু', link: 'সহায়ক লিংক', practiceSet: 'প্র্যাকটিস সেট'
});

export const WORK_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'study', label: 'পড়াশোনা', icon: 'book', description: 'বাড়ির কাজ, সাজেশন, নোট, উপকরণ ও প্রশ্নব্যাংক' }),
  Object.freeze({ id: 'exam', label: 'পরীক্ষা', icon: 'mcq', description: 'অনলাইন পরীক্ষা ও মডেল টেস্ট' }),
  Object.freeze({ id: 'results', label: 'ফলাফল ও অগ্রগতি', icon: 'result', description: 'নম্বর এন্ট্রি ও ফলাফল প্রকাশ' }),
  Object.freeze({ id: 'communication', label: 'যোগাযোগ', icon: 'notice', description: 'নোটিশ, ঘোষণা ও শ্রেণি চ্যাট' }),
  Object.freeze({ id: 'class', label: 'ক্লাস ও উপস্থিতি', icon: 'attendance', description: 'উপস্থিতি, রুটিন ও ক্লাস তথ্য' })
]);

const f = (id, label, type = 'text') => Object.freeze({ id, label, type });

/* ------------------------------------------------------------------ features
   প্রতিটি এন্ট্রির প্রতিটি ফিল্ড বাধ্যতামূলক (validateWorkRegistry দেখে)।
   `form.handoff` হলো সেই আসল workflow, যা এই কাজটি ইতিমধ্যে লেখে — নতুন কোনো
   দ্বিতীয় ফর্ম/স্টোর বানানো হয় না। */
export const WORK_FEATURES = Object.freeze([
  Object.freeze({
    id: 'homework',
    category: 'study',
    name: 'বাড়ির কাজ',
    owner: OWNERS.TEACHER,
    description: 'শ্রেণি ও বিষয়ভিত্তিক বাড়ির কাজ, শেষ তারিখ ও নির্দেশনা',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('title', 'শিরোনাম'), f('details', 'কাজের বিবরণ'), f('date', 'জমার শেষ তারিখ')]),
    optionalFields: Object.freeze([f('time', 'জমার শেষ সময়'), f('group', 'বিভাগ'), f('attachment', 'সংযুক্তি লিংক'), f('students', 'নির্দিষ্ট শিক্ষার্থী')]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'activity-editor', handoff: 'activity-create', activityType: 'homework', editor: 'js/teacher.js showEditor' }),
    store: Object.freeze({ key: 'activePlus.teaching.v1', path: 'activePlusSync/v1/collections/teaching', repository: 'teachingRepository' }),
    permission: Object.freeze({ create: true, edit: true, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'প্রকাশ করুন', status: 'published', writer: 'teachingRepository.saveActivity' }),
    student: Object.freeze({ view: STUDENT_VIEWS.homework, label: 'বাড়ির কাজ', panel: 'পড়াশোনা' }),
    validation: Object.freeze(['শিরোনাম ১–১৫০ অক্ষর', 'বিষয় ১–৮০ অক্ষর', 'শ্রেণি সক্রিয় তালিকায়', 'তারিখ ও সময় একসঙ্গে', 'নির্দেশনা ≤ ৩০০০ অক্ষর']),
    tests: Object.freeze(['tests/teaching.test.mjs', 'tests/teacher-panel.test.mjs'])
  }),
  Object.freeze({
    id: 'suggestion',
    category: 'study',
    name: 'সাজেশন',
    owner: OWNERS.TEACHER,
    description: 'অধ্যায়ভিত্তিক গুরুত্বপূর্ণ প্রশ্ন ও সাজেশন',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('title', 'শিরোনাম'), f('details', 'সাজেশনের বিষয়বস্তু')]),
    optionalFields: Object.freeze([f('group', 'বিভাগ'), f('attachment', 'সংযুক্তি লিংক')]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'activity-editor', handoff: 'activity-create', activityType: 'suggestion', editor: 'js/teacher.js showEditor' }),
    store: Object.freeze({ key: 'activePlus.teaching.v1', path: 'activePlusSync/v1/collections/teaching', repository: 'teachingRepository' }),
    permission: Object.freeze({ create: true, edit: true, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'প্রকাশ করুন', status: 'published', writer: 'teachingRepository.saveActivity' }),
    student: Object.freeze({ view: STUDENT_VIEWS.suggestion, label: 'সাজেশন', panel: 'পড়াশোনা' }),
    validation: Object.freeze(['শিরোনাম ১–১৫০ অক্ষর', 'শ্রেণি ও বিষয় বাধ্যতামূলক', 'বিষয়বস্তু ≤ ৩০০০ অক্ষর']),
    tests: Object.freeze(['tests/teacher-suggestion-workflow.test.mjs', 'tests/student-study-reference.spec.cjs'])
  }),
  Object.freeze({
    id: 'lecture-sheet',
    category: 'study',
    name: 'লেকচার শিট',
    owner: OWNERS.TEACHER,
    description: 'A4 লেকচার শিট স্টুডিও — তৈরি, PDF ও প্রকাশ',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('title', 'শিরোনাম'), f('content', 'শিটের বিষয়বস্তু')]),
    optionalFields: Object.freeze([f('chapter', 'অধ্যায়'), f('group', 'বিভাগ')]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'lecture-sheet-studio', handoff: 'lecture-sheets', editor: 'js/lecture-sheet-studio.js' }),
    store: Object.freeze({ key: 'activePlus.courseContent.v1', path: 'activePlusSync/v1/collections/courseContent', repository: 'course-content.js' }),
    permission: Object.freeze({ create: true, edit: true, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'প্রকাশ করুন', status: 'published', writer: 'saveCourseRecord / setContentPublished' }),
    student: Object.freeze({ view: STUDENT_VIEWS.materials, label: 'উপকরণ → শিট', panel: 'পড়াশোনা' }),
    validation: Object.freeze(['শ্রেণি ও বিষয় অ্যাসাইনমেন্টের মধ্যে', 'শিরোনাম ≤ ২০০ অক্ষর', 'বিষয়বস্তুর আকার সীমার মধ্যে']),
    tests: Object.freeze(['tests/course-editor.test.mjs', 'tests/study-materials-list.test.mjs'])
  }),
  Object.freeze({
    id: 'class-note',
    category: 'study',
    name: 'ক্লাস নোট',
    owner: OWNERS.TEACHER,
    description: 'অধ্যায়ভিত্তিক ক্লাস নোট',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('chapter', 'অধ্যায়'), f('title', 'শিরোনাম'), f('content', 'নোট')]),
    optionalFields: Object.freeze([f('group', 'বিভাগ'), f('attachment', 'সংযুক্তি লিংক')]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'course-content-editor', handoff: 'courses', courseType: 'note', editor: 'js/course-editor.js' }),
    store: Object.freeze({ key: 'activePlus.courseContent.v1', path: 'activePlusSync/v1/collections/courseContent', repository: 'course-content.js' }),
    permission: Object.freeze({ create: true, edit: true, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'প্রকাশ করুন', status: 'published', writer: 'setContentPublished' }),
    student: Object.freeze({ view: STUDENT_VIEWS.classNotes, label: 'ক্লাস নোট', panel: 'ক্লাস' }),
    validation: Object.freeze(['চ্যাপ্টার বাধ্যতামূলক', 'শিরোনাম ≤ ২০০ অক্ষর']),
    tests: Object.freeze(['tests/course-content.test.mjs'])
  }),
  Object.freeze({
    id: 'study-material',
    category: 'study',
    name: 'উপকরণ / PDF',
    owner: OWNERS.TEACHER,
    description: 'নোট, PDF, ভিডিও ও পূর্বের প্রশ্নের উপকরণ',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('title', 'শিরোনাম'), f('content', 'বিবরণ')]),
    optionalFields: Object.freeze([f('chapter', 'অধ্যায়'), f('attachment', 'সংযুক্তি লিংক'), f('group', 'বিভাগ')]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'course-content-editor', handoff: 'courses', courseType: 'pdf', editor: 'js/course-editor.js' }),
    store: Object.freeze({ key: 'activePlus.courseContent.v1', path: 'activePlusSync/v1/collections/courseContent', repository: 'course-content.js' }),
    permission: Object.freeze({ create: true, edit: true, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'প্রকাশ করুন', status: 'published', writer: 'setContentPublished' }),
    student: Object.freeze({ view: STUDENT_VIEWS.materials, label: 'উপকরণ', panel: 'পড়াশোনা' }),
    validation: Object.freeze(['শ্রেণি ও বিষয় বাধ্যতামূলক', 'সংযুক্তি https লিংক']),
    tests: Object.freeze(['tests/study-materials-list.test.mjs'])
  }),
  Object.freeze({
    id: 'important-question',
    category: 'study',
    name: 'গুরুত্বপূর্ণ প্রশ্ন',
    owner: OWNERS.TEACHER,
    description: 'অধ্যায়ভিত্তিক গুরুত্বপূর্ণ প্রশ্নের তালিকা',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('chapter', 'অধ্যায়'), f('title', 'শিরোনাম'), f('content', 'প্রশ্ন')]),
    optionalFields: Object.freeze([f('group', 'বিভাগ'), f('attachment', 'সংযুক্তি')]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'course-content-editor', handoff: 'courses', courseType: 'important_question', editor: 'js/course-editor.js' }),
    store: Object.freeze({ key: 'activePlus.courseContent.v1', path: 'activePlusSync/v1/collections/courseContent', repository: 'course-content.js' }),
    permission: Object.freeze({ create: true, edit: true, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'প্রকাশ করুন', status: 'published', writer: 'setContentPublished' }),
    student: Object.freeze({ view: STUDENT_VIEWS.suggestion, label: 'গুরুত্বপূর্ণ প্রশ্ন', panel: 'পড়াশোনা' }),
    validation: Object.freeze(['চ্যাপ্টার বাধ্যতামূলক']),
    tests: Object.freeze(['tests/course-content.test.mjs'])
  }),
  Object.freeze({
    id: 'model-test',
    category: 'study',
    name: 'মডেল টেস্ট',
    owner: OWNERS.TEACHER,
    description: 'মডেল টেস্টের প্রশ্ন ও নমুনা উত্তর',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('title', 'শিরোনাম'), f('content', 'বিষয়বস্তু')]),
    optionalFields: Object.freeze([f('chapter', 'অধ্যায়'), f('attachment', 'সংযুক্তি')]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'course-content-editor', handoff: 'courses', courseType: 'model_test', editor: 'js/course-editor.js' }),
    store: Object.freeze({ key: 'activePlus.courseContent.v1', path: 'activePlusSync/v1/collections/courseContent', repository: 'course-content.js' }),
    permission: Object.freeze({ create: true, edit: true, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'প্রকাশ করুন', status: 'published', writer: 'setContentPublished' }),
    student: Object.freeze({ view: STUDENT_VIEWS.modelTest, label: 'মডেল টেস্ট', panel: 'পড়াশোনা' }),
    validation: Object.freeze(['শ্রেণি ও বিষয় বাধ্যতামূলক']),
    tests: Object.freeze(['tests/course-content.test.mjs'])
  }),
  Object.freeze({
    id: 'assignment',
    category: 'study',
    name: 'অ্যাসাইনমেন্ট',
    owner: OWNERS.TEACHER,
    description: 'কোর্সভিত্তিক অ্যাসাইনমেন্ট ও জমার নির্দেশনা',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('title', 'শিরোনাম'), f('content', 'নির্দেশনা')]),
    optionalFields: Object.freeze([f('chapter', 'অধ্যায়'), f('attachment', 'সংযুক্তি'), f('date', 'শেষ তারিখ')]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'course-content-editor', handoff: 'courses', courseType: 'assignment', editor: 'js/course-editor.js' }),
    store: Object.freeze({ key: 'activePlus.courseContent.v1', path: 'activePlusSync/v1/collections/courseContent', repository: 'course-content.js' }),
    permission: Object.freeze({ create: true, edit: true, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'প্রকাশ করুন', status: 'published', writer: 'setContentPublished' }),
    student: Object.freeze({ view: STUDENT_VIEWS.myCourses, label: 'কোর্সের অ্যাসাইনমেন্ট', panel: 'পড়াশোনা' }),
    validation: Object.freeze(['শ্রেণি ও বিষয় বাধ্যতামূলক']),
    tests: Object.freeze(['tests/course-content.test.mjs'])
  }),
  Object.freeze({
    id: 'question-bank',
    category: 'study',
    name: 'প্রশ্নব্যাংক',
    owner: OWNERS.TEACHER,
    description: 'MCQ, সংক্ষিপ্ত ও সৃজনশীল প্রশ্ন সংরক্ষণ',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('questionType', 'প্রশ্নের ধরন'), f('question', 'প্রশ্ন')]),
    optionalFields: Object.freeze([f('chapter', 'অধ্যায়'), f('options', 'অপশন'), f('answer', 'সঠিক উত্তর'), f('explanation', 'ব্যাখ্যা'), f('group', 'বিভাগ')]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'question-editor', handoff: 'online-exams', editor: 'js/question-bank.js' }),
    store: Object.freeze({ key: 'activePlus.questionBank.v1', path: 'activePlusSync/v1/collections/questionBank', repository: 'questionBank' }),
    permission: Object.freeze({ create: true, edit: true, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'প্রশ্ন সক্রিয় রাখুন', status: 'published', writer: 'questionBank.save' }),
    student: Object.freeze({ view: STUDENT_VIEWS.questionBank, label: 'প্রশ্নব্যাংক', panel: 'পড়াশোনা' }),
    validation: Object.freeze(['MCQ-তে অন্তত ২টি অপশন', 'সঠিক উত্তর অপশনের মধ্যে', 'প্রশ্ন ≤ ২০০০ অক্ষর']),
    tests: Object.freeze(['tests/question-bank.test.mjs', 'tests/question-bank-v2-policy.test.mjs'])
  }),
  Object.freeze({
    id: 'online-exam',
    category: 'exam',
    name: 'অনলাইন পরীক্ষা',
    owner: OWNERS.TEACHER,
    description: 'প্রশ্ন নির্বাচন, সময়, পূর্ণমান ও অনুমোদনসহ অনলাইন পরীক্ষা',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('title', 'পরীক্ষার শিরোনাম'), f('duration', 'সময়কাল'), f('totalMarks', 'পূর্ণমান'), f('question', 'প্রশ্ন তালিকা')]),
    optionalFields: Object.freeze([f('group', 'বিভাগ'), f('students', 'নির্দিষ্ট শিক্ষার্থী'), f('chapter', 'অধ্যায়')]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group', 'students']),
    form: Object.freeze({ component: 'exam-builder', handoff: 'online-exams', editor: 'js/exam-manager.js' }),
    store: Object.freeze({ key: 'activePlus.exams.v1', path: 'activePlusSync/v1/examDb/exams', repository: 'examRepository' }),
    permission: Object.freeze({ create: true, edit: true, publish: false, requiresAssignment: true }),
    approval: APPROVAL.ADMIN_MANAGER,
    publishAction: Object.freeze({ label: 'অনুমোদনের জন্য পাঠান', status: 'pending', writer: 'examRepository.submit' }),
    student: Object.freeze({ view: STUDENT_VIEWS.exams, label: 'আসন্ন ও চলমান পরীক্ষা', panel: 'পরীক্ষা' }),
    validation: Object.freeze(['সময়কাল ৫–৩০০ মিনিট', 'পূর্ণমান ১–১০০০', 'অন্তত ১টি প্রশ্ন', 'সময়সূচি সংঘর্ষহীন']),
    tests: Object.freeze(['tests/exam-approval-flow.test.mjs', 'tests/exam-archive.test.mjs'])
  }),
  Object.freeze({
    id: 'exam-marks',
    category: 'results',
    name: 'নম্বর এন্ট্রি',
    owner: OWNERS.TEACHER,
    description: 'মূল্যায়ন, নম্বর এন্ট্রি ও ফলাফল প্রকাশ',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('exam', 'পরীক্ষা'), f('marks', 'শিক্ষার্থীর নম্বর')]),
    optionalFields: Object.freeze([f('students', 'শিক্ষার্থী তালিকা')]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group', 'students']),
    form: Object.freeze({ component: 'marks-entry', handoff: 'exam', editor: 'js/exam-manager.js' }),
    store: Object.freeze({ key: 'activePlus.exams.v1', path: 'activePlusSync/v1/examDb/exams', repository: 'examRepository' }),
    permission: Object.freeze({ create: true, edit: true, publish: false, requiresAssignment: true }),
    approval: APPROVAL.ADMIN_MANAGER,
    publishAction: Object.freeze({ label: 'ফলাফল প্রকাশ (অনুমোদনের পরে)', status: 'published', writer: 'examRepository.publishResults' }),
    student: Object.freeze({ view: STUDENT_VIEWS.examResults, label: 'পরীক্ষার ফলাফল', panel: 'পরীক্ষা' }),
    validation: Object.freeze(['নম্বর ০–পূর্ণমান', '০.৫ ধাপ', 'প্রকাশিত পরীক্ষা ছাড়া ফলাফল নয়']),
    tests: Object.freeze(['tests/exam-approval-flow.test.mjs'])
  }),
  Object.freeze({
    id: 'notice',
    category: 'communication',
    name: 'নোটিশ',
    owner: OWNERS.TEACHER,
    description: 'শ্রেণি/ব্যাচভিত্তিক নোটিশ ও ঘোষণা',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('title', 'শিরোনাম'), f('details', 'ঘোষণা')]),
    optionalFields: Object.freeze([f('group', 'ব্যাচ / বিভাগ'), f('priority', 'গুরুত্ব')]),
    classRequirement: 'required',
    subjectRequirement: 'forbidden',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'notice-editor', handoff: 'notice', editor: 'js/teacher.js showNoticeEditor' }),
    store: Object.freeze({ key: 'activePlus.admin.notices.v1', path: 'activePlusSync/v1/collections/notices', repository: 'office-data.js saveNotices' }),
    permission: Object.freeze({ create: true, edit: true, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'প্রকাশ করুন', status: 'published', writer: 'saveNoticeRecord' }),
    student: Object.freeze({ view: STUDENT_VIEWS.noticeBoard, label: 'নোটিশ বোর্ড ও নোটিফিকেশন', panel: 'যোগাযোগ' }),
    validation: Object.freeze(['শিরোনাম ≤ ১৫০ অক্ষর', 'ঘোষণা ≤ ২০০০ অক্ষর', 'শ্রেণি অ্যাসাইনমেন্টের মধ্যে']),
    tests: Object.freeze(['tests/class-notice-and-comments.test.mjs', 'tests/notice-center.test.mjs'])
  }),
  Object.freeze({
    id: 'class-chat-message',
    category: 'communication',
    name: 'শ্রেণি চ্যাট',
    owner: OWNERS.TEACHER,
    description: 'নিজের শ্রেণির চ্যাট রুমে বার্তা ও সূচনা',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('details', 'বার্তা')]),
    optionalFields: Object.freeze([f('group', 'বিভাগ'), f('attachment', 'সংযুক্তি')]),
    classRequirement: 'required',
    subjectRequirement: 'forbidden',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'class-chat', handoff: 'class-chat', editor: 'js/class-chat.js' }),
    store: Object.freeze({ key: 'activePlus.classChat.v1', path: 'activePlusSync/v1/collections/classChat', repository: 'class-chat.js' }),
    permission: Object.freeze({ create: true, edit: false, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'বার্তা পাঠান', status: 'published', writer: 'class-chat send' }),
    student: Object.freeze({ view: STUDENT_VIEWS.classChat, label: 'শ্রেণি চ্যাট', panel: 'যোগাযোগ' }),
    validation: Object.freeze(['বার্তা ≤ ২০০০ অক্ষর', 'শ্রেণি অ্যাসাইনমেন্টের মধ্যে']),
    tests: Object.freeze(['tests/class-chat.test.mjs'])
  }),
  Object.freeze({
    id: 'attendance',
    category: 'class',
    name: 'উপস্থিতি',
    owner: OWNERS.TEACHER,
    description: 'সেশনভিত্তিক Present/Absent/Late নথিভুক্তি',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('date', 'তারিখ'), f('students', 'শিক্ষার্থী তালিকা')]),
    optionalFields: Object.freeze([f('group', 'বিভাগ'), f('details', 'সেশন নোট')]),
    classRequirement: 'required',
    subjectRequirement: 'optional',
    groupRequirement: 'optional',
    audience: Object.freeze(['class', 'group']),
    form: Object.freeze({ component: 'attendance-sheet', handoff: 'routine-view', editor: 'js/teacher.js openRoutineSession' }),
    store: Object.freeze({ key: 'activePlus.teaching.v1', path: 'activePlusSync/v1/collections/teaching', repository: 'teachingRepository' }),
    permission: Object.freeze({ create: true, edit: true, publish: true, requiresAssignment: true }),
    approval: APPROVAL.DIRECT,
    publishAction: Object.freeze({ label: 'উপস্থিতি সংরক্ষণ', status: 'published', writer: 'teachingRepository.saveProgress' }),
    student: Object.freeze({ view: STUDENT_VIEWS.classAttendance, label: 'উপস্থিতি ও ড্যাশবোর্ড হার', panel: 'ক্লাস' }),
    validation: Object.freeze(['তারিখ আজ বা অনুমোদিত সীমার মধ্যে', '৭ দিন পর কেবল Manager সংশোধন', 'শিক্ষার্থী শ্রেণি/বিভাগের মধ্যে']),
    tests: Object.freeze(['tests/teacher-panel.test.mjs', 'tests/today-class-card.test.mjs'])
  }),
  /* -------- শুধু-পঠন (Teacher তৈরি করেন না, কিন্তু জানা দরকার) -------- */
  Object.freeze({
    id: 'class-routine',
    category: 'class',
    name: 'ক্লাস রুটিন',
    owner: OWNERS.MANAGER,
    description: 'প্রাতিষ্ঠানিক সাপ্তাহিক রুটিন — Manager তৈরি করেন, শিক্ষক দেখেন',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('time', 'সময়')]),
    optionalFields: Object.freeze([]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'optional',
    audience: Object.freeze(['class']),
    form: Object.freeze({ component: 'none', handoff: 'routine-view', editor: 'manager.html' }),
    store: Object.freeze({ key: 'activePlus.admin.routine.v1', path: 'activePlusSync/v1/collections/routine', repository: 'office-data.js loadRoutine' }),
    permission: Object.freeze({ create: false, edit: false, publish: false, requiresAssignment: false }),
    approval: APPROVAL.ADMIN_MANAGER,
    publishAction: Object.freeze({ label: '—', status: 'published', writer: 'manager panel' }),
    student: Object.freeze({ view: STUDENT_VIEWS.routineToday, label: 'রুটিন ও আজকের ক্লাস', panel: 'রুটিন' }),
    validation: Object.freeze(['Manager-নিয়ন্ত্রিত']),
    tests: Object.freeze(['tests/routine-unification.test.mjs'])
  }),
  Object.freeze({
    id: 'course-chapter',
    category: 'study',
    name: 'কোর্স ও চ্যাপ্টার',
    owner: OWNERS.MANAGER,
    description: 'শ্রেণি-বিষয়ের কোর্স/অধ্যায় কাঠামো — Manager তৈরি করেন',
    requiredFields: Object.freeze([f('class', 'শ্রেণি'), f('subject', 'বিষয়'), f('title', 'চ্যাপ্টারের নাম')]),
    optionalFields: Object.freeze([]),
    classRequirement: 'required',
    subjectRequirement: 'required',
    groupRequirement: 'forbidden',
    audience: Object.freeze(['class']),
    form: Object.freeze({ component: 'none', handoff: 'courses', editor: 'manager.html' }),
    store: Object.freeze({ key: 'activePlus.courseContent.v1', path: 'activePlusSync/v1/collections/courseContent', repository: 'course-content.js' }),
    permission: Object.freeze({ create: false, edit: false, publish: false, requiresAssignment: false }),
    approval: APPROVAL.ADMIN_MANAGER,
    publishAction: Object.freeze({ label: '—', status: 'published', writer: 'manager panel' }),
    student: Object.freeze({ view: STUDENT_VIEWS.myCourses, label: 'আমার কোর্স', panel: 'পড়াশোনা' }),
    validation: Object.freeze(['Manager-নিয়ন্ত্রিত']),
    tests: Object.freeze(['tests/course-hub.test.mjs'])
  })
]);

export const WORK_FEATURE_BY_ID = Object.freeze(Object.fromEntries(WORK_FEATURES.map(feature => [feature.id, feature])));

export const featureById = id => WORK_FEATURE_BY_ID[String(id || '')] || null;

/** একটি ক্যাটাগরির ফিচার, Teacher-তৈরি করা যায় এমনটি আগে। */
export function featuresOf(categoryId = '', { includeReadOnly = true } = {}) {
  return WORK_FEATURES.filter(feature => (!categoryId || feature.category === categoryId)
    && (includeReadOnly || feature.permission.create));
}

export const teacherFeatures = () => WORK_FEATURES.filter(feature => feature.permission.create);

/** একটা ফিচারের জন্য Teacher-এর ক্ষমতা; role ভিন্ন হলে সব বন্ধ। */
export function teacherCan(featureId, action, role = 'teacher') {
  const feature = featureById(featureId);
  if (!feature || role !== 'teacher') return false;
  return feature.owner === OWNERS.TEACHER && feature.permission[action] === true;
}

export function requiresApproval(featureId) {
  return featureById(featureId)?.approval === APPROVAL.ADMIN_MANAGER;
}

const norm = value => String(value ?? '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

/** শ্রেণি/বিভাগ/বিষয় নির্বাচন এই ফিচারের অনুমোদিত পরিসরে কি না। */
export function scopeWithinAssignment(feature, scope = {}, assignments = []) {
  if (!feature?.permission.requiresAssignment) return true;
  if (norm(feature.category) === 'communication' && !scope.className) return false;
  const targetClass = norm(scope.className);
  if (!targetClass) return false;
  return assignments.some(item => {
    if (norm(item.className) !== targetClass) return false;
    const wantedGroup = norm(scope.group);
    if (wantedGroup && norm(item.group) && norm(item.group) !== wantedGroup) return false;
    const wantedSubject = norm(scope.subject);
    if (wantedSubject && feature.subjectRequirement === 'required') {
      const subjects = Array.isArray(item.subjects) && item.subjects.length ? item.subjects : [item.subject];
      const cleaned = subjects.map(norm).filter(subject => subject && subject !== 'test');
      if (cleaned.length) return cleaned.includes(wantedSubject);
    }
    return true;
  });
}

/**
 * ধাপ ৬–৯: নির্বাচিত ফিচার + scope থেকে কী কী করা যাবে, কী আটকে আছে এবং
 * কোন ফর্ম কোন intent নিয়ে খুলবে — একটাই সত্য-সারণি।
 */
export function planWork({ featureId, role = 'teacher', scope = {}, assignments = [] } = {}) {
  const feature = featureById(featureId);
  if (!feature) return { ok: false, feature: null, blocked: ['অজানা ফিচার'], actions: [], approval: null };
  const blocked = [];
  let allowed = true;
  if (role !== 'teacher') { allowed = false; blocked.push('এই প্যানেলে শুধু শিক্ষক কাজ তৈরি করতে পারেন'); }
  if (!feature.permission.create) { allowed = false; blocked.push('এই ফিচারটি Manager/Admin নিয়ন্ত্রণ করেন'); }
  if (feature.classRequirement === 'required' && !String(scope.className || '').trim()) blocked.push('শ্রেণি নির্বাচন করুন');
  if (feature.subjectRequirement === 'required' && !String(scope.subject || '').trim()) blocked.push('বিষয় নির্বাচন করুন');
  if (feature.permission.requiresAssignment && scope.className && !scopeWithinAssignment(feature, scope, assignments)) {
    blocked.push('এই শ্রেণি/বিষয়/বিভাগে আপনার অ্যাসাইনমেন্ট নেই');
  }
  if (blocked.length) allowed = false;
  const approval = feature.approval;
  const actions = !allowed ? [] : [
    Object.freeze({ id: 'draft', label: 'খসড়া হিসেবে সংরক্ষণ', intent: 'draft', tone: 'ghost' }),
    ...(approval === APPROVAL.DIRECT
      ? [Object.freeze({ id: 'publish', label: feature.publishAction.label || 'প্রকাশ করুন', intent: 'publish', tone: 'primary' })]
      : [Object.freeze({ id: 'approval', label: feature.publishAction.label || 'অনুমোদনের জন্য পাঠান', intent: 'approval', tone: 'primary' })]),
    Object.freeze({ id: 'preview', label: 'প্রিভিউ', intent: 'preview', tone: 'ghost' })
  ];
  return { ok: allowed, feature, blocked, actions, approval };
}

/** এক রেকর্ডের status → Registry-র ভাষা। অজানা status লুকানো হয় না। */
export function recordStatus(record = {}) {
  const raw = String(record.status || (record.published === true ? 'published' : record.published === false ? 'draft' : '') || '').trim();
  return WORK_STATUSES[raw] ? raw : 'draft';
}

/** কাজের তালিকা ছাঁকনি (আমার প্রকাশিত কাজ tab)। */
export function filterByStatus(items = [], status = 'all') {
  if (!status || status === 'all') return items;
  if (status === 'published') return items.filter(item => ['published', 'approved', 'completed'].includes(item.status));
  if (status === 'draft') return items.filter(item => ['draft', 'rejected'].includes(item.status));
  return items.filter(item => item.status === status);
}

/**
 * Registry-র অখণ্ডতা। ফিচার যোগ করার সময় একটি ফিল্ড বাদ পড়লে এখানেই ধরা
 * পড়বে — UI বা test নয়, প্রথমে contract।
 */
export function validateWorkRegistry() {
  const errors = [];
  const ids = new Set();
  const categories = new Set(WORK_CATEGORIES.map(category => category.id));
  const studentViews = new Set(Object.values(STUDENT_VIEWS));
  const statusKeys = new Set(Object.keys(WORK_STATUSES));
  for (const feature of WORK_FEATURES) {
    const where = `feature:${feature.id || '(no id)'}`;
    if (!feature.id) errors.push(`${where} — id নেই`);
    if (ids.has(feature.id)) errors.push(`${where} — ডুপ্লিকেট id`);
    ids.add(feature.id);
    for (const key of ['id', 'category', 'name', 'owner', 'description']) {
      if (!String(feature[key] || '').trim()) errors.push(`${where} — ${key} খালি`);
    }
    if (!categories.has(feature.category)) errors.push(`${where} — অজানা ক্যাটাগরি ${feature.category}`);
    if (!Object.values(OWNERS).includes(feature.owner)) errors.push(`${where} — অজানা owner`);
    if (!Array.isArray(feature.requiredFields) || !feature.requiredFields.length) errors.push(`${where} — requiredFields নেই`);
    if (!Array.isArray(feature.optionalFields)) errors.push(`${where} — optionalFields নেই`);
    for (const field of [...feature.requiredFields, ...feature.optionalFields]) {
      if (!field?.id || !FIELD_LABELS[field.id]) errors.push(`${where} — অজানা ফিল্ড ${field?.id}`);
    }
    for (const key of ['classRequirement', 'subjectRequirement', 'groupRequirement']) {
      if (!['required', 'optional', 'forbidden'].includes(feature[key])) errors.push(`${where} — ${key} সঠিক নয়`);
    }
    if (!Array.isArray(feature.audience) || !feature.audience.length) errors.push(`${where} — audience নেই`);
    if (!feature.form?.component || !feature.form?.handoff) errors.push(`${where} — form/handoff নেই`);
    if (!feature.store?.key || !feature.store?.path || !feature.store?.repository) errors.push(`${where} — store/path/repository নেই`);
    if (!feature.permission || typeof feature.permission.create !== 'boolean') errors.push(`${where} — permission নেই`);
    if (![APPROVAL.DIRECT, APPROVAL.ADMIN_MANAGER].includes(feature.approval)) errors.push(`${where} — approval নীতি সঠিক নয়`);
    if (!statusKeys.has(feature.publishAction?.status)) errors.push(`${where} — publishAction.status অজানা`);
    if (!studentViews.has(feature.student?.view)) errors.push(`${where} — student.view অজানা (${feature.student?.view})`);
    if (!Array.isArray(feature.validation) || !feature.validation.length) errors.push(`${where} — validation নেই`);
    if (!Array.isArray(feature.tests) || !feature.tests.length) errors.push(`${where} — related tests নেই`);
    if (feature.permission.create === false && feature.approval === APPROVAL.DIRECT) {
      errors.push(`${where} — তৈরি না করা গেলে সরাসরি প্রকাশের নীতি অর্থহীন`);
    }
  }
  return { ok: errors.length === 0, errors, count: WORK_FEATURES.length };
}

export function workRegistrySummary() {
  const byCategory = WORK_CATEGORIES.map(category => ({
    ...category,
    total: featuresOf(category.id).length,
    creatable: featuresOf(category.id, { includeReadOnly: false }).length
  }));
  return {
    categories: byCategory,
    total: WORK_FEATURES.length,
    creatable: teacherFeatures().length,
    approvalGated: WORK_FEATURES.filter(feature => feature.approval === APPROVAL.ADMIN_MANAGER).map(feature => feature.id),
    readOnly: WORK_FEATURES.filter(feature => !feature.permission.create).map(feature => feature.id)
  };
}
