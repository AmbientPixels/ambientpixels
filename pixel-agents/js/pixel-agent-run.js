// Pixel Agent Run — client-side logic for run.html

let currentAgent = null;
let currentResult = null;
let currentRunId = null;
let currentInput = null;
// The job description the roast was scored against, held for the $9 checkout.
let currentSecondary = null;
let rewriteCfg = null;
let _allAgents = []; // all agents for related agent rendering

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
  'vibe-check': [
    'Reading your brand\'s energy...',
    'Analyzing color vibes...',
    'Selecting the perfect visual style...',
    'Generating your visual identity image...',
    'Almost there — image generation takes a moment...'
  ],
  'fridge-raid': [
    'Checking your ingredients...',
    'Brainstorming recipes...',
    'Writing step-by-step instructions...',
    'Generating a photo of your dish...',
    'Almost there — plating the final image...'
  ],
  'prompt-forge': [
    'Analyzing your goal...',
    'Crafting the Character role...',
    'Building the Request...',
    'Adding Examples and Adjustments...',
    'Assembling your complete prompt...'
  ],
  'resume-roast': [
    'Reading your resume...',
    'Running ATS compatibility check...',
    'Preparing the roast...',
    'Writing rewrite suggestions...',
    'Scoring your career document...'
  ],
  'signal': [
    'Scanning the news wire...',
    'Searching for breaking stories...',
    'Filtering the noise...',
    'Assembling your briefing...'
  ],
  'hype-check': [
    'Checking Steam charts...',
    'Scanning gaming news...',
    'Finding hidden gems...',
    'Rating the hype...'
  ],
  'buzz-check': [
    'Scanning the internet...',
    'Detecting viral trends...',
    'Analyzing the buzz...',
    'Making predictions...'
  ],
  'hivemind': [
    'Infiltrating Reddit...',
    'Reading the hot posts...',
    'Feeling the community mood...',
    'Extracting the spiciest takes...'
  ],
  'site-glow-up': [
    'Fetching your site content...',
    'Analyzing layout and design...',
    'Crafting a new color palette...',
    'Generating your redesign concept...',
    'Almost there — rendering the mockup...'
  ],
  'color-thief': [
    'Analyzing the image...',
    'Extracting dominant colors...',
    'Naming the palette...',
    'Suggesting design pairings...'
  ],
  'roast-my-linkedin': [
    'Reading your profile...',
    'Cringing at your headline...',
    'Rewriting your about section...',
    'Preparing the roast...'
  ],
  'eli5': [
    'Reading the complex stuff...',
    'Simplifying for a 5-year-old...',
    'Adding teenage context...',
    'Summarizing for experts...'
  ],
  'startup-obituary': [
    'Examining the startup idea...',
    'Predicting the cause of death...',
    'Writing the timeline...',
    'Composing the eulogy...'
  ],
  'legal-eagle': [
    'Reading the fine print...',
    'Translating legalese...',
    'Scanning for red flags...',
    'Identifying key terms...'
  ],
  'email-fixer': [
    'Analyzing your draft...',
    'Identifying tone issues...',
    'Rewriting for clarity...',
    'Crafting a better subject line...'
  ],
  'code-roast': [
    'Reading your code...',
    'Detecting the language...',
    'Finding bugs and anti-patterns...',
    'Preparing the roast...'
  ],
  'meeting-killer': [
    'Reading the meeting notes...',
    'Extracting action items...',
    'Calculating wasted time...',
    'Delivering the verdict...'
  ],
  'plot-twist': [
    'Analyzing your story...',
    'Brainstorming twists...',
    'Finding the perfect shock...',
    'Setting up foreshadowing...'
  ],
  'debate-me': [
    'Analyzing your position...',
    'Researching counter-arguments...',
    'Building the case against you...',
    'Scoring both sides...'
  ],
  '_default': [
    'Processing your request...',
    'The agent is working on it...',
    'Almost there...'
  ]
};

// Failure classes the user cannot act on. The API answers a dead upstream with
// "encountered a system fault", and a gateway blip answers with nothing at all —
// both read like the user broke something. Say it is ours instead, and say the
// input survived. 429 is deliberately absent: it keeps the API's own message
// because that copy carries the upgrade CTA.
const RUN_ERROR_MESSAGES = {
  502: 'Our agent runner hit a snag on our side — nothing to do with what you pasted. Everything you typed is still here, so give it another go in a moment.',
  503: 'Pixel Agents is at capacity right now — that one is on us. Your input is still here; try again in a moment.',
  504: 'That run took too long on our end and timed out. Your input is still here — try again in a moment.'
};

let isLoggedIn = false;

function getApiBase() {
  return window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';
}

// Check auth status + capture principal for forwarding
var authPrincipalHeader = null;
fetch('/.auth/me').then(r => r.json()).then(d => {
  if (d && d.clientPrincipal) {
    isLoggedIn = true;
    authPrincipalHeader = btoa(JSON.stringify(d.clientPrincipal));
  }
}).catch(() => {});

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get('agent');

  if (!agentId) {
    window.location.href = '/pixel-agents/';
    return;
  }

  try {
    // Load built-in + community agents in parallel
    const [builtInRes, communityRes] = await Promise.all([
      fetch('/pixel-agents/data/pixel-agents.json?v=1'),
      fetch(getApiBase() + '/pixel-agent-community').catch(() => null)
    ]);

    const builtInAgents = await builtInRes.json();
    _allAgents = builtInAgents.filter(a => a.active);
    currentAgent = _allAgents.find(a => a.id === agentId);

    // Fallback: check community agents
    if (communityRes && communityRes.ok) {
      try {
        const commData = await communityRes.json();
        const communityAgents = (commData.agents || []).filter(a => a.active);
        communityAgents.forEach(a => { a.community = true; });
        _allAgents = _allAgents.concat(communityAgents);
        if (!currentAgent) {
          currentAgent = communityAgents.find(a => a.id === agentId);
        }
      } catch (e) { /* non-fatal */ }
    }

    if (!currentAgent) {
      window.location.href = '/pixel-agents/';
      return;
    }

    renderAgentUI(currentAgent);
    renderRelatedAgents(currentAgent);
  } catch (err) {
    console.error('Failed to load agent:', err);
    showError('Failed to load agent configuration.');
  }
});

function renderAgentUI(agent) {
  // Hero + tier gradient
  document.getElementById('pa-agent-name').textContent = agent.name;
  document.getElementById('pa-agent-tagline').textContent = agent.tagline;
  document.title = agent.name + ' — Pixel Agents';

  var header = document.getElementById('pa-run-header');
  if (header) header.setAttribute('data-tier', agent.tier || 'common');

  // Portrait in header
  var portrait = document.getElementById('pa-run-portrait');
  if (portrait) {
    var imgSrc = agent.portraitUrl || '/pixel-agents/img/' + agent.id + '.webp';
    portrait.innerHTML =
      '<img src="' + escapeHtml(imgSrc) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
      '<div class="pa-portrait-fallback" style="display:none"><i class="' + escapeHtml(agent.icon) + '"></i></div>';
  }

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

  // Optional second input — only agents that declare secondaryInput show it.
  const secWrap = document.getElementById('pa-secondary-wrap');
  if (secWrap) {
    if (agent.secondaryInput) {
      document.getElementById('pa-secondary-label').textContent = agent.secondaryInput.label || '';
      const secTa = document.getElementById('pa-input-secondary');
      secTa.placeholder = agent.secondaryInput.placeholder || '';
      secTa.value = '';
      document.getElementById('pa-secondary-help').textContent = agent.secondaryInput.help || '';
      secWrap.style.display = '';
    } else {
      secWrap.style.display = 'none';
    }
  }

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

  // Show loading with agent portrait
  document.getElementById('pa-input-section').style.display = 'none';
  document.getElementById('pa-error').style.display = 'none';
  document.getElementById('pa-result').style.display = 'none';
  document.getElementById('pa-loading').style.display = '';

  var loadPortrait = document.getElementById('pa-loading-portrait');
  if (loadPortrait && currentAgent) {
    var imgSrc = currentAgent.portraitUrl || '/pixel-agents/img/' + currentAgent.id + '.webp';
    loadPortrait.innerHTML = '<img src="' + escapeHtml(imgSrc) + '" alt="" onerror="this.parentElement.style.display=\'none\'">';
  }

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

  // Funnel: agent_run_started — feeds the pixelagents funnel in productAnalyticsQuery
  if (window.ProductAnalytics) try { ProductAnalytics.track('agent_run_started', { agentId: currentAgent.id }); } catch (_) {}

  // Captured once, here, rather than re-read at checkout. The $9 rewrite is
  // sold against the posting the resume was actually SCORED against — if the
  // user edits the box after seeing their roast, the rewrite must not quietly
  // target a different job than the score they just paid to act on.
  const sentSecondary = currentAgent.secondaryInput
    ? (document.getElementById('pa-input-secondary') || {}).value || ''
    : undefined;

  try {
    const hdrs = { 'Content-Type': 'application/json' };
    if (authPrincipalHeader) hdrs['x-cf-auth-principal'] = authPrincipalHeader;
    const res = await fetch(getApiBase() + '/pixel-agent-run', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({
        agentId: currentAgent.id,
        input: input,
        // Only sent when the agent declares a second input and the user filled
        // it in. The API ignores it entirely for agents without the declaration.
        secondaryInput: sentSecondary
      })
    });

    // A gateway 502/504 answers with HTML, not JSON. Tolerate the parse failure
    // so the status check below still runs — otherwise every capacity blip falls
    // through to the catch and gets blamed on the user's connection.
    const data = await res.json().catch(() => null);

    clearInterval(msgInterval);

    if (!res.ok) {
      const serverMsg = data && (data.message || data.error);
      // 502/504 are gateway-shaped: either no body at all, or (before
      // 2026-08-07) the API's own "system fault" copy, which reads like the
      // user broke it — our map wins there. A 503 now carries the API's own
      // specific message, which names the agent and says whether this is
      // capacity or something only we can fix, so that one wins instead.
      showError((res.status === 502 || res.status === 504)
        ? RUN_ERROR_MESSAGES[res.status]
        : (serverMsg || RUN_ERROR_MESSAGES[res.status] || 'Something went wrong.'));
      if (res.status === 429) {
        // Daily limit hit — surface the upgrade path
        const upsell = document.getElementById('pa-error-upsell');
        if (upsell) upsell.classList.add('is-visible');
      }
      return;
    }

    // 200 with a body we cannot read is still our fault, not the connection's
    if (!data) {
      showError(RUN_ERROR_MESSAGES[502]);
      return;
    }

    currentResult = data;
    currentRunId = data.runId;
    currentInput = input;
    currentSecondary = sentSecondary || null;

    // Funnel: agent_run_completed
    if (window.ProductAnalytics) try { ProductAnalytics.track('agent_run_completed', { agentId: currentAgent.id, runId: data.runId }); } catch (_) {}

    // Update remaining allowance line (Pro = unlimited, credits shown when held)
    const remainEl = document.getElementById('pa-remaining');
    if (data.tier === 'pro') {
      remainEl.textContent = 'Pro — unlimited runs';
    } else if (typeof data.remaining === 'number') {
      let line = data.remaining + ' free run' + (data.remaining !== 1 ? 's' : '') + ' remaining today';
      if (typeof data.credits === 'number' && data.credits > 0) {
        line += ' · ' + data.credits + ' credit' + (data.credits !== 1 ? 's' : '');
      }
      remainEl.textContent = line;
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

      case 'image':
        if (!value) break;
        card.className = 'pa-result-card pa-result-image';
        card.innerHTML =
          '<div class="pa-result-card-label">' + escapeHtml(section.label) + '</div>' +
          '<a href="' + escapeAttr(String(value)) + '" target="_blank" rel="noopener">' +
          '<img src="' + escapeAttr(String(value)) + '" alt="Generated visual" class="pa-result-image-img" loading="lazy" />' +
          '</a>';
        body.appendChild(card);
        break;

      case 'color_palette':
        card.className = 'pa-result-card';
        var colors = Array.isArray(value) ? value : [];
        card.innerHTML =
          '<div class="pa-result-card-label">' + escapeHtml(section.label) + '</div>' +
          '<div class="pa-result-palette">' +
          colors.map(function(c) {
            return '<div class="pa-result-swatch">' +
              '<div class="pa-result-swatch-color" style="background:' + escapeAttr(c.hex || '#888') + '"></div>' +
              '<span class="pa-result-swatch-name">' + escapeHtml(c.name || '') + '</span>' +
              '<span class="pa-result-swatch-hex">' + escapeHtml(c.hex || '') + '</span>' +
              '</div>';
          }).join('') +
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

  maybeRenderRewriteUpsell(body);
}

// ── $9 Deep Roast Rewrite upsell (resume-roast only, kill-switched) ──
async function getRewriteConfig() {
  if (rewriteCfg) return rewriteCfg;
  try {
    const res = await fetch(getApiBase() + '/roast-rewrite?config=1');
    rewriteCfg = res.ok ? await res.json() : { enabled: false };
  } catch (_) {
    rewriteCfg = { enabled: false };
  }
  return rewriteCfg;
}

function maybeRenderRewriteUpsell(body) {
  if (!currentAgent || currentAgent.id !== 'resume-roast' || !currentInput) return;
  getRewriteConfig().then(cfg => {
    if (!cfg || !cfg.enabled) return;
    if (document.getElementById('pa-rewrite-btn')) return;
    const price = '$' + (Math.round(cfg.priceCents || 900) / 100);
    const card = document.createElement('div');
    card.className = 'pa-result-card pa-rewrite-upsell';
    card.innerHTML =
      '<div class="pa-result-card-label">Want it fixed, not just roasted?</div>' +
      '<div class="pa-rewrite-upsell-body">Get your resume professionally rewritten — ATS-optimized, ready to send, based on this exact roast.</div>' +
      '<button class="pa-rewrite-upsell-btn" id="pa-rewrite-btn">Get the full rewrite — ' + price + '</button>' +
      '<div class="pa-rewrite-upsell-note">Ready in minutes · Not happy? We refund, no questions.</div>';
    body.appendChild(card);
    document.getElementById('pa-rewrite-btn').addEventListener('click', startRewriteCheckout);
    if (window.ProductAnalytics) try { ProductAnalytics.track('rewrite_upsell_view', { agentId: 'resume-roast' }); } catch (_) {}
  });
}

async function startRewriteCheckout() {
  const btn = document.getElementById('pa-rewrite-btn');
  if (!btn || !currentInput) return;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Opening checkout…';
  if (window.ProductAnalytics) try { ProductAnalytics.track('rewrite_upsell_click', { agentId: 'resume-roast' }); } catch (_) {}
  try {
    const res = await fetch(getApiBase() + '/roast-rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        resumeText: currentInput,
        roastResult: (currentResult && currentResult.result) || null,
        // The page promises, right under the box, that the posting shapes the
        // rewrite too. Until this line existed it shaped only the free score.
        jobDescription: currentSecondary || undefined
      })
    });
    const data = await res.json();
    if (res.ok && data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }
    btn.disabled = false;
    btn.textContent = label;
    alert(data.error || 'Could not start checkout. Please try again.');
  } catch (_) {
    btn.disabled = false;
    btn.textContent = label;
    alert('Network error — please check your connection and try again.');
  }
}

// ── Actions ──
// keepInput: the error panel reuses this to recover in place. The input section
// is only display:none while an error shows, so the values are still sitting in
// the DOM — leaving them alone turns a failed run into one click instead of a
// re-paste. "Run Again" from a finished result still clears for a fresh run.
function resetRun(keepInput) {
  document.getElementById('pa-loading').style.display = 'none';
  document.getElementById('pa-error').style.display = 'none';
  document.getElementById('pa-result').style.display = 'none';
  document.getElementById('pa-input-section').style.display = '';

  // Clear inputs
  if (!keepInput) {
    document.getElementById('pa-input-url').value = '';
    document.getElementById('pa-input-text').value = '';
  }
}

function showError(msg) {
  document.getElementById('pa-loading').style.display = 'none';
  document.getElementById('pa-input-section').style.display = 'none';
  document.getElementById('pa-result').style.display = 'none';

  const errEl = document.getElementById('pa-error');
  document.getElementById('pa-error-text').textContent = msg;
  const upsell = document.getElementById('pa-error-upsell');
  if (upsell) upsell.classList.remove('is-visible');
  // The panel's Try Again must hand the user back their own text — losing a
  // pasted resume to a transient blip costs us the whole session
  const retry = errEl.querySelector('.pa-run-btn');
  if (retry) retry.onclick = function () { resetRun(true); };
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

  // Use the OG-enabled share URL for proper social unfurling
  var shareUrl = window.location.origin + '/api/pixel-agent-share?run=' + currentRunId;

  const shareData = {
    title: currentAgent.name + ' Result — Pixel Agents',
    text: 'Check out my ' + currentAgent.name + ' result on Pixel Agents!',
    url: shareUrl
  };

  if (navigator.share) {
    try { await navigator.share(shareData); } catch { /* cancelled */ }
  } else {
    // Fallback: copy URL
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Share link copied! Paste on LinkedIn, X, or Bluesky for a branded preview.');
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

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Related Agents ──
function renderRelatedAgents(agent) {
  var container = document.getElementById('pa-related');
  var grid = document.getElementById('pa-related-grid');
  if (!container || !grid) return;

  // Same category first, then fill with other agents
  var sameCategory = _allAgents.filter(function (a) {
    return a.category === agent.category && a.id !== agent.id && a.active !== false;
  });
  var others = _allAgents.filter(function (a) {
    return a.category !== agent.category && a.id !== agent.id && a.active !== false;
  });
  var related = sameCategory.concat(others).slice(0, 3);

  if (related.length === 0) return;

  grid.innerHTML = related.map(function (a) {
    var imgSrc = a.portraitUrl || '/pixel-agents/img/' + escapeAttr(a.id) + '.webp';
    return '<a href="/pixel-agents/run.html?agent=' + escapeAttr(a.id) + '" class="pa-related-card">' +
      '<div class="pa-related-card-portrait">' +
        '<img src="' + escapeAttr(imgSrc) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        '<i class="' + escapeHtml(a.icon || 'fas fa-robot') + '" style="display:none"></i>' +
      '</div>' +
      '<div class="pa-related-card-info">' +
        '<div class="pa-related-card-name">' + escapeHtml(a.name) + '</div>' +
        '<div class="pa-related-card-tagline">' + escapeHtml(a.tagline) + '</div>' +
      '</div>' +
    '</a>';
  }).join('');

  container.style.display = '';
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
