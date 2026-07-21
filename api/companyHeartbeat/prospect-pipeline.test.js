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

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
