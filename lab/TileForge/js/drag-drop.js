// TileForge Drag & Drop Module
// Handles file drag-and-drop functionality for images and CSV files

// Setup drag and drop functionality
function setupDragAndDrop() {
  const imageZone = document.getElementById('imgDropZone');
  const csvZone = document.getElementById('csvDropZone');
  
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
    
    // Create image element to get dimensions and detailed info
    const img = new Image();
    img.onload = function() {
      const imageInfo = {
        filename: file.name,
        format: file.type.split('/')[1].toUpperCase(),
        fileSize: file.size,
        width: img.width,
        height: img.height,
        aspectRatio: (img.width / img.height).toFixed(2),
        lastModified: new Date(file.lastModified).toLocaleDateString(),
        imageSrc: imageSrc  // Add image source for thumbnail generation
      };
      
      // Store image info globally for template switching validation
      window.currentImageInfo = imageInfo;
      
      // Update detailed image info panel
      updateImageInfoPanel(imageInfo);
    };
    img.src = imageSrc;
  };
  reader.readAsDataURL(file);
}

// Setup file input handlers
function setupFileInputs() {
  const imageInput = document.getElementById('imgInput');
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
