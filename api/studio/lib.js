// studio/lib.js — the pure checks behind /api/studio/* (no Azure, so they test in plain node).
//
// The studio serves private video-pipeline media (client work included), and the Function App host is
// publicly reachable, so every request authenticates here. Two credentials, both FAIL CLOSED:
//   x-studio-key           the operator's browser   (app setting STUDIO_ACCESS_KEY)
//   x-studio-worker-token  the worker on Chad's PC  (app setting STUDIO_WORKER_TOKEN)
// Deliberately NOT the CEO secret: runtime-config.js hands that to any signed-in user, and sign-up is open.
const crypto = require('crypto');

function safeEqual(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const isOperator = (req, env = process.env) => safeEqual(req.headers['x-studio-key'], env.STUDIO_ACCESS_KEY);
const isWorker = (req, env = process.env) => safeEqual(req.headers['x-studio-worker-token'], env.STUDIO_WORKER_TOKEN);

// Projects allowed in the cloud: STUDIO_PROJECTS=ambientpixels,hanson-agents. Unset means none (Xbox is never listed).
function hostedProjects(env = process.env) {
  return String(env.STUDIO_PROJECTS || '').split(',').map(s => s.trim()).filter(s => /^[a-z0-9][a-z0-9-]{0,62}$/.test(s));
}

// A manifest path is repo-relative inside the pipeline repo and must stay inside this project's own folders.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/;
function validFilePath(project, p) {
  if (typeof p !== 'string' || p.length > 300 || p.includes('\\')) return false;
  const parts = p.split('/');
  if (!parts.every(s => SEGMENT.test(s) && s !== '.' && s !== '..')) return false;
  return ['renders', 'projects', 'work'].includes(parts[0]) && parts[1] === project && parts.length > 2;
}

const blobKey = (project, p) => `projects/${project}/files/${p}`;

// An operator decision on its way to the PC (a timestamped note, an audition pick, an answered question, a draft
// approval). It is stored as data and written into the project's feedback/ files by the worker; nothing here
// runs it. Returns the clean event, or a reason string when it is refused.
const EVENT_TYPES = ['note', 'pick', 'answer', 'decision'];
const DECISIONS = ['approved', 'changes'];
function cleanEvent(project, b) {
  if (!b || typeof b !== 'object') return 'body must be an object';
  if (!EVENT_TYPES.includes(b.type)) return 'unknown event type';
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const e = { type: b.type, project, at: new Date().toISOString() };
  const video = str(b.video, 120), draft = str(b.draft, 120), text = str(b.text, 4000);
  if (video && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(video)) return 'invalid video';
  if (draft && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(draft)) return 'invalid draft';
  if (b.type === 'note') {
    if (!video || !text) return 'a note needs a video and text';
    const t = Number(b.t);
    if (!Number.isFinite(t) || t < 0 || t > 6 * 3600) return 'invalid time';
    Object.assign(e, { video, draft, t: Math.round(t * 10) / 10, text });
  } else if (b.type === 'pick') {
    if (!validFilePath(project, b.path)) return 'invalid path';
    Object.assign(e, { path: b.path, text });
  } else if (b.type === 'answer') {
    if (!validFilePath(project, b.file)) return 'invalid file';
    const n = Number(b.n), choice = str(b.choice, 8);
    if (!Number.isInteger(n) || n < 1 || n > 999) return 'invalid question number';
    if (!/^([a-z]|other)$/.test(choice)) return 'invalid choice';
    if (choice === 'other' && !text) return 'an "other" answer needs text';
    Object.assign(e, { file: b.file, n, choice, text });
  } else {
    if (!video || !draft || !DECISIONS.includes(b.decision)) return 'a decision needs a video, a draft and approved|changes';
    Object.assign(e, { video, draft, decision: b.decision, text });
  }
  return e;
}

// A job for the PC: one of a few named recipes the worker turns into fixed commands (harness/lib/jobs.mjs).
// The browser only ever picks a recipe and fills in checked values; it never sends a command line.
const JOB_KINDS = ['check', 'snapshot', 'draft', 'music'];
const MOODS = ['ambient', 'lofi', 'upbeat', 'cinematic', 'tense'];
const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const VIDEO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
function cleanJob(project, b) {
  if (!b || typeof b !== 'object') return 'body must be an object';
  if (!JOB_KINDS.includes(b.kind)) return 'unknown job kind';
  const j = { kind: b.kind, project, status: 'queued', createdAt: new Date().toISOString() };
  if (b.kind === 'music') {
    const duration = Number(b.duration), seed = Number(b.seed);
    if (!MOODS.includes(b.mood)) return 'unknown mood';
    if (!Number.isFinite(duration) || duration < 5 || duration > 900) return 'duration must be 5-900 s';
    if (!Number.isInteger(seed) || seed < 0 || seed > 999999) return 'seed must be a whole number';
    if (!NAME.test(b.name || '')) return 'name: lowercase letters, digits and dashes';
    return Object.assign(j, { mood: b.mood, duration: Math.round(duration * 10) / 10, seed, name: b.name });
  }
  if (!VIDEO.test(b.video || '')) return 'invalid video';
  j.video = b.video;
  if (b.kind === 'snapshot') {
    const times = Array.isArray(b.times) ? b.times.map(Number) : [];
    if (!times.length || times.length > 24 || !times.every((t) => Number.isFinite(t) && t >= 0 && t < 3600)) return 'times: 1-24 seconds values';
    j.times = times.map((t) => Math.round(t * 100) / 100);
  }
  if (b.kind === 'draft') {
    if (!NAME.test(b.label || '')) return 'label: lowercase letters, digits and dashes';
    if (b.subdir && !NAME.test(b.subdir)) return 'invalid folder';
    j.label = b.label;
    j.subdir = b.subdir || '';
    j.quality = b.quality === 'delivery' ? 'delivery' : 'draft';
  }
  return j;
}

module.exports = { safeEqual, isOperator, isWorker, hostedProjects, validFilePath, blobKey, cleanEvent, cleanJob };
