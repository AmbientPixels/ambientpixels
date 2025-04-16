// File: /js/nova-dashboard.js (Fixed Version)

document.addEventListener("DOMContentLoaded", () => {
  loadVersionAndMood();
  loadAwarenessLogs();
  renderCodeFootprintChart();
  loadFunctionMap();
  loadPromptHistory();
  loadImageInventoryGrid();
  loadUnusedCSSReport();
  loadApiMonitor();
  loadCodeMap();
});

async function loadVersionAndMood() {
  try {
    const versionRes = await fetch('/data/version.json?t=' + Date.now());
    const moodRes = await fetch('/data/mood-scan.json?t=' + Date.now());
    const versionData = await versionRes.json();
    const moodData = await moodRes.json();

    const versionEl = document.getElementById('nova-version');
    if (versionEl) versionEl.textContent = `${versionData.version} (build ${versionData.build})`;

    const moodEl = document.getElementById('nova-mood');
    const auraEl = document.getElementById('nova-aura');
    const observationEl = document.getElementById('nova-observation');
    if (moodEl) moodEl.textContent = moodData.mood;
    if (auraEl) auraEl.textContent = moodData.aura;
    if (observationEl) observationEl.textContent = moodData.observation;
  } catch (err) {
    console.error('⚠️ Failed to load version or mood data:', err);
  }
}

async function loadAwarenessLogs() {
  try {
    const res = await fetch('/data/changelog.json?t=' + Date.now());
    const data = await res.json();
    const logList = document.getElementById('log-list');
    if (!logList) return;
    logList.innerHTML = '';

    data.entries.forEach(entry => {
      const date = new Date(entry.date).toLocaleString('en-US', {
        dateStyle: 'long',
        timeStyle: 'short'
      });
      const li = document.createElement('li');
      li.innerHTML = `
        <strong>Commit:</strong> <code>${entry.hash}</code><br/>
        <strong>Message:</strong> ${entry.message}<br/>
        <strong>Date:</strong> ${date}
      `;
      logList.appendChild(li);
    });
  } catch (err) {
    console.error('⚠️ Failed to load awareness logs:', err);
  }
}

async function renderCodeFootprintChart() {
  try {
    const res = await fetch('/data/code-footprint.json?t=' + Date.now());
    const data = await res.json();
    const ctx = document.getElementById('codeFootprintChart');
    if (!ctx) return;
    const chartCtx = ctx.getContext('2d');

    new Chart(chartCtx, {
      type: 'bar',
      data: {
        labels: Object.keys(data.summary),
        datasets: [{
          label: 'Lines of Code',
          data: Object.values(data.summary).map(val => val.lines),
          backgroundColor: ['#479ef5', '#ffc810', '#54b054']
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 100 } } }
      }
    });
  } catch (err) {
    console.error('⚠️ Failed to load code footprint:', err);
  }
}

async function loadFunctionMap() {
  try {
    const res = await fetch('/data/js-function-map.json?t=' + Date.now());
    const data = await res.json();
    const container = document.getElementById('function-map-output');
    if (!container) return;
    container.innerHTML = '';

    Object.entries(data.scripts).forEach(([file, functions]) => {
      const block = document.createElement('div');
      block.className = 'script-block';
      block.innerHTML = `
        <h3>${file}</h3>
        <ul>${functions.map(fn => `<li>${fn}()</li>`).join('')}</ul>
      `;
      container.appendChild(block);
    });
  } catch (err) {
    console.error('⚠️ Failed to load function map:', err);
  }
}

async function loadPromptHistory() {
  try {
    const res = await fetch('/data/ai-prompts.json?t=' + Date.now());
    const data = await res.json();
    const container = document.querySelector('.prompt-history .prompt-entry');
    if (!container) return;

    const date = new Date(data.date).toLocaleDateString();
    container.innerHTML = `
      <p><strong>Date:</strong> ${date}</p>
      <p><strong>Prompt:</strong> ${data.prompt}</p>
      <p><strong>Tags:</strong> ${data.tags.join(', ')}</p>
    `;
  } catch (err) {
    console.error('⚠️ Failed to load prompt history:', err);
  }
}

async function loadImageInventoryGrid() {
  const gridContainer = document.getElementById('image-grid');
  if (!gridContainer) return;

  try {
    const res = await fetch('/data/image-inventory.json?t=' + Date.now());
    const data = await res.json();
    data.folders.forEach(folder => {
      folder.files.forEach(filePath => {
        const fileName = filePath.split('/').pop();
        const tile = document.createElement('div');
        tile.className = 'image-tile unused';
        tile.innerHTML = `
          <img src="/${filePath}" alt="${fileName}" loading="lazy">
          <div class="image-caption">${fileName}</div>
        `;
        gridContainer.appendChild(tile);
      });
    });
  } catch (err) {
    console.error('⚠️ Failed to load image inventory:', err);
  }
}

async function loadUnusedCSSReport() {
  try {
    const res = await fetch('/data/unused-css-report.json?t=' + Date.now());
    const data = await res.json();
    const summary = document.getElementById('unused-css-summary');
    const list = document.getElementById('unused-css-list');
    if (!summary || !list) return;

    if (data.unusedClasses.length === 0) {
      summary.textContent = `🎉 All ${data.totalUsed} CSS classes in ${data.cssFile} are used.`;
    } else {
      summary.textContent = `Found ${data.unusedClasses.length} unused CSS classes in ${data.cssFile}:`;
      list.innerHTML = data.unusedClasses.map(cls => `<li><code>${cls}</code></li>`).join('');
    }
  } catch (err) {
    console.error('⚠️ Failed to load unused CSS report:', err);
    const summary = document.getElementById('unused-css-summary');
    if (summary) summary.textContent = '⚠️ Could not load CSS data.';
  }
}

async function loadApiMonitor() {
  try {
    const res = await fetch('/data/api-monitor.json?t=' + Date.now());
    const data = await res.json();
    const list = document.getElementById('api-monitor-list');
    if (!list) return;
    list.innerHTML = '';

    data.endpoints.forEach(api => {
      const item = document.createElement('li');
      item.className = api.ok ? 'ok' : 'fail';
      item.innerHTML = `
        ${api.name} → <code>${api.url}</code><br />
        Status: ${api.status}, Latency: ${api.latencyMs} ms
      `;
      list.appendChild(item);
    });
  } catch (err) {
    console.error('⚠️ Failed to load API monitor:', err);
    const list = document.getElementById('api-monitor-list');
    if (list) list.innerHTML = '<li>⚠️ Could not load API data.</li>';
  }
}

async function loadCodeMap() {
  try {
    const res = await fetch('/data/code-map.json?t=' + Date.now());
    const data = await res.json();
    const summaryEl = document.getElementById('code-summary');
    if (!summaryEl) return;

    summaryEl.innerHTML = `
      <p><strong>Total JS:</strong> ${data.summary.totalJS}</p>
      <p><strong>Total CSS:</strong> ${data.summary.totalCSS}</p>
      <p><strong>Total HTML:</strong> ${data.summary.totalHTML}</p>
      <p><strong>Last Updated:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
    `;

    renderList('code-functions', data.functions);
    renderList('code-classes', data.cssClasses);
    renderList('code-tags', data.htmlTags);
  } catch (err) {
    console.error('⚠️ Failed to load code map:', err);
  }
}

function renderList(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  items.slice(0, 50).forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    el.appendChild(li);
  });
}