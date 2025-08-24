// CSV QuickLook ("GridPeek"): lightweight modal table viewer for the currently loaded dataset
// Reuses existing ModalSystem (lab/TileForge/js/modal.js)
// No new globals beyond window.GridPeek; integrates with existing CSV state accessors

(function(){
  const TOOL_NAME = 'GridPeek'; // cool, short, descriptive

  // Attempts to read current rows/columns from existing app state.
  // We avoid tight coupling: prefer accessor functions if present.
  function getActiveData() {
    try {
      if (window.getActiveCsvData && typeof window.getActiveCsvData === 'function') {
        return window.getActiveCsvData(); // expected shape: { rows: Array<Object>, headers?: Array<string> }
      }
      // Fallbacks commonly used in TileForge
      if (window.currentCsvData && Array.isArray(window.currentCsvData)) {
        return { rows: window.currentCsvData };
      }
      if (window.activeProject && Array.isArray(window.activeProject.rows)) {
        return { rows: window.activeProject.rows, headers: window.activeProject.headers };
      }
    } catch (e) {
      console.warn('[GridPeek] Failed to fetch active data', e);
    }
    return { rows: [] };
  }

  function inferHeaders(rows, provided) {
    if (Array.isArray(provided) && provided.length) return provided;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    // Merge keys from first few rows for robustness
    const keys = new Set();
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const r = rows[i];
      if (r && typeof r === 'object') Object.keys(r).forEach(k => keys.add(k));
    }
    return Array.from(keys);
  }

  function escapeHtml(str){
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function buildTableHTML(headers, rows) {
    if (!headers.length) {
      return '<div class="empty-state"><i class="fas fa-table"></i><p>No CSV data loaded.</p><small>Load CSV/XML/JSON to preview rows here.</small></div>';
    }

    // Limit rows in initial render for performance; allow paging controls in v2
    const maxPreview = 200;
    const slice = rows.slice(0, maxPreview);

    const thead = `
      <thead>
        <tr>
          ${headers.map(h => `<th title="${escapeHtml(h)}">${escapeHtml(h)}</th>`).join('')}
        </tr>
      </thead>`;

    const tbody = `
      <tbody>
        ${slice.map(r => `
          <tr>
            ${headers.map(h => `<td>${escapeHtml(r && r[h] !== undefined ? r[h] : '')}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>`;

    const footerInfo = rows.length > maxPreview
      ? `<div class="table-footnote">Showing first ${maxPreview} of ${rows.length} rows</div>`
      : '';

    return `
      <div class="gridpeek-wrap">
        <div class="gridpeek-meta">
          <span class="meta-item"><i class="fas fa-database"></i> Rows: ${rows.length}</span>
          <span class="meta-item"><i class="fas fa-columns"></i> Columns: ${headers.length}</span>
        </div>
        <div class="preview-table-wrapper">
          <table class="preview-table">
            ${thead}
            ${tbody}
          </table>
        </div>
        ${footerInfo}
      </div>`;
  }

  function openCsvViewer() {
    const { rows, headers: provided } = getActiveData();
    const headers = inferHeaders(rows, provided);

    const content = buildTableHTML(headers, rows);

    const m = window.Modal.createModal({
      title: `${TOOL_NAME} — CSV Preview`,
      content,
      size: 'large',
      buttons: [
        { text: 'Close', class: 'secondary', action: 'close' }
      ]
    });
    m.show();
  }

  // Public API
  window.GridPeek = {
    open: openCsvViewer
  };

  // Optional: hook up buttons if present
  document.addEventListener('DOMContentLoaded', () => {
    const projBtn = document.getElementById('csvQuickViewBtn');
    if (projBtn) projBtn.addEventListener('click', openCsvViewer);
    const toolbarBtn = document.getElementById('toolbarCsvQuickViewBtn');
    if (toolbarBtn) toolbarBtn.addEventListener('click', openCsvViewer);
  });
})();
