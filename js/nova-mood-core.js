document.body.classList.remove("bg-neutral");
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
        document.body.classList.add(`aura-${aura}`);
      }

      // 🎨 Apply mood-derived background
      const baseMood = deriveSimpleMood(data.mood || "neutral");
      document.body.classList.add(`bg-${baseMood}`);

      // 🧠 Dispatch NovaMoodUpdate event
      document.dispatchEvent(new CustomEvent("NovaMoodUpdate", {
        detail: {
          mood: data.mood || "neutral",
          aura: data.aura || "default"
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
