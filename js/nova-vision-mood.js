// File: /js/nova-vision-mood.js

async function loadMoodPrompt() {
    const res = await fetch("/data/nova-synth-mood.json");
    const mood = await res.json();
  
    const quote = mood.quote?.trim() || "a dream of data";
    const moodName = mood.mood || "neutral pulse";
    const aura = mood.aura || "silver shimmer";
    const state = mood.internalState || "core unknown";
  
    const prompt = `An abstract emotional landscape: ${moodName} with ${aura}, mood of "${quote}", inspired by internal state: ${state}. Style: cinematic, surreal, 16:9, glowing digital textures.`;
  
    document.getElementById("promptInput").value = prompt;
    console.log("[NovaVision] Auto-generated prompt:", prompt);
  }
  
  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.createElement("button");
    btn.className = "mood-generate-button";
    btn.textContent = "🧠 Dream From Mood";
    btn.type = "button";
    btn.style.marginBottom = "1rem";
  
    btn.addEventListener("click", loadMoodPrompt);
  
    const form = document.getElementById("imagePromptForm");
    form.prepend(btn);
  });
  