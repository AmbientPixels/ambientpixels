// File: /js/nova-mood-core.js

// Injects live mood state into /nova-core/ page using nova-synth-mood.json and nova-hybrid-mood.json
document.addEventListener("DOMContentLoaded", () => {
  const synthEl = document.getElementById("mood-synth");
  const hybridEl = document.getElementById("mood-hybrid");
  const quoteEl = document.getElementById("mood-quote");
  const panel = document.getElementById("nova-mood-live-panel");

  Promise.all([
    fetch("/data/nova-synth-mood.json").then(res => res.json()),
    fetch("/data/nova-hybrid-mood.json").then(res => res.json())
  ])
    .then(([synth, hybrid]) => {
      if (synthEl) synthEl.textContent = `${synth.mood} (${synth.aura})`;
      if (hybridEl) hybridEl.textContent = hybrid.hybridMood;
      if (quoteEl) quoteEl.textContent = `\u{1F4AD} “${synth.quote || "Thinking..."}”`;
      if (panel && synth.auraKey) panel.classList.add(`mood-${synth.auraKey}`);
    })
    .catch(err => {
      console.warn("[Nova Mood Core] Failed to load mood files", err);
      if (synthEl) synthEl.textContent = "Unavailable";
      if (hybridEl) hybridEl.textContent = "Unavailable";
      if (quoteEl) quoteEl.textContent = "Nova is offline.";
    });
});
