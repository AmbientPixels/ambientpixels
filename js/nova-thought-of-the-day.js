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

    const promptData = await promptRes.json();
    const moodData = await moodRes.json();

    const container = document.querySelector('.nova-thought .prompt-entry');
    const heading = document.querySelector('.nova-thought h2');
    if (!container || !heading) return;

    // Parse date as local time
    const [year, month, day] = promptData.date.split('-').map(Number);
    const localDate = new Date(year, month - 1, day);
    const dateString = localDate.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Mood-based icon map
    const moodIconMap = {
      melancholy: "🌙",
      electric: "🔋",
      "static-charged": "⚡",
      "warm curiosity": "🔍",
      "chaotic optimism": "🌪️",
      "focused zen": "🧘",
      "quiet rebellion": "🎧",
      "glitchy joy": "💫",
      "nocturnal pulse": "🌌",
      "neon serenity": "🕊️",
      default: "💭"
    };

    const auraClassMap = {
      "deep violet": "aura-violet",
      "cyan": "aura-cyan",
      "lime green": "aura-lime",
      "magenta fade": "aura-magenta",
      "paper white": "aura-white",
      "neon pink": "aura-pink",
      "graphite blue": "aura-graphite",
      "emerald shadow": "aura-emerald"
    };

    const moodKey = (moodData.mood || "").toLowerCase();
    const icon = moodIconMap[moodKey] || moodIconMap.default;
    const auraKey = (moodData.aura || "").toLowerCase();
    const auraClass = auraClassMap[auraKey];

    if (auraClass) {
      document.querySelector('.nova-thought')?.classList.add(auraClass);
    }

    // Inject icon into heading
    heading.innerHTML = `${icon} Nova’s Thought of the Day`;

    // Populate prompt content with date on its own line
    container.innerHTML = `
      <p>“<em>${promptData.prompt}</em>”</p>
      <small>
        <strong>${dateString}</strong><br>
        ${promptData.tags.join(', ')}
      </small>
    `;

  } catch (err) {
    console.error('⚠️ Failed to load Nova thought or mood:', err);
  }
}

document.addEventListener('DOMContentLoaded', loadNovaThought);
