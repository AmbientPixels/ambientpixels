// File: js\fetchDailyLogs.js
document.addEventListener("DOMContentLoaded", () => {
  const log = document.getElementById("daily-log-list");
  if (!log) return;

  fetch("/data/daily-logs.json")
    .then(res => res.json())
    .then(logs => {
      log.innerHTML = "";
      logs.forEach(entry => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${entry.timestamp}:</strong> ${entry.message}`;
        log.appendChild(li);
      });
    })
    .catch(() => {
      log.innerHTML = "<li>No logs available.</li>";
    });
});