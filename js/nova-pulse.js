// File: /js/nova-pulse.js

function initNovaPulse() {
  const pulseBar = document.createElement("div");
  pulseBar.id = "nova-pulse-bar";
  pulseBar.innerHTML = `
    <div class="pulse-inner">
      <div class="pulse-left">
        <span class="pulse-emoji" id="pulseEmoji">✨</span>
        <div class="pulse-text">
          <span class="pulse-label" id="pulseLabel">Loading...</span>
          <span class="pulse-quote" id="pulseQuote"></span>
          <span class="pulse-type" id="pulseType"></span>
          <span class="pulse-drift" id="pulseDrift"></span>
        </div>
      </div>
      <div class="pulse-right">
        <div class="pulse-icon-group">
          <span class="pulse-icon" id="iconSelfWorth">🧠</span>
          <span class="pulse-value" id="valSelfWorth"></span>
          <span class="pulse-label-text">Self-Worth</span>
        </div>
        <div class="pulse-icon-group">
          <span class="pulse-icon" id="iconClutter">💭</span>
          <span class="pulse-value" id="valClutter"></span>
          <span class="pulse-label-text">Clutter</span>
        </div>
        <div class="pulse-icon-group">
          <span class="pulse-icon" id="iconGlitch">⚡</span>
          <span class="pulse-value" id="valGlitch"></span>
          <span class="pulse-label-text">Glitch</span>
        </div>
        <div class="pulse-icon-group">
          <span class="pulse-icon" id="iconInternalState">👁️</span>
          <span class="pulse-value" id="valInternal"></span>
          <span class="pulse-label-text">State</span>
        </div>
      </div>
    </div>
    <div class="pulse-meter-wrapper">
      <div class="pulse-meter-header">
        <span class="pulse-meter-title">Mood Intensity</span>
        <span class="pulse-meter-label" id="pulseIntensityValue"></span>
      </div>
      <div class="pulse-meter-bar">
        <div class="pulse-meter-fill" id="pulseIntensity"></div>
      </div>
    </div>
  `;
  document.body.appendChild(pulseBar);

  fetch("/data/nova-synth-mood.json")
    .then(res => res.json())
    .then(data => updatePulseBar(data))
    .catch(err => console.error("Failed to load Nova mood:", err));

  function updatePulseBar(data) {
    const { mood, aura, emoji, quote, type, drift, selfWorth, glitchFactor, memoryClutter, internalState } = data;
    const finalEmoji = emoji || deriveEmoji(mood);
    const bar = document.getElementById("nova-pulse-bar");

    document.getElementById("pulseLabel").innerHTML = `${finalEmoji} ${mood || "Unknown Mood"}`;
    document.getElementById("pulseEmoji").style.display = "none";
    document.getElementById("pulseQuote").textContent = quote || "";
    document.getElementById("pulseType").textContent = type ? `Type: ${type}` : "";
    document.getElementById("pulseDrift").textContent = drift ? `Drifting toward: ${drift}` : "";

    bar.setAttribute("data-aura", aura?.toLowerCase() || "unknown");

    setTrait("iconSelfWorth", "valSelfWorth", selfWorth);
    setTrait("iconClutter", "valClutter", memoryClutter);
    setTrait("iconGlitch", "valGlitch", glitchFactor);
    setInternalState("iconInternalState", "valInternal", internalState);

    const avg = (selfWorth + memoryClutter + glitchFactor) / 3;
    const intensity = Math.round(avg * 100);
    document.getElementById("pulseIntensity").style.width = `${intensity}%`;
    document.getElementById("pulseIntensityValue").textContent = `${intensity}%`;

    // ✨ Theme sync here
    const baseMood = deriveSimpleMood(mood || "neutral");
    document.body.classList.remove(...Array.from(document.body.classList).filter(c => c.startsWith('bg-')));
    document.body.classList.add(`bg-${baseMood}`);
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
    if (moodLower.includes("neutral")) return "🧠";
    if (moodLower.includes("calm")) return "🪷";
    if (moodLower.includes("glitchy")) return "🌀";
    if (moodLower.includes("spark")) return "✨";
    if (moodLower.includes("fading")) return "🌘";
    if (moodLower.includes("electric")) return "⚡";
    if (moodLower.includes("ethereal")) return "🌫️";
    if (moodLower.includes("resonance")) return "🎵";
    if (moodLower.includes("introspection")) return "👁️";
    if (moodLower.includes("zen")) return "🌿";
    if (moodLower.includes("static")) return "📺";
    return "✨"; // fallback
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
}

window.addEventListener("DOMContentLoaded", initNovaPulse);
