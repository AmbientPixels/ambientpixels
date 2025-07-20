// File: /js/project-dashboard.js (Fixed Version)

// Tag to badge class mapping (expand as needed, only use existing classes)
const TAG_BADGE_MAP = {
  'AI': 'badge-solid-blue',
  'ai': 'badge-solid-blue',
  'tools': 'badge-solid-green',
  'tool': 'badge-solid-green',
  'dashboard': 'badge-solid-orange',
  'system': 'badge-solid-blue',
  'memory': 'badge-solid-purple',
  'video': 'badge-solid-orange',
  'audio': 'badge-solid-pink',
  'experimental': 'badge-solid-pink',
  'fun': 'badge-solid-green',
  'persona': 'badge-solid-purple',
  'layout': 'badge-solid-slate',
  'css': 'badge-solid-slate',
  'theme': 'badge-solid-slate',
  'json': 'badge-solid-green',
  'xml': 'badge-solid-green',
  'render': 'badge-solid-gold',
  'UI': 'badge-solid-gold',
  'core': 'badge-solid-blue',
  'creation': 'badge-solid-gold',
  'evolution': 'badge-solid-gold',
  'ambient': 'badge-solid-blue',
  'architecture': 'badge-solid-purple',
  'mood': 'badge-solid-blue',
  'awareness': 'badge-solid-blue',
  'emotion': 'badge-solid-pink',
  'telemetry': 'badge-solid-orange',
  'background-theming': 'badge-solid-slate',
  'dark-palette': 'badge-solid-slate',
  'table-ui': 'badge-solid-slate',
  'github actions': 'badge-solid-green',
  'logs': 'badge-solid-orange',
  'boot-seed': 'badge-solid-orange',
  'autonomous-updates': 'badge-solid-orange',
  'embargo': 'badge-solid-red',
  'voiceover': 'badge-solid-pink',
  'aesthetic': 'badge-solid-pink',
  'concept': 'badge-solid-gold',
  'future': 'badge-solid-gold',
  'sfx': 'badge-solid-orange',
  'image': 'badge-solid-pink',
  'cartoon': 'badge-solid-pink',
  'sentience': 'badge-solid-purple',
  'senses': 'badge-solid-purple',
  'expansion': 'badge-solid-purple',
  'dream-engine': 'badge-solid-purple',
  'design': 'badge-solid-gold',
  'docs': 'badge-solid-slate',
  // fallback
  'default': 'badge-solid-blue'
};

function mapTagToBadge(tag) {
  const cls = TAG_BADGE_MAP[tag.trim().toLowerCase()] || TAG_BADGE_MAP['default'];
  return `<span class="tool-tag ${cls}">${tag}</span>`;
}

// Status to badge class mapping (only use existing classes)
const STATUS_BADGE_MAP = {
  'active': 'soon-tag',
  'in progress': 'soon-tag',
  'paused': 'badge-solid-slate',
  'planned': 'badge-solid-orange',
  'updated': 'updated-tag',
  'embargoed': 'badge-solid-red',
  'new': 'soon-tag',
  'idea': 'badge-solid-blue',
  'completed': 'updated-tag',
  'default': 'badge-solid-blue'
};

function mapStatusToBadge(status) {
  if (!status) return '';
  const cls = STATUS_BADGE_MAP[status.trim().toLowerCase()] || STATUS_BADGE_MAP['default'];
  return `<span class="project-status-badge ${cls}">${status}</span>`;
}

document.addEventListener("DOMContentLoaded", () => {
  let allProjects = [];
  let allTags = [];

  // Elements
  const list = document.getElementById('project-list');
  const tagDropdown = document.getElementById('tag-filter');
  const statusDropdown = document.getElementById('status-filter');
  const sizeDropdown = document.getElementById('size-filter');
  const searchInput = document.getElementById('project-search');
  const clearBtn = document.getElementById('clear-filters');

  // Helper: Render projects
  function renderProjects(data) {
    if (!list) return;
    list.innerHTML = '';
    if (!data.length) {
      list.innerHTML = '<p>No projects found.</p>';
      return;
    }
    data.forEach(project => {
      // Calculate progress as percent (protocol: float 0-1)
      let pct = '';
      if (typeof project.progress === 'number') {
        pct = Math.round(project.progress * 100);
      }
      // Status LED (protocol: .status-led + .status-[status])
      const statusLed = project.status ? `<span class="status-led status-${project.status.toLowerCase()}" aria-label="${project.status}"></span>` : '';
      // Unified status-progress bar (uses only existing badge color classes)
      const badgeClass = STATUS_BADGE_MAP[(project.status||'').trim().toLowerCase()] || STATUS_BADGE_MAP['default'];
      const statusText = project.status || '';
      const progressText = (typeof pct === 'number' && !isNaN(pct)) ? `${pct}%` : '';
      const statusProgressBar = `<div class="status-progress-bar ${badgeClass}">
        <span class="status-label">${statusText}</span>
        <span class="progress-text">${progressText}</span>
        <div class="status-progress-fill" style="width:${pct||0}%"></div>
      </div>`;
      // Size badge (protocol: .filter-pill + .size-[size])
      const sizeBadge = project.size ? `<span class="filter-pill size-${project.size.toLowerCase()}">${project.size}</span>` : '';

      // Status + last updated
      const meta = `<p class="nova-mood">${project.status ? project.status : ''}${project.lastUpdated ? ` • Updated: ${project.lastUpdated}` : ''}</p>`;
      // Tag badges
      const tagBadges = `<div class="nova-badge-group">${(project.tags || []).map(tag => mapTagToBadge(tag)).join('')}</div>`;
      // Description
      const desc = `<p class="project-desc">${project.description || ''}</p>`;
      // Link (if present)
      const link = project.html ? `<a href="${project.html}" class="btn-link" aria-label="View log for ${project.title}">View Log →</a>` : '';
      // Compose card
      const card = document.createElement('section');
      card.className = 'grid-col-4 card-section';
      card.innerHTML = `
        <div class="card-content">
          <h3>${statusLed}${project.title}${sizeBadge}<span class="mini-stats">${(project.tags && project.tags.length) ? ` • ${project.tags.length} tag${project.tags.length > 1 ? 's' : ''}` : ''}${project.lastUpdated ? ` • ${(() => { const d = Math.floor((Date.now() - new Date(project.lastUpdated).getTime())/86400000); return d >= 0 ? `${d}d ago` : ''})()}` : ''}</span></h3>
          ${statusProgressBar}
          ${meta}
          ${tagBadges}
          ${desc}
          ${link}
        </div>
      `;
      list.appendChild(card);
    });
  }

  // Helper: Populate tag dropdown
  function populateTagDropdown() {
    if (!tagDropdown) return;
    tagDropdown.innerHTML = '';
    allTags.forEach(tag => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag;
      tagDropdown.appendChild(opt);
    });
  }

  // Helper: Get selected tags
  function getSelectedTags() {
    if (!tagDropdown || !tagDropdown.selectedOptions) return [];
    return Array.from(tagDropdown.selectedOptions).map(opt => opt.value);
  }

  // Helper: Update filtered projects
  function updateFilteredProjects() {
    let filtered = allProjects;
    // Tag filter (multi-select OR logic)
    const selectedTags = getSelectedTags();
    if (selectedTags.length > 0) {
      filtered = filtered.filter(p => (p.tags || []).some(tag => selectedTags.includes(tag)));
    }
    // Status filter
    if (statusDropdown && statusDropdown.value) {
      filtered = filtered.filter(p => (p.status || '') === statusDropdown.value);
    }
    // Size filter
    if (sizeDropdown && sizeDropdown.value) {
      filtered = filtered.filter(p => (p.size || '') === sizeDropdown.value);
    }
    // Search filter
    if (searchInput && searchInput.value.trim().length > 0) {
      const term = searchInput.value.trim().toLowerCase();
      filtered = filtered.filter(p =>
        (p.title && p.title.toLowerCase().includes(term)) ||
        (p.description && p.description.toLowerCase().includes(term)) ||
        (Array.isArray(p.tags) && p.tags.some(tag => tag.toLowerCase().includes(term)))
      );
    }
    renderProjects(filtered);
    updateClearBtn();
  }

  // Helper: Update clear button
  function updateClearBtn() {
    if (!clearBtn) return; // Exit if clear button doesn't exist
    
    const hasFilters = getSelectedTags().length > 0 ||
      (statusDropdown && statusDropdown.value) ||
      (sizeDropdown && sizeDropdown.value) ||
      (searchInput && searchInput.value.trim().length > 0);
      
    if (hasFilters) {
      clearBtn.classList.add('active');
      clearBtn.style.display = '';
    } else {
      clearBtn.classList.remove('active');
      clearBtn.style.display = 'none';
    }
  }

  // Event listeners
  if (tagDropdown) tagDropdown.addEventListener('change', updateFilteredProjects);
  if (statusDropdown) statusDropdown.addEventListener('change', updateFilteredProjects);
  if (sizeDropdown) sizeDropdown.addEventListener('change', updateFilteredProjects);
  if (searchInput) searchInput.addEventListener('input', updateFilteredProjects);
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (tagDropdown) Array.from(tagDropdown.options).forEach(opt => opt.selected = false);
      if (statusDropdown) statusDropdown.value = '';
      if (sizeDropdown) sizeDropdown.value = '';
      if (searchInput) searchInput.value = '';
      updateFilteredProjects();
      updateClearBtn();
      if (searchInput) searchInput.focus();
    });
  }

  // Render all-up stats (dashboard summary)
  function renderAllUpStats(data) {
    const statsEl = document.querySelector('.dashboard-all-up-stats');
    if (!statsEl || !Array.isArray(data)) return;
    const total = data.length;
    const active = data.filter(p => (p.status||'').toLowerCase()==='active').length;
    const completed = data.filter(p => (p.status||'').toLowerCase()==='completed').length;
    const avgProgress = total ? Math.round(data.reduce((sum,p)=>sum+(typeof p.progress==='number'?p.progress:0),0)/total*100) : 0;
    const allTags = data.flatMap(p => p.tags||[]);
    const uniqueTags = Array.from(new Set(allTags.map(t => t.toLowerCase())));
    // Count projects by size
    const countBySize = sz => data.filter(p => (p.size||'').toUpperCase()===sz).length;
    statsEl.innerHTML = `
      <div class="dashboard-stats-row">
        <div class="dashboard-stat-card"><span class="stat-label">Total Projects</span><span class="stat-value">${total}</span></div>
        <div class="dashboard-stat-card"><span class="stat-label">Active</span><span class="stat-value">${active}</span></div>
        <div class="dashboard-stat-card"><span class="stat-label">Completed</span><span class="stat-value">${completed}</span></div>
        <div class="dashboard-stat-card"><span class="stat-label">Avg Progress</span><span class="stat-value">${avgProgress}%</span></div>
        <div class="dashboard-stat-card"><span class="stat-label">Unique Tags</span><span class="stat-value">${uniqueTags.length}</span></div>

      </div>
    `;
  }

  // Fetch and initialize
  fetch('/docs/logs/projects.json?t=' + Date.now())
    .then(res => res.json())
    .then(projects => {
      allProjects = projects;
      // Collect all unique tags
      const tagSet = new Set();
      projects.forEach(p => (p.tags || []).forEach(t => tagSet.add(t)));
      allTags = Array.from(tagSet).sort();
      populateTagDropdown();
      updateFilteredProjects();
      renderAllUpStats(allProjects);
      updateClearBtn();
    })
    .catch(err => {
      if (list) list.innerHTML = '<p>Error loading projects.</p>';
      console.error('Project dashboard error:', err);
    });
});