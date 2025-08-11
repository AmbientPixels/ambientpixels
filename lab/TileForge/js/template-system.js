// TileForge Template System Module
// Handles template selection, switching, and template-specific functionality

// Global template state
let currentTemplate = 'toh'; // Default to Top of Home template

// Template configurations
const TEMPLATE_CONFIG = {
  'toh': {
    name: 'Top of Home (ToH)',
    description: '560×315px • Standard Xbox tile',
    dimensions: { width: 280, height: 140 },
    actualDimensions: { width: 560, height: 315 },
    textLimits: {
      title: { max: 40, warning: 30 },
      subtitle: { max: 40, warning: 30 }
    },
    fontSettings: {
      title: { fontSize: '18px', fontWeight: '600' },
      subtitle: { fontSize: '16px', fontWeight: '400' }
    },
    lineClamps: {
      title: 2,
      subtitle: 2
    },
    textWidth: 248 // 280px - 32px padding
  },
  'mobile-spotlight': {
    name: 'Mobile Spotlight',
    description: '694×758px • Vertical mobile format',
    dimensions: { width: 347, height: 379 },
    actualDimensions: { width: 694, height: 758 },
    textLimits: {
      title: { max: 60, warning: 45 },
      subtitle: { max: 80, warning: 60 }
    },
    fontSettings: {
      title: { fontSize: '20px', fontWeight: '700' },
      subtitle: { fontSize: '16px', fontWeight: '400' }
    },
    lineClamps: {
      title: 3,
      subtitle: 3
    },
    textWidth: 307 // 347px - 40px padding
  }
};

// Initialize template system
function initializeTemplateSystem() {
  console.log('🎮 Initializing TileForge Template System');
  
  // Set default template
  selectTemplate('toh');
  
  // Add event listeners for template options
  const templateOptions = document.querySelectorAll('.template-option');
  templateOptions.forEach(option => {
    option.addEventListener('click', function() {
      const templateType = this.dataset.template;
      selectTemplate(templateType);
    });
  });
  
  console.log('✅ Template system initialized successfully');
}

// Select and apply template
function selectTemplate(templateType) {
  if (!TEMPLATE_CONFIG[templateType]) {
    console.error(`Unknown template type: ${templateType}`);
    return;
  }
  
  console.log(`🔄 Switching to template: ${templateType}`);
  
  // Update global state
  currentTemplate = templateType;
  
  // Update UI - remove active class from all options
  const templateOptions = document.querySelectorAll('.template-option');
  templateOptions.forEach(option => option.classList.remove('active'));
  
  // Add active class to selected option
  const selectedOption = document.querySelector(`[data-template="${templateType}"]`);
  if (selectedOption) {
    selectedOption.classList.add('active');
  }
  
  // Update all existing tiles with new template
  updateAllTilesTemplate(templateType);
  
  // Update live editor preview tile
  updateLiveEditorTemplate(templateType);
  
  // Update analytics to reflect new template
  if (typeof updateAnalyticsFromAllTiles === 'function') {
    updateAnalyticsFromAllTiles();
  }
  
  // Re-validate image dimensions for new template
  if (typeof revalidateImageDimensions === 'function') {
    revalidateImageDimensions();
  }
  
  // Show template status
  showTemplateStatus(templateType);
  
  console.log(`✅ Template switched to: ${TEMPLATE_CONFIG[templateType].name}`);
}

// Update all existing tiles with new template class
function updateAllTilesTemplate(templateType) {
  const allTiles = document.querySelectorAll('.tile-preview');
  
  allTiles.forEach(tile => {
    // Remove existing template classes
    tile.classList.remove('mobile-spotlight');
    
    // Add new template class if not default (toh)
    if (templateType === 'mobile-spotlight') {
      tile.classList.add('mobile-spotlight');
    }
  });
  
  console.log(`📱 Updated ${allTiles.length} tiles with template: ${templateType}`);
}

// Update live editor preview tile
function updateLiveEditorTemplate(templateType) {
  const previewTile = document.getElementById('previewTile');
  if (previewTile) {
    // Remove existing template classes
    previewTile.classList.remove('mobile-spotlight');
    
    // Add new template class if not default (toh)
    if (templateType === 'mobile-spotlight') {
      previewTile.classList.add('mobile-spotlight');
    }
    
    console.log(`🎯 Updated live editor preview with template: ${templateType}`);
  }
}

// Show template status indicator
function showTemplateStatus(templateType) {
  const config = TEMPLATE_CONFIG[templateType];
  
  // Remove existing status indicators
  const existingStatus = document.querySelector('.template-status');
  if (existingStatus) {
    existingStatus.remove();
  }
  
  // Create new status indicator
  const templateSection = document.querySelector('.template-section');
  if (templateSection) {
    const statusDiv = document.createElement('div');
    statusDiv.className = 'template-status';
    statusDiv.innerHTML = `
      <i class="fas fa-check-circle"></i>
      <span>Active: ${config.name} (${config.actualDimensions.width}×${config.actualDimensions.height}px)</span>
    `;
    
    templateSection.appendChild(statusDiv);
  }
}

// Get current template configuration
function getCurrentTemplateConfig() {
  return TEMPLATE_CONFIG[currentTemplate] || TEMPLATE_CONFIG['toh'];
}

// Get current template limits (for text analysis)
function getCurrentLimits() {
  const config = getCurrentTemplateConfig();
  return config.textLimits;
}

// Get current template font settings
function getTemplateFontSettings() {
  const config = getCurrentTemplateConfig();
  return config.fontSettings;
}

// Get current template line clamps
function getTemplateLineClamps() {
  const config = getCurrentTemplateConfig();
  return config.lineClamps;
}

// Get current template text width
function getTileTextWidth() {
  const config = getCurrentTemplateConfig();
  return config.textWidth;
}

// Export functions for global access
window.templateSystem = {
  initialize: initializeTemplateSystem,
  selectTemplate: selectTemplate,
  getCurrentConfig: getCurrentTemplateConfig,
  getCurrentLimits: getCurrentLimits,
  getFontSettings: getTemplateFontSettings,
  getLineClamps: getTemplateLineClamps,
  getTextWidth: getTileTextWidth
};

console.log('📦 Template System module loaded');
