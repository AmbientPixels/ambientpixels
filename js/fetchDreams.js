document.addEventListener("DOMContentLoaded", () => {
  const log = document.getElementById("nova-dream-log");
  if (!log) return;

  fetch("/data/nova-dreams.json")
    .then(res => res.json())
    .then(dreams => {
      log.innerHTML = "";
      dreams.forEach(dream => {
        const li = document.createElement("li");
        li.className = "nova-thought";
        li.textContent = dream.replace("💭 ", "");
        log.appendChild(li);
      });
      log.dataset.injected = "true";
    })
    .catch(() => {
      log.innerHTML = "<li>No dreams available.</li>";
    });
});