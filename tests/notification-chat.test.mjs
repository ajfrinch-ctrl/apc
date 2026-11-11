import './node-test-setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { KEYS } from '../js/database.js';

test('Notification Center includes unread chat only from the signed-in student room', async t => {
  const student = { id: 'CHAT-NOTIFY-10', name: 'রাইসা', className: 'দশম শ্রেণি', group: 'বিজ্ঞান বিভাগ' };
  const ctx = await loadPage('student.html', { seed: {
    [KEYS.account]: JSON.stringify({ username: 'raisa.chat', status: 'active', student }),
    [KEYS.students]: JSON.stringify([{ ...student, status: 'approved' }])
  } });
  t.after(() => ctx.window.close());
  ctx.$('#appShell').hidden = false;

  const chat = await import('../js/class-chat.js?notification-chat-feed');
  const teacher = { id: 'CHAT-TEACHER-1', name: 'শিক্ষক', role: 'teacher', status: 'active' };
  const ownRoom = chat.sendClassMessage({ className: 'দশম শ্রেণি', text: 'দশম শ্রেণির নতুন ক্লাস বার্তা', actor: teacher });
  chat.sendClassMessage({ className: 'নবম শ্রেণি', text: 'অন্য শ্রেণির গোপন বার্তা', actor: teacher });

  const notifications = await import('../js/notifications.js?notification-chat-feed');
  const engine = notifications.initNotifications();
  await ctx.flush();
  const messages = engine.feed().filter(item => item.kind === 'chat');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].sourceId, ownRoom.id);
  assert.equal(messages[0].category, 'chat');
  assert.match(messages[0].body, /দশম শ্রেণির নতুন ক্লাস বার্তা/);
  assert.doesNotMatch(messages[0].body, /অন্য শ্রেণির গোপন বার্তা/);

  chat.markClassRoomRead({ ...student, role: 'student', status: 'approved' }, 'দশম শ্রেণি');
  await ctx.flush();
  engine.refresh();
  await ctx.flush();
  assert.equal(engine.unread(), 0, 'reading the class room acknowledges its chat notifications');
  assert.equal(engine.records().find(item => item.key === `chat:${ownRoom.id}`)?.read, true);

});
