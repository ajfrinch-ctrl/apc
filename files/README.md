# files/ — ফাইল ভান্ডার (PDF, ছবি, শিট)

ডাটাবেজে (Firebase / Supabase) বড় ফাইল রাখবেন না। সব শিট, প্রশ্নপত্র, নোটিশ,
রুটিন বা ছবি **এই ফোল্ডারে** ফাইল হিসেবে রাখুন — GitHub-এ ভার্সন থাকবে,
ওয়েবসাইট থেকে সরাসরি লিংক দেওয়া যাবে, আর ডাটাবেজের quota খরচ হবে না।

## ফোল্ডার নিয়ম

```
files/
├─ lecture-sheets/     # ক্লাসের লেকচার শিট (PDF)
├─ exam-papers/        # প্রশ্নপত্র / মডেল টেস্ট (PDF)
├─ notices/            # নোটিশ, রুটিন, সূচি (PDF / ছবি)
└─ gallery/            # ছবি (jpg / png / webp)
```

নতুন ধরনের ফাইল দরকার হলে এখানেই ছোট হাতের ইংরেজি নামে সাব-ফোল্ডার খুলুন
(যেমন `files/results/`)।

## ফাইলের নাম

* শুধু ইংরেজি অক্ষর, সংখ্যা, `-` এবং `_` ব্যবহার করুন — স্পেস দেবেন না।
* প্যাটার্ন: `Subject_Class_Topic_YYYY-MM-DD.pdf`
  উদাহরণ: `English_2nd_Paper_SSC_Narration_2026-11-09.pdf`
* একই ফাইলের নতুন সংস্করণ দিলে তারিখ বদলান, পুরোনোটা মুছে ফেলুন।

## সাইটে লিংক

ফোল্ডারটি ডিপ্লয় হয়, তাই ফাইলের পাবলিক লিংক:

```
https://<your-domain>/files/lecture-sheets/Narration_Master_Lecture_Sheet_ActivePlus.pdf
```

অ্যাপের ফর্মে (নোটিশ, ক্লাস মেটেরিয়াল, লেকচার শিটের সংযুক্তি — `attachmentUrl`)
**পুরো https লিংকটাই** পেস্ট করুন, কারণ ফর্মটি `/^https?:\/\//` দিয়ে যাচাই করে:

```
https://<your-domain>/files/lecture-sheets/Narration_Master_Lecture_Sheet_ActivePlus.pdf
```

নিজের লেখা HTML/লিংকে চাইলে আপেক্ষিক পথও চলবে:
`./files/lecture-sheets/Narration_Master_Lecture_Sheet_ActivePlus.pdf`

## মনে রাখবেন

* এই ফোল্ডার Firebase Hosting ও Vercel দুই জায়গাতেই সার্ভ হয়
  (`firebase.json`-এর ignore তালিকা বা `.vercelignore`-এ `files` যোগ করবেন না)।
* এখানকার ফাইল সার্ভিস-ওয়ার্কার precache করে না, তাই অ্যাপের ইনস্টল-সাইজ
  বাড়ে না — ব্যবহারকারী খোলার সময়ই ডাউনলোড হয়।
* ফাইল মুছে ফেললে পুরোনো লিংক ভেঙে যাবে; তাই নাম পরিবর্তন না করে নতুন
  সংস্করণে নতুন তারিখ দিয়ে রাখাই ভালো।
* `*.md` ফাইল হোস্টিংয়ে যায় না — এই README শুধু রিপোজিটরিতে থাকে।

## বর্তমান ফাইল

| ফাইল | বিবরণ |
| --- | --- |
| `lecture-sheets/Narration_Master_Lecture_Sheet_ActivePlus.pdf` | English 2nd Paper — Narration মাস্টার লেকচার শিট (A4, ১৮ পৃষ্ঠা)। সোর্স ও বিল্ড কমান্ড: `tools/lecture-sheet-pdf/` |
