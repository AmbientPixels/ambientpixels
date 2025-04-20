// File: /js/nova-pulse.js — Updated with full mood traits
console.log("[Nova Pulse] Initializing...");

document.addEventListener("DOMContentLoaded", () => {
  const versionEl = document.getElementById("nova-version");
  const syncTimeEl = document.getElementById("nova-sync-time");
  const moodEl = document.getElementById("nova-mood");
  const auraEl = document.getElementById("nova-aura");
  const observationEl = document.getElementById("nova-observation");
  const selfWorthEl = document.getElementById("nova-self-worth");
  const glitchEl = document.getElementById("nova-glitch");
  const clutterEl = document.getElementById("nova-clutter");
  const stateEl = document.getElementById("nova-state");
  const pulseSection = document.querySelector(".system-pulse");

  if (
    !versionEl || !syncTimeEl ||
    !moodEl || !auraEl || !observationEl ||
    !selfWorthEl || !glitchEl || !clutterEl || !stateEl ||
    !pulseSection
  ) return;

  console.log("[Nova Pulse] Version & Mood Fetch Fired");

  Promise.all([
    fetch("/data/version.json").then(res => res.json()),
    fetch("/data/nova-synth-mood.json").then(res => res.json())
  ])
  .then(([versionData, moodData]) => {
    console.log("[Nova Pulse] Version Data:", versionData);
    console.log("[Nova Pulse] Mood Data:", moodData);

    versionEl.textContent = `${versionData.version} (build ${versionData.build || "–"})`;
    syncTimeEl.textContent = new Date(versionData.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
                             " on " + new Date(versionData.updated).toLocaleDateString();

    const moodKey = (moodData.mood || "–").toLowerCase();
    const auraKey = (moodData.aura || "–").toLowerCase();

    moodEl.textContent = moodData.mood || "–";
    auraEl.textContent = moodData.aura || "–";
    observationEl.textContent = moodData.observation || "–";

    moodEl.dataset.mood = moodKey;
    auraEl.dataset.aura = auraKey;

    selfWorthEl.textContent = moodData.selfWorth?.toFixed(2) || "–";
    glitchEl.textContent = moodData.glitchFactor?.toFixed(2) || "–";
    clutterEl.textContent = moodData.memoryClutter?.toFixed(2) || "–";
    stateEl.textContent = moodData.internalState || "–";

    const moodIconMap = {
      "melancholy": "fa-moon",
      "electric": "fa-bolt",
      "static-charged": "fa-plug",
      "warm curiosity": "fa-search",
      "chaotic optimism": "fa-tornado",
      "focused zen": "fa-spa",
      "quiet rebellion": "fa-headphones",
      "glitchy joy": "fa-star",
      "nocturnal pulse": "fa-meteor",
      "neon serenity": "fa-dove",
      "calm": "fa-wind",
      default: "fa-brain"
    };

    const auraIconMap = {
      "deep violet": "fa-star",
      "cyan": "fa-tint",
      "lime green": "fa-leaf",
      "magenta fade": "fa-heart",
      "paper white": "fa-snowflake",
      "neon pink": "fa-magic",
      "graphite blue": "fa-gem",
      "emerald shadow": "fa-seedling",
      default: "fa-bolt"
    };

    const moodIcon = moodIconMap[moodKey] || moodIconMap.default;
    const auraIcon = auraIconMap[auraKey] || auraIconMap.default;

    moodEl.previousElementSibling.className = `fas ${moodIcon}`;
    auraEl.previousElementSibling.className = `fas ${auraIcon}`;

    auraEl.title = `Aura: ${moodData.aura}`;
    moodEl.title = `Mood: ${moodData.mood}`;
    stateEl.title = `Internal State: ${moodData.internalState}`;

    const auraClass = `aura-${auraKey.replace(/\s+/g, '-')}`;
    pulseSection.classList.add(auraClass);
  })
  .catch((err) => {
    console.warn("[Nova Pulse] Failed to load data:", err);
  });
});
