// Run: node companyHeartbeat/video-desk.test.js   (from api/)
'use strict';
const assert = require('assert');
const V = require('./video-desk');
const desk = require('../studio/desk');

let passed = 0;
const pending = [];
function t(name, fn) {
  const fail = (err) => { console.error('FAIL', name, '\n ', err.message); process.exitCode = 1; };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => { passed++; }, fail));
    else passed++;
  } catch (err) { fail(err); }
}
const NOW = Date.parse('2026-10-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const KEYS = ['AmbientScore', 'ResumeRoast', 'CardForge'];

function data(over) {
  return Object.assign({
    releases: [
      { id: 'rel_major', at: daysAgo(2), product: 'AmbientScore', title: 'Free scans answer at once', summary: 'The report fills in as it finishes.', kind: 'feature', significance: 'major', status: 'unreviewed' },
      { id: 'rel_minor', at: daysAgo(1), product: 'ResumeRoast', title: 'Sharing fixed', kind: 'fix', significance: 'minor', status: 'confirmed' },
      { id: 'rel_old', at: daysAgo(20), product: 'CardForge', title: 'Old launch', kind: 'launch', significance: 'major', status: 'confirmed' },
      { id: 'rel_hidden', at: daysAgo(1), product: 'CardForge', title: 'Wrong', kind: 'launch', significance: 'major', status: 'hidden' },
    ],
    campaigns: [
      { id: 'camp-new', status: 'active', title: 'Roast replies', createdAt: daysAgo(3), bet: { betKey: 'community_reply|resume-roast|bluesky|any', product: 'Resume Roast' } },
      { id: 'camp-old', status: 'active', title: 'Old', createdAt: daysAgo(30) },
      { id: 'camp-paused', status: 'paused', title: 'Paused', createdAt: daysAgo(1) },
    ],
    ledger: {
      rows: [
        { campaignId: 'camp-w', title: 'Search page', betKey: 'search_page|ambientscore|google|any', product: 'AmbientScore', result: 'won', scoredAt: daysAgo(5), actual: { value: 12, posts: 9, days: 28 }, expected: { metric: 'qualified_uses_week', delta: 8 } },
        { campaignId: 'camp-l', title: 'Lost one', betKey: 'broadcast_post|x|bluesky|any', result: 'lost', scoredAt: daysAgo(5) },
      ],
      running: [{ campaignId: 'camp-s', title: 'Scaling', betKey: 'email|x|email|any', scaleEligible: true }],
    },
    tickets: [],
  }, over);
}
function video(over) {
  return Object.assign({
    trigger: { type: 'release', ref: 'rel_major', evidence: '' },
    product: 'AmbientScore', format: 'walkthrough', mood: 'ambient', title: 'What a free scan shows you',
    goal: 'Run a free scan on their own site', claims: [{ claim: 'Eight dimensions', source: 'product-facts:AmbientScore' }],
  }, over);
}
function filed(from, createdAt, status, trigger) {
  const x = desk.cleanFleetTicket(video({ trigger: trigger || { type: 'release', ref: 'rel_' + Math.random() } }), from, Date.parse(createdAt));
  if (status && status !== 'proposed') {
    if (status === 'declined') desk.decide(x, { decision: 'decline', reason: 'not the right moment' }, 'chad', NOW);
    else { desk.decide(x, { decision: 'accept' }, 'chad', NOW, ['ambientpixels']); if (status !== 'accepted') desk.applyUpdate(x, { status }, 'studio', NOW); }
  }
  return x;
}

t('triggers: major/launch releases ≤14 d, won bets, scale-eligible bets, fresh active campaigns — nothing else', () => {
  const refs = V.validTriggers(data(), NOW).map((x) => x.type + ':' + x.ref).sort();
  assert.deepStrictEqual(refs, ['bet_scale:email|x|email|any', 'bet_won:search_page|ambientscore|google|any', 'campaign_launch:camp-new', 'release:rel_major']);
});
t('a trigger already used by any ticket is gone', () => {
  const d = data({ tickets: [filed('scout', daysAgo(1), 'declined', { type: 'release', ref: 'rel_major' })] });
  assert.ok(!V.validTriggers(d, NOW).some((x) => x.ref === 'rel_major'));
});
t('capacity: 2 open fleet-wide; 21 days per agent, declined ones count', () => {
  assert.strictEqual(V.capacity('echo', [], NOW).ok, true);
  const two = [filed('nova', daysAgo(30), 'scripting'), filed('scout', daysAgo(25), 'proposed')];
  assert.match(V.capacity('echo', two, NOW).reason, /2 open/);
  const recent = [filed('echo', daysAgo(10), 'declined')];
  const c = V.capacity('echo', recent, NOW);
  assert.strictEqual(c.ok, false);
  assert.match(c.reason, /2026-10-31/);
  assert.strictEqual(V.capacity('echo', [filed('echo', daysAgo(22), 'released')], NOW).ok, true);
});
t('gates in order: agent, desk readable, capacity, trigger, product-facts source', () => {
  assert.strictEqual(V.gateSuggestion('scribe', video(), data(), KEYS, NOW).gate, 'video_unauthorized');
  assert.strictEqual(V.gateSuggestion('echo', video(), data({ tickets: null }), KEYS, NOW).gate, 'video_desk_unavailable');
  assert.strictEqual(V.gateSuggestion('echo', video(), data({ tickets: [filed('echo', daysAgo(3), 'declined')] }), KEYS, NOW).gate, 'video_agent_cooldown');
  assert.strictEqual(V.gateSuggestion('echo', video(), data({ tickets: [filed('nova', daysAgo(40), 'review'), filed('scout', daysAgo(40), 'proposed')] }), KEYS, NOW).gate, 'video_fleet_full');
  assert.strictEqual(V.gateSuggestion('echo', video({ trigger: { type: 'release', ref: 'rel_minor' } }), data(), KEYS, NOW).gate, 'video_no_trigger');
  assert.strictEqual(V.gateSuggestion('echo', video({ trigger: { type: 'manual', ref: 'x' } }), data(), KEYS, NOW).gate, 'video_no_trigger');
  assert.strictEqual(V.gateSuggestion('echo', video({ claims: [{ claim: 'x', source: 'product-facts:Nope' }] }), data(), KEYS, NOW).gate, 'video_bad_source');
});
t('a passing suggestion carries the trigger evidence and campaign link, and the desk accepts it', () => {
  const g = V.gateSuggestion('echo', video({ trigger: { type: 'bet_won', ref: 'search_page|ambientscore|google|any' } }), data(), KEYS, NOW);
  assert.strictEqual(g.ok, true, g.reason);
  assert.strictEqual(g.body.campaignId, 'camp-w');
  assert.match(g.body.trigger.evidence, /12 .* against 8 expected/);
  const ticket = desk.cleanFleetTicket(g.body, 'echo', NOW);
  assert.strictEqual(typeof ticket, 'object', ticket);
  assert.strictEqual(ticket.style, 'as-editorial');
});
t('block: empty when nothing to see or do; triggers + contract when allowed; status + decline reason after', () => {
  assert.strictEqual(V.buildVideoDeskBlock('scribe', data(), NOW), '');
  assert.strictEqual(V.buildVideoDeskBlock('echo', data({ releases: [], campaigns: [], ledger: null }), NOW), '');
  const b = V.buildVideoDeskBlock('echo', data(), NOW);
  assert.match(b, /VIDEO DESK/);
  assert.match(b, /type=release ref=rel_major/);
  assert.match(b, /"type":"suggest-video"/);
  assert.match(b, /FORMATS: walkthrough 60-150s/);
  assert.ok(b.length < 2600, 'block is ' + b.length + ' chars');
  const d = data({ tickets: [filed('echo', daysAgo(5), 'declined')] });
  const after = V.buildVideoDeskBlock('echo', d, NOW);
  assert.match(after, /declined — CEO: "not the right moment"/);
  assert.match(after, /No new suggestions now: your next suggestion is allowed from/);
  assert.doesNotMatch(after, /"type":"suggest-video"/);
});
t('releases block: live, not hidden, newest first, ≤6, empty when none', () => {
  const b = V.buildReleasesBlock(data().releases, NOW);
  assert.match(b, /AmbientScore: Free scans answer at once \[major\]/);
  assert.doesNotMatch(b, /Wrong|Old launch/);
  assert.strictEqual(V.buildReleasesBlock([], NOW), '');
});
t('crew asks: Nova (always runs) makes one task per cycle for the asked agent, then taken, then done', () => {
  const a = desk.cleanCrewTicket({ kind: 'claims_check', title: 'Check 03 claims', text: 'Every line of 03-teardown-SOURCES.md' }, 'researcher', NOW);
  const b = desk.cleanCrewTicket({ kind: 'claims_check', title: 'Check 04 claims', text: 'Every line of 04-scan-SOURCES.md' }, 'researcher', NOW);
  const w1 = V.crewTicketWork('nova', [a, b], [], 'obj-build-public', NOW);
  assert.strictEqual(w1.creates.length, 1);
  assert.strictEqual(w1.creates[0].assignee, 'quill'); // assigned work is what wakes an idle agent
  assert.strictEqual(w1.creates[0].taskType, 'editorial');
  assert.strictEqual(w1.creates[0].objective_id, 'obj-build-public');
  assert.ok(w1.creates[0].description.indexOf('[video-desk:' + a.id + ']') === 0);
  assert.deepStrictEqual(V.crewTicketWork('quill', [a, b], [], null, NOW), { creates: [], updates: [] }); // only Nova couriers
  const task = { id: 'task-1', status: 'todo', description: w1.creates[0].description, comments: [] };
  const w2 = V.crewTicketWork('nova', [a], [task], null, NOW);
  assert.deepStrictEqual(w2.creates, []);
  assert.strictEqual(w2.updates[0].status, 'taken');
  desk.applyUpdate(a, w2.updates[0], 'quill', NOW);
  assert.deepStrictEqual(V.crewTicketWork('nova', [a], [task], null, NOW).updates, []); // taken + in progress: nothing to say
  task.status = 'done'; task.comments.push({ text: 'Claim 3 has no source; the rest check out.' });
  const w3 = V.crewTicketWork('nova', [a], [task], null, NOW);
  assert.strictEqual(w3.updates[0].status, 'done');
  assert.match(w3.updates[0].note, /Claim 3 has no source/);
});
t('a ticket filed this cycle counts for the next agent at once', async () => {
  V._resetCache();
  const fake = { getState: async () => ({ entries: [] }) };
  const store = { listTickets: async () => [] };
  return V.loadVideoDeskData(fake, NOW, store).then((d) => {
    V.noteFiled(filed('nova', daysAgo(0), 'proposed'));
    V.noteFiled(filed('scout', daysAgo(0), 'proposed'));
    return V.loadVideoDeskData(fake, NOW + 1000, store).then((d2) => assert.strictEqual(V.capacity('echo', d2.tickets, NOW).ok, false));
  });
});

Promise.all(pending).then(() => console.log(`video-desk: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`));
