// Run with: node api/_utils/runScore.test.js
//
// Guards the share-card score/verdict extraction. The bug this exists to
// prevent: both share endpoints hardcoded `result.score ?? result.overall_score`,
// but only 1 of the 10 scoring agents uses the key `score` — so 9 of 10 share
// cards rendered with no score at all, silently, for the whole catalogue.
//
// The strongest tests here are the ones that read the REAL registry
// (`_data/pixel-agents.json`) rather than fixtures: they fail the day someone
// adds an agent whose score key the extractor cannot find.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractScore, extractVerdict, agentForRun } = require('./runScore');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
}

const REGISTRY = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '_data', 'pixel-agents.json'), 'utf-8')
);
const byId = id => REGISTRY.find(a => a.id === id);

// ── the real bug: domain-specific score keys ──

test('resume-roast — reads ats_score, the key the agent actually contracts for', () => {
  // Verbatim shape from the agent's systemPrompt JSON contract.
  const result = { ats_score: 41, verdict: 'Solid resume, wrong job.', strengths: [] };
  assert.strictEqual(extractScore(result, 'resume-roast'), 41);
});

test('roast-my-site — the one agent that really does use `score` still works', () => {
  assert.strictEqual(extractScore({ score: 72, verdict: 'Busy.' }, 'roast-my-site'), 72);
});

test('every scoring agent in the registry resolves its declared score key', () => {
  // This is the regression guard. A new agent with a new key must not silently
  // fall back to "no score" the way the whole catalogue used to.
  const scoring = REGISTRY.filter(a =>
    (a.outputSections || []).some(s => s.type === 'score'));
  assert.ok(scoring.length >= 10, 'expected at least 10 scoring agents, got ' + scoring.length);

  for (const agent of scoring) {
    const key = agent.outputSections.find(s => s.type === 'score').key;
    const got = extractScore({ [key]: 63 }, agent);
    assert.strictEqual(got, 63, agent.id + ' did not resolve its score key ' + key);
  }
});

test('every verdict-typed agent resolves its declared verdict key', () => {
  // Five of these use keys no /verdict$/ regex would ever match:
  // cause_of_death, rating, send_confidence, shock_factor, goal_summary.
  const withVerdict = REGISTRY.filter(a =>
    (a.outputSections || []).some(s => s.type === 'verdict'));
  assert.ok(withVerdict.length >= 10, 'expected at least 10, got ' + withVerdict.length);

  for (const agent of withVerdict) {
    const key = agent.outputSections.find(s => s.type === 'verdict').key;
    const got = extractVerdict({ [key]: 'the verdict line' }, agent);
    assert.strictEqual(got, 'the verdict line', agent.id + ' missed verdict key ' + key);
  }
});

test('startup-obituary — cause_of_death, which no verdict regex would find', () => {
  assert.strictEqual(
    extractVerdict({ cause_of_death: 'Died of a feature roadmap.' }, 'startup-obituary'),
    'Died of a feature roadmap.');
});

test('legal-eagle — `rating`, likewise unfindable by pattern', () => {
  assert.strictEqual(extractVerdict({ rating: 'Mostly harmless.' }, 'legal-eagle'), 'Mostly harmless.');
});

// ── declared order matters where an agent has more than one score ──

test('debate-me — picks their_score, the first declared, not counter_score', () => {
  const result = { their_position: 'x', their_score: 30, counter_score: 90 };
  assert.strictEqual(extractScore(result, 'debate-me'), 30);
});

test('debate-me — falls through to counter_score only when their_score is absent', () => {
  assert.strictEqual(extractScore({ counter_score: 90 }, 'debate-me'), 90);
});

// ── the agent argument is optional: heuristic fallback ──

test('unknown agent id — still finds a *_score key', () => {
  assert.strictEqual(extractScore({ charisma_score: 88 }, 'not-a-real-agent'), 88);
});

test('no agent argument at all — the original signature keeps working', () => {
  assert.strictEqual(extractScore({ ats_score: 41 }), 41);
  assert.strictEqual(extractVerdict({ verdict: 'ok' }), 'ok');
});

test('community agent object passed inline — no registry entry needed', () => {
  // Agent Forge agents live in state, not the file, so they arrive as objects.
  const communityAgent = {
    id: 'user-built-thing',
    outputSections: [{ key: 'vibe_rating', type: 'score' }, { key: 'the_call', type: 'verdict' }]
  };
  assert.strictEqual(extractScore({ vibe_rating: 55 }, communityAgent), 55);
  assert.strictEqual(extractVerdict({ the_call: 'Needs work.' }, communityAgent), 'Needs work.');
});

test('declared key beats a stray key the heuristic would have grabbed first', () => {
  const agent = { id: 'x', outputSections: [{ key: 'real_score', type: 'score' }] };
  // confidence_score is inserted first, so insertion-order heuristics pick it.
  assert.strictEqual(extractScore({ confidence_score: 12, real_score: 77 }, agent), 77);
});

// ── coercion and guards ──

test('accepts a numeric string', () => {
  assert.strictEqual(extractScore({ ats_score: '41' }, 'resume-roast'), 41);
});

test('accepts "41/100"', () => {
  assert.strictEqual(extractScore({ ats_score: '41/100' }, 'resume-roast'), 41);
});

test('zero is a real score, not a missing one', () => {
  // The falsy trap: `score || null` would turn a legitimate 0 into no-score.
  assert.strictEqual(extractScore({ ats_score: 0 }, 'resume-roast'), 0);
});

test('rejects out-of-range numbers rather than rendering them as a grade', () => {
  assert.strictEqual(extractScore({ ats_score: 1786134787908 }, 'resume-roast'), null);
  assert.strictEqual(extractScore({ ats_score: -5 }, 'resume-roast'), null);
});

test('rejects non-scalars', () => {
  assert.strictEqual(extractScore({ ats_score: [41] }, 'resume-roast'), null);
  assert.strictEqual(extractScore({ ats_score: { value: 41 } }, 'resume-roast'), null);
  assert.strictEqual(extractScore({ ats_score: true }, 'resume-roast'), null);
  assert.strictEqual(extractScore({ ats_score: 'not a number' }, 'resume-roast'), null);
});

test('a declared key holding junk falls back rather than returning null', () => {
  // A model that emits garbage in the declared slot but a usable number
  // elsewhere should still produce a card with a score.
  assert.strictEqual(extractScore({ ats_score: 'N/A', quality_score: 60 }, 'resume-roast'), 60);
});

test('missing / malformed results never throw', () => {
  for (const bad of [null, undefined, 'a string', 42, [], true]) {
    assert.strictEqual(extractScore(bad, 'resume-roast'), null, 'score: ' + JSON.stringify(bad));
    assert.strictEqual(extractVerdict(bad, 'resume-roast'), null, 'verdict: ' + JSON.stringify(bad));
  }
});

test('agents with no score at all return null, not a wrong number', () => {
  // hype-check has a verdict but no score section; it must not borrow one.
  const result = { verdict: 'Overhyped.', reality: 'x' };
  assert.strictEqual(extractScore(result, 'hype-check'), null);
  assert.strictEqual(extractVerdict(result, 'hype-check'), 'Overhyped.');
});

test('whitespace-only verdict counts as absent', () => {
  assert.strictEqual(extractVerdict({ verdict: '   ' }, 'roast-my-site'), null);
});

test('a bad agent argument degrades to the heuristic instead of throwing', () => {
  for (const bad of [null, 42, [], {}, { outputSections: 'nope' }]) {
    assert.strictEqual(extractScore({ ats_score: 41 }, bad), 41, JSON.stringify(bad));
  }
});

// ── agentForRun ────────────────────────────────────────────────────────

let asyncQueue = [];
function asyncTest(name, fn) { asyncQueue.push([name, fn]); }

asyncTest('resolves a built-in agent from the file registry', async () => {
  const agent = await agentForRun({ agentId: 'resume-roast' }, null);
  assert.ok(agent, 'expected an agent');
  assert.strictEqual(agent.id, 'resume-roast');
});

asyncTest('does NOT touch state for a built-in agent', async () => {
  // The common case must cost zero extra blob reads.
  let reads = 0;
  const storage = { getState: async () => { reads++; return []; } };
  await agentForRun({ agentId: 'resume-roast' }, storage);
  assert.strictEqual(reads, 0, 'file-registry hit must not read state');
});

asyncTest('falls back to community state for an Agent Forge agent', async () => {
  const built = { id: 'community-thing', outputSections: [{ key: 'vibe_score', type: 'score' }] };
  const storage = { getState: async key => {
    assert.strictEqual(key, 'pixelAgentCommunity');
    return [built];
  } };
  const agent = await agentForRun({ agentId: 'community-thing' }, storage);
  assert.strictEqual(agent.id, 'community-thing');
  assert.strictEqual(extractScore({ vibe_score: 44 }, agent), 44);
});

asyncTest('a state failure returns null instead of throwing', async () => {
  // A share card must still render when storage is unreachable.
  const storage = { getState: async () => { throw new Error('blob unreachable'); } };
  assert.strictEqual(await agentForRun({ agentId: 'unknown' }, storage), null);
});

asyncTest('missing run / agentId / storage are all survivable', async () => {
  assert.strictEqual(await agentForRun(null, null), null);
  assert.strictEqual(await agentForRun({}, null), null);
  assert.strictEqual(await agentForRun({ agentId: 'unknown' }), null);
  assert.strictEqual(await agentForRun({ agentId: 'unknown' }, {}), null);
  assert.strictEqual(await agentForRun({ agentId: 'unknown' }, { getState: async () => 'not an array' }), null);
});

(async function () {
  for (const [name, fn] of asyncQueue) {
    try { await fn(); pass++; console.log('  PASS ', name); }
    catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
