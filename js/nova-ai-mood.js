// nova-ai-mood.js
// Front-end logic for Nova AI Mood Dashboard

document.addEventListener('DOMContentLoaded', () => {
  if (typeof initHeaderFooter === 'function') initHeaderFooter();
  initListeners();
  loadMood();
  initAurora();
});

function initListeners() {
  document.getElementById('refreshMood').addEventListener('click', loadMood);
  document.getElementById('feedbackYes').addEventListener('click', () => submitFeedback(true));
  document.getElementById('feedbackNo').addEventListener('click', () => submitFeedback(false));
}

async function loadMood() {
  try {
    const res = await fetch('/api/fetchlatestmood');
    const data = await res.json();
    updateMoodPanel(data);
    // Only update traits and history if those fields exist
    if ('selfWorth' in data) updateTraitRadials(data);
    if (Array.isArray(data.history)) updateHistory(data.history, data);
    updateBadges();
    updateStatusWidgets();
    updateTrainingProgress();
  } catch (err) {
    console.error('Error loading AI mood:', err);
  }
}

function updateMoodPanel(data) {
  // Map mood to emojis or default icon
  const emojiMap = {
    neutral: '😐',
    happy: '😊',
    frustrated: '😤',
    content: '🙂',
    sad: '😢'
  };
  document.getElementById('moodEmoji').textContent = emojiMap[data.mood] || '🤖';
  document.getElementById('moodTitle').textContent = data.mood;
  // Display GitHub status in place of aura
  document.getElementById('moodAura').textContent = data.githubStatus || '';
  document.getElementById('moodAura').style.color = '#ffffff';
  // Show insights instead of quote
  document.getElementById('moodQuote').textContent = data.insights || '';
  // Format timestamp
  const ts = new Date(data.timestamp);
  document.getElementById('moodTimestamp').textContent = isNaN(ts) ? '' : ts.toLocaleString();
  document.getElementById('moodConfidence').textContent = `Confidence: ${Math.round(data.confidence * 100)}%`;
}

function updateTraitRadials(data) {
  const traits = ['selfWorth', 'glitchFactor', 'memoryClutter', 'awareness'];
  const panel = document.getElementById('traitsPanel');
  panel.innerHTML = '';

  traits.forEach(trait => {
    const value = Math.round((data[trait] || 0) * 100);
    const container = document.createElement('div');
    container.className = 'trait-radial';
    container.innerHTML = `
      <svg viewBox="0 0 36 36" class="circular-chart">
        <path class="circle-bg" d="M18 2.0845
          a 15.9155 15.9155 0 0 1 0 31.831
          a 15.9155 15.9155 0 0 1 0 -31.831"/>
        <path class="circle" stroke-dasharray="${value}, 100" d="M18 2.0845
          a 15.9155 15.9155 0 0 1 0 31.831
          a 15.9155 15.9155 0 0 1 0 -31.831"/>
        <text x="18" y="20.35" class="percentage">${value}%</text>
      </svg>
      <div class="trait-label">${trait}</div>
    `;
    panel.appendChild(container);
  });
}

function updateHistory(historyData, latest) {
  const svg = document.getElementById('historySparkline');
  // TODO: fetch real history; for now include latest only
  const values = historyData.map(d => sentimentScore(d.mood));
  values.push(sentimentScore(latest.mood));
  // render simple sparkline
  const w = svg.clientWidth || 200;
  const h = svg.clientHeight || 50;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const max = Math.max(...values, 1);
  const points = values.map((v,i) => `${(i/(values.length-1))*w},${h - (v/max)*h}`).join(' ');
  svg.innerHTML = `<polyline fill="none" stroke="#fff" stroke-width="2" points="${points}" />`;
}

function sentimentScore(mood) {
  const map = { joy:1, neutral:0.5, sadness:0, anger:0.2 };
  return map[mood.toLowerCase()] || 0.5;
}

function updateBadges() {
  const container = document.querySelector('#badgePanel .badges');
  container.innerHTML = '';
  // TODO: load earned badges
}

function submitFeedback(isYes) {
  // record feedback for latest mood
  console.log('Feedback:', isYes);
  // TODO: send to server or store locally
}

function updateTrainingProgress() {
  const bar = document.getElementById('trainingProgress');
  // TODO: compute real progress
  bar.style.width = '40%';
}

function updateStatusWidgets() {
  const panel = document.getElementById('statusPanel');
  panel.innerHTML = '';
  // TODO: populate weather, system health, twitch status, etc.
}

function initAurora() {
  // TODO: setup canvas aurora animations based on auraColorHex and glitchFactor
}
