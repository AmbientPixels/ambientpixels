// nova-mood-render.js — Full with Whisper Panel + Mood Stream (Aura badges enabled)

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
  staticbloom: "📺"
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
  return "neutral";
}

async function loadMood() {
  try {
    const res = await fetch("/data/nova-synth-mood.json");
    const data = await res.json();
    console.log("[Nova UI] Mood loaded:", data);

    const simpleMood = moodToSimple(data.mood || "neutral");

    document.getElementById("moodEmoji").textContent = moodToEmoji[simpleMood] || "🧠";
    document.getElementById("moodTitle").textContent = data.mood || "Unknown";
    document.getElementById("moodAura").textContent = data.aura || "N/A";
    document.getElementById("moodQuote").textContent = data.quote ? `“${data.quote}”` : "No quote available.";
    document.getElementById("moodTimestamp").textContent = data.timestamp ? `Last updated: ${new Date(data.timestamp).toLocaleString()}` : "Last updated: unknown.";
    document.getElementById("moodInfluences").textContent = `Influences: ${data.context?.influences?.join(", ") || "N/A"}`;

    document.body.className = document.body.className
      .split(" ")
      .filter(cls => !cls.startsWith("aura-"))
      .join(" ")
      .trim();

    const auraClass = "aura-" + (data.aura || "default").replace(/\s+/g, "-").toLowerCase();
    document.body.classList.add(auraClass);
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
    document.getElementById("moodTitle").textContent = "Unable to load mood.";
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
