// video-desk.js — the fleet's side of the Video Desk (spec: docs/superpowers/specs/2026-10-14-video-desk-design.md).
//
// Nova, Echo and Scout may SUGGEST a video to the studio, rarely. "Rarely" is code, not prompt text — prompt rules
// lose to objectives (project_agent_autonomy_verdict) — so everything an agent may cite is computed here from data:
//
//   trigger   a major release / launch in the release log (≤14 d), a bet that WON (≤30 d) or went scale-eligible,
//             or a campaign approved in the last 7 days. Each trigger can start one ticket, ever.
//   capacity  at most 2 open fleet tickets; one ticket per agent per 21 days (declined ones count).
//   content   the studio's own rules (desk.js): catalogue ids only, style follows the product, every claim sourced,
//             no "an agent made this video".
//
// The prompt block appears only when the agent has a ticket in flight or may suggest one now, so most cycles cost
// nothing. Pure except loadVideoDeskData().
'use strict';

const desk = require('../studio/desk');

const VIDEO_AGENTS = ['nova', 'echo', 'scout'];
const MAX_OPEN = 2;
const AGENT_COOLDOWN_DAYS = 21;
const RELEASE_WINDOW_DAYS = 14;
const BET_WINDOW_DAYS = 30;
const CAMPAIGN_WINDOW_DAYS = 7;
const TICKET_MEMORY_DAYS = 30;
const DAY = 86400000;

const ageDays = (iso, nowMs) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? (nowMs - t) / DAY : Infinity; };
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

// Every trigger an agent may cite right now, minus the ones a ticket already used.
function validTriggers(data, nowMs) {
  const used = desk.fleetLoad(data.tickets || []).refs;
  const out = [];
  for (const e of (data.releases || [])) {
    if (e.status === 'hidden' || !(e.significance === 'major' || e.kind === 'launch')) continue;
    if (ageDays(e.at, nowMs) > RELEASE_WINDOW_DAYS) continue;
    out.push({ type: 'release', ref: e.id, product: e.product, label: clip(e.product + ': ' + e.title, 120), evidence: clip(e.summary || e.title, 200) });
  }
  const ledger = data.ledger || {};
  for (const r of (ledger.rows || [])) {
    if (r.result !== 'won' || ageDays(r.scoredAt, nowMs) > BET_WINDOW_DAYS) continue;
    const a = r.actual || {}, x = r.expected || {};
    out.push({ type: 'bet_won', ref: r.betKey, product: r.product, campaignId: r.campaignId, betKey: r.betKey, label: clip('"' + r.title + '" won', 120),
      evidence: clip(`${a.value} ${r.expected && r.expected.metric || ''} against ${x.delta} expected, ${a.posts || '?'} posts over ${a.days || '?'} days`, 200) });
  }
  for (const r of (ledger.running || [])) {
    if (!r.scaleEligible) continue;
    out.push({ type: 'bet_scale', ref: r.betKey, product: null, campaignId: r.campaignId, betKey: r.betKey, label: clip('"' + r.title + '" passed its scale line', 120), evidence: 'scale rule met (code)' });
  }
  for (const c of (data.campaigns || [])) {
    if (String(c.status || '').toLowerCase() !== 'active' || ageDays(c.createdAt, nowMs) > CAMPAIGN_WINDOW_DAYS) continue;
    out.push({ type: 'campaign_launch', ref: c.id, product: (c.bet && c.bet.product) || null, campaignId: c.id, betKey: (c.bet && c.bet.betKey) || null, label: clip('campaign "' + (c.title || c.id) + '" started', 120), evidence: clip(c.description, 200) });
  }
  return out.filter((t) => !used.has(t.type + ':' + t.ref));
}

// May this agent file a ticket now? → { ok, open, nextAt, reason }
function capacity(agentId, tickets, nowMs) {
  const load = desk.fleetLoad(tickets || []);
  const last = load.lastByAgent[agentId];
  const nextAt = last ? Date.parse(last) + AGENT_COOLDOWN_DAYS * DAY : null;
  if (load.open >= MAX_OPEN) return { ok: false, open: load.open, nextAt, reason: `the studio already has ${load.open} open video tickets (max ${MAX_OPEN})` };
  if (nextAt && nextAt > nowMs) return { ok: false, open: load.open, nextAt, reason: `your next suggestion is allowed from ${new Date(nextAt).toISOString().slice(0, 10)}` };
  return { ok: true, open: load.open, nextAt: null, reason: null };
}

// The code gates, in order. → { ok: true, body } (ready for desk-store.fileFleetTicket) or { ok: false, gate, reason }
function gateSuggestion(agentId, video, data, productFactKeys, nowMs) {
  if (VIDEO_AGENTS.indexOf(agentId) === -1) return { ok: false, gate: 'video_unauthorized', reason: 'only nova, echo and scout suggest videos' };
  if (!data || !Array.isArray(data.tickets)) return { ok: false, gate: 'video_desk_unavailable', reason: 'the video desk could not be read; try a later cycle' };
  const v = video && typeof video === 'object' ? video : {};
  const cap = capacity(agentId, data.tickets, nowMs);
  if (!cap.ok) return { ok: false, gate: cap.open >= MAX_OPEN ? 'video_fleet_full' : 'video_agent_cooldown', reason: cap.reason };
  const t = v.trigger || {};
  const match = validTriggers(data, nowMs).find((x) => x.type === t.type && x.ref === t.ref);
  if (!match) return { ok: false, gate: 'video_no_trigger', reason: `trigger ${t.type || '?'}:${t.ref || '?'} is not one of the triggers listed in VIDEO DESK` };
  const keys = new Set(productFactKeys || []);
  for (const c of (Array.isArray(v.claims) ? v.claims : [])) {
    const m = /^product-facts:([A-Za-z]+)$/.exec(String(c && c.source || ''));
    if (m && !keys.has(m[1])) return { ok: false, gate: 'video_bad_source', reason: `product-facts:${m[1]} does not exist` };
  }
  const body = Object.assign({}, v, {
    trigger: { type: match.type, ref: match.ref, evidence: clip(t.evidence, 200) || match.evidence },
    campaignId: v.campaignId || match.campaignId || null,
    betKey: v.betKey || match.betKey || null,
  });
  return { ok: true, body };
}

function catalogLine() {
  const f = desk.CATALOG.formats.map((x) => `${x.id} ${x.seconds[0]}-${x.seconds[1]}s${x.status === 'available' ? '' : ' (' + x.status.replace('_', ' ') + ')'}`).join('; ');
  const m = desk.CATALOG.moods.map((x) => x.id).join(', ');
  return `FORMATS: ${f}. MOODS: ${m}. The style follows the product (never choose it); agents appear on screen only in inside-ambientos.`;
}

// The VIDEO DESK prompt block for one agent, or '' when there is nothing to see or do.
function buildVideoDeskBlock(agentId, data, nowMs) {
  if (VIDEO_AGENTS.indexOf(agentId) === -1 || !data || !Array.isArray(data.tickets)) return '';
  const mine = data.tickets.filter((t) => t.direction === 'fleet' && t.from === agentId && ageDays(t.updatedAt, nowMs) <= TICKET_MEMORY_DAYS);
  const cap = capacity(agentId, data.tickets, nowMs);
  const triggers = cap.ok ? validTriggers(data, nowMs).slice(0, 4) : [];
  if (!mine.length && !triggers.length) return '';
  const L = ['', '', 'VIDEO DESK (rare): a human-run studio makes short videos. You may SUGGEST one; you never make, edit or render it.'];
  if (mine.length) {
    L.push('YOUR VIDEO TICKETS:');
    mine.slice(0, 4).forEach((t) => {
      const why = t.decision && t.decision.reason ? ` — CEO: "${clip(t.decision.reason, 160)}"` : '';
      L.push(`- "${clip(t.title, 70)}": ${t.status.replace('_', ' ')}${t.release && t.release.url ? ' at ' + t.release.url : ''}${why}`);
    });
    if (mine.some((t) => t.status === 'declined')) L.push('A decline reason is the CEO teaching you what the studio is for: apply it to your next suggestion.');
  }
  if (triggers.length) {
    L.push('TRIGGERS YOU MAY CITE NOW (code accepts no others; each can start one video, ever):');
    triggers.forEach((x) => L.push(`- type=${x.type} ref=${x.ref} — ${x.label}`));
    L.push(catalogLine());
    L.push('Suggest only if a video would serve this trigger better than posts would. Most cycles: suggest nothing.');
    L.push('Put it in taskUpdates: {"type":"suggest-video","video":{"trigger":{"type":"<type>","ref":"<ref>","evidence":"<the number or fact>"},"product":"<product-facts key>","format":"<format id>","mood":"<mood id>","seconds":90,"title":"<≤80>","audience":"<who>","goal":"<what the viewer can do after>","hook":"<first line>","mustSay":["..."],"mustNotSay":["..."],"claims":[{"claim":"...","source":"product-facts:<Key> | https://www.ambientpixels.ai/... | /pulse/"}],"wish":{"format":"<anything, even unbuilt>","mood":"","style":"","note":"<what you would want if the studio could make it>"}}}');
  } else if (!cap.ok && mine.length) {
    L.push(`(No new suggestions now: ${cap.reason}.)`);
  }
  return L.join('\n');
}

// RECENT RELEASES: what is actually live, from the Release Watcher. Hidden entries never show.
function buildReleasesBlock(releases, nowMs) {
  const live = (releases || []).filter((e) => e.status !== 'hidden' && ageDays(e.at, nowMs) <= RELEASE_WINDOW_DAYS)
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6);
  if (!live.length) return '';
  return ['', '', 'RECENT RELEASES (live on ambientpixels.ai, last 14 days; logged by code from deploys — cite these, do not invent others):']
    .concat(live.map((e) => `- ${String(e.at).slice(0, 10)} ${e.product}: ${clip(e.title, 90)}${e.significance === 'major' ? ' [major]' : ''}`)).join('\n');
}

// ── crew → fleet ──────────────────────────────────────────────────────────
// A Studio role asks the fleet (claims check → Quill, research → Scout, launch posts → Echo, other → Nova).
// Deterministic, during the receiving agent's own run: an open ask becomes ONE task (marker in the description,
// because created tasks don't keep tags); once the task exists the ticket is "taken"; when the task is done the
// ticket is "done" with the agent's last comment, which the studio reads on the Desk. If a heartbeat guardrail
// skipped the create, the next run simply tries again — the marker makes it idempotent.
const CREW_AGENTS = ['quill', 'scout', 'echo', 'nova'];
const CREW_TASK_TYPE = { claims_check: 'editorial', research: 'research', launch_posts: 'general', other: 'general' };
const marker = (id) => '[video-desk:' + id + ']';

function crewTicketWork(agentId, tickets, tasks, objectiveId, nowMs) {
  const out = { creates: [], updates: [] };
  if (CREW_AGENTS.indexOf(agentId) === -1 || !Array.isArray(tickets)) return out;
  const all = Array.isArray(tasks) ? tasks : [];
  for (const t of tickets) {
    if (t.direction !== 'crew' || t.to !== agentId || ['open', 'taken'].indexOf(t.status) === -1) continue;
    const task = all.find((x) => x && typeof x.description === 'string' && x.description.indexOf(marker(t.id)) !== -1);
    if (!task) {
      if (t.status === 'open' && out.creates.length === 0) {
        out.creates.push({
          title: clip('Studio ask: ' + t.title, 120),
          description: [marker(t.id) + ' The video studio asked the fleet for this (' + t.kind.replace('_', ' ') + ').',
            t.text, t.project ? 'Project: ' + t.project + (t.video ? ' / video ' + t.video : '') : '',
            t.links && t.links.length ? 'Links: ' + t.links.join(' ') : '',
            'When you finish, put the answer in your last comment on this task: the studio reads it on its Desk.'].filter(Boolean).join('\n\n'),
          taskType: CREW_TASK_TYPE[t.kind] || 'general', status: 'todo', priority: 'medium', assignee: agentId,
          dueDate: new Date(nowMs + 3 * DAY).toISOString(), objective_id: objectiveId || null, campaign_id: t.campaignId || null,
        });
      }
      continue;
    }
    const st = String(task.status || '').toLowerCase();
    if (st === 'done') {
      const c = Array.isArray(task.comments) && task.comments.length ? task.comments[task.comments.length - 1] : null;
      const note = clip((c && (c.text || c.comment)) || task.result || 'done', 300);
      out.updates.push({ id: t.id, status: 'done', taskId: task.id, note });
    } else if (st === 'canceled' || st === 'cancelled') {
      out.updates.push({ id: t.id, status: 'dropped', taskId: task.id, note: 'the fleet task was canceled' });
    } else if (t.status === 'open') {
      out.updates.push({ id: t.id, status: 'taken', taskId: task.id, note: 'task ' + task.id + ' for ' + agentId });
    }
  }
  return out;
}

// Loaded once per heartbeat process (a few minutes' cache): the release log and the desk's tickets.
let _cache = null;
async function loadVideoDeskData(storage, nowMs, store) {
  const now = nowMs || Date.now();
  if (_cache && now - _cache.at < 3 * 60 * 1000) return _cache.data;
  const data = { releases: [], tickets: null };
  try { const rl = await storage.getState('releaseLog'); data.releases = (rl && Array.isArray(rl.entries)) ? rl.entries : []; } catch (_) { data.releases = []; }
  try { data.tickets = await (store || require('../studio/desk-store')).listTickets(); } catch (_) { data.tickets = null; }
  _cache = { at: now, data };
  return data;
}
// A ticket filed this cycle counts at once for the next agent, not after the cache expires.
function noteFiled(ticket) { if (_cache && _cache.data && Array.isArray(_cache.data.tickets)) _cache.data.tickets.unshift(ticket); }
function _resetCache() { _cache = null; }

module.exports = {
  VIDEO_AGENTS, CREW_AGENTS, MAX_OPEN, AGENT_COOLDOWN_DAYS, crewTicketWork,
  validTriggers, capacity, gateSuggestion, buildVideoDeskBlock, buildReleasesBlock, loadVideoDeskData, noteFiled, _resetCache,
};
