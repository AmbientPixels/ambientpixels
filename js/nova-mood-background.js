// File: nova-mood-background.js
// Path: /js/nova-mood-background.js

document.addEventListener("NovaMoodUpdate", (e) => {
  try {
    const { aura = "default" } = e.detail || {};
    
    // Normalize and sanitize aura for background class
    const auraClass = "aura-bg-" + aura.toLowerCase().replace(/\s+/g, "-");

    // Check if nova-mood-background.css is included
    const hasBackgroundStylesheet = document.querySelector('link[href="/css/nova-mood-background.css"]');

    if (hasBackgroundStylesheet) {
      // Clean up old aura-* and aura-bg-* classes
      document.body.className = document.body.className
        .split(" ")
        .filter(cls => !cls.startsWith("aura-") && !cls.startsWith("aura-bg-"))
        .join(" ")
        .trim();

      // Apply new background aura class to <body>
      document.body.classList.add(auraClass);
      console.log(`[Nova Background] Aura updated: ${auraClass} (aura: ${aura})`);

      // Store last aura for persistence
      localStorage.setItem('lastNovaAura', aura);
    } else {
      // Remove any residual aura-* and aura-bg-* classes
      document.body.className = document.body.className
        .split(" ")
        .filter(cls => !cls.startsWith("aura-") && !cls.startsWith("aura-bg-"))
        .join(" ")
        .trim();
      console.log(`[Nova Background] Skipped aura update on ${window.location.pathname} (stylesheet: ${hasBackgroundStylesheet})`);
    }
  } catch (err) {
    console.error('[Nova Background] Failed to update background:', err);
  }
});

// Handle aura selection from dropdown
document.addEventListener("DOMContentLoaded", () => {
  const auraSelect = document.getElementById("auraSelect");
  if (auraSelect) {
    auraSelect.addEventListener("change", (e) => {
      const aura = e.target.value || "default";
      document.dispatchEvent(new CustomEvent("NovaMoodUpdate", {
        detail: { aura }
      }));
    });
  }
});