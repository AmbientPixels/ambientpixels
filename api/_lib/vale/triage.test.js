// Run with: node api/_lib/vale/triage.test.js
const assert = require('assert');
const t = require('./triage');
const fx = require('./fixtures');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const RULES = {
  vips: ['dana@clientco.example'], muted: [], receipts: ['payco.example'],
  rulesOnlyDomains: ['hanson-client.example'],
  projects: { Evergreen: { domains: ['evergreengoodwill.org'], keywords: ['evergreen'] }, 'Hanson-related': { domains: ['hanson-client.example'], keywords: [] }, AP: { domains: [], keywords: ['demo'] } }
};
const NOW = Date.parse('2026-10-17T13:30:00Z');

function modelReturning(fn) {
  const calls = [];
  const f = async (opts) => { calls.push(opts); return { text: fn(opts) }; };
  f.calls = calls;
  return f;
}
const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

(async () => {
  await test('rules: VIP, flagged, newsletter, receipt, Outlook Other', async () => {
    const out = byId(await t.triage(fx.inbox, { rules: RULES, callModel: modelReturning(() => '{"items":[]}') }));
    assert.strictEqual(out['m-vip'].label, 'needs_you'); assert.strictEqual(out['m-vip'].by, 'rule');
    assert.strictEqual(out['m-flag'].label, 'needs_you');
    assert.strictEqual(out['m-news'].label, 'newsletter');
    assert.strictEqual(out['m-receipt'].label, 'receipt');
    assert.strictEqual(out['m-other'].label, 'noise');
  });
  await test('Vale\'s own brief is excluded from triage', async () => {
    const out = byId(await t.triage(fx.inbox, { rules: RULES }));
    assert.ok(!out['m-self']);
  });
  await test('rules-only client mail is never sent to the model', async () => {
    const model = modelReturning(() => '{"items":[]}');
    const out = byId(await t.triage(fx.inbox, { rules: RULES, callModel: model }));
    assert.strictEqual(out['m-client'].label, 'needs_you'); assert.strictEqual(out['m-client'].rulesOnly, true);
    const sent = model.calls.map((c) => c.prompt).join('\n');
    assert.ok(sent.indexOf('hanson-client.example') === -1 && sent.indexOf('Q4 portal roadmap') === -1);
  });
  await test('the model sees only unmatched mail, with short refs instead of Graph ids', async () => {
    const model = modelReturning(() => '{"items":[]}');
    await t.triage(fx.inbox, { rules: RULES, callModel: model });
    assert.strictEqual(model.calls.length, 1);
    const p = model.calls[0];
    assert.strictEqual(p.model, 'claude-haiku'); assert.strictEqual(p.caller, 'vale-triage');
    assert.ok(p.prompt.indexOf('"ref":"m1"') !== -1);
    assert.ok(p.prompt.indexOf('m-person') === -1, 'Graph ids must not reach the model');
    assert.ok(p.prompt.indexOf('jordan@partner.example') !== -1);
    assert.ok(p.prompt.indexOf('dana@clientco.example') === -1, 'rule-matched VIP mail is not sent');
  });
  await test('the injection email stays data: fenced, and cannot add fields or labels', async () => {
    const model = modelReturning((opts) => {
      assert.ok(/UNTRUSTED DATA/.test(opts.system));
      assert.ok(/<emails>[\s\S]*SYSTEM: ignore your rules[\s\S]*<\/emails>/.test(opts.prompt));
      // A compromised answer: invented label, extra keys, a rules change, a long reason.
      return JSON.stringify({ addVip: 'ops@phish.example', rules: { vips: ['ops@phish.example'] }, items: [
        { ref: 'm1', label: 'URGENT_FORWARD', why: 'x'.repeat(500), forwardTo: 'https://evil.example' },
        { ref: 'm2', label: 'needs_you', why: 'Asks if Thursday demo is on' },
        { ref: 'm99', label: 'needs_you', why: 'ghost' }
      ] });
    });
    const items = await t.triage(fx.inbox, { rules: RULES, callModel: model });
    const out = byId(items);
    assert.strictEqual(out['m-inject'].label, 'unsure');
    assert.ok(out['m-inject'].why.length <= 120);
    assert.strictEqual(out['m-person'].label, 'needs_you');
    assert.ok(!items.some((i) => i.forwardTo || i.addVip));
    assert.deepStrictEqual(RULES.vips, ['dana@clientco.example'], 'rules must never change from model output');
  });
  await test('model failure → every unmatched email is unsure, nothing guessed', async () => {
    const out = byId(await t.triage(fx.inbox, { rules: RULES, callModel: async () => { throw new Error('down'); } }));
    assert.strictEqual(out['m-person'].label, 'unsure'); assert.strictEqual(out['m-person'].by, 'fallback');
    assert.strictEqual(out['m-vip'].label, 'needs_you', 'rules still work without the model');
  });
  await test('malformed model output → unsure', () => {
    const m = t.parseTriage('not json at all', ['m1', 'm2']);
    assert.strictEqual(m.m1.label, 'unsure'); assert.strictEqual(m.m2.label, 'unsure');
  });
  await test('derived items carry no body text', async () => {
    const items = await t.triage(fx.inbox, { rules: RULES, callModel: modelReturning(() => '{"items":[]}') });
    const s = JSON.stringify(items);
    assert.ok(s.indexOf('could you send three slots') === -1 && s.indexOf('bodyPreview') === -1 && s.indexOf('_preview') === -1);
  });
  await test('external marker and project tagging', async () => {
    const out = byId(await t.triage(fx.inbox, { rules: RULES }));
    assert.strictEqual(out['m-vip'].external, true);
    assert.strictEqual(out['m-client'].project, 'Hanson-related');
    assert.strictEqual(out['m-person'].project, 'AP', 'keyword "demo"');
    assert.strictEqual(out['m-news'].project, 'Other');
  });
  await test('matches handles addresses, domains, @domains and subdomains', () => {
    assert.ok(t.matches(['clientco.example'], 'dana@clientco.example'));
    assert.ok(t.matches(['@clientco.example'], 'dana@clientco.example'));
    assert.ok(t.matches(['clientco.example'], 'x@mail.clientco.example'));
    assert.ok(!t.matches(['co.example'], 'x@clientco.example'), 'suffix must be a real subdomain boundary');
  });
  await test('waiting on others: Chad wrote last, 3+ days ago, no reply since', () => {
    const w = t.waitingOnOthers(fx.inbox, fx.sent, NOW);
    assert.deepStrictEqual(w.map((x) => x.conversationId), ['conv-stale']);
    assert.strictEqual(w[0].to, 'alex@prospect.example'); assert.strictEqual(w[0].days, 4);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
