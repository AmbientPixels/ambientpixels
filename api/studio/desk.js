// studio/desk.js — the Video department's request rules (pure: no Azure, tests in plain node).
// Spec: docs/superpowers/specs/2026-10-14-video-desk-design.md (§8: the Video department).
//
// The Video department is the Studio crew on Chad's PC. It has no ticket system of its own: a fleet agent's video
// suggestion is a TASK on the company board, assigned to the department's inbox ('studio', which never runs in the
// heartbeat), and everything after that is the task's comments:
//   Chad      decides on the board: in-progress = accepted, canceled + a comment = declined (the reason teaches).
//   Studio    posts progress as "[studio:<stage>]" comments, @Quill/@Scout/@Echo when it needs the fleet, and the
//             release link with @Echo for launch posts; done = released.
//   Agents    answer in the same thread (comment-task); they may not move, edit or execute the task.
//
// Everything a request may name comes from the video catalogue (memory layer L10), so the fleet can't ask for a
// format, mood or voice the crew can't make — except in `wish`, which is where unmet demand is recorded on purpose.
'use strict';

const CATALOG = require('../_data/video-catalog.json');

const VIDEO_TASK_TYPE = 'video_request';
const INBOX = 'studio';
const TRIGGERS = ['release', 'bet_won', 'bet_scale', 'campaign_launch', 'manual'];
const AGENTS = ['nova', 'echo', 'scout', 'scribe', 'quill', 'forge', 'pixel', 'cipher', 'vale'];
// What a request is, as the department sees it.
const STATUSES = ['waiting', 'accepted', 'scripting', 'in_production', 'review', 'released', 'declined'];
const OPEN = ['waiting', 'accepted', 'scripting', 'in_production', 'review'];
const STAGES = ['scripting', 'in_production', 'review', 'released'];
const FENCE = /```video-request\n([\s\S]*?)\n```/;

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (v, n, max) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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

// A suggestion → the clean request payload, or a reason string.
function cleanRequest(b, from) {
  if (!b || typeof b !== 'object') return 'request must be an object';
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

  return {
    v: 1, from: agent, trigger: { type: t.type, ref: ref || null, evidence: str(t.evidence, 200) || null },
    product, title, format, style, mood, seconds, audience: str(b.audience, 140), goal, hook, mustSay, mustNotSay, claims, wish,
    campaignId: str(b.campaignId, 60) || null, objectiveId: str(b.objectiveId, 60) || null, betKey: str(b.betKey, 160) || null,
  };
}

// The request as a company task: a brief people can read, and the payload code reads back.
function requestTask(r) {
  const lines = [
    `**Video request from ${r.from}.** Agents suggest videos; the Video department (the Studio crew) makes them.`,
    `Chad: move to in-progress to accept, or cancel with a comment saying why (${r.from} learns from it).`,
    '',
    `- Why now: ${r.trigger.type}${r.trigger.ref ? ' ' + r.trigger.ref : ''}${r.trigger.evidence ? ': ' + r.trigger.evidence : ''}`,
    `- ${r.product} · ${r.format} · about ${r.seconds} s · ${r.mood} mood · style ${r.style} (follows the product)`,
    `- Goal: ${r.goal}`,
    r.hook ? `- Hook: ${r.hook}` : null,
    r.audience ? `- For: ${r.audience}` : null,
    '',
    'Claims:',
    ...r.claims.map((c, i) => `${i + 1}. ${c.claim} (${c.source})`),
    r.wish ? `\nWish: ${[r.wish.format, r.wish.mood, r.wish.style, r.wish.note].filter(Boolean).join(' · ')}` : null,
    '',
    '```video-request',
    JSON.stringify(r),
    '```',
  ].filter((l) => l !== null);
  return {
    title: str('Video: ' + r.title, 120), description: lines.join('\n'), taskType: VIDEO_TASK_TYPE, assignee: INBOX,
    division: 'video', status: 'todo', priority: 'medium',
    dueDate: null, campaign_id: r.campaignId || null, objective_id: r.objectiveId || null,
  };
}

const isRequestTask = (t) => !!t && t.taskType === VIDEO_TASK_TYPE;

// Every comment shape on the board, normalized: agents write {author}, the board writes {agentId} (null = Chad),
// tasksPatch writes {author}.
function commentsOf(task) {
  return (Array.isArray(task && task.comments) ? task.comments : []).map((c) => {
    const who = String(c.author || c.user || c.agentId || '').toLowerCase() || 'ceo';
    return { who: who === 'pixelpusher' || who === 'chad' || who === 'unknown' ? 'ceo' : who, text: String(c.text || c.comment || c.body || ''), at: c.createdAt || c.created_at || c.timestamp || null };
  });
}

// "[studio:scripting video=04-scan]" — the department's progress markers.
const MARK = /^\[studio:([a-z_]+)(?:\s+video=([A-Za-z0-9._-]+))?(?:\s+project=([a-z0-9-]+))?\]/;
const studioMark = (stage, video, project) => `[studio:${stage}${video ? ' video=' + video : ''}${project ? ' project=' + project : ''}]`;

// Chad's two checkpoints on a video in production (approvals queue, 2026-10-16). The Studio opens one with
// "[studio:checkpoint script]" when the Board's work reaches review; Chad's decision lands as "[ceo:approved script]"
// or "[ceo:sent back script] <reason>". The latest marker per kind is its state; each re-open is a new round.
// "publish" (2026-10-16) is the YouTube step: approved with a pasted link (manual upload) or without one (the
// youtubePublishCron uploads it once the API audit has passed and systemConfig.youtube.audited is true).
const CHECKPOINTS = ['script', 'cut', 'publish'];
const CP_MARK = /^\[studio:checkpoint (script|cut|publish)\]\s*([\s\S]*)$/;
const CEO_MARK = /^\[ceo:(approved|sent back) (script|cut|publish)\]\s*([\s\S]*)$/;
// What the uploader reports on the task: "[studio:youtube https://youtu.be/<id>]" or "[studio:youtube-failed] why".
const YT_MARK = /^\[studio:youtube (https:\/\/youtu\.be\/[A-Za-z0-9_-]{6,20})\]/;
const YT_FAIL = /^\[studio:youtube-failed\]/;
const YT_URL = /^https:\/\/(youtu\.be\/[A-Za-z0-9_-]{6,20}|(www\.)?youtube\.com\/(watch\?v=|shorts\/)[A-Za-z0-9_-]{6,20})\S*$/;
const youtubeOf = (comments) => {
  const out = { url: null, failures: 0 };
  for (const c of comments) {
    if (c.who !== INBOX) continue;
    const m = YT_MARK.exec(c.text);
    if (m) out.url = m[1];
    else if (YT_FAIL.test(c.text)) out.failures++;
  }
  return out;
};
// The upload package the Studio sends with a publish checkpoint: metadata + repo-relative render paths (the files
// are in the studio container under projects/<project>/files/<path>). → clean package or a reason string.
function cleanPackage(p, project) {
  if (!p || typeof p !== 'object') return 'package must be an object';
  const path = (x) => (typeof x === 'string' && /^renders\/[a-z0-9-]+\/[A-Za-z0-9._\/-]+$/.test(x) && x.indexOf('..') === -1 && x.startsWith('renders/' + project + '/') ? x : null);
  const files = p.files || {};
  if (!path(files.video) || !/\.mp4$/i.test(files.video)) return 'package.files.video must be an .mp4 under renders/' + project + '/';
  const title = String(p.title || '').replace(/[<>]/g, '').trim().slice(0, 100);
  if (title.length < 6) return 'package.title is required';
  return {
    title, description: String(p.description || '').replace(/[<>]/g, '').slice(0, 4900),
    tags: list(p.tags, 15, 60),
    files: { video: files.video, captions: path(files.captions), thumbnail: path(files.thumbnail) },
  };
}
const checkpointMark = (kind) => `[studio:checkpoint ${kind}]`;
const ceoMark = (decision, kind) => `[ceo:${decision === 'approved' ? 'approved' : 'sent back'} ${kind}]`;
function checkpointsOf(comments) {
  const cp = {};
  for (const c of comments) {
    let m;
    if (c.who === INBOX && (m = CP_MARK.exec(c.text))) {
      cp[m[1]] = { status: 'pending', round: ((cp[m[1]] && cp[m[1]].round) || 0) + 1, at: c.at, note: str(m[2], 300) };
    } else if (c.who === 'ceo' && (m = CEO_MARK.exec(c.text)) && cp[m[2]]) {
      cp[m[2]] = Object.assign({}, cp[m[2]], { status: m[1] === 'approved' ? 'approved' : 'sent_back', decidedAt: c.at, reason: str(m[3], 300) });
    }
  }
  return cp;
}

// A company task → the request as the department sees it, or null if it isn't one.
function parseRequest(task) {
  if (!isRequestTask(task)) return null;
  const m = FENCE.exec(String(task.description || ''));
  let r = null;
  try { r = m ? JSON.parse(m[1]) : null; } catch (_) { r = null; }
  if (!r || typeof r !== 'object') return null;
  const comments = commentsOf(task);
  let stage = null, video = null, project = null, releaseUrl = null;
  for (const c of comments) {
    if (c.who !== INBOX) continue;
    const x = MARK.exec(c.text);
    if (!x) continue;
    if (STAGES.includes(x[1])) stage = x[1];
    if (x[2]) video = x[2];
    if (x[3]) project = x[3];
    const u = /https:\/\/\S+/.exec(c.text);
    if (x[1] === 'released' && u) releaseUrl = u[0].replace(/[).,]+$/, '');
  }
  // The task's own fields win (desk-comment writes them, 2026-10-15); markers cover requests from before that.
  if (STAGES.includes(task.videoStage)) stage = task.videoStage;
  if (task.videoId) video = task.videoId;
  if (task.videoProject) project = task.videoProject;
  const st = String(task.status || '').toLowerCase();
  let status;
  if (st === 'canceled' || st === 'cancelled' || st === 'archived') status = 'declined';
  else if (st === 'done') status = 'released';
  else if (st === 'todo' || st === 'backlog') status = 'waiting';
  else status = stage && stage !== 'released' ? stage : 'accepted';
  const ceo = comments.filter((c) => c.who === 'ceo');
  return Object.assign({}, r, {
    taskId: task.id, from: task.created_by || r.from, createdAt: task.createdAt, updatedAt: task.updatedAt || task.createdAt,
    status, video, project, releaseUrl,
    reason: status === 'declined' && ceo.length ? str(ceo[ceo.length - 1].text, 300) : null,
    checkpoints: checkpointsOf(comments),
    youtube: youtubeOf(comments),
    youtubePackage: task.youtubePackage || null,
    comments: comments.slice(-6),
  });
}

const requestsFrom = (tasks) => (Array.isArray(tasks) ? tasks : []).map(parseRequest).filter(Boolean);

// What the fleet-side gates need: open requests, each agent's newest, and the trigger refs already used.
function fleetLoad(requests) {
  const open = requests.filter((r) => OPEN.includes(r.status));
  const lastByAgent = {};
  for (const r of requests) if (!lastByAgent[r.from] || r.createdAt > lastByAgent[r.from]) lastByAgent[r.from] = r.createdAt;
  const refs = new Set(requests.filter((r) => r.trigger && r.trigger.ref).map((r) => r.trigger.type + ':' + r.trigger.ref));
  return { open: open.length, lastByAgent, refs };
}

// The demand ledger: what the fleet asked for, what Chad took, what shipped, and what it wished the studio could
// make. This is the data that decides which kits and formats the pipeline builds next (spec §4).
function demand(requests) {
  const blank = () => ({ asked: 0, accepted: 0, declined: 0, released: 0 });
  const add = (row, r) => {
    row.asked++;
    if (r.status === 'declined') row.declined++; else if (r.status !== 'waiting') row.accepted++;
    if (r.status === 'released') row.released++;
  };
  const tally = (get) => {
    const out = {};
    for (const r of requests) { const k = get(r); if (k) add(out[k] || (out[k] = blank()), r); }
    return out;
  };
  const wishes = {};
  for (const r of requests) {
    if (!r.wish) continue;
    for (const k of ['format', 'mood', 'style']) {
      if (!r.wish[k]) continue;
      const key = k + ':' + String(r.wish[k]).toLowerCase().slice(0, 40);
      wishes[key] = (wishes[key] || 0) + 1;
    }
  }
  return {
    requests: requests.length,
    formats: tally((r) => r.format), moods: tally((r) => r.mood), styles: tally((r) => r.style), products: tally((r) => r.product),
    triggers: tally((r) => r.trigger && r.trigger.type), byAgent: tally((r) => r.from),
    wishes: Object.entries(wishes).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ what: k, n })),
    wishNotes: requests.filter((r) => r.wish && r.wish.note).map((r) => ({ from: r.from, format: r.format, note: r.wish.note })).slice(0, 20),
    declines: requests.filter((r) => r.status === 'declined' && r.reason)
      .map((r) => ({ at: r.updatedAt, from: r.from, format: r.format, title: r.title, reason: r.reason }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20),
  };
}

module.exports = {
  CATALOG, VIDEO_TASK_TYPE, INBOX, TRIGGERS, STATUSES, OPEN, STAGES,
  formatIds, moodIds, styleIds, styleFor, validSource,
  cleanRequest, requestTask, isRequestTask, commentsOf, studioMark, parseRequest, requestsFrom, fleetLoad, demand,
  CHECKPOINTS, checkpointMark, ceoMark, checkpointsOf, cleanPackage, youtubeOf, YT_URL,
};
