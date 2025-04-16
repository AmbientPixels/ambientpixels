// File: /js/nova-dashboard.js

// Initialize Nova Dashboard Modules

document.addEventListener("DOMContentLoaded", () => {
  const codeEl = document.getElementById("code-footprint");
  if (codeEl) {
    // safe to render chart
  }

  const logEl = document.getElementById("changelog");
  if (logEl) {
    // load changelog
  }
});

// Load version.json + mood-scan.json
async function loadVersionAndMood() {
  try {
    const versionRes = await fetch('/data/version.json');
    const moodRes = await fetch('/data/mood-scan.json');
    const versionData = await versionRes.json();
    const moodData = await moodRes.json();

    document.getElementById('nova-version').textContent = `${versionData.version} (build ${versionData.build})`;
    document.getElementById('nova-mood').textContent = moodData.mood;
    document.getElementById('nova-aura').textContent = moodData.aura;
    document.getElementById('nova-observation').textContent = moodData.observation;
  } catch (err) {
    console.error('⚠️ Failed to load version or mood data:', err);
  }
}

// Load changelog.json into Awareness Logs
async function loadAwarenessLogs() {
  try {
    const res = await fetch('/data/changelog.json');
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

// Render Code Footprint Chart
async function renderCodeFootprintChart() {
  try {
    const res = await fetch('/data/code-footprint.json');
    const data = await res.json();
    const ctx = document.getElementById('codeFootprintChart').getContext('2d');

    new Chart(ctx, {
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
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 100 } }
        }
      }
    });
  } catch (err) {
    console.error('⚠️ Failed to load code footprint:', err);
  }
}

// Load Function Map
async function loadFunctionMap() {
  try {
    const res = await fetch('/data/js-function-map.json');
    const data = await res.json();
    const container = document.getElementById('function-map-output');
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

// Load Prompt History
async function loadPromptHistory() {
  try {
    const res = await fetch('/data/ai-prompts.json');
    const data = await res.json();
    const container = document.querySelector('.prompt-history .prompt-entry');
    if (container) {
      const date = new Date(data.date).toLocaleDateString();
      container.innerHTML = `
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Prompt:</strong> ${data.prompt}</p>
        <p><strong>Tags:</strong> ${data.tags.join(', ')}</p>
      `;
    }
  } catch (err) {
    console.error('⚠️ Failed to load prompt history:', err);
  }
}

// Load Image Inventory Grid
async function loadImageInventoryGrid() {
  const gridContainer = document.getElementById('image-grid');
  if (!gridContainer) return;

  try {
    const res = await fetch('/data/image-inventory.json');
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

// Load Unused CSS Report
async function loadUnusedCSSReport() {
  try {
    const res = await fetch('/data/unused-css-report.json');
    const data = await res.json();
    const summary = document.getElementById('unused-css-summary');
    const list = document.getElementById('unused-css-list');

    if (data.unusedClasses.length === 0) {
      summary.textContent = `🎉 All ${data.totalUsed} CSS classes in ${data.cssFile} are used.`;
    } else {
      summary.textContent = `Found ${data.unusedClasses.length} unused CSS classes in ${data.cssFile}:`;
      list.innerHTML = data.unusedClasses.map(cls => `<li><code>${cls}</code></li>`).join('');
    }
  } catch (err) {
    console.error('⚠️ Failed to load unused CSS report:', err);
    document.getElementById('unused-css-summary').textContent = '⚠️ Could not load CSS data.';
  }
}

// Load API Monitor
async function loadApiMonitor() {
  try {
    const res = await fetch('/data/api-monitor.json');
    const data = await res.json();
    const list = document.getElementById('api-monitor-list');
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
    document.getElementById('api-monitor-list').innerHTML = '<li>⚠️ Could not load API data.</li>';
  }
}

// Load and render code awareness map
async function loadCodeMap() {
  const res = await fetch('/data/code-map.json');
  const data = await res.json();

  document.getElementById('code-summary').innerHTML = `
    <p><strong>Total JS:</strong> ${data.summary.totalJS}</p>
    <p><strong>Total CSS:</strong> ${data.summary.totalCSS}</p>
    <p><strong>Total HTML:</strong> ${data.summary.totalHTML}</p>
    <p><strong>Last Updated:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
  `;

  renderList('code-functions', data.functions);
  renderList('code-classes', data.cssClasses);
  renderList('code-tags', data.htmlTags);
}

function renderList(id, items) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  items.slice(0, 50).forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    el.appendChild(li);
  });
}
