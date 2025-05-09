/*
  File: nova-mood-grid.js
  Path: C:\ambientpixels\EchoGrid\js\nova-mood-grid.js
*/

const moodGridEmojiMap = {
  joy: "😄", sadness: "😢", anger: "😠", fear: "😨", surprise: "😲", disgust: "🤢",
  neutral: "🧠", calm: "🪷", focused: "🎯", curious: "🔍", hopeful: "🌅", tired: "😴",
  inspired: "🌟", anxious: "😰", restless: "🏃", frustrated: "😤", detached: "🪐",
  lonely: "🌑", serene: "🌊", playful: "🎈", melancholy: "🌧️", nervous: "😬",
  glitchy: "🌀", spark: "✨", fading: "🌘", electric: "⚡", zen: "🧘", nocturnal: "🌙",
  chaotic: "🌪️", nostalgic: "📼", wonder: "🌠",
  "glitchy joy": "🌀", "nocturnal pulse": "🌙", "chaotic optimism": "🌪️",
  "neon stillness": "💡", "static reverie": "📡", "ember resolve": "🔥",
  "plasma ache": "💔", "soft defiance": "🌫️", "aetherial doubt": "🪞",
  "silent spark": "🕯️", "tangled clarity": "🧵", "flicker of hope": "🕯️",
  "frosted wonder": "❄️", "echoes of self": "🔁", "lucid unrest": "👁️‍🗨️"
};

const auraTooltips = {
  "cyan": "cyan: clarity encoded in cool focus",
  "deep violet": "deep violet: mystery wrapped in depth",
  "lime green": "lime green: kinetic thought and renewal",
  "magenta fade": "magenta fade: fading brilliance with soft pulse",
  "paper white": "paper white: pure signal, clean cognition",
  "neon pink": "neon pink: emotional charge in overload",
  "graphite blue": "graphite blue: steady calm with shadowed insight",
  "emerald shadow": "emerald shadow: quiet confidence in the dark",
  "neon burst": "neon burst: inspired by creative overload",
  "glitchy": "glitchy: fragmenting under stress",
  "plasma ache": "plasma ache: raw emotional turbulence",
  "spark": "spark: spontaneous ignition of thought",
  "aetherial doubt": "aetherial doubt: introspective uncertainty",
  "soft defiance": "soft defiance: quiet resistance",
  "ember resolve": "ember resolve: smoldering determination",
  "silent spark": "silent spark: subtle inspiration",
  "tangled clarity": "tangled clarity: complex insight",
  "flicker of hope": "flicker of hope: tentative optimism",
  "frosted wonder": "frosted wonder: serene curiosity",
  "echoes of self": "echoes of self: reflective identity",
  "lucid unrest": "lucid unrest: restless clarity",
  "emerald glow": "emerald glow: vibrant stability",
  "default": "default: baseline cognitive state"
};

document.addEventListener("DOMContentLoaded", () => {
  console.log("[Nova Mood Grid] Script loaded and DOM ready");

  // Render mood history grid (#novaMoodGrid)
  function renderMoodGrid() {
    fetch("/data/mood-history.json?t=" + Date.now())
      .then(res => res.json())
      .then(data => {
        const container = document.getElementById("novaMoodGrid");
        if (!container) {
          console.log("[Nova Mood Grid] #novaMoodGrid not found, skipping render");
          return;
        }

        const items = data.slice(0, 6).map(entry => {
          const mood = entry.mood.toLowerCase();
          const aura = (entry.aura || "default").toLowerCase();
          const auraSlug = aura.replace(/\s+/g, "-");
          const emoji = moodGridEmojiMap[mood] || "🧠";
          const time = new Date(entry.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          });
          const tooltip = auraTooltips[aura] || `aura: ${aura}`;

          return `
            <div class="mood-grid-item aura-${auraSlug}" title="${tooltip}">
              <div class="mood-grid-emoji">${emoji}</div>
              <div class="mood-grid-label">${mood}</div>
              <div class="mood-grid-time">${time}</div>
            </div>
          `;
        });

        container.innerHTML = `
          <h2>Nova’s Recent Mood Stream</h2>
          <div class="mood-grid">${items.join("")}</div>
        `;
      })
      .catch(err => {
        console.error("[Nova Mood Grid] Failed to load mood history:", err);
        const container = document.getElementById("novaMoodGrid");
        if (container) {
          container.innerHTML = "<p>Error loading mood history</p>";
        }
      });
  }

  // Render mood scan demo (#novaMood)
  function renderMoodScanDemo() {
    const moodScanEl = document.getElementById('novaMood');
    if (!moodScanEl) {
      console.log("[Nova Mood Grid] #novaMood not found, skipping render");
      return;
    }

    fetch('/data/mood-scan.json?t=' + Date.now())
      .then(res => res.json())
      .then(data => {
        const moodTitle = document.getElementById('moodTitle');
        const moodEmoji = document.getElementById('moodEmoji');
        const moodAura = document.getElementById('moodAura');
        const moodQuote = document.getElementById('moodQuote');
        const moodTimestamp = document.getElementById('moodTimestamp');
        const moodInfluences = document.getElementById('moodInfluences');

        if (moodTitle) moodTitle.textContent = data.mood || 'Unknown';
        if (moodEmoji) moodEmoji.textContent = data.emoji || '🧠';
        if (moodAura) moodAura.textContent = `Aura: ${data.aura || '–'}`;
        if (moodQuote) moodQuote.textContent = `“${data.quote || '–'}”`;
        if (moodTimestamp) moodTimestamp.textContent = `Last Updated: ${data.timestamp || '–'}`;
        if (moodInfluences && Array.isArray(data.context?.influences)) {
          moodInfluences.innerHTML = `<strong>Influences:</strong> ${data.context.influences.join(', ')}`;
        }
      })
      .catch(err => {
        console.error('[Nova Mood Grid] Failed to load mood scan:', err);
        const moodTitle = document.getElementById('moodTitle');
        if (moodTitle) moodTitle.textContent = 'Error loading mood.';
      });
  }

  // Render Nova Feels mood grid (.mood-grid)
  function renderNovaFeels() {
    fetch('/data/mood-scan.json?t=' + Date.now())
      .then(res => res.json())
      .then(data => {
        console.log('[Nova Mood Grid] Nova Feels data:', data);
        const moodGrid = document.querySelector('.mood-grid');
        if (!moodGrid) {
          console.log("[Nova Mood Grid] .mood-grid not found, skipping render");
          return;
        }

        const traits = [
          { key: 'selfWorth', label: 'Self-Worth' },
          { key: 'glitchFactor', label: 'Glitch Factor' },
          { key: 'memoryClutter', label: 'Memory Clutter' },
          { key: 'awareness', label: 'Awareness' }
        ];

        traits.forEach(trait => {
          const traitElement = moodGrid.querySelector(`[data-trait="${trait.key}"]`);
          if (traitElement) {
            const value = (data[trait.key] || 0) * 100;
            const progress = traitElement.querySelector('.trait-progress');
            const valueDisplay = traitElement.querySelector('.trait-value');
            if (progress && valueDisplay) {
              progress.style.width = `${value}%`;
              valueDisplay.textContent = `${Math.round(value)}%`;
            }
          }
        });
      })
      .catch(err => {
        console.error('[Nova Mood Grid] Failed to update Nova Feels:', err);
        const moodGrid = document.querySelector('.mood-grid');
        if (moodGrid) {
          moodGrid.innerHTML = '<p>Error loading mood data</p>';
        }
      });
  }

  // Render Mood Commentary Widget (.mood-commentary)
  function renderMoodCommentary() {
    fetch('/data/mood-scan.json?t=' + Date.now())
      .then(res => res.json())
      .then(data => {
        console.log('[Nova Mood Grid] Mood Commentary data:', data);
        const commentaryEl = document.querySelector('.mood-commentary');
        if (!commentaryEl) {
          console.log("[Nova Mood Grid] .mood-commentary not found, skipping render");
          return;
        }

        const { selfWorth, glitchFactor, memoryClutter, awareness, mood } = data;
        let commentary = "Processing emotional signals...";

        if (glitchFactor > 0.5) {
          commentary = "Systems buzzing with static! Need a reset.";
        } else if (selfWorth > 0.7) {
          commentary = `Feeling a surge of confidence in ${mood}!`;
        } else if (memoryClutter > 0.6) {
          commentary = "Clutter’s piling up, time to clear the cache.";
        } else if (awareness > 0.8) {
          commentary = `Hyper-aware, sensing every cosmic pulse in ${mood}.`;
        } else if (selfWorth < 0.3) {
          commentary = "Doubts creeping in, searching for a spark.";
        }

        commentaryEl.textContent = commentary;
      })
      .catch(err => {
        console.error('[Nova Mood Grid] Failed to update mood commentary:', err);
        const commentaryEl = document.querySelector('.mood-commentary');
        if (commentaryEl) {
          commentaryEl.textContent = 'Error loading commentary.';
        }
      });
  }

  // Render Mood History Timeline (.mood-timeline .timeline-container)
  function renderMoodTimeline() {
    fetch('/data/mood-history.json?t=' + Date.now())
      .then(res => res.json())
      .then(data => {
        const container = document.querySelector('.mood-timeline .timeline-container');
        if (!container) {
          console.log("[Nova Mood Grid] .timeline-container not found, skipping render");
          return;
        }

        const items = data.slice(0, 10).map(entry => {
          const mood = entry.mood.toLowerCase();
          const aura = (entry.aura || "default").toLowerCase();
          const auraSlug = aura.replace(/\s+/g, "-");
          const emoji = moodGridEmojiMap[mood] || "🧠";
          const time = new Date(entry.timestamp).toLocaleString([], {
            hour: "2-digit",
            minute: "2-digit",
            month: "short",
            day: "numeric"
          });
          const tooltip = auraTooltips[aura] || `aura: ${aura}`;

          return `
            <div class="timeline-item aura-${auraSlug}" title="${tooltip}">
              <div class="timeline-emoji">${emoji}</div>
              <div class="timeline-mood">${mood}</div>
              <div class="timeline-time">${time}</div>
              <div class="timeline-quote">“${entry.quote || '–'}”</div>
            </div>
          `;
        });

        container.innerHTML = items.join("");
      })
      .catch(err => {
        console.error("[Nova Mood Grid] Failed to load mood history timeline:", err);
        const container = document.querySelector('.mood-timeline .timeline-container');
        if (container) {
          container.innerHTML = "<p>Error loading mood history</p>";
        }
      });
  }

  // Update progress bar and commentary colors based on aura
  document.addEventListener("NovaMoodUpdate", (e) => {
    try {
      const { auraColorHex = "#999999" } = e.detail || {};
      console.log(`[Nova Mood Grid] Received NovaMoodUpdate: auraColorHex=${auraColorHex}`);
      
      // Update progress bar colors
      const progressBars = document.querySelectorAll('.mood-trait .trait-progress');
      progressBars.forEach(bar => {
        bar.style.background = auraColorHex;
      });

      // Update commentary background
      const commentaryEl = document.querySelector('.mood-commentary');
      if (commentaryEl) {
        commentaryEl.style.background = `linear-gradient(135deg, ${auraColorHex}80, ${darkenHex(auraColorHex, 0.3)}80)`;
      }
    } catch (err) {
      console.error('[Nova Mood Grid] Failed to update colors:', err);
    }
  });

  // Utility function for hex color manipulation
  function darkenHex(hex, amount) {
    hex = hex.replace("#", "");
    const r = Math.max(0, parseInt(hex.slice(0, 2), 16) - Math.round(255 * amount));
    const g = Math.max(0, parseInt(hex.slice(2, 4), 16) - Math.round(255 * amount));
    const b = Math.max(0, parseInt(hex.slice(4, 6), 16) - Math.round(255 * amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  // Initialize all render functions
  renderMoodGrid();
  renderMoodScanDemo();
  renderNovaFeels();
  renderMoodCommentary();
  renderMoodTimeline();
});