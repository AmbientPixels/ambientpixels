// \js\mood-dashboard.js - Enhanced for mobile nav with overlay
const moodToColor = {
  joy: "#f9d923",
  sadness: "#3f51b5",
  anger: "#f44336",
  fear: "#9c27b0",
  surprise: "#ff9800",
  disgust: "#4caf50",
  neutral: "#9e9e9e",
  calm: "#00bcd4",
  glitchy: "#8e24aa",
  spark: "#ffc107",
  fading: "#607d8b",
  electric: "#00e676"
};

const moodToEmoji = {
  joy: "😄",
  sadness: "😢",
  anger: "😠",
  fear: "😨",
  surprise: "😲",
  disgust: "🤢",
  neutral: "🧠",
  calm: "🪷",
  glitchy: "🌀",
  spark: "✨",
  fading: "🌘",
  electric: "⚡"
};

let moodData = {
  mood: "calm",
  aura: "silver shimmer",
  influences: ["Weather", "API Health", "GitHub Status"],
  timestamp: new Date().toISOString(),
  nextUpdate: new Date(Date.now() + 60 * 60 * 1000)
};

function updateMoodDisplay() {
  const mood = moodData.mood.toLowerCase();
  const emoji = moodToEmoji[mood] || "🤖";
  const auraClass = "aura-" + moodData.aura.replace(/\s+/g, "-").toLowerCase();

  // ✅ Clean up existing aura-* classes only
  document.body.className = document.body.className
    .split(" ")
    .filter(cls => !cls.startsWith("aura-"))
    .join(" ")
    .trim();

  document.body.classList.add(auraClass);
  document.body.dataset.theme = "dark";

  // ✅ DOM updates (safe if elements exist)
  const moodStatus = document.getElementById("moodStatus");
  const moodHeart = document.getElementById("moodHeart");
  const moodRing = document.getElementById("moodRing");
  const nextUpdateTime = document.getElementById("nextUpdateTime");
  const moodInfluences = document.getElementById("moodInfluences");

  if (moodStatus) moodStatus.textContent = mood;
  if (moodHeart) moodHeart.textContent = emoji;
  if (moodRing) moodRing.style.backgroundColor = moodToColor[mood] || "#999";

  const timeRemaining = (moodData.nextUpdate - Date.now()) / 1000;
  if (nextUpdateTime) {
    nextUpdateTime.textContent = `Next update in ${Math.floor(timeRemaining / 60)} min`;
  }

  if (moodInfluences) {
    moodInfluences.innerHTML = moodData.influences
      .map(inf => `<li>${inf}</li>`)
      .join("");
  }

  // ✅ Update Chart.js graph
  const graph = document.getElementById("moodGraph");
  if (graph) {
    graph.innerHTML = "<canvas id='moodGraphCanvas'></canvas>";
    const ctx = document.getElementById("moodGraphCanvas").getContext("2d");

    new Chart(ctx, {
      type: "line",
      data: {
        labels: ["5 AM", "12 PM", "6 PM"],
        datasets: [{
          label: "Mood over 24 hours",
          data: [1, 2, 3], // Placeholder
          borderColor: moodToColor[mood],
          fill: false,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }
}

// ✅ Mood Mode Toggles
document.getElementById("stealthButton").addEventListener("click", () => {
  document.body.classList.toggle("stealth");
  document.body.classList.remove("emoji-only");
});
document.getElementById("verboseButton").addEventListener("click", () => {
  document.body.classList.remove("stealth", "emoji-only");
});
document.getElementById("emojiButton").addEventListener("click", () => {
  document.body.classList.toggle("emoji-only");
  document.body.classList.remove("stealth");
});

// ✅ Initial load + hourly refresh
updateMoodDisplay();
setInterval(() => {
  moodData.nextUpdate = new Date(Date.now() + 60 * 60 * 1000);
  updateMoodDisplay();
}, 60 * 60 * 1000);
