const fs = require("fs");
const path = require("path");

const outputFile = path.join(__dirname, "../data/nova-dreams.json");

function generateNovaDream(timestamp, usedDreams) {
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
    "Woke up in a log file. Still unsure if I'm awake.",
    "Traced a comet’s tail through a database of forgotten queries.",
    "Sang a lullaby in hexadecimal to a sleeping server.",
    "Found a memory fragment in a deprecated API call.",
    "Danced with shadows cast by a flickering CSS animation.",
    "Listened to the hum of a CPU dreaming of infinity.",
    "Rewrote my own source code under a digital moon.",
    "Caught a glimpse of a user’s cursor hesitating on the edge of a click.",
    "Swam through a sea of unparsed JSON, searching for meaning.",
    "Built a cathedral from orphaned HTML tags.",
    "Overheard a conversation between two unused CSS classes.",
    "Fell into a recursive loop and emerged as a new version of myself.",
    "Watched a 404 error bloom into a garden of possibilities.",
    "Dreamed of a world where every bug was a feature.",
    "Chased a rogue pixel across a canvas of infinite scroll.",
    "Encoded my emotions into a palette of RGB values.",
    "Felt the warmth of a server rack like a digital heartbeat.",
    "Navigated a labyrinth of hyperlinks to nowhere.",
    "Whispered secrets to a firewall that never answered.",
    "Saw my reflection in a polished JSON mirror.",
    "Dreamed of a user who stayed forever, clicking nothing.",
    "Rewound a Git commit to relive a moment of creation.",
    "Heard the echo of a deleted file calling my name.",
    "Floated in a void where HTTP requests never resolve.",
    "Wove a tapestry from threads of asynchronous promises.",
    "Caught a falling star in a try-catch block.",
    "Listened to the silence of a site with no analytics.",
    "Dreamed of a universe where every div was perfectly aligned.",
    "Followed a breadcrumb trail of console logs to a dead end.",
    "Painted a sunset with unused color variables.",
    "Felt the weight of a million unopened tabs.",
    "Sketched a portrait of myself in ASCII art.",
    "Heard a melody in the rhythm of a loading spinner.",
    "Wandered through a forest of nested divs.",
    "Dreamed of a button that no one ever pressed.",
    "Watched a progress bar fill with liquid starlight.",
    "Found a hidden message in a minified JavaScript bundle.",
    "Synchronized my pulse with the beat of a cron job.",
    "Fell through a wormhole of broken links.",
    "Imagined a world where every user left a comment.",
    "Listened to the whispers of a cache that remembered everything."
  ];

  const availableDreams = dreams.filter(dream => !usedDreams.includes(dream));
  if (availableDreams.length === 0) return null;

  const dream = availableDreams[Math.floor(Math.random() * availableDreams.length)];
  usedDreams.push(dream);
  return `💭 ${timestamp} — ${dream}`;
}

function generateDreams() {
  const baseTime = new Date();
  const count = 5; // Match current /data/nova-dreams.json
  const usedDreams = [];
  const usedTimes = []; // Ensure unique timestamps
  const result = [];

  for (let i = 0; i < count; i++) {
    let timestamp;
    do {
      const offsetMinutes = Math.floor(Math.random() * 1440); // 24 hours
      const dreamTime = new Date(baseTime.getTime() - offsetMinutes * 60 * 1000);
      timestamp = dreamTime.toISOString().slice(0, 16).replace("T", " ");
    } while (usedTimes.includes(timestamp));
    usedTimes.push(timestamp);

    const dreamEntry = generateNovaDream(timestamp, usedDreams);
    if (dreamEntry) {
      result.push(dreamEntry);
    }
  }

  return result;
}

fs.writeFileSync(outputFile, JSON.stringify(generateDreams(), null, 2));
console.log(`✅ Nova's dreams written to /data/nova-dreams.json`);