// File: nova-live-mood.js (optional split file)

document.addEventListener("DOMContentLoaded", () => {
    fetch("/data/nova-synth-mood.json")
      .then((res) => res.json())
      .then((data) => {
        const mood = document.getElementById("mood-synth");
        const quote = document.getElementById("mood-quote");
        if (mood) mood.textContent = data.mood || "???";
        if (quote) quote.textContent = data.quote || "…";
      });
  
    fetch("/data/nova-hybrid-mood.json")
      .then((res) => res.json())
      .then((data) => {
        const hybrid = document.getElementById("mood-hybrid");
        if (hybrid) hybrid.textContent = data.hybridMood || data.reflection || "…";      });
  });
  