// nova-mood-render.js

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
  
      const emojiKey = moodToSimple(data.mood);
      document.getElementById("moodEmoji").textContent = moodToEmoji[emojiKey] || "🧠";
      document.getElementById("moodTitle").textContent = data.mood;
      document.getElementById("moodAura").textContent = data.aura;
      document.getElementById("moodQuote").textContent = `“${data.quote}”`;
      document.getElementById("moodTimestamp").textContent = `Last updated: ${new Date(data.timestamp).toLocaleString()}`;
      document.getElementById("moodInfluences").textContent = `Influences: ${data.context?.influences?.join(", ") || "N/A"}`;
  
      // Remove old aura-* classes and apply new one
      document.body.className = document.body.className
        .split(' ')
        .filter(cls => !cls.startsWith('aura-'))
        .join(' ')
        .trim();
      document.body.classList.add(`aura-${data.aura.toLowerCase().replace(/\s+/g, '-')}`);
    } catch (e) {
      console.error("Failed to load mood:", e);
      document.getElementById("moodTitle").textContent = "Unable to load mood.";
    }
  }
  
  // Auto-load on page init
  window.addEventListener("DOMContentLoaded", loadMood);
  