// File: /js/nova-pulse.js

function initNovaPulse() {
  const pulseBar = document.createElement("div");
  pulseBar.id = "nova-pulse-bar";

  const gridMain = document.querySelector("main.grid-container");

  fetch("/modules/nova-pulse.html")
    .then(res => res.text())
    .then(html => {
      pulseBar.innerHTML = html;
      if (gridMain) {
        gridMain.insertAdjacentElement('beforebegin', pulseBar);
      }
      // Initialize sticky toggle
      initStickyToggle();
      return fetch("/data/mood-scan.json");
    })
    .then(res => res.json())
    .then(data => updatePulseBar(data))
    .catch(err => console.error("Failed to load Nova Pulse module or mood:", err));

  function initStickyToggle() {
    const toggleWrapper = document.createElement("div");
    toggleWrapper.id = "sticky-toggle-wrapper";
    toggleWrapper.innerHTML = `
      <label id="sticky-toggle-label" for="sticky-toggle">Sticky</label>
      <input type="checkbox" id="sticky-toggle">
    `;
    document.getElementById("nova-pulse-inner").appendChild(toggleWrapper);

    const toggle = document.getElementById("sticky-toggle");
    toggle.addEventListener("change", () => {
      pulseBar.classList.toggle("sticky", toggle.checked);
    });
  }

  function updatePulseBar(data) {
    const { mood, aura, emoji, quote, selfWorth, glitchFactor, memoryClutter, internalState, auraColorHex } = data;

    const finalEmoji = emoji || deriveEmoji(mood);
    const bar = document.getElementById("nova-pulse-bar");

    if (document.getElementById("pulseEmoji")) document.getElementById("pulseEmoji").textContent = finalEmoji;
    if (document.getElementById("pulseLabel")) document.getElementById("pulseLabel").textContent = mood || "Unknown Mood";
    if (document.getElementById("pulseQuote") && quote) document.getElementById("pulseQuote").textContent = quote;

    const auraClass = `aura-bg-${(aura || "default").toLowerCase().replace(/\s+/g, "-")}`;
    document.body.classList.remove(...Array.from(document.body.classList).filter(c => c.startsWith('aura-bg-')));
    document.body.classList.add(auraClass);
    bar.setAttribute("data-aura", aura);

    const glowColors = {
      "glitchy": "rgba(100, 60, 140, 0.4)",
      "neon burst": "rgba(140, 70, 40, 0.4)",
      "calm": "rgba(60, 120, 80, 0.4)",
      "emerald glow": "rgba(70, 140, 90, 0.4)",
      "neon pink": "rgba(140, 40, 100, 0.4)",
      "cyan": "rgba(0, 100, 100, 0.4)",
      "deep violet": "rgba(100, 40, 140, 0.4)",
      "magenta fade": "rgba(120, 60, 160, 0.4)",
      "paper white": "rgba(100, 100, 100, 0.3)",
      "default": "rgba(255, 255, 255, 0.2)"
    };
    const glow = glowColors[aura?.toLowerCase()] || glowColors.default;
    bar.style.setProperty('--glow-color', glow);

    const auraColor = auraColorHex || "#666666";
    const auraLight = lightenHex(auraColor, 0.2);
    const auraDark = darkenHex(auraColor, 0.2);
    const textColor = isLightColor(auraColor) ? "#222" : "#fff";

    document.documentElement.style.setProperty("--aura-spine-bg", `linear-gradient(135deg, ${auraColor}, ${auraLight})`);
    document.documentElement.style.setProperty("--aura-spine-text", textColor);

    bar.style.borderTop = `1px solid ${auraDark}`;
    bar.style.borderBottom = `1px solid ${auraDark}`;
    bar.style.color = `var(--aura-spine-text)`;

    setTrait("iconSelfWorth", "valSelfWorth", selfWorth);
    setTrait("iconClutter", "valClutter", memoryClutter);
    setTrait("iconGlitch", "valGlitch", glitchFactor);
    setInternalState("iconInternalState", "valInternal", internalState);

    const avg = (selfWorth + memoryClutter + glitchFactor) / 3;
    const intensity = Math.round(avg * 100);
    if (document.getElementById("pulseIntensity")) {
      document.getElementById("pulseIntensity").style.width = `${intensity}%`;
    }
    if (document.getElementById("pulseIntensityValue")) {
      document.getElementById("pulseIntensityValue").textContent = `${intensity}%`;
    }

    const baseMood = deriveSimpleMood(mood || "neutral");
    document.body.classList.remove(...Array.from(document.body.classList).filter(c => c.startsWith('bg-')));
    document.body.classList.add(`bg-${baseMood}`);

    document.dispatchEvent(new CustomEvent("NovaMoodUpdate", {
      detail: { aura: auraClass, auraColorHex: auraColor }
    }));
  }

  function setTrait(iconId, valId, value) {
    const icon = document.getElementById(iconId);
    const val = document.getElementById(valId);
    if (!icon || !val || typeof value !== "number") return;
    val.textContent = `${Math.round(value * 100)}%`;
    icon.classList.remove("good", "warning", "critical");
    if (value < 0.33) icon.classList.add("good");
    else if (value < 0.66) icon.classList.add("warning");
    else icon.classList.add("critical");
  }

  function setInternalState(iconId, valId, state) {
    const icon = document.getElementById(iconId);
    const val = document.getElementById(valId);
    if (!icon || !val || !state) return;
    icon.title = `Internal State: ${state}`;
    val.textContent = state;
  }

  function deriveEmoji(mood) {
    if (!mood) return "✨";
    const moodLower = mood.toLowerCase();
    if (moodLower.includes("joy")) return "😄";
    if (moodLower.includes("sad")) return "😢";
    if (moodLower.includes("anger")) return "😠";
    if (moodLower.includes("fear")) return "😨";
    if (moodLower.includes("surprise")) return "😲";
    if (moodLower.includes("wonder")) return "✨";
    if (moodLower.includes("nostalgia")) return "🌒";
    if (moodLower.includes("neutral")) return "🧐";
    if (moodLower.includes("calm")) return "🩷";
    if (moodLower.includes("glitchy")) return "🌀";
    if (moodLower.includes("spark")) return "✨";
    if (moodLower.includes("fading")) return "🌘";
    if (moodLower.includes("electric")) return "⚡";
    if (moodLower.includes("ethereal")) return "🌫️";
    if (moodLower.includes("resonance")) return "🎵";
    if (moodLower.includes("introspection")) return "👁️";
    if (moodLower.includes("zen")) return "🌿";
    if (moodLower.includes("static")) return "📻";
    return "✨";
  }

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

  function lightenHex(hex, amount) {
    hex = hex.replace("#", "");
    const r = Math.min(255, parseInt(hex.slice(0, 2), 16) + Math.round(255 * amount));
    const g = Math.min(255, parseInt(hex.slice(2, 4), 16) + Math.round(255 * amount));
    const b = Math.min(255, parseInt(hex.slice(4, 6), 16) + Math.round(255 * amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  function darkenHex(hex, amount) {
    hex = hex.replace("#", "");
    const r = Math.max(0, parseInt(hex.slice(0, 2), 16) - Math.round(255 * amount));
    const g = Math.max(0, parseInt(hex.slice(2, 4), 16) - Math.round(255 * amount));
    const b = Math.max(0, parseInt(hex.slice(4, 6), 16) - Math.round(255 * amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  function isLightColor(hex) {
    hex = hex.replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128;
  }
}

window.addEventListener("DOMContentLoaded", initNovaPulse);