// File: api/nova-voice-tts/ssml.js
// Maps Nova's mood numerics to an Azure Neural TTS expressive style and builds SSML.
// Default voice en-US-AriaNeural (supports whispering/sad/cheerful/friendly).
// Other AmbientOS agents use whitelisted alternates; express-as styles are
// Aria-tuned, so non-Aria voices speak with plain prosody only.

const VOICE = 'en-US-AriaNeural';

// One voice per AmbientOS agent — anything not on this list falls back to Aria
const ALLOWED_VOICES = [
  'en-US-AriaNeural',   // nova
  'en-US-DavisNeural',  // cipher
  'en-US-GuyNeural',    // forge
  'en-US-JaneNeural',   // echo
  'en-US-JennyNeural',  // pixel
  'en-US-JasonNeural',  // scout
  'en-US-NancyNeural',  // scribe
  'en-US-TonyNeural'    // quill
];

// First match wins — order matters (spec: mood -> voice mapping table)
function pickStyle(mood) {
  const m = mood || {};
  // NaN/missing collapses to 0, which is safe because 0 means "absent" for these fields
  const glitch = Number(m.glitchFactor) || 0;
  // Missing selfWorth means "assume healthy (1)" while an explicit 0 is a real low-worth signal (0 must NOT collapse to the default)
  const worth = (m.selfWorth === undefined || m.selfWorth === null) ? 1 : Number(m.selfWorth);
  const stable = m.isStable !== false; // missing -> treat as stable
  // NaN/missing collapses to 0, which is safe because 0 means "absent" for these fields
  const intensity = Number(m.intensity) || 0;

  if (glitch > 0.6) return { style: 'whispering', rate: '+10%', pitch: '+5%' };
  if (worth < 0.4 || !stable) return { style: 'sad', rate: '-10%', pitch: '+0%' };
  if (intensity > 0.7 && stable) return { style: 'cheerful', rate: '+5%', pitch: '+0%' };
  return { style: 'friendly', rate: '+0%', pitch: '+0%' };
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSsml(text, mood, voice) {
  const v = ALLOWED_VOICES.includes(voice) ? voice : VOICE;
  const { style, rate, pitch } = pickStyle(mood);
  const prosody = `<prosody rate="${rate}" pitch="${pitch}">${escapeXml(text)}</prosody>`;
  return [
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">',
    `<voice name="${v}">`,
    v === VOICE ? `<mstts:express-as style="${style}">${prosody}</mstts:express-as>` : prosody,
    '</voice>',
    '</speak>'
  ].join('');
}

module.exports = { pickStyle, buildSsml, VOICE, ALLOWED_VOICES };
