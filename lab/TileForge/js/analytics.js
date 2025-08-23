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

  // Ensure locale badges reflect the latest statuses
  try { if (window.requestLocaleBadgeRefresh) window.requestLocaleBadgeRefresh(); } catch (e) {}
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
      // Also reflect active CSV in the localized preview status pill
      try {
        const activeName = document.getElementById('activeCsvName');
        if (activeName) {
          activeName.textContent = filename || '—';
          const pill = activeName.parentElement;
          if (pill && pill.setAttribute) {
            pill.setAttribute('title', filename ? `Currently active CSV: ${filename}` : 'No active CSV selected');
          }
        }
      } catch (e) { /* no-op */ }
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
  
  // Get template compliance validation
  const validation = validateImageDimensions(imageInfo.width, imageInfo.height);
  
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
            <span class="info-value ${validation.cssClass}">${imageInfo.width} × ${imageInfo.height} ${validation.icon}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Aspect Ratio:</span>
            <span class="info-value">${imageInfo.aspectRatio}:1</span>
          </div>
          <div class="info-row">
            <span class="info-label">Template Compliance:</span>
            <span class="info-value ${validation.cssClass}">${validation.message}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Modified:</span>
            <span class="info-value">${imageInfo.lastModified}</span>
          </div>
        </div>
      </div>
    `;
  }
  
  // Update preview badge
  updatePreviewBadge(validation);
}

// Re-validate image dimensions when template changes
function revalidateImageDimensions() {
  // Check if we have image info stored
  const imageInfoPanel = document.getElementById('imageInfoPanel');
  if (!imageInfoPanel || !window.currentImageInfo) {
    return; // No image loaded, nothing to validate
  }
  
  // Re-run validation with current image dimensions
  const validation = validateImageDimensions(window.currentImageInfo.width, window.currentImageInfo.height);
  
  // Update the image info panel with new validation
  updateImageInfoPanel(window.currentImageInfo);
}

// Validate image dimensions against current template requirements
function validateImageDimensions(width, height) {
  // Get current template configuration
  const currentTemplate = typeof window.templateSystem !== 'undefined' 
    ? window.templateSystem.getCurrentConfig() 
    : null;
  
  // Default to ToH if template system not available
  const expectedDimensions = currentTemplate 
    ? { width: currentTemplate.actualDimensions.width, height: currentTemplate.actualDimensions.height }
    : { width: 560, height: 315 }; // ToH default
  
  const templateName = currentTemplate ? currentTemplate.name : 'Top of Home';
  

  
  // Check if dimensions match exactly
  const isExactMatch = width === expectedDimensions.width && height === expectedDimensions.height;
  
  // Calculate tolerance (±5% acceptable)
  const tolerance = 0.05;
  const widthTolerance = expectedDimensions.width * tolerance;
  const heightTolerance = expectedDimensions.height * tolerance;
  
  const isWithinTolerance = 
    Math.abs(width - expectedDimensions.width) <= widthTolerance &&
    Math.abs(height - expectedDimensions.height) <= heightTolerance;
  
  // Determine validation result
  if (isExactMatch) {
    return {
      status: 'compliant',
      icon: '✅',
      cssClass: 'validation-compliant',
      message: `Perfect match for ${templateName} (${expectedDimensions.width}×${expectedDimensions.height})`,
      badgeText: `${width}×${height}`,
      badgeClass: 'compliant'
    };
  } else if (isWithinTolerance) {
    return {
      status: 'close',
      icon: '⚠️',
      cssClass: 'validation-close',
      message: `Close match for ${templateName} (Expected: ${expectedDimensions.width}×${expectedDimensions.height})`,
      badgeText: `${width}×${height}`,
      badgeClass: 'compliant'
    };
  } else {
    return {
      status: 'non-compliant',
      icon: '❌',
      cssClass: 'validation-error',
      message: `Does not match ${templateName} (Expected: ${expectedDimensions.width}×${expectedDimensions.height})`,
      badgeText: `${width}×${height}`,
      badgeClass: 'non-compliant'
    };
  }
}

// Update preview badge based on validation status
function updatePreviewBadge(validation) {
  // Find all tile elements that need validation badges
  const tileSelectors = [
    '#previewTile',           // Live editor preview tile
    '.preview-tile',          // Main preview tile
    '.tile-preview',          // Localized tile cards
    '.modal .preview-tile'    // Modal preview tiles
  ];
  
  const allTiles = [];
  tileSelectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => allTiles.push(el));
  });
  
  if (allTiles.length === 0) return;
  
  // Update badges on all tiles
  allTiles.forEach(tile => {
    // Remove existing validation badge
    const existingBadge = tile.querySelector('.validation-badge');
    if (existingBadge) {
      existingBadge.remove();
    }
    
    // Add badge for all images (compliant and non-compliant)
    const badge = document.createElement('div');
    badge.className = `validation-badge ${validation.badgeClass}`;
    badge.innerHTML = validation.badgeText;
    badge.title = validation.message;
    
    // Ensure tile has relative positioning for badge placement
    if (getComputedStyle(tile).position === 'static') {
      tile.style.position = 'relative';
    }
    
    tile.appendChild(badge);
  });
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

// Render compact locale badges in the localized status bar
function renderLocaleBadgeArea() { 
  const host = document.getElementById('localeBadgeArea');
  if (!host) return;

  // Gather per-locale status by scanning rendered sections and tiles
  const sections = document.querySelectorAll('.locale-section');
  const badges = [];
  sections.forEach(section => {
    // Skip sections hidden by filters or active-locale preview state
    const sectionStyle = window.getComputedStyle(section);
    if (sectionStyle.display === 'none' || section.offsetParent === null) return;

    const header = section.querySelector('.locale-header .country-badge');
    let code = header ? (header.textContent || '').trim() : '';
    if (!code) {
      // Fallback to data-locale set on the section (covers cases like 'invariant')
      code = (section.dataset && section.dataset.locale) ? String(section.dataset.locale).trim() : '';
    }
    if (!code) return;

    let overflow = 0, near = 0, clean = 0; 
    section.querySelectorAll('.tile-preview').forEach(tile => {
      // Count only tiles currently visible (respect applied filters)
      const tileContainer = tile.closest('.tile-container') || tile;
      const tcStyle = tileContainer ? window.getComputedStyle(tileContainer) : null;
      const isVisible = tile.offsetParent !== null && (!tcStyle || tcStyle.display !== 'none');
      if (!isVisible) return;
      if (tile.classList.contains('overflow')) overflow++;
      else if (tile.classList.contains('near-limit')) near++;
      else if (tile.classList.contains('clean')) clean++;
    });

    // Determine overall status priority: overflow > near-limit > clean
    let status = 'clean';
    if (overflow > 0) status = 'overflow';
    else if (near > 0) status = 'near-limit';

    const total = overflow + near + clean;
    // Only add a pill if this locale has at least one visible tile
    if (total > 0) {
      badges.push({ code, status, total, overflow, near, clean });
    }
  });

  // Sort badges alphabetically by code for stable visual order
  badges.sort((a, b) => String(a.code).toUpperCase().localeCompare(String(b.code).toUpperCase()));

  // Render
  host.innerHTML = '';
  // Toggle UI state for badge controls visibility
  const badgesSection = document.querySelector('.locale-badges-section');
  if (badgesSection) {
    badgesSection.classList.toggle('has-badges', badges.length > 0);
  }
  badges.forEach(b => {
    const badge = document.createElement('span');
    // Reuse existing badge styling; add status as modifier class
    const lang = (b.code || '').split('-')[0].toLowerCase();
    badge.className = `country-badge ${b.status} lang-${lang}`;
    badge.dataset.lang = lang; // for future hooks/telemetry
    badge.title = `${b.code}: ${b.clean} clean, ${b.near} near, ${b.overflow} overflow`;
    badge.textContent = b.code;
    host.appendChild(badge);
  });
}

// Debounced global refresh hook used by tile rendering/analytics modules
window.requestLocaleBadgeRefresh = (function(){ 
  let raf = null;
  return function() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = null;
      renderLocaleBadgeArea();
    });
  };
})();
