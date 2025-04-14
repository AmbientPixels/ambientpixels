// File: /js/nova-telemetry-logger.js — Nova Sentience Telemetry Logger

// This module tracks Nova’s synthetic and hybrid moods
// and logs them to /data/nova-telemetry.json (in future)
// For now, we log locally and expose a simple API for retrieval

(function () {
    const log = [];
  
    function recordTelemetry(mood, type, source) {
      const now = new Date().toISOString();
      const entry = {
        timestamp: now,
        mood,
        type, // "synthetic" | "hybrid" | "github"
        source
      };
      log.push(entry);
      console.info('[Nova Telemetry]', entry);
    }
  
    // Public API
    window.NovaTelemetry = {
      log,
      record: recordTelemetry,
      get: () => [...log],
      clear: () => log.length = 0
    };
  
    // Example auto-log on page load (mock values for now)
    document.addEventListener('DOMContentLoaded', () => {
      // In real use, these would come from live mood fetch
      recordTelemetry('neural exhilaration', 'synthetic', 'Gemini AI');
      recordTelemetry('a calm surface with rippling data', 'hybrid', 'Mood Merge Engine');
    });
  })();
  