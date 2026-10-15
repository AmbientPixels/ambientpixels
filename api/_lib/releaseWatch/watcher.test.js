// Run: node _lib/releaseWatch/watcher.test.js   (from api/)
'use strict';
const assert = require('assert');
const W = require('./watcher');
const { classifyPath, productsForFiles } = require('./paths');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; } catch (err) { console.error('FAIL', name, '\n ', err.message); process.exitCode = 1; }
}

const NOW = Date.parse('2026-10-15T03:20:00Z');

// ── fakes ────────────────────────────────────────────────────────────────
function commit(sha, message, files, parents) {
  return { sha, message, subject: message.split('\n')[0], files, parents: parents || [{ sha: 'p' + sha }], date: '2026-10-14T12:00:00Z' };
}
function fakeFetch(opts) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.startsWith('https://ambientpixels.ai/data/version.json')) return ok({ build: opts.deployed, updated: '2026-10-15T02:15:52Z' });
    const u = url.replace('https://api.github.com/repos/AmbientPixels/ambientpixels', '');
    if (u.startsWith('/compare/')) return ok({ commits: opts.commits.map((c) => ({ sha: c.sha, parents: c.parents })) });
    if (u.startsWith('/commits?')) return ok(opts.list || []);
    const m = u.match(/^\/commits\/(\w+)$/);
    if (m) {
      const c = opts.commits.find((x) => x.sha === m[1]);
      return ok({ commit: { message: c.message, committer: { date: c.date } }, files: c.files.map((f) => ({ filename: f })) });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}
function fakeStorage(initial, opts) {
  const s = { value: initial, writes: [] };
  s.getStateWithMeta = async () => (opts && opts.failRead)
    ? { value: null, etag: null, exists: false, failed: true }
    : { value: s.value ? JSON.parse(JSON.stringify(s.value)) : null, etag: s.value ? 'e1' : null, exists: !!s.value, failed: false };
  s.setState = async (key, value, o) => { s.writes.push({ key, o }); s.value = value; return true; };
  return s;
}
const llmOk = async (prompt) => {
  const n = (prompt.match(/^#\d+ product:/gm) || []).length;
  return JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, public: true, title: 'Clear title ' + i, summary: 'What changed.', kind: 'feature', significance: 'minor' })));
};

(async () => {
  await t('paths: products, internal, neutral', () => {
    assert.equal(classifyPath('ambientscore/js/report.js'), 'AmbientScore');
    assert.equal(classifyPath('api/as-analyze/index.js'), 'AmbientScore');
    assert.equal(classifyPath('api/asProspectCron/index.js'), 'internal');
    assert.equal(classifyPath('api/pixel-agent-run/index.js'), 'PixelAgents');
    assert.equal(classifyPath('api/companyHeartbeat/agent-runner.js'), 'internal');
    assert.equal(classifyPath('studio/studio.js'), 'internal');
    assert.equal(classifyPath('ambientscore/js/report.test.js'), 'internal');
    assert.equal(classifyPath('css/site.css'), 'neutral');
    assert.equal(classifyPath('privacy.html'), 'AmbientPixels');
    assert.equal(classifyPath('somewhere-new/x.html'), 'unmatched');
    const r = productsForFiles(['css/a.css', 'docs/x.md']);
    assert.deepEqual(r.products, []);
  });

  await t('trailers parse and ignore junk', () => {
    const tr = W.parseTrailers('Fix it\n\nRelease: MAJOR\nRelease-Note: Scans now finish in 20 s\nRelease-Product: AmbientScore');
    assert.deepEqual(tr, { release: 'major', note: 'Scans now finish in 20 s', product: 'AmbientScore' });
    assert.equal(W.parseTrailers('Release: huge').release, null);
  });

  await t('grouping: one group per product, internal and Release: none skipped, strongest trailer wins', () => {
    const { groups, skipped } = W.groupCommits([
      commit('a1', 'AS fix', ['ambientscore/js/a.js']),
      commit('a2', 'AS launch\n\nRelease: launch', ['api/as-report/index.js']),
      commit('a3', 'Studio thing', ['studio/studio.js']),
      commit('a4', 'Roast tweak\n\nRelease: none', ['resume-roast/index.html']),
      commit('a5', 'Both', ['ambientscore/x.html', 'pixel-agents/y.html']),
    ]);
    assert.deepEqual(groups.map((g) => g.product).sort(), ['AmbientScore', 'PixelAgents']);
    const as = groups.find((g) => g.product === 'AmbientScore');
    assert.equal(as.commits.length, 3);
    assert.equal(as.trailer, 'launch');
    assert.deepEqual(skipped, { internal: 1, trailerNone: 1 });
  });

  await t('classifier output is validated, unknown values fall back', () => {
    const r = W.parseClassifier('here: [{"i":0,"public":true,"title":"T","kind":"party","significance":"huge"},{"i":5,"public":true,"title":"x"},{"i":1,"title":"no public"}]', 2);
    assert.equal(r[0].kind, 'fix');
    assert.equal(r[0].significance, 'minor');
    assert.equal(r[1], null);
    assert.equal(W.parseClassifier('not json', 1), null);
  });

  await t('fail closed: no classifier → minor, unreviewed, title from the subject', () => {
    const e = W.buildEntry({ product: 'AmbientScore', commits: [commit('abcdef123456', 'Free scan answers immediately', [])], trailer: null, notes: [] }, null, '2026-10-15T00:00:00Z');
    assert.equal(e.significance, 'minor');
    assert.equal(e.status, 'unreviewed');
    assert.equal(e.classifier, 'unavailable');
    assert.equal(e.title, 'Free scan answers immediately');
  });

  await t('trailer major overrides a minor classification; public:false is hidden', () => {
    const g = { product: 'X', commits: [commit('abcdef123456', 's', [])], trailer: 'major', notes: ['Note wins'] };
    const e = W.buildEntry(g, { public: true, title: 'T', summary: 'S', kind: 'fix', significance: 'minor' }, 'now');
    assert.equal(e.significance, 'major');
    assert.equal(e.summary, 'Note wins');
    const h = W.buildEntry({ product: 'X', commits: g.commits, trailer: null, notes: [] }, { public: false, title: 'T', summary: 'S', kind: 'fix', significance: 'minor' }, 'now');
    assert.equal(h.status, 'hidden');
  });

  await t('run: watermark → entries, conditional write, watermark advances', async () => {
    const commits = [commit('c1', 'Fix share cards', ['pixel-agents/run.html']), commit('c2', 'Studio board', ['studio/studio.js'])];
    const storage = fakeStorage({ version: 1, watermark: 'base000', entries: [], runs: [] });
    const r = await W.runReleaseWatch({ storage, fetch: fakeFetch({ deployed: 'd3e57d4', commits }), llm: llmOk, nowMs: NOW });
    assert.equal(r.summary.commits, 2);
    assert.equal(r.summary.added, 1);
    assert.equal(r.summary.skippedInternal, 1);
    assert.equal(storage.value.watermark, 'd3e57d4');
    assert.equal(storage.value.entries[0].product, 'PixelAgents');
    assert.deepEqual(storage.writes[0].o, { ifMatch: 'e1' });
    // second run with nothing new: no GitHub compare, no duplicate
    const f2 = fakeFetch({ deployed: 'd3e57d4', commits });
    const r2 = await W.runReleaseWatch({ storage, fetch: f2, llm: llmOk, nowMs: NOW });
    assert.equal(r2.summary.added, 0);
    assert.ok(!f2.calls.some((u) => u.includes('/compare/')));
    assert.equal(storage.value.entries.length, 1);
    assert.equal(storage.value.runs.length, 2);
  });

  await t('run: merges skipped, cap leaves the rest for the next run', async () => {
    const many = Array.from({ length: W.MAX_COMMITS_PER_RUN + 5 }, (_, i) => commit('s' + i, 'Roast ' + i, ['resume-roast/index.html']));
    many.push(commit('merge1', 'Merge PR', ['resume-roast/index.html'], [{ sha: 'x' }, { sha: 'y' }]));
    const storage = fakeStorage({ version: 1, watermark: 'base000', entries: [], runs: [] });
    const r = await W.runReleaseWatch({ storage, fetch: fakeFetch({ deployed: 'ffff111', commits: many }), llm: llmOk, nowMs: NOW });
    assert.equal(r.summary.commits, W.MAX_COMMITS_PER_RUN);
    assert.equal(r.summary.pending, 5);
    assert.equal(storage.value.watermark, 's' + (W.MAX_COMMITS_PER_RUN - 1));
  });

  await t('run: a failed read never writes', async () => {
    const storage = fakeStorage(null, { failRead: true });
    await assert.rejects(W.runReleaseWatch({ storage, fetch: fakeFetch({ deployed: 'd3e57d4', commits: [] }), llm: llmOk, nowMs: NOW }), /refusing/);
    assert.equal(storage.writes.length, 0);
  });

  await t('run: bootstrap from the 14-day window, create-only write', async () => {
    const commits = [commit('b1', 'AS fix', ['ambientscore/a.js'])];
    const storage = fakeStorage(null);
    const r = await W.runReleaseWatch({ storage, fetch: fakeFetch({ deployed: 'd3e57d4', commits, list: [{ sha: 'b1', parents: [{ sha: 'root' }] }] }), llm: llmOk, nowMs: NOW });
    assert.equal(r.summary.bootstrapped, true);
    assert.equal(r.summary.base, 'root');
    assert.deepEqual(storage.writes[0].o, { ifNoneMatch: '*' });
  });

  await t('run: dry run writes nothing', async () => {
    const storage = fakeStorage({ version: 1, watermark: 'base000', entries: [], runs: [] });
    const r = await W.runReleaseWatch({ storage, fetch: fakeFetch({ deployed: 'd3e57d4', commits: [commit('c1', 'x', ['cardforge/a.js'])] }), llm: async () => null, nowMs: NOW, dryRun: true });
    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0].classifier, 'unavailable');
    assert.equal(r.summary.classifierFailed, 1);
    assert.equal(storage.writes.length, 0);
  });

  await t('manual entry and review status', () => {
    const s = W.emptyState();
    assert.ok(W.addManualEntry(s, { product: 'AmbientScore' }, NOW).error);
    const { entry } = W.addManualEntry(s, { product: 'AmbientScore', title: 'Teardown video', source: 'video', significance: 'major' }, NOW, 'chad');
    assert.equal(entry.source, 'video');
    assert.equal(entry.status, 'confirmed');
    assert.ok(W.setEntryStatus(s, entry.id, 'nope', 'chad', NOW).error);
    assert.equal(W.setEntryStatus(s, entry.id, 'hidden', 'chad', NOW).entry.status, 'hidden');
  });

  console.log(`releaseWatch: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`);
})();
