// TileForge Main Initialization Module
// Coordinates all modules and handles application startup

// --- Global Meta & Shared Renderers (About/Version) --- /* updated by Cascade */
// Single source of truth for version/build info
window.TileForgeMeta = window.TileForgeMeta || {
  version: '2.4.0',
  buildDate: 'August 2025',
  architecture: 'Modular CSS/JS with Canvas API integration',
  latest: 'New Projects module, locale pills/badges, GridPeek viewer, smarter export states'
};

// Shared HTML renderer for the Version card
window.renderVersionCard = function renderVersionCard(opts = {}) {
  const { headingLevel = 'h5', wrapperClass = 'version-info' } = opts;
  const { version, buildDate, architecture, latest } = window.TileForgeMeta || {};
  const safeHeading = (headingLevel === 'h4' || headingLevel === 'h5') ? headingLevel : 'h5';
  return `
    <div class="${wrapperClass}">
      <${safeHeading}>📦 Version Information</${safeHeading}>
      <p><strong>Version:</strong> ${version}</p>
      <p><strong>Build Date:</strong> ${buildDate}</p>
      <p><strong>Architecture:</strong> ${architecture}</p>
      <p><strong>Latest:</strong> ${latest}</p>
    </div>
  `;
};

// --- Locale Modal <-> Preview Synchronization State ---
// Track which locales are currently active in the preview (default: all loaded locales)
let activeLocalesForPreview = [];

function getActiveLocalesForPreview() {
  // If not set, default to all locales in currentCsvData
  if (!activeLocalesForPreview || activeLocalesForPreview.length === 0) {
    if (window.currentCsvData && Array.isArray(window.currentCsvData)) {
      // Normalize legacy code to prevent preselect mismatch
      activeLocalesForPreview = [...new Set(window.currentCsvData.map(row => {
        let loc = row.Locale || row.locale;
        return /^invariant$/i.test(String(loc)) ? 'INVARIANTCULTURE' : loc;
      }))].sort();
    }
  }
  return activeLocalesForPreview;
}

function setActiveLocalesForPreview(locales) {
  // Normalize incoming values and de-dup
  const arr = Array.isArray(locales) ? [...locales] : [];
  const norm = arr.map(l => /^invariant$/i.test(String(l)) ? 'INVARIANTCULTURE' : l);
  activeLocalesForPreview = [...new Set(norm)];
}

function filterPreviewByActiveLocales() {
  const localeSections = document.querySelectorAll('.locale-section');
  const activeSet = new Set(getActiveLocalesForPreview());
  localeSections.forEach(section => {
    const header = section.querySelector('.locale-header');
    if (!header) return;
    // Locale code is in the badge span
    const badge = header.querySelector('.country-badge');
    const locale = badge ? badge.textContent.trim() : (header.getAttribute('data-locale') || header.textContent.split(' ')[0]).trim();
    if (activeSet.has(locale)) {
      section.style.display = '';
    } else {
      section.style.display = 'none';
    }
  });
}

// Manage Locales flow (centralized)
function openManageLocales() {
  if (!window.TileForgeLocalesUI || typeof window.TileForgeLocalesUI.open !== 'function') {
    if (window.Modal && typeof Modal.alert === 'function') { Modal.alert('Locale Picker UI not loaded.', 'warning'); } else { alert('Locale Picker UI not loaded.'); }
    return;
  }
  const pre = getActiveLocalesForPreview();
  window.TileForgeLocalesUI.open(function(selectedLocales) {
    setActiveLocalesForPreview(selectedLocales || []);
    // Merge selection with current data (preserve rows for selected locales, create blanks when missing)
    let mergedRows = [];
    if (Array.isArray(selectedLocales) && selectedLocales.length > 0) {
      const csvRows = (window.currentCsvData && Array.isArray(window.currentCsvData)) ? window.currentCsvData : [];
      selectedLocales.forEach(locale => {
        // Ensure comparison uses normalized code
        const normSel = /^invariant$/i.test(String(locale)) ? 'INVARIANTCULTURE' : locale;
        const match = csvRows.find(row => {
          const loc = row.Locale || row.locale;
          const normRow = /^invariant$/i.test(String(loc)) ? 'INVARIANTCULTURE' : loc;
          return normRow === normSel;
        });
        if (match) {
          mergedRows.push(match);
        } else {
          mergedRows.push({ Locale: normSel, 'items/0/title': '', 'items/0/subtitle': '', 'items/0/narratorText': '' });
        }
      });
    }
    window.currentCsvData = mergedRows;
    renderLocaleGroups(mergedRows);
    // Notify listeners that active locales and data order changed (for validation)
    try { document.dispatchEvent(new CustomEvent('tf:localesChanged', { detail: { locales: getActiveLocalesForPreview() } })); } catch (_) {}
  }, pre);
}

// Enable/disable Manage Locales buttons depending on data presence
function updateManageLocalesState(hasData) {
  try {
    const ids = [
      'toolbarManageLocalesBtn',
      // inline clear buttons in live editor
      'titleClearBtn',
      'subtitleClearBtn',
      'narratorClearBtn'
    ];
    ids.forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      if (hasData) {
        btn.removeAttribute('disabled');
        btn.classList.remove('disabled');
        // Preserve existing specific titles, but correct the generic Manage Locales hint when present
        if (id === 'toolbarManageLocalesBtn') {
          btn.title = btn.title && btn.title.includes('Load') ? 'Manage Locales' : (btn.title || 'Manage Locales');
        }
      } else {
        btn.setAttribute('disabled', 'disabled');
        btn.classList.add('disabled');
        if (id === 'toolbarManageLocalesBtn') {
          btn.title = 'Load CSV data to manage locales';
        }
      }
    });
  } catch (e) { /* no-op */ }
}

// Enable/disable all Live Editor "Apply" buttons depending on data presence
function updateApplyButtonsState(hasData) {
  try {
    const ids = [
      // Global apply all
      'applyToAllBtn',
      // Manual apply all per field
      'titleManualApplyBtn',
      'subtitleManualApplyBtn',
      'narratorManualApplyBtn',
      // Apply to selected (opens locale picker)
      'titleManualApplySelectedBtn',
      'subtitleManualApplySelectedBtn',
      'narratorManualApplySelectedBtn'
    ];
    ids.forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      if (hasData) {
        btn.removeAttribute('disabled');
        btn.classList.remove('disabled');
        // Preserve any existing titles
        if (!btn.title) btn.title = 'Apply';
      } else {
        btn.setAttribute('disabled', 'disabled');
        btn.classList.add('disabled');
        btn.title = 'Load CSV data to enable apply actions';
      }
    });
  } catch (e) { /* no-op */ }
}

// Expose globally
window.openManageLocales = openManageLocales;
window.updateManageLocalesState = updateManageLocalesState;
window.updateApplyButtonsState = updateApplyButtonsState;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Check if intro should be shown
  initializeIntroSection();
  
  // Default: do NOT autoload any dataset on refresh. Keep a clean page.
  // Opt-in autoload only if:
  //  - URL has ?autoload=1, or
  //  - localStorage 'tileforge-autoload' === 'true'
  // This avoids loading preloaded or last-saved templates automatically. /* updated by Cascade */
  try {
    const params = new URLSearchParams(window.location.search || '');
    const urlWantsAutoload = params.get('autoload') === '1';
    const lsWantsAutoload = localStorage.getItem('tileforge-autoload') === 'true';
    const wantsAutoload = (urlWantsAutoload || lsWantsAutoload);
    if (wantsAutoload && typeof loadDefaultData === 'function') {
      console.info('[TF-Startup] Autoload override active (url=%s, ls=%s) → loading default dataset', urlWantsAutoload, lsWantsAutoload); /* debug: remove after verification */
      loadDefaultData();
    } else {
      // If user opted to load last saved data and we have a cached CSV, restore it; otherwise show empty state
      const shouldLoadLast = !!(window.currentSettings && window.currentSettings.loadLastSavedOnStartup);
      let loadedLast = false;
      if (shouldLoadLast && typeof processCsvData === 'function') {
        try {
          const lastCsv = localStorage.getItem('tileforge-last-csv');
          const lastName = localStorage.getItem('tileforge-last-csv-name') || 'session.csv';
          if (lastCsv && lastCsv.trim().length > 0) {
            console.info('[TF-Startup] Loading last saved CSV from localStorage (%s, %d chars)', lastName, lastCsv.length); /* debug: remove after verification */
            processCsvData(lastCsv, lastName);
            loadedLast = true;
          }
        } catch (_) { /* fall through to empty state */ }
      }
      if (!loadedLast) {
        // Explicitly render clean empty state so the area is visible on load /* updated by Cascade */
        console.info('[TF-Startup] No autoload and no last saved CSV (or disabled) → rendering empty state (shouldLoadLast=%s)', String(shouldLoadLast)); /* debug: remove after verification */
        try { window.currentCsvData = []; } catch (e) { /* no-op */ }
        if (typeof renderLocaleGroups === 'function') renderLocaleGroups([]);
        try { if (typeof updateLocalizedExportState === 'function') updateLocalizedExportState(false); } catch (e) {}
        try { if (typeof window.updateManageLocalesState === 'function') window.updateManageLocalesState(false); } catch (e) {}
        try { if (typeof window.updateApplyButtonsState === 'function') window.updateApplyButtonsState(false); } catch (e) {}
        try { if (typeof window.updateLiveEditorEnabled === 'function') window.updateLiveEditorEnabled(false); } catch (e) {}
      }
    }
  } catch (_) { /* no-op */ }
  
  // Setup all functionality
  setupFileInputs();
  setupDragAndDrop();
  setupLiveEditor();
  initializeFilters();

  // Clickable analytics cards -> set status filter and scroll to tiles section
  const overflowCard = document.getElementById('overflowCard');
  const nearLimitCard = document.getElementById('nearLimitCard');
  const cleanCard = document.getElementById('cleanCard');
  const localeGroupsEl = document.getElementById('localeGroupsContainer');

  function setStatusFilterAndScroll(status) {
    const sel = document.getElementById('statusFilter');
    if (sel) {
      sel.value = status;
      applyFilters();
    }
    if (localeGroupsEl) {
      localeGroupsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Optional: update URL hash for anchoring
    // location.hash = '#localeGroupsContainer';
  }

  if (overflowCard) overflowCard.addEventListener('click', () => setStatusFilterAndScroll('overflow'));
  if (nearLimitCard) nearLimitCard.addEventListener('click', () => setStatusFilterAndScroll('near-limit'));
  if (cleanCard) cleanCard.addEventListener('click', () => setStatusFilterAndScroll('clean'));
  
  // Attach Manage Locales (toolbar) button event
  const toolbarManageLocalesBtn = document.getElementById('toolbarManageLocalesBtn');
  if (toolbarManageLocalesBtn) {
    toolbarManageLocalesBtn.addEventListener('click', function() { if (typeof window.openManageLocales === 'function') window.openManageLocales(); });
  }
  // Back to Top button under Status color codes
  const backToTopBtn = document.getElementById('backToTopBtn');
  if (backToTopBtn) {
    backToTopBtn.addEventListener('click', function() {
      // Determine the actual scroll container. Body is non-scrollable (overflow: hidden),
      // and panels (e.g., .right-panel) handle their own scrolling. /* updated by Cascade */
      const scrollHost = document.querySelector('.right-panel') || document.scrollingElement || document.documentElement;
      try {
        if (typeof scrollHost.scrollTo === 'function') {
          scrollHost.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          scrollHost.scrollTop = 0;
        }
      } catch (e) {
        // Safe fallback
        scrollHost.scrollTop = 0;
      }
    });
  }

  // Floating Back to Top (auto-sticky) for scrollable preview panel /* added by Cascade */
  (function setupFloatingBackToTop() {
    const scrollHost = document.querySelector('.right-panel');
    if (!scrollHost) return; // respect layout; only attach when panel exists

    // Avoid duplicates
    let fab = document.querySelector('.tileforge-back-to-top-fab');
    if (!fab) {
      fab = document.createElement('button');
      fab.className = 'toolbar-btn tileforge-back-to-top-fab';
      fab.type = 'button';
      fab.title = 'Back to Top';
      fab.setAttribute('aria-label', 'Back to Top');
      // Minimal icon without assuming external icon packs
      const icon = document.createElement('span');
      icon.textContent = '↑';
      icon.setAttribute('aria-hidden', 'true');
      fab.appendChild(icon);
      document.body.appendChild(fab);

      // Reuse the same scrolling logic
      fab.addEventListener('click', function() {
        try {
          if (typeof scrollHost.scrollTo === 'function') {
            scrollHost.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            scrollHost.scrollTop = 0;
          }
        } catch (e) {
          scrollHost.scrollTop = 0;
        }
      });
    }

    // Toggle visibility based on scroll
    const toggleFab = () => {
      const shouldShow = (scrollHost.scrollTop || 0) > 120; // threshold
      if (fab) {
        fab.style.display = shouldShow ? 'inline-flex' : 'none';
      }
    };
    toggleFab();
    scrollHost.addEventListener('scroll', toggleFab, { passive: true });
  })();
  // Initialize button state based on current data
  try { window.updateManageLocalesState(!!(window.currentCsvData && window.currentCsvData.length)); } catch (e) { /* no-op */ }
  try { window.updateApplyButtonsState(!!(window.currentCsvData && window.currentCsvData.length)); } catch (e) { /* no-op */ }
  try { window.updateLiveEditorEnabled(!!(window.currentCsvData && window.currentCsvData.length)); } catch (e) { /* no-op */ }

  // Initialize template system
  if (typeof window.templateSystem !== 'undefined') {
    window.templateSystem.initialize();
  }
  
  console.log('TileForge initialized successfully with modular architecture');
});

// Open Transform Modal manually
function openTransformModal() {
  if (typeof window.transformModal !== 'undefined') {
    console.log('🔁 Opening transform modal manually');
    window.transformModal.show((transformedCsvText, stats) => {
      console.log('✅ Manual transformation complete:', stats);
      // Process the transformed CSV data
      processCsvData(transformedCsvText, 'Transformed Data', stats.totalRows);
    });
  } else {
    console.error('Transform modal not available');
    if (window.Modal && typeof Modal.alert === 'function') {
      Modal.alert('Transform modal is not loaded. Please refresh the page and try again.', 'error');
    } else {
      alert('Transform modal is not loaded. Please refresh the page and try again.');
    }
  }
}

// Persistently hide intro and update UI labels (used by right-side card action)
function dontShowIntro() {
  try {
    localStorage.setItem('tileforge-show-intro', 'false');
  } catch (_) { /* no-op */ }
  // Update any existing secondary toggle button label if present
  try {
    const btn = document.querySelector('.intro-section .intro-btn.secondary');
    if (btn) {
      btn.textContent = 'Show on startup';
      btn.title = 'Intro will be hidden on next visit';
    }
  } catch (_) { /* no-op */ }
  // Hide immediately
  hideIntro();
}

// Intro Section Management
function initializeIntroSection() {
  const showIntroOnStartup = localStorage.getItem('tileforge-show-intro');
  const introSection = document.getElementById('introSection');
  
  // Show intro by default for new users, or if preference is set to show
  if (showIntroOnStartup === null || showIntroOnStartup === 'true') {
    showIntro();
  } else {
    hideIntro();
  }
}

function showIntro() {
  const introSection = document.getElementById('introSection');
  if (introSection) {
    introSection.classList.remove('hidden');
  }
}

function hideIntro() {
  const introSection = document.getElementById('introSection');
  if (introSection) {
    introSection.classList.add('hidden');
  }
}

function toggleIntroVisibility(evt) {
  const currentSetting = localStorage.getItem('tileforge-show-intro');
  const newSetting = currentSetting === 'false' ? 'true' : 'false';

  localStorage.setItem('tileforge-show-intro', newSetting);

  // Update button text to reflect current state (do not rely on implicit global event)
  let button = (evt && evt.target) ? evt.target : null;
  if (!button) {
    try { button = document.querySelector('.intro-section .intro-btn.secondary'); } catch (_) { /* no-op */ }
  }
  if (button) {
    if (newSetting === 'true') {
      button.textContent = 'Hide on startup';
      button.title = 'Intro will show on next visit';
    } else {
      button.textContent = 'Show on startup';
      button.title = 'Intro will be hidden on next visit';
    }
  }
}

// Headliner Crafter Integration
function openHeadlinerCrafter() {
  console.log('🎯 Opening Headliner Crafter...');
  
  try {
    // Check if mapping modal is available
    if (!window.mappingModal) {
      console.error('❌ Mapping modal not available');
      if (window.Modal && typeof Modal.alert === 'function') {
        Modal.alert('Headliner Crafter is not properly initialized. Please refresh the page.', 'error');
      } else {
        alert('Headliner Crafter is not properly initialized. Please refresh the page.');
      }
      return;
    }
    
    // Show the mapping modal with upload interface (no pre-loaded data)
    window.mappingModal.show(null, (transformedData, stats) => {
      console.log('✅ Headliner Crafter transformation complete:', stats);
      
      // Process the transformed data through TileForge's normal pipeline
      if (transformedData && transformedData.length > 0) {
        // Convert to TileForge CSV format
        const csvText = window.headlinerCrafter.exportToCardForgeCSV(transformedData);
        
        // Process as if it was uploaded CSV
        processCsvData(csvText, 'Headliner Crafter Output', transformedData.length);
        
        // Show success message
        if (window.Modal && typeof Modal.alert === 'function') {
          Modal.alert(`Successfully processed ${transformedData.length} locales through Headliner Crafter!`, 'success');
        } else {
          alert(`Successfully processed ${transformedData.length} locales through Headliner Crafter!`);
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error in openHeadlinerCrafter:', error);
    if (window.Modal && typeof Modal.alert === 'function') {
      Modal.alert('Error opening Headliner Crafter: ' + error.message, 'error');
    } else {
      alert('Error opening Headliner Crafter: ' + error.message);
    }
  }
}

// Make sure function is globally accessible
window.openHeadlinerCrafter = openHeadlinerCrafter;

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
    // Ensure Manage Locales button state follows actual rendered data
    try { window.updateManageLocalesState(!!(csvData && csvData.length)); } catch (e) { /* no-op */ }
    try { window.updateApplyButtonsState(!!(csvData && csvData.length)); } catch (e) { /* no-op */ }
    try { window.updateLiveEditorEnabled(!!(csvData && csvData.length)); } catch (e) { /* no-op */ }
  };
}

function populateLocaleFilter() {
  const localeFilter = document.getElementById('localeFilter');
  const languageFilter = document.getElementById('languageFilter');
  const regionFilter = document.getElementById('regionFilter');
  
  // Use all locales from the master locale mapping
  const allLocales = window.TileForgeLocales && typeof window.TileForgeLocales.getAllLocales === 'function'
    ? window.TileForgeLocales.getAllLocales()
    : [];

  if (localeFilter) {
    localeFilter.innerHTML = '<option value="all">All Locales</option>';
    allLocales.forEach(locale => {
      const info = window.TileForgeLocales.getLocaleInfo(locale);
      const option = document.createElement('option');
      option.value = locale;
      option.textContent = `${locale} - ${(info && info.language ? info.language : '')} ${(info && info.country ? '(' + info.country + ')' : '')}`.trim();
      localeFilter.appendChild(option);
    });
  }

  // Populate language filter
  if (languageFilter) {
    const languageSet = new Set();
    allLocales.forEach(locale => {
      const info = window.TileForgeLocales.getLocaleInfo(locale);
      if (info && info.language) languageSet.add(info.language);
    });
    const languages = Array.from(languageSet).sort();
    languageFilter.innerHTML = '<option value="all">All Languages</option>';
    languages.forEach(lang => {
      const option = document.createElement('option');
      option.value = lang;
      option.textContent = lang;
      languageFilter.appendChild(option);
    });
  }

  // Populate region filter
  if (regionFilter) {
    const regionSet = new Set();
    allLocales.forEach(locale => {
      const info = window.TileForgeLocales.getLocaleInfo(locale);
      if (info && info.country) regionSet.add(info.country);
    });
    const regions = Array.from(regionSet).sort();
    regionFilter.innerHTML = '<option value="all">All Regions</option>';
    regions.forEach(region => {
      const option = document.createElement('option');
      option.value = region;
      option.textContent = region;
      regionFilter.appendChild(option);
    });
  }
}

function applyFilters() {
  const statusFilter = document.getElementById('statusFilter').value;
  const languageFilter = document.getElementById('languageFilter').value;
  const regionFilter = document.getElementById('regionFilter').value;
  const localeFilter = document.getElementById('localeFilter').value;
  
  let visibleCount = 0;
  let totalCount = 0;
  
  // Only operate on locale sections that are actually rendered in the live preview area.
  const localeSections = document.querySelectorAll('.locale-section');
  const activeLocales = new Set(getActiveLocalesForPreview());

  localeSections.forEach(section => {
    const localeHeader = section.querySelector('.locale-header');
    if (!localeHeader) return;

    // Extract locale consistently with filterPreviewByActiveLocales
    const badge = localeHeader.querySelector('.country-badge');
    const headerText = localeHeader.textContent || '';
    const locale = badge ? badge.textContent.trim() : (localeHeader.getAttribute('data-locale') || headerText.split(' ')[0]).trim();
    if (!locale) {
      section.style.display = 'none';
      return;
    }

    if (!activeLocales.has(locale)) {
      // Hide any section not in the active/previewed locales
      section.style.display = 'none';
      return;
    }

    // Use mapping for language/region info
    const info = window.TileForgeLocales && window.TileForgeLocales.getLocaleInfo ? window.TileForgeLocales.getLocaleInfo(locale) : {};
    const language = info.language || getLanguageFromLocale(locale);
    const region = info.country || getRegionFromLocale(locale);
    const tiles = section.querySelectorAll('.tile-container');

    // Check if this locale should be visible based on all filters
    const localeVisible = localeFilter === 'all' || locale === localeFilter;
    const languageVisible = languageFilter === 'all' || language === languageFilter;
    const regionVisible = regionFilter === 'all' || region === regionFilter;

    if (!localeVisible || !languageVisible || !regionVisible) {
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
                             (statusFilter === 'near-limit' && tileStatus === 'near-limit') ||
                             (statusFilter === 'overflow' && tileStatus === 'overflow');

        if (statusVisible) {
          // Use empty string to defer exact layout mode to CSS
          tileContainer.style.display = '';
          visibleCount++;
          sectionHasVisibleTiles = true;
        } else {
          tileContainer.style.display = 'none';
        }
      }
    });

    // Show/hide the entire section
    section.style.display = sectionHasVisibleTiles ? '' : 'none';
  });

  updateFilterStatus(visibleCount, totalCount, statusFilter, languageFilter, regionFilter, localeFilter);
  
  // Ensure locale pills mirror the current filtered view
  try { if (window.requestLocaleBadgeRefresh) window.requestLocaleBadgeRefresh(); } catch (e) { /* no-op */ }
}

function getTileStatus(tile) {
  // Prefer explicit status classes set by rendering/analysis
  if (!tile) return 'clean';
  if (tile.classList.contains('overflow')) return 'overflow';
  if (tile.classList.contains('near-limit')) return 'near-limit';
  if (tile.classList.contains('clean')) return 'clean';

  // Fallback: analyzeText if available
  const titleEl = tile.querySelector('.tile-title');
  const subtitleEl = tile.querySelector('.tile-subtitle');
  const title = titleEl ? (titleEl.textContent || '') : '';
  const subtitle = subtitleEl ? (subtitleEl.textContent || '') : '';

  if (typeof analyzeText === 'function') {
    try {
      const result = analyzeText(title, subtitle);
      if (result && result.status) return result.status;
    } catch (e) {
      // fall through to length-based fallback
    }
  }

  // Final fallback: simple length thresholds using LIMITS
  const tMax = (window.LIMITS && window.LIMITS.title && window.LIMITS.title.max) ? window.LIMITS.title.max : 40;
  const tWarn = (window.LIMITS && window.LIMITS.title && window.LIMITS.title.warning) ? window.LIMITS.title.warning : 30;
  const sMax = (window.LIMITS && window.LIMITS.subtitle && window.LIMITS.subtitle.max) ? window.LIMITS.subtitle.max : 40;
  const sWarn = (window.LIMITS && window.LIMITS.subtitle && window.LIMITS.subtitle.warning) ? window.LIMITS.subtitle.warning : 30;

  if (title.length > tMax || subtitle.length > sMax) return 'overflow';
  if (title.length >= tWarn || subtitle.length >= sWarn) return 'near-limit';
  return 'clean';
}

function updateFilterStatus(visibleCount, totalCount, statusFilter, languageFilter, regionFilter, localeFilter) {
  const statusEl = document.getElementById('filterStatus');
  if (!statusEl) return;
  
  let statusText = `Showing ${visibleCount} of ${totalCount} tiles`;
  
  const activeFilters = [];
  if (statusFilter !== 'all') activeFilters.push(`status: ${statusFilter}`);
  if (languageFilter !== 'all') activeFilters.push(`language: ${LANGUAGE_MAP[languageFilter] || languageFilter}`);
  if (regionFilter !== 'all') activeFilters.push(`region: ${regionFilter}`);
  if (localeFilter !== 'all') activeFilters.push(`locale: ${localeFilter}`);
  
  if (activeFilters.length > 0) {
    statusText += ` (filtered by: ${activeFilters.join(', ')})`;
  }
  
  statusEl.textContent = statusText;
}

function resetFilters() {
  document.getElementById('statusFilter').value = 'all';
  document.getElementById('languageFilter').value = 'all';
  document.getElementById('regionFilter').value = 'all';
  document.getElementById('localeFilter').value = 'all';
  applyFilters();
}

// TileForge Info Popup with Tabs
function showInfoPopup() {
  const tabs = [
    {
      title: 'Features',
      icon: '🚀',
      content: createFeaturesTabContent()
    },
    {
      title: 'Tips & Tricks',
      icon: '💡',
      content: createTipsTabContent()
    },
    {
      title: 'Troubleshooting',
      icon: '🔧',
      content: createTroubleshootingTabContent()
    },
    {
      title: 'Known Issues',
      icon: '⚠️',
      content: createKnownIssuesTabContent()
    },
    {
      title: 'Future Plans',
      icon: '🔮',
      content: createFuturePlansTabContent()
    }
  ];

  const infoModal = Modal.createTabbedModal({
    title: '📖 TileForge Information Center',
    size: 'large',
    tabs: tabs,
    activeTab: 0
  });

  infoModal.show();
}

function createFeaturesTabContent() {
  return `
    <div class="info-section">
      <h4>🎮 Core Features</h4>
      <div class="feature-grid">
        <!-- 2.4.0 features → placed first for visibility (updated by Cascade) -->
        <div class="feature-item">
          <h5>📁 Projects Manager</h5>
          <p>Left‑panel Projects with Save, Clone, New, Remove, and Export to Iris CSV. Per‑file actions and quick preview centralize session files.</p>
        </div>
        <div class="feature-item">
          <h5>🏷️ Locale Pills & Badges</h5>
          <p>Interactive language/status pills under the toolbar with counts, anchor links, optional status borders, and sticky wrapper. Filter by language or status.</p>
        </div>
        <div class="feature-item">
          <h5>🧭 Locale Picker Upgrades</h5>
          <p>Quick picks for ToH and Mobile defaults, language pills, improved filtering, and scoped modal styling for efficient locale selection.</p>
        </div>
        <div class="feature-item">
          <h5>🔎 GridPeek (CSV Viewer)</h5>
          <p>Read‑only CSV quick viewer with filename meta and capped rows. Launch from Projects quick‑view or the toolbar.</p>
        </div>
        <div class="feature-item">
          <h5>🛡️ Save Overwrite Confirmation</h5>
          <p>Confirmation prompt with accent styling before overwriting an existing filename to prevent accidental loss.</p>
        </div>
        <div class="feature-item">
          <h5>📈 Interactive Analytics</h5>
          <p>Analytics cards sort/filter and anchor to impacted entries for faster triage and review.</p>
        </div>
        <div class="feature-item">
          <h5>✨ Quality of Life</h5>
          <p>Clear All per‑field buttons, template validation pass, and sticky previews polish overall workflow.</p>
        </div>

        <div class="feature-item">
          <h5>🆕 Case Converter Tool</h5>
          <p>Instantly convert text to UPPER, lower, Title, or Sentence case for any field or batch of text. Great for localization and consistency.</p>
        </div>
        <div class="feature-item">
          <h5>🧹 Clear All</h5>
          <p>One-click reset for all mapping and preview data—useful for rapid iteration or starting over.</p>
        </div>
        <div class="feature-item">
          <h5>🌍 Manage Locales</h5>
          <p>Add, remove, or filter locales from your data set for focused previews and exports.</p>
        </div>
        <div class="feature-item">
          <h5>🌐 Arabic & Special Character Support</h5>
          <p>Full UTF-8 support for right-to-left and special language characters.</p>
        </div>
        <div class="feature-item">
          <h5>📊 Visual Text Measurement</h5>
          <p>Canvas-based pixel-perfect text measurement ensures accurate overflow detection and prevents text truncation issues.</p>
        </div>
        <div class="feature-item">
          <h5>52+ Locale Support</h5>
          <p>Comprehensive locale support for languages and regions worldwide with clear locale identification and filtering.</p>
        </div>
        <div class="feature-item">
          <h5>✏️ Live Tile Editing</h5>
          <p>Real-time tile preview updates as you type, with instant visual feedback for headline and subheadline changes.</p>
        </div>
        <div class="feature-item">
          <h5>🖼️ Image Analysis</h5>
          <p>Detailed image metadata display with thumbnail generation, file size analysis, and aspect ratio calculations.</p>
        </div>
        <div class="feature-item">
          <h5>🔍 Advanced Filtering</h5>
          <p>Multi-level filtering by status, locale, language, and region with real-time tile updates and search capabilities.</p>
        </div>
        <div class="feature-item">
          <h5>📁 CSV Import/Export</h5>
          <p>Seamless CSV file handling with support for complex locale data structures and narrator text integration.</p>
        </div>
        <div class="feature-item">
          <h5>🎨 Headliner Crafter</h5>
          <p>Advanced CSV field mapping with color-coded character analysis and multi-locale validation for optimal localization workflows.</p>
        </div>
      </div>
    </div>

    <div class="info-section">
      <h4>🎨 Design Features</h4>
      <ul>
        <li><strong>Dark Theme:</strong> Professional dark interface optimized for extended use</li>
        <li><strong>Responsive Design:</strong> Works seamlessly across desktop, tablet, and mobile devices</li>
        <li><strong>Modular CSS:</strong> Clean, maintainable stylesheet architecture with zero duplication</li>
        <li><strong>Accessibility:</strong> ARIA labels, keyboard navigation, focus management</li>
        <li><strong>Smooth Animations:</strong> Polished transitions and micro-interactions throughout the interface</li>
      </ul>
    </div>
  `;
}

function createTipsTabContent() {
  return `
    <div class="info-section">
      <h4>💡 Tips & Tricks</h4>
      <div class="tip-box">
        <h5><span class="tip-icon">🆕</span>Use the Case Converter</h5>
        <p>Quickly batch-convert all text fields to UPPER, lower, Title, or Sentence case before export—saves tons of manual editing!</p>
      </div>
      <div class="tip-box">
        <h5><span class="tip-icon">🧹</span>Clear All for Fast Reset</h5>
        <p>"Clear All" resets your mapping and preview instantly—no need to reload the page.</p>
      </div>
      <div class="tip-box">
        <h5><span class="tip-icon">🌍</span>Locale Management</h5>
        <p>Use Manage Locales to focus on specific regions or languages—great for QA and targeted review.</p>
      </div>
      <div class="tip-box">
        <h5><span class="tip-icon">🌐</span>Arabic & Special Characters</h5>
        <p>If Arabic or special characters look wrong, ensure your CSV is UTF-8 encoded for full support.</p>
      </div>
      <div class="tip-box">
        <h5><span class="tip-icon">🔁</span>Drag-and-Drop Everywhere</h5>
        <p>Drag-and-drop works everywhere: images, CSV, XML—just drop onto the right zone.</p>
      </div>
      <div class="tip-box">
        <h5><span class="tip-icon">💡</span>Modal Drop Zone Tips</h5>
        <p>Check the modal drop zone for file type support and workflow tips. Coming soon: Default Template Loader!</p>
      </div>
      <div class="tip-box">
        <h5><span class="tip-icon">🎯</span>Text Overflow Prevention</h5>
        <p>TileForge automatically measures text width using Canvas API. Watch the character count and visual indicators to prevent text from breaking to multiple lines or getting truncated.</p>
      </div>
    </div>
    <div class="info-section">
      <h4>🚀 Advanced Techniques</h4>
      <ul>
        <li><strong>Batch Editing:</strong> Use filters to isolate specific locales, then edit multiple tiles efficiently</li>
        <li><strong>Text Length Strategy:</strong> Keep headlines under 25 characters for single-line display</li>
        <li><strong>Locale Grouping:</strong> Organize your CSV with clear locale codes for automatic country detection</li>
        <li><strong>Image Preparation:</strong> Pre-optimize images to 1920x1080 for consistent tile backgrounds</li>
        <li><strong>CSV Structure:</strong> Include narrator text in <code>items/0/narratorText</code> column for rich content</li>
      </ul>
    </div>
  `;
}

function createShortcutsTabContent() {
  return `
    <div class="info-section">
      <h4>⌨️ Keyboard Shortcuts</h4>
      <table class="shortcut-table">
        <thead>
          <tr><th>Shortcut</th><th>Action</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><span class="keyboard-shortcut">Ctrl + ,</span></td><td>Open Settings</td><td>Opens the TileForge settings modal</td></tr>
          <tr><td><span class="keyboard-shortcut">Ctrl + E</span></td><td>Export CSV</td><td>Exports the current data as a CSV file</td></tr>
          <tr><td><span class="keyboard-shortcut">Ctrl + U</span></td><td>Upload Image</td><td>Opens the file dialog to upload an image</td></tr>
          <tr><td><span class="keyboard-shortcut">Ctrl + T</span></td><td>Toggle Theme</td><td>Switches to the next available theme</td></tr>
          <tr><td><span class="keyboard-shortcut">Ctrl + F</span></td><td>Focus Search</td><td>Focuses the locale filter/search input</td></tr>
          <tr><td><span class="keyboard-shortcut">Ctrl + R</span></td><td>Reset Filters</td><td>Resets all filters to their default state</td></tr>
        </tbody>
      </table>
      <div class="info-section">
        <h4>🔧 Universal & Modal Shortcuts</h4>
        <ul>
          <li><span class="keyboard-shortcut">ESC</span> — Close active modal or dialog</li>
          <li><span class="keyboard-shortcut">Tab</span> — Navigate between modal elements</li>
          <li><span class="keyboard-shortcut">Enter</span> — Confirm action in dialogs or blur text field in live editor</li>
        </ul>
      </div>
      <div class="info-section">
        <h4>🖱️ Power User Tips</h4>
        <ul>
          <li><strong>Drag & Drop:</strong> Works for images, CSV, XML files—just drop onto the right zone</li>
          <li><strong>Locale Quick Filter:</strong> <span class="keyboard-shortcut">Ctrl + F</span> focuses the locale filter, then type locale code and press Enter</li>
        </ul>
      </div>
    </div>
  `;
}

function createTroubleshootingTabContent() {
  return `
    <div class="info-section">
      <h4>🔧 Common Issues & Solutions</h4>
      
      <div class="tip-box">
        <h5><span class="tip-icon">❌</span>CSV File Won't Load</h5>
        <p><strong>Solution:</strong> Ensure your CSV file has proper headers and uses UTF-8 encoding. Check that locale codes follow the format "EN-US" or similar.</p>
      </div>

      <div class="tip-box">
        <h5><span class="tip-icon">🖼️</span>Image Not Displaying</h5>
        <p><strong>Solution:</strong> Verify the image format is supported (JPG, PNG, GIF, WebP). Large files may take time to process - check the image info panel for details.</p>
      </div>

      <div class="tip-box">
        <h5><span class="tip-icon">🏷️</span>Country Flag Missing</h5>
        <p><strong>Solution:</strong> Ensure locale codes include country identifiers (US, FR, DE, etc.). Unsupported countries will show a globe emoji as fallback.</p>
      </div>

      <div class="tip-box">
        <h5><span class="tip-icon">📝</span>Live Editor Not Updating</h5>
        <p><strong>Solution:</strong> Click directly in the tile editor fields. The preview updates automatically as you type in the headline or subheadline inputs.</p>
      </div>
    </div>

    <div class="info-section">
      <h4>🐛 Debugging Tips</h4>
      <ul>
        <li><strong>Browser Console:</strong> Press F12 to open developer tools and check for error messages</li>
        <li><strong>File Format:</strong> Ensure CSV files use comma separation and proper UTF-8 encoding</li>
        <li><strong>Image Size:</strong> Very large images (>10MB) may cause performance issues</li>
        <li><strong>Browser Support:</strong> TileForge works best in modern browsers (Chrome, Firefox, Safari, Edge)</li>
        <li><strong>JavaScript Enabled:</strong> Ensure JavaScript is enabled in your browser settings</li>
      </ul>
    </div>

    <div class="info-section">
      <h4>📞 Getting Help</h4>
      <p>If you encounter persistent issues:</p>
      <ul>
        <li>Check browser console for error messages</li>
        <li>Try refreshing the page and reloading your files</li>
        <li>Verify your CSV file structure matches the expected format</li>
        <li>Test with a smaller image file to isolate performance issues</li>
      </ul>
    </div>
  `;
}

function createFuturePlansTabContent() {
  return `
    <div class="info-section">
      <h4>🎉 Recently Completed</h4>
      <p>Major features delivered in recent updates:</p>
      <div class="completed-section">
        <ul>
          <li>✅ <strong>Multi-Platform Template System:</strong> Xbox dashboard (ToH) + Mobile Spotlight templates</li>
          <li>✅ <strong>Auto-Localization System:</strong> 121+ language presets with smart toggle functionality</li>
          <li>✅ <strong>Enhanced UI:</strong> Streamlined interface with icon-based navigation and exciting welcome experience</li>
          <li>✅ <strong>Template Persistence:</strong> Robust template consistency across all UI interactions</li>
        </ul>
      </div>
    </div>

    <div class="info-section">
      <h4>🔮 Upcoming Enhancements</h4>
      <p>Next-generation features in development:</p>
      
      <div class="roadmap-section">
        <h5>🚀 Advanced Export & Integration</h5>
        <ul>
          <li><strong>Enhanced Export Options:</strong> JSON export, Excel compatibility, custom formatting</li>
          <li><strong>Batch Processing:</strong> Upload and process multiple tile sets simultaneously</li>
          <li><strong>Project Templates:</strong> Save and reuse complete tile configurations across projects</li>
          <li><strong>Cloud Integration:</strong> Sync projects across devices and teams</li>
        </ul>
      </div>

      <div class="roadmap-section">
        <h5>🤖 AI-Powered Features</h5>
        <ul>
          <li><strong>Smart Text Optimization:</strong> AI suggestions for better text fit and readability</li>
            <li><strong>Automated QA:</strong> Intelligent detection of localization issues and inconsistencies</li>
          <li><strong>Dynamic Presets:</strong> Context-aware preset recommendations based on game genre</li>
        </ul>
      </div>
  
      <div class="feedback-section">
        <h5>💬 Your Input Shapes TileForge</h5>
        <p>Have ideas for new features? Your feedback drives our roadmap and helps us build exactly what Xbox developers need!</p>
      </div>
    </div>
  `;
}

function createKnownIssuesTabContent() {
  return `
    <div class="info-section">
      <h4>⚠️ Known Issues</h4>
      <p>Current known issues and limitations in TileForge:</p>
      
      <div class="issue-section">
        <h5>🎨 Theme System Issues</h5>
        <div class="issue-item">
          <h6><span class="issue-status medium">🟠 Medium</span> Light Themes Not Working</h6>
          <p><strong>Issue:</strong> Light theme options in Settings are currently non-functional and may cause display issues.</p>
          <p><strong>Workaround:</strong> Use the default dark theme or other dark theme variants for optimal experience.</p>
          <p><strong>Status:</strong> Under investigation - fix planned for next release.</p>
        </div>
      </div>
      
      <div class="reporting-section">
        <h5>🐛 Report New Issues</h5>
        <p>Found a bug or issue not listed here? Help us improve TileForge:</p>
        <ul>
          <li>Check browser console for error messages</li>
          <li>Note your browser version and operating system</li>
          <li>Describe steps to reproduce the issue</li>
          <li>Include any relevant files or screenshots</li>
        </ul>
      </div>
      
      <div class="status-legend">
        <h5>📊 Issue Status Legend</h5>
        <ul>
          <li><span class="issue-status critical">🔴 Critical</span> - Major functionality broken</li>
          <li><span class="issue-status high">🟡 High</span> - Significant impact on user experience</li>
          <li><span class="issue-status medium">🟠 Medium</span> - Minor functionality issues</li>
          <li><span class="issue-status low">🟢 Low</span> - Cosmetic or edge case issues</li>
        </ul>
      </div>
    </div>
  `;
}

function createAboutTabContent() {
  return `
    <div class="info-section">
      <h4>🎮 About TileForge</h4>
      <p>TileForge is a comprehensive Xbox tile localization preview tool designed to streamline the process of creating and managing localized game tiles across multiple regions and languages.</p>
      ${typeof window.renderVersionCard === 'function' ? window.renderVersionCard({ headingLevel: 'h5' }) : ''}
      <div class="whats-new">
        <h5>✨ What’s New in 2.4.0</h5>
        <ul>
          <li><strong>New Projects module:</strong> Left‑panel Projects manager with Save, Clone, New, Remove, and Export to Iris CSV. Per‑file actions and quick preview centralize session files.</li>
          <li><strong>Locale pills and badges:</strong> New pill row under the toolbar with language/status palettes, optional status borders, anchor links, counts, and sticky wrapper. Interactive filters by language/status.</li>
          <li><strong>Locale Picker upgrades:</strong> Quick picks for ToH and Mobile defaults, language pills, improved filtering and scoped modal styling.</li>
          <li><strong>GridPeek — CSV Quick Viewer:</strong> Read‑only CSV modal with filename meta and capped rows. Launch from Projects or toolbar.</li>
          <li><strong>Dynamic Export ready state:</strong> Export buttons reflect saved/dirty via <code>[data-ready]</code> and global events (<code>tileforge:file-dirty</code>/<code>tileforge:file-saved</code>).</li>
          <li><strong>Save overwrite confirmation:</strong> Confirmation prompt with accent styling before overwriting an existing filename.</li>
          <li><strong>Interactive analytics:</strong> Analytics cards sort/filter and anchor to impacted entries for faster triage.</li>
          <li><strong>Quality‑of‑life:</strong> Clear All buttons per field, template validation pass, and sticky previews polish.</li>
        </ul>
        <p><strong>Information Center:</strong> A comprehensive, always-up-to-date help & support modal. Browse features, new tools, tips & tricks, keyboard shortcuts, troubleshooting, and future plans—all in one place!</p>
      </div>
    </div>

    <div class="info-section">
      <h4>🛠️ Technical Stack</h4>
      <ul>
        <li><strong>Frontend:</strong> Vanilla JavaScript ES6+, HTML5, CSS3</li>
        <li><strong>Canvas API:</strong> Pixel-perfect text measurement and analysis</li>
        <li><strong>File Handling:</strong> FileReader API for CSV and image processing</li>
        <li><strong>Responsive Design:</strong> CSS Grid and Flexbox layouts</li>
        <li><strong>Accessibility:</strong> ARIA labels, keyboard navigation, focus management</li>
        <li><strong>Performance:</strong> Optimized rendering with efficient DOM manipulation</li>
      </ul>
    </div>

    <div class="info-section">
      <h4>🎨 Template System</h4>
      <p>TileForge now supports multiple Xbox tile templates optimized for different platforms:</p>
      <ul>
        <li><strong>Top of Home (ToH):</strong> Traditional 560×315px horizontal Xbox dashboard tiles</li>
        <li><strong>Mobile Spotlight:</strong> NEW 694×758px vertical mobile-optimized tiles</li>
        <li><strong>Dynamic Switching:</strong> Seamless template switching with automatic tile updates</li>
        <li><strong>Template Persistence:</strong> Robust template consistency across all UI interactions</li>
        <li><strong>Enhanced Capacity:</strong> Mobile Spotlight supports 50% more text (60/80 char vs 40/40)</li>
      </ul>
    </div>

    <div class="info-section">
      <h4>🤖 Auto-Localization System</h4>
      <p>Advanced preset management with intelligent localization capabilities:</p>
      <ul>
        <li><strong>JSON-Based Presets:</strong> Modular preset files with 121+ language translations</li>
        <li><strong>Smart Toggle:</strong> Switch between localized text per locale vs English for all</li>
        <li><strong>Preset Library:</strong> Available Now, Buy Now, Pre-order Now, New Season presets</li>
        <li><strong>Dropdown Selection:</strong> Per-field preset selection with immediate preview</li>
        <li><strong>Apply All:</strong> Bulk application of presets across all tiles with one click</li>
      </ul>
    </div>

    <div class="info-section">
      <h4>🌟 Key Innovations</h4>
      <ul>
        <li><strong>Visual Text Measurement:</strong> Canvas-based pixel measurement replaces unreliable character counting</li>
        <li><strong>Template-Aware Analysis:</strong> Text limits and overflow detection adapt to selected template</li>
        <li><strong>Modular Architecture:</strong> Zero-duplication CSS with feature-based separation</li>
        <li><strong>Real-time Preview:</strong> Instant visual feedback for all tile modifications</li>
        <li><strong>Advanced Filtering:</strong> Multi-dimensional filtering by status, locale, language, and region</li>
      </ul>
    </div>

    <div class="info-section">
      <h4>🎯 Design Philosophy</h4>
      <p>TileForge emphasizes professional development standards:</p>
      <ul>
        <li><strong>Precision over Approximation:</strong> Exact measurements instead of estimates</li>
        <li><strong>Modularity over Monoliths:</strong> Clean separation of concerns</li>
        <li><strong>User Experience First:</strong> Intuitive interfaces with immediate feedback</li>
        <li><strong>Performance Optimization:</strong> Efficient algorithms and minimal resource usage</li>
        <li><strong>Accessibility by Design:</strong> Inclusive interfaces for all users</li>
      </ul>
    </div>

    <div class="info-section">
      <h4>🔮 Future Roadmap</h4>
      <p>Planned enhancements include:</p>
      <ul>
        <li>Advanced export options with custom formatting</li>
        <li>Batch editing capabilities for multiple tiles</li>
        <li>Integration with external localization services</li>
        <li>Enhanced image processing and optimization tools</li>
        <li>Collaborative editing features</li>
      </ul>
    </div>

    <div class="info-section">
      <h4>👥 Credits</h4>
      <p>TileForge development team:</p>
      <ul>
        <li><strong>Jon:</strong> Initial base code concept and foundation</li>
        <li><strong>Chad:</strong> Upgrades, enhancements, and system refinement</li>
      </ul>
      <p>Special thanks to all contributors who helped shape TileForge into a comprehensive Xbox localization tool.</p>
    </div>
  `;
}
