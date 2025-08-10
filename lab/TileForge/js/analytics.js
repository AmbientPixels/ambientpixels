// TileForge Analytics Module
// Handles analytics display, file info, and statistics updates

// Update analytics dashboard
function updateAnalytics(analytics) {
  const elements = {
    totalLocales: document.getElementById('localeCount'),
    overflowCount: document.getElementById('overflowCount'),
    nearLimitCount: document.getElementById('nearLimitCount'),
    cleanCount: document.getElementById('cleanCount')
  };
  
  Object.entries(elements).forEach(([key, element]) => {
    if (element) {
      element.textContent = analytics[key];
    }
  });
}

// Update file information in analytics
function updateFileInfo(type, filename, info) {
  const fileInfoElement = document.getElementById('fileInfo');
  if (fileInfoElement) {
    // Show file info section
    fileInfoElement.style.display = 'block';
    
    if (type === 'CSV') {
      const csvElement = document.getElementById('csvFileName');
      if (csvElement) {
        csvElement.textContent = `${filename} (${info} locales)`;
      }
    } else if (type === 'Image') {
      const imageElement = document.getElementById('imageFileName');
      if (imageElement) {
        imageElement.textContent = `${filename} (${info})`;
      }
    }
  }
}

// Update detailed image information panel
function updateImageInfoPanel(imageInfo) {
  // First update the basic file info for backward compatibility
  const fileSizeKB = (imageInfo.fileSize / 1024).toFixed(1);
  updateFileInfo('Image', imageInfo.filename, `${fileSizeKB} KB`);
  
  // Generate thumbnail synchronously since image is already loaded
  const thumbnailDataUrl = generateImageThumbnail(imageInfo.imageSrc, imageInfo.width, imageInfo.height, 120, 80);
  
  // Update detailed image info panel
  const imageInfoPanel = document.getElementById('imageInfoPanel');
  if (imageInfoPanel) {
    imageInfoPanel.innerHTML = `
      <h4>📷 Image Details</h4>
      <div class="image-info-content">
        <div class="image-thumbnail">
          <img src="${thumbnailDataUrl}" alt="Image thumbnail" class="thumbnail-img">
        </div>
        <div class="image-info-grid">
          <div class="info-row">
            <span class="info-label">File:</span>
            <span class="info-value">${imageInfo.filename}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Format:</span>
            <span class="info-value">${imageInfo.format}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Size:</span>
            <span class="info-value">${fileSizeKB} KB</span>
          </div>
          <div class="info-row">
            <span class="info-label">Dimensions:</span>
            <span class="info-value">${imageInfo.width} × ${imageInfo.height}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Aspect Ratio:</span>
            <span class="info-value">${imageInfo.aspectRatio}:1</span>
          </div>
          <div class="info-row">
            <span class="info-label">Modified:</span>
            <span class="info-value">${imageInfo.lastModified}</span>
          </div>
        </div>
      </div>
    `;
  }
}

// Generate a thumbnail from image source data
function generateImageThumbnail(imageSrc, originalWidth, originalHeight, maxWidth, maxHeight) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Calculate thumbnail dimensions maintaining aspect ratio
  const { width, height } = calculateThumbnailSize(originalWidth, originalHeight, maxWidth, maxHeight);
  
  canvas.width = width;
  canvas.height = height;
  
  // Create image and draw it to canvas
  const img = new Image();
  img.onload = function() {
    ctx.drawImage(img, 0, 0, width, height);
    
    // Update the thumbnail in the DOM once it's ready
    const thumbnailImg = document.querySelector('.thumbnail-img');
    if (thumbnailImg) {
      thumbnailImg.src = canvas.toDataURL('image/jpeg', 0.8);
    }
  };
  img.src = imageSrc;
  
  // Return a placeholder initially
  return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjgwIiB2aWV3Qm94PSIwIDAgMTIwIDgwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cmVjdCB3aWR0aD0iMTIwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjMzMzIi8+CjxwYXRoIGQ9Ik02MCA0MEw3MCA1MEg1MEw2MCA0MFoiIGZpbGw9IiM2NjYiLz4KPC9zdmc+';
}

// Calculate thumbnail size maintaining aspect ratio
function calculateThumbnailSize(originalWidth, originalHeight, maxWidth, maxHeight) {
  let width = originalWidth;
  let height = originalHeight;
  
  // Scale down if larger than max dimensions
  if (width > maxWidth) {
    height = (height * maxWidth) / width;
    width = maxWidth;
  }
  
  if (height > maxHeight) {
    width = (width * maxHeight) / height;
    height = maxHeight;
  }
  
  return { width: Math.round(width), height: Math.round(height) };
}
