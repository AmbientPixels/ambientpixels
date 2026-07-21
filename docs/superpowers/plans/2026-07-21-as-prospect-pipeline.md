# AmbientScore Outbound Prospect Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic cron that finds launch-intent Bluesky posts, runs a free AmbientScore scan of the poster's site, and spawns a grounded Scribe reply draft that lands in the CEO approval queue.

**Architecture:** Pure-core module `api/companyHeartbeat/prospect-pipeline.js` (house pattern: rewards-engine.js, proposal-generator.js) + thin timer `api/asProspectCron/` + manual trigger `api/as-prospect-trigger/`. Rides existing rails: `_utils/blueskyDiscovery.js` (search), `asScanQueue`/`asScanRunner` (scans), Scribe's `bluesky_reply` drafter + quality gate + approval queue (outreach). Spec: `docs/superpowers/specs/2026-07-21-as-prospect-pipeline-design.md`.

**Tech Stack:** Node.js Azure Functions (CommonJS, `var`/`function` style in heartbeat dir), node:assert tests run directly with `node <file>`, Azure Blob state via `_utils/companyStorage`.

**Working directory:** `c:\Dev\Ambientpixels\ambientpixels` (repo root — the real `.git` lives here).

**House rules:** Python unavailable — Node only. Commit after every task. Never edit `companyHeartbeat/index.js`. The ONLY `company-state/index.js` change allowed is the one line in Task 9.

---

### Task 1: Keyword + blocklist data file

**Files:**
- Create: `api/_data/as-prospect-keywords.json`

- [ ] **Step 1: Create the file**

```json
{
  "keywords": [
    "just launched", "we launched", "launched my", "i built",
    "new website", "redesigned my site", "redesigned my portfolio",
    "portfolio feedback", "roast my landing page", "feedback on my site",
    "site feedback welcome", "check out my new site"
  ],
  "ownDomains": ["ambientpixels.ai", "azurestaticapps.net"],
  "domainBlocklist": [
    "bit.ly", "t.co", "tinyurl.com", "linktr.ee", "lnk.bio",
    "youtube.com", "youtu.be", "github.com", "twitter.com", "x.com",
    "bsky.app", "medium.com", "substack.com", "instagram.com",
    "facebook.com", "linkedin.com", "tiktok.com", "amazon.com",
    "apple.com", "google.com", "notion.site", "docs.google.com"
  ],
  "defaults": {
    "enabled": true,
    "maxScansPerDay": 3,
    "maxDraftsPerDay": 2,
    "maxQueuedProspects": 10,
    "minEngagement": 1,
    "maxPostAgeHours": 24,
    "domainCooldownDays": 30
  }
}
```

- [ ] **Step 2: Validate it parses**

Run: `node -e "const d=require('./api/_data/as-prospect-keywords.json'); console.log(d.keywords.length, 'keywords,', d.domainBlocklist.length, 'blocked domains'); if(!d.defaults.maxScansPerDay) process.exit(1); console.log('OK')"`
Expected: `12 keywords, 22 blocked domains` then `OK`

- [ ] **Step 3: Commit**

```bash
git add api/_data/as-prospect-keywords.json
git commit -m "feat(prospects): launch-intent keyword + blocklist defaults"
```

---

### Task 2: Capture post links in blueskyDiscovery (additive)

Bluesky posts often carry their URL only in a link facet or an external-embed card, not in plain text. Candidates need a `links` array.

**Files:**
- Modify: `api/_utils/blueskyDiscovery.js` (mapper at ~line 86, exports at ~line 174)
- Create: `api/_utils/blueskyDiscovery.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/_utils/blueskyDiscovery.test.js`:

```js
// Run: node api/_utils/blueskyDiscovery.test.js
const assert = require('node:assert');
const { _extractPostLinks } = require('./blueskyDiscovery');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '-', e.message); }
}

test('extracts link facets from record.facets', () => {
  const p = { record: { facets: [
    { features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://mysite.io/' }] },
    { features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:x' }] }
  ] } };
  assert.deepStrictEqual(_extractPostLinks(p), ['https://mysite.io/']);
});

test('extracts record.embed.external.uri', () => {
  const p = { record: { embed: { external: { uri: 'https://card.example.com' } } } };
  assert.deepStrictEqual(_extractPostLinks(p), ['https://card.example.com']);
});

test('extracts view-level embed.external.uri', () => {
  const p = { embed: { external: { uri: 'https://view.example.com' } } };
  assert.deepStrictEqual(_extractPostLinks(p), ['https://view.example.com']);
});

test('dedups and ignores garbage', () => {
  const p = {
    record: {
      facets: [{ features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://a.com' }] }],
      embed: { external: { uri: 'https://a.com' } }
    },
    embed: { external: { uri: 42 } }
  };
  assert.deepStrictEqual(_extractPostLinks(p), ['https://a.com']);
});

test('empty post yields empty array', () => {
  assert.deepStrictEqual(_extractPostLinks({}), []);
  assert.deepStrictEqual(_extractPostLinks(null), []);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/_utils/blueskyDiscovery.test.js`
Expected: crash — `_extractPostLinks is not a function`

- [ ] **Step 3: Implement**

In `api/_utils/blueskyDiscovery.js`, add above `searchBluesky` (module scope):

```js
// Collect http(s) link targets a post carries outside its plain text:
// rich-text link facets + external-embed cards (record-level and view-level).
// Additive helper for AmbientScore prospecting — existing consumers unaffected.
function _extractPostLinks(p) {
  var out = [];
  function push(u) {
    if (typeof u === 'string' && /^https?:\/\//i.test(u) && out.indexOf(u) === -1) out.push(u);
  }
  if (!p || typeof p !== 'object') return out;
  var facets = (p.record && p.record.facets) || [];
  for (var i = 0; i < facets.length; i++) {
    var feats = (facets[i] && facets[i].features) || [];
    for (var j = 0; j < feats.length; j++) {
      if (feats[j] && feats[j].$type === 'app.bsky.richtext.facet#link') push(feats[j].uri);
    }
  }
  if (p.record && p.record.embed && p.record.embed.external) push(p.record.embed.external.uri);
  if (p.embed && p.embed.external) push(p.embed.external.uri);
  return out;
}
```

In the mapper (the `return {` block at ~line 86 that builds `{uri, cid, author, ...}`), add one field:

```js
        links: _extractPostLinks(p),
```

In `module.exports` add `_extractPostLinks`:

```js
module.exports = {
  searchBluesky,
  discoverAcrossKeywords,
  intentScore,
  _extractPostLinks
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/_utils/blueskyDiscovery.test.js`
Expected: `5 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/_utils/blueskyDiscovery.js api/_utils/blueskyDiscovery.test.js
git commit -m "feat(discovery): capture facet + embed links on candidates (additive)"
```

---

### Task 3: Pure core — extractSiteUrl

**Files:**
- Create: `api/companyHeartbeat/prospect-pipeline.js`
- Create: `api/companyHeartbeat/prospect-pipeline.test.js`

- [ ] **Step 1: Write the failing tests**

Create `api/companyHeartbeat/prospect-pipeline.test.js`:

```js
// Run: node api/companyHeartbeat/prospect-pipeline.test.js
const assert = require('node:assert');
const PP = require('./prospect-pipeline');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '-', e.message); }
}

const BLOCK = {
  ownDomains: ['ambientpixels.ai', 'azurestaticapps.net'],
  domainBlocklist: ['bit.ly', 'github.com', 'bsky.app']
};

// ── extractSiteUrl ──
test('prefers candidate.links over text', () => {
  const r = PP.extractSiteUrl({ links: ['https://mysite.io/x'], text: 'see https://other.com' }, BLOCK);
  assert.strictEqual(r.siteUrl, 'https://mysite.io/x');
  assert.strictEqual(r.domain, 'mysite.io');
});

test('falls back to first http(s) URL in text, strips trailing punctuation', () => {
  const r = PP.extractSiteUrl({ links: [], text: 'just launched https://cool.dev/app!' }, BLOCK);
  assert.strictEqual(r.siteUrl, 'https://cool.dev/app');
});

test('skips blocked and own domains, takes next candidate', () => {
  const r = PP.extractSiteUrl({ links: ['https://bit.ly/x', 'https://real.site'], text: '' }, BLOCK);
  assert.strictEqual(r.domain, 'real.site');
});

test('subdomain of blocked domain is blocked', () => {
  const r = PP.extractSiteUrl({ links: ['https://foo.azurestaticapps.net'], text: '' }, BLOCK);
  assert.strictEqual(r, null);
});

test('no usable URL yields null', () => {
  assert.strictEqual(PP.extractSiteUrl({ links: [], text: 'launched my site today, so proud' }, BLOCK), null);
  assert.strictEqual(PP.extractSiteUrl({ links: ['https://github.com/me/repo'], text: '' }, BLOCK), null);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run to verify failure**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: crash — `Cannot find module './prospect-pipeline'`

- [ ] **Step 3: Implement**

Create `api/companyHeartbeat/prospect-pipeline.js`:

```js
// prospect-pipeline.js — AmbientScore outbound prospect pipeline (2026-07-21)
//
// Pure cores + IO shell, house pattern (rewards-engine.js). The cron
// (api/asProspectCron) and manual trigger (api/as-prospect-trigger) call
// runProspectPipeline. Pure functions have NO IO so they stay unit-testable.
// Spec: docs/superpowers/specs/2026-07-21-as-prospect-pipeline-design.md

'use strict';

var _URL_RE = /https?:\/\/[^\s"'<>()]+/gi;

function _domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch (_e) { return null; }
}

function _isBlockedDomain(domain, block) {
  if (!domain) return true;
  var all = (block.ownDomains || []).concat(block.domainBlocklist || []);
  return all.some(function (b) {
    b = String(b).toLowerCase();
    return domain === b || domain.endsWith('.' + b);
  });
}

// candidate {links, text} → { siteUrl, domain } | null
function extractSiteUrl(candidate, block) {
  if (!candidate) return null;
  var pool = [];
  (Array.isArray(candidate.links) ? candidate.links : []).forEach(function (u) { pool.push(u); });
  var m = String(candidate.text || '').match(_URL_RE) || [];
  m.forEach(function (u) { pool.push(u); });
  for (var i = 0; i < pool.length; i++) {
    var raw = String(pool[i]).replace(/[.,!?;:)\]]+$/, '');
    if (!/^https?:\/\//i.test(raw)) continue;
    var domain = _domainOf(raw);
    if (!domain || _isBlockedDomain(domain, block)) continue;
    return { siteUrl: raw, domain: domain };
  }
  return null;
}

module.exports = { extractSiteUrl: extractSiteUrl };
```

- [ ] **Step 4: Run to verify pass**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: `5 passed, 0 failed` (only extractSiteUrl tests exist so far)

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/prospect-pipeline.js api/companyHeartbeat/prospect-pipeline.test.js
git commit -m "feat(prospects): extractSiteUrl pure core (blocklists, text fallback)"
```

---

### Task 4: Pure core — filterProspects

**Files:**
- Modify: `api/companyHeartbeat/prospect-pipeline.js`
- Modify: `api/companyHeartbeat/prospect-pipeline.test.js`

- [ ] **Step 1: Append the failing tests**

Append to `prospect-pipeline.test.js` (above the final `console.log`):

```js
// ── filterProspects ──
const NOW = Date.parse('2026-07-21T12:00:00Z');
const CFG = Object.assign({}, BLOCK, {
  maxScansPerDay: 3, maxDraftsPerDay: 2, maxQueuedProspects: 10,
  minEngagement: 1, maxPostAgeHours: 24, domainCooldownDays: 30
});
function cand(over) {
  return Object.assign({
    uri: 'at://did:plc:a/app.bsky.feed.post/' + Math.random().toString(36).slice(2, 8),
    cid: 'cid1', author: 'maker.bsky.social', authorDid: 'did:plc:a',
    text: 'just launched https://newsite.dev', links: [],
    indexedAt: new Date(NOW - 2 * 3600e3).toISOString(),
    replyCount: 1, likeCount: 2
  }, over || {});
}

test('qualifying candidate becomes a prospect', () => {
  const out = PP.filterProspects([cand()], [], CFG, NOW);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].status, 'discovered');
  assert.strictEqual(out[0].domain, 'newsite.dev');
  assert.strictEqual(out[0].author, 'maker.bsky.social');
  assert.ok(out[0].id.indexOf('pros_') === 0);
});

test('post older than maxPostAgeHours is rejected', () => {
  const old = cand({ indexedAt: new Date(NOW - 30 * 3600e3).toISOString() });
  assert.strictEqual(PP.filterProspects([old], [], CFG, NOW).length, 0);
});

test('engagement floor: likes+replies below minEngagement rejected', () => {
  const cold = cand({ replyCount: 0, likeCount: 0 });
  assert.strictEqual(PP.filterProspects([cold], [], CFG, NOW).length, 0);
});

test('author already prospected (any status) is rejected forever', () => {
  const existing = [{ author: 'maker.bsky.social', domain: 'x.dev', status: 'declined',
    discoveredAt: new Date(NOW - 90 * 86400e3).toISOString() }];
  assert.strictEqual(PP.filterProspects([cand()], existing, CFG, NOW).length, 0);
});

test('domain inside cooldown window is rejected, outside is allowed', () => {
  const recent = [{ author: 'other.bsky.social', domain: 'newsite.dev', status: 'sent',
    discoveredAt: new Date(NOW - 10 * 86400e3).toISOString() }];
  assert.strictEqual(PP.filterProspects([cand()], recent, CFG, NOW).length, 0);
  const stale = [{ author: 'other.bsky.social', domain: 'newsite.dev', status: 'sent',
    discoveredAt: new Date(NOW - 40 * 86400e3).toISOString() }];
  assert.strictEqual(PP.filterProspects([cand()], stale, CFG, NOW).length, 1);
});

test('daily scan cap counts prospects scan-queued today', () => {
  const today = new Date(NOW - 3600e3).toISOString();
  const existing = [1, 2, 3].map(function (i) {
    return { author: 'a' + i, domain: 'd' + i + '.com', status: 'scan_queued', scanQueuedAt: today,
      discoveredAt: today };
  });
  assert.strictEqual(PP.filterProspects([cand()], existing, CFG, NOW).length, 0);
});

test('candidate without extractable URL is rejected', () => {
  const noUrl = cand({ text: 'launched my site!', links: [] });
  assert.strictEqual(PP.filterProspects([noUrl], [], CFG, NOW).length, 0);
});

test('dedup within one batch by author and by domain', () => {
  const a = cand(); const b = cand({ authorDid: 'did:plc:b' }); // same author handle + domain
  assert.strictEqual(PP.filterProspects([a, b], [], CFG, NOW).length, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: FAILs — `PP.filterProspects is not a function`

- [ ] **Step 3: Implement**

Add to `prospect-pipeline.js` (before `module.exports`), and extend exports:

```js
function _dayKey(iso) { return String(iso || '').substring(0, 10); }

function _countScansToday(prospects, nowMs) {
  var today = _dayKey(new Date(nowMs).toISOString());
  return prospects.filter(function (p) {
    return p && p.scanQueuedAt && _dayKey(p.scanQueuedAt) === today;
  }).length;
}

// candidates + existing prospects + config → NEW prospect entries (status
// 'discovered'), best-first, bounded by the daily scan budget.
function filterProspects(candidates, prospects, cfg, nowMs) {
  var out = [];
  var existing = Array.isArray(prospects) ? prospects : [];
  var seenAuthors = {};
  var seenDomains = {};
  existing.forEach(function (p) {
    if (p && p.author) seenAuthors[String(p.author).toLowerCase()] = true;
  });
  var cooldownMs = (cfg.domainCooldownDays || 30) * 86400e3;
  existing.forEach(function (p) {
    if (!p || !p.domain) return;
    var t = Date.parse(p.discoveredAt || 0);
    if (Number.isFinite(t) && nowMs - t < cooldownMs) seenDomains[p.domain] = true;
  });

  var budget = Math.max(0, (cfg.maxScansPerDay || 3) - _countScansToday(existing, nowMs));
  var maxAgeMs = (cfg.maxPostAgeHours || 24) * 3600e3;

  for (var i = 0; i < (candidates || []).length && out.length < budget; i++) {
    var c = candidates[i];
    if (!c || !c.uri || !c.cid || !c.author) continue;
    var t = Date.parse(c.indexedAt || 0);
    if (!Number.isFinite(t) || nowMs - t > maxAgeMs) continue;
    if (((c.likeCount || 0) + (c.replyCount || 0)) < (cfg.minEngagement || 1)) continue;
    var authorKey = String(c.author).toLowerCase();
    if (seenAuthors[authorKey]) continue;
    var site = extractSiteUrl(c, cfg);
    if (!site) continue;
    if (seenDomains[site.domain]) continue;
    seenAuthors[authorKey] = true;
    seenDomains[site.domain] = true;
    out.push({
      id: 'pros_' + nowMs + '_' + Math.random().toString(36).substring(2, 7),
      uri: c.uri, cid: c.cid, author: c.author, authorDid: c.authorDid || '',
      postText: String(c.text || '').substring(0, 500),
      siteUrl: site.siteUrl, domain: site.domain,
      discoveredAt: new Date(nowMs).toISOString(),
      status: 'discovered',
      scanScore: null, reportId: null, taskId: null, actionId: null,
      scanQueuedAt: null, promotedAt: null, scanId: null
    });
  }
  return out;
}
```

Update exports: `module.exports = { extractSiteUrl: extractSiteUrl, filterProspects: filterProspects };`

- [ ] **Step 4: Run to verify pass**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: `13 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/prospect-pipeline.js api/companyHeartbeat/prospect-pipeline.test.js
git commit -m "feat(prospects): filterProspects pure core (dedup, caps, floors)"
```

---

### Task 5: Pure core — buildReplyTask + buildScanJob

**Files:**
- Modify: `api/companyHeartbeat/prospect-pipeline.js`
- Modify: `api/companyHeartbeat/prospect-pipeline.test.js`

- [ ] **Step 1: Append the failing tests**

```js
// ── builders ──
test('buildReplyTask: backlog, scribe, threadContext, fact sheet, objective link', () => {
  const p = PP.filterProspects([cand()], [], CFG, NOW)[0];
  const task = PP.buildReplyTask(p, NOW);
  assert.strictEqual(task.status, 'backlog');
  assert.strictEqual(task.assignee, 'scribe');
  assert.strictEqual(task.taskType, 'bluesky_reply');
  assert.strictEqual(task.source, 'asProspectCron');
  assert.strictEqual(task.objective_id, 'obj-first-customer');
  assert.strictEqual(task.threadContext.uri, p.uri);
  assert.strictEqual(task.threadContext.cid, p.cid);
  assert.strictEqual(task.threadContext.author, p.author);
  assert.ok(task.description.indexOf('PROSPECT FACT SHEET') !== -1);
  assert.ok(task.description.indexOf(p.siteUrl) !== -1);
  assert.ok(task.description.indexOf(p.postText) !== -1);
  assert.ok(task.dueDate && task.id && task.createdAt);
});

test('buildScanJob: matches asScanQueue shape', () => {
  const p = PP.filterProspects([cand()], [], CFG, NOW)[0];
  const job = PP.buildScanJob(p, 'task_x', NOW);
  assert.strictEqual(job.url, p.siteUrl);
  assert.strictEqual(job.taskId, 'task_x');
  assert.strictEqual(job.status, 'queued');
  assert.strictEqual(job.requestedBy, 'asProspectCron');
  assert.ok(job.id.indexOf('scan_') === 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: FAILs — `PP.buildReplyTask is not a function`

- [ ] **Step 3: Implement**

Add to `prospect-pipeline.js` and extend exports with both names:

```js
// Task shape mirrors the CEO dashboard's Draft Reply flow
// (modules/company/bluesky-discovery.html ~line 349) — Scribe's drafter reads
// task.threadContext {uri, cid, author}. status 'backlog' keeps it invisible to
// agents until the scan comment lands (promoteReady flips it to 'todo').
// source 'asProspectCron' (≠ 'heartbeat') + assignee + dueDate rides the
// CEO/manual-task triage exception — no Nova-triage wait.
function buildReplyTask(prospect, nowMs) {
  var iso = new Date(nowMs).toISOString();
  return {
    id: 'task_' + nowMs + '_prospect_' + Math.random().toString(36).substring(2, 6),
    title: 'Outreach reply to @' + prospect.author + ' (AmbientScore prospect)',
    description:
      'PROSPECT FACT SHEET (use ONLY these facts + the scan comment below)\n'
      + '- Their post (verbatim): "' + prospect.postText + '"\n'
      + '- Their site: ' + prospect.siteUrl + '\n'
      + '- You are replying AS the AmbientPixels founder account.\n\n'
      + 'RULES:\n'
      + '- Reference exactly ONE specific finding from the [asScanRunner] scan comment on this task.\n'
      + '- Include the free shareable report link from that comment.\n'
      + '- Do NOT mention pricing. Do NOT claim anything the scan did not measure.\n'
      + '- Founder voice: under 280 chars, no em dashes, no hype, 5th grade reading level.\n'
      + '- If the post or site looks like spam, output an empty deliverable to decline.\n\n'
      + 'Output ONLY the reply text itself. No title, no "Reply:" label, no preamble.',
    taskType: 'bluesky_reply',
    category: 'maintenance',
    status: 'backlog',
    priority: 'medium',
    assignee: 'scribe',
    source: 'asProspectCron',
    created_by: 'asProspectCron',
    objective_id: 'obj-first-customer',
    createdAt: iso,
    updatedAt: iso,
    dueDate: new Date(nowMs + 3 * 86400e3).toISOString(),
    tags: ['bluesky-reply', 'as-prospect'],
    threadContext: {
      uri: prospect.uri, cid: prospect.cid,
      author: prospect.author, authorDid: prospect.authorDid,
      originalText: prospect.postText,
      indexedAt: prospect.discoveredAt
    },
    comments: []
  };
}

// Matches the asScanQueue entry shape written by the run-ambientscore-scan
// handler (agent-runner.js ~line 5183) — asScanRunner consumes url + taskId.
function buildScanJob(prospect, taskId, nowMs) {
  return {
    id: 'scan_' + nowMs + '_' + Math.random().toString(36).substring(2, 6),
    url: prospect.siteUrl,
    taskId: taskId,
    requestedBy: 'asProspectCron',
    note: 'Outbound prospect: @' + prospect.author + ' — ' + prospect.domain,
    status: 'queued',
    createdAt: new Date(nowMs).toISOString(),
    cycleId: 'asProspectCron'
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: `15 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/prospect-pipeline.js api/companyHeartbeat/prospect-pipeline.test.js
git commit -m "feat(prospects): reply-task + scan-job builders (fact sheet, backlog gate)"
```

---

### Task 6: Pure core — promoteReady

**Files:**
- Modify: `api/companyHeartbeat/prospect-pipeline.js`
- Modify: `api/companyHeartbeat/prospect-pipeline.test.js`

- [ ] **Step 1: Append the failing tests**

```js
// ── promoteReady ──
function queuedProspect(over) {
  return Object.assign({
    id: 'pros_1', author: 'maker.bsky.social', domain: 'newsite.dev',
    status: 'scan_queued', taskId: 'task_1', scanId: 'scan_1',
    scanQueuedAt: new Date(NOW - 3600e3).toISOString(),
    discoveredAt: new Date(NOW - 3600e3).toISOString(),
    scanScore: null, reportId: null, promotedAt: null
  }, over || {});
}

test('scan done → prospect task_ready + task flip to todo', () => {
  const prospects = [queuedProspect()];
  const scanQ = [{ id: 'scan_1', taskId: 'task_1', status: 'done', reportId: 'ccr_9', score: 61 }];
  const r = PP.promoteReady(prospects, scanQ, CFG, NOW);
  assert.deepStrictEqual(r.taskIdsToTodo, ['task_1']);
  assert.strictEqual(prospects[0].status, 'task_ready');
  assert.strictEqual(prospects[0].reportId, 'ccr_9');
  assert.strictEqual(prospects[0].scanScore, 61);
  assert.ok(prospects[0].promotedAt);
});

test('scan error → prospect dismissed + task close', () => {
  const prospects = [queuedProspect()];
  const scanQ = [{ id: 'scan_1', taskId: 'task_1', status: 'error' }];
  const r = PP.promoteReady(prospects, scanQ, CFG, NOW);
  assert.deepStrictEqual(r.taskIdsToClose, ['task_1']);
  assert.strictEqual(prospects[0].status, 'dismissed');
});

test('scan still queued/running → untouched', () => {
  const prospects = [queuedProspect()];
  const r = PP.promoteReady(prospects, [{ id: 'scan_1', taskId: 'task_1', status: 'running' }], CFG, NOW);
  assert.strictEqual(prospects[0].status, 'scan_queued');
  assert.strictEqual(r.taskIdsToTodo.length, 0);
});

test('daily draft cap limits promotions', () => {
  const done = function (n) { return { id: 'scan_' + n, taskId: 'task_' + n, status: 'done', reportId: 'r' + n }; };
  const promotedToday = queuedProspect({ id: 'p0', taskId: 'task_0', scanId: 'scan_0',
    status: 'task_ready', promotedAt: new Date(NOW - 1800e3).toISOString() });
  const a = queuedProspect({ id: 'p1', taskId: 'task_1', scanId: 'scan_1', author: 'a1', domain: 'd1.com' });
  const b = queuedProspect({ id: 'p2', taskId: 'task_2', scanId: 'scan_2', author: 'a2', domain: 'd2.com' });
  const r = PP.promoteReady([promotedToday, a, b], [done(1), done(2)], CFG, NOW); // cap 2, 1 used
  assert.strictEqual(r.taskIdsToTodo.length, 1);
  assert.strictEqual(b.status, 'scan_queued'); // deferred to tomorrow
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: FAILs — `PP.promoteReady is not a function`

- [ ] **Step 3: Implement**

Add to `prospect-pipeline.js`, extend exports:

```js
// Mutates prospects in place (house pattern: evaluateObjectives). Returns
// { taskIdsToTodo, taskIdsToClose } for the IO shell to apply to the tasks store.
// Promotion is capped by maxDraftsPerDay (counted from promotedAt today) so a
// scan burst can't flood Scribe/the approval queue.
function promoteReady(prospects, scanQueue, cfg, nowMs) {
  var out = { taskIdsToTodo: [], taskIdsToClose: [] };
  var jobs = {};
  (Array.isArray(scanQueue) ? scanQueue : []).forEach(function (j) {
    if (j && j.id) jobs[j.id] = j;
    if (j && j.taskId && !jobs['task:' + j.taskId]) jobs['task:' + j.taskId] = j;
  });
  var today = _dayKey(new Date(nowMs).toISOString());
  var promotedToday = prospects.filter(function (p) {
    return p && p.promotedAt && _dayKey(p.promotedAt) === today;
  }).length;
  var budget = Math.max(0, (cfg.maxDraftsPerDay || 2) - promotedToday);

  for (var i = 0; i < prospects.length; i++) {
    var p = prospects[i];
    if (!p || p.status !== 'scan_queued') continue;
    var job = (p.scanId && jobs[p.scanId]) || jobs['task:' + p.taskId];
    if (!job) continue;
    if (job.status === 'error' || job.status === 'failed') {
      p.status = 'dismissed';
      out.taskIdsToClose.push(p.taskId);
    } else if (job.status === 'done') {
      if (budget <= 0) continue; // stays scan_queued, promoted on a later run
      budget--;
      p.status = 'task_ready';
      p.reportId = job.reportId || null;
      p.scanScore = Number.isFinite(job.score) ? job.score : null;
      p.promotedAt = new Date(nowMs).toISOString();
      out.taskIdsToTodo.push(p.taskId);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: `19 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/prospect-pipeline.js api/companyHeartbeat/prospect-pipeline.test.js
git commit -m "feat(prospects): promoteReady pure core (backlog->todo, draft caps)"
```

---

### Task 7: Pure core — reconcile (track + prune)

**Files:**
- Modify: `api/companyHeartbeat/prospect-pipeline.js`
- Modify: `api/companyHeartbeat/prospect-pipeline.test.js`

- [ ] **Step 1: Append the failing tests**

```js
// ── reconcile ──
test('task done + reply action → sent (actionId stamped)', () => {
  const p = queuedProspect({ status: 'task_ready' });
  const tasks = [{ id: 'task_1', status: 'done' }];
  const actions = [{ id: 'act_9', type: 'social_post.reply', _parentTaskId: 'task_1' }];
  PP.reconcile([p], tasks, actions, NOW);
  assert.strictEqual(p.status, 'sent');
  assert.strictEqual(p.actionId, 'act_9');
});

test('task done + no reply action → declined', () => {
  const p = queuedProspect({ status: 'task_ready' });
  PP.reconcile([p], [{ id: 'task_1', status: 'done' }], [], NOW);
  assert.strictEqual(p.status, 'declined');
});

test('prunes dismissed >14d, everything >60d, caps at 300', () => {
  const mk = function (i, status, ageDays) {
    return { id: 'p' + i, status: status, taskId: 't' + i,
      discoveredAt: new Date(NOW - ageDays * 86400e3).toISOString() };
  };
  const list = [mk(1, 'dismissed', 20), mk(2, 'dismissed', 2), mk(3, 'sent', 70), mk(4, 'sent', 5)];
  for (let i = 5; i < 320; i++) list.push(mk(i, 'sent', 1));
  const kept = PP.reconcile(list, [], [], NOW);
  assert.ok(!kept.some(function (p) { return p.id === 'p1'; }), 'old dismissed pruned');
  assert.ok(kept.some(function (p) { return p.id === 'p2'; }), 'fresh dismissed kept');
  assert.ok(!kept.some(function (p) { return p.id === 'p3'; }), '>60d pruned');
  assert.ok(kept.length <= 300, 'capped at 300');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: FAILs — `PP.reconcile is not a function`

- [ ] **Step 3: Implement**

Add to `prospect-pipeline.js`, extend exports:

```js
// Stamp terminal outcomes from task/action state, then prune. Returns the
// kept list (caller persists it). NOTE on pruning vs the one-touch-per-author
// rule: pruning >60d entries means an author could theoretically be re-touched
// after 60 days. Accepted in the spec (retention 60d) — the 7-day reply-task
// dedup and domain cooldown still apply.
function reconcile(prospects, tasks, actions, nowMs) {
  var taskById = {};
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) { if (t && t.id) taskById[t.id] = t; });
  var replyByTask = {};
  (Array.isArray(actions) ? actions : []).forEach(function (a) {
    if (a && a.type === 'social_post.reply' && a._parentTaskId) replyByTask[a._parentTaskId] = a;
  });
  prospects.forEach(function (p) {
    if (!p || p.status !== 'task_ready') return;
    var t = taskById[p.taskId];
    if (!t || t.status !== 'done') return;
    var reply = replyByTask[p.taskId];
    if (reply) { p.status = 'sent'; p.actionId = reply.id; }
    else { p.status = 'declined'; }
  });
  var kept = prospects.filter(function (p) {
    if (!p) return false;
    var age = nowMs - Date.parse(p.discoveredAt || 0);
    if (!Number.isFinite(age)) return false;
    if (age > 60 * 86400e3) return false;
    if (p.status === 'dismissed' && age > 14 * 86400e3) return false;
    return true;
  });
  if (kept.length > 300) kept = kept.slice(kept.length - 300);
  return kept;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: `22 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add api/companyHeartbeat/prospect-pipeline.js api/companyHeartbeat/prospect-pipeline.test.js
git commit -m "feat(prospects): reconcile pure core (sent/declined tracking, pruning)"
```

---

### Task 8: IO shell — runProspectPipeline

**Files:**
- Modify: `api/companyHeartbeat/prospect-pipeline.js`
- Modify: `api/companyHeartbeat/prospect-pipeline.test.js`

- [ ] **Step 1: Append the failing integration test (mocked storage + discover)**

```js
// ── runProspectPipeline (integration, mocked IO) ──
function mockStorage(initial) {
  const state = Object.assign({}, initial);
  return {
    _state: state,
    getState: async function (k) { return state[k] !== undefined ? state[k] : null; },
    setState: async function (k, v) { state[k] = v; }
  };
}

(async function () {
  // Run 1: discover → prospect + backlog task + scan queued
  const storage = mockStorage({
    systemConfig: { asProspecting: { minEngagement: 1 } },
    tasks: [], asScanQueue: [], asProspects: [], actions: [], governanceLog: []
  });
  const discover = async function () { return [cand()]; };
  const r1 = await PP.runProspectPipeline({ storage: storage, log: function () {}, nowMs: NOW, discover: discover });
  const s = storage._state;

  test('run1: prospect created, scan queued, backlog task created', () => {
    assert.strictEqual(s.asProspects.length, 1);
    assert.strictEqual(s.asProspects[0].status, 'scan_queued');
    assert.ok(s.asProspects[0].scanId);
    assert.strictEqual(s.asScanQueue.length, 1);
    assert.strictEqual(s.tasks.length, 1);
    assert.strictEqual(s.tasks[0].status, 'backlog');
    assert.strictEqual(s.asScanQueue[0].taskId, s.tasks[0].id);
    assert.strictEqual(r1.discovered, 1);
  });

  // Run 2: scan runner finished → task promoted to todo
  s.asScanQueue[0].status = 'done';
  s.asScanQueue[0].reportId = 'ccr_test';
  const r2 = await PP.runProspectPipeline({ storage: storage, log: function () {}, nowMs: NOW + 3600e3, discover: async function () { return []; } });
  test('run2: task promoted to todo, prospect task_ready', () => {
    assert.strictEqual(s.tasks[0].status, 'todo');
    assert.strictEqual(s.asProspects[0].status, 'task_ready');
    assert.strictEqual(s.asProspects[0].reportId, 'ccr_test');
    assert.strictEqual(r2.promoted, 1);
  });

  // Disabled kill switch
  const storage2 = mockStorage({ systemConfig: { asProspecting: { enabled: false } } });
  const r3 = await PP.runProspectPipeline({ storage: storage2, log: function () {}, nowMs: NOW, discover: discover });
  test('kill switch: disabled config does nothing', () => {
    assert.strictEqual(r3.skipped, 'disabled');
    assert.ok(!storage2._state.asProspects || storage2._state.asProspects === null);
  });

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
```

**IMPORTANT:** this async block replaces the existing final `console.log(pass...)/process.exit` lines at the bottom of the test file — the summary now prints inside the async block after all tests run.

- [ ] **Step 2: Run to verify failure**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: FAILs — `PP.runProspectPipeline is not a function`

- [ ] **Step 3: Implement**

Add to `prospect-pipeline.js`, extend exports:

```js
var _DEFAULTS_FILE = require('../_data/as-prospect-keywords.json');

function _loadConfig(systemConfig) {
  var file = _DEFAULTS_FILE || {};
  var cfg = Object.assign({}, file.defaults || {});
  cfg.keywords = (file.keywords || []).slice();
  cfg.ownDomains = (file.ownDomains || []).slice();
  cfg.domainBlocklist = (file.domainBlocklist || []).slice();
  var over = (systemConfig && systemConfig.asProspecting) || {};
  Object.keys(over).forEach(function (k) { cfg[k] = over[k]; });
  return cfg;
}

async function _logGov(storage, type, data, nowMs) {
  try {
    var gov = (await storage.getState('governanceLog')) || [];
    gov.push({ id: 'gov-' + nowMs + '-' + Math.random().toString(36).substring(2, 6),
      type: type, data: data, timestamp: new Date(nowMs).toISOString() });
    await storage.setState('governanceLog', gov.slice(-500));
  } catch (_e) { /* non-fatal */ }
}

// IO shell. `discover` is injectable for tests; defaults to the shared
// Bluesky discovery engine. All passes are idempotent per prospect id —
// a crash mid-run reconciles from state on the next run.
async function runProspectPipeline(opts) {
  var storage = opts.storage;
  var log = opts.log || function () {};
  var nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  var discover = opts.discover || function (keywords) {
    var bd = require('../_utils/blueskyDiscovery');
    return bd.discoverAcrossKeywords(keywords, { maxAgeMinutes: 24 * 60, minReplies: 0, limitPerKeyword: 15 });
  };

  var systemConfig = (await storage.getState('systemConfig')) || {};
  var cfg = _loadConfig(systemConfig);
  if (cfg.enabled === false) { log('[prospects] disabled via systemConfig.asProspecting.enabled'); return { skipped: 'disabled' }; }

  var prospects = (await storage.getState('asProspects')) || [];
  var tasks = (await storage.getState('tasks')) || [];
  var scanQueue = (await storage.getState('asScanQueue')) || [];
  if (!Array.isArray(scanQueue)) scanQueue = [];
  var actions = (await storage.getState('actions')) || [];

  // ── Pass 1: DISCOVER ──
  var discovered = 0;
  try {
    var queuedCount = prospects.filter(function (p) { return p && p.status === 'discovered'; }).length;
    if (queuedCount < (cfg.maxQueuedProspects || 10)) {
      var candidates = await discover(cfg.keywords);
      var fresh = filterProspects(candidates, prospects, cfg, nowMs);
      for (var i = 0; i < fresh.length; i++) {
        var p = fresh[i];
        var task = buildReplyTask(p, nowMs);
        var job = buildScanJob(p, task.id, nowMs);
        // Respect the existing scan-queue cap (20 queued) + 7d URL dedup
        var dup = scanQueue.some(function (q) {
          return q && q.url === job.url && (q.status === 'queued' || q.status === 'running' ||
            (q.finishedAt && nowMs - Date.parse(q.finishedAt) < 7 * 86400e3));
        });
        if (dup || scanQueue.filter(function (q) { return q && q.status === 'queued'; }).length >= 20) continue;
        tasks.push(task);
        scanQueue.push(job);
        p.taskId = task.id;
        p.scanId = job.id;
        p.status = 'scan_queued';
        p.scanQueuedAt = new Date(nowMs).toISOString();
        prospects.push(p);
        discovered++;
        log('[prospects] discovered @' + p.author + ' → ' + p.domain + ' (scan ' + job.id + ')');
      }
      if (discovered > 0) await _logGov(storage, 'prospect-discovered', { count: discovered }, nowMs);
    } else {
      log('[prospects] discovery skipped — queued backlog at cap');
    }
  } catch (dErr) {
    log('[prospects] discovery failed (non-fatal): ' + String(dErr && dErr.message || dErr).substring(0, 200));
  }

  // ── Pass 2: PROMOTE ──
  var promo = promoteReady(prospects, scanQueue, cfg, nowMs);
  promo.taskIdsToTodo.forEach(function (tid) {
    var t = tasks.find(function (x) { return x && x.id === tid; });
    if (t && t.status === 'backlog') { t.status = 'todo'; t.updatedAt = new Date(nowMs).toISOString(); }
  });
  promo.taskIdsToClose.forEach(function (tid) {
    var t = tasks.find(function (x) { return x && x.id === tid; });
    if (t && t.status !== 'done') {
      t.status = 'done';
      t.updatedAt = new Date(nowMs).toISOString();
      t.comments = t.comments || [];
      t.comments.push({ id: 'cmt-prospect-' + nowMs, author: 'system', type: 'system',
        text: 'Scan failed for this prospect — outreach dismissed by asProspectCron.',
        createdAt: new Date(nowMs).toISOString() });
    }
  });
  if (promo.taskIdsToTodo.length > 0) {
    await _logGov(storage, 'prospect-outreach-ready', { count: promo.taskIdsToTodo.length, taskIds: promo.taskIdsToTodo }, nowMs);
  }

  // ── Pass 3: TRACK / PRUNE ──
  var kept = reconcile(prospects, tasks, actions, nowMs);

  await storage.setState('asProspects', kept);
  await storage.setState('tasks', tasks);
  await storage.setState('asScanQueue', scanQueue.slice(-100));

  var summary = { discovered: discovered, promoted: promo.taskIdsToTodo.length,
    dismissed: promo.taskIdsToClose.length, total: kept.length };
  log('[prospects] run complete: ' + JSON.stringify(summary));
  return summary;
}
```

Final exports:

```js
module.exports = {
  extractSiteUrl: extractSiteUrl,
  filterProspects: filterProspects,
  buildReplyTask: buildReplyTask,
  buildScanJob: buildScanJob,
  promoteReady: promoteReady,
  reconcile: reconcile,
  runProspectPipeline: runProspectPipeline
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node api/companyHeartbeat/prospect-pipeline.test.js`
Expected: `25 passed, 0 failed`

- [ ] **Step 5: Run the existing suites to prove no regressions**

Run: `node api/companyHeartbeat/smoke-test.js` → `25 passed, 0 failed`
Run: `node api/companyHeartbeat/rewards-engine.test.js` → `19 passed, 0 failed`

- [ ] **Step 6: Commit**

```bash
git add api/companyHeartbeat/prospect-pipeline.js api/companyHeartbeat/prospect-pipeline.test.js
git commit -m "feat(prospects): runProspectPipeline IO shell (discover/promote/reconcile)"
```

---

### Task 9: VALID_KEYS — one line in company-state (HIGH-BLAST FILE)

**Files:**
- Modify: `api/company-state/index.js` (the VALID_KEYS array near the top, ~lines 11-30)

This is the ONLY change allowed in this file. It is a do-not-touch file; this exact edit was CEO-approved via the spec.

- [ ] **Step 1: Add `'asProspects'` to the VALID_KEYS array**

Find the array entry line containing `'directives', 'campaigns', 'objectives', 'approvalQueue', 'governanceLog',` and add to the END of the array-literal (before the closing `]`), as its own line:

```js
  'asProspects',
```

- [ ] **Step 2: Verify**

Run: `node --check api/company-state/index.js && grep -c "asProspects" api/company-state/index.js`
Expected: exit 0 and `1`

- [ ] **Step 3: Commit (alone, clearly labeled)**

```bash
git add api/company-state/index.js
git commit -m "feat(prospects): expose asProspects read surface (VALID_KEYS, spec-approved)"
```

---

### Task 10: The cron function

**Files:**
- Create: `api/asProspectCron/function.json`
- Create: `api/asProspectCron/index.js`

- [ ] **Step 1: function.json** (every 2h at :20 — offset from the hourly heartbeat at :00, scan runner every 10 min, rewards cron at :30)

```json
{
  "bindings": [
    {
      "name": "asProspectTimer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 20 */2 * * *"
    }
  ]
}
```

- [ ] **Step 2: index.js**

```js
// asProspectCron — AmbientScore outbound prospect pipeline (every 2h at :20).
// Thin timer shell; all logic lives in companyHeartbeat/prospect-pipeline.js.
// Spec: docs/superpowers/specs/2026-07-21-as-prospect-pipeline-design.md

const storage = require('../_utils/companyStorage');
const { runProspectPipeline } = require('../companyHeartbeat/prospect-pipeline');

module.exports = async function (context) {
  const demoGuard = require('../_utils/demoGuard');
  if (demoGuard.timerSkip(context)) return;
  try {
    const summary = await runProspectPipeline({ storage: storage, log: context.log });
    context.log('[asProspectCron] done:', JSON.stringify(summary));
  } catch (err) {
    context.log.error('[asProspectCron] failed (non-fatal):', (err && err.message) || String(err));
  }
};
```

- [ ] **Step 3: Verify + commit**

Run: `node --check api/asProspectCron/index.js && node -e "JSON.parse(require('fs').readFileSync('api/asProspectCron/function.json')); console.log('OK')"`
Expected: `OK`

```bash
git add api/asProspectCron/
git commit -m "feat(prospects): asProspectCron timer (2h cadence, thin shell)"
```

---

### Task 11: Manual trigger endpoint

**Files:**
- Create: `api/as-prospect-trigger/function.json`
- Create: `api/as-prospect-trigger/index.js`

- [ ] **Step 1: function.json**

```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post"],
      "route": "as-prospect-trigger"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

- [ ] **Step 2: index.js** (mirrors the reflection/rewards trigger auth pattern)

```js
// POST /api/as-prospect-trigger — manual run of the prospect pipeline for
// verification (x-company-secret gated). Mirrors rewards-engine-trigger.

const storage = require('../_utils/companyStorage');
const { runProspectPipeline } = require('../companyHeartbeat/prospect-pipeline');

module.exports = async function (context, req) {
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) {
    context.res = { status: 401, body: { error: 'unauthorized' } };
    return;
  }
  try {
    const summary = await runProspectPipeline({ storage: storage, log: context.log });
    context.res = { status: 200, body: { ok: true, summary: summary } };
  } catch (err) {
    context.res = { status: 500, body: { ok: false, error: (err && err.message) || String(err) } };
  }
};
```

Before committing, confirm the auth helper name matches the house pattern:
Run: `grep -n "validateSecret" api/_utils/companyStorage.js api/rewards-engine-trigger/index.js`
If `rewards-engine-trigger` uses a different check (e.g. comparing against an env var directly), copy THAT pattern instead — auth must match the existing triggers exactly.

- [ ] **Step 3: Verify + commit**

Run: `node --check api/as-prospect-trigger/index.js`
Expected: exit 0

```bash
git add api/as-prospect-trigger/
git commit -m "feat(prospects): manual trigger endpoint (secret-gated)"
```

---

### Task 12: Deploy + live verification

- [ ] **Step 1: Full local suite one last time**

Run all three:
```bash
node api/companyHeartbeat/prospect-pipeline.test.js
node api/_utils/blueskyDiscovery.test.js
node api/companyHeartbeat/smoke-test.js
```
Expected: `25 passed` / `5 passed` / `25 passed`, all `0 failed`.

- [ ] **Step 2: Deploy**

```bash
git push origin master
```
Watch GitHub Actions complete (~6 min): `https://github.com/AmbientPixels/ambientpixels/actions`

- [ ] **Step 3: Live trigger + inspect**

```bash
curl -sX POST "https://ambientpixels-nova-api.azurewebsites.net/api/as-prospect-trigger" \
  -H "x-company-secret: pixelpusher"
# expect: {"ok":true,"summary":{"discovered":N,...}} — N may be 0 (silence-default is correct behavior)

node -e "
const H={'x-company-secret':'pixelpusher'};
fetch('https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=asProspects',{headers:H})
 .then(r=>r.json()).then(d=>console.log(JSON.stringify(d.value??d,null,1).slice(0,1500)));"
```

- [ ] **Step 4: End-to-end watch (if a prospect was discovered)**

1. ~10 min later `asScanRunner` picks up the queued scan → scan comment appears on the backlog task.
2. Next cron/trigger run promotes the task to `todo`.
3. Next hourly heartbeat: Scribe drafts → quality gate → approval queue shows a `bluesky_reply` entry with thread preview.
4. CEO approves → reply posts. Funnel: `curl -s .../api/as-funnel -H "x-company-secret: pixelpusher"` → `scans.agent` > 0 for the first time.

- [ ] **Step 5: Verify silence-default if nothing was discovered**

Zero discoveries is a PASS, not a failure — check the trigger response shows `{discovered: 0}` and no junk entered `asProspects`/`tasks`. Re-run during US daytime hours when launch posts are frequent.

---

## Self-review notes (completed)

- Spec coverage: discovery/scan/promote/track passes (Tasks 4-8), caps (Tasks 4+6), junk filters (Tasks 1+3), grounding fact sheet (Task 5), kill switch + config merge (Task 8), triage exception via `source` (Task 5), VALID_KEYS (Task 9), cron + trigger (Tasks 10-11), error handling (Task 8 try/catch + promote error branch), metrics via as-funnel (Task 12). Non-goals honored: no email, no auto-send, no dashboard.
- Type consistency: prospect fields (`scanId`, `scanQueuedAt`, `promotedAt`) declared in Task 4's builder and consumed in Tasks 6-8 with identical names. `cfg` carries both blocklists and defaults via `_loadConfig` (Task 8); pure-core tests pass blocklists+caps merged in `CFG` (Task 4) matching that shape.
- Known judgment calls: governance events are direct-pushed (slice -500) like other crons, so they bypass the helpers archive — acceptable at ≤3 events/day; `_logGov` matches `emergenceCheckCron` style. Pruning >60d can theoretically allow an author re-touch after 60 days — documented in Task 7 code comment, accepted by spec retention.
