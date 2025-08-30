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

  // added by Cascade: update minimal status pill (read-only)
  try {
    const pill = document.getElementById('statusInfoBadge');
    if (pill && analytics) {
      const t = Number(analytics.totalLocales) || 0;
      const c = Number(analytics.cleanCount) || 0;
      const n = Number(analytics.nearLimitCount) || 0;
      const o = Number(analytics.overflowCount) || 0;
      const text = `Locales: ${t} • Clean: ${c} • Near: ${n} • Overflow: ${o}`;
      // Render with semantic spans for conditional colors
      pill.innerHTML = `
        <span class="label">Locales:</span> <span class="count count-locales">${t}</span>
        <span class="dot">•</span>
        <span class="label">Clean:</span> <span class="count count-clean">${c}</span>
        <span class="dot">•</span>
        <span class="label">Near:</span> <span class="count count-near">${n}</span>
        <span class="dot">•</span>
        <span class="label">Overflow:</span> <span class="count count-overflow">${o}</span>
      `;
      pill.title = `Analytics summary — ${text}`;
      pill.setAttribute('aria-label', `Analytics summary. ${t} locales. ${c} clean. ${n} near limit. ${o} overflow.`);
    }
  } catch (_) { /* no-op */ }

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
    // Anchor wrapper for deep linking to the locale section
    const anchor = document.createElement('a');
    const targetId = `locale-${String(b.code).replace(/[^A-Za-z0-9_-]/g, '-')}`;
    anchor.href = `#${targetId}`;
    anchor.className = 'locale-pill-link';
    anchor.addEventListener('click', function(e){
      // Smooth-scroll to the section if present; preserve hash behavior
      const target = document.getElementById(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Optionally focus header for accessibility
        const header = target.querySelector('.locale-header');
        if (header && header.focus) {
          header.setAttribute('tabindex', '-1');
          header.focus({ preventScroll: true });
        }
        // Update hash after scroll
        history.pushState(null, '', `#${targetId}`);
      }
    });

    const badge = document.createElement('span');
    // Reuse existing badge styling; add status as modifier class
    const lang = (b.code || '').split('-')[0].toLowerCase();
    badge.className = `country-badge ${b.status} lang-${lang}`;
    badge.dataset.lang = lang; // for future hooks/telemetry
    badge.title = `${b.code}: ${b.clean} clean, ${b.near} near, ${b.overflow} overflow`;
    badge.textContent = b.code;
    anchor.appendChild(badge);
    host.appendChild(anchor);
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

// ------------------------------
// Locale Presence & Order Validation (Toolbar Badge)
// ------------------------------
// Compares active locales for preview vs. required default set for current template
// Requirements: presence, count, and exact order.
//
(function setupLocaleValidation() {
  let lastValidation = null;
  let lastExpected = [];
  let lastActive = [];

  function normalizeLocale(code) {
    if (!code) return '';
    return /^invariant$/i.test(String(code)) ? 'INVARIANTCULTURE' : String(code).toUpperCase();
  }

  function getExpectedLocales() {
    try {
      const templateKey = (window.templateSystem && typeof window.templateSystem.getCurrentTemplateKey === 'function')
        ? window.templateSystem.getCurrentTemplateKey()
        : 'toh';
      const type = (templateKey === 'mobile-spotlight') ? 'mobile' : 'toh';
      const api = window.TileForgeLocales;
      if (!api || typeof api.getDefaultSet !== 'function') return [];
      return (api.getDefaultSet(type) || []).map(normalizeLocale);
    } catch (_) { return []; }
  }

  function getActiveLocalesSequence() {
    // Prefer dedicated getter if available (source of truth per main.js)
    try {
      if (typeof window.getActiveLocalesForPreview === 'function') {
        return (window.getActiveLocalesForPreview() || []).map(normalizeLocale);
      }
    } catch (_) {}
    // Fallback: derive from currentCsvData in current order
    const rows = (window.currentCsvData && Array.isArray(window.currentCsvData)) ? window.currentCsvData : [];
    return rows.map(r => normalizeLocale(r.Locale || r.locale)).filter(Boolean);
  }

  function validateLocales(activeSeq, expectedSeq) {
    const result = {
      ok: false,
      reason: '',
      missing: [],
      extras: [],
      expectedCount: expectedSeq.length,
      activeCount: activeSeq.length
    };

    // Presence: build sets
    const setExpected = new Set(expectedSeq);
    const setActive = new Set(activeSeq);
    expectedSeq.forEach(loc => { if (!setActive.has(loc)) result.missing.push(loc); });
    activeSeq.forEach(loc => { if (!setExpected.has(loc)) result.extras.push(loc); });

    if (result.missing.length > 0 || result.extras.length > 0) {
      result.reason = 'presence';
      return result;
    }

    // Count must match exactly
    if (activeSeq.length !== expectedSeq.length) {
      result.reason = 'count';
      return result;
    }

    // Exact order check
    for (let i = 0; i < expectedSeq.length; i++) {
      if (activeSeq[i] !== expectedSeq[i]) {
        result.reason = 'order';
        return result;
      }
    }

    result.ok = true;
    return result;
  }

  function renderValidationBadge(validation) {
    const el = document.getElementById('localeValidationBadge');
    if (!el) return;

    if (!validation) {
      el.textContent = '—';
      el.title = 'Locale validation status';
      el.setAttribute('aria-label', 'Locale validation status');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      try { el.style.cursor = 'pointer'; } catch (_) {}
      return;
    }

    // Special handling: no CSV/data loaded -> not an invalid state, just no data yet
    if (validation.reason === 'no-data') {
      el.innerHTML = '<span class="label">Locales:</span> <span class="count">No CSV</span>';
      el.title = 'No CSV loaded. Load a CSV or add locales to validate.';
      el.setAttribute('aria-label', 'Locale validation: no CSV loaded.');
      // Make the pill behave like a button for accessibility
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      try { el.style.cursor = 'pointer'; } catch (_) {}
      // Ensure click opens details explaining the state
      if (!el.dataset.validationBound) {
        el.addEventListener('click', showLocaleValidationDetails);
        el.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showLocaleValidationDetails(); } });
        el.dataset.validationBound = '1';
      }
      return;
    }

    if (validation.ok) {
      el.innerHTML = '<span class="label">Locales:</span> <span class="count">Valid</span>';
      el.title = `All ${validation.expectedCount} locales present in exact order`;
      el.setAttribute('aria-label', `Locale validation: valid. All ${validation.expectedCount} locales present in exact order.`);
    } else {
      let msg = '';
      if (validation.reason === 'presence') {
        const miss = validation.missing.slice(0, 4).join(', ');
        const extra = validation.extras.slice(0, 4).join(', ');
        msg = `Missing: ${validation.missing.length}${miss ? ` (${miss}${validation.missing.length > 4 ? ', …' : ''})` : ''}` +
              (validation.extras.length ? ` • Extras: ${validation.extras.length}${extra ? ` (${extra}${validation.extras.length > 4 ? ', …' : ''})` : ''}` : '');
      } else if (validation.reason === 'count') {
        msg = `Expected ${validation.expectedCount}, found ${validation.activeCount}`;
      } else if (validation.reason === 'order') {
        msg = 'Order mismatch';
      } else {
        msg = 'Invalid';
      }
      el.innerHTML = `<span class="label">Locales:</span> <span class="count">Invalid</span>`;
      el.title = msg;
      el.setAttribute('aria-label', `Locale validation: invalid. ${msg}`);
    }

    // Make the pill behave like a button for accessibility
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    try { el.style.cursor = 'pointer'; } catch (_) {}

    // Bind click/keyboard once
    if (!el.dataset.validationBound) {
      el.addEventListener('click', showLocaleValidationDetails);
      el.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showLocaleValidationDetails();
        }
      });
      el.dataset.validationBound = '1';
    }
  }

  function runLocaleValidation() {
    try {
      const expected = getExpectedLocales();
      const active = getActiveLocalesSequence();
      const noCsvLoaded = !(window.currentCsvData && Array.isArray(window.currentCsvData) && window.currentCsvData.length);

      // If no CSV is loaded and no active locales are present, report a 'no-data' state instead of 'Invalid'
      if (noCsvLoaded && active.length === 0) {
        const result = { ok: false, reason: 'no-data', missing: [], extras: [], expectedCount: expected.length, activeCount: 0 };
        lastExpected = expected;
        lastActive = active;
        lastValidation = result;
        renderValidationBadge(result);
        return;
      }

      const result = validateLocales(active, expected);
      lastExpected = expected;
      lastActive = active;
      lastValidation = result;
      renderValidationBadge(result);
    } catch (_) {
      renderValidationBadge(null);
    }
  }

  function showLocaleValidationDetails() {
    // Build detail content from lastValidation/lastExpected/lastActive
    const v = lastValidation;
    const expected = lastExpected || [];
    const active = lastActive || [];

    // If validation hasn't run yet, use Modal system for the notice
    if (!v) {
      if (window.Modal && typeof window.Modal.alert === 'function') {
        window.Modal.alert('Locale validation has not run yet.', 'info');
      }
      return;
    }

    const reasonText = v.ok ? 'Valid' : (v.reason === 'no-data' ? 'No CSV loaded' : (v.reason === 'presence' ? 'Missing or extra locales' : v.reason === 'count' ? 'Count mismatch' : v.reason === 'order' ? 'Order mismatch' : 'Invalid'));
    // Map status to existing visual classes
    const statusClass = v.ok
      ? 'file-status success clean'
      : (v.reason === 'no-data' ? 'file-status' : (v.reason === 'presence' ? 'file-status error' : (v.reason === 'count' || v.reason === 'order') ? 'file-status warning' : 'file-status'));
    const statusIcon = v.ok ? '✅' : (v.reason === 'no-data' ? 'ℹ️' : (v.reason === 'order' ? '↕️' : v.reason === 'count' ? '🔢' : '⚠️'));
    const noDataCta = (v.reason === 'no-data') ? `
      <div class="no-data-cta" role="region" aria-label="No data actions">
        <p>Load a CSV to validate locales.</p>
        <button id="loadCsvNowBtn" class="modal-btn primary">Load CSV…</button>
      </div>
    ` : '';
    // Compute membership sets for per-item coloring
    const setExpected = new Set(expected);
    const setActive = new Set(active);
    const listHtml = (arr, column) => Array.isArray(arr)
      ? arr.map(l => {
          const code = String(l);
          let extraCls = '';
          if (column === 'expected') {
            // Missing from active -> red; present in both -> green
            extraCls = setActive.has(code) ? 'clean' : 'overflow';
          } else if (column === 'active') {
            // Extra in active -> yellow; present in both -> green
            extraCls = setExpected.has(code) ? 'clean' : 'warning';
          }
          return `<li><span class="country-badge ${extraCls}">${escapeHtml(code)}</span></li>`;
        }).join('')
      : '';
    const orderTable = (!v.ok && v.reason === 'order') ? `
      <h5>Order Comparison</h5>
      <table aria-label="Locale order comparison">
        <thead><tr><th>#</th><th>Expected</th><th>Active</th></tr></thead>
        <tbody>${Array.from({ length: Math.max(expected.length, active.length) }, (_, i) => {
          const eLoc = expected[i] || '';
          const aLoc = active[i] || '';
          const isMismatch = eLoc !== aLoc;
          const rowCls = isMismatch ? ' class="warning"' : '';
          const activeBadgeCls = isMismatch ? 'warning' : 'clean';
          return `
            <tr${rowCls}>
              <td>${i + 1}</td>
              <td><span class="country-badge clean">${escapeHtml(eLoc)}</span></td>
              <td><span class="country-badge ${activeBadgeCls}">${escapeHtml(aLoc)}</span></td>
            </tr>
          `;
        }).join('')}</tbody>
      </table>
    ` : '';
    const presenceBlocks = (!v.ok && v.reason === 'presence') ? `
       <div>
         <h5>Missing (${(v.missing || []).length})</h5>
         <ul>${Array.isArray(v.missing) ? v.missing.map(l => `<li><span class="country-badge overflow">${escapeHtml(l)}</span></li>`).join('') : ''}</ul>
       </div>
       ${(v.extras && v.extras.length) ? `<div><h5>Extras (${v.extras.length})</h5><ul>${v.extras.map(l => `<li><span class=\"country-badge warning\">${escapeHtml(l)}</span></li>`).join('')}</ul></div>` : ''}
     ` : '';
    const expectedBlock = `
       <details open>
         <summary><strong>Expected (${expected.length})</strong></summary>
         <ol class="tf-two-col-list">${listHtml(expected, 'expected')}</ol>
       </details>
     `;
    const activeBlock = `
       <details open>
         <summary><strong>Active (${active.length})</strong></summary>
         <ol class="tf-two-col-list">${listHtml(active, 'active')}</ol>
       </details>
     `;
    const bodyHtml = `
      <div class="validation-details">
        <div class="${statusClass}" aria-live="polite">${statusIcon} ${escapeHtml(reasonText)}</div>
        ${!v.ok && v.reason === 'count' ? `<p class="warning"><strong>Count:</strong> Expected ${v.expectedCount}, found ${v.activeCount}</p>` : ''}
        ${presenceBlocks}
        ${orderTable}
        <hr/>
        <div class="tf-compare-grid">
          ${expectedBlock}
          ${v.reason === 'no-data' ? '' : activeBlock}
        </div>
        ${noDataCta}
      </div>
    `;

    // Prefer tabbed modal API with a single tab
    if (window.Modal && typeof window.Modal.createTabbedModal === 'function') {
      const modal = window.Modal.createTabbedModal({
        title: 'Locale Validation Details',
        size: 'large',
        tabs: [
          { title: 'Summary', icon: '🧩', content: bodyHtml }
        ],
        activeTab: 0
      });
      modal.show();
      // Helper to (re)wire the CTA and allow CSV browsing
      function wireNoDataCta() {
        const btn = document.getElementById('loadCsvNowBtn');
        if (btn) {
          btn.addEventListener('click', () => {
            try {
              if (typeof window.getOrCreateCsvInput === 'function') {
                const input = window.getOrCreateCsvInput();
                if (input && input.click) input.click();
              }
            } catch (_) {}
          }, { once: true });
        }
      }
      // Initial wire after render
      setTimeout(wireNoDataCta, 0);
      // Live update details when CSV loads while modal is open
      function onCsvProcessed() {
        // Recompute HTML using current state
        try {
          runLocaleValidation(); // refresh lastValidation/expected/active
          const container = document.querySelector('.modal .validation-details');
          if (!container) return;
          // Rebuild the same blocks with latest 'v', 'expected', 'active'
          const v2 = lastValidation;
          const expected2 = lastExpected || [];
          const active2 = lastActive || [];
          const reasonText2 = v2.ok ? 'Valid' : (v2.reason === 'no-data' ? 'No CSV loaded' : (v2.reason === 'presence' ? 'Missing or extra locales' : v2.reason === 'count' ? 'Count mismatch' : v2.reason === 'order' ? 'Order mismatch' : 'Invalid'));
          const statusClass2 = v2.ok ? 'file-status success clean' : (v2.reason === 'no-data' ? 'file-status' : (v2.reason === 'presence' ? 'file-status error' : (v2.reason === 'count' || v2.reason === 'order') ? 'file-status warning' : 'file-status'));
          const statusIcon2 = v2.ok ? '✅' : (v2.reason === 'no-data' ? 'ℹ️' : (v2.reason === 'order' ? '↕️' : v2.reason === 'count' ? '🔢' : '⚠️'));
          const noDataCta2 = (v2.reason === 'no-data') ? `
            <div class="no-data-cta" role="region" aria-label="No data actions">
              <p>Load a CSV to validate locales.</p>
              <button id="loadCsvNowBtn" class="modal-btn primary">Load CSV…</button>
            </div>
          ` : '';
          // Live path: recompute sets for coloring
          const setExpected2 = new Set(expected2);
          const setActive2 = new Set(active2);
          const listHtml2 = (arr, column) => Array.isArray(arr)
            ? arr.map(l => {
                const code = String(l);
                let extraCls = '';
                if (column === 'expected') {
                  extraCls = setActive2.has(code) ? 'clean' : 'overflow';
                } else if (column === 'active') {
                  extraCls = setExpected2.has(code) ? 'clean' : 'warning';
                }
                return `<li><span class="country-badge ${extraCls}">${escapeHtml(code)}</span></li>`;
              }).join('')
            : '';
          const orderTable2 = (!v2.ok && v2.reason === 'order') ? `
            <h5>Order Comparison</h5>
            <table aria-label="Locale order comparison">
              <thead><tr><th>#</th><th>Expected</th><th>Active</th></tr></thead>
              <tbody>${Array.from({ length: Math.max(expected2.length, active2.length) }, (_, i) => {
                const eLoc = expected2[i] || '';
                const aLoc = active2[i] || '';
                const isMismatch = eLoc !== aLoc;
                const rowCls = isMismatch ? ' class="warning"' : '';
                const activeBadgeCls = isMismatch ? 'warning' : 'clean';
                return `
                  <tr${rowCls}>
                    <td>${i + 1}</td>
                    <td><span class="country-badge clean">${escapeHtml(eLoc)}</span></td>
                    <td><span class="country-badge ${activeBadgeCls}">${escapeHtml(aLoc)}</span></td>
                  </tr>
                `;
              }).join('')}</tbody>
            </table>
          ` : '';
          const presenceBlocks2 = (!v2.ok && v2.reason === 'presence') ? `
             <div>
               <h5>Missing (${(v2.missing || []).length})</h5>
               <ul>${Array.isArray(v2.missing) ? v2.missing.map(l => `<li><span class="country-badge overflow">${escapeHtml(l)}</span></li>`).join('') : ''}</ul>
             </div>
             ${(v2.extras && v2.extras.length) ? `<div><h5>Extras (${v2.extras.length})</h5><ul>${v2.extras.map(l => `<li><span class=\"country-badge warning\">${escapeHtml(l)}</span></li>`).join('')}</ul></div>` : ''}
           ` : '';
          const expectedBlock2 = `
             <details open>
               <summary><strong>Expected (${expected2.length})</strong></summary>
               <ol class="tf-two-col-list">${listHtml2(expected2, 'expected')}</ol>
             </details>
           `;
          const activeBlock2 = `
             <details open>
               <summary><strong>Active (${active2.length})</strong></summary>
               <ol class="tf-two-col-list">${listHtml2(active2, 'active')}</ol>
             </details>
           `;
          const bodyHtml2 = `
            <div class="validation-details">
              <div class="${statusClass2}" aria-live="polite">${statusIcon2} ${escapeHtml(reasonText2)}</div>
              ${!v2.ok && v2.reason === 'count' ? `<p class="warning"><strong>Count:</strong> Expected ${v2.expectedCount}, found ${v2.activeCount}</p>` : ''}
              ${presenceBlocks2}
              ${orderTable2}
              <hr/>
              <div class="tf-compare-grid">
                ${expectedBlock2}
                ${v2.reason === 'no-data' ? '' : activeBlock2}
              </div>
              ${noDataCta2}
            </div>
          `;
          // Replace details content
          const root = container.parentElement || container;
          root.innerHTML = bodyHtml2;
          // Re-wire CTA if still in no-data state
          wireNoDataCta();
        } catch (_) { /* no-op */ }
      }
      document.addEventListener('tf:csvProcessed', onCsvProcessed);
      return;
    }
    // Fallback to generic modal API
    if (window.Modal && typeof window.Modal.create === 'function') {
      const m = window.Modal.create({ title: 'Locale Validation Details', size: 'large' });
      m.setBody(bodyHtml);
      m.setButtons([{ label: 'Close', role: 'primary' }]);
      m.show();
      function wireNoDataCta() {
        const btn = document.getElementById('loadCsvNowBtn');
        if (btn) {
          btn.addEventListener('click', () => {
            try {
              if (typeof window.getOrCreateCsvInput === 'function') {
                const input = window.getOrCreateCsvInput();
                if (input && input.click) input.click();
              }
            } catch (_) {}
          }, { once: true });
        }
      }
      setTimeout(wireNoDataCta, 0);
      function onCsvProcessed() {
        try {
          runLocaleValidation();
          const container = document.querySelector('.modal .validation-details');
          if (!container) return;
          const v2 = lastValidation;
          const expected2 = lastExpected || [];
          const active2 = lastActive || [];
          const reasonText2 = v2.ok ? 'Valid' : (v2.reason === 'no-data' ? 'No CSV loaded' : (v2.reason === 'presence' ? 'Missing or extra locales' : v2.reason === 'count' ? 'Count mismatch' : v2.reason === 'order' ? 'Order mismatch' : 'Invalid'));
          const statusClass2 = v2.ok ? 'file-status success clean' : (v2.reason === 'no-data' ? 'file-status' : (v2.reason === 'presence' ? 'file-status error' : (v2.reason === 'count' || v2.reason === 'order') ? 'file-status warning' : 'file-status'));
          const statusIcon2 = v2.ok ? '✅' : (v2.reason === 'no-data' ? 'ℹ️' : (v2.reason === 'order' ? '↕️' : v2.reason === 'count' ? '🔢' : '⚠️'));
          const noDataCta2 = (v2.reason === 'no-data') ? `
            <div class="no-data-cta" role="region" aria-label="No data actions">
              <p>Load a CSV to validate locales.</p>
              <button id="loadCsvNowBtn" class="modal-btn primary">Load CSV…</button>
            </div>
          ` : '';
          const listHtml2 = (arr, badgeCls = '') => Array.isArray(arr) ? arr.map(l => `<li><span class="country-badge ${badgeCls}">${escapeHtml(l)}</span></li>`).join('') : '';
          const orderTable2 = (!v2.ok && v2.reason === 'order') ? `
            <h5>Order Comparison</h5>
            <table aria-label="Locale order comparison">
              <thead><tr><th>#</th><th>Expected</th><th>Active</th></tr></thead>
              <tbody>${Array.from({ length: Math.max(expected2.length, active2.length) }, (_, i) => {
                const eLoc = expected2[i] || '';
                const aLoc = active2[i] || '';
                const isMismatch = eLoc !== aLoc;
                const rowCls = isMismatch ? ' class="warning"' : '';
                const activeBadgeCls = isMismatch ? 'warning' : 'clean';
                return `
                  <tr${rowCls}>
                    <td>${i + 1}</td>
                    <td><span class="country-badge clean">${escapeHtml(eLoc)}</span></td>
                    <td><span class="country-badge ${activeBadgeCls}">${escapeHtml(aLoc)}</span></td>
                  </tr>
                `;
              }).join('')}</tbody>
            </table>
          ` : '';
          const presenceBlocks2 = (!v2.ok && v2.reason === 'presence') ? `
             <div>
               <h5>Missing (${(v2.missing || []).length})</h5>
               <ul>${listHtml2(v2.missing, 'overflow')}</ul>
             </div>
             ${(v2.extras && v2.extras.length) ? `<div><h5>Extras (${v2.extras.length})</h5><ul>${listHtml2(v2.extras, 'warning')}</ul></div>` : ''}
           ` : '';
          const expectedBlock2 = `
             <details open>
               <summary><strong>Expected (${expected2.length})</strong></summary>
               <ol class="tf-two-col-list">${listHtml2(expected2, 'clean')}</ol>
             </details>
           `;
          const activeBlock2 = `
             <details open>
               <summary><strong>Active (${active2.length})</strong></summary>
               <ol class="tf-two-col-list">${listHtml2(active2)}</ol>
             </details>
           `;
          const bodyHtml2 = `
            <div class="validation-details">
              <div class="${statusClass2}" aria-live="polite">${statusIcon2} ${escapeHtml(reasonText2)}</div>
              ${!v2.ok && v2.reason === 'count' ? `<p class="warning"><strong>Count:</strong> Expected ${v2.expectedCount}, found ${v2.activeCount}</p>` : ''}
              ${presenceBlocks2}
              ${orderTable2}
              <hr/>
              <div class="tf-compare-grid">
                ${expectedBlock2}
                ${v2.reason === 'no-data' ? '' : activeBlock2}
              </div>
              ${noDataCta2}
            </div>
          `;
          const root = container.parentElement || container;
          root.innerHTML = bodyHtml2;
          wireNoDataCta();
        } catch (_) { /* no-op */ }
      }
      document.addEventListener('tf:csvProcessed', onCsvProcessed);
      return;
    }
    // Last resort within Modal system
    if (window.Modal && typeof window.Modal.alert === 'function') {
      window.Modal.alert(reasonText, v.ok ? 'success' : 'warning');
    }
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

  // Hook up events: CSV processed, template switch, locales changed
  document.addEventListener('tf:csvProcessed', runLocaleValidation);
  document.addEventListener('tf:templateSwitched', runLocaleValidation);
  document.addEventListener('tf:localesChanged', runLocaleValidation);

  // Also run once on DOM ready (in case default data loads later)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runLocaleValidation);
  } else {
    runLocaleValidation();
  }
})();
