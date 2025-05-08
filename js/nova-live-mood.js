// File: nova-live-mood.js
// Path: /js/nova-live-mood.js

document.addEventListener("DOMContentLoaded", () => {
  fetch("/data/nova-synth-mood.json")
    .then((res) => res.json())
    .then((data) => {
      const mood = document.getElementById("mood-synth");
      const quote = document.getElementById("mood-quote");
      if (mood) mood.textContent = data.mood || "???";
      if (quote) quote.textContent = data.quote || "…";
    })
    .catch(err => console.error("Failed to load synth mood:", err));

  fetch("/data/nova-hybrid-mood.json")
    .then((res) => res.json())
    .then((data) => {
      const hybrid = document.getElementById("mood-hybrid");
      if (hybrid) hybrid.textContent = data.hybridMood || data.reflection || "…";
    })
    .catch(err => console.error("Failed to load hybrid mood:", err));
});