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
  
  console.log('TileForge initialized successfully with modular architecture');
});
