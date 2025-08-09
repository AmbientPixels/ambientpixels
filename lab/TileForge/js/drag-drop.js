// TileForge Drag & Drop Module
// Handles file drag-and-drop functionality for images and CSV files

// Setup drag and drop functionality
function setupDragAndDrop() {
  const imageZone = document.getElementById('imageUploadZone');
  const csvZone = document.getElementById('csvUploadZone');
  
  if (imageZone) {
    setupImageDragDrop(imageZone);
  }
  
  if (csvZone) {
    setupCsvDragDrop(csvZone);
  }
}

// Setup image drag and drop
function setupImageDragDrop(zone) {
  zone.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.add('drag-over');
  });
  
  zone.addEventListener('dragleave', function(e) {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('drag-over');
  });
  
  zone.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        handleImageUpload(file);
      } else {
        alert('Please upload a valid image file.');
      }
    }
  });
}

// Setup CSV drag and drop
function setupCsvDragDrop(zone) {
  zone.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.add('drag-over');
  });
  
  zone.addEventListener('dragleave', function(e) {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('drag-over');
  });
  
  zone.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        handleCsvUpload(file);
      } else {
        alert('Please upload a valid CSV file.');
      }
    }
  });
}

// Handle image file upload
function handleImageUpload(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const imageSrc = e.target.result;
    updateTileBackgrounds(imageSrc);
    
    // Update file info in analytics
    updateFileInfo('Image', file.name, `${(file.size / 1024).toFixed(1)} KB`);
  };
  reader.readAsDataURL(file);
}

// Setup file input handlers
function setupFileInputs() {
  const imageInput = document.getElementById('imageInput');
  const csvInput = document.getElementById('csvInput');
  
  if (imageInput) {
    imageInput.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file && file.type.startsWith('image/')) {
        handleImageUpload(file);
      }
    });
  }
  
  if (csvInput) {
    csvInput.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) {
        handleCsvUpload(file);
      }
    });
  }
}
