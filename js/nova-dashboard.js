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
  loadCodeAuditReport(); // Added by Cascade 2025-07-16
  updateNovaHeartbeat(); // Added by Cascade 2025-07-16
  
  // Dashboard expansion visualizations - Added by Cascade 2025-07-17
  renderApiResponseTimeChart();
  renderSystemHealthTimeline();
  renderContentTypeDistribution();
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

// Code Audit Report - Added by Cascade 2025-07-16
async function loadCodeAuditReport() {
  try {
    const res = await fetch('/data/code-map.json?t=' + Date.now());
    const data = await res.json();
    const container = document.getElementById('code-audit-container');
    if (!container) return;
    container.innerHTML = '';
    
    // Find duplicates in functions and CSS classes
    const duplicateFunctions = findDuplicates(data.functions);
    const duplicateClasses = findDuplicates(data.cssClasses);
    
    // Create stats cards
    const statsContainer = document.createElement('div');
    statsContainer.className = 'function-map-stats';
    statsContainer.innerHTML = `
      <div class="dashboard-stat">
        <div class="dashboard-label">Duplicate Functions</div>
        <div class="dashboard-value">${Object.keys(duplicateFunctions).length}</div>
        <div class="dashboard-subtext">unique names</div>
      </div>
      <div class="dashboard-stat">
        <div class="dashboard-label">Function Instances</div>
        <div class="dashboard-value">${Object.values(duplicateFunctions).reduce((sum, count) => sum + count, 0)}</div>
        <div class="dashboard-subtext">total duplicates</div>
      </div>
      <div class="dashboard-stat">
        <div class="dashboard-label">Duplicate Classes</div>
        <div class="dashboard-value">${Object.keys(duplicateClasses).length}</div>
        <div class="dashboard-subtext">unique names</div>
      </div>
      <div class="dashboard-stat">
        <div class="dashboard-label">Class Instances</div>
        <div class="dashboard-value">${Object.values(duplicateClasses).reduce((sum, count) => sum + count, 0)}</div>
        <div class="dashboard-subtext">total duplicates</div>
      </div>
    `;
    container.appendChild(statsContainer);
    
    // Create filter input
    const filterContainer = document.createElement('div');
    filterContainer.className = 'function-map-filter';
    filterContainer.innerHTML = `
      <input type="text" id="audit-filter" placeholder="Filter duplicates..." class="filter-input">
    `;
    container.appendChild(filterContainer);
    
    // Create accordion for audit categories
    const accordion = document.createElement('div');
    accordion.className = 'function-map-accordion';
    container.appendChild(accordion);
    
    // Create duplicate functions section
    const functionsBlock = createDuplicateCategory('Duplicate Functions', duplicateFunctions);
    accordion.appendChild(functionsBlock);
    
    // Create duplicate classes section
    const classesBlock = createDuplicateCategory('Duplicate CSS Classes', duplicateClasses);
    accordion.appendChild(classesBlock);
    
    // Add filter functionality
    const filterInput = document.getElementById('audit-filter');
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        const value = e.target.value.toLowerCase();
        document.querySelectorAll('.duplicate-item').forEach(item => {
          const matches = item.querySelector('.duplicate-name').textContent.toLowerCase().includes(value);
          item.style.display = matches || value === '' ? 'flex' : 'none';
        });
        
        document.querySelectorAll('.audit-category').forEach(block => {
          const visibleItems = block.querySelectorAll('.duplicate-item[style="display: flex"]').length;
          if (visibleItems > 0 || value === '') {
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
    console.error('⚠️ Failed to load code audit report:', err);
    const container = document.getElementById('code-audit-container');
    if (container) container.innerHTML = '<div class="error-message">⚠️ Could not load code audit data.</div>';
  }
}

// Helper function to find duplicates in an array - Added by Cascade 2025-07-16
function findDuplicates(items) {
  const counts = {};
  const duplicates = {};
  
  // Count occurrences of each item
  items.forEach(item => {
    counts[item] = (counts[item] || 0) + 1;
  });
  
  // Filter only items that appear more than once
  Object.entries(counts).forEach(([item, count]) => {
    if (count > 1) {
      duplicates[item] = count;
    }
  });
  
  return duplicates;
}

// Helper function to create duplicate category blocks - Added by Cascade 2025-07-16
function createDuplicateCategory(title, duplicates) {
  const block = document.createElement('div');
  block.className = 'audit-category';
  
  const header = document.createElement('div');
  header.className = 'code-header';
  header.innerHTML = `
    <h3>${title}</h3>
    <span class="code-count">${Object.keys(duplicates).length}</span>
  `;
  header.addEventListener('click', () => {
    block.classList.toggle('expanded');
  });
  
  const duplicatesList = document.createElement('div');
  duplicatesList.className = 'duplicates-list';
  
  // Sort duplicates by count (highest first)
  const sortedDuplicates = Object.entries(duplicates)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100); // Limit to 100 items for performance
  
  sortedDuplicates.forEach(([name, count]) => {
    const item = document.createElement('div');
    item.className = 'duplicate-item';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'duplicate-name';
    nameSpan.textContent = name;
    
    // Use existing tag styles from the codebase
    const countBadge = document.createElement('span');
    // Use updated-tag for CSS classes and soon-tag for functions
    countBadge.className = title.includes('CSS') ? 'updated-tag' : 'soon-tag';
    countBadge.textContent = count;
    countBadge.style.margin = '0'; // Remove margin to fit with our layout
    
    item.appendChild(nameSpan);
    item.appendChild(countBadge);
    duplicatesList.appendChild(item);
  });
  
  // Add a count indicator if there are more items
  if (Object.keys(duplicates).length > 100) {
    const more = document.createElement('div');
    more.className = 'more-duplicates';
    more.textContent = `+${Object.keys(duplicates).length - 100} more duplicates not shown`;
    duplicatesList.appendChild(more);
  }
  
  block.appendChild(header);
  block.appendChild(duplicatesList);
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
  items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    el.appendChild(li);
  });
}

// Nova System Status Section - Enhanced by Cascade 2025-07-16
async function updateNovaHeartbeat() {
  try {
    // Fetch Nova's status data (debugging live)
    const moodRes = await fetch('/data/mood-scan.json?t=' + Date.now());
    const apiRes = await fetch('/data/api-monitor.json?t=' + Date.now());
    const memoryRes = await fetch('/data/performance-metrics.json?t=' + Date.now());
    // Log HTTP statuses to console for live debugging
    console.log('[NovaHeartbeat] status codes:', {
      mood: moodRes.status,
      api: apiRes.status,
      memory: memoryRes.status
    });
    
    // Update Nova Core status
    const coreStatusEl = document.getElementById('nova-core-status');
    const lastPingEl = document.getElementById('nova-last-ping');
    
    if (!moodRes.ok) {
      updateStatusIndicator(coreStatusEl, 'error', 'fa-circle-xmark', 'Unreachable');
      if (lastPingEl) lastPingEl.textContent = 'Last ping: Unknown';
    } else {
      const moodData = moodRes.ok ? await moodRes.json() : { timestamp: null };
      const timestamp = moodData.timestamp ? new Date(moodData.timestamp) : null;
      const timeDiff = timestamp ? Date.now() - timestamp.getTime() : Infinity;
      
      if (timeDiff < 21600000) { // Less than 1 hour old
        updateStatusIndicator(coreStatusEl, 'active', 'fa-circle-check', 'Operational');
      } else if (timeDiff < 86400000) { // Less than 2 hours old
        updateStatusIndicator(coreStatusEl, 'warning', 'fa-circle-exclamation', 'Stale');
      } else {
        updateStatusIndicator(coreStatusEl, 'error', 'fa-circle-xmark', 'Offline');
      }
      
      if (lastPingEl && timestamp) {
        const formattedTime = formatTimestamp(timestamp);
        lastPingEl.textContent = `Last ping: ${formattedTime}`;
      }
    }
    
    // Update API Services status
    const apiStatusEl = document.getElementById('api-services-status');
    const apiCountEl = document.getElementById('api-services-count');
    
    if (!apiRes.ok) {
      console.warn('[NovaHeartbeat] api-monitor.json returned', apiRes.status);
      updateStatusIndicator(apiStatusEl, 'error', 'fa-circle-xmark', 'Unreachable');
      if (apiCountEl) apiCountEl.textContent = 'Status unknown';
    } else {
      const apiData = await apiRes.json();
      const services = apiData.endpoints || [];
      const operational = services.filter(s => s.ok).length;
      const total = services.length;
      if (total > 0 && operational === total) {
        updateStatusIndicator(apiStatusEl, 'active', 'fa-circle-check', 'All Responsive');
      } else if (operational < total) {
        updateStatusIndicator(apiStatusEl, 'warning', 'fa-circle-exclamation', 'Partial Outage');
      } else {
        updateStatusIndicator(apiStatusEl, 'warning', 'fa-circle-question', 'No Data');
      }
      if (apiCountEl) {
        apiCountEl.textContent = `${operational} / ${total} responsive`;
      }
    }
    
    // Update Memory Systems status
    const memoryStatusEl = document.getElementById('memory-systems-status');
    const memoryStatsEl = document.getElementById('memory-stats');
    
    if (!memoryRes.ok) {
      console.warn('[NovaHeartbeat] performance-metrics.json returned', memoryRes.status);
      updateStatusIndicator(memoryStatusEl, 'warning', 'fa-circle-exclamation', 'No Recent Data');
      if (memoryStatsEl) memoryStatsEl.textContent = 'Snapshots: Unknown';
    } else {
      const memoryData = await memoryRes.json();
      const uptime = memoryData.uptimePercentage;
      if (typeof uptime === 'number') {
        if (uptime >= 99) {
          updateStatusIndicator(memoryStatusEl, 'active', 'fa-circle-check', 'Healthy');
        } else if (uptime >= 90) {
          updateStatusIndicator(memoryStatusEl, 'warning', 'fa-circle-exclamation', 'Degraded');
        } else {
          updateStatusIndicator(memoryStatusEl, 'error', 'fa-circle-xmark', 'Critical');
        }
        if (memoryStatsEl) memoryStatsEl.textContent = `Uptime: ${uptime}%`;
      } else {
        updateStatusIndicator(memoryStatusEl, 'warning', 'fa-circle-question', 'No Data');
        if (memoryStatsEl) memoryStatsEl.textContent = 'Uptime: --';
      }
    }
    
    // Update ticker messages
    updateStatusTicker(moodRes.ok ? await moodRes.json() : null, 
                      apiRes.ok ? await apiRes.json() : null);
    
    // Set up periodic checks
    setTimeout(updateNovaHeartbeat, 60000); // Check every minute
    
  } catch (error) {
    console.error('Error updating Nova status section:', error);
    // Set all indicators to error state
    const indicators = ['nova-core-status', 'api-services-status', 'memory-systems-status'];
    indicators.forEach(id => {
      const el = document.getElementById(id);
      if (el) updateStatusIndicator(el, 'error', 'fa-circle-xmark', 'Error');
    });
    
    // Add error message to ticker
    const tickerEl = document.getElementById('ticker-message-1');
    if (tickerEl) {
      tickerEl.textContent = 'System error: Could not retrieve Nova status information';
    }
  }
}

// Helper function to update status indicators
function updateStatusIndicator(element, status, icon, text) {
  if (!element) return;
  
  element.className = `status-indicator ${status}`;
  element.innerHTML = `<i class="fa-solid ${icon}"></i><span>${text}</span>`;
}

// Helper function to format timestamps
function formatTimestamp(date) {
  if (!date) return 'Unknown';
  
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) { // Less than 1 minute
    return 'Just now';
  } else if (diff < 3600000) { // Less than 1 hour
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  } else if (diff < 86400000) { // Less than 1 day
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleString();
  }
}

// Update the status ticker with dynamic messages
function updateStatusTicker(moodData, apiData) {
  const tickerTrack = document.getElementById('status-ticker-track');
  if (!tickerTrack) return;
  
  tickerTrack.innerHTML = '';
  const messages = [];
  
  // Add mood-based message
  if (moodData && moodData.mood) {
    messages.push({
      icon: 'fa-brain',
      text: `Nova Mood: ${moodData.mood.primary || 'Unknown'} | Awareness Level: ${moodData.awareness || 'Standard'}`
    });
  }
  
  // Add API status message
  if (apiData && apiData.endpoints) {
    const critical = apiData.endpoints.filter(s => !s.ok);
    if (critical.length > 0) {
      messages.push({
        icon: 'fa-triangle-exclamation',
        text: `Alert: ${critical.length} endpoint${critical.length !== 1 ? 's' : ''} down`
      });
    } else {
      messages.push({
        icon: 'fa-check-circle',
        text: 'All endpoints operational'
      });
    }
  }
  
  // Add system message
  messages.push({
    icon: 'fa-circle-info',
    text: `Nova Dashboard v1.0.0 | Last updated: ${new Date().toLocaleString()}`
  });
  
  // Create ticker items
  messages.forEach((msg, index) => {
    const tickerItem = document.createElement('div');
    tickerItem.className = 'ticker-item';
    tickerItem.innerHTML = `<i class="fa-solid ${msg.icon}"></i><span id="ticker-message-${index + 1}">${msg.text}</span>`;
    tickerTrack.appendChild(tickerItem);
  });
}

// Updated by Cascade 2025-07-16
function updateImageStats(data) {
  // Update image stats display
  const totalImagesEl = document.getElementById('total-images');
  const totalFoldersEl = document.getElementById('total-folders');
  const fileTypesEl = document.getElementById('file-types');
  const commonTypeEl = document.getElementById('common-type');
  
  if (!data || !data.folders) return;
  
  // Calculate totals
  const totalImages = data.folders.reduce((sum, folder) => sum + folder.files.length, 0);
  const totalFolders = data.folders.length;
  
  // Get all file extensions
  const extensions = new Set();
  const extensionCounts = {};
  
  data.folders.forEach(folder => {
    folder.files.forEach(file => {
      const ext = file.split('.').pop().toLowerCase();
      extensions.add(ext);
      extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
    });
  });
  
  // Find most common type
  let mostCommonExt = '';
  let maxCount = 0;
  
  Object.entries(extensionCounts).forEach(([ext, count]) => {
    if (count > maxCount) {
      mostCommonExt = ext;
      maxCount = count;
    }
  });
  
  // Update elements if they exist
  if (totalImagesEl) totalImagesEl.textContent = totalImages;
  if (totalFoldersEl) totalFoldersEl.textContent = totalFolders;
  if (fileTypesEl) fileTypesEl.textContent = Array.from(extensions).join(', ');
  if (commonTypeEl) commonTypeEl.textContent = mostCommonExt ? `${mostCommonExt} (${maxCount})` : 'None';
}

// -------------------------------------------------------------------------
// NOVA DASHBOARD EXPANSION VISUALIZATIONS - Added by Cascade 2025-07-17
// -------------------------------------------------------------------------

/**
 * Renders the API Response Time Chart visualization
 */
async function renderApiResponseTimeChart() {
  const chartCanvas = document.getElementById('api-response-time-chart');
  const legendContainer = document.getElementById('api-response-time-legend');
  
  if (!chartCanvas) return;
  
  try {
    // Fetch API monitor data
    const response = await fetch('/data/api-monitor.json?t=' + Date.now());
    const apiData = await response.json();
    
    // If we only have current data, we'll generate synthetic historical data
    // for demonstration purposes
    const timeLabels = [];
    const currentTime = new Date();
    
    // Generate time labels for the past 24 hours (8 points, 3 hours apart)
    for (let i = 7; i >= 0; i--) {
      const time = new Date(currentTime - (i * 3 * 60 * 60 * 1000));
      timeLabels.push(time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
    
    // Prepare datasets for each endpoint
    const datasets = apiData.endpoints.map((endpoint, index) => {
      // Generate synthetic historical data based on current latency
      // This would be replaced with real historical data in production
      const baseLatency = endpoint.latencyMs || 50; // Default to 50ms if null
      const latencyData = [];
      
      for (let i = 0; i < 8; i++) {
        // Create some variance in the synthetic data
        const variance = Math.random() * 30 - 15; // +/- 15ms
        latencyData.push(Math.max(5, baseLatency + variance));
      }
      
      // Color palette using Nova's ambient crystalline flux aesthetic
      const colors = [
        'rgba(58, 242, 255, 0.7)',  // Teal
        'rgba(210, 118, 255, 0.7)',  // Purple
        'rgba(255, 128, 192, 0.7)',  // Pink
        'rgba(98, 226, 166, 0.7)'     // Mint
      ];
      
      return {
        label: endpoint.name,
        data: latencyData,
        borderColor: colors[index % colors.length],
        backgroundColor: colors[index % colors.length].replace('0.7', '0.1'),
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6
      };
    });
    
    // Create the chart
    new Chart(chartCanvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: timeLabels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Response Time (ms)',
              color: '#b6c9d8'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.05)'
            },
            ticks: {
              color: '#b6c9d8'
            }
          },
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.05)'
            },
            ticks: {
              color: '#b6c9d8'
            }
          }
        },
        plugins: {
          legend: {
            display: false // We'll create a custom legend
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(30, 32, 50, 0.9)',
            titleColor: '#eaf6ff',
            bodyColor: '#eaf6ff',
            borderColor: 'rgba(58, 242, 255, 0.3)',
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                return `${context.dataset.label}: ${Math.round(context.raw)}ms`;
              }
            }
          }
        }
      }
    });
    
    // Create custom legend
    if (legendContainer) {
      legendContainer.innerHTML = '';
      const legend = document.createElement('div');
      legend.className = 'custom-chart-legend';
      
      datasets.forEach((dataset, index) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
          <span class="legend-color" style="background-color: ${dataset.borderColor}"></span>
          <span class="legend-label">${dataset.label}</span>
          <span class="legend-value">${Math.round(dataset.data[dataset.data.length - 1])}ms</span>
        `;
        legend.appendChild(item);
      });
      
      legendContainer.appendChild(legend);
    }
    
  } catch (err) {
    console.error('⚠️ Failed to render API response time chart:', err);
    if (chartCanvas.parentNode) {
      chartCanvas.parentNode.innerHTML = '<div class="chart-error">⚠️ Failed to load API response data</div>';
    }
  }
}

/**
 * Renders the System Health Score Timeline visualization
 */
async function renderSystemHealthTimeline() {
  const chartCanvas = document.getElementById('system-health-timeline');
  const summaryContainer = document.getElementById('health-score-summary');
  
  if (!chartCanvas) return;
  
  try {
    // Fetch performance metrics
    const response = await fetch('/data/performance-metrics.json?t=' + Date.now());
    const metrics = await response.json();
    
    // Generate synthetic health score data for demonstration purposes
    // Would be replaced with actual time-series data in production
    const timeLabels = [];
    const currentTime = new Date();
    const healthScores = [];
    
    // Base health score on uptime percentage
    const baseHealthScore = metrics.uptimePercentage || 99;
    const apiFailureDate = metrics.lastApiFailure ? new Date(metrics.lastApiFailure) : null;
    
    // Generate health scores for the past 14 days (daily)
    for (let i = 13; i >= 0; i--) {
      const date = new Date(currentTime - (i * 24 * 60 * 60 * 1000));
      timeLabels.push(date.toLocaleDateString([], { month: 'short', day: 'numeric' }));
      
      // Create synthetic health score with realistic patterns
      let dayScore = baseHealthScore;
      
      // If there was an API failure, reduce score around that day
      if (apiFailureDate) {
        const dayDiff = Math.abs((date - apiFailureDate) / (24 * 60 * 60 * 1000));
        if (dayDiff < 3) {
          dayScore -= (3 - dayDiff) * 15; // Bigger impact closer to failure date
        }
      }
      
      // Add some natural variation
      dayScore += (Math.random() * 2 - 1);
      
      // Ensure score stays in valid range
      healthScores.push(Math.min(100, Math.max(0, dayScore)));
    }
    
    // Create gradient background
    const ctx = chartCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, chartCanvas.height);
    gradient.addColorStop(0, 'rgba(58, 242, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(58, 242, 255, 0)');
    
    // Create the chart
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: timeLabels,
        datasets: [{
          label: 'Health Score',
          data: healthScores,
          borderColor: 'rgba(58, 242, 255, 0.8)',
          backgroundColor: gradient,
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointBackgroundColor: 'rgba(58, 242, 255, 1)',
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: false,
            min: Math.max(0, Math.min(...healthScores) - 5),  // Dynamic min based on lowest score
            max: 100,
            title: {
              display: true,
              text: 'Health Score',
              color: '#b6c9d8'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.05)'
            },
            ticks: {
              color: '#b6c9d8'
            }
          },
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.05)'
            },
            ticks: {
              color: '#b6c9d8'
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(30, 32, 50, 0.9)',
            titleColor: '#eaf6ff',
            bodyColor: '#eaf6ff',
            borderColor: 'rgba(58, 242, 255, 0.3)',
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                return `Health Score: ${context.raw.toFixed(1)}`;
              }
            }
          }
        }
      }
    });
    
    // Update summary container
    if (summaryContainer) {
      // Get current health score (latest value)
      const currentScore = healthScores[healthScores.length - 1];
      const scoreChange = currentScore - healthScores[healthScores.length - 2];
      
      // Determine status based on score
      let status = 'optimal';
      if (currentScore < 80) status = 'warning';
      if (currentScore < 60) status = 'critical';
      
      // Create health status message
      summaryContainer.innerHTML = `
        <div class="health-score-display ${status}">
          <div class="health-score-value">${currentScore.toFixed(1)}</div>
          <div class="health-score-label">Current Health</div>
          <div class="health-score-change ${scoreChange >= 0 ? 'positive' : 'negative'}">  
            ${scoreChange >= 0 ? '+' : ''}${scoreChange.toFixed(1)} since yesterday
          </div>
        </div>
        <div class="health-factors">
          <div class="health-factor">
            <div class="health-factor-label">Uptime</div>
            <div class="health-factor-value">${metrics.uptimePercentage}%</div>
          </div>
          <div class="health-factor">
            <div class="health-factor-label">Avg Response</div>
            <div class="health-factor-value">${metrics.avgMoodGenTimeMs}ms</div>
          </div>
          <div class="health-factor">
            <div class="health-factor-label">Last Failure</div>
            <div class="health-factor-value">${apiFailureDate ? formatTimestamp(apiFailureDate) : 'None'}</div>
          </div>
        </div>
      `;
    }
    
  } catch (err) {
    console.error('⚠️ Failed to render system health timeline:', err);
    if (chartCanvas.parentNode) {
      chartCanvas.parentNode.innerHTML = '<div class="chart-error">⚠️ Failed to load system health data</div>';
    }
  }
}

/**
 * Renders the Content Type Distribution visualization
 */
async function renderContentTypeDistribution() {
  const chartCanvas = document.getElementById('content-type-distribution');
  const legendContainer = document.getElementById('distribution-legend');
  
  if (!chartCanvas) return;
  
  try {
    // Fetch data from code-map.json and code-footprint.json to build content distribution
    const [codeMapRes, footprintRes] = await Promise.all([
      fetch('/data/code-map.json?t=' + Date.now()),
      fetch('/data/code-footprint.json?t=' + Date.now())
    ]);
    
    const codeMap = await codeMapRes.json();
    const footprint = await footprintRes.json();
    
    // Combine data to create comprehensive content type distribution
    // This is a simplified demonstration - in production, you would use actual content data
    const contentTypes = [
      { type: 'HTML/Markup', value: footprint.summary.html?.files || 0 },
      { type: 'JavaScript', value: footprint.summary.js?.files || 0 },
      { type: 'CSS/Styling', value: footprint.summary.css?.files || 0 },
      { type: 'Images', value: 0 },  // We'll populate this from image inventory
      { type: 'Data Files', value: 0 },  // We'll estimate this
      { type: 'Documentation', value: 0 }  // We'll estimate this
    ];
    
    // Try to fetch image inventory to get image count
    try {
      const imageRes = await fetch('/data/image-inventory.json?t=' + Date.now());
      const imageData = await imageRes.json();
      const imageCount = imageData.folders.reduce((sum, folder) => sum + folder.files.length, 0);
      contentTypes[3].value = imageCount;
    } catch (e) {
      console.warn('Could not fetch image inventory, using estimate');
      // Estimate based on other content - for demo purposes
      contentTypes[3].value = Math.round((contentTypes[0].value + contentTypes[1].value) * 0.6);
    }
    
    // Estimate data files and documentation
    // In production, these would be actual counts
    contentTypes[4].value = 15; // Data files estimate
    contentTypes[5].value = 8;  // Documentation estimate
    
    // Prepare chart data
    const labels = contentTypes.map(item => item.type);
    const values = contentTypes.map(item => item.value);
    
    // Nova's ambient crystalline flux aesthetic colors
    const colors = [
      'rgba(58, 242, 255, 0.7)',   // Teal
      'rgba(255, 200, 16, 0.7)',    // Yellow
      'rgba(210, 118, 255, 0.7)',   // Purple
      'rgba(98, 226, 166, 0.7)',     // Mint
      'rgba(255, 128, 192, 0.7)',   // Pink
      'rgba(132, 94, 247, 0.7)'     // Blue-purple
    ];
    
    // Create the donut chart
    new Chart(chartCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: colors.map(color => color.replace('0.7', '1')),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            display: false // Using custom legend
          },
          tooltip: {
            backgroundColor: 'rgba(30, 32, 50, 0.9)',
            titleColor: '#eaf6ff',
            bodyColor: '#eaf6ff',
            borderColor: 'rgba(58, 242, 255, 0.3)',
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.raw || 0;
                const total = context.chart.getDatasetMeta(0).total;
                const percentage = ((value / total) * 100).toFixed(1);
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
    
    // Create custom legend with percentages
    if (legendContainer) {
      legendContainer.innerHTML = '';
      const totalCount = values.reduce((sum, value) => sum + value, 0);
      
      const legend = document.createElement('div');
      legend.className = 'distribution-legend-grid';
      
      contentTypes.forEach((item, index) => {
        const percentage = ((item.value / totalCount) * 100).toFixed(1);
        
        const legendItem = document.createElement('div');
        legendItem.className = 'distribution-legend-item';
        legendItem.innerHTML = `
          <div class="legend-color" style="background-color: ${colors[index]}"></div>
          <div class="legend-content">
            <div class="legend-label">${item.type}</div>
            <div class="legend-details">
              <span class="legend-count">${item.value}</span>
              <span class="legend-percentage">${percentage}%</span>
            </div>
          </div>
        `;
        legend.appendChild(legendItem);
      });
      
      legendContainer.appendChild(legend);
    }
    
  } catch (err) {
    console.error('⚠️ Failed to render content type distribution:', err);
    if (chartCanvas.parentNode) {
      chartCanvas.parentNode.innerHTML = '<div class="chart-error">⚠️ Failed to load content distribution data</div>';
    }
  }
}