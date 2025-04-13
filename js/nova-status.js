// /js/nova-status.js — Nova Status Card Sync (Dashboard + Homepage)

document.addEventListener('DOMContentLoaded', () => {
  // Dashboard Elements
  const moodDetailEl = document.getElementById('nova-mood-detail');
  const obsDetailEl = document.getElementById('nova-observation-detail');
  const auraDetailEl = document.getElementById('nova-aura-detail');
  const versionDetailEl = document.getElementById('nova-version-detail');
  const syncTimeEl = document.getElementById('nova-sync-time');

  // Homepage Elements (fixed IDs)
  const moodScanEl = document.getElementById('nova-mood');
  const moodSyntheticEl = document.getElementById('nova-synth-mood');
  const moodHybridEl = document.getElementById('nova-hybrid-mood');
  const versionHomeEl = document.getElementById('nova-version');
  const moduleCountEl = document.getElementById('nova-module-count');

  // Fetch mood, version, and structure data
  Promise.all([
    fetch('/data/mood-scan.json').then(res => res.json()),
    fetch('/data/version.json').then(res => res.json()),
    fetch('/data/site-structure.json').then(res => res.json())
  ])
    .then(([moodData, versionData, structureData]) => {
      const count = Object.keys(structureData).length;
      if (moduleCountEl) moduleCountEl.textContent = count;

      if (syncTimeEl && versionData.updated) {
        const time = new Date(versionData.updated);
        syncTimeEl.textContent = `${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${time.toLocaleDateString()}`;
      }
      if (moodDetailEl) moodDetailEl.textContent = moodData.mood;
      if (obsDetailEl) obsDetailEl.textContent = moodData.observation;
      if (auraDetailEl) auraDetailEl.textContent = moodData.aura;
      if (versionDetailEl) versionDetailEl.textContent = `${versionData.version} (build ${versionData.build})`;

      if (moodScanEl) moodScanEl.textContent = moodData.mood;
      if (moodSyntheticEl) moodSyntheticEl.textContent = moodData.aiMood || 'Synth not generated';
      if (moodHybridEl) moodHybridEl.textContent = moodData.hybridMood || 'No reflection today';

      if (versionHomeEl) {
        versionHomeEl.textContent = `${versionData.version} (build ${versionData.build})`;
      }
    })
    .catch(err => {
      console.warn('[Nova] Could not fetch mood, version or structure data.', err);

      if (moodDetailEl) moodDetailEl.textContent = 'Unknown';
      if (obsDetailEl) obsDetailEl.textContent = 'Offline';
      if (auraDetailEl) auraDetailEl.textContent = '???';
      if (versionDetailEl) versionDetailEl.textContent = '–';

      if (moodScanEl) moodScanEl.textContent = '???';
      if (moodSyntheticEl) moodSyntheticEl.textContent = '???';
      if (moodHybridEl) moodHybridEl.textContent = '???';
      if (versionHomeEl) versionHomeEl.textContent = '–';
      if (moduleCountEl) moduleCountEl.textContent = '--';
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
});
