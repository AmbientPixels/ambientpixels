// Pixel Agent Run — client-side logic for run.html

let currentAgent = null;
let currentResult = null;
let currentRunId = null;

const LOADING_MESSAGES = {
  'roast-my-site': [
    'Inspecting your site with zero mercy...',
    'Checking if your hero section actually works...',
    'Counting your missing alt tags...',
    'Measuring how many seconds until visitors bounce...',
    'Preparing the roast...'
  ],
  'thread-it': [
    'Reading your content carefully...',
    'Crafting the perfect LinkedIn hook...',
    'Optimizing for each platform...',
    'Making your words go viral...'
  ],
  'name-storm': [
    'Brainstorming 20 names...',
    'Checking vibes and memorability...',
    'Mixing metaphors and wordplay...',
    'Finding the one that sticks...'
  ],
  'validate-this': [
    'Scanning the market landscape...',
    'Identifying your competitors...',
    'Running a brutally honest analysis...',
    'Checking if VCs would swipe right...'
  ],
  'pitch-doctor': [
    'Reading your pitch deck...',
    'Predicting investor objections...',
    'Rewriting your narrative...',
    'Prescribing improvements...'
  ],
  '_default': [
    'Processing your request...',
    'The agent is working on it...',
    'Almost there...'
  ]
};

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get('agent');

  if (!agentId) {
    window.location.href = '/pixel-agents/';
    return;
  }

  try {
    const res = await fetch('/pixel-agents/data/pixel-agents.json?v=1');
    const agents = await res.json();
    currentAgent = agents.find(a => a.id === agentId && a.active);

    if (!currentAgent) {
      window.location.href = '/pixel-agents/';
      return;
    }

    renderAgentUI(currentAgent);
  } catch (err) {
    console.error('Failed to load agent:', err);
    showError('Failed to load agent configuration.');
  }
});

function renderAgentUI(agent) {
  // Hero
  document.getElementById('pa-agent-name').textContent = agent.name;
  document.getElementById('pa-agent-tagline').textContent = agent.tagline;
  document.title = agent.name + ' — Pixel Agents';

  // Identity card
  document.getElementById('pa-identity-icon').innerHTML =
    '<i class="' + agent.icon + '"></i>';

  const tierEl = document.getElementById('pa-identity-tier');
  tierEl.textContent = agent.tier.charAt(0).toUpperCase() + agent.tier.slice(1);
  tierEl.className = 'pa-run-identity-tier tier-' + agent.tier;

  const capsEl = document.getElementById('pa-identity-caps');
  capsEl.innerHTML = agent.capabilities
    .map(c => '<li>' + escapeHtml(c) + '</li>')
    .join('');

  // Input type
  const urlInput = document.getElementById('pa-input-url');
  const textInput = document.getElementById('pa-input-text');

  if (agent.inputType === 'textarea') {
    urlInput.style.display = 'none';
    textInput.style.display = '';
    textInput.placeholder = agent.inputPlaceholder;
  } else {
    urlInput.style.display = '';
    textInput.style.display = 'none';
    urlInput.placeholder = agent.inputPlaceholder;
  }

  document.getElementById('pa-input-label').textContent = agent.inputLabel;

  // Enter key to submit
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') runAgent(); });
  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runAgent();
  });
}

// ── Run Agent ──
async function runAgent() {
  if (!currentAgent) return;

  const input = currentAgent.inputType === 'textarea'
    ? document.getElementById('pa-input-text').value.trim()
    : document.getElementById('pa-input-url').value.trim();

  if (!input) {
    showError('Please provide an input.');
    return;
  }

  // URL validation
  if (currentAgent.inputValidation === 'url') {
    try { new URL(input); } catch {
      showError('Please enter a valid URL (include https://).');
      return;
    }
  }

  // Show loading
  document.getElementById('pa-input-section').style.display = 'none';
  document.getElementById('pa-error').style.display = 'none';
  document.getElementById('pa-result').style.display = 'none';
  document.getElementById('pa-loading').style.display = '';

  // Cycle loading messages
  const messages = LOADING_MESSAGES[currentAgent.id] || LOADING_MESSAGES._default;
  let msgIdx = 0;
  const loadingEl = document.getElementById('pa-loading-text');
  loadingEl.textContent = messages[0];
  const msgInterval = setInterval(() => {
    msgIdx = (msgIdx + 1) % messages.length;
    loadingEl.textContent = messages[msgIdx];
  }, 2500);

  const btn = document.getElementById('pa-run-btn');
  btn.disabled = true;

  try {
    const res = await fetch('/api/pixel-agent-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: currentAgent.id,
        input: input
      })
    });

    const data = await res.json();

    clearInterval(msgInterval);

    if (!res.ok) {
      showError(data.message || data.error || 'Something went wrong.');
      return;
    }

    currentResult = data;
    currentRunId = data.runId;

    // Update remaining
    const remainEl = document.getElementById('pa-remaining');
    if (typeof data.remaining === 'number') {
      remainEl.textContent = data.remaining + ' free run' + (data.remaining !== 1 ? 's' : '') + ' remaining today';
    }

    renderResult(data);

  } catch (err) {
    clearInterval(msgInterval);
    console.error('Run failed:', err);
    showError('Network error — please check your connection and try again.');
  } finally {
    btn.disabled = false;
  }
}

// ── Render Result ──
function renderResult(data) {
  document.getElementById('pa-loading').style.display = 'none';
  document.getElementById('pa-input-section').style.display = 'none';
  document.getElementById('pa-result').style.display = '';

  const body = document.getElementById('pa-result-body');
  body.innerHTML = '';

  if (!data.result || data.result.raw) {
    // Fallback: raw text
    body.innerHTML = '<div class="pa-result-card"><div class="pa-result-card-value">' +
      escapeHtml(data.raw || JSON.stringify(data.result)).replace(/\n/g, '<br>') +
      '</div></div>';
    return;
  }

  const sections = currentAgent.outputSections || [];
  const result = data.result;

  for (const section of sections) {
    const value = result[section.key];
    if (value === undefined || value === null) continue;

    const card = document.createElement('div');

    switch (section.type) {
      case 'score':
        card.className = 'pa-result-card pa-result-score';
        const scoreNum = typeof value === 'number' ? value : parseInt(value) || 0;
        card.innerHTML =
          '<div class="pa-result-card-label">' + escapeHtml(section.label) + '</div>' +
          '<div class="pa-result-score-number">' + scoreNum + '</div>' +
          '<div class="pa-result-score-label">out of 100</div>' +
          '<div class="pa-result-score-bar"><div class="pa-result-score-fill" style="width: 0%"></div></div>';
        body.appendChild(card);
        // Animate score bar
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            card.querySelector('.pa-result-score-fill').style.width = scoreNum + '%';
          });
        });
        break;

      case 'verdict':
        card.className = 'pa-result-card pa-result-verdict';
        card.innerHTML = '"' + escapeHtml(String(value)) + '"';
        body.appendChild(card);
        break;

      case 'text':
        card.className = 'pa-result-card';
        card.innerHTML =
          '<div class="pa-result-card-label">' + escapeHtml(section.label) + '</div>' +
          '<div class="pa-result-card-value">' + escapeHtml(String(value)).replace(/\n/g, '<br>') + '</div>';
        body.appendChild(card);
        break;

      case 'list':
        card.className = 'pa-result-card';
        const items = Array.isArray(value) ? value : [value];
        card.innerHTML =
          '<div class="pa-result-card-label">' + escapeHtml(section.label) + '</div>' +
          '<ul class="pa-result-list">' +
          items.map(item => '<li>' + escapeHtml(String(item)) + '</li>').join('') +
          '</ul>';
        body.appendChild(card);
        break;

      case 'tags':
        card.className = 'pa-result-card';
        const tags = Array.isArray(value) ? value : [value];
        card.innerHTML =
          '<div class="pa-result-card-label">' + escapeHtml(section.label) + '</div>' +
          '<div class="pa-result-tags">' +
          tags.map(t => '<span class="pa-result-tag">' + escapeHtml(String(t)) + '</span>').join('') +
          '</div>';
        body.appendChild(card);
        break;

      case 'highlight':
        card.className = 'pa-result-card pa-result-highlight';
        card.innerHTML =
          '<div class="pa-result-card-label">' + escapeHtml(section.label) + '</div>' +
          '<div>' + escapeHtml(String(value)) + '</div>';
        body.appendChild(card);
        break;

      case 'name_list':
        card.className = 'pa-result-card';
        const names = Array.isArray(value) ? value : [];
        card.innerHTML =
          '<div class="pa-result-card-label">' + escapeHtml(section.label) + '</div>' +
          '<div class="pa-result-name-list">' +
          names.map(n =>
            '<div class="pa-result-name-item">' +
            '<div><span class="pa-result-name-item-name">' + escapeHtml(n.name || '') + '</span>' +
            (n.why ? '<div class="pa-result-name-item-why">' + escapeHtml(n.why) + '</div>' : '') +
            '</div>' +
            '<span class="pa-result-name-item-vibe">' + escapeHtml(n.vibe || n.style || '') + '</span>' +
            '</div>'
          ).join('') +
          '</div>';
        body.appendChild(card);
        break;

      default:
        card.className = 'pa-result-card';
        card.innerHTML =
          '<div class="pa-result-card-label">' + escapeHtml(section.label) + '</div>' +
          '<div class="pa-result-card-value">' + escapeHtml(String(value)) + '</div>';
        body.appendChild(card);
    }
  }
}

// ── Actions ──
function resetRun() {
  document.getElementById('pa-loading').style.display = 'none';
  document.getElementById('pa-error').style.display = 'none';
  document.getElementById('pa-result').style.display = 'none';
  document.getElementById('pa-input-section').style.display = '';

  // Clear inputs
  document.getElementById('pa-input-url').value = '';
  document.getElementById('pa-input-text').value = '';
}

function showError(msg) {
  document.getElementById('pa-loading').style.display = 'none';
  document.getElementById('pa-input-section').style.display = 'none';
  document.getElementById('pa-result').style.display = 'none';

  const errEl = document.getElementById('pa-error');
  document.getElementById('pa-error-text').textContent = msg;
  errEl.style.display = '';
}

async function copyResult() {
  if (!currentResult) return;
  try {
    const text = formatResultAsText(currentResult);
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!');
  } catch {
    showToast('Copy failed — try selecting the text manually.');
  }
}

async function shareResult() {
  if (!currentResult) return;

  const shareData = {
    title: currentAgent.name + ' — Pixel Agents',
    text: 'Check out my ' + currentAgent.name + ' result!',
    url: window.location.origin + (currentResult.shareUrl || window.location.pathname)
  };

  if (navigator.share) {
    try { await navigator.share(shareData); } catch { /* cancelled */ }
  } else {
    // Fallback: copy URL
    try {
      await navigator.clipboard.writeText(shareData.url);
      showToast('Share link copied!');
    } catch {
      showToast('Copy the URL from the address bar to share.');
    }
  }
}

function formatResultAsText(data) {
  if (!data.result) return data.raw || '';

  const lines = [];
  lines.push(currentAgent.name + ' Results');
  lines.push('═'.repeat(40));

  const sections = currentAgent.outputSections || [];
  for (const section of sections) {
    const value = data.result[section.key];
    if (value === undefined || value === null) continue;

    lines.push('');
    lines.push(section.label.toUpperCase());

    if (Array.isArray(value)) {
      value.forEach(item => {
        if (typeof item === 'object') {
          lines.push('  • ' + (item.name || JSON.stringify(item)));
        } else {
          lines.push('  • ' + item);
        }
      });
    } else {
      lines.push(String(value));
    }
  }

  lines.push('');
  lines.push('— Generated by Pixel Agents (ambientpixels.ai)');
  return lines.join('\n');
}

// ── Helpers ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg) {
  let toast = document.querySelector('.pa-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'pa-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}
