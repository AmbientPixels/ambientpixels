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

    // Create more visually distinct colors for the pie chart
    const colorPalette = [
      'rgba(71, 158, 245, 0.8)',  // Blue for HTML
      'rgba(255, 200, 16, 0.8)',   // Yellow for JS
      'rgba(84, 176, 84, 0.8)'     // Green for CSS
    ];

    // Get file extensions and their line counts
    const labels = Object.keys(data.summary);
    const lineData = Object.values(data.summary).map(val => val.lines);
    
    // Create a pie chart instead of a bar chart
    new Chart(chartCtx, {
      type: 'pie',
      data: {
        labels: labels.map(ext => `${ext} (${((data.summary[ext].lines / data.totalLines) * 100).toFixed(1)}%)`),
        datasets: [{
          data: lineData,
          backgroundColor: colorPalette,
          borderColor: colorPalette.map(color => color.replace('0.8', '1')),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#ccc',
              font: {
                family: 'Inter, sans-serif'
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.raw || 0;
                const total = context.chart.getDatasetMeta(0).total;
                const percentage = ((value / total) * 100).toFixed(1);
                return `${label.split(' ')[0]}: ${value.toLocaleString()} lines (${percentage}%)`;
              }
            }
          }
        }
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
  const prevButton = document.getElementById('prev-page');
  const nextButton = document.getElementById('next-page');
  const pageIndicator = document.getElementById('page-indicator');
  
  // Image stats elements
  const totalImagesEl = document.getElementById('total-images');
  const totalFoldersEl = document.getElementById('total-folders');
  const fileTypesEl = document.getElementById('file-types');
  const commonTypeEl = document.getElementById('common-type');
  
  if (!gridContainer || !prevButton || !nextButton || !pageIndicator) return;
  
  // Pagination state
  const state = {
    images: [],
    currentPage: 0,
    imagesPerPage: 12,
    totalPages: 1
  };
  
  try {
    const res = await fetch('/data/image-inventory.json?t=' + Date.now());
    const data = await res.json();
    
    // Flatten all images from all folders into a single array
    data.folders.forEach(folder => {
      folder.files.forEach(filePath => {
        state.images.push({
          path: filePath,
          name: filePath.split('/').pop(),
          folder: folder.folder
        });
      });
    });
    
    // Calculate total pages
    state.totalPages = Math.ceil(state.images.length / state.imagesPerPage);
    updatePageIndicator();
    
    // Initial render
    renderCurrentPage();
    
    // Set up event listeners for pagination
    prevButton.addEventListener('click', () => {
      if (state.currentPage > 0) {
        state.currentPage--;
        renderCurrentPage();
        updatePageIndicator();
        updateButtonStates();
      }
    });
    
    nextButton.addEventListener('click', () => {
      if (state.currentPage < state.totalPages - 1) {
        state.currentPage++;
        renderCurrentPage();
        updatePageIndicator();
        updateButtonStates();
      }
    });
    
    // Initial button state
    updateButtonStates();
    
    // Update image statistics
    updateImageStats(data);
    
  } catch (err) {
    console.error('⚠️ Failed to load image inventory:', err);
    gridContainer.innerHTML = '<div class="error-message">Failed to load image inventory</div>';
    
    // Show error in stats
    if (totalImagesEl) totalImagesEl.textContent = 'Error';
    if (totalFoldersEl) totalFoldersEl.textContent = 'Error';
    if (fileTypesEl) fileTypesEl.textContent = 'Error';
    if (commonTypeEl) commonTypeEl.textContent = 'Error';
  }
  
  // Helper functions
  function renderCurrentPage() {
    gridContainer.innerHTML = '';
    
    const start = state.currentPage * state.imagesPerPage;
    const end = Math.min(start + state.imagesPerPage, state.images.length);
    
    const pageImages = state.images.slice(start, end);
    
    if (pageImages.length === 0) {
      gridContainer.innerHTML = '<div class="empty-message">No images to display</div>';
      return;
    }
    
    pageImages.forEach(image => {
      const tile = document.createElement('div');
      tile.className = 'image-tile';
      tile.innerHTML = `
        <img src="/${image.path}" alt="${image.name}" loading="lazy">
        <div class="image-caption">${image.name}</div>
      `;
      gridContainer.appendChild(tile);
    });
  }
  
  function updatePageIndicator() {
    pageIndicator.textContent = `Page ${state.currentPage + 1} of ${state.totalPages}`;
  }
  
  function updateButtonStates() {
    prevButton.disabled = state.currentPage === 0;
    nextButton.disabled = state.currentPage >= state.totalPages - 1;
  }
}

async function loadUnusedCSSReport() {
  try {
    const res = await fetch('/data/unused-css-report.json?t=' + Date.now());
    const data = await res.json();
    const summary = document.getElementById('unused-css-summary');
    const list = document.getElementById('unused-css-list');
    const totalClassesEl = document.getElementById('total-css-classes');
    const usedClassesEl = document.getElementById('used-css-classes');
    const unusedClassesEl = document.getElementById('unused-css-classes');
    const chartCanvas = document.getElementById('cssUsageChart');
    
    if (!summary || !list) return;
    
    // Calculate stats
    const totalClasses = data.totalDefined;
    const usedClasses = totalClasses - data.unusedClasses.length;
    const unusedClasses = data.unusedClasses.length;
    const usagePercentage = ((usedClasses / totalClasses) * 100).toFixed(1);
    
    // Update summary text
    if (unusedClasses === 0) {
      summary.textContent = `🎉 All ${totalClasses} CSS classes in ${data.cssFile} are used.`;
    } else {
      summary.textContent = `CSS usage analysis for ${data.cssFile} (${usagePercentage}% utilized)`;
    }
    
    // Update stats display
    if (totalClassesEl) totalClassesEl.textContent = totalClasses;
    if (usedClassesEl) usedClassesEl.textContent = usedClasses;
    if (unusedClassesEl) unusedClassesEl.textContent = unusedClasses;
    
    // Create tag cloud for unused classes
    list.innerHTML = data.unusedClasses
      .map(cls => `<li>${cls}</li>`)
      .join('');
    
    // Create donut chart
    if (chartCanvas && typeof Chart !== 'undefined') {
      new Chart(chartCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Used Classes', 'Unused Classes'],
          datasets: [{
            data: [usedClasses, unusedClasses],
            backgroundColor: [
              'rgba(58, 242, 255, 0.7)',  // Nova blue/teal
              'rgba(255, 107, 107, 0.7)'   // Red for unused
            ],
            borderColor: [
              'rgba(58, 242, 255, 1)',
              'rgba(255, 107, 107, 1)'
            ],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: '70%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: 'rgba(182, 201, 216, 0.9)',  // var(--aura-label)
                font: {
                  size: 12
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.label || '';
                  const value = context.raw || 0;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = ((value / total) * 100).toFixed(1);
                  return `${label}: ${value} (${percentage}%)`;
                }
              }
            }
          }
        }
      });
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

// Added by Cascade 2025-07-16
function updateImageStats(data) {
  const totalImagesEl = document.getElementById('total-images');
  const totalFoldersEl = document.getElementById('total-folders');
  const fileTypesEl = document.getElementById('file-types');
  const commonTypeEl = document.getElementById('common-type');
  
  if (!totalImagesEl || !totalFoldersEl || !fileTypesEl || !commonTypeEl) return;
  
  // Use totalImages from JSON if available, otherwise calculate from folders
  let totalImages = data.totalImages;
  if (!totalImages) {
    totalImages = 0;
    data.folders.forEach(folder => {
      // Use the count property provided in the JSON
      totalImages += folder.count;
    });
  }
  
  // Count file types
  const fileTypes = {};
  data.folders.forEach(folder => {
    folder.files.forEach(filePath => {
      const extension = filePath.split('.').pop().toLowerCase();
      fileTypes[extension] = (fileTypes[extension] || 0) + 1;
    });
  });
  
  // Find most common type
  let mostCommonType = '';
  let mostCommonCount = 0;
  
  Object.entries(fileTypes).forEach(([type, count]) => {
    if (count > mostCommonCount) {
      mostCommonType = type;
      mostCommonCount = count;
    }
  });
  
  // Update stats display with accurate counts
  totalImagesEl.textContent = totalImages;
  totalFoldersEl.textContent = data.folders.length;
  fileTypesEl.textContent = Object.keys(fileTypes).join(', ');
  commonTypeEl.textContent = `${mostCommonType} (${mostCommonCount})`;
}