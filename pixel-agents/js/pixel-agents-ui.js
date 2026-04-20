// ═══════════════════════════════════════════════════════════
// Pixel Agents v2 — Catalog UI
// Spotlight, carousel, filters, grid rendering from JSON
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Constants ──
  var CATEGORY_LABELS = {
    audit: 'Audit', content: 'Content', strategy: 'Strategy',
    naming: 'Naming', pitch: 'Pitch', design: 'Design',
    lifestyle: 'Lifestyle', tools: 'Tools', career: 'Career',
    intel: 'Intel', gaming: 'Gaming', creative: 'Creative'
  };

  var TIER_ORDER = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };

  var TIER_RATINGS = {
    legendary: [4.8, 5.0],
    epic:      [4.2, 4.7],
    rare:      [3.5, 4.1],
    uncommon:  [3.0, 3.4],
    common:    [2.5, 2.9]
  };

  var SPOTLIGHT_INTERVAL = 8000;

  // ── State ──
  var allAgents = [];
  var currentCategory = 'all';
  var usageStats = {};
  var recentStats = {};
  var spotlightIndex = 0;
  var spotlightTimer = null;
  var spotlightAgents = [];

  // ── Init ──
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    Promise.all([
      fetch('./data/pixel-agents.json?v=2').then(guardJson),
      fetch(getApiBase() + '/pixel-agent-community').then(guardJson).catch(function () { return null; }),
      fetch(getApiBase() + '/pixel-agent-catalog').then(guardJson).catch(function () { return null; })
    ]).then(function (results) {
      var agents = results[0];
      var community = results[1];
      var stats = results[2];

      allAgents = agents.filter(function (a) { return a.active; });

      // Merge community agents
      if (community && community.agents) {
        var commAgents = community.agents.filter(function (a) { return a.active; });
        commAgents.forEach(function (a) { a.community = true; });
        allAgents = allAgents.concat(commAgents);
      }

      // Usage stats
      if (stats && stats.stats) {
        usageStats = stats.stats;
      }
      if (stats && stats.recentStats) {
        recentStats = stats.recentStats;
      }

      // Update hero stats if API returned data
      updateHeroStats();

      // Build spotlight pool (Legendary featured agents)
      spotlightAgents = allAgents.filter(function (a) {
        return a.tier === 'legendary' && a.featured;
      });
      if (spotlightAgents.length === 0) {
        spotlightAgents = allAgents.filter(function (a) { return a.tier === 'legendary'; });
      }

      // Agent of the Day: deterministic daily rotation
      if (spotlightAgents.length > 0) {
        var now = new Date();
        var startOfYear = new Date(now.getFullYear(), 0, 0);
        var dayOfYear = Math.floor((now - startOfYear) / 86400000);
        spotlightIndex = dayOfYear % spotlightAgents.length;
      }

      renderSpotlight();
      renderCarousel();
      renderFilters();
      renderGrid(allAgents);
      startSpotlightRotation();
      initSidebarNav();

    }).catch(function (err) {
      console.error('Failed to load agents:', err);
      var grid = document.getElementById('pa-grid');
      if (grid) {
        grid.innerHTML = '<p style="text-align:center;padding:3rem;color:var(--pa-text-muted);">Failed to load agents. Please refresh.</p>';
      }
    });
  }

  // ── Sidebar Nav — update active state on hash link clicks + page load ──
  function initSidebarNav() {
    var navLinks = document.querySelectorAll('.pa-sidebar-nav a[data-nav]');

    // On page load: if URL has #agent-grid, activate Agents instead of Explore
    if (window.location.hash === '#agent-grid') {
      navLinks.forEach(function (l) { l.classList.remove('active'); });
      var agentsLink = document.querySelector('.pa-sidebar-nav a[data-nav="agents"]');
      if (agentsLink) agentsLink.classList.add('active');
    }

    // On click: swap active state
    navLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.forEach(function (l) { l.classList.remove('active'); });
        link.classList.add('active');
      });
    });
  }

  // ── Guard JSON responses ──
  function guardJson(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) throw new Error('Got HTML instead of JSON');
    return res.json();
  }

  // ── Hero Stats ──
  function updateHeroStats() {
    // Only the live-agent count in the qualitative stat strip — tier count
    // and response time are static; community count + total-runs are
    // intentionally excluded (they read as zero on a new surface, which
    // reads as empty product rather than new product).
    var agentsEl = document.getElementById('pa-stat-agents');
    if (agentsEl) agentsEl.textContent = allAgents.length;
  }

  // ── Spotlight ──
  function renderSpotlight() {
    if (spotlightAgents.length === 0) return;
    var agent = spotlightAgents[spotlightIndex % spotlightAgents.length];

    // ── Populate the unified hero (.pa-hero-v3) ──
    populateHeroAgent(agent);

    // ── Widgets section ──
    var container = document.getElementById('pa-spotlight');
    if (!container) return;

    container.innerHTML =
      '<div class="pa-spotlight-widgets">' +
        '<div class="pa-spotlight-widget">' +
          '<div class="pa-spotlight-widget-header">' +
            '<i class="fas fa-coins pa-spotlight-widget-icon" style="color:var(--pa-success)"></i>' +
            '<span class="pa-spotlight-widget-label">Creator Earnings</span>' +
          '</div>' +
          '<h3>Earn on Every Run</h3>' +
          '<p>Build agents, earn a share of Pro revenue each month.</p>' +
          '<span class="pa-widget-status" style="color:var(--pa-success)"><i class="fas fa-dollar-sign" style="font-size:0.4rem"></i> Active</span>' +
        '</div>' +
        '<div class="pa-spotlight-widget">' +
          '<div class="pa-spotlight-widget-header">' +
            '<i class="fas fa-shield-halved pa-spotlight-widget-icon"></i>' +
            '<span class="pa-spotlight-widget-label">AI Gatekeeper</span>' +
          '</div>' +
          '<h3>Quality Gate</h3>' +
          '<p>Every agent reviewed for safety, quality, and uniqueness before deployment.</p>' +
          '<span class="pa-widget-status pa-widget-status--purple"><i class="fas fa-check" style="font-size:0.5rem"></i> Active</span>' +
        '</div>' +
        '<div class="pa-spotlight-widget">' +
          '<div class="pa-spotlight-widget-header">' +
            '<i class="fas fa-share-nodes pa-spotlight-widget-icon" style="color:var(--pa-accent)"></i>' +
            '<span class="pa-spotlight-widget-label">Social Cards</span>' +
          '</div>' +
          '<h3>Shareable Results</h3>' +
          '<p>Branded result cards for LinkedIn, X, and Bluesky.</p>' +
          '<span class="pa-widget-status"><i class="fas fa-sparkles" style="font-size:0.4rem"></i> NEW</span>' +
        '</div>' +
        '<div class="pa-spotlight-widget">' +
          '<div class="pa-spotlight-widget-header">' +
            '<i class="fas fa-fire pa-spotlight-widget-icon" style="color:var(--pa-warning)"></i>' +
            '<span class="pa-spotlight-widget-label">This Week</span>' +
          '</div>' +
          '<h3>Trending Agents</h3>' +
          buildTrendingWidgetContent() +
          '<span class="pa-widget-status" style="color:var(--pa-warning)"><i class="fas fa-chart-line" style="font-size:0.4rem"></i> LIVE</span>' +
        '</div>' +
      '</div>';
  }

  // ── Populate the unified hero (.pa-hero-v3) with the agent of the day ──
  function populateHeroAgent(agent) {
    // Eyebrow — "Agent of the Day :: <date>"
    var eyebrowEl = document.getElementById('pa-hero-eyebrow');
    if (eyebrowEl) {
      var today = new Date();
      var dateStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
      eyebrowEl.textContent = 'Agent of the Day :: ' + dateStr;
    }

    // Foreground portrait
    var portraitEl = document.getElementById('pa-hero-portrait');
    if (portraitEl) {
      var portraitUrl = agent.portraitUrl || '/pixel-agents/img/' + agent.id + '.webp';
      portraitEl.innerHTML =
        '<div class="pa-hero-v3__portrait-frame">' +
          '<img class="pa-hero-v3__portrait-img" src="' + escapeAttr(portraitUrl) + '" alt="' + escapeAttr(agent.name + ' — ' + (agent.tier || 'agent')) + '">' +
          '<div class="pa-hero-v3__portrait-caption">Online &middot; <span class="pa-hero-v3__portrait-name">' + escapeHtml(agent.name) + '</span></div>' +
        '</div>';
    }

    // Agent meta strip (name + tier + tagline)
    var metaEl = document.getElementById('pa-hero-agent-meta');
    if (metaEl) {
      var tier = agent.tier || 'common';
      var tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
      metaEl.innerHTML =
        '<span class="pa-hero-v3__agent-label">Featured</span>' +
        '<span class="pa-hero-v3__agent-name">' + escapeHtml(agent.name) + '</span>' +
        '<span class="pa-hero-v3__agent-tier" data-tier="' + escapeAttr(tier) + '">' + escapeHtml(tierLabel) + '</span>';
    }

    // Primary CTA — deep-link to this specific agent
    var ctas = document.getElementById('pa-hero-ctas');
    if (ctas) {
      var primary = ctas.querySelector('.pa-btn-primary');
      if (primary) {
        primary.setAttribute('href', '/pixel-agents/run.html?agent=' + escapeAttr(agent.id));
        primary.innerHTML = 'Run ' + escapeHtml(agent.name) + ' <i class="fas fa-arrow-right"></i>';
      }
    }
  }

  function hashCode(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash;
  }

  function startSpotlightRotation() {
    if (spotlightAgents.length <= 1) return;
    spotlightTimer = setInterval(function () {
      spotlightIndex++;
      renderSpotlight();
    }, SPOTLIGHT_INTERVAL);
  }

  // ── Carousel ──
  function renderCarousel() {
    var container = document.getElementById('pa-carousel');
    if (!container) return;

    // Top agents: sort by tier, take top 8
    var sorted = allAgents.slice().sort(function (a, b) {
      return (TIER_ORDER[a.tier] || 99) - (TIER_ORDER[b.tier] || 99);
    });
    var topAgents = sorted.slice(0, 8);

    container.innerHTML = topAgents.map(function (agent) {
      var url = '/pixel-agents/run.html?agent=' + escapeAttr(agent.id);
      var categoryLabel = CATEGORY_LABELS[agent.category] || agent.category;
      var rating = generateRating(agent.id, agent.tier);

      return '<a href="' + url + '" class="pa-carousel-card">' +
        '<div class="pa-agent-portrait" data-agent-id="' + escapeAttr(agent.id) + '">' +
          '<img src="' + escapeAttr(agent.portraitUrl || '/pixel-agents/img/' + agent.id + '.webp') + '" alt="' + escapeAttr(agent.name) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
          '<div class="pa-portrait-fallback"><i class="' + escapeAttr(agent.icon) + '"></i></div>' +
          '<span class="pa-carousel-category-badge pa-cat--' + escapeAttr(agent.category) + '">' + escapeHtml(categoryLabel) + '</span>' +
          '<button class="pa-carousel-add-btn" title="Quick deploy"><i class="fas fa-plus"></i></button>' +
        '</div>' +
        '<div class="pa-carousel-card-body">' +
          '<div class="pa-carousel-card-name">' + escapeHtml(agent.name) + '</div>' +
          '<div class="pa-carousel-card-desc">' + escapeHtml(agent.tagline) + '</div>' +
          '<div class="pa-carousel-card-rating"><i class="fas fa-star"></i> ' + rating.toFixed(1) + '</div>' +
        '</div>' +
      '</a>';
    }).join('');

    setupCarouselNav();
  }

  function setupCarouselNav() {
    var carousel = document.getElementById('pa-carousel');
    var prev = document.getElementById('pa-carousel-prev');
    var next = document.getElementById('pa-carousel-next');
    if (!carousel || !prev || !next) return;

    var scrollAmount = 280;

    prev.addEventListener('click', function () {
      carousel.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });

    next.addEventListener('click', function () {
      carousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });
  }

  // ── Filter State ──
  var currentSource = 'all';
  var currentSort = 'featured';

  // ── Combined Filter + Sort ──
  function applyFilters() {
    var filtered = allAgents;

    // Source filter
    if (currentSource === 'built-in') filtered = filtered.filter(function (a) { return !a.community; });
    if (currentSource === 'community') filtered = filtered.filter(function (a) { return a.community; });

    // Category filter
    if (currentCategory !== 'all') filtered = filtered.filter(function (a) { return a.category === currentCategory; });

    renderGrid(filtered);
  }

  // ── Source Tabs ──
  function initSourceTabs() {
    var container = document.getElementById('pa-source-tabs');
    if (!container) return;
    var tabs = container.querySelectorAll('.pa-source-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        currentSource = tab.dataset.source;

        // Auto-switch sort for community (featured doesn't apply)
        var sortEl = document.getElementById('pa-sort');
        if (currentSource === 'community' && currentSort === 'featured') {
          currentSort = 'newest';
          if (sortEl) sortEl.value = 'newest';
        }

        applyFilters();
      });
    });
  }

  // ── Sort Dropdown ──
  function initSort() {
    var sortEl = document.getElementById('pa-sort');
    if (!sortEl) return;
    sortEl.addEventListener('change', function () {
      currentSort = sortEl.value;
      applyFilters();
    });
  }

  // ── Category Filters ──
  function renderFilters() {
    var container = document.getElementById('pa-filters');
    if (!container) return;

    var html = '<button class="pa-filter-tab active" data-category="all">All</button>';
    Object.keys(CATEGORY_LABELS).forEach(function (key) {
      html += '<button class="pa-filter-tab" data-category="' + escapeAttr(key) + '">' +
        escapeHtml(CATEGORY_LABELS[key]) + '</button>';
    });
    container.innerHTML = html;

    var tabs = container.querySelectorAll('.pa-filter-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        currentCategory = tab.dataset.category;
        applyFilters();
      });
    });

    // Init source tabs and sort
    initSourceTabs();
    initSort();
  }

  // ── Grid ──
  function renderGrid(agents) {
    var grid = document.getElementById('pa-grid');
    var empty = document.getElementById('pa-empty');
    var emptyText = document.getElementById('pa-empty-text');
    var count = document.getElementById('pa-count');

    if (!grid) return;

    if (agents.length === 0) {
      grid.innerHTML = '';
      grid.style.display = 'none';
      if (empty) empty.style.display = '';
      if (emptyText) {
        if (currentSource === 'community') {
          emptyText.innerHTML = 'No community agents yet. <a href="/agent-forge/" style="color:var(--pa-primary)">Build one in Agent Forge!</a>';
        } else {
          emptyText.textContent = 'No agents found in this category.';
        }
      }
      if (count) count.textContent = '0 agents';
      return;
    }

    grid.style.display = '';
    if (empty) empty.style.display = 'none';
    if (count) count.textContent = agents.length + ' agent' + (agents.length !== 1 ? 's' : '');

    // Sort
    var sorted = agents.slice().sort(function (a, b) {
      switch (currentSort) {
        case 'trending':
          return (recentStats[b.id] || 0) - (recentStats[a.id] || 0);
        case 'most-runs':
          return (usageStats[b.id] || 0) - (usageStats[a.id] || 0);
        case 'newest':
          return (b.createdAt || b.approvedAt || '').localeCompare(a.createdAt || a.approvedAt || '');
        case 'name-az':
          return (a.name || '').localeCompare(b.name || '');
        default: // "featured" sort — honors the curator-set order field only.
          // Featured is an editorial badge, not a sort key — clustering all
          // featured agents into the first row makes the badge meaningless.
          return (a.order || 99) - (b.order || 99);
      }
    });

    grid.innerHTML = sorted.map(function (agent) { return renderAgentCard(agent); }).join('');
  }

  function renderAgentCard(agent) {
    var runs = usageStats[agent.id] || 0;
    var recent = recentStats[agent.id] || 0;
    var runsLabel = runs > 0 ? formatNumber(runs) + ' runs' : 'New';
    var tierLabel = agent.tier.charAt(0).toUpperCase() + agent.tier.slice(1);
    var categoryLabel = CATEGORY_LABELS[agent.category] || agent.category;
    var url = '/pixel-agents/run.html?agent=' + escapeAttr(agent.id);

    // Trending badge: 5+ runs in last 7 days
    var trendingHtml = recent >= 5
      ? '<span class="pa-agent-card-trending"><i class="fas fa-fire"></i> Trending</span>'
      : '';

    // Limit capabilities to first 3
    var caps = (agent.capabilities || []).slice(0, 3);
    var tagsHtml = caps.map(function (c) {
      return '<span class="pa-agent-card-tag">' + escapeHtml(c) + '</span>';
    }).join('');

    // Badge
    var badgeHtml = '';
    if (agent.community) {
      badgeHtml = '<span class="pa-agent-card-badge pa-badge--community">Community</span>';
    } else if (agent.featured) {
      badgeHtml = '<span class="pa-agent-card-badge pa-badge--featured">Featured</span>';
    }

    var imgSrc = agent.portraitUrl || '/pixel-agents/img/' + escapeAttr(agent.id) + '.webp';

    return '<a href="' + url + '" class="pa-agent-card" data-tier="' + escapeAttr(agent.tier) + '" data-agent-id="' + escapeAttr(agent.id) + '">' +
      '<div class="pa-agent-portrait" data-agent-id="' + escapeAttr(agent.id) + '">' +
        '<img src="' + escapeAttr(imgSrc) + '" alt="' + escapeAttr(agent.name) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        '<div class="pa-portrait-fallback"><i class="' + escapeAttr(agent.icon) + '"></i></div>' +
        badgeHtml +
        '<span class="pa-agent-card-tier pa-tier--' + escapeAttr(agent.tier) + '">' + escapeHtml(tierLabel) + '</span>' +
        '<span class="pa-agent-card-cat-badge pa-cat--' + escapeAttr(agent.category) + '">' + escapeHtml(categoryLabel) + '</span>' +
      '</div>' +
      '<div class="pa-agent-card-body">' +
        '<div class="pa-agent-card-name">' + escapeHtml(agent.name) + '</div>' +
        '<div class="pa-agent-card-tagline">' + escapeHtml(agent.tagline) + '</div>' +
        '<div class="pa-agent-card-tags">' + tagsHtml + '</div>' +
      '</div>' +
      '<div class="pa-agent-card-footer">' +
        '<span class="pa-agent-card-runs">' + trendingHtml + runsLabel + '</span>' +
        '<span class="pa-agent-card-cta">Deploy <i class="fas fa-arrow-right"></i></span>' +
      '</div>' +
    '</a>';
  }

  // ── Portrait Renderer ──
  function renderPortrait(agent, context) {
    var cls = 'pa-agent-portrait';
    if (context === 'spotlight') cls += ' pa-spotlight-portrait-img';
    var imgSrc = agent.portraitUrl || '/pixel-agents/img/' + escapeAttr(agent.id) + '.webp';

    return '<div class="' + cls + '" data-agent-id="' + escapeAttr(agent.id) + '">' +
      '<img src="' + escapeAttr(imgSrc) + '" alt="' + escapeAttr(agent.name) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
      '<div class="pa-portrait-fallback"><i class="' + escapeAttr(agent.icon) + '"></i></div>' +
    '</div>';
  }

  // ── Trending Widget Content (top 3 by 7-day runs) ──
  function buildTrendingWidgetContent() {
    var sorted = allAgents.slice().filter(function (a) {
      return recentStats[a.id] && recentStats[a.id] > 0;
    }).sort(function (a, b) {
      return (recentStats[b.id] || 0) - (recentStats[a.id] || 0);
    }).slice(0, 3);

    if (sorted.length === 0) {
      return '<p>No trending agents this week.</p>';
    }

    var html = '<div class="pa-trending-list">';
    sorted.forEach(function (a) {
      html += '<div class="pa-trending-item">' +
        '<span class="pa-trending-name">' + escapeHtml(a.name) + '</span>' +
        '<span class="pa-trending-count">' + recentStats[a.id] + ' runs</span>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  // ── Recently Deployed (top 3 by usage) ──
  function buildRecentlyDeployed() {
    var sorted = allAgents.slice().filter(function (a) {
      return usageStats[a.id] && usageStats[a.id] > 0;
    }).sort(function (a, b) {
      return (usageStats[b.id] || 0) - (usageStats[a.id] || 0);
    }).slice(0, 3);

    if (sorted.length === 0) {
      return '<p style="font-size:0.75rem;color:var(--pa-text-faint);">No deployments yet.</p>';
    }

    var html = '<div class="pa-recent-list">';
    sorted.forEach(function (a) {
      html += '<a href="/pixel-agents/run.html?agent=' + escapeAttr(a.id) + '" class="pa-recent-item">' +
        '<i class="' + escapeAttr(a.icon) + '"></i>' +
        '<span>' + escapeHtml(a.name) + '</span>' +
        '<span class="pa-recent-runs">' + formatNumber(usageStats[a.id]) + '</span>' +
      '</a>';
    });
    html += '</div>';
    return html;
  }

  // ── Rating Generator ──
  function generateRating(agentId, tier) {
    var range = TIER_RATINGS[tier] || [3.0, 3.5];
    // Deterministic hash from agent ID
    var hash = 0;
    for (var i = 0; i < agentId.length; i++) {
      hash = ((hash << 5) - hash) + agentId.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit int
    }
    var normalized = (Math.abs(hash) % 100) / 100;
    var rating = range[0] + normalized * (range[1] - range[0]);
    return Math.round(rating * 10) / 10;
  }

  function renderStars(rating) {
    var full = Math.floor(rating);
    var half = rating - full >= 0.5 ? 1 : 0;
    var empty = 5 - full - half;
    var html = '';
    for (var i = 0; i < full; i++) html += '<i class="fas fa-star"></i>';
    if (half) html += '<i class="fas fa-star-half-alt"></i>';
    for (var j = 0; j < empty; j++) html += '<i class="far fa-star"></i>';
    return html;
  }

  // ── Helpers ──
  function getApiBase() {
  return window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';
}

  function escapeHtml(str) {
    var div = document.createElement('div');
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

})();
