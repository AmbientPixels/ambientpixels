// laneBackpressure.js — do not mint work nobody can get to.
//
// THE BUG THIS EXISTS FOR (2026-08-22)
// The active-task ceiling in agent-runner.js only guards `create-task` actions that
// AGENTS emit. The automated lanes — roast prospects, bluesky participation,
// engagement replies — push straight onto the tasks array and never consult it. So
// the cap read 50 while the real count was 84, and the number kept climbing.
//
// Measured that day:
//   Scribe open tasks            55  (36 bluesky_reply, 18 social_copy)
//   ...created that day alone    21
//   Scribe max drain rate        12/day  (3 actions/cycle x 4 cycles)
//   ...realistic drain          ~8/day  (mandatory peer review claims a slot)
//
// Intake 21/day against a drain of 8/day. The backlog grew ~13/day and could never
// converge; the oldest task was 11 days old. Redistributing does not help and would
// break the pipeline on purpose: Echo briefs, Scribe writes, Quill reviews, and
// Cipher/Scout/Vale/Pixel/Forge are not writers. There is nobody to hand copy to.
//
// So the fix is backpressure at the source. A lane checks how much unfinished work
// its assignee already holds of that kind, and mints nothing beyond it.
//
// WHY A QUEUE DEPTH AND NOT A RATE
// A per-day mint cap still accumulates whenever the drain rate dips (a QG failure
// streak, a cooldown, a skipped cycle). Depth is self-correcting: the queue only
// reopens as the assignee actually finishes things, so the lane automatically slows
// when the agent is struggling and speeds up when it is not.

'use strict';

// One day of realistic drain. Deliberately not the theoretical 12: mandatory peer
// review claims Scribe's first action slot most cycles, and a QG rejection burns
// another. A queue this deep is roughly "everything you could finish today".
var DEFAULT_QUEUE_DEPTH = 8;

function _isOpen(t) {
  var s = String((t && t.status) || '').toLowerCase();
  return s !== 'done' && s !== 'archived' && s !== 'canceled' && s !== 'cancelled';
}

/**
 * How many more tasks of this kind may be minted for this assignee right now.
 *
 * @param {Array}  tasks     the tasks array
 * @param {string} assignee  agent id, e.g. 'scribe'
 * @param {string|string[]} taskTypes  taskType(s) this lane produces
 * @param {number} [depth]   max open tasks of that kind (default 8)
 * @returns {{remaining:number, open:number, depth:number}}
 */
function laneCapacity(tasks, assignee, taskTypes, depth) {
  var cap = Number.isFinite(depth) && depth >= 0 ? depth : DEFAULT_QUEUE_DEPTH;
  var types = Array.isArray(taskTypes) ? taskTypes : [taskTypes];
  var wanted = {};
  types.forEach(function (t) { if (t) wanted[String(t).toLowerCase()] = true; });
  var who = String(assignee || '').toLowerCase();

  var open = 0;
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t || !_isOpen(t)) return;
    if (String(t.assignee || '').toLowerCase() !== who) return;
    if (!wanted[String(t.taskType || '').toLowerCase()]) return;
    open++;
  });

  return { remaining: Math.max(0, cap - open), open: open, depth: cap };
}

// ── Stale reply-task expiry ─────────────────────────────────────────────────
// The drafts in the approval queue already expire at 3 days (REPLY_EXPIRE_DAYS in
// proposal-generator.js). The TASKS behind them did not, so a reply task that was
// never drafted at all just sat: 36 open bluesky_reply tasks, the oldest 11 days.
//
// A reply task is perishable for the same reason its draft is. The thread it answers
// moved on a week ago, and the scheduler independently refuses to post any reply
// older than 3 days (STALE_REPLY in actionsScheduler) — so drafting one is work that
// provably cannot ship. Closing them is not giving up on the work; it is declining to
// do work the next stage will throw away.
var REPLY_TASK_EXPIRE_DAYS = 3;

/**
 * Close reply tasks past the window. Mutates in place, returns what it closed.
 * @returns {Array} the tasks that were expired
 */
function expireStaleReplyTasks(tasks, nowMs, days) {
  var d = Number.isFinite(days) ? days : REPLY_TASK_EXPIRE_DAYS;
  var cutoff = nowMs - d * 86400000;
  var out = [];
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t || !_isOpen(t)) return;
    if (String(t.taskType || '').toLowerCase() !== 'bluesky_reply') return;
    var ts = Date.parse(t.createdAt || t.created_at || '') || 0;
    // ts === 0 means no usable timestamp. Treating that as the epoch would expire
    // every malformed task on sight, so skip it explicitly rather than guess.
    if (ts === 0 || ts >= cutoff) return;
    var age = Math.round((nowMs - ts) / 86400000);
    t.status = 'canceled';
    t.completedAt = new Date(nowMs).toISOString();
    t.updatedAt = t.completedAt;
    if (!Array.isArray(t.comments)) t.comments = [];
    t.comments.push({
      id: 'cmt-stalereply-' + ts,
      author: 'system',
      type: 'system',
      text: 'Closed unstarted after ' + age + ' days. Replies age out at ' + d + ' days: the thread has moved on, '
        + 'and actionsScheduler refuses to post any reply older than that anyway, so drafting this could not have shipped.'
    });
    out.push(t);
  });
  return out;
}

module.exports = {
  DEFAULT_QUEUE_DEPTH: DEFAULT_QUEUE_DEPTH,
  REPLY_TASK_EXPIRE_DAYS: REPLY_TASK_EXPIRE_DAYS,
  laneCapacity: laneCapacity,
  expireStaleReplyTasks: expireStaleReplyTasks
};
