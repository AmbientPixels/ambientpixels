// Agent Forge — Builder Logic
// Card pipeline drag-and-drop agent builder

// ── State ──
var agentState = {
  identity: { name: '', tagline: '', description: '', icon: 'fas fa-question', category: 'tools', tier: 'common', portrait: null },
  input: { type: 'textarea', label: '', placeholder: '', validation: 'text' },
  prompt: { systemPrompt: '', userPromptTemplate: '{{input}}', temperature: 0.8, maxTokens: 1500 },
  output: { sections: [] },
  powers: { webSearch: false, fetchUrl: false, imageGeneration: false, rateLimitCost: 1, imageConfig: { outputType: 'square_image', topicPrefix: '' } }
};

var pipelineOrder = []; // which components are in the pipeline
var isLoggedIn = false;
var currentDraftId = null;
var agentStatus = 'draft'; // draft, reviewing, returned, submitted, approved, rejected
var lastReview = null; // last AI review result
var _editMode = false; // true when editing an existing live agent
var _editAgentId = null; // original agent ID being edited
var _liveAgentsCache = []; // cache of live agent configs for edit loading

// Check auth
fetch('/.auth/me').then(function(r) { return r.json(); }).then(function(d) {
  if (d && d.clientPrincipal) isLoggedIn = true;
}).catch(function() {});

function getApiBase() {
  return window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';
}

// ── Icons for picker ──
var ICON_LIST = [
  'fa-fire','fa-bolt','fa-brain','fa-code','fa-palette','fa-gamepad','fa-utensils','fa-gavel',
  'fa-file-alt','fa-envelope-open-text','fa-satellite-dish','fa-users','fa-magic','fa-child',
  'fa-skull-crossbones','fa-eye-dropper','fa-masks-theater','fa-scale-balanced','fa-search',
  'fa-chart-bar','fa-lightbulb','fa-rocket','fa-shield-alt','fa-star','fa-heart','fa-trophy',
  'fa-globe','fa-camera','fa-music','fa-film','fa-book','fa-graduation-cap','fa-briefcase',
  'fa-calculator','fa-calendar','fa-clock','fa-compass','fa-database','fa-diamond','fa-flask',
  'fa-key','fa-leaf','fa-map','fa-microphone','fa-paint-brush','fa-pencil-alt','fa-puzzle-piece',
  'fa-robot','fa-seedling','fa-shopping-cart','fa-sitemap','fa-smile','fa-sun','fa-tools',
  'fa-tree','fa-user-astronaut','fa-wand-magic-sparkles','fa-wrench','fa-bullhorn','fa-coins',
  'fa-crown','fa-fingerprint','fa-flag','fa-gem','fa-ghost','fa-hammer','fa-handshake',
  'fa-hashtag','fa-headphones','fa-infinity','fa-landmark','fa-layer-group','fa-link',
  'fa-magnifying-glass','fa-meteor','fa-mountain','fa-network-wired','fa-paper-plane',
  'fa-pen-fancy','fa-percent','fa-plane','fa-plug','fa-print','fa-scroll','fa-server',
  'fa-signal','fa-spa','fa-spinner','fa-square-poll-vertical','fa-tag','fa-thumbs-up',
  'fa-umbrella','fa-user-secret','fa-video','fa-wifi','fa-wind','fa-yin-yang'
];

var CATEGORIES = ['audit','content','strategy','naming','pitch','design','lifestyle','tools','career','intel','gaming','creative'];
var TIERS = ['common','uncommon','rare','epic','legendary'];
var OUTPUT_TYPES = ['score','verdict','text','list','tags','highlight','image','color_palette'];

// ── Templates ──
var TEMPLATES = {
  roast: {
    identity: { name: '', tagline: '', description: '', icon: 'fas fa-fire', category: 'audit', tier: 'legendary' },
    input: { type: 'textarea', label: 'Paste content to roast', placeholder: 'Paste the content you want roasted...', validation: 'text' },
    prompt: {
      systemPrompt: 'You are a brutally honest critic. Score the input 0-100, give a one-line verdict, list 3-5 roast points (funny but constructive), suggest improvements, and give a pro tip.\n\nYou MUST respond with valid JSON:\n{\n  "score": <0-100>,\n  "verdict": "<one-line>",\n  "roast_points": ["<point 1>", "<point 2>"],\n  "improvements": "<suggestions>",\n  "pro_tip": "<tip>"\n}\n\nDo NOT wrap in code fences. Return ONLY raw JSON.',
      userPromptTemplate: 'Roast this:\n\n{{input}}',
      temperature: 0.9, maxTokens: 1500
    },
    output: { sections: [
      { label: 'Score', type: 'score', key: 'score' },
      { label: 'Verdict', type: 'verdict', key: 'verdict' },
      { label: 'The Roast', type: 'list', key: 'roast_points' },
      { label: 'Improvements', type: 'text', key: 'improvements' },
      { label: 'Pro Tip', type: 'highlight', key: 'pro_tip' }
    ]},
    powers: { webSearch: false, fetchUrl: false, imageGeneration: false, rateLimitCost: 1 }
  },
  analyzer: {
    identity: { name: '', tagline: '', description: '', icon: 'fas fa-search', category: 'tools', tier: 'epic' },
    input: { type: 'textarea', label: 'Paste content to analyze', placeholder: 'Paste what you want analyzed...', validation: 'text' },
    prompt: {
      systemPrompt: 'You are an expert analyst. Analyze the input thoroughly and provide a structured breakdown.\n\nYou MUST respond with valid JSON:\n{\n  "summary": "<2-3 sentence summary>",\n  "key_findings": ["<finding 1>", "<finding 2>"],\n  "strengths": ["<strength 1>"],\n  "weaknesses": ["<weakness 1>"],\n  "recommendation": "<actionable recommendation>"\n}\n\nDo NOT wrap in code fences. Return ONLY raw JSON.',
      userPromptTemplate: 'Analyze this:\n\n{{input}}',
      temperature: 0.7, maxTokens: 1500
    },
    output: { sections: [
      { label: 'Summary', type: 'text', key: 'summary' },
      { label: 'Key Findings', type: 'list', key: 'key_findings' },
      { label: 'Strengths', type: 'list', key: 'strengths' },
      { label: 'Weaknesses', type: 'list', key: 'weaknesses' },
      { label: 'Recommendation', type: 'highlight', key: 'recommendation' }
    ]},
    powers: { webSearch: false, fetchUrl: false, imageGeneration: false, rateLimitCost: 1 }
  },
  generator: {
    identity: { name: '', tagline: '', description: '', icon: 'fas fa-wand-magic-sparkles', category: 'creative', tier: 'rare' },
    input: { type: 'textarea', label: 'Describe what to generate', placeholder: 'Describe what you want generated...', validation: 'text' },
    prompt: {
      systemPrompt: 'You are a creative generator. Given a description, produce creative output.\n\nYou MUST respond with valid JSON:\n{\n  "title": "<creative title>",\n  "content": "<the generated content>",\n  "variations": ["<variation 1>", "<variation 2>"],\n  "tip": "<pro tip>"\n}\n\nDo NOT wrap in code fences. Return ONLY raw JSON.',
      userPromptTemplate: 'Generate this:\n\n{{input}}',
      temperature: 0.9, maxTokens: 1500
    },
    output: { sections: [
      { label: 'Title', type: 'highlight', key: 'title' },
      { label: 'Content', type: 'text', key: 'content' },
      { label: 'Variations', type: 'list', key: 'variations' },
      { label: 'Pro Tip', type: 'highlight', key: 'tip' }
    ]},
    powers: { webSearch: false, fetchUrl: false, imageGeneration: false, rateLimitCost: 1 }
  },
  advisor: {
    identity: { name: '', tagline: '', description: '', icon: 'fas fa-user-tie', category: 'tools', tier: 'epic' },
    input: { type: 'textarea', label: 'Describe your situation', placeholder: 'Describe what you need advice on...', validation: 'text' },
    prompt: {
      systemPrompt: 'You are an expert advisor. Given a situation, provide actionable advice.\n\nYou MUST respond with valid JSON:\n{\n  "assessment": "<1-2 sentence assessment>",\n  "advice": ["<advice point 1>", "<advice point 2>"],\n  "watch_out": ["<risk 1>"],\n  "next_step": "<the single most important next step>",\n  "tip": "<pro tip>"\n}\n\nDo NOT wrap in code fences. Return ONLY raw JSON.',
      userPromptTemplate: 'Advise on this:\n\n{{input}}',
      temperature: 0.7, maxTokens: 1500
    },
    output: { sections: [
      { label: 'Assessment', type: 'verdict', key: 'assessment' },
      { label: 'Advice', type: 'list', key: 'advice' },
      { label: 'Watch Out For', type: 'list', key: 'watch_out' },
      { label: 'Next Step', type: 'highlight', key: 'next_step' },
      { label: 'Pro Tip', type: 'highlight', key: 'tip' }
    ]},
    powers: { webSearch: false, fetchUrl: false, imageGeneration: false, rateLimitCost: 1 }
  }
};

// ── Init ──
document.addEventListener('DOMContentLoaded', function() {
  initDragAndDrop();
  initTemplates();
  initActions();
  loadSidebar();
  updatePreview();
  updateStatus();
});

// ── Drag and Drop ──
function initDragAndDrop() {
  var trayCards = document.querySelectorAll('.af-tray-card');
  var pipeline = document.getElementById('af-pipeline');

  trayCards.forEach(function(card) {
    card.addEventListener('dragstart', function(e) {
      e.dataTransfer.setData('text/plain', card.dataset.component);
      e.dataTransfer.effectAllowed = 'copy';
    });
  });

  pipeline.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    pipeline.classList.add('af-pipeline--dragover');
  });

  pipeline.addEventListener('dragleave', function() {
    pipeline.classList.remove('af-pipeline--dragover');
  });

  pipeline.addEventListener('drop', function(e) {
    e.preventDefault();
    pipeline.classList.remove('af-pipeline--dragover');
    var component = e.dataTransfer.getData('text/plain');
    if (component && !pipelineOrder.includes(component)) {
      pipelineOrder.push(component);
      renderPipeline();
      updateTrayState();
      updatePreview();
      updateStatus();
    }
  });

  // Init Sortable for reordering pipeline cards
  new Sortable(pipeline, {
    animation: 200,
    handle: '.af-pipe-drag',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    filter: '.af-pipeline-empty, .af-connector',
    draggable: '.af-pipe-card',
    onEnd: function() {
      // Update pipelineOrder from DOM
      var cards = pipeline.querySelectorAll('.af-pipe-card');
      pipelineOrder = [];
      cards.forEach(function(c) { pipelineOrder.push(c.dataset.component); });
      renderPipeline(); // re-render to fix connector positions
    }
  });
}

// ── Render Pipeline ──
function renderPipeline() {
  var pipeline = document.getElementById('af-pipeline');
  var empty = document.getElementById('af-pipeline-empty');

  if (pipelineOrder.length === 0) {
    pipeline.innerHTML = '';
    pipeline.appendChild(empty);
    empty.style.display = '';
    return;
  }

  if (empty) empty.style.display = 'none';

  // Keep existing expanded state
  var openCards = {};
  pipeline.querySelectorAll('.af-pipe-card--open').forEach(function(c) {
    openCards[c.dataset.component] = true;
  });

  // Remove existing cards and connectors
  pipeline.querySelectorAll('.af-pipe-card, .af-connector').forEach(function(c) { c.remove(); });

  pipelineOrder.forEach(function(comp, idx) {
    // Add SVG connector before each card (except first)
    if (idx > 0) {
      var connector = document.createElement('div');
      connector.className = 'af-connector';
      connector.innerHTML =
        '<svg viewBox="0 0 40 32">' +
          '<circle class="af-connector-dot" cx="20" cy="2" r="3" />' +
          '<line class="af-connector-line" x1="20" y1="5" x2="20" y2="24" />' +
          '<polygon class="af-connector-arrow" points="14,22 20,30 26,22" />' +
        '</svg>';
      pipeline.appendChild(connector);
    }

    var card = createPipelineCard(comp, openCards[comp]);
    pipeline.appendChild(card);
  });
}

function createPipelineCard(component, isOpen) {
  var icons = { identity: 'fa-masks-theater', input: 'fa-keyboard', prompt: 'fa-brain', output: 'fa-chart-bar', powers: 'fa-bolt' };
  var titles = { identity: 'Identity', input: 'Input', prompt: 'Prompt', output: 'Output', powers: 'Powers' };

  var card = document.createElement('div');
  card.className = 'af-pipe-card' + (isOpen ? ' af-pipe-card--open' : '');
  card.dataset.component = component;

  var summary = getComponentSummary(component);

  card.innerHTML =
    '<div class="af-pipe-card-header" tabindex="0" role="button" aria-expanded="' + (isOpen ? 'true' : 'false') + '" aria-label="' + titles[component] + ' configuration">' +
      '<i class="fas af-pipe-drag fa-grip-vertical" aria-label="Drag to reorder"></i>' +
      '<i class="fas ' + icons[component] + ' af-pipe-icon"></i>' +
      '<span class="af-pipe-title">' + titles[component] + '</span>' +
      '<span class="af-pipe-summary">' + escapeHtml(summary) + '</span>' +
      '<i class="fas fa-chevron-down af-pipe-chevron"></i>' +
    '</div>' +
    '<div class="af-pipe-card-body">' + renderComponentForm(component) + '</div>';

  // Toggle expand/collapse
  var header = card.querySelector('.af-pipe-card-header');
  header.addEventListener('click', function(e) {
    if (e.target.closest('.af-pipe-drag')) return;
    card.classList.toggle('af-pipe-card--open');
    header.setAttribute('aria-expanded', card.classList.contains('af-pipe-card--open'));
  });
  header.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      card.classList.toggle('af-pipe-card--open');
      header.setAttribute('aria-expanded', card.classList.contains('af-pipe-card--open'));
    }
  });

  // Bind form events
  bindComponentEvents(card, component);

  return card;
}

function getComponentSummary(component) {
  switch (component) {
    case 'identity': return agentState.identity.name || 'Untitled';
    case 'input': return agentState.input.type;
    case 'prompt': return agentState.prompt.systemPrompt ? (agentState.prompt.systemPrompt.substring(0, 30) + '...') : 'Empty';
    case 'output': return agentState.output.sections.length + ' sections';
    case 'powers': {
      var p = [];
      if (agentState.powers.webSearch) p.push('Search');
      if (agentState.powers.fetchUrl) p.push('Fetch');
      if (agentState.powers.imageGeneration) p.push('Image');
      return p.length ? p.join(', ') : 'None';
    }
    default: return '';
  }
}

// ── Component Forms ──
function renderComponentForm(component) {
  var s = agentState;
  switch (component) {
    case 'identity':
      var nameLocked = _editMode ? ' disabled title="Name cannot be changed on live agents"' : '';
      var nameLabel = _editMode ? 'Name <span style="font-size:0.55rem;opacity:0.5;text-transform:none;letter-spacing:0">(locked)</span>' : 'Name';
      return '<div class="af-field"><label class="af-field-label">' + nameLabel + '</label><input type="text" data-bind="identity.name" value="' + escapeAttr(s.identity.name) + '" maxlength="30" placeholder="My Agent"' + nameLocked + '></div>' +
        '<div class="af-field"><label class="af-field-label">Tagline</label><input type="text" data-bind="identity.tagline" value="' + escapeAttr(s.identity.tagline) + '" maxlength="60" placeholder="What does it do?"></div>' +
        '<div class="af-field"><label class="af-field-label">Description</label><textarea data-bind="identity.description" maxlength="200" placeholder="Describe your agent...">' + escapeHtml(s.identity.description) + '</textarea></div>' +
        '<div class="af-field"><label class="af-field-label">Icon</label><div class="af-icon-trigger" id="af-icon-trigger"><i class="' + escapeAttr(s.identity.icon) + '"></i> <span>Change icon</span></div></div>' +
        '<div class="af-field"><label class="af-field-label">Portrait</label>' +
          '<button type="button" class="af-portrait-trigger" id="af-portrait-trigger"><i class="fas fa-image"></i> ' + (s.identity.portrait || s.identity._portraitUrl ? 'Change Portrait' : 'Generate Portrait') + '</button>' +
          (s.identity.portrait || s.identity._portraitUrl ? '<div class="af-portrait-thumb" id="af-portrait-thumb"><img id="af-portrait-thumb-img"><button type="button" class="af-portrait-thumb-remove" id="af-portrait-thumb-remove" title="Remove portrait"><i class="fas fa-times"></i></button></div>' : '') +
        '</div>' +
        '<div class="af-field"><label class="af-field-label">Category</label><select data-bind="identity.category">' + CATEGORIES.map(function(c) { return '<option value="' + c + '"' + (s.identity.category === c ? ' selected' : '') + '>' + c.charAt(0).toUpperCase() + c.slice(1) + '</option>'; }).join('') + '</select></div>' +
        '<div class="af-field"><label class="af-field-label">Tier</label><div class="af-tier-selector">' + TIERS.map(function(t) { return '<button type="button" class="af-tier-btn' + (s.identity.tier === t ? ' af-tier-btn--active' : '') + '" data-tier="' + t + '">' + t.toUpperCase() + '</button>'; }).join('') + '</div></div>';

    case 'input':
      return '<div class="af-field"><label class="af-field-label">Input Type</label><select data-bind="input.type"><option value="textarea"' + (s.input.type === 'textarea' ? ' selected' : '') + '>Text Area</option><option value="url"' + (s.input.type === 'url' ? ' selected' : '') + '>URL</option></select></div>' +
        '<div class="af-field"><label class="af-field-label">Label</label><input type="text" data-bind="input.label" value="' + escapeAttr(s.input.label) + '" placeholder="Enter your input..."></div>' +
        '<div class="af-field"><label class="af-field-label">Placeholder</label><input type="text" data-bind="input.placeholder" value="' + escapeAttr(s.input.placeholder) + '" placeholder="e.g. Paste your content here..."></div>';

    case 'prompt':
      return '<button type="button" class="af-scaffold-btn" id="af-scaffold-trigger"><i class="fas fa-wand-magic-sparkles"></i> Help me write this prompt</button>' +
        '<div class="af-field"><label class="af-field-label">System Prompt</label><textarea class="af-mono" data-bind="prompt.systemPrompt" placeholder="You are [Agent Name], a...">' + escapeHtml(s.prompt.systemPrompt) + '</textarea></div>' +
        '<div class="af-field"><label class="af-field-label">User Prompt Template (must contain {{input}})</label><textarea data-bind="prompt.userPromptTemplate" rows="2" placeholder="Analyze this: {{input}}">' + escapeHtml(s.prompt.userPromptTemplate) + '</textarea></div>' +
        '<div class="af-field"><label class="af-field-label">Temperature</label><div class="af-range-row"><input type="range" min="0" max="1" step="0.05" value="' + s.prompt.temperature + '" data-bind="prompt.temperature"><span class="af-range-value" id="af-temp-val">' + s.prompt.temperature + '</span></div></div>' +
        '<div class="af-field"><label class="af-field-label">Max Tokens</label><div class="af-range-row"><input type="range" min="500" max="4000" step="100" value="' + s.prompt.maxTokens + '" data-bind="prompt.maxTokens"><span class="af-range-value" id="af-tokens-val">' + s.prompt.maxTokens + '</span></div></div>';

    case 'output':
      return '<div class="af-output-sections" id="af-output-sections">' + renderOutputSections() + '</div>' +
        '<button type="button" class="af-add-output-btn" id="af-add-output"><i class="fas fa-plus"></i> Add Output Section</button>';

    case 'powers':
      return '<div class="af-toggle-row"><label>Web Search</label><label class="af-toggle"><input type="checkbox" data-bind="powers.webSearch"' + (s.powers.webSearch ? ' checked' : '') + '><span class="af-toggle-slider"></span></label></div>' +
        '<div class="af-toggle-row"><label>URL Fetch</label><label class="af-toggle"><input type="checkbox" data-bind="powers.fetchUrl"' + (s.powers.fetchUrl ? ' checked' : '') + '><span class="af-toggle-slider"></span></label></div>' +
        '<div class="af-toggle-row"><label>Image Generation</label><label class="af-toggle"><input type="checkbox" data-bind="powers.imageGeneration"' + (s.powers.imageGeneration ? ' checked' : '') + '><span class="af-toggle-slider"></span></label></div>' +
        '<div class="af-toggle-row"><label>Rate Limit Cost</label><select data-bind="powers.rateLimitCost" class="af-powers-select"><option value="1"' + (s.powers.rateLimitCost === 1 ? ' selected' : '') + '>1</option><option value="2"' + (s.powers.rateLimitCost === 2 ? ' selected' : '') + '>2</option></select></div>';

    default: return '';
  }
}

function renderOutputSections() {
  return agentState.output.sections.map(function(sec, i) {
    var typePreview = getTypePreviewHTML(sec.type);
    return '<div class="af-output-row" data-index="' + i + '">' +
      '<i class="fas fa-grip-vertical af-output-drag"></i>' +
      '<input type="text" value="' + escapeAttr(sec.label) + '" placeholder="Label" data-output-label="' + i + '">' +
      '<select data-output-type="' + i + '">' + OUTPUT_TYPES.map(function(t) { return '<option value="' + t + '"' + (sec.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="af-output-remove" data-output-remove="' + i + '"><i class="fas fa-times"></i></button>' +
      '</div>' +
      (typePreview ? '<div class="af-type-preview">' + typePreview + '</div>' : '');
  }).join('');
}

function getTypePreviewHTML(type) {
  switch (type) {
    case 'score': return '<span class="af-type-preview-num">72</span><span class="af-type-preview-bar"></span>';
    case 'verdict': return '<span class="af-type-preview-border">Italic verdict text</span>';
    case 'text': return '<span class="af-type-preview-line"></span><span class="af-type-preview-line" style="width:80%"></span>';
    case 'list': return '<span class="af-type-preview-dot"></span><span class="af-type-preview-line" style="width:60%"></span>';
    case 'tags': return '<span class="af-type-preview-pill">tag</span><span class="af-type-preview-pill">tag</span>';
    case 'highlight': return '<span class="af-type-preview-box">Callout text</span>';
    case 'image': return '<span class="af-type-preview-img"></span>';
    case 'color_palette': return '<span class="af-type-preview-swatch" style="background:#60a5fa"></span><span class="af-type-preview-swatch" style="background:#f59e0b"></span><span class="af-type-preview-swatch" style="background:#a855f7"></span>';
    default: return '';
  }
}

// ── Bind Events ──
function bindComponentEvents(card, component) {
  // Text/textarea/select inputs → update state
  card.querySelectorAll('[data-bind]').forEach(function(el) {
    var bindPath = el.dataset.bind;
    var parts = bindPath.split('.');
    el.addEventListener('input', function() {
      var val = el.type === 'checkbox' ? el.checked : (el.type === 'range' ? parseFloat(el.value) : el.value);
      if (bindPath === 'powers.rateLimitCost') val = parseInt(val);
      agentState[parts[0]][parts[1]] = val;

      // Update range display
      if (bindPath === 'prompt.temperature') { var tv = document.getElementById('af-temp-val'); if (tv) tv.textContent = val; }
      if (bindPath === 'prompt.maxTokens') { var mv = document.getElementById('af-tokens-val'); if (mv) mv.textContent = val; }

      // Auto-set validation from input type
      if (bindPath === 'input.type') agentState.input.validation = val === 'url' ? 'url' : 'text';

      updatePreview();
      debouncedAutoSave();
    });
  });

  // Tier buttons
  card.querySelectorAll('.af-tier-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      agentState.identity.tier = btn.dataset.tier;
      card.querySelectorAll('.af-tier-btn').forEach(function(b) { b.classList.remove('af-tier-btn--active'); });
      btn.classList.add('af-tier-btn--active');
      updatePreview();
    });
  });

  // Icon picker trigger
  var iconTrigger = card.querySelector('#af-icon-trigger');
  if (iconTrigger) {
    iconTrigger.addEventListener('click', function() { openIconPicker(); });
  }

  // Portrait trigger
  var portraitTrigger = card.querySelector('#af-portrait-trigger');
  if (portraitTrigger) {
    portraitTrigger.addEventListener('click', function() { openPortraitModal(); });
  }
  // Set portrait thumbnail src
  var thumbImg = card.querySelector('#af-portrait-thumb-img');
  if (thumbImg) {
    if (agentState.identity.portrait) {
      thumbImg.src = 'data:' + agentState.identity.portrait.mimeType + ';base64,' + agentState.identity.portrait.base64;
    } else if (agentState.identity._portraitUrl) {
      thumbImg.src = agentState.identity._portraitUrl;
    }
  }
  // Portrait remove button
  var portraitRemove = card.querySelector('#af-portrait-thumb-remove');
  if (portraitRemove) {
    portraitRemove.addEventListener('click', function(e) {
      e.stopPropagation();
      agentState.identity.portrait = null;
      renderPipeline();
      updatePreview();
    });
  }

  // Scaffold trigger
  var scaffoldTrigger = card.querySelector('#af-scaffold-trigger');
  if (scaffoldTrigger) {
    scaffoldTrigger.addEventListener('click', function() { openScaffoldModal(); });
  }

  // Output sections
  if (component === 'output') {
    var addBtn = card.querySelector('#af-add-output');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        agentState.output.sections.push({ label: 'New Section', type: 'text', key: 'new_section_' + Date.now() });
        renderPipeline();
        updatePreview();
      });
    }
    bindOutputEvents(card);

    // Sortable for output sections
    var outputList = card.querySelector('#af-output-sections');
    if (outputList) {
      new Sortable(outputList, {
        animation: 150,
        handle: '.af-output-drag',
        onEnd: function() {
          var rows = outputList.querySelectorAll('.af-output-row');
          var newSections = [];
          rows.forEach(function(row) {
            var idx = parseInt(row.dataset.index);
            if (agentState.output.sections[idx]) newSections.push(agentState.output.sections[idx]);
          });
          agentState.output.sections = newSections;
          renderPipeline();
          updatePreview();
        }
      });
    }
  }
}

function bindOutputEvents(card) {
  card.querySelectorAll('[data-output-label]').forEach(function(el) {
    el.addEventListener('input', function() {
      var idx = parseInt(el.dataset.outputLabel);
      if (agentState.output.sections[idx]) {
        agentState.output.sections[idx].label = el.value;
        agentState.output.sections[idx].key = el.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        updatePreview();
      }
    });
  });
  card.querySelectorAll('[data-output-type]').forEach(function(el) {
    el.addEventListener('change', function() {
      var idx = parseInt(el.dataset.outputType);
      if (agentState.output.sections[idx]) {
        agentState.output.sections[idx].type = el.value;
        renderPipeline(); // re-render to update type preview
        updatePreview();
      }
    });
  });
  card.querySelectorAll('[data-output-remove]').forEach(function(el) {
    el.addEventListener('click', function() {
      var idx = parseInt(el.dataset.outputRemove);
      agentState.output.sections.splice(idx, 1);
      renderPipeline();
      updatePreview();
    });
  });
}

// ── Tray State ──
function updateTrayState() {
  document.querySelectorAll('.af-tray-card').forEach(function(card) {
    if (pipelineOrder.includes(card.dataset.component)) {
      card.classList.add('af-tray-card--used');
    } else {
      card.classList.remove('af-tray-card--used');
    }
  });
}

// ── Status ──
function updateStatus() {
  var el = document.getElementById('af-status-text');
  if (el) el.textContent = pipelineOrder.length + ' / 5 components';

  var testBtn = document.getElementById('af-test-btn');
  var submitBtn = document.getElementById('af-submit-btn');
  var ready = pipelineOrder.length === 5 && agentState.identity.name && agentState.prompt.systemPrompt;
  if (testBtn) testBtn.disabled = !ready;
  if (submitBtn) submitBtn.disabled = !ready;
}

// ── Preview ──
function updatePreview() {
  var s = agentState.identity;
  var CATEGORY_LABELS = { audit:'Audit', content:'Content', strategy:'Strategy', naming:'Naming', pitch:'Pitch', design:'Design', lifestyle:'Lifestyle', tools:'Tools', career:'Career', intel:'Intel', gaming:'Gaming', creative:'Creative' };
  var tierLabel = (s.tier || 'common').charAt(0).toUpperCase() + (s.tier || 'common').slice(1);
  var categoryLabel = CATEGORY_LABELS[s.category] || s.category || '—';
  var caps = agentState.output.sections.slice(0, 4);
  var name = s.name || 'Untitled Agent';
  var tagline = s.tagline || 'Add a tagline...';
  var icon = s.icon || 'fas fa-question';
  var tier = s.tier || 'common';

  var wrap = document.getElementById('af-agent-card-wrap');
  if (wrap) {
    var portraitHtml = '';
    var hasPortrait = (s.portrait && s.portrait.base64) || s._portraitUrl;
    if (hasPortrait) {
      portraitHtml =
        '<div class="pa-agent-portrait">' +
          '<img id="af-preview-portrait-img"' + (s._portraitUrl ? ' src="' + escapeAttr(s._portraitUrl) + '"' : '') + '>' +
          '<div class="pa-portrait-fallback"><i class="' + escapeAttr(icon) + '"></i></div>' +
        '</div>';
    }
    wrap.innerHTML =
      '<div class="pa-card" data-tier="' + escapeAttr(tier) + '">' +
        portraitHtml +
        '<div class="pa-card-featured" style="' + (caps.length >= 3 ? '' : 'display:none') + '">Preview</div>' +
        '<div class="pa-card-avatar">' +
          '<div class="pa-card-icon"><i class="' + escapeAttr(icon) + '"></i></div>' +
          '<span class="pa-card-tier pa-card-tier--' + escapeAttr(tier) + '">' + escapeHtml(tierLabel) + '</span>' +
        '</div>' +
        '<div class="pa-card-body">' +
          '<h3 class="pa-card-name">' + escapeHtml(name) + '</h3>' +
          '<p class="pa-card-tagline">' + escapeHtml(tagline) + '</p>' +
          '<span class="pa-card-role">' + escapeHtml(categoryLabel) + '</span>' +
          '<ul class="pa-card-capabilities">' +
            caps.map(function(sec) { return '<li>' + escapeHtml(sec.label) + '</li>'; }).join('') +
          '</ul>' +
        '</div>' +
      '</div>';
    // Set portrait src after innerHTML to avoid huge base64 in attribute
    var previewPortraitImg = document.getElementById('af-preview-portrait-img');
    if (previewPortraitImg && s.portrait) {
      previewPortraitImg.src = 'data:' + s.portrait.mimeType + ';base64,' + s.portrait.base64;
    }
  }

  updateStatus();
}

// ── Templates ──
function initTemplates() {
  document.querySelectorAll('.af-template-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var tmpl = TEMPLATES[btn.dataset.template];
      if (!tmpl) return;
      applyTemplate(tmpl);
    });
  });
}

function applyTemplate(tmpl) {
  agentState.identity = Object.assign({}, agentState.identity, tmpl.identity);
  agentState.input = Object.assign({}, tmpl.input);
  agentState.prompt = Object.assign({}, tmpl.prompt);
  agentState.output = { sections: tmpl.output.sections.map(function(s) { return Object.assign({}, s); }) };
  agentState.powers = Object.assign({}, agentState.powers, tmpl.powers);

  pipelineOrder = ['identity', 'input', 'prompt', 'output', 'powers'];
  renderPipeline();
  updateTrayState();
  updatePreview();
  updateStatus();
}

// ── Actions ──
function initActions() {
  document.getElementById('af-clear-btn').addEventListener('click', async function() {
    var ok = await showConfirmModal('Clear Pipeline', 'Remove all components and reset the builder?');
    if (!ok) return;
    pipelineOrder = [];
    agentState = {
      identity: { name: '', tagline: '', description: '', icon: 'fas fa-question', category: 'tools', tier: 'common', portrait: null },
      input: { type: 'textarea', label: '', placeholder: '', validation: 'text' },
      prompt: { systemPrompt: '', userPromptTemplate: '{{input}}', temperature: 0.8, maxTokens: 1500 },
      output: { sections: [] },
      powers: { webSearch: false, fetchUrl: false, imageGeneration: false, rateLimitCost: 1, imageConfig: { outputType: 'square_image', topicPrefix: '' } }
    };
    currentDraftId = null;
    _editMode = false;
    _editAgentId = null;
    renderPipeline();
    updateTrayState();
    updatePreview();
    updateStatus();
  });

  document.getElementById('af-save-btn').addEventListener('click', saveDraft);
  document.getElementById('af-test-btn').addEventListener('click', runTest);
  document.getElementById('af-submit-btn').addEventListener('click', submitForReview);

  // Scaffold modal
  document.getElementById('af-scaffold-close').addEventListener('click', function() { document.getElementById('af-scaffold-modal').style.display = 'none'; });
  document.getElementById('af-scaffold-cancel').addEventListener('click', function() { document.getElementById('af-scaffold-modal').style.display = 'none'; });
  document.getElementById('af-scaffold-generate').addEventListener('click', runScaffold);

  // Icon modal
  document.getElementById('af-icon-close').addEventListener('click', function() { document.getElementById('af-icon-modal').style.display = 'none'; });

  // Portrait modal
  document.getElementById('af-portrait-close').addEventListener('click', function() { document.getElementById('af-portrait-modal').style.display = 'none'; });
  document.getElementById('af-portrait-cancel').addEventListener('click', function() { document.getElementById('af-portrait-modal').style.display = 'none'; });
  document.getElementById('af-portrait-generate').addEventListener('click', generatePortrait);
  document.getElementById('af-portrait-retry').addEventListener('click', generatePortrait);
  document.getElementById('af-portrait-accept').addEventListener('click', acceptPortrait);
}

// ── Icon Picker ──
function openIconPicker() {
  var modal = document.getElementById('af-icon-modal');
  var grid = document.getElementById('af-icon-grid');
  var search = document.getElementById('af-icon-search');

  search.value = '';
  renderIcons('');

  search.oninput = function() { renderIcons(search.value); };
  modal.style.display = 'flex';

  function renderIcons(filter) {
    var filtered = ICON_LIST.filter(function(ic) { return !filter || ic.includes(filter.toLowerCase()); });
    grid.innerHTML = filtered.map(function(ic) {
      var cls = 'fas ' + ic;
      var selected = agentState.identity.icon === cls ? ' af-icon-option--selected' : '';
      return '<div class="af-icon-option' + selected + '" data-icon="' + cls + '"><i class="' + cls + '"></i></div>';
    }).join('');

    grid.querySelectorAll('.af-icon-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        agentState.identity.icon = opt.dataset.icon;
        modal.style.display = 'none';
        renderPipeline();
        updatePreview();
      });
    });
  }
}

// ── Portrait Generator Modal ──
var _portraitChoices = { archetype: 'scholar', expression: 'confident', appearance: 'masculine', age: 'mid', pose: 'front', accent: 'none' };

function openPortraitModal() {
  var modal = document.getElementById('af-portrait-modal');
  modal.style.display = 'flex';

  // Reset UI state
  document.getElementById('af-portrait-preview').style.display = 'none';
  document.getElementById('af-portrait-loading').style.display = 'none';
  document.getElementById('af-portrait-error').style.display = 'none';
  document.getElementById('af-portrait-generate').style.display = '';
  document.getElementById('af-portrait-accept').style.display = 'none';
  document.getElementById('af-portrait-retry').style.display = 'none';

  // Init pill selectors
  modal.querySelectorAll('.af-portrait-pills').forEach(function(group) {
    var key = group.dataset.portrait;
    group.querySelectorAll('.af-portrait-pill').forEach(function(pill) {
      pill.classList.toggle('af-portrait-pill--active', pill.dataset.val === _portraitChoices[key]);
      pill.onclick = function() {
        _portraitChoices[key] = pill.dataset.val;
        group.querySelectorAll('.af-portrait-pill').forEach(function(p) {
          p.classList.toggle('af-portrait-pill--active', p.dataset.val === _portraitChoices[key]);
        });
      };
    });
  });
}

async function generatePortrait() {
  var loading = document.getElementById('af-portrait-loading');
  var preview = document.getElementById('af-portrait-preview');
  var errorEl = document.getElementById('af-portrait-error');
  var genBtn = document.getElementById('af-portrait-generate');
  var acceptBtn = document.getElementById('af-portrait-accept');
  var retryBtn = document.getElementById('af-portrait-retry');
  var remainingEl = document.getElementById('af-portrait-remaining');

  preview.style.display = 'none';
  errorEl.style.display = 'none';
  loading.style.display = 'flex';
  genBtn.style.display = 'none';
  acceptBtn.style.display = 'none';
  retryBtn.style.display = 'none';

  var timeoutId = setTimeout(function() {
    loading.style.display = 'none';
    errorEl.textContent = 'Generation timed out — try again';
    errorEl.style.display = '';
    retryBtn.style.display = '';
  }, 30000);

  try {
    var hdrs = { 'Content-Type': 'application/json', 'x-company-secret': 'pixelpusher' };
    var res = await fetch(getApiBase() + '/agentforge-portrait', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify(_portraitChoices)
    });

    clearTimeout(timeoutId);
    var data = await res.json();

    if (!res.ok) {
      loading.style.display = 'none';
      errorEl.textContent = data.error || 'Generation failed';
      errorEl.style.display = '';
      retryBtn.style.display = '';
      return;
    }

    // Show preview
    var img = document.getElementById('af-portrait-preview-img');
    img.src = 'data:' + data.portraitMimeType + ';base64,' + data.portraitBase64;
    // Store temporarily for accept
    img.dataset.base64 = data.portraitBase64;
    img.dataset.mimeType = data.portraitMimeType;

    loading.style.display = 'none';
    preview.style.display = '';
    acceptBtn.style.display = '';
    retryBtn.style.display = '';

    if (data.remaining !== undefined) {
      remainingEl.textContent = data.remaining + ' generation' + (data.remaining === 1 ? '' : 's') + ' remaining today';
    }
  } catch (err) {
    clearTimeout(timeoutId);
    loading.style.display = 'none';
    errorEl.textContent = 'Network error — check your connection and try again';
    errorEl.style.display = '';
    retryBtn.style.display = '';
  }
}

function acceptPortrait() {
  var img = document.getElementById('af-portrait-preview-img');
  agentState.identity.portrait = {
    base64: img.dataset.base64,
    mimeType: img.dataset.mimeType || 'image/png'
  };
  document.getElementById('af-portrait-modal').style.display = 'none';
  renderPipeline();
  updatePreview();
}

// ── Scaffold Modal ──
function openScaffoldModal() {
  document.getElementById('af-scaffold-modal').style.display = 'flex';
  document.getElementById('af-scaffold-input').value = '';
  document.getElementById('af-scaffold-input').focus();
}

async function runScaffold() {
  var input = document.getElementById('af-scaffold-input').value.trim();
  if (!input) return;

  var loading = document.getElementById('af-scaffold-loading');
  var genBtn = document.getElementById('af-scaffold-generate');
  loading.style.display = 'flex';
  genBtn.disabled = true;

  try {
    var hdrs = { 'Content-Type': 'application/json' };
    if (isLoggedIn) hdrs['x-company-secret'] = 'pixelpusher';

    var res = await fetch(getApiBase() + '/pixel-agent-run', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({
        agentId: '_scaffold',
        input: input
      })
    });

    var data = await res.json();
    if (data.result) {
      var r = data.result;
      if (r.systemPrompt) agentState.prompt.systemPrompt = r.systemPrompt;
      if (r.userPromptTemplate) agentState.prompt.userPromptTemplate = r.userPromptTemplate;
      if (r.temperature) agentState.prompt.temperature = r.temperature;
      if (r.maxTokens) agentState.prompt.maxTokens = r.maxTokens;
      if (r.suggestedOutputs && Array.isArray(r.suggestedOutputs)) {
        agentState.output.sections = r.suggestedOutputs;
      }
      if (r.suggestedName) agentState.identity.name = r.suggestedName;
      if (r.suggestedTagline) agentState.identity.tagline = r.suggestedTagline;
      if (r.suggestedCategory) agentState.identity.category = r.suggestedCategory;

      // Ensure all components in pipeline
      pipelineOrder = ['identity', 'input', 'prompt', 'output', 'powers'];
      renderPipeline();
      updateTrayState();
      updatePreview();
      updateStatus();
    }
    document.getElementById('af-scaffold-modal').style.display = 'none';
  } catch (err) {
    showNotification('Scaffold Failed', err.message, 'error');
  } finally {
    loading.style.display = 'none';
    genBtn.disabled = false;
  }
}

// ── Test Run ──
async function runTest() {
  var input = document.getElementById('af-test-input').value.trim();
  if (!input) { showNotification('Missing Input', 'Enter test input first', 'warning'); return; }

  var resultEl = document.getElementById('af-test-result');
  var loadingEl = document.getElementById('af-test-loading');
  var testBtn = document.getElementById('af-test-btn');

  resultEl.style.display = 'none';
  loadingEl.style.display = 'flex';
  testBtn.disabled = true;

  try {
    var agentConfig = buildAgentConfig();
    var hdrs = { 'Content-Type': 'application/json' };
    if (isLoggedIn) hdrs['x-company-secret'] = 'pixelpusher';

    var res = await fetch(getApiBase() + '/pixel-agent-run', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({
        agentId: '_test',
        input: input,
        _customAgent: agentConfig
      })
    });

    var data = await res.json();
    resultEl.innerHTML = renderTestResult(data, agentConfig);
    resultEl.style.display = '';
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message;
    resultEl.style.display = '';
  } finally {
    loadingEl.style.display = 'none';
    testBtn.disabled = false;
  }
}

// ── Submit ──
async function submitForReview() {
  var confirmed = await showConfirmModal(
    'Submit for Review',
    'Submit "' + escapeHtml(agentState.identity.name || 'Untitled') + '" for AI review?\n\nThe AI reviewer will evaluate quality, uniqueness, and safety before forwarding to the CEO.'
  );
  if (!confirmed) return;

  setAgentStatus('reviewing');
  showReviewLoading();

  try {
    var agentConfig = buildAgentConfig();
    var hdrs = { 'Content-Type': 'application/json' };
    if (isLoggedIn) hdrs['x-company-secret'] = 'pixelpusher';

    var submitBody = { agentConfig: agentConfig };
    if (_editMode && _editAgentId) {
      submitBody.editMode = true;
      submitBody.originalAgentId = _editAgentId;
    }

    var res = await fetch(getApiBase() + '/pixel-agent-submit', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify(submitBody)
    });

    var data = await res.json();

    if (data.error) {
      setAgentStatus('draft');
      showReviewResult('error', data.error, null);
      return;
    }

    showReviewResult(data.decision, data.feedback, data);

  } catch (err) {
    setAgentStatus('draft');
    showReviewResult('error', 'Submission failed: ' + err.message, null);
  }
}

function showReviewResult(decision, feedback, data) {
  lastReview = data;
  var meta = {
    cosmetic_update: { color: '#4ade80', bg: 'rgba(74,222,128,0.08)', icon: 'fa-check-circle', title: 'Updated!', status: 'Changes applied instantly' },
    approved: { color: '#4ade80', bg: 'rgba(74,222,128,0.08)', icon: 'fa-check-circle', title: 'Approved!', status: data && data.autoApproved ? 'Auto-approved — now live!' : 'Forwarded to CEO for final approval' },
    needs_work: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)', icon: 'fa-exclamation-triangle', title: 'Needs Work', status: 'Returned for edits' },
    rejected: { color: '#f87171', bg: 'rgba(248,113,113,0.08)', icon: 'fa-times-circle', title: 'Rejected', status: 'Not approved' },
    error: { color: '#f87171', bg: 'rgba(248,113,113,0.08)', icon: 'fa-exclamation-circle', title: 'Error', status: '' }
  };
  var m = meta[decision] || meta.error;

  // Update agent status
  if (decision === 'approved') { setAgentStatus('submitted'); }
  else if (decision === 'needs_work') { setAgentStatus('returned'); }
  else if (decision === 'rejected') { setAgentStatus('draft'); }

  // Header
  var header = document.getElementById('af-review-header');
  header.style.borderBottomColor = m.color;
  document.getElementById('af-review-title').innerHTML = '<i class="fas ' + m.icon + '" style="color:' + m.color + '"></i> ' + m.title;

  // Scores
  var scoresEl = document.getElementById('af-review-scores');
  if (data && data.scores) {
    scoresEl.innerHTML = '<div class="af-review-score-row">' +
      renderScoreBar('Quality', data.scores.quality || 0, m.color) +
      renderScoreBar('Uniqueness', data.scores.uniqueness || 0, m.color) +
      renderScoreBar('Safety', data.scores.safety || 0, m.color) +
    '</div>';
  } else { scoresEl.innerHTML = ''; }

  // Feedback
  document.getElementById('af-review-feedback').innerHTML =
    '<div class="af-review-feedback-text">' + escapeHtml(feedback || '') + '</div>';

  // Similar to
  var similarEl = document.getElementById('af-review-similar');
  if (data && data.similar_to) {
    similarEl.innerHTML = '<i class="fas fa-link"></i> Most similar to: <strong>' + escapeHtml(data.similar_to) + '</strong>';
    similarEl.style.display = '';
  } else { similarEl.style.display = 'none'; }

  // Suggestions
  var sugEl = document.getElementById('af-review-suggestions');
  if (data && data.improvements && data.improvements.length) {
    sugEl.innerHTML = '<h4><i class="fas fa-lightbulb"></i> Suggestions</h4><ul>' +
      data.improvements.map(function(s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') + '</ul>';
    sugEl.style.display = '';
  } else { sugEl.style.display = 'none'; }

  // Status
  document.getElementById('af-review-status').innerHTML =
    '<div class="af-review-status-badge" style="color:' + m.color + ';border-color:' + m.color + '">' +
      '<i class="fas ' + (decision === 'approved' ? 'fa-arrow-right' : decision === 'needs_work' ? 'fa-pencil-alt' : 'fa-info-circle') + '"></i> ' +
      m.status +
    '</div>';

  // Action buttons
  var actionsEl = document.getElementById('af-review-actions');
  if (decision === 'approved') {
    actionsEl.innerHTML = '<button class="af-btn af-btn-primary" onclick="closeReviewModal()">Close</button>';
  } else if (decision === 'needs_work') {
    actionsEl.innerHTML =
      '<button class="af-btn af-btn-secondary" onclick="closeReviewModal()">Close</button>' +
      '<button class="af-btn af-btn-primary" onclick="editAndResubmit()"><i class="fas fa-pencil-alt"></i> Edit & Resubmit</button>';
  } else {
    actionsEl.innerHTML =
      '<button class="af-btn af-btn-secondary" onclick="closeReviewModal()">Close</button>' +
      '<button class="af-btn af-btn-primary" onclick="editAndRetry()"><i class="fas fa-redo"></i> Edit & Retry</button>';
  }

  document.getElementById('af-review-modal').style.display = 'flex';
}

function renderScoreBar(label, score, color) {
  return '<div class="af-review-score-item">' +
    '<div class="af-review-score-label">' + label + '</div>' +
    '<div class="af-review-score-bar-bg">' +
      '<div class="af-review-score-bar-fill" style="width:' + score + '%;background:' + color + '"></div>' +
    '</div>' +
    '<div class="af-review-score-num" style="color:' + color + '">' + score + '</div>' +
  '</div>';
}

function closeReviewModal() {
  document.getElementById('af-review-modal').style.display = 'none';
}

function editAndResubmit() {
  closeReviewModal();
  setAgentStatus('returned');
  showSuggestionsBanner();
}

function editAndRetry() {
  closeReviewModal();
  setAgentStatus('draft');
}

// ── Agent Status Management ──
function setAgentStatus(status) {
  agentStatus = status;
  updateLockState();
  updateSubmitButton();
}

function updateLockState() {
  var pipeline = document.getElementById('af-pipeline');
  var isLocked = agentStatus === 'submitted' || agentStatus === 'reviewing';

  pipeline.querySelectorAll('.af-pipe-card').forEach(function(card) {
    if (isLocked) {
      card.classList.add('af-pipe-card--locked');
      card.querySelectorAll('input, textarea, select, button:not(.af-pipe-card-header button)').forEach(function(el) { el.disabled = true; });
    } else {
      card.classList.remove('af-pipe-card--locked');
      card.querySelectorAll('input, textarea, select').forEach(function(el) { el.disabled = false; });
    }
  });

  // Tray cards
  document.querySelectorAll('.af-tray-card').forEach(function(c) {
    c.style.pointerEvents = isLocked ? 'none' : '';
    c.style.opacity = isLocked ? '0.3' : '';
  });
}

function updateSubmitButton() {
  var btn = document.getElementById('af-submit-btn');
  var saveBtn = document.getElementById('af-save-btn');

  switch (agentStatus) {
    case 'submitted':
      btn.innerHTML = '<i class="fas fa-lock"></i> Awaiting CEO Approval';
      btn.disabled = true;
      btn.className = 'af-btn af-btn-locked';
      // Show unlock button
      if (!document.getElementById('af-unlock-btn')) {
        var unlockBtn = document.createElement('button');
        unlockBtn.id = 'af-unlock-btn';
        unlockBtn.className = 'af-btn af-btn-ghost';
        unlockBtn.innerHTML = '<i class="fas fa-lock-open"></i> Unlock & Edit';
        unlockBtn.onclick = function() { setAgentStatus('draft'); hideSuggestionsBanner(); showNotification('Unlocked', 'Agent is now editable', 'info'); };
        btn.parentElement.appendChild(unlockBtn);
      }
      break;
    case 'returned':
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Resubmit for Review';
      btn.disabled = false;
      btn.className = 'af-btn af-btn-primary';
      removeUnlockBtn();
      break;
    case 'reviewing':
      btn.innerHTML = '<div class="af-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></div> Reviewing...';
      btn.disabled = true;
      btn.className = 'af-btn af-btn-primary';
      removeUnlockBtn();
      break;
    default: // draft, rejected
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit for Review';
      btn.disabled = pipelineOrder.length < 5 || !agentState.identity.name || !agentState.prompt.systemPrompt;
      btn.className = 'af-btn af-btn-primary';
      removeUnlockBtn();
  }
}

function removeUnlockBtn() {
  var btn = document.getElementById('af-unlock-btn');
  if (btn) btn.remove();
}

// ── Suggestions Banner ──
function showSuggestionsBanner() {
  if (!lastReview || !lastReview.improvements || !lastReview.improvements.length) return;
  var banner = document.getElementById('af-canvas-banner');
  banner.innerHTML =
    '<div class="af-suggestions-banner">' +
      '<div class="af-suggestions-header"><i class="fas fa-exclamation-triangle"></i> AI Review: Needs Work</div>' +
      '<ul>' + lastReview.improvements.map(function(s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') + '</ul>' +
      '<div class="af-suggestions-actions">' +
        '<button class="af-btn af-btn-ghost" onclick="hideSuggestionsBanner()">Dismiss</button>' +
      '</div>' +
    '</div>';
}

function hideSuggestionsBanner() {
  document.getElementById('af-canvas-banner').innerHTML = '';
}

// ── Formatted Test Result Renderer ──
function renderTestResult(data, agentConfig) {
  if (!data || !data.result) return '<div class="af-test-empty">No result returned</div>';

  var result = data.result;
  var sections = agentConfig.outputSections || [];
  var html = '';

  sections.forEach(function(sec) {
    var val = result[sec.key];
    if (val === undefined || val === null) return;

    html += '<div class="af-test-section">';
    html += '<div class="af-test-section-label">' + escapeHtml(sec.label) + '</div>';

    switch (sec.type) {
      case 'score':
        var n = typeof val === 'number' ? val : parseInt(val) || 0;
        var scoreColor = n >= 70 ? '#4ade80' : n >= 40 ? '#fbbf24' : '#f87171';
        html += '<div class="af-test-score"><span class="af-test-score-num" style="color:' + scoreColor + '">' + n + '</span><div class="af-test-score-bar"><div style="width:' + n + '%;background:' + scoreColor + '"></div></div></div>';
        break;
      case 'verdict':
        html += '<div class="af-test-verdict">' + escapeHtml(String(val)) + '</div>';
        break;
      case 'list':
        var items = Array.isArray(val) ? val : [val];
        html += '<ul class="af-test-list">' + items.map(function(item) {
          var text = typeof item === 'object' ? JSON.stringify(item) : String(item);
          return '<li>' + escapeHtml(text) + '</li>';
        }).join('') + '</ul>';
        break;
      case 'tags':
        var tags = Array.isArray(val) ? val : [val];
        html += '<div class="af-test-tags">' + tags.map(function(t) {
          return '<span class="af-test-tag">' + escapeHtml(String(t)) + '</span>';
        }).join('') + '</div>';
        break;
      case 'highlight':
        html += '<div class="af-test-highlight">' + escapeHtml(String(val)) + '</div>';
        break;
      default:
        var textVal = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
        html += '<div class="af-test-text">' + escapeHtml(textVal).replace(/\n/g, '<br>') + '</div>';
    }
    html += '</div>';
  });

  // Show raw JSON toggle
  html += '<details class="af-test-json-toggle"><summary>Show Raw JSON</summary><pre>' + escapeHtml(JSON.stringify(result, null, 2)) + '</pre></details>';

  return html;
}

// ── Build Config ──
function buildAgentConfig() {
  var s = agentState;
  return {
    id: s.identity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom-agent',
    name: s.identity.name,
    tagline: s.identity.tagline,
    description: s.identity.description,
    category: s.identity.category,
    tier: s.identity.tier,
    icon: s.identity.icon,
    capabilities: s.output.sections.slice(0, 4).map(function(sec) { return sec.label; }),
    inputType: s.input.type,
    inputLabel: s.input.label,
    inputPlaceholder: s.input.placeholder,
    inputValidation: s.input.validation,
    webSearch: s.powers.webSearch || undefined,
    fetchUrl: s.powers.fetchUrl || undefined,
    imageGeneration: s.powers.imageGeneration || undefined,
    rateLimitCost: s.powers.rateLimitCost,
    systemPrompt: s.prompt.systemPrompt,
    userPromptTemplate: s.prompt.userPromptTemplate,
    outputFormat: 'structured',
    outputSections: s.output.sections.map(function(sec) {
      return { key: sec.key, label: sec.label, type: sec.type };
    }),
    generationConfig: {
      temperature: s.prompt.temperature,
      maxOutputTokens: s.prompt.maxTokens
    },
    active: true,
    featured: false,
    order: 99,
    portrait: s.identity.portrait || undefined
  };
}

// ── Draft Management ──
// ── Draft Management (Blob Storage) ──
var _draftsCache = []; // local cache of loaded drafts

// ── Load Full Sidebar (Drafts + Pending + Live) ──
function loadSidebar() {
  var hdrs = { 'x-company-secret': 'pixelpusher' };
  Promise.all([
    fetch(getApiBase() + '/agentforge-drafts', { headers: hdrs }).then(function(r) { return r.json(); }).catch(function() { return { drafts: [] }; }),
    fetch(getApiBase() + '/company-state?key=approvalQueue', { headers: hdrs }).then(function(r) { return r.json(); }).catch(function() { return {}; }),
    fetch(getApiBase() + '/pixel-agent-community', { headers: hdrs }).then(function(r) { return r.json(); }).catch(function() { return { agents: [] }; }),
    fetch(getApiBase() + '/pixel-agent-submit', { headers: hdrs }).then(function(r) { return r.json(); }).catch(function() { return {}; })
  ]).then(function(results) {
    var draftsData = results[0];
    var queueData = results[1];
    var communityData = results[2];
    var limitsData = results[3];

    // Update submission remaining count
    if (limitsData.remaining !== undefined) {
      var submitBtn = document.getElementById('af-submit-btn');
      if (submitBtn && agentStatus === 'draft') {
        var remainText = limitsData.remaining > 0
          ? ' (' + limitsData.remaining + ' left today)'
          : ' (limit reached)';
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit for Review' + '<span style="font-size:0.65rem;opacity:0.5;">' + remainText + '</span>';
        if (limitsData.remaining <= 0) submitBtn.disabled = true;
      }
    }

    _draftsCache = draftsData.drafts || [];
    renderDraftsList(_draftsCache);

    // Pending: filter approval queue for agent_forge_submission type
    var queue = queueData.value || queueData || [];
    if (!Array.isArray(queue)) queue = [];
    var pending = queue.filter(function(item) { return item.type === 'agent_forge_submission' && item.status === 'pending'; });
    renderPendingList(pending);

    // Live: all community agents
    var live = (communityData.agents || []).filter(function(a) { return a.active; });
    renderLiveList(live);
  });
}

function renderPendingList(items) {
  var list = document.getElementById('af-pending-list');
  var countEl = document.getElementById('af-pending-count');
  if (!list) return;
  if (countEl) countEl.textContent = items.length ? '(' + items.length + ')' : '';

  if (items.length === 0) {
    list.innerHTML = '<p class="af-drafts-empty">No pending</p>';
    return;
  }

  list.innerHTML = items.map(function(item) {
    return '<div class="af-draft-item af-pending-item">' +
      '<span><i class="fas fa-clock af-pending-icon"></i> ' + escapeHtml(item.agentName || 'Unnamed') + '</span>' +
    '</div>';
  }).join('');
}

function renderLiveList(agents) {
  var list = document.getElementById('af-live-list');
  var countEl = document.getElementById('af-live-count');
  if (!list) return;
  if (countEl) countEl.textContent = '(' + agents.length + '/3)';
  _liveAgentsCache = agents;

  if (agents.length === 0) {
    list.innerHTML = '<p class="af-drafts-empty">No live agents</p>';
    return;
  }

  list.innerHTML = agents.map(function(a) {
    return '<div class="af-draft-item af-live-item" data-agent-id="' + escapeAttr(a.id) + '">' +
      '<span><span class="af-live-dot"></span> ' + escapeHtml(a.name || 'Unnamed') + '</span>' +
      '<div>' +
        '<button class="af-draft-delete af-live-edit" data-live-edit="' + escapeAttr(a.id) + '" title="Edit agent"><i class="fas fa-pen"></i></button>' +
        '<button class="af-draft-delete af-live-delete" data-live-delete="' + escapeAttr(a.id) + '" title="Remove from catalog"><i class="fas fa-trash-alt"></i></button>' +
      '</div>' +
    '</div>';
  }).join('');

  list.querySelectorAll('[data-live-edit]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      loadLiveAgent(btn.dataset.liveEdit);
    });
  });

  list.querySelectorAll('[data-live-delete]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      deleteLiveAgent(btn.dataset.liveDelete);
    });
  });
}

function loadLiveAgent(agentId) {
  var agent = _liveAgentsCache.find(function(a) { return a.id === agentId; });
  if (!agent) { showNotification('Error', 'Agent not found', 'error'); return; }

  // Set edit mode
  _editMode = true;
  _editAgentId = agent.id;
  currentDraftId = null;

  // Map agent config back to agentState
  agentState = {
    identity: {
      name: agent.name || '',
      tagline: agent.tagline || '',
      description: agent.description || '',
      icon: agent.icon || 'fas fa-question',
      category: agent.category || 'tools',
      tier: agent.tier || 'common',
      portrait: null // portrait is a URL on live agents, not base64
    },
    input: {
      type: agent.inputType || 'textarea',
      label: agent.inputLabel || '',
      placeholder: agent.inputPlaceholder || '',
      validation: agent.inputValidation || 'text'
    },
    prompt: {
      systemPrompt: agent.systemPrompt || '',
      userPromptTemplate: agent.userPromptTemplate || '{{input}}',
      temperature: (agent.generationConfig && agent.generationConfig.temperature) || 0.8,
      maxTokens: (agent.generationConfig && agent.generationConfig.maxOutputTokens) || 1500
    },
    output: {
      sections: (agent.outputSections || []).map(function(s) {
        return { key: s.key, label: s.label, type: s.type };
      })
    },
    powers: {
      webSearch: agent.webSearch || false,
      fetchUrl: agent.fetchUrl || false,
      imageGeneration: agent.imageGeneration || false,
      rateLimitCost: agent.rateLimitCost || 1,
      imageConfig: agent.imageConfig || { outputType: 'square_image', topicPrefix: '' }
    }
  };

  // If agent has a portraitUrl, store reference so preview shows it
  if (agent.portraitUrl) {
    agentState.identity._portraitUrl = agent.portraitUrl;
  }

  pipelineOrder = ['identity', 'input', 'prompt', 'output', 'powers'];
  agentStatus = 'draft';
  renderPipeline();
  updateTrayState();
  updatePreview();
  updateStatus();
  showNotification('Editing Live Agent', agent.name + ' — name is locked', 'info');
}

async function deleteLiveAgent(agentId) {
  var ok = await showConfirmModal(
    'Remove Live Agent',
    'This will permanently remove this agent from the Pixel Agents catalog. Users will no longer be able to use it.'
  );
  if (!ok) return;

  fetch(getApiBase() + '/pixel-agent-remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-company-secret': 'pixelpusher' },
    body: JSON.stringify({ agentId: agentId })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.success) {
      showNotification('Agent Removed', d.agentName + ' has been removed from the catalog', 'success');
      loadSidebar();
    } else {
      showNotification('Error', d.error || 'Failed to remove', 'error');
    }
  })
  .catch(function(err) { showNotification('Error', err.message, 'error'); });
}

function saveDraft() {
  var config = buildAgentConfig();
  var draft = {
    id: currentDraftId || 'draft-' + Date.now(),
    name: config.name || 'Untitled',
    state: JSON.parse(JSON.stringify(agentState)),
    pipelineOrder: pipelineOrder.slice(),
    updatedAt: new Date().toISOString()
  };
  if (!currentDraftId) currentDraftId = draft.id;

  fetch(getApiBase() + '/agentforge-drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-company-secret': 'pixelpusher' },
    body: JSON.stringify({ draft: draft })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.success) {
      showNotification('Saved', '', 'success');
      loadSidebar();
    } else {
      showNotification('Save Failed', d.error || 'Unknown error', 'error');
    }
  })
  .catch(function(err) { showNotification('Save Failed', err.message, 'error'); });
}

function loadDrafts() {
  var list = document.getElementById('af-drafts-list');
  if (!list) return;

  fetch(getApiBase() + '/agentforge-drafts', {
    headers: { 'x-company-secret': 'pixelpusher' }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    _draftsCache = data.drafts || [];
    renderDraftsList(_draftsCache);
  })
  .catch(function() {
    _draftsCache = [];
    renderDraftsList([]);
  });
}

function renderDraftsList(drafts) {
  var list = document.getElementById('af-drafts-list');
  if (!list) return;

  if (drafts.length === 0) {
    list.innerHTML = '<p class="af-drafts-empty">No drafts</p>';
    return;
  }

  list.innerHTML = drafts.map(function(d) {
    return '<div class="af-draft-item" data-draft-id="' + d.id + '">' +
      '<span>' + escapeHtml(d.name || 'Untitled') + '</span>' +
      '<button class="af-draft-delete" data-draft-delete="' + d.id + '"><i class="fas fa-times"></i></button>' +
      '</div>';
  }).join('');

  list.querySelectorAll('.af-draft-item').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.closest('.af-draft-delete')) return;
      loadDraft(el.dataset.draftId);
    });
  });

  list.querySelectorAll('.af-draft-delete').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      deleteDraft(btn.dataset.draftDelete);
    });
  });
}

function loadDraft(draftId) {
  var draft = _draftsCache.find(function(d) { return d.id === draftId; });
  if (!draft) return;

  currentDraftId = draft.id;
  agentState = JSON.parse(JSON.stringify(draft.state));
  pipelineOrder = draft.pipelineOrder.slice();
  renderPipeline();
  updateTrayState();
  updatePreview();
  updateStatus();
  showNotification('Draft Loaded', draft.name || 'Untitled', 'success');
}

function deleteDraft(draftId) {
  fetch(getApiBase() + '/agentforge-drafts', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'x-company-secret': 'pixelpusher' },
    body: JSON.stringify({ draftId: draftId })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.success) {
      if (currentDraftId === draftId) currentDraftId = null;
      loadSidebar();
    }
  })
  .catch(function() {});
}

// Auto-save debounce
var autoSaveTimer = null;
function debouncedAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(function() {
    if (currentDraftId && pipelineOrder.length > 0) saveDraft();
  }, 3000);
}

// ── Helpers ──
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showNotification(title, message, type) {
  type = type || 'info';
  var icons = { success: 'fa-check-circle', warning: 'fa-exclamation-triangle', error: 'fa-times-circle', info: 'fa-info-circle' };
  var colors = { success: '#4ade80', warning: '#fbbf24', error: '#f87171', info: 'rgba(90,200,250,0.9)' };

  var container = document.getElementById('af-notifications');
  var notif = document.createElement('div');
  notif.className = 'af-notification af-notification--' + type;
  notif.innerHTML =
    '<div class="af-notification-content">' +
      '<i class="fas ' + icons[type] + '" style="color:' + colors[type] + ';font-size:1.1rem;"></i>' +
      '<div><strong>' + escapeHtml(title) + '</strong>' + (message ? '<p>' + escapeHtml(message) + '</p>' : '') + '</div>' +
    '</div>' +
    '<button class="af-notification-close" onclick="this.parentElement.remove()">&times;</button>';

  container.appendChild(notif);
  requestAnimationFrame(function() { notif.classList.add('af-notification--visible'); });

  var autoDismiss = (type === 'success' || type === 'info') ? 3000 : 8000;
  setTimeout(function() {
    notif.classList.remove('af-notification--visible');
    setTimeout(function() { if (notif.parentElement) notif.remove(); }, 300);
  }, autoDismiss);
}

// Keep showToast as alias for backward compat
function showToast(msg) { showNotification(msg, '', 'success'); }

// ── Confirm Modal (replaces browser confirm()) ──
function showConfirmModal(title, message) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'af-modal-overlay af-confirm-overlay';
    overlay.innerHTML =
      '<div class="af-modal af-modal-confirm">' +
        '<div class="af-modal-header">' +
          '<h3><i class="fas fa-question-circle" style="color:rgba(90,200,250,0.8)"></i> ' + escapeHtml(title) + '</h3>' +
        '</div>' +
        '<div class="af-modal-body">' +
          '<p style="white-space:pre-line">' + escapeHtml(message) + '</p>' +
        '</div>' +
        '<div class="af-modal-footer">' +
          '<button class="af-btn af-btn-ghost af-confirm-cancel">Cancel</button>' +
          '<button class="af-btn af-btn-primary af-confirm-ok">Confirm</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.style.display = 'flex';

    overlay.querySelector('.af-confirm-ok').onclick = function() { overlay.remove(); resolve(true); };
    overlay.querySelector('.af-confirm-cancel').onclick = function() { overlay.remove(); resolve(false); };
    overlay.addEventListener('click', function(e) { if (e.target === overlay) { overlay.remove(); resolve(false); } });
    overlay.querySelector('.af-confirm-ok').focus();
  });
}

// ── Review Loading State ──
function showReviewLoading() {
  var modal = document.getElementById('af-review-modal');
  document.getElementById('af-review-title').innerHTML = '<div class="af-spinner" style="display:inline-block;vertical-align:middle;margin-right:8px;"></div> AI Reviewing Your Agent...';
  document.getElementById('af-review-header').style.borderBottomColor = 'rgba(90,200,250,0.3)';
  document.getElementById('af-review-scores').innerHTML = '';
  document.getElementById('af-review-feedback').innerHTML =
    '<div class="af-review-loading-msg">' +
      '<p>Evaluating quality, uniqueness, and safety...</p>' +
      '<p style="font-size:0.78rem;color:rgba(255,255,255,0.35)">This usually takes 5-10 seconds</p>' +
    '</div>';
  document.getElementById('af-review-similar').style.display = 'none';
  document.getElementById('af-review-suggestions').style.display = 'none';
  document.getElementById('af-review-status').innerHTML = '';
  document.getElementById('af-review-actions').innerHTML = '';
  modal.style.display = 'flex';
}
