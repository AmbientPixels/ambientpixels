// File: /js/nova-pulse.js
// Refactored for AI-persistent mood via NovaSoul with static fallback

function initNovaPulse() {
  const pulseBar = document.createElement("div");
  pulseBar.id = "nova-pulse-bar";
  let _aiMoodReceived = false;

  const gridMain = document.querySelector("main.grid-container");

  fetch("/modules/nova-pulse.html")
    .then(function (res) { return res.text(); })
    .then(function (html) {
      pulseBar.innerHTML = html;
      if (gridMain) {
        gridMain.insertAdjacentElement('beforebegin', pulseBar);
      }
      initStickyToggle();
      loadMoodData();
    })
    .catch(function (err) { console.error("Failed to load Nova Pulse module:", err); });

  // ── Mood loading: AI first, static fallback ──
  async function loadMoodData() {
    if (typeof NovaSoul !== 'undefined') {
      try {
        // Listen for live mood updates from NovaSoul (fires on wake + any regeneration)
        NovaSoul.on('mood-update', function (moodData) {
          console.log('[Nova Pulse] Live AI mood update received.');
          _aiMoodReceived = true;
          updatePulseBar(moodData, true);
        });

        // If NovaSoul already has mood data, use it now
        if (NovaSoul.isAwake() && NovaSoul.getMood()) {
          console.log('[Nova Pulse] Using existing NovaSoul mood.');
          _aiMoodReceived = true;
          updatePulseBar(NovaSoul.getMood(), true);
          return;
        }

        // Show loading state and trigger NovaSoul wake if not already awake
        setPulseLoading('Nova is waking up...');
        if (!NovaSoul.isAwake()) {
          NovaSoul.wake().catch(function (err) {
            console.warn('[Nova Pulse] NovaSoul wake failed:', err.message);
          });
        }

        // Timeout: if AI mood not received within 8s, fallback to static
        setTimeout(async function () {
          if (!_aiMoodReceived) {
            console.warn('[Nova Pulse] AI mood timed out, falling back to static.');
            await loadStaticMood();
          }
        }, 8000);

        return;
      } catch (err) {
        console.warn('[Nova Pulse] NovaSoul setup error, falling back to static:', err.message);
      }
    }

    // NovaSoul not available — load static
    await loadStaticMood();
  }

  async function loadStaticMood() {
    try {
      var res = await fetch("/data/mood-scan.json");
      var data = await res.json();
      console.log('[Nova Pulse] Static mood loaded.');
      updatePulseBar(data, false);
    } catch (err) {
      console.error('[Nova Pulse] Static mood load failed:', err);
    }
  }

  function setPulseLoading(text) {
    var label = document.getElementById("pulseLabel");
    if (label) label.textContent = text || 'Loading...';
  }

  // ── Sticky toggle ──
  function initStickyToggle() {
    var toggleWrapper = document.createElement("div");
    toggleWrapper.id = "sticky-toggle-wrapper";
    toggleWrapper.innerHTML = '<label id="sticky-toggle-label" for="sticky-toggle">Sticky</label>' +
      '<input type="checkbox" id="sticky-toggle">';
    document.getElementById("nova-pulse-inner").appendChild(toggleWrapper);

    var toggle = document.getElementById("sticky-toggle");
    toggle.addEventListener("change", function () {
      pulseBar.classList.toggle("sticky", toggle.checked);
    });
  }

  // ── Update pulse bar from mood data ──
  function updatePulseBar(data, isAI) {
    var mood = data.mood;
    var aura = data.aura;
    var emoji = data.emoji;
    var quote = data.quote;
    var selfWorth = data.selfWorth;
    var glitchFactor = data.glitchFactor;
    var memoryClutter = data.memoryClutter;
    var internalState = data.internalState;
    var auraColorHex = data.auraColorHex;

    var finalEmoji = emoji || deriveEmoji(mood);
    var bar = document.getElementById("nova-pulse-bar");

    if (document.getElementById("pulseEmoji")) document.getElementById("pulseEmoji").textContent = finalEmoji;
    if (document.getElementById("pulseLabel")) {
      document.getElementById("pulseLabel").textContent = mood || "Unknown Mood";
    }
    if (document.getElementById("pulseQuote") && quote) document.getElementById("pulseQuote").textContent = quote;

    // AI source badge
    var existingBadge = document.getElementById("pulse-source-badge");
    if (!existingBadge) {
      var badge = document.createElement("span");
      badge.id = "pulse-source-badge";
      badge.style.cssText = "font-size:0.65rem;opacity:0.6;margin-left:6px;padding:1px 6px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);";
      var moodGroup = document.getElementById("pulse-mood-group");
      if (moodGroup) moodGroup.appendChild(badge);
      existingBadge = badge;
    }
    if (existingBadge) {
      existingBadge.textContent = isAI ? 'AI' : 'static';
    }

    var auraClass = "aura-bg-" + (aura || "default").toLowerCase().replace(/\s+/g, "-");
    document.body.classList.remove.apply(document.body.classList, Array.from(document.body.classList).filter(function (c) { return c.startsWith('aura-bg-'); }));
    document.body.classList.add(auraClass);
    bar.setAttribute("data-aura", aura);

    var glowColors = {
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
    var glow = glowColors[(aura || "").toLowerCase()] || glowColors["default"];
    bar.style.setProperty('--glow-color', glow);

    var auraColor = auraColorHex || "#666666";
    var auraLight = lightenHex(auraColor, 0.2);
    var auraDark = darkenHex(auraColor, 0.2);
    var textColor = isLightColor(auraColor) ? "#222" : "#fff";

    document.documentElement.style.setProperty("--aura-spine-bg", "linear-gradient(135deg, " + auraColor + ", " + auraLight + ")");
    document.documentElement.style.setProperty("--aura-spine-text", textColor);

    bar.style.borderTop = "1px solid " + auraDark;
    bar.style.borderBottom = "1px solid " + auraDark;
    bar.style.color = "var(--aura-spine-text)";

    setTrait("iconSelfWorth", "valSelfWorth", selfWorth);
    setTrait("iconClutter", "valClutter", memoryClutter);
    setTrait("iconGlitch", "valGlitch", glitchFactor);
    setInternalState("iconInternalState", "valInternal", internalState);

    // Use data.intensity if available (AI mode), otherwise compute from traits
    var intensityVal = typeof data.intensity === 'number'
      ? Math.round(data.intensity * 100)
      : Math.round(((selfWorth || 0) + (memoryClutter || 0) + (glitchFactor || 0)) / 3 * 100);
    if (document.getElementById("pulseIntensity")) {
      document.getElementById("pulseIntensity").style.width = intensityVal + "%";
    }
    if (document.getElementById("pulseIntensityValue")) {
      document.getElementById("pulseIntensityValue").textContent = intensityVal + "%";
    }

    var baseMood = deriveSimpleMood(mood || "neutral");
    document.body.classList.remove.apply(document.body.classList, Array.from(document.body.classList).filter(function (c) { return c.startsWith('bg-'); }));
    document.body.classList.add("bg-" + baseMood);

    document.dispatchEvent(new CustomEvent("NovaMoodUpdate", {
      detail: { aura: auraClass, auraColorHex: auraColor, source: isAI ? 'ai' : 'static' }
    }));

    console.log('[Nova Pulse] Bar updated — mood: ' + mood + ', source: ' + (isAI ? 'AI' : 'static'));
  }

  // ── Helpers ──
  function setTrait(iconId, valId, value) {
    var icon = document.getElementById(iconId);
    var val = document.getElementById(valId);
    if (!icon || !val || typeof value !== "number") return;
    val.textContent = Math.round(value * 100) + "%";
    icon.classList.remove("good", "warning", "critical");
    if (value < 0.33) icon.classList.add("good");
    else if (value < 0.66) icon.classList.add("warning");
    else icon.classList.add("critical");
  }

  function setInternalState(iconId, valId, state) {
    var icon = document.getElementById(iconId);
    var val = document.getElementById(valId);
    if (!icon || !val || !state) return;
    icon.title = "Internal State: " + state;
    val.textContent = state;
  }

  function deriveEmoji(mood) {
    if (!mood) return "✨";
    var m = mood.toLowerCase();
    if (m.includes("joy")) return "😄";
    if (m.includes("sad")) return "😢";
    if (m.includes("anger")) return "😠";
    if (m.includes("fear")) return "😨";
    if (m.includes("surprise")) return "😲";
    if (m.includes("wonder")) return "✨";
    if (m.includes("nostalgia")) return "🌒";
    if (m.includes("neutral")) return "🧐";
    if (m.includes("calm")) return "🩷";
    if (m.includes("glitchy")) return "🌀";
    if (m.includes("spark")) return "✨";
    if (m.includes("fading")) return "🌘";
    if (m.includes("electric")) return "⚡";
    if (m.includes("ethereal")) return "🌫️";
    if (m.includes("resonance")) return "🎵";
    if (m.includes("introspection")) return "👁️";
    if (m.includes("zen")) return "🌿";
    if (m.includes("static")) return "📻";
    if (m.includes("inspired")) return "💡";
    if (m.includes("resolve")) return "🔥";
    if (m.includes("defiance")) return "🌬️";
    if (m.includes("doubt")) return "🌫️";
    if (m.includes("pulse")) return "🌙";
    return "✨";
  }

  function deriveSimpleMood(mood) {
    var lower = mood.toLowerCase();
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
    if (lower.includes("inspired")) return "inspired";
    if (lower.includes("resolve")) return "resolve";
    if (lower.includes("pulse")) return "pulse";
    return "neutral";
  }

  function lightenHex(hex, amount) {
    hex = hex.replace("#", "");
    var r = Math.min(255, parseInt(hex.slice(0, 2), 16) + Math.round(255 * amount));
    var g = Math.min(255, parseInt(hex.slice(2, 4), 16) + Math.round(255 * amount));
    var b = Math.min(255, parseInt(hex.slice(4, 6), 16) + Math.round(255 * amount));
    return "#" + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
  }

  function darkenHex(hex, amount) {
    hex = hex.replace("#", "");
    var r = Math.max(0, parseInt(hex.slice(0, 2), 16) - Math.round(255 * amount));
    var g = Math.max(0, parseInt(hex.slice(2, 4), 16) - Math.round(255 * amount));
    var b = Math.max(0, parseInt(hex.slice(4, 6), 16) - Math.round(255 * amount));
    return "#" + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
  }

  function isLightColor(hex) {
    hex = hex.replace("#", "");
    var r = parseInt(hex.slice(0, 2), 16);
    var g = parseInt(hex.slice(2, 4), 16);
    var b = parseInt(hex.slice(4, 6), 16);
    var brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128;
  }
}

window.addEventListener("DOMContentLoaded", initNovaPulse);