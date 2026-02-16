/**
 * Quick Chat — Shared FAB + Drawer component
 * Self-injects HTML into the page body. Requires AgentEngine to be loaded.
 * Include quick-chat.css in <head> and this script after agent-engine.js.
 */
(function () {
  'use strict';

  // Guard: don't double-init, and require AgentEngine
  if (window._quickChatInit) return;
  window._quickChatInit = true;
  if (typeof AgentEngine === 'undefined') {
    console.warn('[QuickChat] AgentEngine not found — skipping init.');
    return;
  }

  // Skip on agent-chat.html (full page chat already present)
  if (window.location.pathname.indexOf('agent-chat.html') !== -1) return;

  // ── Inject HTML ──
  var html =
    '<button class="qc-fab" id="qc-fab" title="Quick Chat" aria-label="Open Quick Chat"><i class="fas fa-comments"></i></button>' +
    '<div class="qc-overlay" id="qc-overlay"></div>' +
    '<div class="qc-drawer" id="qc-drawer" role="dialog" aria-label="Quick Chat">' +
      '<div class="qc-drawer-header">' +
        '<h3><i class="fas fa-comments" style="margin-right:6px; color:#c9a0ff;"></i> Quick Chat</h3>' +
        '<button class="qc-drawer-close" id="qc-drawer-close" aria-label="Close chat"><i class="fas fa-times"></i></button>' +
      '</div>' +
      '<div class="qc-drawer-body" id="qc-messages"></div>' +
      '<div class="qc-drawer-input">' +
        '<select class="qc-select" id="qc-agent" aria-label="Select agent">' +
          '<option value="nova">Nova</option>' +
          '<option value="cipher">Cipher</option>' +
          '<option value="pixel">Pixel</option>' +
          '<option value="forge">Forge</option>' +
          '<option value="echo">Echo</option>' +
          '<option value="scribe">Scribe</option>' +
          '<option value="quill">Quill</option>' +
          '<option value="scout">Scout</option>' +
        '</select>' +
        '<input type="text" class="qc-input" id="qc-input" placeholder="Ask any agent..." aria-label="Chat message" />' +
        '<button class="qc-send" id="qc-send" aria-label="Send message"><i class="fas fa-paper-plane"></i></button>' +
      '</div>' +
      '<div class="qc-drawer-footer">' +
        '<a href="/modules/company/agent-chat.html"><i class="fas fa-expand-alt" style="margin-right:3px;"></i> Open full Agent Chat</a>' +
      '</div>' +
    '</div>';

  var container = document.createElement('div');
  container.id = 'qc-root';
  container.innerHTML = html;
  document.body.appendChild(container);

  // ── DOM refs ──
  var fab = document.getElementById('qc-fab');
  var drawer = document.getElementById('qc-drawer');
  var overlay = document.getElementById('qc-overlay');
  var closeBtn = document.getElementById('qc-drawer-close');
  var messages = document.getElementById('qc-messages');
  var input = document.getElementById('qc-input');
  var sendBtn = document.getElementById('qc-send');
  var agentSel = document.getElementById('qc-agent');

  var _thinking = false;

  // ── Restore last agent ──
  var saved = localStorage.getItem('ap_quick_chat_agent');
  if (saved && agentSel.querySelector('option[value="' + saved + '"]')) {
    agentSel.value = saved;
  }
  agentSel.addEventListener('change', function () {
    try { localStorage.setItem('ap_quick_chat_agent', agentSel.value); } catch (e) {}
  });

  // ── Open / Close ──
  function open() {
    drawer.classList.add('open');
    overlay.classList.add('open');
    fab.style.display = 'none';
    setTimeout(function () { input.focus(); }, 300);
  }
  function close() {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    fab.style.display = '';
    fab.focus();
  }

  fab.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);

  // Focus trap + Escape
  drawer.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') {
      var focusable = drawer.querySelectorAll('button, input, select, a, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ── Send ──
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') send();
  });

  function send() {
    var msg = input.value.trim();
    if (!msg || _thinking) return;

    var agentId = agentSel.value;
    var agent = AgentEngine.getAgent(agentId);

    input.value = '';
    addMsg('user', msg);

    _thinking = true;
    sendBtn.disabled = true;

    AgentEngine.chat(agentId, msg, 'chat').then(function (result) {
      _thinking = false;
      sendBtn.disabled = false;
      if (result && result.reply) {
        addMsg('agent', result.reply, agent);
        if (result.actions && result.actions.length > 0) {
          addActionCards(result.actions);
        }
      } else if (result && typeof result === 'string') {
        addMsg('agent', result, agent);
      } else {
        addMsg('agent', '(no response)', agent);
      }
    }).catch(function () {
      _thinking = false;
      sendBtn.disabled = false;
      addMsg('agent', '(error — try again)');
    });
  }

  function addMsg(role, text) {
    var div = document.createElement('div');
    div.className = 'qc-msg qc-msg--' + role;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function addActionCards(actions) {
    actions.forEach(function (action) {
      var div = document.createElement('div');
      var color = action.success ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)';
      var border = action.success ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)';
      var textColor = action.success ? '#34d399' : '#f87171';
      var iconMap = { 'create-task': 'fa-plus-circle', 'update-task': 'fa-edit', 'move-task': 'fa-arrows-alt', 'comment-task': 'fa-comment', 'create-doc': 'fa-file-alt', 'update-doc': 'fa-file-edit' };
      var icon = iconMap[action.type] || 'fa-bolt';
      div.style.cssText = 'padding:0.3rem 0.5rem; margin:0.15rem 0; border-radius:6px; background:' + color + '; border:1px solid ' + border + '; font-size:0.65rem; color:' + textColor + '; align-self:flex-start;';
      div.innerHTML = '<i class="fas ' + icon + '"></i> ' + (action.success ? '\u2713' : '\u2717') + ' ' + (action.summary || action.type);
      messages.appendChild(div);
    });
    messages.scrollTop = messages.scrollHeight;
  }

  // Public API (optional — dashboard can call renderAll after chat)
  window.QuickChat = {
    open: open,
    close: close,
    onAfterSend: null
  };
})();
