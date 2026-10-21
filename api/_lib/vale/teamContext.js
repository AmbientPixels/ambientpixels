// teamContext — where the team is, for Vale. Built from the same summary HQ Today shows
// (hq-summary's buildSummary over api/_shared/metrics), so Vale can never count differently
// from HQ: "what needs me?" and "what did the team do?" get the numbers the page shows.
// Read-only. The Office chat uses it; the Teams channel posts reuse it.
'use strict';

const { buildSummary, SOURCES } = require('../../hq-summary');

const TZ = 'America/Los_Angeles';
const when = (iso) => {
  const t = Date.parse(iso || '');
  if (!t) return null;
  return new Date(t).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const day = (iso) => {
  const t = Date.parse(iso || '');
  return t ? new Date(t).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }) : null;
};
const nm = (b) => !b || b.state === 'not_measured';
const money = (n) => (n === null || n === undefined) ? 'not measured' : '$' + Number(n).toFixed(2);

// Same reads as GET /api/hq-summary. Returns null when the task board can't be read,
// the one source the summary cannot do without.
async function loadTeamSummary(storage, nowMs) {
  const reads = await Promise.all(SOURCES.map((k) => storage.getStateWithMeta(k)));
  const state = {};
  SOURCES.forEach((k, i) => {
    if (!reads[i].failed) state[k] = reads[i].value === null ? (k === 'agentRegistry' ? { agents: [] } : []) : reads[i].value;
  });
  if (state.tasks === undefined) return null;
  return buildSummary(state, nowMs || Date.now());
}

// The summary plus the FULL waiting list (the summary keeps only the oldest three), with
// agent names, for Vale's Teams posts. pending is null when the queue couldn't be read.
async function loadTeam(storage, nowMs) {
  const M = require('../../_shared/metrics');
  const reads = await Promise.all(SOURCES.map((k) => storage.getStateWithMeta(k)));
  const state = {};
  SOURCES.forEach((k, i) => {
    if (!reads[i].failed) state[k] = reads[i].value === null ? (k === 'agentRegistry' ? { agents: [] } : []) : reads[i].value;
  });
  if (state.tasks === undefined) return null;
  const summary = buildSummary(state, nowMs || Date.now());
  const agents = (state.agentRegistry && state.agentRegistry.agents) || [];
  const nameOf = (id) => {
    const a = agents.find((x) => x && x.id === id);
    if (a && a.name) return a.name;
    if (!id) return null;
    if (['ceo', 'chad'].indexOf(String(id).toLowerCase()) !== -1) return null;
    return String(id).charAt(0).toUpperCase() + String(id).slice(1);
  };
  const pending = state.approvalQueue === undefined ? null
    : M.pendingDecisions({ approvalQueue: state.approvalQueue, tasks: state.tasks })
      .map((p) => Object.assign({}, p, { from: nameOf(p.from) }));
  return { summary, pending };
}

function formatTeamContext(summary) {
  if (!summary || !summary.blocks) {
    return '\n\n(The team summary is unavailable right now. If asked about the team, say so; never invent numbers.)';
  }
  const b = summary.blocks;
  const lines = ['\n\nTHE TEAM RIGHT NOW (as of ' + when(summary.asOf) + ' Pacific; the same numbers HQ shows):'];

  const h = b.health;
  if (h) {
    lines.push('- Health: ' + h.text + '.');
    (h.issues || []).slice(1).forEach((i) => lines.push('  - also: ' + i.text + '.'));
  }

  const w = b.waiting;
  if (nm(w)) lines.push('- Waiting on Chad: not measured (' + ((w && w.reason) || 'unreadable') + ').');
  else {
    lines.push('- Waiting on Chad: ' + w.count + (w.count ? ', oldest first:' : '.'));
    (w.items || []).forEach((p) => lines.push('  - "' + p.title + '"' + (p.from ? ' from ' + p.from : '') + (p.since ? ', since ' + day(p.since) : '') + ' (' + p.type + ')'));
    if (w.count > (w.items || []).length) lines.push('  - and ' + (w.count - w.items.length) + ' more on the Actions page.');
  }

  const g = b.goal;
  if (g && g.title) {
    lines.push('- Goal: ' + g.title + ' — ' + g.label + ': ' +
      (g.state === 'measured' ? g.value + (g.target !== null ? ' of ' + g.target : '') + (g.by ? ' by ' + g.by : '') : 'not measured') + '.');
  } else if (nm(g)) lines.push('- Goal: not measured.');
  else lines.push('- Goal: none set.');

  const wk = b.week;
  if (wk) {
    lines.push('- Last 7 days: ' + (wk.published === null ? 'posts published not measured' : wk.published + ' posts published') +
      ', ' + wk.tasksDone + ' tasks done, model spend ' + money(wk.spend) + ' (month to date ' + money(wk.spendMonth) + ').');
  }

  const c = b.campaigns;
  if (nm(c)) lines.push('- Campaigns: not measured.');
  else if (!(c.items || []).length) lines.push('- Campaigns: none active.');
  else {
    lines.push('- Active campaigns:');
    c.items.forEach((p) => lines.push('  - ' + p.title + ': ' +
      (p.status === 'not_measured' ? 'pace not measured' : p.done + ' of ' + p.planned + ' ' + p.period + ' (' + p.status.replace('_', ' ') + ')') +
      (p.open ? ', ' + p.open + ' open' : '') + '.'));
  }

  const f = b.fleet;
  if (f) {
    if ((f.busy || []).length) {
      lines.push('- Agents with work queued:');
      f.busy.forEach((a) => lines.push('  - ' + a.name + ': ' + a.queue + ' waiting' + (a.clearBy ? ', clears about ' + a.clearBy : '') + '.'));
    }
    if ((f.onCall || []).length) lines.push('- Nothing queued: ' + f.onCall.join(', ') + '.');
    if ((f.dormant || []).length) lines.push('- Switched off: ' + f.dormant.join(', ') + '.');
  }

  const ev = b.happened;
  if (nm(ev)) lines.push('- Last 24 hours: not measured.');
  else if (!(ev.items || []).length) lines.push('- Last 24 hours: nothing recorded.');
  else {
    lines.push('- Last 24 hours (' + ev.total + ' events, newest first):');
    ev.items.forEach((e) => lines.push('  - ' + when(e.at) + ': ' + e.text));
  }

  lines.push('Use only these team facts. Where something says "not measured", say that rather than guessing. Approvals are decided on the Actions page.');
  return lines.join('\n');
}

module.exports = { loadTeamSummary, loadTeam, formatTeamContext };
