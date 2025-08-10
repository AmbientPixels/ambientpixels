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
    const currentInfo = fileInfoElement.textContent;
    let newInfo = '';
    
    if (type === 'CSV') {
      newInfo = `CSV: ${filename} (${info} locales)`;
    } else if (type === 'Image') {
      newInfo = `Image: ${filename} (${info})`;
    }
    
    // Update or append file info
    if (currentInfo.includes(type)) {
      // Replace existing info for this type
      const lines = currentInfo.split('\n');
      const updatedLines = lines.map(line => 
        line.startsWith(type) ? newInfo : line
      );
      fileInfoElement.textContent = updatedLines.join('\n');
    } else {
      // Add new info
      fileInfoElement.textContent = currentInfo ? `${currentInfo}\n${newInfo}` : newInfo;
    }
    
    // Show file info section
    fileInfoElement.style.display = 'block';
  }
}

// Update detailed image information panel
function updateImageInfoPanel(imageInfo) {
  // First update the basic file info for backward compatibility
  const fileSizeKB = (imageInfo.fileSize / 1024).toFixed(1);
  updateFileInfo('Image', imageInfo.filename, `${fileSizeKB} KB`);
  
  // Update detailed image info panel
  const imageInfoPanel = document.getElementById('imageInfoPanel');
  if (imageInfoPanel) {
    imageInfoPanel.innerHTML = `
      <h4>📷 Image Details</h4>
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
    `;
  }
}
