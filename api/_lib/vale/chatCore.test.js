// Run with: node api/_lib/vale/chatCore.test.js
// Stubs storage, the context loaders and the model call (via require.cache) and checks what
// Vale is given: the team block always, mail only when the caller allows it, the Teams note
// only in Teams, and usage logged under the caller's name.
const assert = require('assert');
const path = require('path');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const API = path.resolve(__dirname, '../..');
const calls = { prompts: [], usage: [], liveMail: 0 };
function stub(rel, exportsObj) {
  const file = require.resolve(path.join(API, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}
const STATE = { tasks: [], approvalQueue: [{ id: 'aq1', type: 'campaign_proposal', name: 'Studio notes on LinkedIn', proposedBy: 'nova', status: 'pending', createdAt: '2026-10-19T09:00:00Z' }],
  campaigns: [], objectives: [], heartbeatRuns: [], governanceLog: [], actions: [], geminiUsage: [], agentRegistry: { agents: [] } };
stub('_utils/companyStorage.js', {
  getState: async () => null,
  getStateWithMeta: async (k) => ({ value: STATE[k] === undefined ? null : STATE[k] }),
  logGeminiUsage: async (u) => { calls.usage.push(u); }, logClaudeUsage: async (u) => { calls.usage.push(u); }
});
stub('_utils/valeStorage.js', { getVale: async () => [], getValeWithMeta: async () => ({ value: null }) });
stub('_utils/companyContextLoader.js', { loadCompanyState: async () => ({}) });
stub('_utils/companyContextFormatters.js', { formatCoreContext: () => '\n\nFLEET SNAPSHOT', formatIntelDigests: () => '' });
stub('_lib/vale/briefDeps.js', { briefConfig: () => ({}), briefDeps: () => ({}) });
const realLive = require(path.join(API, '_lib/vale/liveMail.js'));
stub('_lib/vale/liveMail.js', Object.assign({}, realLive, {
  loadLiveMail: async () => { calls.liveMail++; return { ok: true, block: '\n\nLIVE INBOX', links: { 1: 'https://outlook.office.com/x' } }; }
}));
{ const f = require.resolve('node-fetch'); require.cache[f] = { id: f, filename: f, loaded: true, exports: async (url, o) => {
  calls.prompts.push(JSON.parse(o.body).systemInstruction.parts[0].text);
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Two things need you.' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }) };
} }; }
process.env.GEMINI_API_KEY = 'test';
delete process.env.HEARTBEAT_MODEL;

const { answer } = require('./chatCore');

(async () => {
  await test('office chat with mail: team block + live inbox, links passed through', async () => {
    const r = await answer({ message: 'What needs me?', history: [], includeMail: true, where: 'office', caller: 'valechat' });
    assert.strictEqual(r.reply, 'Two things need you.');
    const p = calls.prompts.pop();
    assert.ok(p.indexOf('THE TEAM RIGHT NOW') !== -1, 'team block present');
    assert.ok(p.indexOf('"Studio notes on LinkedIn"') !== -1, 'approval queue reaches the prompt');
    assert.ok(p.indexOf('LIVE INBOX') !== -1, 'mail present when allowed');
    assert.ok(p.indexOf('WHERE YOU ARE: a Microsoft Teams chat') === -1, 'no Teams note in the Office');
    assert.strictEqual(r.links[1], 'https://outlook.office.com/x');
  });

  await test('teams chat: no mail is read at all, Teams note present, usage logged as the bot', async () => {
    const before = calls.liveMail;
    const r = await answer({ message: 'What needs me?', history: [{ role: 'user', text: 'hi' }, { role: 'vale', text: 'Hi.' }], includeMail: false, where: 'teams', caller: 'vale-teams-bot' });
    assert.strictEqual(calls.liveMail, before, 'mailbox never touched');
    const p = calls.prompts.pop();
    assert.ok(p.indexOf('LIVE INBOX') === -1);
    assert.ok(p.indexOf('WHERE YOU ARE: a Microsoft Teams chat') !== -1);
    assert.ok(p.indexOf('THE TEAM RIGHT NOW') !== -1);
    assert.deepStrictEqual(r.links, {});
    assert.strictEqual(calls.usage[calls.usage.length - 1].caller, 'vale-teams-bot');
  });

  await test('no model key: an error, not a call', async () => {
    const k = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
    const n = calls.prompts.length;
    const r = await answer({ message: 'x', includeMail: false, where: 'teams' });
    process.env.GEMINI_API_KEY = k;
    assert.ok(r.error && r.error.status === 500);
    assert.strictEqual(calls.prompts.length, n);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
