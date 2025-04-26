// File: /js/nova-vision-mood.js

async function loadMoodPrompt() {
  try {
    const res = await fetch("/data/nova-synth-mood.json");
    const mood = await res.json();

    const quote = mood.quote?.trim() || "a dream of data";
    const moodName = mood.mood || "neutral pulse";
    const aura = mood.aura || "silver shimmer";
    const state = mood.internalState || "core unknown";

    const cleanMood = moodName.toLowerCase().replace(/-/g, " ");
    const cleanAura = aura.toLowerCase().replace(/-/g, " ");

    const prompt = `An abstract emotional landscape: ${cleanMood} with ${cleanAura}, mood of "${quote}", inspired by internal state: ${state}. Style: cinematic, surreal, dreamlike, 16:9 ratio, glowing textures.`;

    document.getElementById("promptInput").value = prompt;
    console.log("[NovaVision] Auto-generated prompt:", prompt);

  } catch (error) {
    console.error("[NovaVision] Failed to generate mood prompt:", error);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const btn = document.createElement("button");
  btn.className = "mood-generate-button";
  btn.textContent = "🧠 Dream From Mood";
  btn.type = "button";
  btn.style.marginBottom = "1rem";

  btn.addEventListener("click", loadMoodPrompt);

  const form = document.getElementById("imagePromptForm");
  if (form) {
    form.prepend(btn);
  }
});
