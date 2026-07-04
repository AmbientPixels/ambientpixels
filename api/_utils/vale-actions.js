// vale-actions.js — PURE CEO action-list CRUD helpers (no I/O). The action-list is the
// CEO's personal to-dos (things only the human can do, e.g. Product Hunt launch).
'use strict';

function addAction(list, input, now) {
  now = now || Date.now();
  input = input || {};
  var arr = Array.isArray(list) ? list.slice() : [];
  arr.push({
    id: 'act_' + now + '_' + Math.random().toString(36).slice(2, 7),
    title: String(input.title || '').slice(0, 200),
    detail: String(input.detail || ''),
    deadline: input.deadline || null,
    status: 'open',
    source: input.source || 'ceo',
    createdAt: new Date(now).toISOString()
  });
  return arr;
}

function completeAction(list, id) {
  return (Array.isArray(list) ? list : []).map(function (x) {
    return x.id === id ? Object.assign({}, x, { status: 'done' }) : x;
  });
}

function updateAction(list, id, patch) {
  patch = patch || {};
  var allow = ['title', 'detail', 'deadline', 'status'];
  return (Array.isArray(list) ? list : []).map(function (x) {
    if (x.id !== id) return x;
    var next = Object.assign({}, x);
    allow.forEach(function (k) { if (k in patch) next[k] = patch[k]; });
    return next;
  });
}

function removeAction(list, id) {
  return (Array.isArray(list) ? list : []).filter(function (x) { return x.id !== id; });
}

module.exports = { addAction, completeAction, updateAction, removeAction };
