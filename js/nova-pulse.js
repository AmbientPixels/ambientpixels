// File: /js/nova-pulse.js

// Nova Pulse Metrics Breakdown (top-level index pulse block)
document.addEventListener("DOMContentLoaded", () => {
  const scriptsEl = document.getElementById("pulse-scripts");
  const endpointsEl = document.getElementById("pulse-endpoints");
  const logsEl = document.getElementById("pulse-logs");

  // Exit early if not on a page with pulse IDs
  if (!scriptsEl || !endpointsEl || !logsEl) return;

  Promise.all([
    fetch("/data/js-function-map.json").then((res) => res.ok ? res.json() : {}),
    fetch("/data/api-monitor.json").then((res) => res.ok ? res.json() : {}),
    fetch("/data/changelog.json").then((res) => res.ok ? res.json() : {}),
  ])
    .then(([jsData, apiData, changelogData]) => {
      scriptsEl.textContent = jsData.scripts ? Object.keys(jsData.scripts).length : "0";
      endpointsEl.textContent = apiData.endpoints ? apiData.endpoints.length : "0";
      logsEl.textContent = changelogData.entries ? changelogData.entries.length : "0";
    })
    .catch((err) => {
      console.warn("[Nova Pulse] Failed to load data:", err);
      if (scriptsEl) scriptsEl.textContent = "⚠️";
      if (endpointsEl) endpointsEl.textContent = "⚠️";
      if (logsEl) logsEl.textContent = "⚠️";
    });
});
