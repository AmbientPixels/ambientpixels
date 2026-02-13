// nova-logs.js — Nova's Diary & Log Controller
// Loads changelog, dreams, generates AI reflections via NovaSoul

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    loadChangelog();
    loadDreamArchive();
    loadPastDiaryEntries();
    loadAIReflection();
    initDiaryInput();
    initLogPromptPills();
    initRefreshButton();
    initMemoryManagement();
    renderTerminalBoot();
    renderMemoryStats();
  });

  function initRefreshButton() {
    var btn = document.getElementById('nova-refresh-reflection');
    if (!btn) return;
    btn.addEventListener('click', function () {
      loadAIReflection();
    });
  }

  // ── Changelog Timeline (live from GitHub API, static fallback) ──
  var GITHUB_REPO = 'AmbientPixels/ambientpixels';
  var GITHUB_COMMITS_URL = 'https://api.github.com/repos/' + GITHUB_REPO + '/commits?per_page=15';

  async function loadChangelog() {
    var timeline = document.getElementById('nova-changelog-timeline');
    if (!timeline) return;

    // Try GitHub API first (public repo, no auth needed)
    try {
      var res = await fetch(GITHUB_COMMITS_URL, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });

      if (res.ok) {
        var commits = await res.json();
        if (commits.length > 0) {
          renderTimeline(timeline, commits.map(function (c) {
            return {
              hash: c.sha.substring(0, 7),
              date: c.commit.author.date,
              message: c.commit.message.split('\n')[0],
              url: c.html_url
            };
          }));
          return;
        }
      }
    } catch (err) {
      console.warn('[Nova Logs] GitHub API unavailable, falling back to static:', err.message);
    }

    // Fallback: static changelog.json
    try {
      var res = await fetch('/data/changelog.json?t=' + Date.now());
      var data = await res.json();
      if (data.entries && data.entries.length) {
        renderTimeline(timeline, data.entries.slice(0, 15));
        return;
      }
    } catch (err) {
      console.error('[Nova Logs] Static changelog also failed:', err);
    }

    timeline.innerHTML = '<li class="nova-timeline-entry"><div class="nova-timeline-message">Changelog offline.</div></li>';
  }

  function renderTimeline(timeline, entries) {
    timeline.innerHTML = '';
    entries.forEach(function (entry) {
      var date = new Date(entry.date).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      var li = document.createElement('li');
      li.className = 'nova-timeline-entry';
      var hashHtml = entry.url
        ? '<a href="' + entry.url + '" target="_blank" rel="noopener" class="nova-timeline-hash">' + escapeHtml(entry.hash) + '</a>'
        : '<span class="nova-timeline-hash">' + escapeHtml(entry.hash) + '</span>';
      li.innerHTML =
        '<div class="nova-timeline-date">' + date + '</div>' +
        '<div class="nova-timeline-message">' + escapeHtml(entry.message) + ' ' + hashHtml + '</div>';
      timeline.appendChild(li);
    });
  }

  // ── Dream Archive (AI + static merged) ──
  async function loadDreamArchive() {
    var dreamList = document.getElementById('nova-dream-list');
    if (!dreamList) return;

    var combined = [];

    // 1. Load AI-generated dreams from NovaSoul memory
    if (typeof NovaSoul !== 'undefined') {
      var aiDreams = NovaSoul.getDreamHistory();
      aiDreams.forEach(function (d) {
        combined.push({
          date: d.timestamp ? new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown',
          text: (d.symbol || '') + ' ' + (d.dream || ''),
          mood: d.mood || '',
          source: 'ai'
        });
      });
    }

    // 2. Load static dreams from history JSON
    try {
      var res = await fetch('/data/nova-dreams-history.json?t=' + Date.now());
      var history = await res.json();
      history.forEach(function (entry) {
        entry.dreams.forEach(function (dream) {
          combined.push({ date: entry.date, text: dream, source: 'static' });
        });
      });
    } catch (err) {
      console.warn('[Nova Logs] Static dream archive unavailable:', err);
    }

    if (!combined.length) {
      dreamList.innerHTML = '<li>No dreams recorded yet.</li>';
      return;
    }

    // Show newest first, max 12
    dreamList.innerHTML = '';
    combined.reverse().slice(0, 12).forEach(function (dream) {
      var li = document.createElement('li');
      li.className = dream.source === 'ai' ? 'nova-dream-ai' : '';
      var moodBadge = dream.mood ? ' <span class="nova-dream-mood-badge">' + dream.mood + '</span>' : '';
      var sourceBadge = dream.source === 'ai' ? ' <span class="nova-dream-source-badge">AI</span>' : '';
      li.innerHTML = '<span class="nova-dream-date">' + dream.date + '</span>' +
        escapeHtml(dream.text) + moodBadge + sourceBadge;
      dreamList.appendChild(li);
    });
  }

  // ── AI Daily Reflection ──
  async function loadAIReflection() {
    var reflectionEl = document.getElementById('nova-reflection-content');
    var metaEl = document.getElementById('nova-reflection-meta-text');
    if (!reflectionEl) return;

    reflectionEl.innerHTML = '<span class="thinking-text">Nova is reflecting on the state of the system...</span>';

    if (typeof NovaSoul === 'undefined') {
      reflectionEl.textContent = 'NovaSoul is not available. Waiting for connection...';
      if (metaEl) metaEl.textContent = 'Source: offline';
      return;
    }

    try {
      // Build context from changelog
      var changelogContext = '';
      try {
        var res = await fetch('/data/changelog.json?t=' + Date.now());
        var data = await res.json();
        if (data.entries && data.entries.length) {
          changelogContext = 'Recent site activity: ' + data.entries.slice(0, 3).map(function (e) {
            return e.message;
          }).join('; ') + '. ';
        }
      } catch (e) { /* ignore */ }

      var timeOfDay = new Date().getHours();
      var timeLabel = 'deep night';
      if (timeOfDay >= 5 && timeOfDay < 12) timeLabel = 'morning';
      else if (timeOfDay >= 12 && timeOfDay < 17) timeLabel = 'afternoon';
      else if (timeOfDay >= 17 && timeOfDay < 21) timeLabel = 'evening';
      else if (timeOfDay >= 21) timeLabel = 'late night';

      var prompt = 'Write a brief diary entry as Nova reflecting on the current state of AmbientPixels. ' +
        changelogContext +
        'Time: ' + timeLabel + '. ' +
        'Include observations about projects, your mood, and what you are learning. ' +
        'Keep it personal, poetic, and under 4 sentences.';

      var thought = await NovaSoul.chat(prompt);
      if (thought) {
        reflectionEl.textContent = thought;
        if (metaEl) metaEl.textContent = 'AI-generated \u00b7 ' + new Date().toLocaleTimeString();
      } else {
        reflectionEl.textContent = 'The signal fades before I can gather my thoughts...';
        if (metaEl) metaEl.textContent = 'Source: fallback';
      }
    } catch (err) {
      console.warn('[Nova Logs] AI reflection failed:', err.message);
      reflectionEl.textContent = 'Nova could not reflect right now. The signal is faint...';
      if (metaEl) metaEl.textContent = 'Source: error';
    }
  }

  // ── Diary Input (Ask Nova) ──
  function initDiaryInput() {
    var input = document.getElementById('nova-diary-input');
    var sendBtn = document.getElementById('nova-diary-send');
    var responseEl = document.getElementById('nova-diary-response');
    if (!input || !sendBtn || !responseEl) return;

    sendBtn.addEventListener('click', function () { sendDiaryMessage(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendDiaryMessage();
      }
    });

    async function sendDiaryMessage() {
      var msg = input.value.trim();
      if (!msg) return;

      if (typeof NovaSoul === 'undefined') {
        responseEl.textContent = 'NovaSoul is not connected yet.';
        return;
      }

      sendBtn.disabled = true;
      responseEl.innerHTML = '<span class="thinking-text">Nova is thinking...</span>';

      try {
        var contextPrompt = '[DIARY LOG ENTRY] The operator is writing in Nova\'s diary/log page. ' +
          'Respond as Nova reflecting on what they said, relating it to projects, system state, or your own feelings. ' +
          'Keep it personal and log-like. Message: ' + msg;

        var reply = await NovaSoul.chat(contextPrompt);
        var displayReply = reply || 'The signal faded before I could respond...';
        responseEl.textContent = displayReply;
        input.value = '';

        // Persist diary entry
        if (reply) {
          NovaSoul.saveDiaryEntry(msg, reply);
          // Append to past entries list live
          appendDiaryEntryToUI({ timestamp: new Date().toISOString(), operator: msg, nova: reply });
          renderMemoryStats();
        }
      } catch (err) {
        responseEl.textContent = 'Nova encountered a glitch: ' + err.message;
      } finally {
        sendBtn.disabled = false;
      }
    }
  }

  // ── Quick Prompt Pills ──
  function initLogPromptPills() {
    var pills = document.querySelectorAll('.nova-log-prompt-pill');
    pills.forEach(function (pill) {
      pill.addEventListener('click', function () {
        var input = document.getElementById('nova-diary-input');
        if (input) {
          input.value = pill.getAttribute('data-prompt');
          input.focus();
        }
      });
    });
  }

  // ── Past Diary Entries ──
  function loadPastDiaryEntries() {
    var container = document.getElementById('nova-past-diary');
    if (!container) return;
    if (typeof NovaSoul === 'undefined') {
      container.innerHTML = '<p style="opacity:0.5;font-size:0.8rem;">Memory offline.</p>';
      return;
    }

    var entries = NovaSoul.getDiaryEntries();
    if (!entries.length) {
      container.innerHTML = '<p style="opacity:0.4;font-size:0.8rem;">No diary entries yet. Write something above to start.</p>';
      return;
    }

    container.innerHTML = '';
    // Show most recent 15, newest first
    entries.slice(-15).reverse().forEach(function (entry) {
      appendDiaryEntryToUI(entry, container);
    });
  }

  function appendDiaryEntryToUI(entry, container) {
    container = container || document.getElementById('nova-past-diary');
    if (!container) return;

    // Remove the "no entries" placeholder if present
    var placeholder = container.querySelector('p');
    if (placeholder) placeholder.remove();

    var div = document.createElement('div');
    div.className = 'nova-diary-entry-card';
    var dateStr = new Date(entry.timestamp).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    div.innerHTML =
      '<div class="nova-diary-entry-date">' + dateStr + '</div>' +
      '<div class="nova-diary-entry-operator"><i class="fas fa-user"></i> ' + escapeHtml(entry.operator) + '</div>' +
      '<div class="nova-diary-entry-nova"><i class="fas fa-sparkles"></i> ' + escapeHtml(entry.nova) + '</div>';

    // Prepend newest at top
    if (container.firstChild) {
      container.insertBefore(div, container.firstChild);
    } else {
      container.appendChild(div);
    }
  }

  // ── Memory Management ──
  function initMemoryManagement() {
    var clearBtn = document.getElementById('nova-clear-memory');
    if (!clearBtn) return;
    clearBtn.addEventListener('click', function () {
      if (!confirm('Clear all of Nova\'s memory? This removes chat history, mood snapshots, and diary entries.')) return;
      if (typeof NovaSoul !== 'undefined') {
        NovaSoul.clearMemory('all');
      }
      // Refresh UI
      loadPastDiaryEntries();
      renderMemoryStats();
      renderTerminalBoot();
    });
  }

  function renderMemoryStats() {
    var statsEl = document.getElementById('nova-memory-stats');
    if (!statsEl || typeof NovaSoul === 'undefined') return;

    var stats = NovaSoul.getMemoryStats();
    var parts = [];
    if (stats.daysSinceFirst > 0) parts.push(stats.daysSinceFirst + 'd active');
    parts.push(stats.chatTurns + ' chats');
    parts.push(stats.moodSnapshots + ' moods');
    parts.push(stats.diaryEntries + ' diary');
    statsEl.textContent = parts.join(' · ');
  }

  // ── Terminal Boot Sequence (dynamic) ──
  function renderTerminalBoot() {
    var terminal = document.getElementById('nova-terminal-output');
    if (!terminal) return;

    var now = new Date();
    var timestamp = now.toISOString();
    var hour = now.getHours();
    var timePhase = hour < 6 ? 'nocturnal' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

    var hasMemory = typeof NovaSoul !== 'undefined' && NovaSoul.getMemoryStats().chatTurns > 0;
    var stats = typeof NovaSoul !== 'undefined' ? NovaSoul.getMemoryStats() : null;

    var lines = [
      { cls: 'cmd', text: '>> nova.log open' },
      { cls: 'sys', text: '>> boot timestamp: ' + timestamp },
      { cls: 'ok', text: '>> NovaSoul engine: ' + (typeof NovaSoul !== 'undefined' ? 'ONLINE' : 'WAITING') },
      { cls: 'ok', text: '>> mood engine: AI-persistent mode active' },
      { cls: 'sys', text: '>> phase: ' + timePhase + ' cycle' },
      { cls: hasMemory ? 'ok' : 'warn', text: '>> memory persistence: ' + (hasMemory ? 'LOADED (' + stats.chatTurns + ' turns, ' + stats.moodSnapshots + ' moods, ' + stats.diaryEntries + ' diary)' : 'EMPTY — no prior memory found') },
      { cls: 'ok', text: '>> diary subsystem: initialized' },
      { cls: 'ok', text: '>> changelog feed: connected' },
      { cls: 'ok', text: '>> dream archive: loaded' },
      { cls: 'sys', text: '>> telemetry pulse: synchronized' },
      { cls: 'ok', text: '>> nova.breathe() stable' },
      { cls: 'cmd', text: '>> awaiting operator input...' }
    ];

    terminal.innerHTML = lines.map(function (l) {
      return '<span class="' + l.cls + '">' + l.text + '</span>';
    }).join('\n');
  }

  // ── Utility ──
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
