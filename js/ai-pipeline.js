// Modular AI Pipeline Component (multi-style)
// Usage: Call initAIPipeline({ target: HTMLElement, steps: [ {icon, label} ], style: 'default' })

(function() {
  const DEBUG = true;
  const DEFAULT_STEPS = [
    { icon: '⚡', label: 'Input Data' },
    { icon: '🧠', label: 'AI Model' },
    { icon: '🔄', label: 'Processing' },
    { icon: '📊', label: 'Output' },
    { icon: '✨', label: 'Results' }
  ];

  function log(...args) { if (DEBUG) console.log('[AIPipeline]', ...args); }
  function error(...args) { if (DEBUG) console.error('[AIPipeline]', ...args); }

  function renderSteps(container, steps, style) {
    log('Rendering steps', {steps, style, container});
    container.innerHTML = '';
    for (let i = 0; i < steps.length; i++) {
      const step = document.createElement('div');
      step.className = 'windsurf-ai-pipeline-step';
      // Icon
      const icon = document.createElement('div');
      icon.className = 'windsurf-ai-pipeline-step-icon';
      icon.innerHTML = steps[i].icon;
      step.appendChild(icon);
      // Label
      const label = document.createElement('div');
      label.className = 'windsurf-ai-pipeline-step-label';
      label.textContent = steps[i].label;
      step.appendChild(label);
      // Connector (not for last step, and not for timeline/cards)
      if (i < steps.length - 1 && !['timeline','cards'].includes(style)) {
        const connector = document.createElement('div');
        connector.className = 'windsurf-ai-pipeline-step-connector';
        step.appendChild(connector);
      }
      container.appendChild(step);
    }
  }

  window.initAIPipeline = function({ target, steps = DEFAULT_STEPS, style = 'default' } = {}) {
    log('initAIPipeline called', {target, steps, style});
    const root = (typeof target === 'string') ? document.querySelector(target) : target;
    if (!root) { error('No root element found for', target); return; }
    if (DEBUG) root.classList.add('windsurf-ai-pipeline-debug');
    const content = root.querySelector('.windsurf-ai-pipeline-content');
    if (!content) { error('No .windsurf-ai-pipeline-content found in', root); return; }
    renderSteps(content, steps, style);
    root.setAttribute('data-style', style);
    // Style switcher
    const switcher = root.querySelector('.windsurf-ai-pipeline-style-switcher');
    if (switcher) {
      Array.from(switcher.querySelectorAll('button')).forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-style') === style);
        btn.onclick = () => {
          log('Style switch click', btn.getAttribute('data-style'));
          renderSteps(content, steps, btn.getAttribute('data-style'));
          root.setAttribute('data-style', btn.getAttribute('data-style'));
          Array.from(switcher.querySelectorAll('button')).forEach(b => b.classList.toggle('active', b === btn));
        };
      });
    } else {
      log('No style switcher found in', root);
    }
  };

  // Prevent multiple initializations
  if (!window.__AIPipelineInitialized) {
    window.__AIPipelineInitialized = true;
    document.addEventListener('DOMContentLoaded', function() {
      log('DOMContentLoaded, searching for .windsurf-ai-pipeline');
      document.querySelectorAll('.windsurf-ai-pipeline').forEach(el => {
        log('Auto-initializing pipeline component', el);
        window.initAIPipeline({ target: el });
      });
    });
  } else {
    log('AIPipeline already initialized globally');
  }
})();
