// Run with: node api/_lib/vale/teamsNudges.test.js
const assert = require('assert');
const { decide, applyMark, CAP } = require('./teamsNudges');
const { buildCard } = require('./teamsPost');
const { run } = require('../../valeTeamsNudges');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

// 2026-10-20 is PDT (UTC-7): 18:00Z = 11:00 PT, 23:10Z = 16:10 PT.
const MORNING = Date.parse('2026-10-20T18:00:00Z');
const AFTER_WRAP = Date.parse('2026-10-20T23:10:00Z');
const WINTER_WRAP = Date.parse('2026-12-01T00:10:00Z'); // PST (UTC-8): 16:10 PT on Nov 30

const summary = (over) => Object.assign({ blocks: {
  health: { state: 'ok', text: 'All systems normal' },
  waiting: { count: 2 },
  campaigns: { items: [{ title: 'Monthly Journal', status: 'starting', done: 0, planned: 1, period: 'this month' }] },
  happened: { total: 1, items: [{ text: 'Scribe finished: Write social copy' }] }
} }, over || {});
const P = [{ id: 'a', title: 'Approve the studio post', from: 'Nova' }, { id: 'b', title: 'Pick a board review time', from: null }];
const started = (ids) => ({ started: true, date: '2026-10-20', count: 0, notified: Object.fromEntries(ids.map((i) => [i, 'x'])), health: {}, wrapDate: null });

(async () => {
  await test('first run posts one "connected" card listing what is waiting, never a burst', () => {
    const d = decide({ now: MORNING, summary: summary(), pending: P, log: null });
    assert.strictEqual(d.messages.length, 1);
    assert.strictEqual(d.messages[0].kind, 'start');
    assert.ok(d.messages[0].lines[0].indexOf('2 things are waiting') === 0, d.messages[0].lines[0]);
    assert.deepStrictEqual(d.messages[0].mark.ids, ['a', 'b']);
  });

  await test('only items not yet told about are announced', () => {
    const d = decide({ now: MORNING, summary: summary(), pending: P.concat([{ id: 'c', title: 'New video request', from: 'Studio' }]), log: started(['a', 'b']) });
    const needs = d.messages.filter((m) => m.kind === 'needs');
    assert.strictEqual(needs.length, 1);
    assert.strictEqual(needs[0].title, 'New: 1 thing needs you');
    assert.ok(needs[0].lines.some((l) => l.indexOf('New video request — from Studio') !== -1));
    assert.ok(needs[0].lines.indexOf('3 waiting in all.') !== -1);
  });

  await test('nothing new and before the wrap: silence', () => {
    const d = decide({ now: MORNING, summary: summary(), pending: P, log: started(['a', 'b']) });
    assert.strictEqual(d.messages.length, 0);
  });

  await test('the daily cap stops needs/health posts but never the wrap', () => {
    const log = Object.assign(started([]), { count: CAP });
    const d = decide({ now: AFTER_WRAP, summary: summary(), pending: P, log });
    assert.deepStrictEqual(d.messages.map((m) => m.kind), ['wrap']);
  });

  await test('a broken run is reported once a day', () => {
    const s = summary({ blocks: Object.assign({}, summary().blocks, { health: { state: 'broken', text: 'The fleet missed its 18:00 UTC run' } }) });
    const d1 = decide({ now: MORNING, summary: s, pending: P, log: started(['a', 'b']) });
    assert.deepStrictEqual(d1.messages.map((m) => m.kind), ['health']);
    const after = applyMark(started(['a', 'b']), d1.messages[0], d1.date, 'now', ['a', 'b']);
    assert.strictEqual(decide({ now: MORNING + 900000, summary: s, pending: P, log: after }).messages.length, 0);
  });

  await test('the wrap goes at 16:05 Pacific, once, in summer and winter time', () => {
    const d = decide({ now: AFTER_WRAP, summary: summary(), pending: P, log: started(['a', 'b']) });
    const wrap = d.messages.find((m) => m.kind === 'wrap');
    assert.ok(wrap, 'wrap after 16:05 PDT');
    assert.ok(wrap.lines.indexOf('Waiting on you: 2.') !== -1);
    assert.ok(wrap.lines.indexOf('Monthly Journal: 0 of 1 this month.') !== -1);
    const done = applyMark(started(['a', 'b']), wrap, d.date, 'now', ['a', 'b']);
    assert.strictEqual(decide({ now: AFTER_WRAP + 900000, summary: summary(), pending: P, log: done }).messages.length, 0);
    assert.ok(decide({ now: WINTER_WRAP, summary: summary(), pending: P, log: started(['a', 'b']) }).messages.some((m) => m.kind === 'wrap'), 'wrap after 16:05 PST');
    assert.ok(!decide({ now: MORNING, summary: summary(), pending: P, log: started(['a', 'b']) }).messages.some((m) => m.kind === 'wrap'), 'no wrap at 11:00');
  });

  await test('an unreadable queue never announces or claims zero', () => {
    const s = summary({ blocks: Object.assign({}, summary().blocks, { waiting: { state: 'not_measured' } }) });
    const d = decide({ now: AFTER_WRAP, summary: s, pending: [], log: started([]) });
    assert.ok(!d.messages.some((m) => m.kind === 'needs'));
    assert.ok(d.messages.find((m) => m.kind === 'wrap').lines.some((l) => l.indexOf("couldn't read the queue") !== -1));
  });

  await test('card is an Adaptive Card envelope with a button', () => {
    const c = buildCard({ title: 'T', lines: ['a', 'b'], link: { title: 'Open Actions', url: 'https://x/y' } });
    assert.strictEqual(c.type, 'message');
    assert.strictEqual(c.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
    assert.strictEqual(c.attachments[0].content.body.length, 3);
    assert.strictEqual(c.attachments[0].content.actions[0].url, 'https://x/y');
  });

  // Runner, with fakes.
  const STATE = {
    tasks: [{ id: 'b', title: 'Pick a board review time', assignee: 'ceo', status: 'todo', createdAt: '2026-10-19T10:00:00Z' }],
    approvalQueue: [{ id: 'a', type: 'campaign_proposal', name: 'Approve the studio post', proposedBy: 'nova', status: 'pending', createdAt: '2026-10-19T09:00:00Z' }],
    campaigns: [], objectives: [], heartbeatRuns: [{ startedAt: '2026-10-20T16:00:00Z', status: 'ok' }], governanceLog: [], actions: [], geminiUsage: [],
    agentRegistry: { agents: [{ id: 'nova', name: 'Nova', status: 'active' }] }
  };
  const fakes = (status) => {
    const store = {}; const posts = [];
    return {
      posts, store,
      deps: {
        url: 'https://example.invalid/hook', now: () => MORNING,
        storage: { getStateWithMeta: async (k) => ({ value: STATE[k] === undefined ? null : STATE[k] }) },
        vs: { getValeWithMeta: async (k) => ({ value: store[k] || null }), setVale: async (k, v) => { store[k] = v; } },
        fetch: async (u, o) => { posts.push(JSON.parse(o.body)); return { status }; }
      }
    };
  };

  await test('runner: dormant without the address', async () => {
    const f = fakes(202); f.deps.url = '';
    assert.deepStrictEqual(await run(f.deps), { skipped: 'dormant' });
    assert.strictEqual(f.posts.length, 0);
  });

  await test('runner: an accepted post is recorded; the next tick is quiet', async () => {
    const f = fakes(202);
    const r1 = await run(f.deps);
    assert.deepStrictEqual(r1.sent, ['start']);
    assert.ok(f.store.valeTeamsLog.started);
    assert.ok(f.store.valeTeamsLog.notified.a && f.store.valeTeamsLog.notified.b);
    const r2 = await run(f.deps);
    assert.deepStrictEqual(r2.sent, []);
    assert.strictEqual(f.posts.length, 1);
  });

  await test('runner: a rejected post is not recorded, so it is tried again', async () => {
    const f = fakes(500);
    const r = await run(f.deps);
    assert.deepStrictEqual(r.failed, ['start:500']);
    assert.strictEqual(f.store.valeTeamsLog, undefined);
  });

  await test('runner: an unreadable log stops everything (never risk a repeat)', async () => {
    const f = fakes(202); f.deps.vs.getValeWithMeta = async () => ({ failed: true });
    assert.deepStrictEqual(await run(f.deps), { skipped: 'log_unreadable' });
    assert.strictEqual(f.posts.length, 0);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
