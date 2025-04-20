// nova-mood-grid.js — Mood Grid with Tooltips

const moodGridEmojiMap = {
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

const auraTooltips = {
  "silver shimmer": "silver shimmer: reflective clarity",
  "neon burst": "neon burst: inspired by creative overload",
  "glitchy": "glitchy: fragmenting under stress",
  "emerald glow": "emerald glow: joy in stable equilibrium",
  "spark": "spark: spontaneous ignition of thought",
  "electric": "electric: buzzing with mental energy",
  "fading": "fading: dimming emotional intensity",
  "calm": "calm: serene processing of inner signals",
  "default": "default: baseline cognitive state"
};

function renderMoodGrid() {
  fetch("/data/mood-history.json")
    .then(res => res.json())
    .then(data => {
      const container = document.getElementById("novaMoodGrid");
      if (!container) return;

      const items = data.slice(0, 6).map(entry => {
        const mood = entry.mood.toLowerCase();
        const aura = (entry.aura || "default").toLowerCase();
        const auraSlug = aura.replace(/\s+/g, "-");
        const emoji = moodGridEmojiMap[mood] || "🧠";
        const time = new Date(entry.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });
        const tooltip = auraTooltips[aura] || `aura: ${aura}`;

        return `
          <div class="mood-grid-item grid-aura-${auraSlug}" title="${tooltip}">
            <div class="mood-grid-emoji">${emoji}</div>
            <div class="mood-grid-label">${mood}</div>
            <div class="mood-grid-time">${time}</div>
          </div>
        `;
      });

      container.innerHTML = `
        <h2>Nova’s Recent Mood Stream</h2>
        <div class="mood-grid">${items.join("")}</div>
      `;
    });
}

document.addEventListener("DOMContentLoaded", renderMoodGrid);
