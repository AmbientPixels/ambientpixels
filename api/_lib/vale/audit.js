// audit.js — Vale's mailbox audit trail: one entry per run or connection event, never
// message content (no subjects, senders or bodies). Ring of 500 in vale/valeMailAudit.
'use strict';

var AUDIT_KEY = 'valeMailAudit';
var CAP = 500;

// store: { mutate(key, fn) }. entry: { at, run, calls?, messages?, events?, ok, error? }
async function appendAudit(store, entry) {
  var clean = {
    at: entry.at || new Date().toISOString(),
    run: String(entry.run || 'unknown'),
    calls: entry.calls || 0,
    messages: entry.messages || 0,
    events: entry.events || 0,
    ok: !!entry.ok
  };
  if (entry.error) clean.error = String(entry.error).slice(0, 200);
  try {
    await store.mutate(AUDIT_KEY, function (cur) {
      var list = Array.isArray(cur) ? cur.slice() : [];
      list.push(clean);
      return list.length > CAP ? list.slice(-CAP) : list;
    });
    return true;
  } catch (e) {
    return false; // auditing must never break the run it records
  }
}

module.exports = { appendAudit: appendAudit, AUDIT_KEY: AUDIT_KEY, CAP: CAP };
