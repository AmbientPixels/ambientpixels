// Run with: node api/actionsExecute/executors/content/generateVideo.test.js
//
// This executor is the thing that actually spends money. Every test below guards a way it
// could spend money it shouldn't: regenerating on a retry, running before approval, or
// running past the daily cap.
//
// A duplicate social post is embarrassing and deletable. A duplicate clip is a dollar that
// is simply gone, so the idempotency guard here matters more than the one on facebook.js.
//
// Offline: no API key, no network, no clip generated.

const assert = require('assert');
const path = require('path');
const { generateVideo, videoContentHash } = require('./generateVideo');
const router = require('../index');

let pass = 0, fail = 0;
async function ta(name, fn) {
  try { await fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const VIDEO = { portrait: 'resume-roast.png', says: 'Paste it in. I will tell you what is wrong.' };
const approved = (extra) => Object.assign({
  id: 'act_test_1', type: 'generate_video', platform: 'character',
  payload: { video: VIDEO }, approval: { status: 'approved' }
}, extra || {});

console.log('\ngenerate_video executor');

// ── Routing ──
t('generate_video routes to the character executor', () => {
  assert.ok(router.isExecutable('generate_video', 'character'));
  assert.ok(router.EXECUTABLE_TYPES.includes('generate_video'));
});

t('brand clips are deliberately not routable — they need ffmpeg', () => {
  assert.strictEqual(router.isExecutable('generate_video', 'brand'), false);
  assert.strictEqual(router.isExecutable('generate_video', 'site'), false);
});

// ── Content hash ──
t('hash covers what the money buys', () => {
  const base = videoContentHash(VIDEO);
  assert.strictEqual(base, videoContentHash({ ...VIDEO }), 'same request, same hash');
  assert.notStrictEqual(base, videoContentHash({ ...VIDEO, says: 'Something else entirely.' }), 'new line is a new clip');
  assert.notStrictEqual(base, videoContentHash({ ...VIDEO, portrait: 'roast-my-site.png' }), 'new face is a new clip');
  assert.notStrictEqual(base, videoContentHash({ ...VIDEO, tone: 'furious' }), 'new delivery is a new clip');
});

(async () => {
  // The one that protects real money on a retry.
  await ta('a matching receipt short-circuits before any spend', async () => {
    const receipt = { kind: 'character_video', job_id: 'vid-existing', video_url: 'https://blob/x.mp4', content_hash: videoContentHash(VIDEO) };
    const out = await generateVideo(approved({ execution: { receipt } }));
    assert.strictEqual(out.receipt.job_id, 'vid-existing', 'must return the existing clip, not make a new one');
  });

  await ta('an unapproved action cannot spend', async () => {
    let threw = null;
    try { await generateVideo(approved({ approval: { status: 'pending' } })); } catch (e) { threw = e; }
    assert.ok(threw, 'should have thrown');
    assert.strictEqual(threw.code, 'NOT_APPROVED');
  });

  await ta('a rejected action cannot spend', async () => {
    let threw = null;
    try { await generateVideo(approved({ approval: { status: 'rejected' } })); } catch (e) { threw = e; }
    assert.strictEqual(threw && threw.code, 'NOT_APPROVED');
  });

  await ta('an action with no approval block at all cannot spend', async () => {
    let threw = null;
    try { await generateVideo({ id: 'a', payload: { video: VIDEO } }); } catch (e) { threw = e; }
    assert.strictEqual(threw && threw.code, 'NOT_APPROVED', 'absent approval must read as pending, never as approved');
  });

  // Validation runs before the approval check only for shape errors; either way nothing spends.
  await ta('missing portrait is rejected', async () => {
    let threw = null;
    try { await generateVideo(approved({ payload: { video: { says: 'hello there friend' } } })); } catch (e) { threw = e; }
    assert.strictEqual(threw && threw.code, 'MISSING_PORTRAIT');
  });

  await ta('missing line is rejected', async () => {
    let threw = null;
    try { await generateVideo(approved({ payload: { video: { portrait: 'resume-roast.png' } } })); } catch (e) { threw = e; }
    assert.strictEqual(threw && threw.code, 'MISSING_LINE');
  });

  // Cap refusal must be a clean, explicable stop — not a crash, and not a silent skip.
  await ta('cap exhaustion blocks with an actionable message', async () => {
    const vePath = require.resolve('../../../_lib/contentEngine/videoEngine');
    const original = require.cache[vePath];
    require.cache[vePath] = { id: vePath, filename: vePath, loaded: true, exports: {
      checkDailyCap: async () => ({ allowed: false, used: 2, cap: 2 }),
      generateCharacterClip: async () => { throw new Error('MUST NOT BE CALLED past the cap'); }
    } };
    delete require.cache[require.resolve('./generateVideo')];
    const fresh = require('./generateVideo');
    try {
      let threw = null;
      try { await fresh.generateVideo(approved()); } catch (e) { threw = e; }
      assert.strictEqual(threw && threw.code, 'VIDEO_DAILY_CAP');
      assert.ok(/2\/2/.test(threw.message), 'message should state the cap: ' + threw.message);
    } finally {
      if (original) require.cache[vePath] = original; else delete require.cache[vePath];
      delete require.cache[require.resolve('./generateVideo')];
    }
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
