// /js/nova-status.js — Nova Status Card Sync
document.addEventListener('DOMContentLoaded', () => {
  const moodEl = document.getElementById('nova-mood-detail');
  const obsEl = document.getElementById('nova-observation-detail');
  const auraEl = document.getElementById('nova-aura-detail');

  fetch('/data/mood-scan.json')
    .then(res => res.json())
    .then(data => {
      if (moodEl) moodEl.textContent = data.mood;
      if (obsEl) obsEl.textContent = data.observation;
      if (auraEl) auraEl.textContent = data.aura;
    })
    .catch(err => {
      console.warn('[Nova] Could not fetch mood data.', err);
      if (moodEl) moodEl.textContent = 'Unknown';
      if (obsEl) obsEl.textContent = 'Offline';
      if (auraEl) auraEl.textContent = '???';
    });
});