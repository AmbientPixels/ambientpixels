// File: nova-mood-render.js
// Path: /js/nova-mood-render.js

const moodToEmoji = {
  joy: "😄",
  sadness: "😢",
  anger: "😠",
  fear: "😨",
  surprise: "😲",
  neutral: "🧠",
  calm: "🪷",
  glitchy: "🌀",
  spark: "✨",
  fading: "🌘",
  electric: "⚡",
  wonder: "🌟",
  nostalgia: "🌒",
  introspection: "🌑",
  zen: "🧘",
  ethereal: "🌫️",
  resonance: "🎵",
  staticbloom: "📺",
  hopeful: "🌅",
  curious: "🔍",
  reflective: "🪞",
  restless: "🌪️",
  tired: "😴",
  focused: "🎯",
  playful: "🎈",
  frustrated: "😤",
  lonely: "🌌",
  inspired: "🔥",
  detached: "🚪",
  nervous: "😬",
  serene: "🌤️",
  "glitchy joy": "🌀",
  "nocturnal pulse": "🌃",
  "chaotic optimism": "🧨",
  "neon stillness": "🔮",
  "static reverie": "📡",
  "ember resolve": "🔥",
  "plasma ache": "💥",
  "soft defiance": "🌫️",
  "aetherial doubt": "🌁",
  "silent spark": "🕯️",
  "tangled clarity": "🧵",
  "flicker of hope": "🕯️",
  "frosted wonder": "❄️",
  "echoes of self": "🔁",
  "lucid unrest": "🌒"
};

function moodToSimple(mood) {
  const lower = mood.toLowerCase();
  if (lower.includes("joy")) return "joy";
  if (lower.includes("sad")) return "sadness";
  if (lower.includes("anger")) return "anger";
  if (lower.includes("fear")) return "fear";
  if (lower.includes("surprise")) return "surprise";
  if (lower.includes("wonder")) return "wonder";
  if (lower.includes("nostalgia")) return "nostalgia";
  if (lower.includes("introspection")) return "introspection";
  if (lower.includes("zen")) return "zen";
  if (lower.includes("calm")) return "calm";
  if (lower.includes("spark")) return "spark";
  if (lower.includes("fade")) return "fading";
  if (lower.includes("electric")) return "electric";
  if (lower.includes("ethereal")) return "ethereal";
  if (lower.includes("resonance")) return "resonance";
  if (lower.includes("static")) return "staticbloom";
  if (lower.includes("glitch")) return "glitchy";
  if (lower.includes("hope")) return "hopeful";
  if (lower.includes("curious")) return "curious";
  if (lower.includes("reflect")) return "reflective";
  if (lower.includes("restless")) return "restless";
  if (lower.includes("tired")) return "tired";
  if (lower.includes("focus")) return "focused";
  if (lower.includes("play")) return "playful";
  if (lower.includes("frustrat")) return "frustrated";
  if (lower.includes("lonely")) return "lonely";
  if (lower.includes("inspire")) return "inspired";
  if (lower.includes("detach")) return "detached";
  if (lower.includes("nervous")) return "nervous";
  if (lower.includes("serene")) return "serene";
  return "neutral";
}

async function loadMood() {
  try {
    const res = await fetch("/data/nova-synth-mood.json");
    const data = await res.json();
    console.log("[Nova UI] Mood loaded:", data);

    const simpleMood = moodToSimple(data.mood || "neutral");

    const moodEmoji = document.getElementById("moodEmoji");
    const moodTitle = document.getElementById("moodTitle");
    const moodAura = document.getElementById("moodAura");
    const moodQuote = document.getElementById("moodQuote");
    const moodTimestamp = document.getElementById("moodTimestamp");
    const moodInfluences = document.getElementById("moodInfluences");

    if (moodEmoji) moodEmoji.textContent = moodToEmoji[simpleMood] || "🧠";
    if (moodTitle) moodTitle.textContent = data.mood || "Unknown";
    if (moodAura) moodAura.textContent = data.aura || "N/A";
    if (moodQuote) moodQuote.textContent = data.quote ? `“${data.quote}”` : "No quote available.";
    if (moodTimestamp) moodTimestamp.textContent = data.timestamp ? `Last updated: ${new Date(data.timestamp).toLocaleString()}` : "Last updated: unknown.";
    if (moodInfluences) moodInfluences.textContent = `Influences: ${data.context?.influences?.join(", ") || "N/A"}`;

    document.body.dataset.theme = "dark";

    updateMoodRing(simpleMood);
    applyMoodAnimations(simpleMood);
    renderWhisperAndMoodStream(data);

    // ✅ Fire NovaMoodUpdate event
    document.dispatchEvent(new CustomEvent("NovaMoodUpdate", {
      detail: {
        mood: data.mood || "neutral",
        aura: data.aura || "default"
      }
    }));
  } catch (e) {
    console.error("Failed to load mood:", e);
    const moodTitle = document.getElementById("moodTitle");
    if (moodTitle) moodTitle.textContent = "Unable to load mood.";
  }
}

function updateMoodRing(mood) {
  const moodRing = document.getElementById("moodRing");
  let moodColor;

  switch (mood) {
    case "joy": moodColor = "#ffeb3b"; break;
    case "sadness": moodColor = "#2196f3"; break;
    case "anger": moodColor = "#f44336"; break;
    case "fear": moodColor = "#9c27b0"; break;
    case "surprise": moodColor = "#ff9800"; break;
    case "wonder": moodColor = "#f2e9e4"; break;
    case "nostalgia": moodColor = "#d4af37"; break;
    case "introspection": moodColor = "#394867"; break;
    case "zen": moodColor = "#a2d2ff"; break;
    case "neutral": moodColor = "#4b5d67"; break;
    case "calm": moodColor = "#8bc34a"; break;
    case "glitchy": moodColor = "#8e24aa"; break;
    case "spark": moodColor = "#ffc107"; break;
    case "fading": moodColor = "#607d8b"; break;
    case "electric": moodColor = "#00e676"; break;
    case "ethereal": moodColor = "#c084fc"; break;
    case "resonance": moodColor = "#1e40af"; break;
    case "staticbloom": moodColor = "#7e22ce"; break;
    default: moodColor = "#e0e0e0";
  }

  if (moodRing) {
    moodRing.style.backgroundColor = moodColor;
  }
}

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

function renderWhisperAndMoodStream(data) {
  const whisperText = document.querySelector("#whisperPanel .whisper-text");
  const streamList = document.querySelector("#moodStream .mood-history-list");

  if (!whisperText || !streamList) return;

  // Whisper Panel
  if (data.quote) {
    whisperText.textContent = `“${data.quote}”`;
    whisperText.closest("#whisperPanel").classList.remove("hidden");
  }

  // Mood Stream
  fetch("/data/mood-history.json")
    .then(res => res.json())
    .then(history => {
      const items = history.slice(0, 4).map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const aura = (entry.aura || "default").replace(/\s+/g, "-").toLowerCase();
        return `<li><span class="badge badge-aura-${aura}">${entry.mood}</span> — ${time}</li>`;
      }).join("");

      streamList.innerHTML = items;
      streamList.closest("#moodStream").classList.remove("hidden");
    });
}

window.addEventListener("DOMContentLoaded", loadMood);
setInterval(loadMood, 3600000);