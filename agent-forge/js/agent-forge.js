// Agent Forge — Builder Logic
// Card pipeline drag-and-drop agent builder

// ── State ──
var agentState = {
  identity: { name: '', tagline: '', description: '', icon: 'fas fa-question', category: 'tools', tier: 'common' },
  input: { type: 'textarea', label: '', placeholder: '', validation: 'text' },
  prompt: { systemPrompt: '', userPromptTemplate: '{{input}}', temperature: 0.8, maxTokens: 1500 },
  output: { sections: [] },
  powers: { webSearch: false, fetchUrl: false, imageGeneration: false, rateLimitCost: 1, imageConfig: { outputType: 'square_image', topicPrefix: '' } }
};

var pipelineOrder = []; // which components are in the pipeline
var isLoggedIn = false;
var currentDraftId = null;

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
  loadDrafts();
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
    '<div class="af-pipe-card-header">' +
      '<i class="fas af-pipe-drag fa-grip-vertical"></i>' +
      '<i class="fas ' + icons[component] + ' af-pipe-icon"></i>' +
      '<span class="af-pipe-title">' + titles[component] + '</span>' +
      '<span class="af-pipe-summary">' + escapeHtml(summary) + '</span>' +
      '<i class="fas fa-chevron-down af-pipe-chevron"></i>' +
    '</div>' +
    '<div class="af-pipe-card-body">' + renderComponentForm(component) + '</div>';

  // Toggle expand/collapse
  card.querySelector('.af-pipe-card-header').addEventListener('click', function(e) {
    if (e.target.closest('.af-pipe-drag')) return;
    card.classList.toggle('af-pipe-card--open');
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
      return '<div class="af-field"><label class="af-field-label">Name</label><input type="text" data-bind="identity.name" value="' + escapeAttr(s.identity.name) + '" maxlength="30" placeholder="My Agent"></div>' +
        '<div class="af-field"><label class="af-field-label">Tagline</label><input type="text" data-bind="identity.tagline" value="' + escapeAttr(s.identity.tagline) + '" maxlength="60" placeholder="What does it do?"></div>' +
        '<div class="af-field"><label class="af-field-label">Description</label><textarea data-bind="identity.description" maxlength="200" placeholder="Describe your agent...">' + escapeHtml(s.identity.description) + '</textarea></div>' +
        '<div class="af-field"><label class="af-field-label">Icon</label><div class="af-icon-trigger" id="af-icon-trigger"><i class="' + escapeAttr(s.identity.icon) + '"></i> <span>Change icon</span></div></div>' +
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
        '<div class="af-toggle-row"><label>Rate Limit Cost</label><select data-bind="powers.rateLimitCost" style="width:60px"><option value="1"' + (s.powers.rateLimitCost === 1 ? ' selected' : '') + '>1</option><option value="2"' + (s.powers.rateLimitCost === 2 ? ' selected' : '') + '>2</option></select></div>';

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
  var iconEl = document.getElementById('af-preview-icon');
  var nameEl = document.getElementById('af-preview-name');
  var tagEl = document.getElementById('af-preview-tagline');
  var tierEl = document.getElementById('af-preview-tier');
  var catEl = document.getElementById('af-preview-category');
  var capsEl = document.getElementById('af-preview-capabilities');

  if (iconEl) iconEl.className = s.icon || 'fas fa-question';
  if (nameEl) nameEl.textContent = s.name || 'Untitled Agent';
  if (tagEl) tagEl.textContent = s.tagline || 'Add a tagline...';
  if (tierEl) {
    tierEl.textContent = (s.tier || 'common').toUpperCase();
    tierEl.className = 'pa-card-tier pa-tier-' + (s.tier || 'common');
  }
  if (catEl) catEl.textContent = (s.category || '—').toUpperCase();
  if (capsEl) {
    var caps = agentState.output.sections.slice(0, 4).map(function(sec) {
      return '<span class="pa-card-cap">' + escapeHtml(sec.label) + '</span>';
    });
    capsEl.innerHTML = caps.join('');
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
  document.getElementById('af-clear-btn').addEventListener('click', function() {
    if (!confirm('Clear the pipeline?')) return;
    pipelineOrder = [];
    agentState = {
      identity: { name: '', tagline: '', description: '', icon: 'fas fa-question', category: 'tools', tier: 'common' },
      input: { type: 'textarea', label: '', placeholder: '', validation: 'text' },
      prompt: { systemPrompt: '', userPromptTemplate: '{{input}}', temperature: 0.8, maxTokens: 1500 },
      output: { sections: [] },
      powers: { webSearch: false, fetchUrl: false, imageGeneration: false, rateLimitCost: 1, imageConfig: { outputType: 'square_image', topicPrefix: '' } }
    };
    currentDraftId = null;
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
    alert('Scaffold failed: ' + err.message);
  } finally {
    loading.style.display = 'none';
    genBtn.disabled = false;
  }
}

// ── Test Run ──
async function runTest() {
  var input = document.getElementById('af-test-input').value.trim();
  if (!input) { alert('Enter test input first'); return; }

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
    resultEl.textContent = data.raw || JSON.stringify(data.result, null, 2) || 'No result';
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
  if (!confirm('Submit "' + (agentState.identity.name || 'Untitled') + '" for review?\n\nAn AI reviewer will evaluate your agent for quality, uniqueness, and safety before forwarding to the CEO for final approval.')) return;

  var submitBtn = document.getElementById('af-submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<div class="af-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></div> Reviewing...';

  try {
    var agentConfig = buildAgentConfig();
    var hdrs = { 'Content-Type': 'application/json' };
    if (isLoggedIn) hdrs['x-company-secret'] = 'pixelpusher';

    var res = await fetch(getApiBase() + '/pixel-agent-submit', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ agentConfig: agentConfig })
    });

    var data = await res.json();

    if (data.error) {
      showReviewResult('error', data.error, null);
      return;
    }

    showReviewResult(data.decision, data.feedback, data);

  } catch (err) {
    showReviewResult('error', 'Submission failed: ' + err.message, null);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit for Review';
  }
}

function showReviewResult(decision, feedback, data) {
  var colors = {
    approved: { bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.3)', text: '#4ade80', icon: 'fa-check-circle', title: 'Approved!' },
    needs_work: { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)', text: '#fbbf24', icon: 'fa-exclamation-triangle', title: 'Needs Work' },
    rejected: { bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)', text: '#f87171', icon: 'fa-times-circle', title: 'Rejected' },
    error: { bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)', text: '#f87171', icon: 'fa-exclamation-circle', title: 'Error' }
  };

  var c = colors[decision] || colors.error;

  var scoresHtml = '';
  if (data && data.scores) {
    scoresHtml = '<div style="display:flex;gap:1rem;margin:0.75rem 0;">' +
      '<div style="text-align:center"><div style="font-size:1.2rem;font-weight:700;color:' + c.text + '">' + (data.scores.quality || 0) + '</div><div style="font-size:0.7rem;color:rgba(255,255,255,0.4)">Quality</div></div>' +
      '<div style="text-align:center"><div style="font-size:1.2rem;font-weight:700;color:' + c.text + '">' + (data.scores.uniqueness || 0) + '</div><div style="font-size:0.7rem;color:rgba(255,255,255,0.4)">Uniqueness</div></div>' +
      '<div style="text-align:center"><div style="font-size:1.2rem;font-weight:700;color:' + c.text + '">' + (data.scores.safety || 0) + '</div><div style="font-size:0.7rem;color:rgba(255,255,255,0.4)">Safety</div></div>' +
    '</div>';
  }

  var improvementsHtml = '';
  if (data && data.improvements && data.improvements.length) {
    improvementsHtml = '<div style="margin-top:0.5rem;font-size:0.8rem;color:rgba(255,255,255,0.5)"><strong>Suggestions:</strong><ul style="margin:0.3rem 0 0 1rem;padding:0">' +
      data.improvements.map(function(i) { return '<li>' + escapeHtml(i) + '</li>'; }).join('') +
    '</ul></div>';
  }

  var similarHtml = '';
  if (data && data.similar_to) {
    similarHtml = '<div style="margin-top:0.5rem;font-size:0.8rem;color:rgba(255,255,255,0.4)">Most similar to: <strong>' + escapeHtml(data.similar_to) + '</strong></div>';
  }

  var resultEl = document.getElementById('af-test-result');
  resultEl.innerHTML =
    '<div style="background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:8px;padding:1rem;">' +
      '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">' +
        '<i class="fas ' + c.icon + '" style="color:' + c.text + ';font-size:1.1rem;"></i>' +
        '<strong style="color:' + c.text + ';font-size:0.95rem;">' + c.title + '</strong>' +
      '</div>' +
      scoresHtml +
      '<div style="font-size:0.85rem;color:rgba(255,255,255,0.7);line-height:1.5;">' + escapeHtml(feedback || '') + '</div>' +
      similarHtml +
      improvementsHtml +
      (decision === 'approved' ? '<div style="margin-top:0.75rem;font-size:0.8rem;color:rgba(74,222,128,0.7);"><i class="fas fa-arrow-right"></i> Forwarded to CEO for final approval</div>' : '') +
    '</div>';
  resultEl.style.display = '';
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
    order: 99
  };
}

// ── Draft Management ──
function saveDraft() {
  var config = buildAgentConfig();
  var drafts = JSON.parse(localStorage.getItem('agentforge_drafts') || '[]');

  var draft = {
    id: currentDraftId || 'draft-' + Date.now(),
    name: config.name || 'Untitled',
    state: JSON.parse(JSON.stringify(agentState)),
    pipelineOrder: pipelineOrder.slice(),
    updatedAt: new Date().toISOString()
  };

  if (currentDraftId) {
    var idx = drafts.findIndex(function(d) { return d.id === currentDraftId; });
    if (idx >= 0) drafts[idx] = draft; else drafts.push(draft);
  } else {
    currentDraftId = draft.id;
    drafts.push(draft);
  }

  if (drafts.length > 20) drafts = drafts.slice(-20);
  localStorage.setItem('agentforge_drafts', JSON.stringify(drafts));
  loadDrafts();
  showToast('Draft saved');
}

function loadDrafts() {
  var drafts = JSON.parse(localStorage.getItem('agentforge_drafts') || '[]');
  var list = document.getElementById('af-drafts-list');
  if (!list) return;

  if (drafts.length === 0) {
    list.innerHTML = '<p class="af-drafts-empty">No saved drafts</p>';
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
  var drafts = JSON.parse(localStorage.getItem('agentforge_drafts') || '[]');
  var draft = drafts.find(function(d) { return d.id === draftId; });
  if (!draft) return;

  currentDraftId = draft.id;
  agentState = JSON.parse(JSON.stringify(draft.state));
  pipelineOrder = draft.pipelineOrder.slice();
  renderPipeline();
  updateTrayState();
  updatePreview();
  updateStatus();
  showToast('Draft loaded');
}

function deleteDraft(draftId) {
  var drafts = JSON.parse(localStorage.getItem('agentforge_drafts') || '[]');
  drafts = drafts.filter(function(d) { return d.id !== draftId; });
  localStorage.setItem('agentforge_drafts', JSON.stringify(drafts));
  if (currentDraftId === draftId) currentDraftId = null;
  loadDrafts();
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

function showToast(msg) {
  var toast = document.querySelector('.af-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'af-toast';
    toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:rgba(90,200,250,0.2);color:rgba(90,200,250,0.9);border:1px solid rgba(90,200,250,0.3);padding:0.6rem 1.2rem;border-radius:8px;font-size:0.85rem;z-index:9999;opacity:0;transition:opacity 0.3s;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(function() { toast.style.opacity = '0'; }, 2000);
}
