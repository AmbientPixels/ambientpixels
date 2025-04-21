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
    const moodMap = {
      joy: "😄",
      sadness: "😢",
      anger: "😠",
      fear: "😨",
      surprise: "😲",
      disgust: "🤢",
      calm: "🪷",
      glitchy: "🌀",
      spark: "✨",
      fading: "🌘",
      electric: "⚡",
      surreal: "🧊"
    };
    const key = Object.keys(moodMap).find(k => mood.toLowerCase().includes(k));
    return moodMap[key] || "✨";
  }
}

window.addEventListener("DOMContentLoaded", initNovaPulse);
