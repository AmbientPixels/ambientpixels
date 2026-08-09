// Run with: node api/_lib/contentEngine/videoEngine.test.js
//
// This library spends dollars per call, on behalf of an autonomous agent, against a company
// with a ~57 day runway. The tests that matter are the ones guarding the two ways that goes
// wrong: an unbounded spend, and an animated face that should never have been animated.
//
// Offline. No API key needed, no network, no clip is ever generated.

const assert = require('assert');
const path = require('path');
const ve = require('./videoEngine');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}
async function ta(name, fn) {
  try { await fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

console.log('\nvideoEngine');

// ── Portrait resolution: the face guard ──
// Only invented agent portraits already in the repo may be animated. A caller-supplied path
// or URL is how a photograph of a real person ends up saying words they never said.
t('accepts a real agent portrait by bare filename', () => {
  const p = ve.resolvePortrait('resume-roast.png');
  assert.ok(p.startsWith(ve.PORTRAIT_DIR), 'must resolve inside the portrait dir');
});

t('rejects path traversal', () => {
  assert.throws(() => ve.resolvePortrait('../../../etc/passwd'), /Invalid portrait name/);
  assert.throws(() => ve.resolvePortrait('..\\..\\secrets.png'), /Invalid portrait name/);
  assert.throws(() => ve.resolvePortrait('sub/dir/x.png'), /Invalid portrait name/);
});

t('rejects absolute paths and URLs', () => {
  assert.throws(() => ve.resolvePortrait('https://example.com/someone-real.jpg'), /Invalid portrait name/);
  assert.throws(() => ve.resolvePortrait('/etc/passwd'), /Invalid portrait name/);
  assert.throws(() => ve.resolvePortrait('C:\\Users\\me\\photo.png'), /Invalid portrait name/);
});

t('rejects a portrait that does not exist', () => {
  assert.throws(() => ve.resolvePortrait('not-a-real-agent.png'), /Portrait not found/);
});

t('rejects empty or non-image names', () => {
  assert.throws(() => ve.resolvePortrait(''), /Invalid portrait name/);
  assert.throws(() => ve.resolvePortrait('resume-roast.exe'), /Invalid portrait name/);
});

// ── Prompt: length is a quality guard, not a style preference ──
t('requires a line of dialogue', () => {
  assert.throws(() => ve.buildVideoPrompt({ portrait: 'resume-roast.png' }), /says is required/);
  assert.throws(() => ve.buildVideoPrompt({ says: '   ' }), /says is required/);
});

t('rejects dialogue too long for 8 seconds', () => {
  const tooLong = Array.from({ length: 40 }, (_, i) => 'word' + i).join(' ');
  assert.throws(() => ve.buildVideoPrompt({ says: tooLong }), /Shorten it/);
});

t('prompt carries the line and forbids on-screen text', () => {
  const p = ve.buildVideoPrompt({ says: 'Paste it in. I will tell you what is wrong.' });
  assert.ok(p.includes('Paste it in.'), 'line must appear in the prompt');
  assert.ok(/No text, captions, subtitles/.test(p), 'must forbid burned-in text');
  assert.ok(/IDENTICAL to the provided image/.test(p), 'must pin the face to the conditioning image');
});

// ── Cost ──
t('cost estimate errs high rather than low', () => {
  assert.ok(ve.VIDEO_COST_PER_CLIP >= 0.5,
    'an underestimate is discovered via the invoice; keep the default conservative');
});

t('daily cap is small by default', () => {
  assert.ok(ve.MAX_CLIPS_PER_DAY > 0 && ve.MAX_CLIPS_PER_DAY <= 5,
    'cap should stay small until real Veo pricing is confirmed');
});

// ── Response shape ──
t('finds the video uri wherever Veo hides it', () => {
  assert.strictEqual(
    ve.findVideoUri({ generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://x/files/abc.mp4' } }] } }),
    'https://x/files/abc.mp4');
  assert.strictEqual(
    ve.findVideoUri({ some: { future: { shape: { videoUri: 'https://y/download/v?id=1' } } } }),
    'https://y/download/v?id=1');
  assert.strictEqual(ve.findVideoUri({ nothing: 'here', n: 1 }), null);
});

t('survives a self-referencing response without hanging', () => {
  const a = { b: {} }; a.b.back = a;
  assert.strictEqual(ve.findVideoUri(a), null);
});

(async () => {
  // The cap must FAIL CLOSED. imageEngine fails open, which is correct at $0.039 and wrong
  // at dollars: if we cannot prove today's spend, we do not add to it.
  await ta('cap refuses to allow spending when the ledger cannot be read', async () => {
    const storagePath = require.resolve('../../_utils/companyStorage');
    const original = require.cache[storagePath];
    require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true,
      exports: { getState: async () => { throw new Error('blob unavailable'); } } };
    try {
      const cap = await ve.checkDailyCap();
      assert.strictEqual(cap.allowed, false, 'unreadable ledger must NOT allow a spend');
      assert.ok(/refusing to spend/.test(cap.reason || ''), 'should say why');
    } finally {
      if (original) require.cache[storagePath] = original; else delete require.cache[storagePath];
    }
  });

  await ta('cap blocks once the day is used up', async () => {
    const storagePath = require.resolve('../../_utils/companyStorage');
    const original = require.cache[storagePath];
    const today = new Date().toISOString();
    const rows = Array.from({ length: ve.MAX_CLIPS_PER_DAY }, () => ({ caller: 'video-engine:heartbeat', timestamp: today }));
    require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true,
      exports: { getState: async () => rows } };
    try {
      const cap = await ve.checkDailyCap();
      assert.strictEqual(cap.allowed, false, 'at the cap, further spend must be blocked');
      assert.strictEqual(cap.remaining, 0);
    } finally {
      if (original) require.cache[storagePath] = original; else delete require.cache[storagePath];
    }
  });

  await ta('yesterday does not count against today', async () => {
    const storagePath = require.resolve('../../_utils/companyStorage');
    const original = require.cache[storagePath];
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const rows = Array.from({ length: 20 }, () => ({ caller: 'video-engine:heartbeat', timestamp: yesterday }));
    require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true,
      exports: { getState: async () => rows } };
    try {
      const cap = await ve.checkDailyCap();
      assert.strictEqual(cap.allowed, true);
      assert.strictEqual(cap.used, 0);
    } finally {
      if (original) require.cache[storagePath] = original; else delete require.cache[storagePath];
    }
  });

  await ta('image spend does not consume the video budget', async () => {
    const storagePath = require.resolve('../../_utils/companyStorage');
    const original = require.cache[storagePath];
    const today = new Date().toISOString();
    const rows = Array.from({ length: 50 }, () => ({ caller: 'image-engine:heartbeat', timestamp: today }));
    require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true,
      exports: { getState: async () => rows } };
    try {
      const cap = await ve.checkDailyCap();
      assert.strictEqual(cap.used, 0, 'only video-engine rows count toward the video cap');
      assert.strictEqual(cap.allowed, true);
    } finally {
      if (original) require.cache[storagePath] = original; else delete require.cache[storagePath];
    }
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
