/* Dummy dataset for the one-click Admin Panel.
   Future API work can replace these records without touching the admin UI. */
import { enabledClasses, schedule } from './config.js';

export const adminStudents = Object.freeze([
  {
    id: 'AP-1024',
    name: 'রাইসা ইসলাম',
    nameEn: 'Raisa Islam',
    fatherName: 'আব্দুল করিম',
    className: 'দশম শ্রেণি',
    group: 'বিজ্ঞান বিভাগ',
    mobile: '01700000000',
    guardianMobile: '01800000000',
    address: 'বাড়ি ১২, রোড ৫, কানুনগোপাড়া, চট্টগ্রাম',
    status: 'approved',
    attendance: 92,
    average: 86,
    enrolledAt: '১৪ সেপ্টেম্বর ২০২৬',
    lastActive: 'আজ, ০৯:৪২'
  },
  {
    id: '260810021',
    name: 'তহমিদ হাসান',
    nameEn: 'Tahmid Hasan',
    fatherName: 'জসিম উদ্দিন',
    className: 'দশম শ্রেণি',
    group: 'বিজ্ঞান বিভাগ',
    mobile: '01811223344',
    guardianMobile: '01911223344',
    address: 'গ্রাম বাসুদী, রংপুর সদর, রংপুর',
    status: 'approved',
    attendance: 88,
    average: 81,
    enrolledAt: '০২ আগস্ট ২০২৬',
    lastActive: 'গতকাল, ১৭:১৫'
  },
  {
    id: '260712005',
    name: 'সাদিয়া আফরিন',
    nameEn: 'Sadia Afrin',
    fatherName: 'মো. শফিকুল ইসলাম',
    className: 'দ্বাদশ শ্রেণি',
    group: 'ব্যবসায় শিক্ষা',
    mobile: '01677889900',
    guardianMobile: '01777889900',
    address: 'হাউজ ৭, ফ্ল্যাট ৩, ভুইয়াপাড়া, বনানী, ঢাকা',
    status: 'pending',
    attendance: 0,
    average: 0,
    enrolledAt: '১৯ সেপ্টেম্বর ২০২৬',
    lastActive: '—'
  },
  {
    id: '260909032',
    name: 'মেহেদী হাসান',
    nameEn: 'Mehedi Hasan',
    fatherName: 'আব্দুল মালেক',
    className: 'নবম শ্রেণি',
    group: 'সাধারণ',
    mobile: '01933445566',
    guardianMobile: '01833445566',
    address: 'বাড়ি ৪৫, বাজার রোড, বোয়ালখালী, চট্টগ্রাম',
    status: 'pending',
    attendance: 0,
    average: 0,
    enrolledAt: '২০ সেপ্টেম্বর ২০২৬',
    lastActive: '—'
  },
  {
    id: '260908018',
    name: 'আরিফ চৌধুরী',
    nameEn: 'Arif Chowdhury',
    fatherName: 'নূরুল চৌধুরী',
    className: 'অষ্টম শ্রেণি',
    group: 'সাধারণ',
    mobile: '01311223344',
    guardianMobile: '01411223344',
    address: 'গ্রাম পাঁচবিলা, বোয়ালখালী, চট্টগ্রাম',
    status: 'pending',
    attendance: 0,
    average: 0,
    enrolledAt: '২১ সেপ্টেম্বর ২০২৬',
    lastActive: '—'
  },
  {
    id: '260810019',
    name: 'ফারহান রহমান',
    nameEn: 'Farhan Rahman',
    fatherName: 'মো. আব্দুর রহমান',
    className: 'দশম শ্রেণি',
    group: 'মানবিক',
    mobile: '01422334455',
    guardianMobile: '01522334455',
    address: 'বাড়ি ৯, লালমাই, চরফয়া, মুন্সিগঞ্জ',
    status: 'rejected',
    attendance: 0,
    average: 0,
    enrolledAt: '২৮ জুলাই ২০২৬',
    lastActive: '—'
  },
  {
    id: '260716011',
    name: 'সুমাইয়া খাতুন',
    nameEn: 'Sumaiya Khatun',
    fatherName: 'মো. ইউসুফ আলী',
    className: 'অনার্স ১ম বর্ষ',
    group: 'বাংলা',
    mobile: '01766778899',
    guardianMobile: '01666778899',
    address: 'রোড ৩, হাউজ ২১, বক্সিবার, বেনাপোল, খুলনা',
    status: 'approved',
    attendance: 95,
    average: 89,
    enrolledAt: '১৫ জুলাই ২০২৬',
    lastActive: 'আজ, ০৮:০৫'
  },
  {
    id: '260613004',
    name: 'ইমরান হোসেন',
    nameEn: 'Imran Hossain',
    fatherName: 'মো. জসিম হোসেন',
    className: 'ডিগ্রি ১ম বর্ষ',
    group: 'সাধারণ',
    mobile: '01555667788',
    guardianMobile: '01755667788',
    address: 'গ্রাম চাঁদপুর, ফুলবাড়ী, মুন্সিগঞ্জ',
    status: 'approved',
    attendance: 78,
    average: 74,
    enrolledAt: '০৫ জুন ২০২৬',
    lastActive: '৩ দিন আগে'
  }
]);

export const classCodes = Object.freeze({
  'অষ্টম শ্রেণি': 'CLS-08',
  'নবম শ্রেণি': 'CLS-09',
  'দশম শ্রেণি': 'CLS-10',
  'একাদশ শ্রেণি': 'CLS-11',
  'দ্বাদশ শ্রেণি': 'CLS-12',
  'ডিগ্রি ১ম বর্ষ': 'CLS-DEG-1',
  'ডিগ্রি ২য় বর্ষ': 'CLS-DEG-2',
  'ডিগ্রি ৩য় বর্ষ': 'CLS-DEG-3',
  'অনার্স ১ম বর্ষ': 'CLS-HON-1',
  'অনার্স ২য় বর্ষ': 'CLS-HON-2',
  'অনার্স ৩য় বর্ষ': 'CLS-HON-3',
  'অনার্স ৪র্থ বর্ষ': 'CLS-HON-4'
});

export const feeCategories = Object.freeze([
  'মাসিক বেতন',
  'ভর্তি ফি',
  'মডেল টেস্ট ফি',
  'লেকচার শিট ফি',
  'পরীক্ষার ফি',
  'অন্যান্য'
]);

export const paymentMethods = Object.freeze([
  'নগদ (Cash)',
  'বিকাশ (bKash)',
  'নগদ (Nagad)',
  'রকেট (Rocket)',
  'ব্যাংক ট্রান্সফার'
]);

export const initialTransactions = Object.freeze([
  {
    id: 'TRX-9821',
    receiptNo: 'REC-2609-01',
    auditCode: 'AUD-TX-9821',
    studentId: 'AP-1024',
    studentName: 'রাইসা ইসলাম',
    className: 'দশম শ্রেণি',
    feeType: 'মাসিক বেতন',
    month: 'সেপ্টেম্বর ২০২৬',
    amount: 1500,
    method: 'বিকাশ (bKash)',
    trxRef: 'BK-89X2190',
    date: '২২ সেপ্টেম্বর ২০২৬',
    collectedBy: 'এডমিন',
    note: 'সেপ্টেম্বর মাসের কোচিং বেতন'
  },
  {
    id: 'TRX-9820',
    receiptNo: 'REC-2609-02',
    auditCode: 'AUD-TX-9820',
    studentId: '260810021',
    studentName: 'তহমিদ হাসান',
    className: 'দশম শ্রেণি',
    feeType: 'মাসিক বেতন',
    month: 'সেপ্টেম্বর ২০২৬',
    amount: 1500,
    method: 'নগদ (Cash)',
    trxRef: 'CSH-0941',
    date: '২২ সেপ্টেম্বর ২০২৬',
    collectedBy: 'এডমিন',
    note: 'নগদে পরিশোধিত'
  },
  {
    id: 'TRX-9819',
    receiptNo: 'REC-2609-03',
    auditCode: 'AUD-TX-9819',
    studentId: '260716011',
    studentName: 'সুমাইয়া খাতুন',
    className: 'অনার্স ১ম বর্ষ',
    feeType: 'মাসিক বেতন',
    month: 'সেপ্টেম্বর ২০২৬',
    amount: 2000,
    method: 'নগদ (Nagad)',
    trxRef: 'NG-430922',
    date: '২১ সেপ্টেম্বর ২০২৬',
    collectedBy: 'এডমিন',
    note: 'অনলাইন পেমেন্ট'
  },
  {
    id: 'TRX-9818',
    receiptNo: 'REC-2609-04',
    auditCode: 'AUD-TX-9818',
    studentId: '260613004',
    studentName: 'ইমরান হোসেন',
    className: 'ডিগ্রি ১ম বর্ষ',
    feeType: 'মডেল টেস্ট ফি',
    month: 'সেপ্টেম্বর ২০২৬',
    amount: 800,
    method: 'নগদ (Cash)',
    trxRef: 'CSH-0938',
    date: '২০ সেপ্টেম্বর ২০২৬',
    collectedBy: 'এডমিন',
    note: 'মডেল টেস্ট ১ ও ২ ফি'
  },
  {
    id: 'TRX-9817',
    receiptNo: 'REC-2608-15',
    auditCode: 'AUD-TX-9817',
    studentId: 'AP-1024',
    studentName: 'রাইসা ইসলাম',
    className: 'দশম শ্রেণি',
    feeType: 'ভর্তি ফি',
    month: 'আগস্ট ২০২৬',
    amount: 3000,
    method: 'বিকাশ (bKash)',
    trxRef: 'BK-77A1045',
    date: '১৪ আগস্ট ২০২৬',
    collectedBy: 'এডমিন',
    note: 'ভর্তি ও রেজিস্ট্রেশন ফি'
  },
  {
    id: 'TRX-9816',
    receiptNo: 'REC-2608-16',
    auditCode: 'AUD-TX-9816',
    studentId: '260810021',
    studentName: 'তহমিদ হাসান',
    className: 'দশম শ্রেণি',
    feeType: 'ভর্তি ফি',
    month: 'আগস্ট ২০২৬',
    amount: 3000,
    method: 'নগদ (Cash)',
    trxRef: 'CSH-0820',
    date: '০২ আগস্ট ২০২৬',
    collectedBy: 'এডমিন',
    note: 'নতুন সেশন ভর্তি ফি'
  },
  {
    id: 'TRX-9815',
    receiptNo: 'REC-2608-17',
    auditCode: 'AUD-TX-9815',
    studentId: '260716011',
    studentName: 'সুমাইয়া খাতুন',
    className: 'অনার্স ১ম বর্ষ',
    feeType: 'লেকচার শিট ফি',
    month: 'আগস্ট ২০২৬',
    amount: 500,
    method: 'রকেট (Rocket)',
    trxRef: 'RK-908123',
    date: '২৫ আগস্ট ২০২৬',
    collectedBy: 'এডমিন',
    note: 'বাংলা সাহিত্যের পূর্ণাঙ্গ শিট'
  }
]);

export const dayNames = Object.freeze({
  sat: 'শনিবার',
  sun: 'রবিবার',
  mon: 'সোমবার',
  tue: 'মঙ্গলবার',
  wed: 'বুধবার',
  thu: 'বৃহস্পতিবার'
});

export { enabledClasses, schedule };
