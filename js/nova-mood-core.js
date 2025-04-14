// File: /js/nova-mood-core.js

document.addEventListener("DOMContentLoaded", () => {
  const driftEl = document.getElementById("nova-mood-drift");
  if (!driftEl) return;

  fetch("/data/nova-synth-mood.json")
    .then(res => res.json())
    .then(data => {
      driftEl.innerHTML = `
        🧠 Mood: <strong>${data.mood}</strong><br>
        ✨ Aura: <span>${data.aura}</span><br>
        💬 Quote: <em>"${data.quote}"</em><br>
        🔄 Drift Source: <span>${data.context.trigger}</span><br>
        📡 Influences: <code>${data.context.influences.join(", ")}</code><br>
        🕒 Last Updated: <time datetime="${data.timestamp}">${new Date(data.timestamp).toLocaleString()}</time>
      `;
    })
    .catch(err => {
      console.error("[Nova Mood Drift] Failed to load:", err);
      driftEl.innerHTML = "🧠 Mood systems offline. No emotional data available.";
    });
});
