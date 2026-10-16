// task-status.js — the ONE definition of an open task and an overdue task for every HQ page.
// The API has the same rules in api/_shared/taskStatus.js; keep the two identical.
//
// Why (2026-10-16): each page decided "overdue" on its own, most as `status !== 'done'`, so canceled and archived
// tasks with old due dates showed as overdue — the dashboard reported a backlog that no longer existed.
(function () {
  'use strict';
  var CLOSED = ['done', 'canceled', 'cancelled', 'archived'];
  function isClosed(t) { return !!t && (t._archived === true || CLOSED.indexOf(String(t.status || '').toLowerCase()) !== -1); }
  function isOpen(t) { return !!t && !isClosed(t); }
  // Overdue = open AND its due date has passed. Due dates may be full ISO times or plain YYYY-MM-DD days.
  function isOverdue(t, nowMs) {
    if (!isOpen(t) || !t.dueDate) return false;
    var due = Date.parse(t.dueDate);
    return isFinite(due) && due < (nowMs || Date.now());
  }
  window.TaskStatus = { CLOSED: CLOSED, isClosed: isClosed, isOpen: isOpen, isOverdue: isOverdue };
})();
