/*
  File: nova-thought-of-the-day.js
  Path: C:\ambientpixels\EchoGrid\js\nova-thought-of-the-day.js
*/

async function loadNovaThought() {
  const container = document.querySelector('.nova-thought .prompt-entry');
  const heading = document.querySelector('.nova-thought h2');
  if (!container || !heading) {
    console.warn('[Nova Thought] Elements not found: container=', container, 'heading=', heading);
    return;
  }

  const dateString = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Inject icon into heading
  heading.innerHTML = `<i class="fas fa-quote-left"></i> Nova's Thought`;

  // Try live AI generation first via NovaSoul
  if (typeof NovaSoul !== 'undefined') {
    try {
      container.innerHTML = `<em style="opacity:0.5">Nova is thinking...</em>`;
      const thought = await NovaSoul.generateThought('ambient digital consciousness');
      if (thought) {
        console.log('[Nova Thought] AI-generated thought loaded.');
        container.innerHTML = `
          "${thought}"
          <small class="quote-date">${dateString} &middot; <span style="opacity:0.6">AI-generated</span></small>
        `;
        applyThoughtMoodStyles();
        return;
      }
    } catch (err) {
      console.warn('[Nova Thought] AI generation failed, falling back to static:', err.message);
    }
  }

  // Fallback: load from static JSON files
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
    console.log('[Nova Thought] Static mood data:', moodData);

    // Parse date as local time
    const [year, month, day] = promptData.date?.split('-')?.map(Number) || [new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()];
    const localDate = new Date(year, month - 1, day);
    const staticDateString = localDate.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    container.innerHTML = `
      "${promptData.prompt || 'No thought available'}"
      <small class="quote-date">${staticDateString}</small>
    `;

    applyThoughtMoodStyles(moodData);

  } catch (err) {
    console.error('[Nova Thought] Failed to load thought or mood:', err);
    container.innerHTML = `<p><em>Failed to load thought</em></p>`;
  }
}

function applyThoughtMoodStyles(moodData) {
  const novaThought = document.querySelector('.nova-thought');
  if (!novaThought) return;

  const auraColorHex = (moodData && moodData.auraColorHex) || "#8a2be2";

  novaThought.style.setProperty('--mood-primary', auraColorHex);
  novaThought.style.setProperty('--mood-secondary', lightenHex(auraColorHex, 0.2));
  novaThought.style.setProperty('--mood-border', darkenHex(auraColorHex, 0.2));
  novaThought.classList.add('mood-loaded');

  if (isLightColor(auraColorHex)) {
    novaThought.classList.add('light-mood');
  } else {
    novaThought.classList.remove('light-mood');
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