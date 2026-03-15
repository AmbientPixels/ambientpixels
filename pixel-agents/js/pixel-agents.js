// Pixel Agents Catalog — client-side logic for index.html

let allAgents = [];
let currentCategory = 'all';
let usageStats = {};

const CATEGORY_LABELS = {
  audit: 'Audit',
  content: 'Content',
  strategy: 'Strategy',
  naming: 'Naming',
  pitch: 'Pitch'
};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Load agents + stats in parallel
    const [agentsRes, statsRes] = await Promise.all([
      fetch('./data/pixel-agents.json?v=1'),
      fetch('/api/pixel-agent-catalog').catch(() => null)
    ]);

    // Guard against SWA fallback returning HTML instead of JSON
    const contentType = agentsRes.headers.get('content-type') || '';
    if (!agentsRes.ok || contentType.includes('text/html')) {
      throw new Error('Agent data unavailable (got HTML instead of JSON)');
    }
    allAgents = await agentsRes.json();
    allAgents = allAgents.filter(a => a.active);

    if (statsRes && statsRes.ok) {
      const statsCT = statsRes.headers.get('content-type') || '';
      if (statsCT.includes('application/json')) {
        const statsData = await statsRes.json();
        usageStats = statsData.stats || {};
      }
    }

    renderGrid(allAgents);
    setupFilters();

  } catch (err) {
    console.error('Failed to load agents:', err);
    document.getElementById('pa-grid').innerHTML =
      '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:2rem;">Failed to load agents. Please refresh.</p>';
  }
});

function setupFilters() {
  const filterBtns = document.querySelectorAll('.pa-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      currentCategory = btn.dataset.category;
      const filtered = currentCategory === 'all'
        ? allAgents
        : allAgents.filter(a => a.category === currentCategory);

      renderGrid(filtered);
    });
  });
}

function renderGrid(agents) {
  const grid = document.getElementById('pa-grid');
  const empty = document.getElementById('pa-empty');
  const count = document.getElementById('pa-count');

  if (agents.length === 0) {
    grid.innerHTML = '';
    grid.style.display = 'none';
    empty.style.display = '';
    count.textContent = '0 agents';
    return;
  }

  grid.style.display = '';
  empty.style.display = 'none';
  count.textContent = agents.length + ' agent' + (agents.length !== 1 ? 's' : '');

  // Sort: featured first, then by order
  const sorted = [...agents].sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return (a.order || 99) - (b.order || 99);
  });

  grid.innerHTML = sorted.map(agent => renderCard(agent)).join('');
}

function renderCard(agent) {
  const runs = usageStats[agent.id] || 0;
  const runsLabel = runs > 0 ? formatNumber(runs) + ' runs' : 'New';
  const tierLabel = agent.tier.charAt(0).toUpperCase() + agent.tier.slice(1);
  const categoryLabel = CATEGORY_LABELS[agent.category] || agent.category;

  return `
    <div class="pa-card" data-tier="${escapeAttr(agent.tier)}" data-agent-id="${escapeAttr(agent.id)}">
      ${agent.featured ? '<div class="pa-card-featured">Featured</div>' : ''}
      <div class="pa-card-avatar">
        <div class="pa-card-icon"><i class="${escapeAttr(agent.icon)}"></i></div>
        <span class="pa-card-tier pa-card-tier--${escapeAttr(agent.tier)}">${escapeHtml(tierLabel)}</span>
      </div>
      <div class="pa-card-body">
        <h3 class="pa-card-name">${escapeHtml(agent.name)}</h3>
        <p class="pa-card-tagline">${escapeHtml(agent.tagline)}</p>
        <span class="pa-card-role">${escapeHtml(categoryLabel)}</span>
        <ul class="pa-card-capabilities">
          ${agent.capabilities.map(c => '<li>' + escapeHtml(c) + '</li>').join('')}
        </ul>
      </div>
      <div class="pa-card-footer">
        <span class="pa-card-usage">${runsLabel}</span>
        <a href="/pixel-agents/run.html?agent=${escapeAttr(agent.id)}" class="pa-card-action">
          <i class="fas fa-play"></i> Hire Agent
        </a>
      </div>
    </div>
  `;
}

// ── Helpers ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
