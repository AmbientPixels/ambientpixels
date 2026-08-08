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
    // After the UI exists, so a restored roast has somewhere to render and the
    // textareas are there to refill.
    handleCancelledCheckout(params);
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

  // Analytics identity, forwarded so the API can emit run_delivered / run_failed
  // under the SAME visitor this page just filed agent_run_started under.
  // Without it the server's events land on a stranger's id and the two halves of
  // the funnel cannot be compared at all — and the pa_internal device flag,
  // which only this browser knows, would stop excluding our own runs the moment
  // the truth moved server-side.
  let paIdentity = null;
  try { if (window.ProductAnalytics) paIdentity = ProductAnalytics.getIdentity(); } catch (_) {}

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
        secondaryInput: sentSecondary,
        _pa: paIdentity
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
    // Fallback: the model returned something that would not parse as JSON.
    // Two bugs used to compound here. The raw text lives at data.result.raw,
    // not data.raw, so this fell through to JSON.stringify and showed the user
    // a literal {"raw":"..."} envelope. And it returned early, BEFORE the $9
    // upsell at the end of this function — so a malformed response cost both
    // the experience and the sale, silently.
    const raw = (data.result && data.result.raw) || data.raw || '';
    body.innerHTML = '<div class="pa-result-card">' +
      '<div class="pa-result-card-label">The roast</div>' +
      '<div class="pa-result-card-value">' +
      escapeHtml(String(raw) || 'The agent replied in an unexpected format. Try running it again.').replace(/\n/g, '<br>') +
      '</div></div>';
    maybeRenderRewriteUpsell(body);
    revealResult();
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
  renderShareCard(body);
  revealResult();
}

// Show people the card that has their score on it.
//
// The card endpoint has existed all along and the frontend never referenced it
// once — we rendered a branded image of someone's result and only ever handed
// them a URL to paste. Nobody shares an artifact they have not seen. This is the
// only growth mechanic that needs no permission from anyone, so it is worth
// making tangible: the image, and a download, because on LinkedIn and X an image
// outperforms a link and neither lets you paste a URL and get this.
function renderShareCard(body) {
  if (!currentRunId || resultScore() === null) return;   // no number, nothing worth sharing

  const url = getApiBase() + '/pixel-agent-share-card?run=' + encodeURIComponent(currentRunId);
  const card = document.createElement('div');
  card.className = 'pa-result-card pa-share-card';
  card.innerHTML =
    '<div class="pa-result-card-label">Your card</div>' +
    '<img class="pa-share-card-img" alt="Your score card">' +
    '<div class="pa-share-card-actions">' +
      '<button class="pa-run-btn" id="pa-share-dl"><i class="fas fa-download"></i> Save image</button>' +
      '<button class="pa-run-btn pa-run-btn--secondary" id="pa-share-link"><i class="fas fa-link"></i> Copy link</button>' +
    '</div>';
  body.appendChild(card);
  card.querySelector('#pa-share-link').addEventListener('click', shareResult);

  // Fetched and shown as a blob, NOT set as a direct src. The site's CSP allows
  // the API host in connect-src but NOT in img-src, so <img src="{api}/..."> is
  // blocked by the browser and never loads — verified against production, where
  // this silently removed itself. img-src does allow blob:, so fetching the PNG
  // (permitted) and handing the browser an object URL (permitted) works inside
  // the existing policy, with no change to staticwebapp.config.json.
  //
  // The same blob feeds the download, so the image is only fetched once.
  let blobUrl = null;
  fetch(url)
    .then(res => { if (!res.ok) throw new Error('card unavailable'); return res.blob(); })
    .then(blob => {
      blobUrl = URL.createObjectURL(blob);
      card.querySelector('.pa-share-card-img').src = blobUrl;
    })
    .catch(() => card.remove());   // no card is better than a broken image

  card.querySelector('#pa-share-dl').addEventListener('click', () => {
    if (!blobUrl) { showToast('The card is still rendering — try again in a second.'); return; }
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'resume-roast-' + resultScore() + '.png';
    a.click();
    if (window.ProductAnalytics) try { ProductAnalytics.track('share_card_downloaded', { agentId: currentAgent.id, runId: currentRunId }); } catch (_) {}
  });
}

// The run button sits below the fold on a phone, so the user is NECESSARILY
// scrolled down when they press it — measured at 390x844, #pa-result lands at
// y = -49 once the roast renders, putting the "Results" heading and the score
// card itself off the top of the screen. The score is the payoff; they should
// be looking at it. Scrolls the result container into view rather than jumping
// to the top of the document, so the page does not feel reset.
function revealResult() {
  const el = document.getElementById('pa-result');
  if (!el || typeof el.scrollIntoView !== 'function') return;
  const motionOk = !window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    el.scrollIntoView({ behavior: motionOk ? 'smooth' : 'auto', block: 'start' });
  } catch (_) {
    el.scrollIntoView();   // older Safari takes no options object
  }
}

// ── $9 Deep Roast Rewrite upsell (resume-roast only, kill-switched) ──
async function getRewriteConfig() {
  if (rewriteCfg) return rewriteCfg;
  try {
    const res = await fetch(getApiBase() + '/roast-rewrite?config=1');
    // Only a real answer is cached. A cold-start blip used to be stored as
    // { enabled: false } for the life of the page — identical, from the outside,
    // to the kill switch being off: no button, and no rewrite_upsell_view to
    // say otherwise. One flaky fetch must not cost every later sale.
    if (!res.ok) return { unavailable: true };
    rewriteCfg = await res.json();
  } catch (_) {
    return { unavailable: true };
  }
  return rewriteCfg;
}

function maybeRenderRewriteUpsell(body, attempt) {
  if (!currentAgent || currentAgent.id !== 'resume-roast' || !currentInput) return;
  getRewriteConfig().then(cfg => {
    // The config call is the only thing standing between a finished roast and
    // the paid button, so a failure gets a second and third look rather than
    // silently ending the funnel.
    if (cfg && cfg.unavailable) {
      if ((attempt || 0) < 2) {
        setTimeout(function () { maybeRenderRewriteUpsell(body, (attempt || 0) + 1); }, 2000);
      }
      return;
    }
    if (!cfg || !cfg.enabled) return;
    if (document.getElementById('pa-rewrite-btn')) return;
    const price = '$' + (Math.round(cfg.priceCents || 900) / 100);
    const card = document.createElement('div');
    card.className = 'pa-result-card pa-rewrite-upsell';
    card.innerHTML =
      '<div class="pa-result-card-label">Want it fixed, not just roasted?</div>' +
      '<div class="pa-rewrite-upsell-body">Your full roast is free and stays right here. For ' + price + ' we rewrite the resume itself — ATS-optimized, ready to send, built from this exact roast.</div>' +
      '<button class="pa-rewrite-upsell-btn" id="pa-rewrite-btn">Get the full rewrite — ' + price + '</button>' +
      '<div class="pa-rewrite-upsell-note">Ready in minutes · Not happy? We refund, no questions.</div>';
    // Directly under the score, not at the bottom. Measured at 390px the old
    // append put the button at y≈1604 inside an 1838px result — about two
    // screens past where most people stop reading. The score is the moment the
    // offer means anything, and every roast card still sits below it, free and
    // uncut, so this reads as an add-on rather than a gate. With no score card
    // (the raw-text fallback) it appends, so the offer never leads the page.
    const score = body.querySelector('.pa-result-score');
    body.insertBefore(card, score ? score.nextSibling : null);
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
    // Already paid for this exact resume + posting. The API refuses to mint a
    // second checkout for it, so send them to what they already own rather
    // than leaving the button sitting there inviting another attempt. No
    // stashForCancelledCheckout(): nothing is being cancelled, and this is a
    // navigation to the delivered product, not a detour through Stripe.
    if (res.ok && data.alreadyPurchased && data.orderId && data.key) {
      window.location.href = '/resume-roast/rewrite.html?id=' + encodeURIComponent(data.orderId)
        + '&key=' + encodeURIComponent(data.key);
      return;
    }
    if (res.ok && data.checkoutUrl) {
      stashForCancelledCheckout();
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

// ── Cancelled checkout recovery ──
// Stripe's cancel_url lands back here as ?cancelled=1 and nothing else, so
// backing out at the card form — the most ordinary thing a buyer does — used to
// mean a blank page: resume gone, roast gone, button gone, and a re-run costs
// one of five free runs a day. Stash enough to put the screen back untouched.
// sessionStorage rather than local: this is a same-tab round trip, and a pasted
// resume has no business outliving the tab.
const REWRITE_PENDING_KEY = 'pa_rewrite_pending';
const REWRITE_PENDING_TTL = 60 * 60 * 1000;

function stashForCancelledCheckout() {
  try {
    sessionStorage.setItem(REWRITE_PENDING_KEY, JSON.stringify({
      agentId: currentAgent && currentAgent.id,
      input: currentInput,
      secondary: currentSecondary,
      runId: currentRunId,
      result: currentResult,
      ts: Date.now()
    }));
  } catch (_) { /* private mode or quota — the notice below still fires */ }
}

function handleCancelledCheckout(params) {
  // Read-and-clear on every load, cancelled or not, so a resume never lingers
  // in the tab after the trip it was stashed for.
  let stash = null;
  try {
    const raw = sessionStorage.getItem(REWRITE_PENDING_KEY);
    sessionStorage.removeItem(REWRITE_PENDING_KEY);
    if (raw) stash = JSON.parse(raw);
  } catch (_) { /* nothing to restore */ }

  if (!params.get('cancelled')) return;

  const usable = stash && stash.result && stash.agentId === currentAgent.id &&
    (Date.now() - (stash.ts || 0)) < REWRITE_PENDING_TTL;

  if (window.ProductAnalytics) try {
    ProductAnalytics.track('rewrite_checkout_cancelled', { agentId: currentAgent.id, restored: !!usable });
  } catch (_) {}

  // Drop the flag so a refresh, a bookmark, or a shared link is a clean page
  try {
    window.history.replaceState({}, '', window.location.pathname + '?agent=' + encodeURIComponent(currentAgent.id));
  } catch (_) {}

  if (!usable) {
    showRunNotice('No charge was made — you backed out of checkout. Your free runs are untouched; paste your resume to pick up where you left off.');
    return;
  }

  currentResult = stash.result;
  currentRunId = stash.runId || null;
  currentInput = stash.input || null;
  currentSecondary = stash.secondary || null;

  const textEl = document.getElementById('pa-input-text');
  if (textEl && currentInput) textEl.value = currentInput;
  const secEl = document.getElementById('pa-input-secondary');
  if (secEl && currentSecondary) secEl.value = currentSecondary;

  renderResult(currentResult);
  showRunNotice('No charge was made — you backed out of checkout. Your roast is exactly where you left it, and this run did not count against your free five.',
    document.getElementById('pa-result'));
}

// A calm, persistent line above whatever it is explaining. The error panel
// cannot do this job: it hides the result and the input, and a cancelled
// checkout is not an error.
function showRunNotice(msg, host) {
  const parent = host || document.querySelector('.pa-run-shell');
  if (!parent) return;
  let el = document.getElementById('pa-run-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pa-run-notice';
    el.className = 'pa-run-notice';
    el.innerHTML = '<i class="fas fa-circle-info"></i><span></span>';
  }
  el.querySelector('span').textContent = msg;
  parent.insertBefore(el, parent.firstChild);
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

// The agent's own declared score key, same resolution the share card uses
// server-side. Reading result.score directly would work for exactly one of the
// ten scoring agents.
function resultScore() {
  const sections = (currentAgent && currentAgent.outputSections) || [];
  const result = (currentResult && currentResult.result) || {};
  for (const s of sections) {
    if (s.type !== 'score') continue;
    const n = parseFloat(result[s.key]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n);
  }
  return null;
}

async function shareResult() {
  if (!currentResult) return;

  // getApiBase(), NOT window.location.origin. This was the only call in the
  // file building its own URL, and on production the SWA proxy does not route
  // /api/pixel-agent-share — it fell through to navigationFallback and served
  // the AmbientPixels homepage. Verified: that URL returned 20KB of homepage
  // titled "Creative systems. Quiet operations." So every roast anyone shared
  // unfurled as the generic company homepage, with the homepage's own image,
  // and clicking it landed on the homepage rather than the roast.
  var shareUrl = getApiBase() + '/pixel-agent-share?run=' + currentRunId;

  // Lead with the number. "Check out my result" is a link nobody clicks;
  // "I scored 41/100" is the whole reason a roast gets shared at all.
  const score = resultScore();
  const text = score !== null
    ? 'I scored ' + score + '/100 on ' + currentAgent.name + '. Roast yours free:'
    : 'My ' + currentAgent.name + ' result:';

  const shareData = {
    title: score !== null
      ? currentAgent.name + ': ' + score + '/100'
      : currentAgent.name + ' Result — Pixel Agents',
    text: text,
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
