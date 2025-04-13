// /js/nova-status.js — Nova Status Card Sync (Dashboard + Homepage)

document.addEventListener('DOMContentLoaded', () => {
  // Dashboard Elements
  const moodDetailEl = document.getElementById('nova-mood-detail');
  const obsDetailEl = document.getElementById('nova-observation-detail');
  const auraDetailEl = document.getElementById('nova-aura-detail');
  const versionDetailEl = document.getElementById('nova-version-detail');
  const syncTimeEl = document.getElementById('nova-sync-time');

  // Homepage Elements
  const moodHomeEl = document.getElementById('nova-mood');
  const obsHomeEl = document.getElementById('nova-observation');
  const auraHomeEl = document.getElementById('nova-aura');
  const versionHomeEl = document.getElementById('nova-version');

  // Fetch mood and version data
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

  // Nova Speaks — quote of the moment
  const waitForQuote = setInterval(() => {
    const quoteEl = document.getElementById('nova-quote');
    if (quoteEl) {
      clearInterval(waitForQuote);
      fetch('/data/mood-scan.json')
        .then(res => res.json())
        .then(data => {
          quoteEl.textContent = `💭 "${data.quote || 'No spark today.'}"`;
        })
        .catch(err => {
          quoteEl.textContent = '💭 "Nova is silent."';
          console.warn('[Nova] Quote load failed:', err);
        });
    }
  }, 100);

  // Nova Module Count
  const waitForModules = setInterval(() => {
    const countEl = document.getElementById('nova-module-count');
    if (countEl) {
      clearInterval(waitForModules);
      fetch('/data/site-structure.json')
        .then(res => res.json())
        .then(data => {
          const count = Object.keys(data).length;
          countEl.textContent = count;
        })
        .catch(err => {
          countEl.textContent = '??';
          console.warn('[Nova] Module count failed:', err);
        });
    }
  }, 100);
});
