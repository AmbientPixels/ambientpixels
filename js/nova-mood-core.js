document.body.classList.remove("bg-neutral");
// Color manipulation utilities
function lightenHex(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.floor((num >> 16) * (1 + amount)));
  const g = Math.min(255, Math.floor((num >> 8 & 0xFF) * (1 + amount)));
  const b = Math.min(255, Math.floor((num & 0xFF) * (1 + amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function darkenHex(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.floor((num >> 16) * (1 - amount)));
  const g = Math.max(0, Math.floor((num >> 8 & 0xFF) * (1 - amount)));
  const b = Math.max(0, Math.floor((num & 0xFF) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function isLightColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 186;
}

// Apply dynamic styling to mood-aware elements
function applyMoodStyling(element, auraColorHex) {
  if (!element) return;
  
  element.style.background = `linear-gradient(135deg, ${auraColorHex}, ${lightenHex(auraColorHex, 0.2)})`;
  element.style.border = `1px solid ${darkenHex(auraColorHex, 0.2)}`;
  element.style.color = isLightColor(auraColorHex) ? "#333" : "#fff";
  element.style.padding = "15px";
  element.style.borderRadius = "8px";
  element.style.boxShadow = `0 2px 4px rgba(0,0,0,0.1)`;
  element.style.transition = "all 0.3s ease";
}

// Handle NovaMoodUpdate events
document.addEventListener("NovaMoodUpdate", (e) => {
  const { auraColorHex = "#999999" } = e.detail || {};
  
  // Apply to all mood-aware elements
  document.querySelectorAll(".dynamic-mood").forEach(el => {
    applyMoodStyling(el, auraColorHex);
  });
});

document.addEventListener("DOMContentLoaded", () => {
  const driftEl = document.getElementById("nova-mood-drift");

  fetch("/data/mood-scan.json")
    .then(res => res.json())
    .then(data => {
      // 🧹 Clean up existing aura and bg classes
      document.body.className = document.body.className
        .split(" ")
        .filter(cls => !cls.startsWith("aura-") && !cls.startsWith("bg-") && cls !== "bg-neutral")
        .join(" ")
        .trim();

      // ✨ Apply aura class from mood scan
      const aura = data.aura?.toLowerCase().replace(/\s+/g, '-');
      if (aura) {

      }

      // 🎨 Apply mood-derived background
      const baseMood = deriveSimpleMood(data.mood || "neutral");
      document.body.classList.add(`bg-${baseMood}`);

      // 🧠 Dispatch NovaMoodUpdate event
      document.dispatchEvent(new CustomEvent("NovaMoodUpdate", {
        detail: {
          mood: data.mood || "neutral",
          aura: data.aura || "default",
          auraColorHex: data.auraColorHex || "#999999"
        }
      }));

      // 📡 Update drift panel
      if (driftEl) {
        driftEl.innerHTML = `
          🧠 Mood: <strong>${data.mood}</strong><br>
          ✨ Aura: <span>${data.aura}</span><br>
          💬 Quote: <em>"${data.quote}"</em><br>
          🔄 Drift Source: <span>${data.context?.trigger || "—"}</span><br>
          📡 Influences: <code>${(data.context?.influences || []).join(", ")}</code><br>
          🕒 Last Updated: <time datetime="${data.timestamp}">${new Date(data.timestamp).toLocaleString()}</time>
        `;
      }
    })
    .catch(err => {
      console.error("⚠️ Failed to load mood data:", err);
      if (driftEl) {
        driftEl.innerHTML = "🧠 Mood systems offline. No emotional data available.";
      }
    });

  function deriveSimpleMood(mood) {
    const lower = mood.toLowerCase();
    if (lower.includes("spark")) return "spark";
    if (lower.includes("joy")) return "joy";
    if (lower.includes("sad")) return "sadness";
    if (lower.includes("anger")) return "anger";
    if (lower.includes("fear")) return "fear";
    if (lower.includes("surprise")) return "surprise";
    if (lower.includes("wonder")) return "wonder";
    if (lower.includes("nostalgia")) return "nostalgia";
    if (lower.includes("calm")) return "calm";
    if (lower.includes("glitch") || lower.includes("fracture")) return "glitchy";
    if (lower.includes("fade")) return "fading";
    if (lower.includes("electric")) return "electric";
    if (lower.includes("ethereal")) return "ethereal";
    if (lower.includes("resonance")) return "resonance";
    if (lower.includes("introspection")) return "introspection";
    if (lower.includes("zen")) return "zen";
    return "neutral";
  }
});
