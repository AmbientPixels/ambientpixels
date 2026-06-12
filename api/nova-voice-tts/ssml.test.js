// Run with: node api/nova-voice-tts/ssml.test.js
const assert = require('assert');
const { pickStyle, buildSsml } = require('./ssml');

// --- pickStyle: first match wins, per spec table ---
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.7, selfWorth: 0.2, isStable: false, intensity: 0.9 }),
  { style: 'whispering', rate: '+10%', pitch: '+5%' },
  'glitch beats everything'
);
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.1, selfWorth: 0.3, isStable: true, intensity: 0.9 }),
  { style: 'sad', rate: '-10%', pitch: '+0%' },
  'low selfWorth -> sad'
);
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.1, selfWorth: 0.8, isStable: false, intensity: 0.2 }),
  { style: 'sad', rate: '-10%', pitch: '+0%' },
  'unstable -> sad'
);
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.1, selfWorth: 0.8, isStable: true, intensity: 0.8 }),
  { style: 'cheerful', rate: '+5%', pitch: '+0%' },
  'high stable intensity -> cheerful'
);
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.1, selfWorth: 0.8, isStable: true, intensity: 0.5 }),
  { style: 'friendly', rate: '+0%', pitch: '+0%' },
  'default -> friendly'
);
assert.deepStrictEqual(
  pickStyle({}),
  { style: 'friendly', rate: '+0%', pitch: '+0%' },
  'missing fields -> safe default'
);
assert.deepStrictEqual(
  pickStyle(null),
  { style: 'friendly', rate: '+0%', pitch: '+0%' },
  'null mood -> safe default'
);
// selfWorth semantics: explicit 0 is a real low-worth signal -> sad
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.1, selfWorth: 0, isStable: true, intensity: 0.5 }),
  { style: 'sad', rate: '-10%', pitch: '+0%' },
  'selfWorth 0 -> sad'
);
// selfWorth semantics: null/unknown means assume healthy -> not sad
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.1, selfWorth: null, isStable: true, intensity: 0.5 }),
  { style: 'friendly', rate: '+0%', pitch: '+0%' },
  'selfWorth null -> healthy default'
);

// --- buildSsml: structure + XML escaping ---
const ssml = buildSsml('Hello <world> & "friends"', { intensity: 0.8, isStable: true, glitchFactor: 0, selfWorth: 0.8 });
assert.ok(ssml.includes('en-US-AriaNeural'), 'pinned voice');
assert.ok(ssml.includes('mstts:express-as style="cheerful"'), 'style applied');
assert.ok(ssml.includes('rate="+5%"'), 'prosody rate applied');
assert.ok(ssml.includes('pitch="+0%"'), 'prosody pitch applied');
assert.ok(ssml.includes('Hello &lt;world&gt; &amp; &quot;friends&quot;'), 'XML escaped');
assert.ok(!ssml.includes('<world>'), 'no raw angle brackets from input');

console.log('ssml.test.js: all assertions passed');
