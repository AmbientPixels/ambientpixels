// File: /js/project-dashboard.js (Fixed Version)

document.addEventListener("DOMContentLoaded", () => {
  const codeEl = document.getElementById("code-footprint");
  if (codeEl) {
    // placeholder for chart
  }

  const logEl = document.getElementById("changelog");
  if (logEl) {
    // placeholder for log rendering
  }

  // Load and render project list
  fetch('/docs/logs/projects.json?t=' + Date.now())
    .then(res => res.json())
    .then(projects => {
      const list = document.getElementById('project-list');
      const filters = document.getElementById('project-filters');
      if (!list || !filters) return;

      const allTags = new Set();
      projects.forEach(project => {
        if (Array.isArray(project.tags)) {
          project.tags.forEach(tag => allTags.add(tag));
        }
      });

      filters.innerHTML = '<div class="filter-label">Filter:</div>';
      [...allTags].sort().forEach(tag => {
        const btn = document.createElement('button');
        btn.className = 'filter-pill';
        btn.textContent = tag;
        btn.onclick = () => filterByTag(tag);
        filters.appendChild(btn);
      });

      renderProjects(projects);

      function renderProjects(data) {
        list.innerHTML = '';
        data.forEach(project => {
          const insight = generateNovaInsight(project);
          const card = document.createElement('section');
          card.className = 'grid-col-4 card-section';
          card.innerHTML = `
            <div class="card-content">
              <h3>
                ${renderStatusLED(project.status)}
                ${project.title}
              </h3>
              ${renderProgress(project.progress)}
              <p class="nova-mood">${project.status} • Updated: ${project.lastUpdated}</p>
              <div class="nova-badge-group">
                ${(project.tags || []).map(tag => `<span class="nova-badge">${tag}</span>`).join('')}
              </div>
              <p class="nova-quip">${insight}</p>
              <a href="${project.html}" class="btn-link">View Log →</a>
            </div>
          `;
          list.appendChild(card);
        });
      }

      function renderStatusLED(status) {
        const statusColors = {
          'Active': '🟢',
          'In Progress': '🟡',
          'Paused': '🟠',
          'Planned': '🔵',
          'Embargoed': '⚫',
          'Idea': '💡'
        };
        return `<span title="${status}" style="margin-right: 0.4rem;">${statusColors[status] || '🔘'}</span>`;
      }

      function renderProgress(progress) {
        if (typeof progress !== 'number') return '';
        const pct = Math.round(progress * 100);
        return `
          <div class="progress-bar">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
        `;
      }

      function filterByTag(tag) {
        const filtered = projects.filter(p => p.tags.includes(tag));
        renderProjects(filtered);
      }
    })
    .catch(err => {
      const list = document.getElementById('project-list');
      if (list) list.innerHTML = '<p>Error loading projects.</p>';
      console.error('Project dashboard error:', err);
    });

  // Load Nova mood indicators
  fetch("/data/version.json?t=" + Date.now())
    .then(res => res.json())
    .then(data => {
      const versionEl = document.getElementById("nova-version");
      if (versionEl) versionEl.textContent = `${data.version} (build ${data.commit})`;
    })
    .catch(() => {
      const versionEl = document.getElementById("nova-version");
      if (versionEl) versionEl.textContent = "Unavailable";
    });

  fetch("/data/nova-synth-mood.json?t=" + Date.now())
    .then(res => res.json())
    .then(data => {
      const synthMoodEl = document.getElementById("nova-synth-mood");
      if (synthMoodEl) synthMoodEl.textContent = data.mood || "???";
    });

  fetch("/data/nova-hybrid-mood.json?t=" + Date.now())
    .then(res => res.json())
    .then(data => {
      const hybridMoodEl = document.getElementById("nova-hybrid-mood");
      if (hybridMoodEl) hybridMoodEl.textContent = data.hybridMood || data.reflection || "???";
    });

  const moduleCountEl = document.getElementById("nova-module-count");
  if (moduleCountEl) {
    const scripts = document.querySelectorAll("script[src]");
    const novaModules = [...scripts].filter(s => s.src.includes("/js/nova-"));
    moduleCountEl.textContent = novaModules.length;
  }
});