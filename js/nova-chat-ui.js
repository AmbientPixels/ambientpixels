// nova-chat-ui.js — Nova Chat Interface Controller
// Binds NovaSoul engine to the chat UI elements

(function () {
  'use strict';

  let chatMessages, chatInput, chatSend, statusDot, statusText, thinkingEl;
  let isInitialized = false;

  function init() {
    chatMessages = document.getElementById('nova-chat-messages');
    chatInput = document.getElementById('nova-chat-input');
    chatSend = document.getElementById('nova-chat-send');
    statusDot = document.querySelector('.nova-status-dot');
    statusText = document.querySelector('.nova-chat-status-label');

    if (!chatMessages || !chatInput || !chatSend) {
      console.warn('[NovaChatUI] Chat elements not found, skipping init.');
      return;
    }

    isInitialized = true;

    // Bind NovaSoul events
    NovaSoul.on('thinking', onThinking);
    NovaSoul.on('response', onResponse);
    NovaSoul.on('awake', onAwake);
    NovaSoul.on('error', onError);
    NovaSoul.on('mood-update', onMoodUpdate);

    // Bind UI events
    chatSend.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    chatInput.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // Quick prompt buttons
    document.querySelectorAll('.nova-quick-prompt').forEach(btn => {
      btn.addEventListener('click', function () {
        chatInput.value = this.dataset.prompt;
        sendMessage();
      });
    });

    // Clear history button
    const clearBtn = document.getElementById('nova-chat-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        NovaSoul.clearMemory('history');
        chatMessages.innerHTML = getWelcomeHTML();
        bindQuickPrompts();
      });
    }

    // Restore persisted chat history into the UI
    restorePersistedChat();

    // Wake Nova
    wakeNova();
  }

  function restorePersistedChat() {
    const history = NovaSoul.getHistory();
    if (history.length === 0) return;

    // We have persisted history — show it instead of the welcome screen
    clearWelcome();
    // Show last 10 messages (5 exchanges) to keep UI clean
    const recent = history.slice(-10);
    recent.forEach(function (turn) {
      addMessage(turn.role === 'user' ? 'user' : 'nova', turn.text, true);
    });
    console.log('[NovaChatUI] Restored ' + recent.length + ' messages from memory.');
  }

  async function wakeNova() {
    const stats = NovaSoul.getMemoryStats();
    const hasMemory = stats.chatTurns > 0;
    setStatus('waking', hasMemory ? 'Reconnecting...' : 'Waking Nova...');

    try {
      const mood = await NovaSoul.wake();
      if (mood) {
        if (hasMemory) {
          // Nova has memory — welcome back message
          const wb = await NovaSoul.chat('The operator has returned. Provide a brief welcome-back and one concise readiness status line. 1 sentence max.');
          if (wb) {
            clearWelcome();
            addMessage('nova', wb);
          }
        } else {
          // First time — normal greeting
          const greeting = await NovaSoul.chat("You just initialized. Greet the operator with a brief readiness message and invite the next instruction. Keep it to 1-2 sentences.");
          if (greeting) {
            clearWelcome();
            addMessage('nova', greeting);
          }
        }
      }
    } catch (err) {
      console.error('[NovaChatUI] Wake failed:', err);
      setStatus('error', 'Connection failed');
    }
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = '';
    chatInput.style.height = 'auto';
    chatSend.disabled = true;

    clearWelcome();
    addMessage('user', text);

    const reply = await NovaSoul.chat(text);
    if (reply) {
      addMessage('nova', reply);
    } else {
      addMessage('nova', 'Response unavailable right now. Please retry in a moment.');
    }

    chatSend.disabled = false;
    chatInput.focus();
  }

  function addMessage(role, text, isRestored) {
    if (!chatMessages) return;

    const msg = document.createElement('div');
    msg.className = `nova-msg ${role}`;
    if (isRestored) msg.classList.add('restored');

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (role === 'nova') {
      msg.innerHTML = `
        <img src="/images/nova/A_living_cosmic_system_diagram_organic_neural_style_wi_03.png" alt="Nova" class="nova-msg-avatar" />
        <div>
          <div class="nova-msg-bubble">${escapeHtml(text)}</div>
          <span class="nova-msg-time">${time}</span>
        </div>
      `;
    } else {
      msg.innerHTML = `
        <div class="nova-msg-avatar"><i class="fas fa-user"></i></div>
        <div>
          <div class="nova-msg-bubble">${escapeHtml(text)}</div>
          <span class="nova-msg-time">${time}</span>
        </div>
      `;
    }

    removeThinking();
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showThinking() {
    if (!chatMessages || chatMessages.querySelector('.nova-thinking')) return;

    const el = document.createElement('div');
    el.className = 'nova-thinking';
    el.innerHTML = `
      <div class="nova-thinking-dots">
        <span></span><span></span><span></span>
      </div>
      <span class="nova-thinking-text">Nova is composing...</span>
    `;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function removeThinking() {
    if (!chatMessages) return;
    const el = chatMessages.querySelector('.nova-thinking');
    if (el) el.remove();
  }

  function clearWelcome() {
    if (!chatMessages) return;
    const welcome = chatMessages.querySelector('.nova-chat-welcome');
    if (welcome) welcome.remove();
  }

  function setStatus(state, label) {
    if (statusDot) {
      statusDot.className = 'nova-status-dot';
      if (state) statusDot.classList.add(state);
    }
    if (statusText) {
      statusText.textContent = label || '';
    }
  }

  // Event handlers
  function onThinking(isThinking) {
    if (isThinking) {
      showThinking();
      setStatus('thinking', 'Thinking...');
    } else {
      removeThinking();
      if (NovaSoul.isAwake()) setStatus('awake', 'Online');
    }
  }

  function onResponse() {
    setStatus('awake', 'Online');
  }

  function onAwake() {
    setStatus('awake', 'Online');
  }

  function onError(msg) {
    setStatus('error', 'Error');
    console.error('[NovaChatUI] Error:', msg);
  }

  function onMoodUpdate(mood) {
    if (!mood) return;
    // Fire global NovaMoodUpdate event for other systems
    document.dispatchEvent(new CustomEvent('NovaMoodUpdate', {
      detail: { mood: mood.mood, aura: mood.aura }
    }));
  }

  function getWelcomeHTML() {
    return `
      <div class="nova-chat-welcome">
        <div class="nova-chat-welcome-icon"><i class="fas fa-user-tie"></i></div>
        <h4>Operator link active</h4>
        <p>Try one of these prompts:</p>
        <div class="nova-quick-prompts">
          <button class="nova-quick-prompt" data-prompt="Give me today's execution summary.">Today's summary</button>
          <button class="nova-quick-prompt" data-prompt="What are the top risks right now?">Top risks</button>
          <button class="nova-quick-prompt" data-prompt="What should the founder prioritize next?">Founder priority</button>
          <button class="nova-quick-prompt" data-prompt="List notable system signals from the last cycle.">System signals</button>
        </div>
      </div>
    `;
  }

  function bindQuickPrompts() {
    document.querySelectorAll('.nova-quick-prompt').forEach(btn => {
      btn.addEventListener('click', function () {
        chatInput.value = this.dataset.prompt;
        sendMessage();
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
