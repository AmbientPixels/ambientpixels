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

          // Create mood grid item with default styling
          const item = document.createElement('div');
          item.className = `mood-grid-item aura-${auraSlug}`;
          item.title = tooltip;
          item.innerHTML = `
            <div class="mood-grid-emoji">${emoji}</div>
            <div class="mood-grid-label">${mood}</div>
            <div class="mood-grid-time">${time}</div>
          `;
          
          // Store aura color for initial styling
          item.dataset.auraColor = data.auraColorHex || "#999999";
          
          // Apply initial styling
          applyMoodItemStyling(item, item.dataset.auraColor);
          
          return item.outerHTML;
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

  // Update mood grid item styling based on aura
  function applyMoodItemStyling(item, auraColorHex) {
    item.style.background = `linear-gradient(135deg, ${auraColorHex}, ${lightenHex(auraColorHex, 0.2)})`;
    item.style.border = `1px solid ${darkenHex(auraColorHex, 0.2)}`;
    item.style.color = isLightColor(auraColorHex) ? "#333" : "#fff";
    item.style.borderRadius = "6px";
    item.style.padding = "8px";
    item.style.transition = "all 0.3s ease";
  }

  // Update mood grid items when mood changes
  document.addEventListener("NovaMoodUpdate", (e) => {
    try {
      const { auraColorHex = "#999999" } = e.detail || {};
      
      // Update mood grid items
      document.querySelectorAll('.mood-grid-item').forEach(item => {
        applyMoodItemStyling(item, auraColorHex);
      });

      // Update progress bars and commentary
      const progressBars = document.querySelectorAll('.trait-progress');
      const commentary = document.querySelector('.mood-commentary');

      progressBars.forEach(bar => {
        bar.style.background = `linear-gradient(90deg, ${auraColorHex} 0%, ${lightenHex(auraColorHex, 0.2)} 100%)`;
        bar.style.border = `1px solid ${darkenHex(auraColorHex, 0.2)}`;
      });

      if (commentary) {
        applyMoodItemStyling(commentary, auraColorHex);
      }
    } catch (err) {
      console.error("[Nova Mood Grid] Failed to update colors:", err);
    }
  });

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
  function renderMoodCommentary(moodData) {
    const commentaryEl = document.querySelector('.mood-commentary');
    if (!commentaryEl) return;

    function applyCommentary(data) {
      const traits = data.traits || data;
      const selfWorth = traits.selfWorth || 0;
      const glitchFactor = traits.glitchFactor || traits.glitch || 0;
      const memoryClutter = traits.memoryClutter || 0;
      const awareness = traits.awareness || 0;
      const mood = data.mood || 'unknown';
      let commentary = "Processing emotional signals...";

      if (glitchFactor > 0.5) {
        commentary = "Systems buzzing with static! Need a reset.";
      } else if (selfWorth > 0.7) {
        commentary = `Feeling a surge of confidence in ${mood}!`;
      } else if (memoryClutter > 0.6) {
        commentary = "Clutter's piling up, time to clear the cache.";
      } else if (awareness > 0.8) {
        commentary = `Hyper-aware, sensing every cosmic pulse in ${mood}.`;
      } else if (selfWorth < 0.3) {
        commentary = "Doubts creeping in, searching for a spark.";
      } else {
        commentary = `Current state: ${mood}. All signals nominal.`;
      }
      commentaryEl.textContent = commentary;
    }

    // Use provided data or try NovaSoul live mood
    if (moodData) {
      applyCommentary(moodData);
      return;
    }
    if (typeof NovaSoul !== 'undefined') {
      const liveMood = NovaSoul.getMood();
      if (liveMood) { applyCommentary(liveMood); return; }
    }
    // Fallback to static
    fetch('/data/mood-scan.json?t=' + Date.now())
      .then(res => res.json())
      .then(data => applyCommentary(data))
      .catch(() => { commentaryEl.textContent = 'Awaiting emotional signals...'; });
  }

  // Render Mood History Timeline (.mood-timeline .timeline-container)
  // Now pulls live data from NovaSoul.getMoodHistory() with static fallback
  function renderMoodTimeline() {
    const container = document.querySelector('.mood-timeline .timeline-container');
    if (!container) return;

    function renderEntries(entries) {
      if (!entries || !entries.length) {
        container.innerHTML = '<p style="opacity:0.4;">No mood history yet.</p>';
        return;
      }
      // Show newest first, max 10
      const sorted = [...entries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const items = sorted.slice(0, 10).map(entry => {
        const mood = (entry.mood || 'unknown').toLowerCase();
        const aura = (entry.aura || 'default').toLowerCase();
        const auraSlug = aura.replace(/\s+/g, '-');
        const emoji = entry.emoji || moodGridEmojiMap[mood] || '🧠';
        const time = entry.timestamp ? new Date(entry.timestamp).toLocaleString([], {
          hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric'
        }) : '–';
        const tooltip = auraTooltips[aura] || `aura: ${aura}`;
        const quote = entry.observation || entry.quote || entry.nova_comment || '';
        const sourceTag = entry.source === 'ai' ? '<span style="font-size:0.6rem;opacity:0.4;margin-left:4px;">AI</span>' : '';

        return `
          <div class="timeline-item aura-${auraSlug}" title="${tooltip}">
            <div class="timeline-emoji">${emoji}</div>
            <div class="timeline-mood">${mood}${sourceTag}</div>
            <div class="timeline-time">${time}</div>
            <div class="timeline-quote">${quote ? '"' + quote + '"' : ''}</div>
          </div>
        `;
      });
      container.innerHTML = items.join('');
    }

    // Try NovaSoul live mood history first
    if (typeof NovaSoul !== 'undefined') {
      const liveHistory = NovaSoul.getMoodHistory();
      if (liveHistory && liveHistory.length > 0) {
        renderEntries(liveHistory);
        return;
      }
    }

    // Fallback to static mood-history.json
    fetch('/data/mood-history.json?t=' + Date.now())
      .then(res => res.json())
      .then(data => renderEntries(data))
      .catch(err => {
        console.error('[Nova Mood Grid] Mood timeline load failed:', err);
        container.innerHTML = '<p>Error loading mood history</p>';
      });
  }

  // Utility function for hex color manipulation
  function darkenHex(hex, amount) {
    hex = hex.replace("#", "");
    const r = Math.max(0, parseInt(hex.slice(0, 2), 16) - Math.round(255 * amount));
    const g = Math.max(0, parseInt(hex.slice(2, 4), 16) - Math.round(255 * amount));
    const b = Math.max(0, parseInt(hex.slice(4, 6), 16) - Math.round(255 * amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  function lightenHex(hex, amount) {
    hex = hex.replace("#", "");
    const r = Math.min(255, parseInt(hex.slice(0, 2), 16) + Math.round(255 * amount));
    const g = Math.min(255, parseInt(hex.slice(2, 4), 16) + Math.round(255 * amount));
    const b = Math.min(255, parseInt(hex.slice(4, 6), 16) + Math.round(255 * amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  function isLightColor(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return false;
    let r = parseInt(result[1], 16);
    let g = parseInt(result[2], 16);
    let b = parseInt(result[3], 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 128;
  }

  // Listen for live NovaSoul mood updates to refresh widgets in real-time
  if (typeof NovaSoul !== 'undefined') {
    NovaSoul.on('mood-update', function (mood) {
      renderMoodTimeline();
      renderMoodCommentary(mood);
      // Update Nova Feels trait bars from live mood
      if (mood && mood.traits) {
        const moodGrid = document.querySelector('.mood-grid');
        if (moodGrid) {
          [
            { key: 'selfWorth' },
            { key: 'glitchFactor' },
            { key: 'memoryClutter' },
            { key: 'awareness' }
          ].forEach(t => {
            const el = moodGrid.querySelector('[data-trait="' + t.key + '"]');
            if (el) {
              const val = (mood.traits[t.key] || 0) * 100;
              const prog = el.querySelector('.trait-progress');
              const disp = el.querySelector('.trait-value');
              if (prog) prog.style.width = val + '%';
              if (disp) disp.textContent = Math.round(val) + '%';
            }
          });
        }
      }
      // Update mood scan demo from live data
      if (mood) {
        const moodTitle = document.getElementById('moodTitle');
        const moodEmoji = document.getElementById('moodEmoji');
        const moodAura = document.getElementById('moodAura');
        const moodQuote = document.getElementById('moodQuote');
        const moodTimestamp = document.getElementById('moodTimestamp');
        if (moodTitle) moodTitle.textContent = mood.mood || 'Unknown';
        if (moodEmoji) moodEmoji.textContent = mood.emoji || '🧠';
        if (moodAura) moodAura.textContent = 'Aura: ' + (mood.aura || '–');
        if (moodQuote) moodQuote.textContent = '"' + (mood.observation || mood.quote || '–') + '"';
        if (moodTimestamp) moodTimestamp.textContent = 'Last Updated: ' + new Date().toLocaleTimeString() + ' (AI)';
      }
    });
  }

  // Initialize all render functions
  renderMoodGrid();
  renderMoodScanDemo();
  renderNovaFeels();
  renderMoodCommentary();
  renderMoodTimeline();
});