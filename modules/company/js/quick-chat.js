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

  // ── Demo mode canned responses (no Gemini cost) ──
  var _demoReplies = {
    nova: [
      'All systems nominal. The last heartbeat completed with 3 task mutations and 1 document update. Forge flagged a minor latency spike — monitoring it.',
      'Current priorities: 2 tasks in review, 1 campaign nearing deadline, and Echo has 3 social drafts queued for your approval.',
      'I delegated the infrastructure audit to Forge and the content refresh to Scribe. Both should have updates by the next heartbeat cycle.'
    ],
    cipher: [
      'API spend this week is $12.47 — down 8% from last week. Gemini accounts for 74% of total compute cost.',
      'Budget is tracking within targets. No anomalies detected. The weekly cost report will be ready Monday at 8 AM.',
      'ROI on the last campaign was 3.2x based on engagement metrics. I recommend maintaining current spend levels.'
    ],
    pixel: [
      'The last accessibility scan found 2 minor contrast issues on the dashboard cards. I logged them as tasks for the next sprint.',
      'UI consistency is strong — all component patterns match the design system. The new wiki pages render cleanly on mobile.',
      'Color contrast ratios are passing WCAG AA across all pages. The responsive breakpoints at 768px and 480px are holding well.'
    ],
    forge: [
      'All services green. Last deploy was clean — build time 47s, zero errors. Uptime is 99.97% over the last 30 days.',
      'CI/CD pipeline is healthy. The last 5 deployments completed without rollback. I am monitoring a slow query on the state API.',
      'Infrastructure audit complete. Storage usage is nominal, no security advisories pending, SSL certificates valid for 287 more days.'
    ],
    echo: [
      'I have 3 social drafts ready for review — 1 for X, 1 for LinkedIn, and 1 for Bluesky. All include URLs and are within character limits.',
      'Engagement this week: LinkedIn up 12%, X steady, Bluesky growing. I recommend increasing Bluesky posting frequency.',
      'The product announcement draft is polished and ready. Quill tightened the copy — it reads well across all platforms.'
    ],
    scribe: [
      'The wiki has 8 pages across 4 categories. I recently completed the Automation & Controls runbook and the Agent Guide.',
      'I have a draft product brief in progress. Quill is reviewing it for clarity and brand voice alignment before submission.',
      'Documentation coverage is solid. The getting-started guides are complete. I recommend adding a troubleshooting runbook next.'
    ],
    quill: [
      'I reviewed Scribe\'s latest draft — tightened 3 paragraphs and strengthened the CTA. Ready for your final review.',
      'Brand voice is consistent across all recent content. No tone drift detected. The wiki pages read clean and professional.',
      'The product brief is 18% shorter after my edit pass. Every sentence earns its place. Ready for Scribe to submit.'
    ],
    scout: [
      'Market scan complete. Two competitors launched AI agent features this month. Neither matches our governance depth.',
      'Industry trend: AI-operated companies are gaining traction in SaaS. Our multi-agent architecture is well-positioned.',
      'Competitive intel: the closest competitor has 3 agents vs our 8. Their governance model is flat — no tier system. We have a structural advantage.'
    ]
  };
  var _demoReplyIndex = {};

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

    // Demo mode: canned responses, no API call
    if (window.__DEMO_MODE && _demoReplies[agentId]) {
      _thinking = true;
      sendBtn.disabled = true;
      var replies = _demoReplies[agentId];
      if (!_demoReplyIndex[agentId]) _demoReplyIndex[agentId] = 0;
      var reply = replies[_demoReplyIndex[agentId] % replies.length];
      _demoReplyIndex[agentId]++;
      setTimeout(function () {
        _thinking = false;
        sendBtn.disabled = false;
        addMsg('agent', reply, agent);
      }, 800 + Math.random() * 700);
      return;
    }

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
    // Render basic markdown (bold, bullets, line breaks) instead of raw text
    var html = (text || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^[-*] (.+)$/gm, '<span style="display:block;padding-left:0.8rem;">• $1</span>')
      .replace(/^(\d+)\. (.+)$/gm, '<span style="display:block;padding-left:0.8rem;">$1. $2</span>')
      .replace(/---/g, '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:0.3rem 0;">')
      .replace(/\n/g, '<br>');
    div.innerHTML = html;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function addActionCards(actions) {
    actions.forEach(function (action) {
      var div = document.createElement('div');
      var color = action.success ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)';
      var border = action.success ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)';
      var textColor = action.success ? '#34d399' : '#f87171';
      var iconMap = { 'create-task': 'fa-plus-circle', 'update-task': 'fa-edit', 'move-task': 'fa-arrows-alt', 'comment-task': 'fa-comment', 'create-doc': 'fa-file-alt', 'update-doc': 'fa-file-edit', 'pause-campaign': 'fa-pause-circle', 'resume-campaign': 'fa-play-circle', 'complete-campaign': 'fa-check-circle', 'archive-objective': 'fa-archive', 'propose-campaign': 'fa-bullhorn', 'propose-objective': 'fa-bullseye' };
      var icon = iconMap[action.type] || 'fa-bolt';
      div.style.cssText = 'padding:0.3rem 0.5rem; margin:0.15rem 0; border-radius:6px; background:' + color + '; border:1px solid ' + border + '; font-size:0.65rem; color:' + textColor + '; align-self:flex-start;';
      div.innerHTML = '<i class="fas ' + icon + '"></i> ' + (action.success ? '\u2713' : '\u2717') + ' ' + (action.summary || action.type);
      messages.appendChild(div);
    });
    messages.scrollTop = messages.scrollHeight;
  }

  // Public API (optional — dashboard can call renderAll after chat)
  function suggest(agentId, text) {
    if (agentSel) agentSel.value = agentId || 'nova';
    if (input) input.value = text || '';
    open();
    setTimeout(function () {
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }, 320);
  }

  window.QuickChat = {
    open: open,
    close: close,
    suggest: suggest,
    onAfterSend: null
  };
})();
