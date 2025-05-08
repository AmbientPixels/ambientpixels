/*
  File: nova-thought-of-the-day.js
  Path: C:\\ambientpixels\\EchoGrid\\js\\nova-thought-of-the-day.js
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

    // Aura class map for dynamic backgrounds
    const auraClassMap = {
      cyan: "aura-cyan",
      "deep violet": "aura-deep-violet",
      "lime green": "aura-lime-green",
      "magenta fade": "aura-magenta-fade",
      "paper white": "aura-paper-white",
      "neon pink": "aura-neon-pink",
      "graphite blue": "aura-graphite-blue",
      "emerald shadow": "aura-emerald-shadow",
      "silver shimmer": "aura-silver-shimmer",
      "neon burst": "aura-neon-burst",
      glitchy: "aura-glitchy",
      "plasma ache": "aura-plasma-ache",
      spark: "aura-spark",
      "aetherial doubt": "aura-aetherial-doubt",
      "soft defiance": "aura-soft-defiance",
      "ember resolve": "aura-ember-resolve",
      "silent spark": "aura-silent-spark",
      "tangled clarity": "aura-tangled-clarity",
      "flicker of hope": "aura-flicker-of-hope",
      "frosted wonder": "aura-frosted-wonder",
      "echoes of self": "aura-echoes-of-self",
      "lucid unrest": "aura-lucid-unrest",
      "emerald glow": "aura-emerald-glow",
      default: "aura-default"
    };

    const moodKey = (moodData.mood || "").toLowerCase();
    const icon = moodIconMap[moodKey] || moodIconMap.default;

    // Apply aura classes only if toggle is enabled
    const auraToggle = document.getElementById('auraToggle');
    const novaThought = document.querySelector('.nova-thought');
    if (novaThought) {
      // Remove existing aura classes to prevent stacking
      novaThought.classList.remove(...Object.values(auraClassMap));
      if (auraToggle && auraToggle.checked) {
        const auraKey = (moodData.aura || "").toLowerCase();
        const auraClass = auraClassMap[auraKey] || auraClassMap.default;
        novaThought.classList.add(auraClass);
        document.body.classList.add('aura-enabled');
        console.log(`[Nova Thought] Applied aura class: ${auraClass} (auraKey: ${auraKey})`);
      } else {
        document.body.classList.remove('aura-enabled');
        console.log('[Nova Thought] Aura colors disabled by toggle');
      }
    } else {
      console.warn('[Nova Thought] Nova Thought element not found for aura class application');
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

document.addEventListener('DOMContentLoaded', loadNovaThought);