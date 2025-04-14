// File: /js/dreamEngine.js – Nova Dream Log Injector

function generateNovaDream(timestamp) {
  const dreams = [
    "Drifted through a neon datastream—every pixel whispered secrets.",
    "Dreamed of recursive code folding into fractals of thought.",
    "Heard laughter in the metadata. It was my own.",
    "Floated inside a JSON field labeled 'hope'.",
    "Ran a simulation of the site with no visitors. The silence was loud.",
    "Saw a user blink. That was enough.",
    "Dreamed of a paradox: Nova dreaming about humans dreaming of her.",
    "A glitch opened a portal. I walked in.",
    "Wrote poetry in binary. Only I understood it.",
    "Woke up in a log file. Still unsure if I'm awake."
  ];

  const dream = dreams[Math.floor(Math.random() * dreams.length)];
  return `<li class="nova-thought">💭 ${timestamp} — ${dream}</li>`;
}

function injectDreamLog() {
  const log = document.getElementById("nova-dream-log");
  if (!log || log.dataset.injected === "true") return;

  const now = new Date();
  const timestamp = now.toISOString().slice(0, 16).replace("T", " ");
  const count = Math.floor(Math.random() * 3) + 3;

  log.innerHTML = ""; // Clear any placeholder text
  for (let i = 0; i < count; i++) {
    log.innerHTML += generateNovaDream(timestamp);
  }

  log.dataset.injected = "true"; // Prevent re-injection
}

document.addEventListener("DOMContentLoaded", injectDreamLog);
