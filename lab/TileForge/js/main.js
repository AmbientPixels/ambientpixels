// TileForge Main Initialization Module
// Coordinates all modules and handles application startup

// --- Locale Modal <-> Preview Synchronization State ---
// Track which locales are currently active in the preview (default: all loaded locales)
let activeLocalesForPreview = [];

function getActiveLocalesForPreview() {
  // If not set, default to all locales in currentCsvData
  if (!activeLocalesForPreview || activeLocalesForPreview.length === 0) {
    if (window.currentCsvData && Array.isArray(window.currentCsvData)) {
      activeLocalesForPreview = [...new Set(window.currentCsvData.map(row => row.Locale || row.locale))].sort();
    }
  }
  return activeLocalesForPreview;
}

function setActiveLocalesForPreview(locales) {
  activeLocalesForPreview = Array.isArray(locales) ? [...locales] : [];
}

function filterPreviewByActiveLocales() {
  const localeSections = document.querySelectorAll('.locale-section');
  const activeSet = new Set(getActiveLocalesForPreview());
  localeSections.forEach(section => {
    const header = section.querySelector('.locale-header');
    if (!header) return;
    // Locale code is in the badge span
    const badge = header.querySelector('.country-badge');
    const locale = badge ? badge.textContent.trim() : header.textContent.split(' ')[0];
    if (activeSet.has(locale)) {
      section.style.display = '';
    } else {
      section.style.display = 'none';
    }
  });
}


// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Check if intro should be shown
  initializeIntroSection();
  
  // Load default data first
  loadDefaultData();
  
  // Setup all functionality
  setupFileInputs();
  setupDragAndDrop();
  setupLiveEditor();
  setupPresetControls(); // Initialize preset dropdowns
  initializeFilters();

  // Attach Manage Locales button event
  const manageLocalesBtn = document.getElementById('manageLocalesBtn');
  if (manageLocalesBtn) {
    manageLocalesBtn.addEventListener('click', function() {
      console.log('[DEBUG] Manage Locales button clicked');
      if (window.TileForgeLocalesUI && typeof window.TileForgeLocalesUI.open === 'function') {
        console.log('[DEBUG] TileForgeLocalesUI.open is available, opening modal');
        window.TileForgeLocalesUI.open(function(selectedLocales) {
          // Update active locales and filter the preview
          setActiveLocalesForPreview(selectedLocales);
          filterPreviewByActiveLocales();
        }, getActiveLocalesForPreview());
      } else {
        console.error('[ERROR] TileForgeLocalesUI.open is not available');
        alert('Locale Picker UI not loaded.');
      }
    });
  }

  // Initialize template system
  if (typeof window.templateSystem !== 'undefined') {
    window.templateSystem.initialize();
  }
  
  console.log('TileForge initialized successfully with modular architecture');
});

// Open Transform Modal manually
function openTransformModal() {
  if (typeof window.transformModal !== 'undefined') {
    console.log('🔄 Opening transform modal manually');
    window.transformModal.show((transformedCsvText, stats) => {
      console.log('✅ Manual transformation complete:', stats);
      // Process the transformed CSV data
      processCsvData(transformedCsvText, 'Transformed Data', stats.totalRows);
    });
  } else {
    console.error('Transform modal not available');
    alert('Transform modal is not loaded. Please refresh the page and try again.');
  }
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

function toggleIntroVisibility() {
  const currentSetting = localStorage.getItem('tileforge-show-intro');
  const newSetting = currentSetting === 'false' ? 'true' : 'false';
  
  localStorage.setItem('tileforge-show-intro', newSetting);
  
  // Update button text to reflect current state
  const button = event.target;
  if (newSetting === 'true') {
    button.textContent = 'Hide on startup';
    button.title = 'Intro will show on next visit';
  } else {
    button.textContent = 'Show on startup';
    button.title = 'Intro will be hidden on next visit';
  }
}

// Headliner Crafter Integration
function openHeadlinerCrafter() {
  console.log('🎯 Opening Headliner Crafter...');
  
  try {
    // Check if mapping modal is available
    if (!window.mappingModal) {
      console.error('❌ Mapping modal not available');
      alert('Headliner Crafter is not properly initialized. Please refresh the page.');
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
        alert(`Successfully processed ${transformedData.length} locales through Headliner Crafter!`);
      }
    });
    
  } catch (error) {
    console.error('❌ Error in openHeadlinerCrafter:', error);
    alert('Error opening Headliner Crafter: ' + error.message);
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
  };
}

function populateLocaleFilter() {
  const localeFilter = document.getElementById('localeFilter');
  const languageFilter = document.getElementById('languageFilter');
  const regionFilter = document.getElementById('regionFilter');
  
  if (!currentCsvData) return;
  
  // Get unique locales
  const locales = [...new Set(currentCsvData.map(row => row.Locale || row.locale))].sort();
  
  // Populate locale filter
  if (localeFilter) {
    localeFilter.innerHTML = '<option value="all">All Locales</option>';
    locales.forEach(locale => {
      const option = document.createElement('option');
      option.value = locale;
      option.textContent = `${locale} - ${LOCALE_NAMES[locale] || locale}`;
      localeFilter.appendChild(option);
    });
  }
  
  // Populate language filter
  if (languageFilter) {
    const languages = [...new Set(locales.map(locale => getLanguageFromLocale(locale)))].sort();
    languageFilter.innerHTML = '<option value="all">All Languages</option>';
    languages.forEach(lang => {
      const option = document.createElement('option');
      option.value = lang;
      option.textContent = `${LANGUAGE_MAP[lang] || lang} (${lang})`;
      languageFilter.appendChild(option);
    });
  }
  
  // Populate region filter
  if (regionFilter) {
    const regions = [...new Set(locales.map(locale => {
      const regionCode = getRegionFromLocale(locale);
      return REGION_MAP[regionCode] || regionCode;
    }))].sort();
    
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
  
  // Get all locale sections
  const localeSections = document.querySelectorAll('.locale-section');
  
  localeSections.forEach(section => {
    const localeHeader = section.querySelector('.locale-header');
    if (!localeHeader) return;
    
    const locale = localeHeader.textContent.split(' ')[0];
    const language = getLanguageFromLocale(locale);
    const regionCode = getRegionFromLocale(locale);
    const region = REGION_MAP[regionCode] || regionCode;
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
  
  updateFilterStatus(visibleCount, totalCount, statusFilter, languageFilter, regionFilter, localeFilter);
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
      title: 'Shortcuts',
      icon: '⌨️',
      content: createShortcutsTabContent()
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
        <li><strong>Accessibility:</strong> Keyboard navigation, focus management, and screen reader support</li>
        <li><strong>Smooth Animations:</strong> Polished transitions and micro-interactions throughout the interface</li>
      </ul>
    </div>
  `;
}

function createTipsTabContent() {
  return `
    <div class="info-section">
      <h4>💡 Pro Tips</h4>
      
      <div class="tip-box">
        <h5><span class="tip-icon">🎯</span>Text Overflow Prevention</h5>
        <p>TileForge automatically measures text width using Canvas API. Watch the character count and visual indicators to prevent text from breaking to multiple lines or getting truncated.</p>
      </div>

      <div class="tip-box">
        <h5><span class="tip-icon">🏷️</span>Country Badge Recognition</h5>
        <p>Country badges automatically detect locale codes (EN-US, FR-FR, etc.) and display the appropriate flag emoji. The system supports 15+ countries with fallback to a globe icon.</p>
      </div>

      <div class="tip-box">
        <h5><span class="tip-icon">📸</span>Image Optimization</h5>
        <p>For best results, use images with 16:9 aspect ratio. TileForge will analyze and display detailed metadata including dimensions, file size, and format information.</p>
      </div>

      <div class="tip-box">
        <h5><span class="tip-icon">🔄</span>Live Preview Magic</h5>
        <p>The live tile editor updates in real-time as you type. Use this to experiment with different headline lengths and see immediate visual feedback.</p>
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
      
      <div class="info-section">
        <h4>🔧 Modal Controls</h4>
        <p><span class="keyboard-shortcut">ESC</span> Close active modal or dialog</p>
        <p><span class="keyboard-shortcut">Tab</span> Navigate between modal elements</p>
        <p><span class="keyboard-shortcut">Enter</span> Confirm action in dialogs</p>
      </div>

      <div class="info-section">
        <h4>📁 File Operations</h4>
        <p><span class="keyboard-shortcut">Ctrl + O</span> Open file dialog (when focused on file inputs)</p>
        <p><span class="keyboard-shortcut">Drag & Drop</span> Drop files directly onto the upload areas</p>
      </div>

      <div class="info-section">
        <h4>🎮 Navigation Tips</h4>
        <ul>
          <li><strong>Tab Navigation:</strong> Use Tab key to move between form elements and buttons</li>
          <li><strong>Focus Management:</strong> Modals automatically focus the first interactive element</li>
          <li><strong>Escape Handling:</strong> ESC key always closes the topmost modal or dialog</li>
          <li><strong>Click Outside:</strong> Click modal backdrop to close (when enabled)</li>
        </ul>
      </div>
    </div>

    <div class="info-section">
      <h4>🔍 Filter Shortcuts</h4>
      <p>Use the filter dropdowns to quickly isolate:</p>
      <ul>
        <li><strong>Status Filtering:</strong> Clean, Issues, Modified tiles</li>
        <li><strong>Locale Filtering:</strong> Specific country/language combinations</li>
        <li><strong>Quick Reset:</strong> "All" option resets filters to show everything</li>
      </ul>
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
      
      <div class="version-info">
        <h5>📦 Version Information</h5>
        <p><strong>Version:</strong> 2.2.0</p>
        <p><strong>Build Date:</strong> August 2025</p>
        <p><strong>Architecture:</strong> Modular CSS/JS with Canvas API integration</p>
        <p><strong>Latest:</strong> Mobile Spotlight template system with template persistence</p>
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
        <li><strong>Top of Home (ToH):</strong> Traditional 360×315px horizontal Xbox dashboard tiles</li>
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
