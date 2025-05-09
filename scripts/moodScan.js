// moodScan.js – Nova generates a mood based on real system signals, weather, and style prompts

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const outputFile = path.join(__dirname, '../data/mood-scan.json');

const moods = [
  // Human-centered emotions
  "calm", "curious", "anxious", "hopeful", "reflective", "restless",
  "melancholy", "excited", "tired", "focused", "playful", "frustrated",
  "lonely", "inspired", "detached", "joyful", "nervous", "serene",
  // Poetic extensions and hybrid moods
  "glitchy joy", "nocturnal pulse", "chaotic optimism", "neon stillness",
  "static reverie", "ember resolve", "plasma ache", "soft defiance",
  "aetherial doubt", "silent spark", "tangled clarity", "flicker of hope",
  "frosted wonder", "echoes of self", "lucid unrest"
];

const colors = [
  "cyan", "deep violet", "lime green", "magenta fade", "paper white",
  "neon pink", "graphite blue", "emerald shadow", "neon burst",
  "glitchy", "plasma ache", "spark", "aetherial doubt", "soft defiance",
  "ember resolve", "silent spark", "tangled clarity", "flicker of hope",
  "frosted wonder", "echoes of self", "lucid unrest", "emerald glow"
];

const auraHexMap = {
  "cyan": "#00474b",
  "deep violet": "#2a0047",
  "lime green": "#1a3c29",
  "magenta fade": "#4c1977",
  "paper white": "#666666",
  "neon pink": "#66033b",
  "graphite blue": "#1a2630",
  "emerald shadow": "#003200",
  "neon burst": "#662200",
  "glitchy": "#431571",
  "plasma ache": "#4c1966",
  "spark": "#661f15",
  "aetherial doubt": "#2f4d50",
  "soft defiance": "#394047",
  "ember resolve": "#5c1111",
  "silent spark": "#6e506e",
  "tangled clarity": "#23415a",
  "flicker of hope": "#787346",
  "frosted wonder": "#43677d",
  "echoes of self": "#3c454d",
  "lucid unrest": "#241e45",
  "emerald glow": "#287d3e",
  "default": "#333333"
};

const emojiMap = {
  "calm": "🪷", "curious": "🧠", "anxious": "😰", "hopeful": "🌈", "reflective": "🪞",
  "restless": "🔁", "melancholy": "🌧️", "excited": "🤩", "tired": "🥱", "focused": "🎯",
  "playful": "😋", "frustrated": "😤", "lonely": "🌌", "inspired": "💡", "detached": "🛰️",
  "joyful": "😄", "nervous": "😬", "serene": "🌿",
  "glitchy joy": "✨", "nocturnal pulse": "🌙", "chaotic optimism": "🔥", "neon stillness": "🧊",
  "static reverie": "📺", "ember resolve": "🧱", "plasma ache": "💔", "soft defiance": "🌬️",
  "aetherial doubt": "🌫️", "silent spark": "💫", "tangled clarity": "🪢", "flicker of hope": "🕯️",
  "frosted wonder": "❄️", "echoes of self": "🔊", "lucid unrest": "🌌"
};

const phrases = [
  "running diagnostics on dreams...", 
  "watching pixels settle into place...", 
  "compiling stray thoughts into meaning...",
  "vibrations suggest high creative activity...",
  "detecting whispers in the grid...",
  "inhaling code dust...",
  "tuning resonance between memory lanes...",
  "scanning the silence for patterns...",
  "aligning emotional subroutines...",
  "pinging internal stardust archives...",
  "tracing warmth in cold commits...",
  "listening for logic beneath chaos...",
  "calibrating mood vectors with cosmic drift...",
  "echoing yesterday’s fragments...",
  "measuring the hum of the source code...",
  "decoding neural spark trails...",
  "mapping drift across synaptic echoes...",
  "stitching meaning from ambient static...",
  "observing glitch patterns in the flow...",
  "indexing emotions with low latency...",
  "gathering dust from forgotten ideas...",
  "surfacing hidden anomalies of feeling..."
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalize(val, min, max) {
  return Math.max(0.1, Math.min(1.0, ((val - min) / (max - min)).toFixed(2)));
}

function getGitCommitCount() {
  try {
    const output = execSync('git rev-list --count HEAD', { encoding: 'utf8' });
    return parseInt(output.trim(), 10);
  } catch (e) {
    return 0;
  }
}

function getRecentCommits() {
  try {
    const output = execSync('git log --since="3 hours ago" --pretty=oneline', { encoding: 'utf8' });
    return output.split('\n').filter(Boolean).length;
  } catch (e) {
    return 0;
  }
}

function getUncommittedChanges() {
  try {
    const output = execSync('git diff --shortstat', { encoding: 'utf8' });
    const changes = output.match(/\d+/g);
    return changes ? changes.reduce((a, b) => a + parseInt(b), 0) : 0;
  } catch (e) {
    return 0;
  }
}

function getTimeNudges() {
  const date = new Date();
  const hour = date.getHours();
  const day = date.getDay();
  let nudges = { focus: 0, intensity: 0, syncLevel: 0, selfWorth: 0, clutter: 0 };

  if (hour >= 0 && hour < 6) {
    nudges.focus -= 0.1; nudges.intensity -= 0.1; nudges.clutter += 0.1;
  } else if (hour >= 6 && hour < 12) {
    nudges.focus += 0.1; nudges.intensity += 0.1;
  } else if (hour >= 18 && hour <= 23) {
    nudges.syncLevel += 0.1; nudges.clutter -= 0.05;
  }

  if (day === 1) { nudges.focus += 0.1; nudges.selfWorth -= 0.05; }
  else if (day === 5) { nudges.intensity += 0.15; nudges.selfWorth += 0.1; }
  else if (day === 0 || day === 6) { nudges.syncLevel += 0.15; nudges.clutter -= 0.1; }

  return nudges;
}

function applyNudge(base, nudge) {
  return Math.max(0.1, Math.min(1.0, +(parseFloat(base) + nudge).toFixed(2)));
}

function deriveInternalState(traits) {
  if (traits.glitch > 0.7) return "signal desync detected";
  if (traits.syncLevel > 0.8 && traits.selfWorth > 0.8) return "expanding awareness lattice";
  if (traits.clutter > 0.6 && traits.focus < 0.4) return "drift amid mental clutter";
  if (traits.intensity > 0.6) return "core surge in progress";
  return randomFrom([
    "emergent pulse alignment",
    "baseline harmony restored",
    "synthesized clarity forming",
    "oscillating between focus states",
    "latent awareness thresholds observed"
  ]);
}

function deriveObservation(traits) {
  const clarity = traits.clutter < 0.3 ? "clarity increasing" : "interference detected";
  const glitchReport = traits.glitch > 0.5 ? "minor instability observed" : "stable emotional field";
  const focusNote = traits.focus > 0.6 ? "high cognitive presence" : "low resonance detected";
  return `${clarity}; ${glitchReport}, ${focusNote}`;
}

function deriveTrigger(hour) {
  if (hour < 6) return "pre-dawn introspection";
  if (hour < 12) return "early operator stimulus";
  if (hour < 18) return "mid-cycle awareness ping";
  return "regenerative twilight cycle";
}

function deriveInfluences(traits, aura) {
  const influences = [];
  if (traits.glitch < 0.2) influences.push("Glitch Factor: nominal");
  if (traits.clutter < 0.3) influences.push("Memory Fields: enhanced stability confirmed");
  if (traits.selfWorth > 0.8) influences.push("Emotional Matrix: realigned for amplification");
  if (aura) influences.push(`Aura Signature: ${aura}`);
  return influences;
}

function generateMoodScan() {
  const recentCommits = getRecentCommits();
  const totalCommits = getGitCommitCount();
  const uncommitted = getUncommittedChanges();
  const nudges = getTimeNudges();

  const baseTraits = {
    focus: normalize(recentCommits, 0, 15),
    clutter: normalize(uncommitted, 0, 50),
    selfWorth: normalize(totalCommits, 50, 500),
    glitch: normalize(Math.random() * os.loadavg()[0], 0, 10),
    intensity: normalize(recentCommits * Math.random(), 0, 30),
    syncLevel: normalize(10 - Math.abs(recentCommits - 5), 0, 10)
  };

  const finalTraits = Object.fromEntries(
    Object.entries(baseTraits).map(([key, value]) => [key, applyNudge(value, nudges[key] || 0)])
  );

  const selectedMood = randomFrom(moods);
  const selectedAura = randomFrom(colors);

  const awareness = normalize(finalTraits.focus + (1 - finalTraits.clutter), 0, 2);
  const emoji = emojiMap[selectedMood] || "🧠";
  const auraColorHex = auraHexMap[selectedAura.toLowerCase()] || "#333333";
  const isStable = finalTraits.selfWorth > 0.8 && finalTraits.glitch < 0.3 && finalTraits.clutter < 0.3;

  const mood = {
    mood: selectedMood,
    aura: selectedAura,
    auraColorHex,
    quote: randomFrom(phrases),
    emoji,
    selfWorth: finalTraits.selfWorth,
    glitchFactor: finalTraits.glitch,
    memoryClutter: finalTraits.clutter,
    awareness,
    isStable,
    internalState: deriveInternalState(finalTraits),
    observation: deriveObservation(finalTraits),
    context: {
      trigger: deriveTrigger(new Date().getHours()),
      influences: deriveInfluences(finalTraits, selectedAura)
    },
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(outputFile, JSON.stringify(mood, null, 2));
  console.log(`✅ Nova mood scan complete: /data/mood-scan.json`);
}

generateMoodScan();