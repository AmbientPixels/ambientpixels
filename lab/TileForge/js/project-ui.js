// project-ui.js
// UI for managing TileForge Projects (uses ProjectStore)

(function(){
  const state = {
    currentProject: null, // { id, name }
  };

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
      alert('Failed to load project. See console for details.');
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
    const name = prompt('Project name:');
    if (!name) throw new Error('Canceled');
    const rec = await window.ProjectStore.create(name, buildSnapshotFromUI());
    state.currentProject = { id: rec.id, name: rec.name };
    refreshList();
    return state.currentProject;
  }

  async function onNew() {
    const choice = confirm('Create a new project from current state? (OK = from current, Cancel = blank)');
    const name = prompt('New project name:');
    if (!name) return;
    const data = choice ? buildSnapshotFromUI() : { csvs: [], activeCsv: null, image: null, template: 'toh', settings: { enabledSections: { title: true, subtitle: true, narrator: true } } };
    const rec = await ProjectStore.create(name, data);
    state.currentProject = { id: rec.id, name: rec.name };
    refreshList();
    alert('Project created');
  }

  async function onSave() {
    try {
      const ctx = await ensureProjectContext();
      const snap = buildSnapshotFromUI();
      await ProjectStore.saveSnapshot(ctx.id, snap);
      refreshList();
      if (window.showToast) window.showToast('Project saved', 'success'); else alert('Project saved');
    } catch (e) {
      if (e && e.message === 'Canceled') return;
      console.error(e);
      alert('Save failed');
    }
  }

  async function onClone() {
    if (!state.currentProject) {
      // allow clone from current state into a newly named project
      const name = prompt('Clone to new project name:');
      if (!name) return;
      const rec = await ProjectStore.create(name, buildSnapshotFromUI());
      state.currentProject = { id: rec.id, name: rec.name };
      refreshList();
      alert('Cloned to new project');
      return;
    }
    const newName = prompt('Name for cloned project:', state.currentProject.name + ' (Copy)');
    if (!newName) return;
    const rec = await ProjectStore.clone(state.currentProject.id, newName);
    state.currentProject = { id: rec.id, name: rec.name };
    refreshList();
    alert('Project cloned');
  }

  async function onExport(projectId) {
    const proj = projectId ? await ProjectStore.get(projectId) : (state.currentProject ? await ProjectStore.get(state.currentProject.id) : null);
    if (!proj) { alert('No project to export'); return; }
    if (!window.JSZip) { alert('JSZip not loaded'); return; }
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({ id: proj.id, name: proj.name, schemaVersion: proj.schemaVersion, data: proj.data }, null, 2));
    const folderCsv = zip.folder('csv');
    (proj.data.csvs || []).forEach(f => folderCsv.file(f.name, f.text));
    if (proj.data.image && proj.data.image.dataUrl) {
      const folderImg = zip.folder('images');
      folderImg.file(proj.data.image.name || 'image.png', proj.data.image.dataUrl.split(',')[1], { base64: true });
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (proj.name || 'tileforge-project') + '.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function onImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (!window.JSZip) { alert('JSZip not loaded'); return; }
      const zip = await JSZip.loadAsync(file);
      const projJsonFile = zip.file('project.json');
      if (!projJsonFile) { alert('Invalid project zip: missing project.json'); return; }
      const meta = JSON.parse(await projJsonFile.async('string'));
      const data = meta.data || {};
      // Load csv files into data.csvs if present
      const csvFolder = zip.folder('csv');
      if (csvFolder) {
        const entries = [];
        await Promise.all(Object.keys(zip.files).map(async key => {
          if (key.startsWith('csv/') && !zip.files[key].dir) {
            const name = key.substring(4);
            const text = await zip.files[key].async('string');
            entries.push({ name, text });
          }
        }));
        if (entries.length) { data.csvs = entries; if (!data.activeCsv) data.activeCsv = entries[0].name; }
      }
      const name = prompt('Import project name:', meta.name || 'Imported Project');
      const rec = await ProjectStore.create(name, data);
      state.currentProject = { id: rec.id, name: rec.name };
      refreshList();
      alert('Project imported');
    };
    input.click();
  }

  async function refreshList() {
    const listEl = document.getElementById('projectsList');
    if (!listEl) return;
    const items = await ProjectStore.list();
    listEl.innerHTML = items.map(p => {
      const isActive = state.currentProject && state.currentProject.id === p.id;
      const date = new Date(p.updatedAt || p.createdAt).toLocaleString();
      return `
        <div class="project-item${isActive ? ' active' : ''}">
          <div class="project-meta">
            <div class="project-name">${p.name}</div>
            <div class="project-date">${date}</div>
          </div>
          <div class="project-actions">
            <button class="preset-apply-btn" data-act="load" data-id="${p.id}">Load</button>
            <button class="preset-apply-btn" data-act="export" data-id="${p.id}">Export</button>
            <button class="preset-apply-btn" data-act="delete" data-id="${p.id}">Delete</button>
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
        } else if (act === 'export') {
          onExport(id);
        } else if (act === 'delete') {
          if (confirm('Delete this project?')) {
            await ProjectStore.remove(id);
            if (state.currentProject && state.currentProject.id === id) state.currentProject = null;
            refreshList();
          }
        }
      });
    });
  }

  function bindToolbar() {
    const newBtn = document.getElementById('toolbarNewBtn');
    const saveBtn = document.getElementById('toolbarSaveBtn');
    const cloneBtn = document.getElementById('toolbarCloneBtn');
    if (newBtn) newBtn.addEventListener('click', onNew);
    if (saveBtn) saveBtn.addEventListener('click', onSave);
    if (cloneBtn) cloneBtn.addEventListener('click', onClone);

    const importBtn = document.getElementById('projectImportBtn');
    const exportBtn = document.getElementById('projectExportBtn');
    if (importBtn) importBtn.addEventListener('click', onImport);
    if (exportBtn) exportBtn.addEventListener('click', () => onExport());
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

  window.ProjectUI = { initOnce, refreshList };
})();
