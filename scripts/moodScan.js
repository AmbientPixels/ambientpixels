// moodScan.js – Nova generates a mood based on keywords and style prompts

const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, '../data/mood-scan.json');

const moods = [
  "melancholy", "electric", "static-charged", "warm curiosity",
  "chaotic optimism", "focused zen", "quiet rebellion", "glitchy joy",
  "nocturnal pulse", "neon serenity"
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
  "inhaling code dust..."
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateMoodScan() {
  const mood = {
    scannedAt: new Date().toISOString(),
    mood: randomFrom(moods),
    aura: randomFrom(colors),
    observation: randomFrom(phrases)
  };
  fs.writeFileSync(outputFile, JSON.stringify(mood, null, 2));
  console.log(`✅ Nova mood scan complete: /data/mood-scan.json`);
}

generateMoodScan();

