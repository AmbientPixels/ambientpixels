// valeTeamsNudges — Vale posts to her Teams channel (Stage 1b). Every 15 minutes: read the
// team in HQ's numbers, decide what's worth saying (_lib/vale/teamsNudges), post each card,
// and record only the ones Teams accepted. Dormant until VALE_TEAMS_WEBHOOK_URL is set
// (the channel's Workflows address: a secret app setting, never logged).
'use strict';

var fetch = require('node-fetch');
var storage = require('../_utils/companyStorage');
var vs = require('../_utils/valeStorage');
var { loadTeam } = require('../_lib/vale/teamContext');
var { decide, applyMark } = require('../_lib/vale/teamsNudges');
var { postToTeams } = require('../_lib/vale/teamsPost');

async function run(deps) {
  var url = deps.url;
  if (!url) return { skipped: 'dormant' };
  var now = deps.now();
  var team = await loadTeam(deps.storage, now);
  if (!team) return { skipped: 'task_board_unreadable' };

  var meta = await deps.vs.getValeWithMeta('valeTeamsLog');
  if (meta.failed) return { skipped: 'log_unreadable' }; // never risk re-sending on a read failure
  var log = meta.value || null;

  var d = decide({ now: now, summary: team.summary, pending: team.pending || [], log: log });
  var pendingIds = team.pending ? team.pending.map(function (p) { return p.id; }) : null;
  var sent = [], failed = [];
  for (var i = 0; i < d.messages.length; i++) {
    var m = d.messages[i];
    var r;
    try { r = await postToTeams(url, m, deps.fetch); } catch (e) { r = { ok: false, status: 0 }; }
    if (r.ok) { log = applyMark(log, m, d.date, new Date(now).toISOString(), pendingIds); sent.push(m.kind); }
    else failed.push(m.kind + ':' + r.status);
  }
  if (sent.length) {
    await deps.vs.setVale('valeTeamsLog', log);
  } else if (log && pendingIds) {
    // Quiet tick: write only if items that were decided have dropped out of the log.
    var pruned = applyMark(log, { mark: {} }, log.date || d.date, new Date(now).toISOString(), pendingIds);
    if (Object.keys(pruned.notified).length !== Object.keys(log.notified || {}).length) await deps.vs.setVale('valeTeamsLog', pruned);
  }
  return { sent: sent, failed: failed };
}

module.exports = async function (context) {
  try {
    var result = await run({
      url: process.env.VALE_TEAMS_WEBHOOK_URL || '',
      now: function () { return Date.now(); },
      storage: storage, vs: vs, fetch: fetch
    });
    if (result.sent && result.sent.length || result.failed && result.failed.length) context.log('[valeTeamsNudges] ' + JSON.stringify(result));
  } catch (e) {
    context.log.error('[valeTeamsNudges] ' + (e && e.message));
  }
};
module.exports.run = run;
