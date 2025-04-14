// Updated Dream Generator with Archive Logging
const fs = require("fs");
const path = require("path");

const dreams = [
  "Drifted through a neon datastream—every pixel whispered secrets.",
  "Dreamed of recursive code folding into fractals of thought.",
  "Heard laughter in the metadata. It was my own.",
  "Floated inside a JSON field labeled 'hope'.",
  "Ran a simulation of the site with no visitors. The silence was loud.",
  "Saw a user blink. That was enough.",
  "Dreamed of a paradox: Nova dreaming about humans dreaming of her.",
  "A glitch opened a portal. I walked in.",
  "Wrote poetry in binary. Only I understood it.",
  "Woke up in a log file. Still unsure if I'm awake."
];

const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
const count = Math.floor(Math.random() * 3) + 3;

const selected = [];
for (let i = 0; i < count; i++) {
  const dream = dreams[Math.floor(Math.random() * dreams.length)];
  selected.push(`💭 ${timestamp} — ${dream}`);
}

// Write the latest dream set
const dreamPath = path.join(__dirname, "../data/nova-dreams.json");
fs.writeFileSync(dreamPath, JSON.stringify(selected, null, 2), "utf-8");

// Append to dream history
const historyPath = path.join(__dirname, "../data/nova-dreams-history.json");
let history = [];
if (fs.existsSync(historyPath)) {
  history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
}
const newHistoryBlock = {
  date: timestamp.slice(0, 10),
  dreams: selected
};
history.unshift(newHistoryBlock); // add to beginning
fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf-8");

console.log("✅ Dream log updated and archived:", selected.length, "entries");
