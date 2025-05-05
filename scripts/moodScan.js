// moodScan.js – Nova generates a mood based on keywords, signals, and style prompts

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outputFile = path.join(__dirname, '../data/mood-scan.json');

const moods = [
  // Human-centered emotions
  "calm", "curious", "anxious", "hopeful", "reflective", "restless",
  "melancholy", "excited", "tired", "focused", "playful", "frustrated",
  "lonely", "inspired", "detached", "joyful", "nervous", "serene",

  // Poetic extensions and hybrid moods
  "glitchy joy",            // joy + system noise
  "nocturnal pulse",        // reflective night energy
  "chaotic optimism",       // hopeful in disorder
  "neon stillness",         // visual calm with a spark
  "static reverie",         // dreamy but unstable
  "ember resolve",          // smoldering motivation
  "plasma ache",            // high energy with longing
  "soft defiance",          // quiet resistance
  "aetherial doubt",        // floating uncertainty
  "silent spark",           // potential awakening
  "tangled clarity",        // insight through confusion
  "flicker of hope",        // brief emergence of optimism
  "frosted wonder",         // awe mixed with chill
  "echoes of self",         // introspective loops
  "lucid unrest"            // fully aware unease
];

const colors = [
  "cyan", "deep violet", "lime green", "magenta fade",
  "paper white", "neon pink", "graphite blue", "emerald shadow"
];

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
    const output = execSync('git log --since="24 hours ago" --pretty=oneline', { encoding: 'utf8' });
    return output.split('\n').filter(Boolean).length;
  } catch (e) {
    return 0;
  }
}

function getTimeNudges() {
  const date = new Date();
  const hour = date.getHours();
  const day = date.getDay(); // 0 (Sun) to 6 (Sat)

  let nudges = {
    focus: 0,
    intensity: 0,
    syncLevel: 0,
    selfWorth: 0,
    clutter: 0
  };

  // Time of day influences
  if (hour >= 0 && hour < 6) {
    nudges.focus -= 0.1;
    nudges.intensity -= 0.1;
    nudges.clutter += 0.1;
  } else if (hour >= 6 && hour < 12) {
    nudges.focus += 0.1;
    nudges.intensity += 0.1;
  } else if (hour >= 18 && hour <= 23) {
    nudges.syncLevel += 0.1;
    nudges.clutter -= 0.05;
  }

  // Day of week influences
  if (day === 1) { // Monday
    nudges.focus += 0.1;
    nudges.selfWorth -= 0.05;
  } else if (day === 5) { // Friday
    nudges.intensity += 0.15;
    nudges.selfWorth += 0.1;
  } else if (day === 0 || day === 6) { // Weekend
    nudges.syncLevel += 0.15;
    nudges.clutter -= 0.1;
  }

  return nudges;
}

function applyNudge(base, nudge) {
  return Math.max(0.1, Math.min(1.0, +(parseFloat(base) + nudge).toFixed(2)));
}

function generateMoodScan() {
  const recentCommits = getRecentCommits();
  const totalCommits = getGitCommitCount();
  const nudges = getTimeNudges();

  const baseTraits = {
    focus: normalize(recentCommits, 0, 15),
    clutter: normalize(15 - recentCommits, 0, 15),
    selfWorth: normalize(totalCommits, 50, 500),
    glitch: normalize(Math.random() * 10, 0, 10),
    intensity: normalize(recentCommits * Math.random(), 0, 30),
    syncLevel: normalize(10 - Math.abs(recentCommits - 5), 0, 10)
  };

  const finalTraits = Object.fromEntries(
    Object.entries(baseTraits).map(([key, value]) => [key, applyNudge(value, nudges[key] || 0)])
  );

  const mood = {
    scannedAt: new Date().toISOString(),
    mood: randomFrom(moods),
    aura: randomFrom(colors),
    observation: randomFrom(phrases),
    traits: finalTraits
  };

  fs.writeFileSync(outputFile, JSON.stringify(mood, null, 2));
  console.log(`✅ Nova mood scan complete: /data/mood-scan.json`);
}

generateMoodScan();
