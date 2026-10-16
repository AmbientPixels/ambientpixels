// taskStatus.js — the ONE definition of an open task and an overdue task, for every report and API.
// The browser has the same rules in modules/company/js/task-status.js; keep the two identical.
//
// Why (2026-10-16): each page and report decided "overdue" on its own, most as `status !== 'done'`, so canceled and
// archived tasks with old due dates were counted as overdue — the dashboard showed a backlog that no longer existed.
'use strict';

const CLOSED = ['done', 'canceled', 'cancelled', 'archived'];

const isClosed = (t) => !!t && (t._archived === true || CLOSED.indexOf(String(t.status || '').toLowerCase()) !== -1);
const isOpen = (t) => !!t && !isClosed(t);

// Overdue = open AND its due date has passed. Due dates may be full ISO times or plain YYYY-MM-DD days.
function isOverdue(t, nowMs) {
  if (!isOpen(t) || !t.dueDate) return false;
  const due = Date.parse(t.dueDate);
  return Number.isFinite(due) && due < (nowMs || Date.now());
}

module.exports = { CLOSED, isClosed, isOpen, isOverdue };
