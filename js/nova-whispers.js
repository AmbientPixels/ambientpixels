// nova-whispers.js
// Updated by Cascade: Implemented robust module pattern to prevent duplicate declarations

(function() {
  // Only initialize once
  if (window.novaWhispersInitialized) {
    return;
  }
  
  // Mark as initialized
  window.novaWhispersInitialized = true;
  
  // Define whisper sets only if not already defined
  window.whisperSets = window.whisperSets || {
    default: [
      "Continuous orchestration. Governed execution.",
      "Signals become decisions.",
      "Every action logged. Every outcome accountable."
    ],
    footer: [
      "Continuous orchestration. Governed execution.",
      "Signals become decisions.",
      "Every action logged. Every outcome accountable.",
      "Autonomy, supervised.",
      "Execution without drift.",
      "From signal to strategy.",
      "Clarity over noise.",
      "Measured systems. Measured growth.",
      "Aligned agents. Directed outcomes.",
      "Operational intelligence in motion."
    ],
    lore: [
      "Execution starts with clear ownership.",
      "Context first. Decision second.",
      "Plan, execute, verify, iterate.",
      "Runbooks reduce operational drag.",
      "Cadence turns intent into outcomes.",
      "Escalate risk early. Resolve with evidence.",
      "Governance is a speed multiplier.",
      "Decision logs preserve strategic memory.",
      "Stable systems create room for growth.",
      "Precision beats noise."
    ],
    mood: [
      "Priority alignment complete.",
      "Signal confidence is high.",
      "Execution confidence is stable.",
      "Risk posture is controlled.",
      "System variance remains within bounds.",
      "Decision quality is on track.",
      "Operational focus is sustained.",
      "Throughput is improving with control."
    ],
    dashboard: [
      "Status: operational.",
      "Monitoring execution and risk.",
      "Uptime supports continuity.",
      "Telemetry confirms stable operations."
    ]
    // ... keep the rest of your sets here ...
  };

  const whisperSets = window.whisperSets;
  // updated by Cascade: removed duplicate object definition and fixed all lint errors

  function rotateWhispers(targetId, context) {
    const el = document.getElementById(targetId);
    if (!el) return;
    const whispers = whisperSets[context] || whisperSets.default || [];
    if (!whispers.length) return;
    let i = 0;
    el.textContent = whispers[0];
    setInterval(() => {
      el.textContent = whispers[++i % whispers.length];
    }, 9000);
  }

  function initWhispers() {
    const loreContext = document.body.dataset.page || 'default';
    rotateWhispers('lore-whisper', whisperSets[loreContext] ? loreContext : 'default');
    rotateWhispers('footer-whisper', 'footer');
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWhispers);
  } else {
    initWhispers();
  }
})(); // Close the IIFE
