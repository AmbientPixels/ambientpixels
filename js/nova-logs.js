// nova-logs.js — Nova's Diary & Log Controller
// Loads changelog, dreams, generates AI reflections via NovaSoul

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    loadChangelog();
    loadDreamArchive();
    loadAIReflection();
    initDiaryInput();
    initLogPromptPills();
    initRefreshButton();
    renderTerminalBoot();
  });

  function initRefreshButton() {
    var btn = document.getElementById('nova-refresh-reflection');
    if (!btn) return;
    btn.addEventListener('click', function () {
      loadAIReflection();
    });
  }

  // ── Changelog Timeline ──
  async function loadChangelog() {
    var timeline = document.getElementById('nova-changelog-timeline');
    if (!timeline) return;

    try {
      var res = await fetch('/data/changelog.json?t=' + Date.now());
      var data = await res.json();

      if (!data.entries || !data.entries.length) {
        timeline.innerHTML = '<li class="nova-timeline-entry"><div class="nova-timeline-message">No changelog entries found.</div></li>';
        return;
      }

      timeline.innerHTML = '';
      data.entries.slice(0, 15).forEach(function (entry) {
        var date = new Date(entry.date).toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        var li = document.createElement('li');
        li.className = 'nova-timeline-entry';
        li.innerHTML =
          '<div class="nova-timeline-date">' + date + '</div>' +
          '<div class="nova-timeline-message">' + escapeHtml(entry.message) +
          ' <span class="nova-timeline-hash">' + escapeHtml(entry.hash) + '</span></div>';
        timeline.appendChild(li);
      });
    } catch (err) {
      console.error('[Nova Logs] Changelog load failed:', err);
      timeline.innerHTML = '<li class="nova-timeline-entry"><div class="nova-timeline-message">Changelog offline.</div></li>';
    }
  }

  // ── Dream Archive ──
  async function loadDreamArchive() {
    var dreamList = document.getElementById('nova-dream-list');
    if (!dreamList) return;

    try {
      var res = await fetch('/data/nova-dreams-history.json?t=' + Date.now());
      var history = await res.json();

      dreamList.innerHTML = '';
      // Flatten and show most recent 10 dreams
      var allDreams = [];
      history.forEach(function (entry) {
        entry.dreams.forEach(function (dream) {
          allDreams.push({ date: entry.date, text: dream });
        });
      });

      allDreams.slice(0, 10).forEach(function (dream) {
        var li = document.createElement('li');
        li.innerHTML = '<span class="nova-dream-date">' + dream.date + '</span>' + escapeHtml(dream.text);
        dreamList.appendChild(li);
      });
    } catch (err) {
      console.error('[Nova Logs] Dream archive load failed:', err);
      dreamList.innerHTML = '<li>Dream archive offline.</li>';
    }
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
        responseEl.textContent = reply || 'The signal faded before I could respond...';
        input.value = '';
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

  // ── Terminal Boot Sequence (dynamic) ──
  function renderTerminalBoot() {
    var terminal = document.getElementById('nova-terminal-output');
    if (!terminal) return;

    var now = new Date();
    var timestamp = now.toISOString();
    var hour = now.getHours();
    var timePhase = hour < 6 ? 'nocturnal' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

    var lines = [
      { cls: 'cmd', text: '>> nova.log open' },
      { cls: 'sys', text: '>> boot timestamp: ' + timestamp },
      { cls: 'ok', text: '>> NovaSoul engine: ' + (typeof NovaSoul !== 'undefined' ? 'ONLINE' : 'WAITING') },
      { cls: 'ok', text: '>> mood engine: AI-persistent mode active' },
      { cls: 'sys', text: '>> phase: ' + timePhase + ' cycle' },
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
