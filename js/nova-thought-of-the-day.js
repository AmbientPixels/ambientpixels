/*
  File: nova-thought-of-the-day.js
  Path: C:\ambientpixels\EchoGrid\js\nova-thought-of-the-day.js
*/

async function loadNovaThought() {
  try {
    const [promptRes, moodRes] = await Promise.all([
      fetch('/data/ai-prompts.json?t=' + Date.now()),
      fetch('/data/mood-scan.json?t=' + Date.now())
    ]);

    if (!promptRes.ok || !moodRes.ok) {
      throw new Error(`Failed to fetch data: prompts=${promptRes.status}, mood=${moodRes.status}`);
    }

    const promptData = await promptRes.json();
    const moodData = await moodRes.json();
    console.log('[Nova Thought] Mood data:', moodData);

    const container = document.querySelector('.nova-thought .prompt-entry');
    const heading = document.querySelector('.nova-thought h2');
    if (!container || !heading) {
      console.warn('[Nova Thought] Elements not found: container=', container, 'heading=', heading);
      return;
    }

    // Parse date as local time
    const [year, month, day] = promptData.date?.split('-')?.map(Number) || [new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()];
    const localDate = new Date(year, month - 1, day);
    const dateString = localDate.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Mood-based icon map
    const moodIconMap = {
      calm: "🪷",
      curious: "🧠",
      anxious: "😰",
      hopeful: "🌈",
      reflective: "🪞",
      restless: "🔁",
      melancholy: "🌧️",
      excited: "🤩",
      tired: "🥱",
      focused: "🎯",
      playful: "😋",
      frustrated: "😤",
      lonely: "🌌",
      inspired: "💡",
      detached: "🛰️",
      joyful: "😄",
      nervous: "😬",
      serene: "🌿",
      "glitchy joy": "✨",
      "nocturnal pulse": "🌙",
      "chaotic optimism": "🔥",
      "neon stillness": "🧊",
      "static reverie": "📺",
      "ember resolve": "🧱",
      "plasma ache": "💔",
      "soft defiance": "🌬️",
      "aetherial doubt": "🌫️",
      "silent spark": "💫",
      "tangled clarity": "🪢",
      "flicker of hope": "🕯️",
      "frosted wonder": "❄️",
      "echoes of self": "🔊",
      "lucid unrest": "🌌",
      default: "💭"
    };

    const moodKey = (moodData.mood || "").toLowerCase();
    const icon = moodIconMap[moodKey] || moodIconMap.default;

    // Apply aura styles (using auraColorHex)
    const novaThought = document.querySelector('.nova-thought');
    if (novaThought) {
      const auraKey = (moodData.aura || "").toLowerCase();
      const auraColorHex = moodData.auraColorHex || "#999999";
      // Apply inline styles
      novaThought.style.background = `linear-gradient(135deg, ${auraColorHex}, ${lightenHex(auraColorHex, 0.2)})`;
      novaThought.style.border = `1px solid ${darkenHex(auraColorHex, 0.2)}`;
      novaThought.style.color = isLightColor(auraColorHex) ? "#333" : "#fff";
      novaThought.style.padding = "10px";
      novaThought.style.borderRadius = "5px";
      console.log(`[Nova Thought] Applied aura styles: ${auraColorHex} (auraKey: ${auraKey})`);

      // Trigger NovaMoodUpdate event for background aura
      document.dispatchEvent(new CustomEvent("NovaMoodUpdate", {
        detail: { aura: auraKey, auraColorHex }
      }));
    } else {
      console.warn('[Nova Thought] Nova Thought element not found for aura application');
    }

    // Inject icon into heading
    heading.innerHTML = `${icon} Nova’s Thought of the Day`;

    // Populate prompt content with date on its own line
    container.innerHTML = `
      <p>“<em>${promptData.prompt || 'No thought available'}</em>”</p>
      <small>
        <strong>${dateString}</strong><br>
        ${(promptData.tags || []).join(', ') || 'No tags'}
      </small>
    `;

  } catch (err) {
    console.error('[Nova Thought] Failed to load thought or mood:', err);
    const container = document.querySelector('.nova-thought .prompt-entry');
    if (container) {
      container.innerHTML = `<p><em>Failed to load thought</em></p>`;
    }
  }
}

// Utility functions for hex color manipulation
function lightenHex(hex, amount) {
  hex = hex.replace("#", "");
  const r = Math.min(255, parseInt(hex.slice(0, 2), 16) + Math.round(255 * amount));
  const g = Math.min(255, parseInt(hex.slice(2, 4), 16) + Math.round(255 * amount));
  const b = Math.min(255, parseInt(hex.slice(4, 6), 16) + Math.round(255 * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function darkenHex(hex, amount) {
  hex = hex.replace("#", "");
  const r = Math.max(0, parseInt(hex.slice(0, 2), 16) - Math.round(255 * amount));
  const g = Math.max(0, parseInt(hex.slice(2, 4), 16) - Math.round(255 * amount));
  const b = Math.max(0, parseInt(hex.slice(4, 6), 16) - Math.round(255 * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function isLightColor(hex) {
  hex = hex.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128;
}

document.addEventListener('DOMContentLoaded', loadNovaThought);