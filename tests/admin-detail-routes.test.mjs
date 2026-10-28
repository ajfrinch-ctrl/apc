import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  DETAIL_VIEW_PARENTS, VIEW_SEAT, createAccess, enforceCapabilities,
  routeFromHash, viewCapability
} from '../js/admin-permissions.js';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const newDocument = () => new JSDOM(html).window.document;
const entries = Object.entries(DETAIL_VIEW_PARENTS);

test('every Admin detail is a unique sibling screen with its own labelled Back', () => {
  const doc = newDocument();
  const main = doc.querySelector('#adminMain');
  assert.equal(entries.length, 35);
  for (const [view, parent] of entries) {
    const panels = doc.querySelectorAll(`.admin-view[data-view-panel="${view}"]`);
    assert.equal(panels.length, 1, `${view} exists once`);
    const panel = panels[0];
    assert.equal(panel.parentElement, main, `${view} is not nested inside its hub`);
    assert.equal(panel.dataset.parentView, parent);
    assert.ok(doc.getElementById(panel.getAttribute('aria-labelledby')), `${view} has its own heading`);
    assert.equal(panel.querySelector('[data-admin-back]')?.dataset.adminBack, parent);
    assert.equal(routeFromHash(`#${view}`), view);
  }
  for (const parent of new Set(entries.map(([, value]) => value))) {
    const hub = doc.querySelector(`.admin-view[data-view-panel="${parent}"]`);
    assert.ok(hub, `${parent} hub exists`);
    assert.equal(hub.querySelectorAll('[data-admin-section-toggle], [data-admin-section-panel]').length, 0,
      `${parent} does not expand a primary detail in place`);
  }
});

test('all details inherit exactly their hub capability and bottom seat for every role', () => {
  for (const [view, parent] of entries) {
    assert.equal(viewCapability(view), viewCapability(parent), view);
    assert.equal(VIEW_SEAT[view], VIEW_SEAT[parent] || parent, view);
    for (const role of ['admin', 'manager', 'teacher', 'payment', 'student', 'unknown']) {
      const access = createAccess(role);
      assert.equal(access.allowsView(view), access.allowsView(parent), `${role}: ${view}`);
    }
  }
  assert.equal(routeFromHash('#not-a-real-view'), null);
  assert.equal(createAccess('admin').allowsView('finance'), false);
});

test('capability enforcement removes forbidden detail markup, not merely its launcher', () => {
  for (const role of ['manager', 'teacher', 'payment', 'student', 'unknown']) {
    const doc = newDocument();
    const access = createAccess(role);
    const result = enforceCapabilities({ root: doc, access });
    for (const [view, parent] of entries) {
      if (access.allowsView(parent)) {
        assert.ok(doc.querySelector(`.admin-view[data-view-panel="${view}"]`), `${role}: permitted ${view} remains`);
      } else {
        assert.equal(doc.querySelector(`.admin-view[data-view-panel="${view}"]`), null, `${role}: ${view} removed`);
        assert.ok(result.views.includes(view), `${role}: ${view} recorded`);
      }
    }
  }
});

test('existing controls are preserved once in their dedicated static screens', () => {
  const doc = newDocument();
  const controls = {
    'data-stats': ['dataCollectionList', 'dataRefreshButton'],
    'data-danger': ['dataClearSelect', 'dataClearButton', 'factoryResetButton'],
    'backup-export': ['backupExportButton'],
    'backup-restore': ['backupFileInput', 'backupRestoreButton'],
    'audit-log': ['gradeAuditList'],
    'audit-exam': ['adminExamWorkspace'],
    'settings-branding': ['cfgTagline', 'btnSaveAppSettings'],
    'settings-classes': ['classList'],
    'settings-broadcast': ['cfgBroadcastMessage', 'btnSaveBroadcast'],
    'settings-maintenance': ['cfgMaintenanceMessage', 'btnSaveMaintenance'],
    'content-lecture-sheets': ['adminLectureSheetsMount'],
    'content-notices': ['adminNoticeReviewList'],
    'content-records': ['adminContentReviewList'],
    'advice-editor': ['adminDailyAdvice']
  };
  for (const [view, ids] of Object.entries(controls)) {
    for (const id of ids) {
      assert.equal(doc.querySelectorAll(`#${id}`).length, 1, `one #${id}`);
      assert.ok(doc.querySelector(`.admin-view[data-view-panel="${view}"] #${id}`), `${id} remains in ${view}`);
    }
  }
  for (const id of ['adminAcademics', 'adminV2Migration', 'adminProfileCard', 'adminProfileForm', 'adminPasswordForm']) {
    assert.equal(doc.querySelectorAll(`#${id}`).length, 1, `one reusable #${id}`);
  }
});
