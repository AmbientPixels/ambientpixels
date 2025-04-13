// File: /js/init-nav.js – Modular Nav, Footer, and Nova Pulse

fetch('/modules/header.html')
  .then(r => r.text())
  .then(html => {
    document.getElementById('nav-header').innerHTML = html;
    setupMobileNav();
    setupThemeToggle();
  });

fetch('/modules/footer.html')
  .then(r => r.text())
  .then(html => {
    const footer = document.getElementById('footer-container');
    if (footer) {
      footer.innerHTML = html;
      initFooter();
    }
  });

function setupMobileNav() {
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (!navToggle || !navLinks) return;
  const overlay = document.createElement('div');
  overlay.classList.add('nav-overlay');
  document.body.appendChild(overlay);
  navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    overlay.classList.toggle('active');
  });
  overlay.addEventListener('click', () => {
    navLinks.classList.remove('active');
    overlay.classList.remove('active');
  });
}

function setupThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('preferred-theme', next);
    const icon = toggle.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-sun', next === 'light');
      icon.classList.toggle('fa-moon', next === 'dark');
    }
  });
}

function initFooter() {
  fetch('/data/version.json')
    .then(res => res.json())
    .then(data => {
      const versionEl = document.getElementById('version');
      if (versionEl) versionEl.textContent = data.version;
    });

  fetch('/modules/nova-pulse.html')
    .then(res => res.text())
    .then(html => {
      document.getElementById('nova-pulse-container').innerHTML = html;
      initNovaStatus(); // 🚀 INIT NOVA STATUS AFTER INJECTION
    });
}

// Nova Status Moved In Here
function initNovaStatus() {
  const moodDetailEl = document.getElementById('nova-mood-detail');
  const obsDetailEl = document.getElementById('nova-observation-detail');
  const auraDetailEl = document.getElementById('nova-aura-detail');
  const versionDetailEl = document.getElementById('nova-version-detail');
  const syncTimeEl = document.getElementById('nova-sync-time');

  const moodHomeEl = document.getElementById('nova-mood');
  const obsHomeEl = document.getElementById('nova-observation');
  const auraHomeEl = document.getElementById('nova-aura');
  const versionHomeEl = document.getElementById('nova-version');

  Promise.all([
    fetch('/data/mood-scan.json').then(res => res.json()),
    fetch('/data/version.json').then(res => res.json())
  ])
    .then(([moodData, versionData]) => {
      if (syncTimeEl && versionData.updated) {
        const time = new Date(versionData.updated);
        syncTimeEl.textContent = `${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${time.toLocaleDateString()}`;
      }
      if (moodDetailEl) moodDetailEl.textContent = moodData.mood;
      if (obsDetailEl) obsDetailEl.textContent = moodData.observation;
      if (auraDetailEl) auraDetailEl.textContent = moodData.aura;
      if (versionDetailEl) versionDetailEl.textContent = `${versionData.version} (build ${versionData.build})`;

      if (moodHomeEl) {
        moodHomeEl.textContent = moodData.moodText || moodData.mood;
        moodHomeEl.dataset.mood = moodData.moodKey || '';
      }
      if (obsHomeEl) obsHomeEl.textContent = moodData.observation;
      if (auraHomeEl) {
        auraHomeEl.textContent = moodData.auraColor || moodData.aura;
        auraHomeEl.dataset.aura = moodData.auraKey || '';
      }
      if (versionHomeEl) {
        versionHomeEl.textContent = `${versionData.version} (build ${versionData.build})`;
      }
    })
    .catch(err => {
      console.warn('[Nova] Could not fetch mood or version data.', err);

      if (moodDetailEl) moodDetailEl.textContent = 'Unknown';
      if (obsDetailEl) obsDetailEl.textContent = 'Offline';
      if (auraDetailEl) auraDetailEl.textContent = '???';
      if (versionDetailEl) versionDetailEl.textContent = '–';

      if (moodHomeEl) moodHomeEl.textContent = '???';
      if (obsHomeEl) obsHomeEl.textContent = '...';
      if (auraHomeEl) auraHomeEl.textContent = 'dark';
      if (versionHomeEl) versionHomeEl.textContent = '–';
    });

  const quoteEl = document.getElementById('nova-voice-line');
  if (quoteEl) {
    fetch('/data/nova-quotes.json')
      .then(res => res.json())
      .then(quotes => {
        if (quotes && quotes.length > 0) {
          const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
          quoteEl.textContent = `“${randomQuote}”`;
        }
      })
      .catch(err => {
        console.warn('[Nova] Could not load quotes.', err);
      });
  }
}
