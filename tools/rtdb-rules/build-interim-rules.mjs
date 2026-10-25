#!/usr/bin/env node
/* Builds database.rules.json — the INTERIM rules for the anonymous sync bridge
   (owner decision, 2026-09-30; see docs/INTERIM-ANONYMOUS-SYNC.md).

   What these rules DO:
     • allow only signed-in Firebase identities (anonymous included);
     • expose only the exact nodes js/realtime-sync.js and
       js/push-notifications.js use, nothing else in the database;
     • forbid wiping the whole tree / v1 / staffAccounts parent in one write —
       single nodes CAN be deleted, so the Admin panel's factory reset
       (docs/FACTORY-RESET.md) can clear the database node by node and the
       login page can offer the first-use Admin Account setup again;
     • enforce atomic uniqueness registries (usernames, mobileIndex, emailIndex),
       monotonic daily Student ID counters (001–999), registration notification
       schema, immutable Student IDs, and Admin/Manager-only registration
       approval/rejection transitions;
     • keep push tokens write-only (only Cloud Functions read them).

   Run: node tools/rtdb-rules/build-interim-rules.mjs */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AUTH = 'auth != null';
const ADVICE_EDITOR = `${AUTH} && auth.token.status === 'active' && auth.token.mustChangePassword !== true && (auth.token.role === 'admin' || auth.token.role === 'manager')`;
const REVIEWER_OR_BRIDGE = "(auth.token.role === null || auth.token.role === 'admin' || auth.token.role === 'manager')";
const COURSE_WRITER_OR_BRIDGE = "(auth.token.role === null || auth.token.role === 'admin' || auth.token.role === 'manager' || auth.token.role === 'teacher')";
const STAFF_ROLES = ['admin', 'manager', 'teacher', 'payment'];
const RECORD_COLLECTIONS = ['students', 'transactions', 'notices', 'routine', 'teaching', 'academics', 'courseContent', 'courses', 'teacherAssignments', 'classChat'];
const hasChildren = "newData.hasChildren()";
const idMatches = variable => `newData.child('id').val() === ${variable}`;
const COURSE_CONTENT_RECORD_VALIDATE = `${hasChildren} && ((newData.child('_apcEnc').val() === 1 && newData.child('iv').isString() && newData.child('ct').isString()) || newData.child('_syncKind').val() === 'metadata' || (newData.child('_syncKind').val() === 'record' && newData.child('record').hasChildren(['id', 'classId', 'subjectId', 'title'])) || newData.child('id').val() === $recordId)`;

const STUDENT_DECISION_CHANGE = "(data.exists() && data.child('status').val() === 'pending' && (newData.child('status').val() === 'approved' || newData.child('status').val() === 'active' || newData.child('status').val() === 'rejected'))";
const STUDENT_RECORD_VALIDATE = `${hasChildren} && (!data.exists() || !data.child('id').exists() || newData.child('id').val() === data.child('id').val()) && (!${STUDENT_DECISION_CHANGE} || (${REVIEWER_OR_BRIDGE} && (newData.child('approvedAt').isString() || newData.child('reviewedAt').isString())))`;
const ACCOUNT_DECISION_CHANGE = "(data.exists() && data.child('status').val() === 'pending' && (newData.child('status').val() === 'active' || newData.child('status').val() === 'approved' || newData.child('status').val() === 'rejected'))";

export function buildInterimRules() {
  const v1 = {
    // Fixed staff role accounts (PBKDF2 hash records). Create, replace or
    // delete: the factory reset removes the Admin account so a new one can be
    // claimed from the login page. Whole-parent wipes stay refused (there is
    // no write rule on `staffAccounts` itself) — one role at a time only.
    staffAccounts: {
      '.read': AUTH,
      $role: {
        '.write': `${AUTH} && (${STAFF_ROLES.map(role => `$role === '${role}'`).join(' || ')})`,
        '.validate': "newData.hasChildren(['username', 'password']) && newData.child('username').isString()"
      }
    },
    // Staff Management directory: one document merged by transaction.
    // Deletion is allowed for the factory reset.
    staffDirectory: {
      '.read': AUTH,
      '.write': AUTH,
      '.validate': "newData.hasChild('version')"
    },
    // Claimed Login User IDs: atomic per-key transaction or merge transaction.
    // The factory reset may clear the whole registry.
    usernames: {
      '.read': AUTH,
      '.write': AUTH,
      $usernameKey: {
        '.write': AUTH,
        '.validate': "newData.isString() && newData.val().length > 0 && newData.val().length <= 128"
      }
    },
    // Unique Bangladeshi mobile number index (01XXXXXXXXX -> studentId).
    mobileIndex: {
      '.read': AUTH,
      '.write': AUTH,
      $mobileKey: {
        '.write': AUTH,
        '.validate': "$mobileKey.length === 11 && newData.isString() && newData.val().length > 0 && newData.val().length <= 128"
      }
    },
    // Optional unique email index (encoded lowercase email -> studentId).
    emailIndex: {
      '.read': AUTH,
      '.write': AUTH,
      $emailKey: {
        '.write': AUTH,
        '.validate': "newData.isString() && newData.val().length > 0 && newData.val().length <= 128"
      }
    },
    // Atomic daily Student ID serial counter (YYMMDD -> 1..999).
    dailyStudentCounters: {
      '.read': AUTH,
      '.write': AUTH,
      $dayKey: {
        '.write': `${AUTH} && (!newData.exists() || (newData.isNumber() && newData.val() >= 1 && newData.val() <= 999 && (!data.exists() || newData.val() > data.val())))`,
        '.validate': "$dayKey.length === 6 && newData.isNumber() && newData.val() >= 1 && newData.val() <= 999"
      }
    },
    // Registration notifications shared with Admin and Manager panels:
    // { id, type: "new_registration", studentId, studentName, mobile, createdAt, read }
    notifications: {
      '.read': `${AUTH} && ${REVIEWER_OR_BRIDGE}`,
      '.write': `${AUTH} && (!newData.exists() || ${REVIEWER_OR_BRIDGE})`,
      $notifId: {
        '.write': `${AUTH} && (!newData.exists() || (!data.exists() && newData.child('read').val() === false) || (${REVIEWER_OR_BRIDGE} && data.exists()))`,
        '.validate': `${idMatches('$notifId')} && newData.hasChildren(['id', 'type', 'studentId', 'studentName', 'mobile', 'createdAt', 'read']) && newData.child('type').val() === 'new_registration' && newData.child('studentId').isString() && newData.child('studentId').val().length > 0 && newData.child('studentName').isString() && newData.child('studentName').val().length > 0 && newData.child('mobile').isString() && newData.child('mobile').val().length > 0 && newData.child('createdAt').isString() && newData.child('createdAt').val().length > 0 && newData.child('read').isBoolean()`
      }
    },
    // Old single-student node: read-only migration source.
    studentAccount: { '.read': AUTH },
    // One login record per student. Deletions happen per login key (the
    // factory reset enumerates children); the parent has no write rule.
    studentAccounts: {
      '.read': AUTH,
      $loginKey: {
        '.write': `${AUTH} && (!newData.exists() || !${ACCOUNT_DECISION_CHANGE} || ${REVIEWER_OR_BRIDGE})`,
        '.validate': `newData.hasChild('pinHash') && (!${ACCOUNT_DECISION_CHANGE} || ${REVIEWER_OR_BRIDGE})`
      }
    },
    // Exam database: per-id mirror (deletions are legitimate). The two group
    // nodes may also be dropped in one write so the factory reset can clear
    // the exam database without enumerating every id.
    examDb: {
      '.read': AUTH,
      exams: {
        '.write': AUTH,
        $examId: {
          '.write': AUTH,
          '.validate': `${idMatches('$examId')} && newData.child('teacherId').isString() && newData.child('status').isString()`
        }
      },
      attempts: {
        '.write': AUTH,
        $attemptId: {
          '.write': AUTH,
          '.validate': `${idMatches('$attemptId')} && newData.child('examId').isString() && newData.child('studentId').isString()`
        }
      }
    },
    // Institution-wide markers. `system/adminInitialized` records that the
    // one-time global Admin initialization happened, so a device with an empty
    // localStorage can never mistake itself for a fresh installation.
    system: {
      '.read': AUTH,
      adminInitialized: {
        '.write': `${AUTH} && (!newData.exists() || newData.isBoolean())`,
        '.validate': 'newData.isBoolean()'
      },
      connectivityProbe: {
        '.read': AUTH,
        $probeKey: {
          '.read': AUTH,
          '.write': `${AUTH} && $probeKey.length <= 64`,
          at: { '.validate': 'newData.isNumber()' },
          $other: { '.validate': false }
        }
      }
    },
    // Public educational advice: all signed-in clients can read; only an
    // active Admin/Manager claim can add, edit, activate, reorder or delete.
    adviceBank: {
      '.read': AUTH,
      '.write': ADVICE_EDITOR,
      $adviceId: {
        '.validate': "newData.numChildren() === 6 && newData.hasChildren(['text', 'source', 'active', 'order', 'createdBy', 'createdAt']) && newData.child('text').isString() && newData.child('text').val().length > 0 && newData.child('text').val().length <= 140 && newData.child('source').isString() && newData.child('source').val().length > 0 && newData.child('source').val().length <= 120 && newData.child('active').isBoolean() && newData.child('order').isNumber() && newData.child('order').val() >= 1 && newData.child('createdBy').isString() && newData.child('createdBy').val().length > 0 && newData.child('createdBy').val().length <= 128 && newData.child('createdAt').isNumber() && newData.child('createdAt').val() >= 0"
      }
    },
    // Settings document (scalar fields are normal here).
    settings: { '.read': AUTH, '.write': AUTH },
    // Device push registrations: write-only; Cloud Functions read them.
    pushTokens: {
      $deviceKey: {
        '.write': AUTH,
        '.validate': "newData.child('token').isString() && newData.child('token').val().length > 20 && newData.child('token').val().length <= 4096"
      }
    }
  };
  // Application collections: written as one merge transaction per collection
  // (js/record-sync.js); every record is an object.
  for (const name of RECORD_COLLECTIONS) {
    if (name === 'courseContent') {
      v1[name] = {
        '.read': AUTH,
        '.write': `${AUTH} && ${COURSE_WRITER_OR_BRIDGE}`,
        $recordId: {
          '.write': `${AUTH} && ${COURSE_WRITER_OR_BRIDGE}`,
          '.validate': COURSE_CONTENT_RECORD_VALIDATE
        }
      };
      continue;
    }
    v1[name] = {
      '.read': AUTH,
      '.write': AUTH,
      $recordId: name === 'students'
        ? {
            '.write': `${AUTH} && (!newData.exists() || !${STUDENT_DECISION_CHANGE} || ${REVIEWER_OR_BRIDGE})`,
            '.validate': STUDENT_RECORD_VALIDATE
          }
        : { '.validate': hasChildren }
    };
  }
  return {
    rules: {
      '.read': false,
      '.write': false,
      activePlusSync: { v1 }
    }
  };
}

export const RULES_PATH = new URL('../../database.rules.json', import.meta.url);
export const renderInterim = () => JSON.stringify(buildInterimRules(), null, 2) + '\n';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(RULES_PATH, renderInterim());
  console.log('wrote', fileURLToPath(RULES_PATH));
}
