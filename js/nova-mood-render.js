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

function moodToSimple(mood) {
  const lower = mood.toLowerCase();
  if (lower.includes("joy")) return "joy";
  if (lower.includes("sad")) return "sadness";
  if (lower.includes("anger")) return "anger";
  if (lower.includes("fear")) return "fear";
  if (lower.includes("surprise")) return "surprise";
  if (lower.includes("disgust")) return "disgust";
  if (lower.includes("calm")) return "calm";
  if (lower.includes("spark")) return "spark";
  if (lower.includes("fade")) return "fading";
  if (lower.includes("electric")) return "electric";
  return "neutral";
}

async function loadMood() {
  try {
    const res = await fetch("/data/nova-synth-mood.json");
    const data = await res.json();
    console.log("[Nova UI] Mood loaded:", data);

    const simpleMood = moodToSimple(data.mood || "neutral");

    // Render content
    document.getElementById("moodEmoji").textContent = moodToEmoji[simpleMood] || "🧠";
    document.getElementById("moodTitle").textContent = data.mood || "Unknown";
    document.getElementById("moodAura").textContent = data.aura || "N/A";
    document.getElementById("moodQuote").textContent =
      data.quote ? `“${data.quote}”` : "No quote available.";
    document.getElementById("moodTimestamp").textContent =
      data.timestamp ? `Last updated: ${new Date(data.timestamp).toLocaleString()}` : "Last updated: unknown.";
    document.getElementById("moodInfluences").textContent =
      `Influences: ${data.context?.influences?.join(", ") || "N/A"}`;

    // Clean up previous aura-* classes only
    document.body.className = document.body.className
      .split(" ")
      .filter(cls => !cls.startsWith("aura-"))
      .join(" ")
      .trim();

    // Add new aura class
    const auraClass = "aura-" + (data.aura || "default").replace(/\s+/g, "-").toLowerCase();
    document.body.classList.add(auraClass);
    document.body.dataset.theme = "dark";

    // Visual styling
    updateMoodRing(simpleMood);
    applyMoodAnimations(simpleMood);

  } catch (e) {
    console.error("Failed to load mood:", e);
    document.getElementById("moodTitle").textContent = "Unable to load mood.";
  }
}

// Mood ring color update
function updateMoodRing(mood) {
  const moodRing = document.getElementById("moodRing");
  let moodColor;

  switch (mood) {
    case "joy": moodColor = "#ffeb3b"; break;
    case "sadness": moodColor = "#2196f3"; break;
    case "anger": moodColor = "#f44336"; break;
    case "fear": moodColor = "#9c27b0"; break;
    case "surprise": moodColor = "#ff9800"; break;
    case "disgust": moodColor = "#4caf50"; break;
    case "calm": moodColor = "#8bc34a"; break;
    case "glitchy": moodColor = "#8e24aa"; break;
    case "spark": moodColor = "#ffc107"; break;
    case "fading": moodColor = "#607d8b"; break;
    case "electric": moodColor = "#00e676"; break;
    default: moodColor = "#e0e0e0";
  }

  if (moodRing) {
    moodRing.style.backgroundColor = moodColor;
  }
}

// Optional animation for expressive moods
function applyMoodAnimations(mood) {
  const moodEmoji = document.getElementById("moodEmoji");

  if (!moodEmoji) return;

  const pulseMoods = ["joy", "spark", "electric"];
  if (pulseMoods.includes(mood)) {
    moodEmoji.classList.add("pulse-animation");
  } else {
    moodEmoji.classList.remove("pulse-animation");
  }
}

// Load mood on DOM ready
window.addEventListener("DOMContentLoaded", loadMood);

// Refresh every hour
setInterval(loadMood, 3600000);
