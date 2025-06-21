// Nova Form Explainer Interactive Module – Full Sequence
// Handles overlays, ghost, whisper, timeline, replay, debug, accessibility

let overlayMapData = null;
let sequenceKeys = [];
let whispers = {};
const stepTimeout = 2500, buffer = 800;
let currentStep = 0, sequenceActive = false, sequenceTimer = null, userInterrupted = false;

function setWhisper(step) {
  const panel = document.querySelector('.nova-whisper-panel');
  if (!panel || !sequenceKeys[step]) return;
  const key = sequenceKeys[step];
  panel.textContent = whispers[key] || (overlayMapData?.find(o => o.key === key)?.tooltip?.split('\n')[0] || '');
  panel.classList.add('active');
}
function clearWhisper() {
  const panel = document.querySelector('.nova-whisper-panel');
  if (panel) panel.classList.remove('active');
}
function setOverlay(step) {
  // Remove active from all overlays
  document.querySelectorAll('.form-overlay').forEach(el => el.classList.remove('active'));
  // Activate the overlay matching the current step's key
  const key = sequenceKeys[step];
  const el = document.querySelector(`.form-overlay[data-part="${key}"]`);
  if (el) {
    el.classList.add('active');
    el.setAttribute('tabindex', 0);
    el.setAttribute('aria-label', el.getAttribute('data-tooltip'));
  }
}
function clearOverlays() {
  document.querySelectorAll('.form-overlay').forEach(el => el.classList.remove('active'));
}
function setTimeline(step) {
  document.querySelectorAll('.timeline-dot').forEach((dot, idx) => {
    dot.classList.toggle('active', idx === step);
  });
}
function showReplay(show) {
  const btn = document.querySelector('.replay-tour');
  if (!btn) return;
  btn.removeAttribute('hidden');
  btn.style.display = 'flex';
  btn.classList.add('active');
}
function runSequence(startStep=0) {
  sequenceActive = true; userInterrupted = false; currentStep = startStep;
  showReplay(false); clearOverlays(); clearWhisper(); setTimeline(-1);
  stepNext();
}
function stepNext() {
  if (!sequenceActive || userInterrupted) return;
  setOverlay(currentStep);
  setWhisper(currentStep);
  setTimeline(currentStep);
  if (sequenceKeys.length === 0) return;
  sequenceTimer = setTimeout(() => {
    currentStep = (currentStep + 1) % sequenceKeys.length;
    stepNext();
  }, stepTimeout + buffer);
}
function cancelSequence() {
  sequenceActive = false; userInterrupted = true;
  clearTimeout(sequenceTimer);
  clearOverlays();
  setTimeline(-1);
  showReplay(true);
}
function jumpToStep(idx) {
  cancelSequence();
  setOverlay(idx);
  setWhisper(idx);
  setTimeline(idx);
}
function initTimelineScrubber() {
  const scrubber = document.querySelector('.timeline-scrubber');
  if (!scrubber || !Array.isArray(sequenceKeys)) return;
  scrubber.innerHTML = '';
  sequenceKeys.forEach((key, idx) => {
    const dot = document.createElement('div');
    dot.className = 'timeline-dot';
    dot.setAttribute('tabindex', 0);
    dot.setAttribute('aria-label', key + ' step');
    dot.addEventListener('click', () => jumpToStep(idx));
    dot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') jumpToStep(idx); });
    scrubber.appendChild(dot);
  });
}
function showTooltip(target) {
  let tooltip = document.querySelector('.tooltip-box');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'tooltip-box';
    document.body.appendChild(tooltip);
  }
  tooltip.textContent = target.getAttribute('data-tooltip') || '';
  tooltip.classList.add('active');

  const rect = target.getBoundingClientRect();
  const scrollY = window.scrollY || window.pageYOffset;
  const scrollX = window.scrollX || window.pageXOffset;
  // Center tooltip above overlay by default
  let left = rect.left + scrollX + rect.width/2 - tooltip.offsetWidth/2;
  let top = rect.top + scrollY - tooltip.offsetHeight - 8;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.classList.remove('tooltip-left');
  // Edge/collision detection (right)
  if (left + tooltip.offsetWidth > window.innerWidth - 8) {
    tooltip.classList.add('tooltip-left');
    tooltip.style.left = `${rect.right + scrollX - tooltip.offsetWidth}px`;
  }
  // Edge/collision detection (left)
  if (left < 8) {
    tooltip.style.left = `8px`;
  }
  target._tooltip = tooltip;
}

function hideTooltip(target) {
  const tooltip = document.querySelector('.tooltip-box');
  if (tooltip) {
    tooltip.classList.remove('active');
    tooltip.classList.remove('tooltip-left');
    tooltip.textContent = '';
  }
  target._tooltip = null;
}


async function loadOverlayMap() {
  try {
    const res = await fetch('/data/form-explainer-map.json');
    overlayMapData = await res.json();
    if (Array.isArray(overlayMapData)) {
      sequenceKeys = overlayMapData.map(o => o.key);
      whispers = {};
      overlayMapData.forEach(o => {
        whispers[o.key] = o.tooltip?.split('\n')[0] || '';
      });
      // Dynamically inject overlays
      const container = document.querySelector('.form-highlight-container');
      if (container) {
        // Remove any old overlays
        container.querySelectorAll('.form-overlay').forEach(el => el.remove());
        overlayMapData.forEach(o => {
          const overlay = document.createElement('div');
          overlay.className = `form-overlay overlay-${o.key}`;
          overlay.setAttribute('data-part', o.key);
          container.insertBefore(overlay, container.querySelector('.ghost-overlay'));
        });
      }
    }
  } catch (err) {
    console.error('[Form Explainer] Failed to load overlay map JSON:', err);
    overlayMapData = null;
    sequenceKeys = [];
    whispers = {};
  }
}

function positionOverlays() {
  if (!overlayMapData) return;
  const img = document.querySelector('.form-highlight-img');
  if (!img) return;
  document.querySelectorAll('.form-overlay').forEach(overlay => {
    const part = overlay.getAttribute('data-part');
    const map = overlayMapData.find(o => o.key === part);
    if (!map) return;
    // Calculate position/size based on image
    const left = img.offsetLeft + map.left * img.width;
    const top = img.offsetTop + map.top * img.height;
    const width = map.width * img.width;
    const height = map.height * img.height;
    overlay.style.position = 'absolute';
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
    overlay.setAttribute('data-tooltip', map.tooltip || '');
  });
}

function initOverlays() {
  positionOverlays();
  window.addEventListener('resize', positionOverlays);
  const img = document.querySelector('.form-highlight-img');
  if (img) {
    img.addEventListener('load', positionOverlays);
  }
  document.querySelectorAll('.form-overlay').forEach((overlay) => {
    const key = overlay.getAttribute('data-part');
    const idx = sequenceKeys.indexOf(key);
    overlay.addEventListener('mouseenter', () => {
      overlay.classList.add('active');
      setWhisper(idx);
      setTimeline(idx);
      showTooltip(overlay);
    });
    overlay.addEventListener('mouseleave', () => {
      overlay.classList.remove('active');
      clearWhisper();
      setTimeline(-1);
      hideTooltip(overlay);
    });
    overlay.addEventListener('focus', () => {
      overlay.classList.add('active');
      setWhisper(idx);
      setTimeline(idx);
      showTooltip(overlay);
    });
    overlay.addEventListener('blur', () => {
      overlay.classList.remove('active');
      clearWhisper();
      setTimeline(-1);
      hideTooltip(overlay);
    });
  });
}

// Patch main entry to load overlay map before initializing overlays
const origInitFormExplainer = window.initFormExplainer || function(){};
window.initFormExplainer = async function() {
  await loadOverlayMap();
  initTimelineScrubber();
  initOverlays();
  initReplay();
  initDebug();
  initGhost();
};


function initReplay() {
  const btn = document.querySelector('.replay-tour');
  if (!btn) return;
  btn.addEventListener('click', () => { runSequence(0); });
}
function initDebug() {
  const url = new URL(window.location.href);
  const debug = url.searchParams.get('formdebug');
  document.querySelectorAll('.form-overlay').forEach(el => {
    if (debug) {
      el.classList.add('debug-align');
    } else {
      el.classList.remove('debug-align');
    }
  });
  const tooltip = document.querySelector('.tooltip-box');
  if (tooltip) {
    if (debug) {
      tooltip.classList.add('debug-align');
    } else {
      tooltip.classList.remove('debug-align');
    }
  }
  if (debug) {
    console.log('Nova Form Explainer: debug alignment mode enabled.');
  }
}

function initGhost() {
  const observer = new window.IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        document.querySelectorAll('.ghost-overlay').forEach(el => {
          el.classList.add('fade-out');
        });
        observer.disconnect();
        // Start sequence after ghost fades
        setTimeout(() => runSequence(0), 800);
        // Whisper panel fade in
        setTimeout(() => {
          const panel = document.querySelector('.nova-whisper-panel');
          if(panel) panel.classList.add('active');
        }, 1200);
      }
    });
  }, { threshold: 0.2 });
  const explainerSection = document.querySelector('.form-explainer');
  if (explainerSection) observer.observe(explainerSection);
}
function initFormExplainer() {
  initTimelineScrubber();
  initOverlays();
  initReplay();
  initDebug();
  initGhost();
}
document.addEventListener('DOMContentLoaded', () => {
  // DEV MODE: Enable .devmode on body if ?devmode=1
  if (window.location.search.includes('devmode=1')) {
    document.body.classList.add('devmode');
    console.warn('[Form Explainer] DEV MODE ENABLED: overlays and controls are visually outlined.');
  }

  fetch('/modules/form-explainer.html')
    .then(res => res.text())
    .then(html => {
      document.getElementById('form-explainer-embed').innerHTML = html;
      window.initFormExplainer();
      initFormExplainer();
      // DEV MODE: After injection, force Replay Tour button visible for troubleshooting
      if (document.body.classList.contains('devmode')) {
        const replayBtn = document.querySelector('.replay-tour');
        if (replayBtn) {
          replayBtn.removeAttribute('hidden');
          replayBtn.style.display = 'flex';
          replayBtn.classList.add('active');
        }
      }

      // Fade-in for explainer image
      const img = document.querySelector('.form-highlight-img');
      if (img) {
        if (img.complete) {
          img.setAttribute('data-loaded', 'true');
        } else {
          img.addEventListener('load', () => {
            img.setAttribute('data-loaded', 'true');
          });
        }
      }
    });
});
