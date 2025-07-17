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

// Updated by Cascade 2025-07-16
async function loadFunctionMap() {
  try {
    const res = await fetch('/data/js-function-map.json?t=' + Date.now());
    const data = await res.json();
    const container = document.getElementById('function-map-output');
    if (!container) return;
    container.innerHTML = '';
    
    // Create summary stats
    const totalScripts = Object.keys(data.scripts).length;
    const totalFunctions = Object.values(data.scripts).reduce((sum, fns) => sum + fns.length, 0);
    
    // Create stats cards
    const statsContainer = document.createElement('div');
    statsContainer.className = 'function-map-stats';
    statsContainer.innerHTML = `
      <div class="dashboard-stat">
        <div class="dashboard-label">Total Scripts</div>
        <div class="dashboard-value">${totalScripts}</div>
      </div>
      <div class="dashboard-stat">
        <div class="dashboard-label">Total Functions</div>
        <div class="dashboard-value">${totalFunctions}</div>
      </div>
      <div class="dashboard-stat">
        <div class="dashboard-label">Last Updated</div>
        <div class="dashboard-value">${new Date(data.scannedAt).toLocaleDateString()}</div>
      </div>
    `;
    container.appendChild(statsContainer);
    
    // Create filter input
    const filterContainer = document.createElement('div');
    filterContainer.className = 'function-map-filter';
    filterContainer.innerHTML = `
      <input type="text" id="function-filter" placeholder="Filter functions..." class="filter-input">
    `;
    container.appendChild(filterContainer);
    
    // Create accordion for script files
    const accordion = document.createElement('div');
    accordion.className = 'function-map-accordion';
    container.appendChild(accordion);
    
    // Add script blocks to accordion
    Object.entries(data.scripts).forEach(([file, functions]) => {
      const block = document.createElement('div');
      block.className = 'script-block';
      
      const header = document.createElement('div');
      header.className = 'script-header';
      header.innerHTML = `
        <h3>${file}</h3>
        <span class="function-count">${functions.length}</span>
      `;
      header.addEventListener('click', () => {
        block.classList.toggle('expanded');
      });
      
      const functionTags = document.createElement('div');
      functionTags.className = 'function-tags';
      functionTags.innerHTML = functions.map(fn => 
        `<span class="function-tag">${fn}</span>`
      ).join('');
      
      block.appendChild(header);
      block.appendChild(functionTags);
      accordion.appendChild(block);
    });
    
    // Add filter functionality
    const filterInput = document.getElementById('function-filter');
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        const value = e.target.value.toLowerCase();
        document.querySelectorAll('.function-tag').forEach(tag => {
          const matches = tag.textContent.toLowerCase().includes(value);
          tag.style.display = matches || value === '' ? 'inline-block' : 'none';
        });
        
        document.querySelectorAll('.script-block').forEach(block => {
          const visibleTags = block.querySelectorAll('.function-tag[style="display: inline-block"]').length;
          block.style.display = visibleTags > 0 || value === '' ? 'block' : 'none';
        });
      });
    }
  } catch (err) {
    console.error('⚠️ Failed to load function map:', err);
    const container = document.getElementById('function-map-output');
    if (container) container.innerHTML = '<div class="error-message">⚠️ Could not load function map data.</div>';
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

// Updated by Cascade 2025-07-16
async function loadCodeMap() {
  try {
    const res = await fetch('/data/code-map.json?t=' + Date.now());
    const data = await res.json();
    const container = document.getElementById('code-summary');
    if (!container) return;
    container.innerHTML = '';
    
    // Create summary stats - use actual array lengths instead of summary values
    const totalJS = data.functions.length;
    const totalCSS = data.cssClasses.length;
    const totalHTML = data.htmlTags.length;
    const totalItems = totalJS + totalCSS + totalHTML;
    
    // Create stats cards
    const statsContainer = document.createElement('div');
    statsContainer.className = 'function-map-stats';
    statsContainer.innerHTML = `
      <div class="dashboard-stat">
        <div class="dashboard-label">JavaScript</div>
        <div class="dashboard-value">${totalJS}</div>
        <div class="dashboard-subtext">functions</div>
      </div>
      <div class="dashboard-stat">
        <div class="dashboard-label">CSS</div>
        <div class="dashboard-value">${totalCSS}</div>
        <div class="dashboard-subtext">classes</div>
      </div>
      <div class="dashboard-stat">
        <div class="dashboard-label">HTML</div>
        <div class="dashboard-value">${totalHTML}</div>
        <div class="dashboard-subtext">tags</div>
      </div>
      <div class="dashboard-stat">
        <div class="dashboard-label">Last Updated</div>
        <div class="dashboard-value">${new Date(data.timestamp).toLocaleDateString()}</div>
        <div class="dashboard-subtext">${new Date(data.timestamp).toLocaleTimeString()}</div>
      </div>
    `;
    container.appendChild(statsContainer);
    
    // Create filter input
    const filterContainer = document.createElement('div');
    filterContainer.className = 'function-map-filter';
    filterContainer.innerHTML = `
      <input type="text" id="code-filter" placeholder="Filter code elements..." class="filter-input">
    `;
    container.appendChild(filterContainer);
    
    // Create accordion for code categories
    const accordion = document.createElement('div');
    accordion.className = 'function-map-accordion';
    container.appendChild(accordion);
    
    // Create function category
    const functionBlock = createCodeCategory('Functions', data.functions, 'function-count');
    accordion.appendChild(functionBlock);
    
    // Create CSS classes category
    const cssBlock = createCodeCategory('CSS Classes', data.cssClasses, 'css-count');
    accordion.appendChild(cssBlock);
    
    // Create HTML tags category
    const htmlBlock = createCodeCategory('HTML Tags', data.htmlTags, 'html-count');
    accordion.appendChild(htmlBlock);
    
    // Add filter functionality
    const filterInput = document.getElementById('code-filter');
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        const value = e.target.value.toLowerCase();
        document.querySelectorAll('.code-tag').forEach(tag => {
          const matches = tag.textContent.toLowerCase().includes(value);
          tag.style.display = matches || value === '' ? 'inline-block' : 'none';
        });
        
        document.querySelectorAll('.code-category').forEach(block => {
          const visibleTags = block.querySelectorAll('.code-tag[style="display: inline-block"]').length;
          if (visibleTags > 0 || value === '') {
            block.style.display = 'block';
            block.classList.add('expanded');
          } else {
            block.style.display = 'block';
            block.classList.remove('expanded');
          }
        });
      });
    }
  } catch (err) {
    console.error('⚠️ Failed to load code map:', err);
    const container = document.getElementById('code-summary');
    if (container) container.innerHTML = '<div class="error-message">⚠️ Could not load code map data.</div>';
  }
}

// Helper function to create code category blocks - added by Cascade 2025-07-16
function createCodeCategory(title, items, countId) {
  const block = document.createElement('div');
  block.className = 'code-category';
  
  const header = document.createElement('div');
  header.className = 'code-header';
  header.innerHTML = `
    <h3>${title}</h3>
    <span class="code-count" id="${countId}">${items.length}</span>
  `;
  header.addEventListener('click', () => {
    block.classList.toggle('expanded');
  });
  
  const tagCloud = document.createElement('div');
  tagCloud.className = 'function-tags';
  
  // Only show first 50 items to avoid overwhelming the UI
  items.slice(0, 50).forEach(item => {
    const tag = document.createElement('span');
    tag.className = 'code-tag';
    tag.textContent = item;
    tagCloud.appendChild(tag);
  });
  
  // Add a count indicator if there are more items
  if (items.length > 50) {
    const more = document.createElement('span');
    more.className = 'more-tag';
    more.textContent = `+${items.length - 50} more`;
    tagCloud.appendChild(more);
  }
  
  block.appendChild(header);
  block.appendChild(tagCloud);
  return block;
}

// Updated by Cascade 2025-07-16
function renderTagCloud(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  
  // Update the count badge
  let countId;
  if (id === 'code-functions') {
    countId = 'function-count';
  } else if (id === 'code-classes') {
    countId = 'css-count';
  } else if (id === 'code-tags') {
    countId = 'html-count';
  }
  
  const countEl = document.getElementById(countId);
  if (countEl) {
    countEl.textContent = items.length;
  }
  
  // Only show first 50 items to avoid overwhelming the UI
  items.slice(0, 50).forEach(item => {
    const tag = document.createElement('span');
    tag.className = 'code-tag';
    tag.textContent = item;
    el.appendChild(tag);
  });
  
  // Add a count indicator if there are more items
  if (items.length > 50) {
    const more = document.createElement('span');
    more.className = 'more-tag';
    more.textContent = `+${items.length - 50} more`;
    el.appendChild(more);
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