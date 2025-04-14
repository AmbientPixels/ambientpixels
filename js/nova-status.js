// File: /js/nova-status.js — Nova Status Sync (Dashboard + Homepage)

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

// Only run if footer injects Nova Pulse
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('nova-pulse-container')) {
    initNovaStatus();
  }
});
