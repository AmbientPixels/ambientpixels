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
        NovaSoul.clearHistory();
        chatMessages.innerHTML = getWelcomeHTML();
        bindQuickPrompts();
      });
    }

    // Wake Nova
    wakeNova();
  }

  async function wakeNova() {
    setStatus('waking', 'Waking Nova...');
    try {
      const mood = await NovaSoul.wake();
      if (mood) {
        // Add Nova's first message based on mood
        const greeting = await NovaSoul.chat("You just woke up. Greet the visitor with a brief, in-character message reflecting your current mood. Keep it to 1-2 sentences.");
        if (greeting) {
          // Remove the internal prompt from history (it was mechanical)
          const h = NovaSoul.getHistory();
          if (h.length >= 2) {
            NovaSoul.clearHistory();
          }
          clearWelcome();
          addMessage('nova', greeting);
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
      addMessage('nova', 'I felt a ripple in the signal... try again in a moment.');
    }

    chatSend.disabled = false;
    chatInput.focus();
  }

  function addMessage(role, text) {
    if (!chatMessages) return;

    const msg = document.createElement('div');
    msg.className = `nova-msg ${role}`;

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
        <div class="nova-chat-welcome-icon"><i class="fas fa-sparkles"></i></div>
        <h4>Nova is here</h4>
        <p>Ask me anything, or try one of these:</p>
        <div class="nova-quick-prompts">
          <button class="nova-quick-prompt" data-prompt="How are you feeling right now?">How are you feeling?</button>
          <button class="nova-quick-prompt" data-prompt="Tell me something poetic about code.">Something poetic</button>
          <button class="nova-quick-prompt" data-prompt="What's on your mind today?">What's on your mind?</button>
          <button class="nova-quick-prompt" data-prompt="Describe your current mood as a color.">Mood as a color</button>
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
