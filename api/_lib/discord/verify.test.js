// Run with: node api/_lib/discord/verify.test.js
//
// The signature check is not defence in depth — Discord PROBES it during setup
// by sending deliberately-invalid signatures and refuses to register an endpoint
// that answers anything other than 401. So "rejects bad input" is a functional
// requirement, and every rejection path below is a way the bot fails to install.

const assert = require('assert');
const crypto = require('crypto');
const d = require('./verify');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (err) { fail++; console.log('  FAIL ', name, '\n        ', err.message); }
}

// A real Ed25519 pair, used the way Discord uses one.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB_HEX = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex');
const sign = (ts, body) => crypto.sign(null, Buffer.from(ts + body), privateKey).toString('hex');

// ── signature ──

test('accepts a genuinely signed request', () => {
  const body = JSON.stringify({ type: 1 });
  const ts = '1786000000';
  assert.strictEqual(d.verifyInteraction(body, sign(ts, body), ts, PUB_HEX), true);
});

test('rejects a tampered body — the whole point of signing', () => {
  const ts = '1786000000';
  const sig = sign(ts, JSON.stringify({ type: 1 }));
  assert.strictEqual(d.verifyInteraction(JSON.stringify({ type: 2 }), sig, ts, PUB_HEX), false);
});

test('rejects a replayed signature under a different timestamp', () => {
  const body = JSON.stringify({ type: 1 });
  const sig = sign('1786000000', body);
  assert.strictEqual(d.verifyInteraction(body, sig, '1786000001', PUB_HEX), false);
});

test('rejects a signature from a different key', () => {
  const other = crypto.generateKeyPairSync('ed25519');
  const body = JSON.stringify({ type: 1 });
  const ts = '1786000000';
  const sig = crypto.sign(null, Buffer.from(ts + body), other.privateKey).toString('hex');
  assert.strictEqual(d.verifyInteraction(body, sig, ts, PUB_HEX), false);
});

test('garbage never throws, it just fails — a throw would 500 and Discord reads non-401 as a pass', () => {
  const cases = [
    ['body', 'not-hex', '123', PUB_HEX],
    ['body', 'ab', '123', PUB_HEX],                     // too short
    ['body', 'zz'.repeat(64), '123', PUB_HEX],          // right length, not hex
    ['body', sign('1', 'body'), '1', 'not-a-key'],
    ['body', sign('1', 'body'), '1', ''],
    [null, sign('1', 'body'), '1', PUB_HEX],
    ['body', null, '1', PUB_HEX],
    ['body', sign('1', 'body'), null, PUB_HEX],
    ['body', sign('1', 'body'), '1', undefined]
  ];
  for (const c of cases) {
    let out;
    assert.doesNotThrow(() => { out = d.verifyInteraction(c[0], c[1], c[2], c[3]); }, JSON.stringify(c[1]));
    assert.strictEqual(out, false, 'should be false for ' + JSON.stringify(c[1]));
  }
});

test('an empty body still verifies when correctly signed', () => {
  const ts = '1786000000';
  assert.strictEqual(d.verifyInteraction('', sign(ts, ''), ts, PUB_HEX), true);
});

// ── privacy: the resume must never reach the channel ──

test('the modal collects the resume, so it never appears as a command option', () => {
  // Discord renders slash-command option values into the channel. A resume
  // carries a real name, email, phone and address — this is the whole reason
  // input is a modal rather than `/roast resume:<text>`.
  const m = d.roastModal();
  assert.strictEqual(m.type, d.RESPONSE.MODAL);
  const ids = m.data.components.flatMap(r => r.components.map(c => c.custom_id));
  assert.deepStrictEqual(ids, ['resume', 'job']);
  assert.strictEqual(m.data.components[0].components[0].style, 2, 'resume field must be multiline');
});

test('the public embed carries the score and NOT the resume', () => {
  const result = {
    ats_score: 41,
    verdict: 'All roadmap, zero delivery.',
    roast_points: ['Vague bullets everywhere', 'No metrics at all', 'Third point'],
    keyword_gap: ['payments', 'ledger'],
    rewrite_tips: 'SENSITIVE-LOOKING TEXT THAT MUST NOT SHIP'
  };
  const e = d.resultEmbed(result, 'Resume Roast', 'https://example.com');
  const blob = JSON.stringify(e);
  assert.ok(e.title.includes('41/100'), e.title);
  assert.ok(blob.includes('All roadmap'), 'verdict missing');
  assert.ok(!blob.includes('SENSITIVE-LOOKING'), 'embed leaked a field it should not carry');
  assert.strictEqual(e.fields.find(f => f.name === 'The roast').value.split('\n').length, 2, 'should show 2 roast lines');
});

test('embed fields stay inside Discord limits even with hostile input', () => {
  const e = d.resultEmbed({
    ats_score: 5,
    verdict: 'x'.repeat(5000),
    roast_points: Array(20).fill('y'.repeat(500)),
    keyword_gap: Array(40).fill('z'.repeat(100))
  }, 'Resume Roast', 'https://example.com');
  assert.ok(e.description.length <= 380, 'description ' + e.description.length);
  for (const f of e.fields) assert.ok(f.value.length <= 1024, f.name + ' = ' + f.value.length);
});

test('a scoreless result still produces a valid embed', () => {
  const e = d.resultEmbed({ verdict: 'Hard to say.' }, 'Resume Roast', 'https://example.com');
  assert.strictEqual(e.title, 'Resume Roast');
  assert.ok(e.description.includes('Hard to say'));
});

test('score colour tracks the score, so a bad one looks bad', () => {
  const c = s => d.resultEmbed({ ats_score: s, verdict: 'v' }, 'A', 'u').color;
  assert.notStrictEqual(c(20), c(80));
  assert.strictEqual(c(20), 0xC62828);
  assert.strictEqual(c(80), 0x2E7D32);
});

// ── payload plumbing ──

test('reads modal values out of the nested component rows', () => {
  const interaction = { data: { components: [
    { type: 1, components: [{ type: 4, custom_id: 'resume', value: 'MY RESUME' }] },
    { type: 1, components: [{ type: 4, custom_id: 'job', value: 'MY JOB' }] }
  ] } };
  assert.strictEqual(d.modalValue(interaction, 'resume'), 'MY RESUME');
  assert.strictEqual(d.modalValue(interaction, 'job'), 'MY JOB');
  assert.strictEqual(d.modalValue(interaction, 'nope'), '');
  assert.strictEqual(d.modalValue({}, 'resume'), '');
  assert.strictEqual(d.modalValue(null, 'resume'), '');
});

test('finds the user id in BOTH guild and DM payload shapes', () => {
  // Guild interactions nest the user under member; DMs put it at the top level.
  // Getting this wrong silently collapses every DM user into one quota bucket.
  assert.strictEqual(d.userId({ member: { user: { id: 'guild-user' } } }), 'guild-user');
  assert.strictEqual(d.userId({ user: { id: 'dm-user' } }), 'dm-user');
  assert.strictEqual(d.userId({}), null);
  assert.strictEqual(d.userId(null), null);
});

test('pickScore uses the agent contract key, not result.score', () => {
  assert.strictEqual(d.pickScore({ ats_score: 41 }), 41);
  assert.strictEqual(d.pickScore({ score: 72 }), 72);
  assert.strictEqual(d.pickScore({ ats_score: '41' }), 41);
  assert.strictEqual(d.pickScore({ ats_score: 0 }), 0, 'zero is a real score');
  assert.strictEqual(d.pickScore({ ats_score: 1786134787908 }), null, 'out of range');
  assert.strictEqual(d.pickScore({}), null);
  assert.strictEqual(d.pickScore(null), null);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
