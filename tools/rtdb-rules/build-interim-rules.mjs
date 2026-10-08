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
     • check basic record shape, so the database can't be used as free storage;
     • keep push tokens write-only (only Cloud Functions read them).

   What they DO NOT do: tell one app user from another. Any signed-in identity
   can read and change the synced data. That is the accepted interim risk;
   docs/RTDB-PER-USER-RULES-PLAN.md is the replacement.

   Run: node tools/rtdb-rules/build-interim-rules.mjs */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AUTH = 'auth != null';
const STAFF_ROLES = ['admin', 'manager', 'teacher', 'payment'];
const RECORD_COLLECTIONS = ['students', 'transactions', 'notices', 'routine', 'teaching', 'academics', 'courseContent', 'teacherAssignments'];
const hasChildren = "newData.hasChildren()";
const idMatches = variable => `newData.child('id').val() === ${variable}`;

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
    // Claimed Login User IDs: the client only ever adds (merge transaction).
    // The factory reset may clear the whole registry.
    usernames: {
      '.read': AUTH,
      '.write': AUTH
    },
    // Old single-student node: read-only migration source.
    studentAccount: { '.read': AUTH },
    // One login record per student. Deletions happen per login key (the
    // factory reset enumerates children); the parent has no write rule.
    studentAccounts: {
      '.read': AUTH,
      $loginKey: {
        '.write': AUTH,
        '.validate': "newData.hasChild('pinHash')"
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
    // localStorage can never mistake itself for a fresh installation. It is a
    // marker, never the evidence: the Admin record above is what really
    // decides. The factory reset may delete it to reopen first-use setup.
    system: {
      '.read': AUTH,
      adminInitialized: {
        '.write': `${AUTH} && (!newData.exists() || newData.isBoolean())`,
        '.validate': 'newData.isBoolean()'
      },
      /* Login-page diagnostic (js/firebase-diagnostics.js): a signed-in device
         proves the rules really allow a write with a tiny `{at: <millis>}`
         record that it removes the same second. Deletion must stay possible
         (cleanup), so the write rule does not require newData.exists(); the
         child guard keeps the node from becoming free storage — the only
         accepted child is a numeric `at`. */
      connectivityProbe: {
        $probeKey: {
          '.write': `${AUTH} && $probeKey.length <= 64`,
          at: { '.validate': 'newData.isNumber()' },
          $other: { '.validate': false }
        }
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
    v1[name] = { '.read': AUTH, '.write': AUTH, $recordId: { '.validate': hasChildren } };
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
