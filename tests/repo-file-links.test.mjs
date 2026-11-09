/* Attachments that live in the repository's files/ folder.

   A lecture sheet or PDF can be committed under files/ (see files/README.md)
   instead of being pushed into the database: the link stays same-origin, so the
   same record works on localhost, Firebase Hosting and Vercel, and the bytes
   cost no database quota. These checks pin the one resolver every student
   surface uses, so a repository path can never become an unchecked href. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachmentHref, hasAttachment } from '../js/course-content.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the resolver keeps outside links and turns a files/ path into a same-origin one', () => {
  assert.equal(attachmentHref('https://example.test/real-numbers.pdf'), 'https://example.test/real-numbers.pdf');
  assert.equal(attachmentHref('http://example.test/a.pdf'), 'http://example.test/a.pdf');
  assert.equal(attachmentHref('files/lecture-sheets/Narration_Master_Lecture_Sheet_ActivePlus.pdf'),
    './files/lecture-sheets/Narration_Master_Lecture_Sheet_ActivePlus.pdf');
  assert.equal(attachmentHref('./files/a.pdf'), './files/a.pdf');
  assert.equal(attachmentHref('  files/gallery/photo%201.webp  '), './files/gallery/photo%201.webp');
});

test('anything that is not an http(s) link or a files/ path is refused', () => {
  for (const value of [
    '', null, undefined,
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.test/files/a.pdf',          // protocol-relative: another origin
    '/files/a.pdf',                     // rooted at a path, not the folder
    '../files/a.pdf',
    'files/../../etc/passwd',
    'files/a/../../b.pdf',
    'assets/logo-128.png',
    'files\\a.pdf'
  ]) {
    assert.equal(attachmentHref(value), '', `${String(value)} must not become an href`);
  }
});

test('hasAttachment mirrors the resolver for a record', () => {
  assert.equal(hasAttachment({ attachmentUrl: 'files/notices/routine.pdf' }), true);
  assert.equal(hasAttachment({ attachmentUrl: 'https://example.test/a.pdf' }), true);
  assert.equal(hasAttachment({ attachmentUrl: 'javascript:alert(1)' }), false);
  assert.equal(hasAttachment({}), false);
});

test('the student hub and the study sections read attachments through the resolver', () => {
  for (const file of ['js/course-hub.js', 'js/student-study-sections.js']) {
    const source = read(file);
    assert.match(source, /import \{[^}]*attachmentHref[^}]*\} from '\.\/course-content\.js'/, `${file} imports the resolver`);
    assert.doesNotMatch(source, /https\?:\\\/\\\/\/i\.test\([^)]*attachmentUrl/, `${file} must not test attachmentUrl itself`);
    assert.match(source, /attachmentHref\(/, `${file} uses the resolver`);
  }
  /* The editor form offers the folder instead of a domain the teacher must know. */
  assert.match(read('js/course-editor.js'), /files\/lecture-sheets/, 'the attachment field mentions files/');
});
