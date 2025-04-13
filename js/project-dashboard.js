// File: /js/project-dashboard.js

fetch('/docs/logs/projects.json')
  .then(res => res.json())
  .then(projects => {
    const list = document.getElementById('project-list');
    const filters = document.getElementById('project-filters');
    const allTags = new Set();

    // Collect all unique tags
    projects.forEach(project => {
      if (Array.isArray(project.tags)) {
        project.tags.forEach(tag => allTags.add(tag));
      }
    });

    // Create filter buttons
    filters.innerHTML = '<div class="filter-label">Filter:</div>';
    [...allTags].sort().forEach(tag => {
      const btn = document.createElement('button');
      btn.className = 'filter-pill';
      btn.textContent = tag;
      btn.onclick = () => filterByTag(tag);
      filters.appendChild(btn);
    });

    // Initial render
    renderProjects(projects);

    function renderProjects(data) {
      list.innerHTML = '';
      data.forEach(project => {
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
            <p class="nova-quip">${project.latestLog || '“No recent update.”'}</p>
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
          <div class="progress-fill" style="width:${pct}%;"></div>
        </div>
      `;
    }

    function filterByTag(tag) {
      const filtered = projects.filter(p => p.tags.includes(tag));
      renderProjects(filtered);
    }
  })
  .catch(err => {
    document.getElementById('project-list').innerHTML = '<p>Error loading projects.</p>';
    console.error('Project dashboard error:', err);
  });
