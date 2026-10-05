import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoExams, buildDemoTeaching } from '../js/demo-data.js';
import { examRepository, EXAM_KEY, MANAGER_ACTOR } from '../js/exam-data.js';
import { teachingRepository, TEACHING_KEY } from '../js/teaching-data.js';
import { enabledClasses } from '../js/config.js';
import { TEACHER_ASSIGNMENTS_KEY } from '../js/teacher-assignments.js';
import { STAFF_ACCOUNTS } from '../js/staff-auth.js';
for (const date of ['2026-09-22T10:00:00Z','2027-01-01T00:10:00Z']) {
  test(`demo fixtures validate and remain useful across date boundaries: ${date}`,async()=>{
    const now=Date.parse(date), exams=buildDemoExams(now), activities=buildDemoTeaching(now);
    const assignments=enabledClasses.map((className,index)=>({id:`TAS-${index}`,teacherUsername:'teacher.apc',teacherName:'Test Teacher',className,group:'',subject:'Test'}));
    const store=new Map([
      [EXAM_KEY,JSON.stringify({version:1,...exams})],
      [TEACHING_KEY,JSON.stringify({version:1,activities})],
      [TEACHER_ASSIGNMENTS_KEY,JSON.stringify(assignments)],
      [STAFF_ACCOUNTS.manager.accountKey,JSON.stringify({role:'manager',username:STAFF_ACCOUNTS.manager.username,status:'active'})]
    ]);
    globalThis.window={
      localStorage:{getItem:key=>store.get(key)??null},
      sessionStorage:{getItem:key=>key===STAFF_ACCOUNTS.manager.sessionKey?'1':null}
    };
    const db=await examRepository.list(MANAGER_ACTOR); assert.equal(db.exams.length,8); assert.equal(db.attempts.length,7);
    assert.equal((await teachingRepository.list()).activities.length,5);
    const live=db.exams.find(e=>e.id.endsWith('-live')); assert.ok(live.startAt<now && live.endAt>now); assert.ok(now<live.startAt+live.lateMinutes*60000);
    assert.equal(db.attempts.some(a=>a.examId===live.id && a.studentId==='AP-1024'),false);
    assert.deepEqual(new Set(db.exams.map(e=>e.status)),new Set(['draft','pending','published','rejected']));
  });
}
