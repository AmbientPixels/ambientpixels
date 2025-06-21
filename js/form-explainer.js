// Nova Form Explainer Interactive Module – Full Sequence
// Handles overlays, ghost, whisper, timeline, replay, debug, accessibility

const whispers = {
  title: "This field routes their intent—Nova listens for clarity, not just keywords.",
  dropdown: "Routing logic adapts per game. Each selection opens a new path for support.",
  upload: "We filtered what matters. Screenshots help surface the real issue, fast.",
  submit: "The final click. It speaks for them—Nova ensures every detail is carried home."
};
const sequenceKeys = ["title", "dropdown", "upload", "submit"];
const stepTimeout = 2500, buffer = 800;
let currentStep = 0, sequenceActive = false, sequenceTimer = null, userInterrupted = false;

function setWhisper(step) {
  const panel = document.querySelector('.nova-whisper-panel');
  if (!panel) return;
  panel.textContent = whispers[sequenceKeys[step]] || '';
  panel.classList.add('active');
}
function clearWhisper() {
  const panel = document.querySelector('.nova-whisper-panel');
  if (panel) panel.classList.remove('active');
}
function setOverlay(step) {
  document.querySelectorAll('.form-overlay').forEach((el, idx) => {
    el.classList.toggle('active', idx === step);
    el.setAttribute('tabindex', 0);
    el.setAttribute('aria-label', el.getAttribute('data-tooltip'));
  });
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
  if (btn) btn.style.display = show ? 'block' : 'none';
  if (btn) btn.classList.toggle('active', show);
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
  if (currentStep < sequenceKeys.length - 1) {
    sequenceTimer = setTimeout(() => { currentStep++; stepNext(); }, stepTimeout+buffer);
  } else {
    sequenceTimer = setTimeout(() => {
      clearOverlays();
      clearWhisper();
      setTimeline(-1);
      showReplay(true);
      sequenceActive = false;
    }, stepTimeout);
  }
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
  if (!scrubber) return;
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
  let tooltip = document.createElement('div');
  tooltip.className = 'form-explainer-tooltip';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.userSelect = 'none';
  tooltip.style.fontWeight = '500';
  tooltip.style.letterSpacing = '0.01em';
  tooltip.textContent = target.getAttribute('data-tooltip');
  document.body.appendChild(tooltip);
  const rect = target.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width/2 - tooltip.offsetWidth/2}px`;
  tooltip.style.top = `${rect.top - tooltip.offsetHeight - 12}px`;
  target._tooltip = tooltip;
}

function hideTooltip(target) {
  if (target._tooltip) {
    document.body.removeChild(target._tooltip);
    target._tooltip = null;
  }
}

function initOverlays() {
  document.querySelectorAll('.form-overlay').forEach((overlay, idx) => {
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
function initReplay() {
  const btn = document.querySelector('.replay-tour');
  if (!btn) return;
  btn.addEventListener('click', () => { runSequence(0); });
}
function initDebug() {
  const url = new URL(window.location.href);
  if (url.searchParams.get('formdebug')) {
    document.querySelectorAll('.form-overlay').forEach(el => {
      el.style.outline = '2px dashed #7cf3ff';
      el.style.background = 'rgba(124,243,255,0.07)';
    });
    console.log('Nova Form Explainer: debug mode enabled.');
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
  fetch('/modules/form-explainer.html')
    .then(res => res.text())
    .then(html => {
      document.getElementById('form-explainer-embed').innerHTML = html;
      initFormExplainer();
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
