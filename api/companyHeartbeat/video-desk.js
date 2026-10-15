// video-desk.js — the fleet's side of the Video department (spec: docs/superpowers/specs/2026-10-14-video-desk-design.md).
//
// The Video department is the Studio crew on Chad's PC. Fleet agents reach it through the company task board:
//   - Nova, Echo and Scout may SUGGEST a video (suggest-video) — it becomes a video_request task assigned to the
//     department's inbox ('studio'). "Rarely" is code, not prompt text (prompt rules lose to objectives):
//       trigger   a major release / launch in the release log (≤14 d), a bet that WON (≤30 d) or went scale-eligible,
//                 or a campaign approved in the last 7 days. Each trigger can start one request, ever.
//       capacity  at most 2 open requests fleet-wide; one per agent per 21 days (declined ones count).
//       content   the department's own rules (studio/desk.js): catalogue ids only, style follows the product, every
//                 claim sourced, no "an agent made this video".
//   - Any agent the department @mentions on a request (crew asking Quill to check claims, Echo for launch posts)
//     sees that comment in its prompt and answers in the thread with comment-task. The @mention is also what wakes
//     an idle agent (helpers.shouldRunAgent).
// Agents never move, edit or execute a request (agent-runner guard); Chad decides on the board.
// Pure except loadReleases().
'use strict';

const desk = require('../studio/desk');

const VIDEO_AGENTS = ['nova', 'echo', 'scout'];
const MAX_OPEN = 2;
const AGENT_COOLDOWN_DAYS = 21;
const RELEASE_WINDOW_DAYS = 14;
const BET_WINDOW_DAYS = 30;
const CAMPAIGN_WINDOW_DAYS = 7;
const REQUEST_MEMORY_DAYS = 30;
const ASK_WINDOW_HOURS = 72;
const DAY = 86400000;

const ageDays = (iso, nowMs) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? (nowMs - t) / DAY : Infinity; };
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

// Requests filed this process but not yet on the board (the heartbeat applies task creates after the agent's run):
// they count for the next agent at once.
let _pending = [];

// data: { tasks, releases, campaigns, ledger } → the requests on the board plus this cycle's pending ones.
function requestsOf(data) {
  const onBoard = desk.requestsFrom(data && data.tasks);
  const known = new Set(onBoard.map((r) => r.trigger && r.trigger.type + ':' + r.trigger.ref));
  // Pending entries live 30 minutes: long enough for the rest of this heartbeat, short enough that a create a
  // guardrail skipped doesn't block the fleet in a warm Function instance.
  _pending = _pending.filter((p) => Date.now() - Date.parse(p.createdAt) < 30 * 60 * 1000);
  return onBoard.concat(_pending.filter((p) => !known.has(p.trigger.type + ':' + p.trigger.ref)));
}

// Every trigger an agent may cite right now, minus the ones a request already used.
function validTriggers(data, nowMs) {
  const used = desk.fleetLoad(requestsOf(data)).refs;
  const out = [];
  for (const e of (data.releases || [])) {
    if (e.status === 'hidden' || !(e.significance === 'major' || e.kind === 'launch')) continue;
    if (ageDays(e.at, nowMs) > RELEASE_WINDOW_DAYS) continue;
    out.push({ type: 'release', ref: e.id, label: clip(e.product + ': ' + e.title, 120), evidence: clip(e.summary || e.title, 200) });
  }
  const ledger = data.ledger || {};
  for (const r of (ledger.rows || [])) {
    if (r.result !== 'won' || ageDays(r.scoredAt, nowMs) > BET_WINDOW_DAYS) continue;
    const a = r.actual || {}, x = r.expected || {};
    out.push({ type: 'bet_won', ref: r.betKey, campaignId: r.campaignId, betKey: r.betKey, label: clip('"' + r.title + '" won', 120),
      evidence: clip(`${a.value} ${x.metric || ''} against ${x.delta} expected, ${a.posts || '?'} posts over ${a.days || '?'} days`, 200) });
  }
  for (const r of (ledger.running || [])) {
    if (!r.scaleEligible) continue;
    out.push({ type: 'bet_scale', ref: r.betKey, campaignId: r.campaignId, betKey: r.betKey, label: clip('"' + r.title + '" passed its scale line', 120), evidence: 'scale rule met (code)' });
  }
  for (const c of (data.campaigns || [])) {
    if (String(c.status || '').toLowerCase() !== 'active' || ageDays(c.createdAt, nowMs) > CAMPAIGN_WINDOW_DAYS) continue;
    out.push({ type: 'campaign_launch', ref: c.id, campaignId: c.id, betKey: (c.bet && c.bet.betKey) || null, label: clip('campaign "' + (c.title || c.id) + '" started', 120), evidence: clip(c.description, 200) });
  }
  return out.filter((t) => !used.has(t.type + ':' + t.ref));
}

// May this agent file a request now? → { ok, open, nextAt, reason }
function capacity(agentId, requests, nowMs) {
  const load = desk.fleetLoad(requests);
  const last = load.lastByAgent[agentId];
  const nextAt = last ? Date.parse(last) + AGENT_COOLDOWN_DAYS * DAY : null;
  if (load.open >= MAX_OPEN) return { ok: false, open: load.open, nextAt, reason: `the Video department already has ${load.open} open requests (max ${MAX_OPEN})` };
  if (nextAt && nextAt > nowMs) return { ok: false, open: load.open, nextAt, reason: `your next suggestion is allowed from ${new Date(nextAt).toISOString().slice(0, 10)}` };
  return { ok: true, open: load.open, nextAt: null, reason: null };
}

// The code gates, in order. → { ok: true, request, task } or { ok: false, gate, reason }
function gateSuggestion(agentId, video, data, productFactKeys, nowMs) {
  if (VIDEO_AGENTS.indexOf(agentId) === -1) return { ok: false, gate: 'video_unauthorized', reason: 'only nova, echo and scout suggest videos' };
  if (!data || !Array.isArray(data.tasks)) return { ok: false, gate: 'video_desk_unavailable', reason: 'the task board could not be read; try a later cycle' };
  const v = video && typeof video === 'object' ? video : {};
  const cap = capacity(agentId, requestsOf(data), nowMs);
  if (!cap.ok) return { ok: false, gate: cap.open >= MAX_OPEN ? 'video_fleet_full' : 'video_agent_cooldown', reason: cap.reason };
  const t = v.trigger || {};
  const match = validTriggers(data, nowMs).find((x) => x.type === t.type && x.ref === t.ref);
  if (!match) return { ok: false, gate: 'video_no_trigger', reason: `trigger ${t.type || '?'}:${t.ref || '?'} is not one of the triggers listed in VIDEO DEPARTMENT` };
  const keys = new Set(productFactKeys || []);
  for (const c of (Array.isArray(v.claims) ? v.claims : [])) {
    const m = /^product-facts:([A-Za-z]+)$/.exec(String(c && c.source || ''));
    if (m && !keys.has(m[1])) return { ok: false, gate: 'video_bad_source', reason: `product-facts:${m[1]} does not exist` };
  }
  const request = desk.cleanRequest(Object.assign({}, v, {
    trigger: { type: match.type, ref: match.ref, evidence: clip(t.evidence, 200) || match.evidence },
    campaignId: v.campaignId || match.campaignId || null,
    betKey: v.betKey || match.betKey || null,
  }), agentId);
  if (typeof request === 'string') return { ok: false, gate: 'video_request_invalid', reason: request };
  return { ok: true, request, task: desk.requestTask(request) };
}

function noteFiled(request, nowMs) {
  _pending.push(Object.assign({}, request, { createdAt: new Date(nowMs || Date.now()).toISOString(), status: 'waiting' }));
}
function _resetPending() { _pending = []; }

function catalogLine() {
  const f = desk.CATALOG.formats.map((x) => `${x.id} ${x.seconds[0]}-${x.seconds[1]}s${x.status === 'available' ? '' : ' (' + x.status.replace('_', ' ') + ')'}`).join('; ');
  const m = desk.CATALOG.moods.map((x) => x.id).join(', ');
  return `FORMATS: ${f}. MOODS: ${m}. The style follows the product (never choose it); agents appear on screen only in inside-ambientos.`;
}

// Comments on requests that @mention this agent, from Chad or the department, in the last 72 h, that the agent
// has not answered since. → [{ taskId, title, who, text }]
function asksFor(agentId, agentName, requests, nowMs) {
  const needle = '@' + String(agentName || agentId).toLowerCase();
  const out = [];
  for (const r of requests) {
    if (!r.taskId) continue;
    const cs = r.comments || [];
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i];
      if (c.who === agentId) break; // answered after the latest ask
      if ((c.who === desk.INBOX || c.who === 'ceo') && c.text.toLowerCase().indexOf(needle) !== -1 && ageDays(c.at, nowMs) * 24 <= ASK_WINDOW_HOURS) {
        out.push({ taskId: r.taskId, title: r.title, who: c.who === 'ceo' ? 'Chad' : 'the Video department', text: clip(c.text, 400) });
        break;
      }
    }
  }
  return out.slice(0, 3);
}

// The VIDEO DEPARTMENT prompt block for one agent, or '' when there is nothing to see or do.
function buildVideoDeskBlock(agentId, agentName, data, nowMs) {
  if (!data || !Array.isArray(data.tasks)) return '';
  const requests = requestsOf(data);
  const asks = asksFor(agentId, agentName, requests, nowMs);
  const canSuggest = VIDEO_AGENTS.indexOf(agentId) !== -1;
  const mine = canSuggest ? requests.filter((r) => r.from === agentId && r.taskId && ageDays(r.updatedAt, nowMs) <= REQUEST_MEMORY_DAYS) : [];
  const cap = canSuggest ? capacity(agentId, requests, nowMs) : { ok: false };
  const triggers = cap.ok ? validTriggers(data, nowMs).slice(0, 4) : [];
  if (!asks.length && !mine.length && !triggers.length) return '';
  const L = ['', '', 'VIDEO DEPARTMENT: the Studio crew (a human-run team) makes short videos. Agents suggest and help; they never make, edit or render a video, and never move or execute a video task.'];
  if (asks.length) {
    L.push('THE VIDEO DEPARTMENT ASKS YOU (answer in that task\'s thread: {"type":"comment-task","taskId":"<id>","comment":"<your answer>"}):');
    asks.forEach((a) => L.push(`- task ${a.taskId} "${clip(a.title, 60)}" — ${a.who}: "${a.text}"`));
  }
  if (mine.length) {
    L.push('YOUR VIDEO REQUESTS:');
    mine.slice(0, 4).forEach((r) => {
      const last = (r.comments || []).filter((c) => c.who === 'ceo' || c.who === desk.INBOX).slice(-1)[0];
      L.push(`- "${clip(r.title, 70)}": ${r.status.replace('_', ' ')}${r.releaseUrl ? ' at ' + r.releaseUrl : ''}${r.reason ? ' — Chad: "' + clip(r.reason, 160) + '"' : last ? ' — ' + (last.who === 'ceo' ? 'Chad' : 'Studio') + ': "' + clip(last.text, 140) + '"' : ''}`);
    });
    if (mine.some((r) => r.status === 'declined')) L.push('A decline reason is Chad teaching you what the department is for: apply it to your next suggestion.');
  }
  if (triggers.length) {
    L.push('TRIGGERS YOU MAY CITE NOW (code accepts no others; each can start one video, ever):');
    triggers.forEach((x) => L.push(`- type=${x.type} ref=${x.ref} — ${x.label}`));
    L.push(catalogLine());
    L.push('Suggest only if a video would serve this trigger better than posts would. Most cycles: suggest nothing.');
    L.push('Put it in taskUpdates: {"type":"suggest-video","video":{"trigger":{"type":"<type>","ref":"<ref>","evidence":"<the number or fact>"},"product":"<product-facts key>","format":"<format id>","mood":"<mood id>","seconds":90,"title":"<≤80>","audience":"<who>","goal":"<what the viewer can do after>","hook":"<first line>","mustSay":["..."],"mustNotSay":["..."],"claims":[{"claim":"...","source":"product-facts:<Key> | https://www.ambientpixels.ai/... | /pulse/"}],"wish":{"format":"<anything, even unbuilt>","mood":"","style":"","note":"<what you would want if the studio could make it>"}}}');
  } else if (canSuggest && !cap.ok && mine.length) {
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

// The release log, cached a few minutes per heartbeat process. [] on any failure.
let _relCache = null;
async function loadReleases(storage, nowMs) {
  const now = nowMs || Date.now();
  if (_relCache && now - _relCache.at < 3 * 60 * 1000) return _relCache.entries;
  let entries = [];
  try { const rl = await storage.getState('releaseLog'); entries = (rl && Array.isArray(rl.entries)) ? rl.entries : []; } catch (_) { entries = []; }
  _relCache = { at: now, entries };
  return entries;
}

module.exports = {
  VIDEO_AGENTS, MAX_OPEN, AGENT_COOLDOWN_DAYS,
  requestsOf, validTriggers, capacity, gateSuggestion, noteFiled, asksFor, buildVideoDeskBlock, buildReleasesBlock, loadReleases, _resetPending,
};
