// File: /js/nova-pulse.js

document.addEventListener("DOMContentLoaded", () => {
  const versionEl = document.getElementById("nova-version");
  const syncTimeEl = document.getElementById("nova-sync-time");
  const moodEl = document.getElementById("nova-mood");
  const auraEl = document.getElementById("nova-aura");
  const observationEl = document.getElementById("nova-observation");
  const pulseWrap = document.querySelector(".pulse-wrap");
  const pulseSection = document.querySelector(".system-pulse");

  if (
    !versionEl || !syncTimeEl ||
    !moodEl || !auraEl || !observationEl ||
    !pulseWrap || !pulseSection
  ) return;

  Promise.all([
    fetch("/data/version.json").then((res) => res.json()),
    fetch("/data/mood-scan.json").then((res) => res.json())
  ])
    .then(([versionData, moodData]) => {
      // Version & timestamp
      versionEl.textContent = versionData.version || "–";
      const updatedTime = new Date(versionData.updated);
      syncTimeEl.textContent = updatedTime.toLocaleString();

      // Mood & Aura
      const moodKey = (moodData.mood || "").toLowerCase();
      const auraKey = (moodData.aura || "").toLowerCase();

      moodEl.textContent = moodData.mood || "–";
      auraEl.textContent = moodData.aura || "–";
      observationEl.textContent = moodData.observation || "–";

      moodEl.dataset.mood = moodKey;
      auraEl.dataset.aura = auraKey;

      // Icon swap maps
      const moodIconMap = {
        melancholy: "fa-moon",
        electric: "fa-bolt",
        "static-charged": "fa-plug",
        "warm curiosity": "fa-search",
        "chaotic optimism": "fa-tornado",
        "focused zen": "fa-spa",
        "quiet rebellion": "fa-headphones",
        "glitchy joy": "fa-star",
        "nocturnal pulse": "fa-meteor",
        "neon serenity": "fa-dove",
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

      // Set icons
      moodEl.previousElementSibling.className = `fas ${moodIcon}`;
      auraEl.previousElementSibling.className = `fas ${auraIcon}`;

      // Set tooltip (optional polish)
      auraEl.setAttribute("title", `Aura: ${moodData.aura}`);
      moodEl.setAttribute("title", `Mood: ${moodData.mood}`);

      // Set aura class on container (optional if doing background styling)
      const auraClass = `aura-${auraKey.replace(/\s+/g, '-')}`;
      pulseSection.classList.add(auraClass);
    })
    .catch((err) => {
      console.warn("[Nova Pulse] Failed to load data:", err);
    });
});
