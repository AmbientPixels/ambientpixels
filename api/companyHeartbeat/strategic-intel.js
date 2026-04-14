// strategic-intel.js — Nova's Strategic Cross-Product P&L Dashboard
// Mirrors finance-intel.js / content-intel.js pattern: digest builder + prompt formatter.
//
// Aggregates signals from ALL other intel digests into a product-level rollup so Nova
// can see at a glance: which of the 6 products are growing vs declining, where cost
// is concentrated, where research intel is stale, where engagement diverges from traffic.
//
// Data constraints (from exploration — documented in plan):
//   - Usage data exists for 4 of 6 products (cardForge, storyForge, pixelAgents, ambientScore).
//     Blindspot + AmbientOS show "NO DATA" honestly.
//   - Cost-by-product is approximate: sums agent cost of agents whose campaigns targeted
//     the product. No action.product field exists today, so this is the best we have.
//   - Engagement-by-product uses campaign.product for bucketing social actions.
//   - Research-by-product direct (researchIntelStore entries are product-tagged).

var { STRATEGIC_INTEL_FRESHNESS_MS } = require('./constants');

// Canonical product list — matches research-intel.js PRODUCT_COMPETITORS keys + product-facts.json
var PRODUCTS = ['AmbientOS', 'AmbientScore', 'Blindspot', 'CardForge', 'PixelAgents', 'StoryForge'];

// Normalizes an arbitrary product string to a canonical name (case-insensitive, spaces removed).
function _canonicalProduct(raw) {
  if (!raw || typeof raw !== 'string') return null;
  var norm = raw.toLowerCase().replace(/[\s_-]/g, '');
  for (var i = 0; i < PRODUCTS.length; i++) {
    if (PRODUCTS[i].toLowerCase().replace(/[\s_-]/g, '') === norm) return PRODUCTS[i];
  }
  return null;
}

function _verdict(trafficDeltaPct, usageDeltaPct, hasTrafficSignal, hasUsageSignal) {
  if (!hasTrafficSignal && !hasUsageSignal) return 'NO DATA';
  var signals = [];
  if (hasTrafficSignal) signals.push(trafficDeltaPct);
  if (hasUsageSignal) signals.push(usageDeltaPct);
  var worst = Math.min.apply(null, signals);
  var best = Math.max.apply(null, signals);
  if (best >= 10) return 'GROWING';
  if (worst <= -10) return 'DECLINING';
  return 'STABLE';
}

function buildStrategicDigest(state, existingDigest, nowMs) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();

  // Freshness check — 15min window (Nova benefits from fresher data than other agents).
  var existingAsOf = existingDigest && existingDigest.asOfUtc ? Date.parse(existingDigest.asOfUtc) : NaN;
  if (existingDigest && Number.isFinite(existingAsOf) && (now - existingAsOf) < STRATEGIC_INTEL_FRESHNESS_MS) {
    return existingDigest;
  }

  state = state || {};
  var campaigns = Array.isArray(state.campaigns) ? state.campaigns : [];
  var actions = Array.isArray(state.actions) ? state.actions : [];
  var researchIntel = Array.isArray(state.researchIntelStore) ? state.researchIntelStore : [];
  var blogPostViews = Array.isArray(state.blogPostViews) ? state.blogPostViews : [];
  var blogPosts = Array.isArray(state.blogPosts) ? state.blogPosts : [];
  var engagementSnapshots = Array.isArray(state.engagementSnapshots) ? state.engagementSnapshots : [];
  var productUsage = (state.costIntel && state.costIntel.productUsage) || {};
  var costByAgent = (state.costIntel && state.costIntel.gemini && state.costIntel.gemini.byAgent) || {};

  var sevenDayMs = 7 * 24 * 60 * 60 * 1000;
  var sevenCutoff = now - sevenDayMs;
  var fourteenCutoff = now - (14 * 24 * 60 * 60 * 1000);

  // ── Map campaigns → product for attribution ──
  var campaignToProduct = {};
  campaigns.forEach(function (c) {
    if (!c || !c.id) return;
    campaignToProduct[c.id] = _canonicalProduct(c.product);
  });

  // ── Per-product: agent-cost attribution via campaigns ──
  // For each product, find agents active on its campaigns within 7d, sum their Gemini cost.
  // Approximate — explicit product tags on actions would be cleaner but don't exist yet.
  var productAgents = {}; // product → Set of agentIds who worked on its campaigns
  PRODUCTS.forEach(function (p) { productAgents[p] = {}; });
  actions.forEach(function (a) {
    if (!a || !a.created_at) return;
    var ts = Date.parse(a.created_at);
    if (!Number.isFinite(ts) || ts < sevenCutoff) return;
    var prod = null;
    if (a.campaign_id && campaignToProduct[a.campaign_id]) prod = campaignToProduct[a.campaign_id];
    if (!prod) return;
    var aid = (a.created_by || a.origin_agent || '').toLowerCase();
    if (aid) productAgents[prod][aid] = true;
  });

  // ── Per-product: engagement via campaign_id → social actions → snapshots ──
  var productEngagement = {}; // product → { posts7d, totalLikes, totalComments, totalReposts }
  PRODUCTS.forEach(function (p) {
    productEngagement[p] = { posts7d: 0, totalLikes: 0, totalComments: 0, totalReposts: 0 };
  });
  var snapByActionId = new Map();
  engagementSnapshots.forEach(function (s) { if (s && s.action_id) snapByActionId.set(s.action_id, s); });
  actions.forEach(function (a) {
    if (!a || a.type !== 'create-social-action') return;
    var ts = Date.parse(a.created_at || '');
    if (!Number.isFinite(ts) || ts < sevenCutoff) return;
    var prod = a.campaign_id ? campaignToProduct[a.campaign_id] : null;
    if (!prod) return;
    productEngagement[prod].posts7d += 1;
    var snap = snapByActionId.get(a.id);
    if (snap && snap.metrics) {
      productEngagement[prod].totalLikes += (snap.metrics.likes || 0);
      productEngagement[prod].totalComments += (snap.metrics.comments || 0);
      productEngagement[prod].totalReposts += (snap.metrics.reposts || 0);
    }
  });

  // ── Per-product: research intel ──
  var productResearch = {}; // product → { activeCount, latestFinding, daysSinceNewest }
  PRODUCTS.forEach(function (p) {
    productResearch[p] = { activeCount: 0, latestFinding: null, daysSinceNewest: null };
  });
  researchIntel.forEach(function (r) {
    if (!r) return;
    var prod = _canonicalProduct(r.product || r.productTag);
    if (!prod) return;
    productResearch[prod].activeCount += 1;
    var ts = Date.parse(r.createdAt || r.created_at || '');
    if (Number.isFinite(ts)) {
      var days = Math.floor((now - ts) / (24 * 60 * 60 * 1000));
      if (productResearch[prod].daysSinceNewest == null || days < productResearch[prod].daysSinceNewest) {
        productResearch[prod].daysSinceNewest = days;
        productResearch[prod].latestFinding = (r.title || r.summary || '').substring(0, 100);
      }
    }
  });

  // ── Per-product: traffic via blog post views (using tags / slug patterns) ──
  // Best-effort: blogPosts.tags may contain product name; fall back to slug substring match.
  var productTraffic = {}; // product → { views7d, views7dPrior, deltaPct }
  PRODUCTS.forEach(function (p) { productTraffic[p] = { views7d: 0, viewsPrior7d: 0 }; });
  var viewsByTs = [];
  blogPostViews.forEach(function (v) {
    if (!v || !v.slug) return;
    var ts = Date.parse(v.timestamp || '');
    if (!Number.isFinite(ts)) return;
    viewsByTs.push({ slug: v.slug, ts: ts });
  });
  // Build slug → products map
  var slugToProducts = {};
  blogPosts.forEach(function (p) {
    if (!p || !p.slug) return;
    var matches = [];
    PRODUCTS.forEach(function (prod) {
      var normProd = prod.toLowerCase();
      var normSlug = (p.slug || '').toLowerCase();
      var normTitle = (p.title || '').toLowerCase();
      var tags = Array.isArray(p.tags) ? p.tags.map(function (t) { return String(t).toLowerCase(); }) : [];
      if (tags.some(function (t) { return t.includes(normProd); }) ||
          normSlug.includes(normProd) ||
          normTitle.includes(normProd)) {
        matches.push(prod);
      }
    });
    if (matches.length > 0) slugToProducts[p.slug] = matches;
  });
  viewsByTs.forEach(function (v) {
    var prods = slugToProducts[v.slug];
    if (!prods) return;
    prods.forEach(function (prod) {
      if (v.ts >= sevenCutoff) productTraffic[prod].views7d += 1;
      else if (v.ts >= fourteenCutoff) productTraffic[prod].viewsPrior7d += 1;
    });
  });
  Object.keys(productTraffic).forEach(function (prod) {
    var pt = productTraffic[prod];
    pt.deltaPct = pt.viewsPrior7d > 0
      ? Math.round(((pt.views7d - pt.viewsPrior7d) / pt.viewsPrior7d) * 100)
      : (pt.views7d > 0 ? 100 : 0);
  });

  // ── Assemble per-product rows ──
  var perProduct = PRODUCTS.map(function (prod) {
    // Usage
    var usageSignal = null;
    var usageLabel = 'no data';
    if (prod === 'PixelAgents' && productUsage.pixelAgents) {
      usageSignal = productUsage.pixelAgents.totalRuns || 0;
      usageLabel = usageSignal + ' runs';
    } else if (prod === 'AmbientScore' && productUsage.ambientScore) {
      usageSignal = productUsage.ambientScore.scans7d || 0;
      usageLabel = usageSignal + ' scans (' + (productUsage.ambientScore.paid7d || 0) + ' paid)';
    } else if (prod === 'CardForge' && productUsage.cardForge) {
      usageSignal = productUsage.cardForge.pageViews7d || 0;
      usageLabel = usageSignal + ' views';
    } else if (prod === 'StoryForge' && productUsage.storyForge) {
      usageSignal = productUsage.storyForge.pageViews7d || 0;
      usageLabel = usageSignal + ' views';
    }

    // Cost (approx — campaign-based attribution)
    var attribCost = 0;
    Object.keys(productAgents[prod]).forEach(function (aid) {
      var agentCost = (costByAgent[aid] && costByAgent[aid].cost) || 0;
      // Divide by number of products this agent worked on (prevents double-counting)
      var agentProdCount = 0;
      PRODUCTS.forEach(function (p2) { if (productAgents[p2][aid]) agentProdCount += 1; });
      if (agentProdCount > 0) attribCost += agentCost / agentProdCount;
    });
    attribCost = +attribCost.toFixed(2);

    // Engagement
    var eng = productEngagement[prod];
    var engLabel = eng.posts7d + ' posts';
    var engScore = eng.totalLikes + eng.totalComments * 2 + eng.totalReposts * 3;

    // Research
    var res = productResearch[prod];

    // Traffic
    var traf = productTraffic[prod];
    var hasTraffic = traf.views7d > 0 || traf.viewsPrior7d > 0;

    // Verdict
    var hasUsage = usageSignal != null;
    var usageDelta = 0; // TODO: could track usage WoW if historical productUsage snapshots existed
    var verdict = _verdict(traf.deltaPct, usageDelta, hasTraffic, hasUsage);

    return {
      product: prod,
      usage: { signal: usageSignal, label: usageLabel, hasData: hasUsage },
      cost: { attributedWeekly: attribCost, approximate: true },
      engagement: { posts7d: eng.posts7d, score: engScore, label: engLabel },
      research: { activeCount: res.activeCount, daysSinceNewest: res.daysSinceNewest, latestFinding: res.latestFinding },
      traffic: { views7d: traf.views7d, viewsPrior7d: traf.viewsPrior7d, deltaPct: traf.deltaPct, hasData: hasTraffic },
      verdict: verdict
    };
  });

  // ── Strategic signals — derive 2-5 cross-cutting observations ──
  var strategicSignals = [];
  perProduct.forEach(function (p) {
    if (p.verdict === 'DECLINING' && p.engagement.posts7d === 0) {
      strategicSignals.push(p.product + ' traffic declining (' + p.traffic.deltaPct + '%) with zero social activity — Echo pivot opportunity.');
    }
    if (p.research.activeCount >= 2 && p.engagement.posts7d === 0) {
      strategicSignals.push(p.product + ' has ' + p.research.activeCount + ' active research intels but zero marketing surface — consider propose-campaign.');
    }
    if (p.verdict === 'GROWING' && p.traffic.deltaPct >= 30) {
      strategicSignals.push(p.product + ' traffic +' + p.traffic.deltaPct + '% WoW — ride the momentum, consider scaling the content angle.');
    }
    if (p.research.daysSinceNewest != null && p.research.daysSinceNewest >= 30 && p.verdict !== 'NO DATA') {
      strategicSignals.push(p.product + ' research intel stale ' + p.research.daysSinceNewest + 'd — Scout refresh request.');
    }
  });
  // Cap signals to top 5 (avoid prompt bloat)
  strategicSignals = strategicSignals.slice(0, 5);

  // Top growing / declining shortcuts
  var topGrowing = perProduct
    .filter(function (p) { return p.verdict === 'GROWING'; })
    .sort(function (a, b) { return b.traffic.deltaPct - a.traffic.deltaPct; });
  var topDeclining = perProduct
    .filter(function (p) { return p.verdict === 'DECLINING'; })
    .sort(function (a, b) { return a.traffic.deltaPct - b.traffic.deltaPct; });

  return {
    asOfUtc: new Date(now).toISOString(),
    perProduct: perProduct,
    topGrowing: topGrowing,
    topDeclining: topDeclining,
    strategicSignals: strategicSignals
  };
}

function _buildStrategicPromptBlock(agent, digest) {
  if (!digest || !agent) return '';
  var agentId = (agent.id || agent.name || '').toLowerCase();
  if (agentId !== 'nova') return '';
  if (!Array.isArray(digest.perProduct) || digest.perProduct.length === 0) return '';

  var lines = ['\n\nSTRATEGIC CROSS-PRODUCT DASHBOARD (7d, cost figures approximate):'];
  lines.push('');
  lines.push('Product      | Usage              | Cost (approx) | Engagement | Research      | Traffic        | Verdict');
  lines.push('---          | ---                | ---           | ---        | ---           | ---            | ---');
  digest.perProduct.forEach(function (p) {
    var row = [
      p.product.padEnd(12),
      (p.usage.label || 'no data').padEnd(18),
      ('$' + (p.cost.attributedWeekly || 0).toFixed(2)).padEnd(13),
      (p.engagement.label || '0 posts').padEnd(10),
      (p.research.activeCount + ' active' + (p.research.daysSinceNewest != null ? ' (' + p.research.daysSinceNewest + 'd)' : '')).padEnd(13),
      (p.traffic.hasData ? (p.traffic.views7d + ' views (' + (p.traffic.deltaPct >= 0 ? '+' : '') + p.traffic.deltaPct + '%)') : 'no data').padEnd(14),
      p.verdict
    ];
    lines.push(row.join(' | '));
  });

  if (digest.strategicSignals && digest.strategicSignals.length > 0) {
    lines.push('');
    lines.push('STRATEGIC SIGNALS:');
    digest.strategicSignals.forEach(function (s) {
      lines.push('- ' + s);
    });
  }

  lines.push('');
  lines.push('Use these verdicts to prioritize propose-campaign / pause-campaign / redirect-agent-focus decisions this cycle. Cost figures are campaign-attribution approximations — treat as directional, not precise.');

  return lines.join('\n');
}

module.exports = {
  buildStrategicDigest: buildStrategicDigest,
  _buildStrategicPromptBlock: _buildStrategicPromptBlock,
  PRODUCTS: PRODUCTS,
  _canonicalProduct: _canonicalProduct
};
