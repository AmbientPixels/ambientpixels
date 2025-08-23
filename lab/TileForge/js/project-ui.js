// project-ui.js
// UI for managing TileForge Projects (uses ProjectStore)

(function(){
  const state = {
    currentProject: null, // { id, name }
    expandedFilesPanels: new Set(), /* updated by Cascade: preserve expanded state */
  };

  // Modal helpers (replace browser dialogs)
  function alertModal(message, type = 'info', title = null) {
    if (window.Modal && typeof Modal.alert === 'function') {
      Modal.alert(message, type, title);
    } else {
      window.alert(message);
    }
  }

  function downloadTextFile(filename, text, mime) {
    try {
      const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'download.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alertModal('Failed to export file', 'error');
    }
  }

  function collectLocalesFromRows(rows) {
    if (!Array.isArray(rows)) return [];
    const set = new Set();
    rows.forEach(r => {
      const loc = r.Locale || r.locale;
      if (loc) set.add(loc);
    });
    return Array.from(set).sort();
  }

  function mergeLocalesIntoRows(selectedLocales, baseRows) {
    const rows = Array.isArray(baseRows) ? [...baseRows] : [];
    const hasLocale = (rows, loc) => rows.some(r => (r.Locale || r.locale) === loc);
    selectedLocales.forEach(loc => {
      if (!hasLocale(rows, loc)) {
        rows.push({ Locale: loc, 'items/0/title': '', 'items/0/subtitle': '', 'items/0/narratorText': '' });
      }
    });
    return rows;
  }

  async function onManageLocales(projectId) {
    try {
      if (!window.TileForgeLocalesUI || typeof window.TileForgeLocalesUI.open !== 'function') {
        return alertModal('Locale Picker UI not loaded.', 'warning');
      }
      // Preselect from current working data
      const preselect = collectLocalesFromRows(window.currentCsvData);
      window.TileForgeLocalesUI.open(function(selectedLocales) {
        // Merge selected locales into working set
        const merged = mergeLocalesIntoRows(selectedLocales, window.currentCsvData);
        window.currentCsvData = merged;
        // Persist as a new CSV instance in the project and set active
        (async () => {
          try {
            const proj = await ProjectStore.get(projectId);
            if (!proj || !proj.data) throw new Error('Project not found');
            const csvs = Array.isArray(proj.data.csvs) ? proj.data.csvs : (proj.data.csvs = []);
            // Ask user for the CSV name (default suggested)
            const stamp = new Date();
            const pad = (n)=> String(n).padStart(2,'0');
            const defaultName = `locales-${stamp.getFullYear()}${pad(stamp.getMonth()+1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.csv`;
            let inputName = await promptAsync('Name your new CSV', defaultName, { title: 'New CSV Name' }).catch(() => null);
            if (!inputName) return; // user canceled
            inputName = inputName.trim();
            if (!inputName.toLowerCase().endsWith('.csv')) inputName += '.csv';
            // Ensure unique name within project
            const existing = new Set(csvs.map(c => c.name.toLowerCase()));
            let name = inputName;
            if (existing.has(name.toLowerCase())) {
              const base = name.replace(/\.csv$/i, '');
              let i = 1;
              while (existing.has(`${base}-${i}.csv`.toLowerCase())) i++;
              name = `${base}-${i}.csv`;
            }
            csvs.push({ name, rows: merged });
            // Serialize merged rows to stored file shape expected by loader
            // Loader expects entries like { name, text }
            let storedEntry;
            if (typeof generateCSVContent === 'function') {
              const text = generateCSVContent(merged);
              storedEntry = { name, text };
            } else {
              // Fallback: store JSON if CSV generator not present
              const jsonName = name.replace(/\.csv$/i, '.json');
              storedEntry = { name: jsonName, text: JSON.stringify(merged) };
            }
            // Replace the provisional push with the proper entry
            csvs.pop();
            csvs.push(storedEntry);
            proj.data.activeCsv = storedEntry.name; /* updated by Cascade */
            await ProjectStore.update(proj.id, proj);
            // Refresh UI list and load the new active file to reflect immediately
            if (typeof refreshList === 'function') refreshList();
            if (typeof onSetActiveFile === 'function') onSetActiveFile(proj.id, storedEntry.name);
            if (typeof window.setActiveLocalesForPreview === 'function') {
              window.setActiveLocalesForPreview(selectedLocales);
            }
            if (typeof window.renderLocaleGroups === 'function') {
              window.renderLocaleGroups(merged);
            }
            if (window.showToast) window.showToast(`Created new CSV "${name}" and set active`, 'success');
          } catch (err) {
            console.error(err);
            alertModal('Failed to create CSV for selected locales', 'error');
          }
        })();
      }, preselect);
    } catch (e) {
      console.error(e);
      alertModal('Failed to manage locales', 'error');
    }
  }

  function confirmAsync(message, options = {}) {
    return new Promise(resolve => {
      if (window.Modal && typeof Modal.confirm === 'function') {
        const modal = Modal.confirm({
          content: message,
          ...options,
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false)
        });
        modal.show();
      } else {
        resolve(window.confirm(message));
      }
    });
  }

  function promptAsync(message, defaultValue = '', options = {}) {
    return new Promise((resolve, reject) => {
      if (window.Modal && typeof Modal.prompt === 'function') {
        const modal = Modal.prompt({
          title: options.title || 'Input Required',
          message,
          defaultValue,
          onConfirm: (val) => resolve(val),
          onCancel: () => reject(new Error('Canceled')),
        });
        modal.show();
      } else {
        const v = window.prompt(message, defaultValue);
        if (v === null) reject(new Error('Canceled')); else resolve(v);
      }
    });
  }

  function getCurrentTemplate() {
    const active = document.querySelector('.template-option.active');
    return active ? active.getAttribute('data-template') : 'toh';
  }

  function getEnabledSections() {
    const checks = document.querySelectorAll('.section-enabled');
    const result = {};
    checks.forEach(chk => {
      const key = chk.getAttribute('data-target');
      result[key] = chk.checked;
    });
    return result;
  }

  function buildSnapshotFromUI() {
    const data = {
      csvs: [],
      activeCsv: 'current.csv',
      image: null, // future: capture uploaded image if available
      template: getCurrentTemplate(),
      settings: {
        enabledSections: getEnabledSections(),
      }
    };
    // Serialize currentCsvData as single csv entry
    if (Array.isArray(window.currentCsvData) && window.currentCsvData.length) {
      if (typeof generateCSVContent === 'function') {
        const csvText = generateCSVContent(window.currentCsvData);
        data.csvs.push({ name: 'current.csv', text: csvText });
      } else {
        // fallback: store as JSON
        data.csvs.push({ name: 'current.json', text: JSON.stringify(window.currentCsvData) });
        data.activeCsv = 'current.json';
      }
    }
    return data;
  }

  function loadSnapshotIntoUI(project) {
    try {
      const data = project.data || {};
      // Load CSV into currentCsvData
      const active = data.activeCsv || (data.csvs && data.csvs[0] && data.csvs[0].name);
      let csvRows = [];
      if (active && Array.isArray(data.csvs)) {
        const entry = data.csvs.find(f => f.name === active) || data.csvs[0];
        if (entry) {
          if (entry.name.endsWith('.csv')) {
            // Parse CSV quickly via existing CSV loader if present
            if (typeof window.processCsvText === 'function') {
              csvRows = window.processCsvText(entry.text);
            } else {
              // Very basic CSV parser for fallback
              csvRows = fallbackParseCSV(entry.text);
            }
          } else if (entry.name.endsWith('.json')) {
            csvRows = JSON.parse(entry.text);
          }
        }
      }
      if (Array.isArray(csvRows)) {
        window.currentCsvData = csvRows;
        if (typeof renderLocaleGroups === 'function') renderLocaleGroups(csvRows);
        // Reflect active CSV into the localized preview status pill
        try {
          const activeName = active || '';
          if (typeof updateFileInfo === 'function' && activeName) {
            updateFileInfo('CSV', activeName, csvRows.length || 0);
          } else {
            const nameEl = document.getElementById('activeCsvName');
            if (nameEl) {
              nameEl.textContent = activeName || '—';
              const pill = nameEl.parentElement; if (pill && pill.setAttribute) pill.setAttribute('title', activeName ? `Currently active CSV: ${activeName}` : 'No active CSV selected');
            }
          }
          // Ensure localized export button reflects data availability
          if (typeof updateLocalizedExportState === 'function') {
            updateLocalizedExportState(Array.isArray(csvRows) && csvRows.length > 0);
          }
        } catch (e) { /* no-op */ }
      }

      // Apply template selection visually
      const activeTpl = data.template || 'toh';
      document.querySelectorAll('.template-option').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-template') === activeTpl);
      });

      // Apply enabled sections
      const settings = data.settings || {};
      const enabled = settings.enabledSections || {};
      document.querySelectorAll('.section-enabled').forEach(chk => {
        const key = chk.getAttribute('data-target');
        if (key in enabled) chk.checked = !!enabled[key];
      });
    } catch (e) {
      console.error('Failed to load project into UI', e);
      alertModal('Failed to load project. See console for details.', 'error');
    }
  }

  function fallbackParseCSV(text) {
    // Very minimal CSV -> rows of objects using first row as headers
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, ''));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const obj = {};
      headers.forEach((h, idx) => obj[h] = cols[idx] || '');
      rows.push(obj);
    }
    return rows;
  }

  function parseCsvLine(line) {
    const result = [];
    let i = 0, cur = '', inQ = false;
    while (i < line.length) {
      const ch = line[i++];
      if (inQ) {
        if (ch === '"') {
          if (line[i] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === ',') { result.push(cur); cur = ''; }
        else if (ch === '"') { inQ = true; }
        else cur += ch;
      }
    }
    result.push(cur);
    return result;
  }

  async function ensureProjectContext() {
    if (state.currentProject && state.currentProject.id) return state.currentProject;
    const name = await promptAsync('Project name:');
    if (!name) throw new Error('Canceled');
    const description = await promptAsync('Short description (optional):', '');
    const rec = await window.ProjectStore.create(name, buildSnapshotFromUI(), description || '');
    state.currentProject = { id: rec.id, name: rec.name };
    refreshList();
    return state.currentProject;
  }

  async function onNew() {
    const choice = await confirmAsync('Create a new project from current state? (OK = from current, Cancel = blank)');
    const name = await promptAsync('New project name:');
    if (!name) return;
    const description = await promptAsync('Short description (optional):', '');
    const data = choice ? buildSnapshotFromUI() : { csvs: [], activeCsv: null, image: null, template: 'toh', settings: { enabledSections: { title: true, subtitle: true, narrator: true } } };
    const rec = await ProjectStore.create(name, data, description || '');
    state.currentProject = { id: rec.id, name: rec.name };
    refreshList();
    alertModal('Project created', 'success');
  }

  async function onSave() {
    try {
      const ctx = await ensureProjectContext();
      // Load existing project to preserve current files and active CSV name
      const proj = await ProjectStore.get(ctx.id);
      if (!proj) throw new Error('Project not found');

      // Determine working rows and active file name
      const workingRows = Array.isArray(window.currentCsvData) ? window.currentCsvData : [];
      let activeName = (proj.data && (proj.data.activeCsv || (proj.data.csvs && proj.data.csvs[0] && proj.data.csvs[0].name))) || 'current.csv';

      // Ensure data structure exists
      proj.data = proj.data || { csvs: [], activeCsv: activeName, image: null, template: 'toh', settings: {} };

      // Update template and enabled sections from current UI state
      proj.data.template = getCurrentTemplate();
      proj.data.settings = proj.data.settings || {};
      proj.data.settings.enabledSections = getEnabledSections();

      // Generate file text based on available generator
      let entryName = activeName;
      let entryText = '';
      const hasCsvGen = (typeof generateCSVContent === 'function');
      if (hasCsvGen) {
        entryText = generateCSVContent(workingRows);
        // Prefer .csv extension when we can generate CSV
        if (!/\.csv$/i.test(entryName)) entryName = entryName.replace(/\.json$/i, '.csv');
      } else {
        entryText = JSON.stringify(workingRows);
        // Fallback to .json when CSV generator is unavailable
        if (!/\.json$/i.test(entryName)) entryName = entryName.replace(/\.csv$/i, '.json');
      }

      // Find existing active entry and update, or add a new one
      const csvs = Array.isArray(proj.data.csvs) ? proj.data.csvs : (proj.data.csvs = []);
      const idx = csvs.findIndex(f => f.name === entryName);
      if (idx >= 0) {
        csvs[idx].text = entryText;
      } else {
        csvs.push({ name: entryName, text: entryText });
      }
      proj.data.activeCsv = entryName;

      // Persist changes without renaming files
      await ProjectStore.saveSnapshot(ctx.id, proj.data);
      refreshList();
      if (window.showToast) window.showToast('Project saved', 'success'); else alertModal('Project saved', 'success');
    } catch (e) {
      if (e && e.message === 'Canceled') return;
      console.error(e);
      alertModal('Save failed', 'error');
    }
  }

  async function onClone(projectId) {
    // If a specific projectId is provided (from list action), clone that project.
    if (projectId) {
      const proj = await ProjectStore.get(projectId);
      if (!proj) return;
      const newName = await promptAsync('Name for cloned project:', (proj.name || 'Project') + ' (Copy)');
      if (!newName) return;
      const rec = await ProjectStore.clone(projectId, newName);
      state.currentProject = { id: rec.id, name: rec.name };
      refreshList();
      alertModal('Project cloned', 'success');
      return;
    }
    // Otherwise, preserve prior behavior: clone current project or state
    if (!state.currentProject) {
      // allow clone from current state into a newly named project
      const name = await promptAsync('Clone to new project name:');
      if (!name) return;
      const rec = await ProjectStore.create(name, buildSnapshotFromUI());
      state.currentProject = { id: rec.id, name: rec.name };
      refreshList();
      alertModal('Cloned to new project', 'success');
      return;
    }
    const newName = await promptAsync('Name for cloned project:', state.currentProject.name + ' (Copy)');
    if (!newName) return;
    const rec = await ProjectStore.clone(state.currentProject.id, newName);
    state.currentProject = { id: rec.id, name: rec.name };
    refreshList();
    alertModal('Project cloned', 'success');
  }


  async function refreshList() {
    const listEl = document.getElementById('projectsList');
    if (!listEl) return;
    const items = await ProjectStore.list();
    listEl.innerHTML = items.map(p => {
      const isActive = state.currentProject && state.currentProject.id === p.id;
      const date = new Date(p.updatedAt || p.createdAt).toLocaleString();
      const fileCount = (p.data && Array.isArray(p.data.csvs)) ? p.data.csvs.length : 0;
      const activeCsv = p.data && p.data.activeCsv ? p.data.activeCsv : (fileCount && p.data.csvs[0].name) || '';
      const isExpanded = state.expandedFilesPanels.has(p.id);
      return `
        <div class="project-item${isActive ? ' active' : ''}">
          <div class="project-meta">
            <div class="project-name">${p.name}</div>
            <div class="project-desc">${p.description || ''}</div>
            <div class="project-date">${date}</div>
          </div>
          <div class="project-actions">
            <button class="preset-apply-btn" data-act="load" data-id="${p.id}">Load</button>
            <button class="preset-apply-btn" data-act="clone" data-id="${p.id}">Clone</button>
            <button class="preset-apply-btn" data-act="delete" data-id="${p.id}">Delete</button>
            <button class="files-toggle" data-act="toggle-files" data-id="${p.id}" aria-expanded="${isExpanded}"><span class="chev">${isExpanded ? '▼' : '►'}</span> Files (${fileCount})</button>
          </div>
          <div class="project-files" data-files-for="${p.id}" style="display:${isExpanded ? 'block' : 'none'};">
            <div class="project-files-header">
              <div class="project-files-actions">
                <button class="preset-apply-btn" data-act="add-file" data-id="${p.id}">Add CSV</button>
                <button class="preset-apply-btn" data-act="manage-locales" data-id="${p.id}">Create New</button>
                <button class="preset-apply-btn btn-export-active" data-act="export-active" data-id="${p.id}"><i class="fa fa-download" aria-hidden="true"></i><span class="label">Export Active</span></button>
              </div>
            </div>
            <div class="project-files-list">
              ${(p.data?.csvs || []).map(f => `
                <div class="project-file-row${f.name === activeCsv ? ' is-active' : ''}" data-name="${f.name}">
                  <span class="file-name">${f.name}</span>
                  <div class="file-actions">
                    <button class="preset-apply-btn" data-act="set-active-file" data-id="${p.id}" data-name="${f.name}">Set Active</button>
                    <button class="preset-apply-btn" data-act="remove-file" data-id="${p.id}" data-name="${f.name}">Remove</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>`;
    }).join('');
    // Attach events
    listEl.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const act = btn.getAttribute('data-act');
        const id = btn.getAttribute('data-id');
        if (act === 'load') {
          const proj = await ProjectStore.get(id);
          if (proj) {
            state.currentProject = { id: proj.id, name: proj.name };
            loadSnapshotIntoUI(proj);
            refreshList();
          }
        } else if (act === 'clone') {
          onClone(id);
        } else if (act === 'delete') {
          if (await confirmAsync('Delete this project?')) {
            await ProjectStore.remove(id);
            if (state.currentProject && state.currentProject.id === id) state.currentProject = null;
            refreshList();
          }
        } else if (act === 'toggle-files') {
          const panel = listEl.querySelector(`.project-files[data-files-for="${id}"]`);
          if (panel) {
            const isHidden = panel.style.display === 'none';
            panel.style.display = isHidden ? 'block' : 'none';
            // Update chevron and aria state
            const chev = btn.querySelector('.chev');
            if (chev) chev.textContent = isHidden ? '▼' : '►';
            btn.setAttribute('aria-expanded', String(isHidden));
            // Track expanded state so refreshList preserves it
            if (isHidden) state.expandedFilesPanels.add(id); else state.expandedFilesPanels.delete(id);
          }
        } else if (act === 'export-active') {
          try {
            const proj = await ProjectStore.get(id);
            if (!proj || !proj.data) return alertModal('Project not found', 'warning');
            const activeName = proj.data.activeCsv;
            if (!activeName) return alertModal('No active CSV to export', 'warning');
            const entry = (proj.data.csvs || []).find(f => f.name === activeName);
            if (!entry) return alertModal('Active file not found in project', 'error');
            const isCsv = /\.csv$/i.test(entry.name);
            const mime = isCsv ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
            downloadTextFile(entry.name, entry.text || '', mime);
          } catch (e) {
            console.error(e);
            alertModal('Export failed', 'error');
          }
        } else if (act === 'add-file') {
          onAddFile(id);
        } else if (act === 'manage-locales') {
          onManageLocales(id);
        } else if (act === 'set-active-file') {
          const name = btn.getAttribute('data-name');
          onSetActiveFile(id, name);
        } else if (act === 'remove-file') {
          const name = btn.getAttribute('data-name');
          onRemoveFile(id, name);
        }
      });
    });
  }

  async function onAddFile(projectId) {
    try {
      const proj = await ProjectStore.get(projectId);
      if (!proj) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const text = await file.text();
        const name = file.name || 'data.csv';
        proj.data = proj.data || { csvs: [], activeCsv: null, image: null, template: 'toh', settings: {} };
        const existingIdx = (proj.data.csvs || []).findIndex(f => f.name === name);
        if (existingIdx >= 0) {
          const overwrite = await confirmAsync(`A file named "${name}" already exists in this project. Overwrite it?`);
          if (!overwrite) return;
          proj.data.csvs[existingIdx] = { name, text };
        } else {
          proj.data.csvs.push({ name, text });
        }
        if (!proj.data.activeCsv) proj.data.activeCsv = name;
        await ProjectStore.saveSnapshot(projectId, proj.data);
        if (state.currentProject && state.currentProject.id === projectId) {
          // If currently loaded project, update UI snapshot (do not auto-switch content)
          // Keep current UI unless user explicitly loads project.
        }
        refreshList();
        if (window.showToast) window.showToast('CSV added to project', 'success'); else alertModal('CSV added', 'success');
      };
      input.click();
    } catch (e) {
      console.error(e);
      alertModal('Failed to add file', 'error');
    }
  }

  async function onSetActiveFile(projectId, fileName) {
    try {
      const proj = await ProjectStore.get(projectId);
      if (!proj || !proj.data) return;
      if (!(proj.data.csvs || []).some(f => f.name === fileName)) return;
      proj.data.activeCsv = fileName;
      await ProjectStore.saveSnapshot(projectId, proj.data);
      // Option B: Always load the project immediately and set it current
      state.currentProject = { id: proj.id, name: proj.name };
      loadSnapshotIntoUI(proj);
      refreshList();
      if (window.showToast) window.showToast(`Active file set to ${fileName} and loaded`, 'success');
    } catch (e) {
      console.error(e);
      alertModal('Failed to set active file', 'error');
    }
  }

  async function onRemoveFile(projectId, fileName) {
    try {
      const proj = await ProjectStore.get(projectId);
      if (!proj || !proj.data) return;
      const idx = (proj.data.csvs || []).findIndex(f => f.name === fileName);
      if (idx < 0) return;
      if (!(await confirmAsync(`Remove "${fileName}" from this project?`))) return;
      proj.data.csvs.splice(idx, 1);
      if (proj.data.activeCsv === fileName) {
        proj.data.activeCsv = (proj.data.csvs[0] && proj.data.csvs[0].name) || null;
      }
      await ProjectStore.saveSnapshot(projectId, proj.data);
      // If this project is loaded and we changed active, reflect into UI
      if (state.currentProject && state.currentProject.id === projectId) {
        loadSnapshotIntoUI(proj);
      }
      refreshList();
    } catch (e) {
      console.error(e);
      alertModal('Failed to remove file', 'error');
    }
  }

  function bindToolbar() {
    const createBtn = document.getElementById('projectCreateBtn');
    if (createBtn) createBtn.addEventListener('click', onNew);
  }

  function mountProjectsSection() {
    const container = document.getElementById('projectsSection');
    if (!container) return;
    // Nothing dynamic here besides list; list will be rendered by refreshList
  }

  function initOnce() {
    if (window.__tfProjectsInit) return;
    window.__tfProjectsInit = true;
    bindToolbar();
    mountProjectsSection();
    refreshList();
  }

  document.addEventListener('DOMContentLoaded', initOnce);

  window.ProjectUI = { initOnce, refreshList, onSave };
})();
