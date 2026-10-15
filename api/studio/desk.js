// studio/desk.js — the Video Desk's ticket rules (pure: no Azure, tests in plain node).
// Spec: docs/superpowers/specs/2026-10-14-video-desk-design.md
//
// Two directions, one store (blobs desk/tickets/<id>.json in the private `studio` container):
//   fleet → crew   an AmbientOS agent suggests a video (why now, what, proof). Chad accepts or declines with a
//                  reason; accepted tickets become a video on the project's Board; the Board's progress flows back.
//   crew  → fleet  a Studio role asks the fleet for something (a claims check, research, launch posts).
//
// Everything a ticket may name comes from the video catalogue (memory layer L10), so the fleet can't ask for a
// format, mood or voice the crew can't make — except in `wish`, which is where unmet demand is recorded on purpose.
'use strict';

const CATALOG = require('../_data/video-catalog.json');

const FLEET_STATUSES = ['proposed', 'accepted', 'declined', 'scripting', 'in_production', 'review', 'released', 'dropped'];
const FLEET_OPEN = ['proposed', 'accepted', 'scripting', 'in_production', 'review'];
const CREW_STATUSES = ['open', 'taken', 'done', 'dropped'];
const TRIGGERS = ['release', 'bet_won', 'bet_scale', 'campaign_launch', 'crew_request', 'manual'];
const CREW_KINDS = { claims_check: 'quill', research: 'scout', launch_posts: 'echo', other: 'nova' };
const AGENTS = ['nova', 'echo', 'scout', 'scribe', 'quill', 'forge', 'pixel', 'cipher', 'vale'];
const ID = /^(vt|ct)_[a-z0-9]{6,14}_[a-z0-9]{4}$/;

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (v, n, max) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const newId = (prefix, nowMs) => `${prefix}_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;

const formatIds = () => CATALOG.formats.map((f) => f.id);
const moodIds = () => CATALOG.moods.map((m) => m.id);
const styleIds = () => CATALOG.styles.map((s) => s.id);

// The style follows the subject; it is never chosen (catalogue rule 2).
function styleFor(product, format) {
  if (format === 'inside-ambientos') return 'ap-monolith';
  const p = norm(product);
  for (const s of CATALOG.styles) if ((s.subjects || []).some((x) => norm(x) === p)) return s.id;
  return null;
}

// Copy that says an agent makes videos (catalogue rule 1).
const MAKER = /\b(i|i'll|i will|i've|i have|we'll|we will)\s+(make|made|render|rendered|edit|edited|produce|produced|film|filmed|animate|animated|shoot|shot)\b/i;
const AGENT_MAKER = /\b(agents?|nova|echo|scribe|scout|forge|quill|pixel|cipher|vale)\s+(makes?|made|renders?|rendered|edits?|edited|produces?|produced|films?|filmed|animates?|animated)\b/i;

// A source is product facts, a public page, or /pulse/ (catalogue rule 4).
function validSource(s) {
  return /^product-facts:[A-Za-z]{2,40}$/.test(s) || /^https:\/\/(www\.)?ambientpixels\.ai\/[^\s]*$/.test(s) || /^\/pulse\/[^\s]*$/.test(s);
}

// → clean ticket, or a reason string.
function cleanFleetTicket(b, from, nowMs) {
  if (!b || typeof b !== 'object') return 'ticket must be an object';
  const agent = str(from, 20).toLowerCase();
  if (!AGENTS.includes(agent) && agent !== 'ceo') return 'unknown author';
  const t = b.trigger || {};
  if (!TRIGGERS.includes(t.type)) return 'trigger.type must be one of ' + TRIGGERS.join(', ');
  const ref = str(t.ref, 80);
  if (t.type !== 'manual' && !ref) return 'a trigger needs a ref (the release, bet or campaign it answers)';

  const format = str(b.format, 40);
  if (!formatIds().includes(format)) return 'format must be a catalogue id: ' + formatIds().join(', ');
  const mood = str(b.mood, 20);
  if (!moodIds().includes(mood)) return 'mood must be a catalogue id: ' + moodIds().join(', ');
  const product = str(b.product, 40);
  if (!product) return 'product is required';
  const style = styleFor(product, format);
  if (!style) return `no style wears ${product}; the style follows the product`;

  const title = str(b.title, 80), goal = str(b.goal, 200), hook = str(b.hook, 140);
  if (title.length < 6) return 'title is required';
  if (goal.length < 10) return 'goal is required: what can the viewer do after watching?';
  const f = CATALOG.formats.find((x) => x.id === format);
  let seconds = Number(b.seconds);
  if (!Number.isFinite(seconds)) seconds = f.seconds[1];
  seconds = Math.round(Math.min(Math.max(seconds, f.seconds[0]), f.seconds[1]));

  const claims = (Array.isArray(b.claims) ? b.claims : []).slice(0, 8).map((c) => ({ claim: str(c && c.claim, 200), source: str(c && c.source, 200) }));
  if (!claims.length) return 'at least one claim with a source';
  for (const c of claims) {
    if (!c.claim) return 'a claim is empty';
    if (!validSource(c.source)) return `claim "${c.claim.slice(0, 40)}" needs a source: product-facts:<Product>, an ambientpixels.ai URL, or /pulse/…`;
  }

  const mustSay = list(b.mustSay, 5, 140), mustNotSay = list(b.mustNotSay, 5, 140);
  for (const text of [title, goal, hook, ...mustSay]) {
    if (MAKER.test(text) || AGENT_MAKER.test(text)) return 'agents suggest videos; the studio makes them. Reword: "' + text.slice(0, 60) + '"';
  }
  if (format !== 'inside-ambientos' && /\b(host|hosted|presented|narrated) by (an? )?(agent|nova|echo|scribe|scout|forge|quill|pixel|cipher)\b/i.test([title, goal, hook].join(' '))) {
    return 'agents appear on screen only in inside-ambientos';
  }

  let wish = null;
  if (b.wish && typeof b.wish === 'object') {
    wish = { format: str(b.wish.format, 40) || null, mood: str(b.wish.mood, 40) || null, style: str(b.wish.style, 40) || null, note: str(b.wish.note, 200) || null };
    if (!wish.format && !wish.mood && !wish.style && !wish.note) wish = null;
  }

  const at = new Date(nowMs).toISOString();
  return {
    id: newId('vt', nowMs), direction: 'fleet', from: agent, createdAt: at, updatedAt: at,
    campaignId: str(b.campaignId, 60) || null, objectiveId: str(b.objectiveId, 60) || null, betKey: str(b.betKey, 160) || null,
    trigger: { type: t.type, ref: ref || null, evidence: str(t.evidence, 200) || null },
    product, title, format, style, mood, seconds,
    audience: str(b.audience, 140), goal, hook, mustSay, mustNotSay, claims, wish,
    status: 'proposed', decision: null, studio: null, release: null,
    history: [{ at, by: agent, status: 'proposed', note: null }],
  };
}

function cleanCrewTicket(b, by, nowMs) {
  if (!b || typeof b !== 'object') return 'ticket must be an object';
  const kind = str(b.kind, 20);
  if (!Object.prototype.hasOwnProperty.call(CREW_KINDS, kind)) return 'kind must be one of ' + Object.keys(CREW_KINDS).join(', ');
  const title = str(b.title, 80), text = str(b.text, 1000);
  if (title.length < 4) return 'title is required';
  if (text.length < 10) return 'say what you need';
  const project = str(b.project, 63), video = str(b.video, 80);
  if (project && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(project)) return 'invalid project';
  if (video && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(video)) return 'invalid video';
  const links = list(b.links, 5, 300).filter((l) => /^https:\/\//.test(l));
  const at = new Date(nowMs).toISOString();
  const who = str(by, 40) || 'studio';
  return {
    id: newId('ct', nowMs), direction: 'crew', kind, to: CREW_KINDS[kind], title, text, project: project || null,
    video: video || null, links, fromTicket: ID.test(b.fromTicket || '') ? b.fromTicket : null,
    by: who, createdAt: at, updatedAt: at, status: 'open', taskId: null,
    history: [{ at, by: who, status: 'open', note: null }],
  };
}

function push(t, status, by, note, nowMs) {
  const at = new Date(nowMs).toISOString();
  t.status = status;
  t.updatedAt = at;
  t.history = (t.history || []).concat([{ at, by: str(by, 40) || 'studio', status, note: str(note, 300) || null }]).slice(-40);
}

// Chad's call on a proposed ticket. A decline needs a reason: it is the fleet's training signal.
function decide(t, b, by, nowMs, projects) {
  if (!t || t.direction !== 'fleet') return 'not a fleet ticket';
  if (t.status !== 'proposed') return 'already decided';
  const decision = str(b && b.decision, 10);
  const reason = str(b && b.reason, 500);
  if (decision === 'decline') {
    if (reason.length < 8) return 'a decline needs a reason (it goes back to the agent)';
    t.decision = { decision, by: str(by, 40) || 'chad', at: new Date(nowMs).toISOString(), reason };
    push(t, 'declined', by, reason, nowMs);
    return t;
  }
  if (decision === 'accept') {
    const project = str(b && b.project, 63) || 'ambientpixels';
    if (Array.isArray(projects) && !projects.includes(project)) return 'unknown project';
    t.decision = { decision, by: str(by, 40) || 'chad', at: new Date(nowMs).toISOString(), reason: reason || null };
    t.studio = { project, video: null, trackerIds: [] };
    push(t, 'accepted', by, reason, nowMs);
    return t;
  }
  return 'decision must be accept or decline';
}

// What the worker reports from the Board, or a crew ticket's progress. Never moves a ticket backwards past a decision.
function applyUpdate(t, b, by, nowMs) {
  if (!t) return 'unknown ticket';
  const u = b || {};
  if (t.direction === 'fleet') {
    if (t.status === 'proposed' || t.status === 'declined') return 'the ticket has not been accepted';
    if (u.video !== undefined) {
      const video = str(u.video, 80);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(video)) return 'invalid video';
      t.studio = Object.assign({}, t.studio, { video, trackerIds: list(u.trackerIds, 20, 10) });
    }
    if (u.releaseUrl) {
      const url = str(u.releaseUrl, 300);
      if (!/^https:\/\//.test(url)) return 'release url must be https';
      t.release = { url, at: new Date(nowMs).toISOString() };
    }
    if (u.status && u.status !== t.status) {
      if (!['scripting', 'in_production', 'review', 'released', 'dropped'].includes(u.status)) return 'invalid status';
      push(t, u.status, by, u.note, nowMs);
    } else t.updatedAt = new Date(nowMs).toISOString();
    return t;
  }
  if (u.status && u.status !== t.status) {
    if (!CREW_STATUSES.includes(u.status)) return 'invalid status';
    if (u.taskId) t.taskId = str(u.taskId, 60);
    push(t, u.status, by, u.note, nowMs);
  }
  return t;
}

// Counts the fleet-side gates need (phase 3): open fleet tickets, and each agent's newest ticket.
function fleetLoad(tickets) {
  const open = tickets.filter((t) => t.direction === 'fleet' && FLEET_OPEN.includes(t.status));
  const lastByAgent = {};
  for (const t of tickets) {
    if (t.direction !== 'fleet') continue;
    if (!lastByAgent[t.from] || t.createdAt > lastByAgent[t.from]) lastByAgent[t.from] = t.createdAt;
  }
  const refs = new Set(tickets.filter((t) => t.direction === 'fleet' && t.trigger && t.trigger.ref).map((t) => t.trigger.type + ':' + t.trigger.ref));
  return { open: open.length, lastByAgent, refs };
}

module.exports = {
  CATALOG, FLEET_STATUSES, FLEET_OPEN, CREW_STATUSES, TRIGGERS, CREW_KINDS, ID,
  formatIds, moodIds, styleIds, styleFor, validSource,
  cleanFleetTicket, cleanCrewTicket, decide, applyUpdate, fleetLoad,
};
