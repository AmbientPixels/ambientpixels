// js/nav.js — Ambient Pixels Navigation Logic

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const navContainer = document.querySelector('.nav');

  if (!toggle || !navContainer) return;

  toggle.addEventListener('click', () => {
    const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', !isExpanded);
    navContainer.classList.toggle('nav-open');
  });

  // Optional: close nav on outside click
  document.addEventListener('click', (e) => {
    if (!navContainer.contains(e.target) && toggle.getAttribute('aria-expanded') === 'true') {
      toggle.setAttribute('aria-expanded', 'false');
      navContainer.classList.remove('nav-open');
    }
  });
});

// Nova Pulse Panel Init
function loadNovaPulsePanel() {
  const panel = document.getElementById('nova-pulse');
  if (!panel) return;

  Promise.all([
    fetch('/data/version.json').then(res => res.json()),
    fetch('/data/js-function-map.json').then(res => res.json()),
    fetch('/data/mood-scan.json').then(res => res.json())
  ])
  .then(([version, jsMap, mood]) => {
    panel.querySelector('#pulse-sync').textContent = new Date(version.updated).toLocaleString();
    panel.querySelector('#pulse-modules').textContent = Object.keys(jsMap.scripts).length;
    panel.querySelector('#pulse-score').textContent = mood.aura || '∞';
  })
  .catch(err => {
    console.warn('Nova pulse failed:', err);
    panel.querySelector('#pulse-sync').textContent = 'Error';
    panel.querySelector('#pulse-modules').textContent = '--';
    panel.querySelector('#pulse-score').textContent = '??';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadNovaPulsePanel();
});
