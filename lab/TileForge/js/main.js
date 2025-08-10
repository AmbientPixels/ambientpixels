// TileForge Main Initialization Module
// Coordinates all modules and handles application startup

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Load default data first
  loadDefaultData();
  
  // Setup all functionality
  setupFileInputs();
  setupDragAndDrop();
  setupLiveEditor();
  initializeFilters();
  
  console.log('TileForge initialized successfully with modular architecture');
});

// Simple Filter Functions
function initializeFilters() {
  // Populate locale filter when data is available
  if (currentCsvData && currentCsvData.length > 0) {
    populateLocaleFilter();
  }
  
  // Set up a listener for when data changes
  const originalRenderLocaleGroups = window.renderLocaleGroups;
  window.renderLocaleGroups = function(csvData) {
    originalRenderLocaleGroups(csvData);
    populateLocaleFilter();
  };
}

function populateLocaleFilter() {
  const localeFilter = document.getElementById('localeFilter');
  if (!localeFilter || !currentCsvData) return;
  
  // Get unique locales
  const locales = [...new Set(currentCsvData.map(row => row.Locale || row.locale))].sort();
  
  // Clear existing options except "All Locales"
  localeFilter.innerHTML = '<option value="all">All Locales</option>';
  
  // Add locale options
  locales.forEach(locale => {
    const option = document.createElement('option');
    option.value = locale;
    option.textContent = `${locale} - ${LOCALE_NAMES[locale] || locale}`;
    localeFilter.appendChild(option);
  });
}

function applyFilters() {
  const statusFilter = document.getElementById('statusFilter').value;
  const localeFilter = document.getElementById('localeFilter').value;
  
  let visibleCount = 0;
  let totalCount = 0;
  
  // Get all locale sections
  const localeSections = document.querySelectorAll('.locale-section');
  
  localeSections.forEach(section => {
    const localeHeader = section.querySelector('.locale-header');
    if (!localeHeader) return;
    
    const locale = localeHeader.textContent.split(' ')[0];
    const tiles = section.querySelectorAll('.tile-container');
    
    // Check if this locale should be visible
    const localeVisible = localeFilter === 'all' || locale === localeFilter;
    
    if (!localeVisible) {
      section.style.display = 'none';
      return;
    }
    
    let sectionHasVisibleTiles = false;
    
    tiles.forEach(tileContainer => {
      totalCount++;
      const tile = tileContainer.querySelector('.tile-preview');
      
      if (tile) {
        const tileStatus = getTileStatus(tile);
        const statusVisible = statusFilter === 'all' || 
                             (statusFilter === 'clean' && tileStatus === 'clean') ||
                             (statusFilter === 'issues' && tileStatus === 'issues');
        
        if (statusVisible) {
          tileContainer.style.display = 'block';
          visibleCount++;
          sectionHasVisibleTiles = true;
        } else {
          tileContainer.style.display = 'none';
        }
      }
    });
    
    // Show/hide the entire section
    section.style.display = sectionHasVisibleTiles ? 'block' : 'none';
  });
  
  updateFilterStatus(visibleCount, totalCount, statusFilter, localeFilter);
}

function getTileStatus(tile) {
  const titleEl = tile.querySelector('.tile-title');
  const subtitleEl = tile.querySelector('.tile-subtitle');
  
  if (!titleEl) return 'clean';
  
  const title = titleEl.textContent || '';
  const subtitle = subtitleEl ? subtitleEl.textContent || '' : '';
  
  // Simple status check - if text is too long, it's an issue
  if (title.length > 40 || subtitle.length > 40) {
    return 'issues';
  }
  
  return 'clean';
}

function updateFilterStatus(visibleCount, totalCount, statusFilter, localeFilter) {
  const statusEl = document.getElementById('filterStatus');
  if (!statusEl) return;
  
  let statusText = `Showing ${visibleCount} of ${totalCount} tiles`;
  
  if (statusFilter !== 'all' || localeFilter !== 'all') {
    const filters = [];
    if (statusFilter !== 'all') filters.push(statusFilter);
    if (localeFilter !== 'all') filters.push(localeFilter);
    statusText += ` (filtered by: ${filters.join(', ')})`;
  }
  
  statusEl.textContent = statusText;
}

function resetFilters() {
  document.getElementById('statusFilter').value = 'all';
  document.getElementById('localeFilter').value = 'all';
  applyFilters();
}
