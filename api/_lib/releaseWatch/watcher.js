// Release Watcher — turns what is LIVE on ambientpixels.ai into release-log entries.
//
// Not an agent: an agent shown "nothing shipped" invents a release. This is code plus one
// cheap classifier call, writing facts the fleet then reads (Video Desk spec §3a,
// docs/superpowers/specs/2026-10-14-video-desk-design.md).
//
//   1. deployed sha  ← https://ambientpixels.ai/data/version.json (written by the deploy workflow)
//   2. commits       ← GitHub compare {watermark}...{deployed}, then one GET per commit for its files
//   3. products      ← paths.js (internal + neutral paths never make a release)
//   4. trailers      ← "Release: none|minor|major|launch", "Release-Note: …", "Release-Product: …"
//   5. wording       ← Haiku, restating the commit subjects only; fails closed to minor/unreviewed
//   6. write         ← state key `releaseLog`, watermark advanced in the same conditional write
//
// Everything that talks to the network is injected, so the tests run offline.

'use strict';

const { productsForFiles } = require('./paths');

const REPO = 'AmbientPixels/ambientpixels';
const VERSION_URL = 'https://ambientpixels.ai/data/version.json';
const STATE_KEY = 'releaseLog';
const KINDS = ['feature', 'fix', 'launch', 'content'];
const SIGNIFICANCE = ['minor', 'major'];
const STATUSES = ['unreviewed', 'confirmed', 'hidden'];
const MAX_COMMITS_PER_RUN = 40;   // one GitHub call each; the rest wait for the next run
const BOOTSTRAP_DAYS = 14;        // first run looks back this far
const MAX_ENTRIES = 300;
const MAX_RUNS = 30;
const MAX_GROUPS_PER_CALL = 12;

const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

function emptyState() {
  return { version: 1, watermark: null, watermarkAt: null, entries: [], runs: [] };
}

// ── trailers ─────────────────────────────────────────────────────────────
function parseTrailers(message) {
  const out = { release: null, note: null, product: null };
  for (const line of String(message || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(Release|Release-Note|Release-Product)\s*:\s*(.+?)\s*$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'release') {
      const v = m[2].toLowerCase();
      if (['none', 'minor', 'major', 'launch'].includes(v)) out.release = v;
    } else if (key === 'release-note') out.note = clip(m[2], 240);
    else out.product = clip(m[2], 40);
  }
  return out;
}

// ── GitHub ───────────────────────────────────────────────────────────────
async function gh(fetchFn, path, token) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'ambientpixels-release-watch' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetchFn('https://api.github.com' + path, { headers });
  if (!res.ok) {
    const err = new Error('GitHub ' + res.status + ' on ' + path);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchDeployedSha(fetchFn) {
  const res = await fetchFn(VERSION_URL + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error('version.json ' + res.status);
  const j = await res.json();
  const sha = String((j && j.build) || '').trim();
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('version.json has no build sha');
  return { sha, updated: j.updated || null };
}

// First run: the parent of the oldest commit in the bootstrap window.
async function bootstrapBase(fetchFn, head, nowMs, token) {
  const since = new Date(nowMs - BOOTSTRAP_DAYS * 86400000).toISOString();
  const list = await gh(fetchFn, `/repos/${REPO}/commits?sha=${head}&since=${since}&per_page=100`, token);
  if (!Array.isArray(list) || !list.length) return null;
  const oldest = list[list.length - 1];
  return (oldest.parents && oldest.parents[0] && oldest.parents[0].sha) || null;
}

// → { commits: [{sha, subject, message, date, files}], next: sha|null (where the next run resumes) }
async function collectCommits(fetchFn, base, head, token, max) {
  const cmp = await gh(fetchFn, `/repos/${REPO}/compare/${base}...${head}`, token);
  const all = (cmp.commits || []).filter((c) => !(c.parents && c.parents.length > 1)); // merges repeat their PR
  const take = all.slice(0, max || MAX_COMMITS_PER_RUN);
  const commits = [];
  for (const c of take) {
    const full = await gh(fetchFn, `/repos/${REPO}/commits/${c.sha}`, token);
    const message = (full.commit && full.commit.message) || '';
    commits.push({
      sha: c.sha,
      subject: clip(message.split(/\r?\n/)[0], 160),
      message,
      date: (full.commit && full.commit.committer && full.commit.committer.date) || null,
      files: (full.files || []).map((f) => f.filename),
    });
  }
  const next = all.length > take.length ? take[take.length - 1].sha : null;
  return { commits, next, total: all.length };
}

// ── grouping ─────────────────────────────────────────────────────────────
// One group per product per run. A commit that touches two products appears in both.
function groupCommits(commits) {
  const groups = new Map();
  const skipped = { internal: 0, trailerNone: 0 };
  for (const c of commits) {
    const t = parseTrailers(c.message);
    if (t.release === 'none') { skipped.trailerNone++; continue; }
    const products = t.product ? [t.product] : productsForFiles(c.files).products;
    if (!products.length) { skipped.internal++; continue; }
    for (const p of products) {
      if (!groups.has(p)) groups.set(p, { product: p, commits: [], trailer: null, notes: [] });
      const g = groups.get(p);
      g.commits.push(c);
      if (t.note) g.notes.push(t.note);
      // the strongest trailer in the group wins: launch > major > minor
      const rank = { minor: 1, major: 2, launch: 3 };
      if (t.release && (!g.trailer || rank[t.release] > rank[g.trailer])) g.trailer = t.release;
    }
  }
  return { groups: [...groups.values()], skipped };
}

// ── classifier ───────────────────────────────────────────────────────────
function buildPrompt(groups) {
  const blocks = groups.map((g, i) => {
    const lines = g.commits.map((c) => '  - ' + c.subject).join('\n');
    const notes = g.notes.length ? '\n  notes: ' + g.notes.join(' | ') : '';
    return `#${i} product: ${g.product}\n${lines}${notes}`;
  }).join('\n\n');
  return [
    'You turn commit subjects from the AmbientPixels website repo into release-log entries.',
    'Each numbered group is the commits that changed ONE product since the last check.',
    'Rules:',
    '- Restate only what the subjects say. Never invent a feature, number, price or benefit.',
    '- public: true only if a person using the product could notice the change (a new feature, a visible fix, a price or page change). Analytics, logging, admin, cost caps and internal tooling are public: false.',
    '- title: at most 80 characters, plain words a user understands, no commit jargon.',
    '- summary: at most 240 characters.',
    '- kind: one of feature, fix, launch, content.',
    '- significance: "major" only for something new a user can try, or a redesign of a main page. Everything else is "minor".',
    'Reply with ONLY a JSON array, one object per group, in order:',
    '[{"i":0,"public":true,"title":"…","summary":"…","kind":"fix","significance":"minor"}]',
    '',
    blocks,
  ].join('\n');
}

function parseClassifier(text, n) {
  if (!text) return null;
  const m = String(text).match(/\[[\s\S]*\]/);
  if (!m) return null;
  let arr;
  try { arr = JSON.parse(m[0]); } catch (_) { return null; }
  if (!Array.isArray(arr)) return null;
  const out = new Array(n).fill(null);
  for (const r of arr) {
    if (!r || !Number.isInteger(r.i) || r.i < 0 || r.i >= n) continue;
    if (typeof r.public !== 'boolean' || !clip(r.title, 80)) continue;
    out[r.i] = {
      public: r.public,
      title: clip(r.title, 80),
      summary: clip(r.summary, 240),
      kind: KINDS.includes(r.kind) ? r.kind : 'fix',
      significance: SIGNIFICANCE.includes(r.significance) ? r.significance : 'minor',
    };
  }
  return out;
}

async function classifyGroups(groups, llm, log) {
  const results = new Array(groups.length).fill(null);
  if (typeof llm !== 'function') return { results, calls: 0, failed: groups.length ? 1 : 0 };
  let calls = 0, failed = 0;
  for (let start = 0; start < groups.length; start += MAX_GROUPS_PER_CALL) {
    const chunk = groups.slice(start, start + MAX_GROUPS_PER_CALL);
    calls++;
    let parsed = null;
    try { parsed = parseClassifier(await llm(buildPrompt(chunk)), chunk.length); }
    catch (err) { if (log) log('[releaseWatch] classifier error:', String(err).slice(0, 150)); }
    if (!parsed) { failed++; continue; }
    parsed.forEach((r, j) => { results[start + j] = r; });
  }
  return { results, calls, failed };
}

// ── entries ──────────────────────────────────────────────────────────────
function buildEntry(group, cls, nowIso) {
  const newest = group.commits[group.commits.length - 1];
  const trailer = group.trailer;
  const base = {
    id: 'rel_' + newest.sha.slice(0, 10) + '_' + group.product.toLowerCase().replace(/[^a-z0-9]+/g, ''),
    at: newest.date || nowIso,
    loggedAt: nowIso,
    product: group.product,
    shas: group.commits.map((c) => c.sha.slice(0, 10)),
    subjects: group.commits.map((c) => c.subject).slice(0, 12),
    source: 'auto',
  };
  if (cls) {
    return Object.assign(base, {
      title: cls.title,
      summary: group.notes[0] || cls.summary,
      kind: trailer === 'launch' ? 'launch' : cls.kind,
      significance: trailer === 'major' || trailer === 'launch' ? 'major' : trailer === 'minor' ? 'minor' : cls.significance,
      public: cls.public || !!trailer,
      status: cls.public || trailer ? 'unreviewed' : 'hidden',
      classifier: trailer ? 'trailer+haiku' : 'haiku',
    });
  }
  // Fail closed: wording from the newest subject, never major unless a trailer said so.
  return Object.assign(base, {
    title: clip(newest.subject, 80),
    summary: group.notes[0] || clip(group.commits.map((c) => c.subject).join('; '), 240),
    kind: trailer === 'launch' ? 'launch' : 'fix',
    significance: trailer === 'major' || trailer === 'launch' ? 'major' : 'minor',
    public: true,
    status: 'unreviewed',
    classifier: trailer ? 'trailer' : 'unavailable',
  });
}

function mergeEntries(state, entries) {
  const seen = new Set(state.entries.map((e) => e.id));
  const added = entries.filter((e) => !seen.has(e.id));
  state.entries = state.entries.concat(added).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-MAX_ENTRIES);
  return added;
}

// ── manual + review ──────────────────────────────────────────────────────
function validateManual(body) {
  const b = body || {};
  const product = clip(b.product, 40), title = clip(b.title, 80);
  if (!product) return { error: 'product is required' };
  if (title.length < 4) return { error: 'title is required' };
  const kind = KINDS.includes(b.kind) ? b.kind : 'feature';
  const significance = SIGNIFICANCE.includes(b.significance) ? b.significance : 'minor';
  return { entry: { product, title, summary: clip(b.summary, 240), kind, significance, url: clip(b.url, 300) || null } };
}

function addManualEntry(state, body, nowMs, by) {
  const v = validateManual(body);
  if (v.error) return v;
  const nowIso = new Date(nowMs).toISOString();
  const entry = Object.assign({
    id: 'rel_m' + nowMs.toString(36) + '_' + v.entry.product.toLowerCase().replace(/[^a-z0-9]+/g, ''),
    at: nowIso, loggedAt: nowIso, shas: [], subjects: [],
    source: body.source === 'video' ? 'video' : 'manual',
    public: true, status: 'confirmed', classifier: 'none', by: clip(by, 40) || 'ceo',
  }, v.entry);
  mergeEntries(state, [entry]);
  return { entry };
}

function setEntryStatus(state, id, status, by, nowMs) {
  if (!STATUSES.includes(status)) return { error: 'status must be one of ' + STATUSES.join(', ') };
  const e = state.entries.find((x) => x.id === id);
  if (!e) return { error: 'no entry ' + id };
  e.status = status;
  e.reviewedBy = clip(by, 40) || 'ceo';
  e.reviewedAt = new Date(nowMs).toISOString();
  return { entry: e };
}

// ── the run ──────────────────────────────────────────────────────────────
// deps: { storage, fetch, llm, nowMs, dryRun, log, token, base }
async function runReleaseWatch(deps) {
  const fetchFn = deps.fetch || fetch;
  const nowMs = deps.nowMs || Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const log = deps.log || function () {};

  const read = await deps.storage.getStateWithMeta(STATE_KEY);
  if (read.failed) throw new Error('releaseLog read failed; refusing to write over it');
  const state = Object.assign(emptyState(), read.value || {});

  const deployed = await fetchDeployedSha(fetchFn);
  let base = deps.base || state.watermark;
  let bootstrapped = false;
  if (!base) {
    base = await bootstrapBase(fetchFn, deployed.sha, nowMs, deps.token);
    bootstrapped = true;
  }

  const summary = { at: nowIso, deployed: deployed.sha, base: base ? base.slice(0, 10) : null, bootstrapped, commits: 0, pending: 0, groups: 0, added: 0, skippedInternal: 0, skippedTrailerNone: 0, classifierCalls: 0, classifierFailed: 0, dryRun: !!deps.dryRun };

  let newWatermark = deployed.sha;
  let added = [];
  let groups = [];
  if (base && !deployed.sha.startsWith(base) && !base.startsWith(deployed.sha)) {
    const got = await collectCommits(fetchFn, base, deployed.sha, deps.token);
    summary.commits = got.commits.length;
    summary.pending = got.total - got.commits.length;
    if (got.next) newWatermark = got.next;
    const g = groupCommits(got.commits);
    groups = g.groups;
    summary.groups = groups.length;
    summary.skippedInternal = g.skipped.internal;
    summary.skippedTrailerNone = g.skipped.trailerNone;
    const cls = await classifyGroups(groups, deps.llm, log);
    summary.classifierCalls = cls.calls;
    summary.classifierFailed = cls.failed;
    const entries = groups.map((grp, i) => buildEntry(grp, cls.results[i], nowIso));
    if (deps.dryRun) return { summary, entries, state: null };
    added = mergeEntries(state, entries);
  } else if (deps.dryRun) {
    return { summary, entries: [], state: null };
  }
  summary.added = added.length;

  state.watermark = newWatermark;
  state.watermarkAt = nowIso;
  state.runs = state.runs.concat([summary]).slice(-MAX_RUNS);
  await deps.storage.setState(STATE_KEY, state, read.etag ? { ifMatch: read.etag } : (read.exists ? {} : { ifNoneMatch: '*' }));
  log('[releaseWatch]', JSON.stringify(summary));
  return { summary, entries: added, state };
}

module.exports = {
  STATE_KEY, KINDS, SIGNIFICANCE, STATUSES, MAX_COMMITS_PER_RUN,
  emptyState, parseTrailers, fetchDeployedSha, collectCommits, groupCommits,
  buildPrompt, parseClassifier, classifyGroups, buildEntry, mergeEntries,
  validateManual, addManualEntry, setEntryStatus, runReleaseWatch,
};
