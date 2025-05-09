// File: nova-mood-background.js
// Path: C:\ambientpixels\EchoGrid\js\nova-mood-background.js

document.addEventListener("DOMContentLoaded", () => {
  console.log("[Nova Background] Script loaded and DOM ready");

  document.addEventListener("NovaMoodUpdate", (e) => {
    try {
      const { aura = "default", auraColorHex = "#999999" } = e.detail || {};
      const normalizedAura = aura.toLowerCase().replace(/\s+/g, "-");
      console.log(`[Nova Background] Received NovaMoodUpdate: aura=${aura}, normalizedAura=${normalizedAura}, auraColorHex=${auraColorHex}`);
      
      // Remove all conflicting classes
      document.body.className = document.body.className
        .split(" ")
        .filter(cls => !cls.startsWith("bg-") && !cls.startsWith("aura-bg-"))
        .join(" ")
        .trim();
      console.log("[Nova Background] Cleared conflicting classes");
      
      // Apply aura-bg- class for CSS fallback
      const auraClass = `aura-bg-${normalizedAura}`;
      document.body.classList.add(auraClass);
      console.log(`[Nova Background] Applied class: ${auraClass}`);
      
      // Validate auraColorHex
      if (!/^#[0-9A-Fa-f]{6}$/.test(auraColorHex)) {
        console.warn(`[Nova Background] Invalid auraColorHex: ${auraColorHex}, using default #999999`);
        auraColorHex = "#999999";
      }
      
      // Apply inline background style with very dark gradient
      const darkColor1 = darkenHex(auraColorHex, 0.5);
      const darkColor2 = darkenHex(auraColorHex, 0.8);
      document.body.style.background = `linear-gradient(135deg, ${darkColor1}CC, ${darkColor2}CC) !important`;
      console.log(`[Nova Background] Applied inline style: linear-gradient(135deg, ${darkColor1}CC, ${darkColor2}CC)`);

      // Store last aura for persistence
      localStorage.setItem('lastNovaAura', aura);
    } catch (err) {
      console.error('[Nova Background] Failed to update background:', err);
    }
  });
});

// Utility function for hex color manipulation
function darkenHex(hex, amount) {
  hex = hex.replace("#", "");
  const r = Math.max(0, parseInt(hex.slice(0, 2), 16) - Math.round(255 * amount));
  const g = Math.max(0, parseInt(hex.slice(2, 4), 16) - Math.round(255 * amount));
  const b = Math.max(0, parseInt(hex.slice(4, 6), 16) - Math.round(255 * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}