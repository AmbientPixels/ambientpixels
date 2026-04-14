// content-intel.js — Content Intelligence Dashboard for Scribe / Pixel / Quill
// Mirrors finance-intel.js / ops-intel.js / performance-intel.js pattern:
// build a digest from raw state, then format role-specific prompt blocks.
//
// Digest answers:
//   - Scribe: which blog posts performed, what's stuck in the draft→publish funnel, which
//             Quill correction patterns keep recurring.
//   - Pixel:  which hero-image assets correlate with high-view posts, which design gaps
//             are widening.
//   - Quill:  summary of his own recurring correction patterns so he can decide whether to
//             raise them with Scribe directly vs flagging each instance.

var { CONTENT_INTEL_FRESHNESS_MS } = require('./constants');

var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Regex bucket for Quill's recurring correction themes (CEO decision — deterministic
// over Gemini-clustering). Extend this list as new recurring patterns emerge.
var QUILL_PATTERN_BUCKETS = [
  { id: 'em_dashes',          re: /\b(?:em[\s-]*dash|—)\b/i,                         label: 'em dashes' },
  { id: 'passive_voice',      re: /\b(?:passive voice|passive construction)\b/i,     label: 'passive voice' },
  { id: 'hype_words',         re: /\b(?:hype|buzzword|jargon|corporate(?:\s+speak)?)\b/i, label: 'hype / buzzwords' },
  { id: 'redundancy',         re: /\b(?:redundan|repeat|restate|repetitive)\b/i,     label: 'redundant phrasing' },
  { id: 'weak_cta',           re: /\b(?:weak\s+cta|unclear\s+cta|cta\s+(?:missing|vague))\b/i, label: 'weak or missing CTA' },
  { id: 'opening_hook',       re: /\b(?:lede|lead|opening|hook|first\s+line|first\s+sentence)\b/i, label: 'opening hook / lede' },
  { id: 'wordy',              re: /\b(?:wordy|verbose|tighten|cut|compress|trim)\b/i, label: 'too wordy / tighten' },
  { id: 'tone_off',           re: /\b(?:tone|voice|formal|casual|register)\b/i,      label: 'tone / voice' },
  { id: 'unclear',            re: /\b(?:unclear|ambiguous|vague|confusing|specifics)\b/i, label: 'unclear / needs specifics' }
];

function _bucketQuillComments(comments) {
  var hits = {};
  comments.forEach(function (text) {
    if (!text || typeof text !== 'string') return;
    QUILL_PATTERN_BUCKETS.forEach(function (b) {
      if (b.re.test(text)) {
        if (!hits[b.id]) hits[b.id] = { id: b.id, label: b.label, count: 0, examples: [] };
        hits[b.id].count += 1;
        if (hits[b.id].examples.length < 3) {
          hits[b.id].examples.push(text.length > 120 ? text.substring(0, 120) + '…' : text);
        }
      }
    });
  });
  return Object.values(hits).sort(function (a, b) { return b.count - a.count; });
}

function buildContentDigest(state, existingDigest, nowMs) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();

  // Freshness check — reuse if recent enough.
  var existingAsOf = existingDigest && existingDigest.asOfUtc ? Date.parse(existingDigest.asOfUtc) : NaN;
  if (existingDigest && Number.isFinite(existingAsOf) && (now - existingAsOf) < CONTENT_INTEL_FRESHNESS_MS) {
    return existingDigest;
  }

  state = state || {};
  var blogPosts = Array.isArray(state.blogPosts) ? state.blogPosts : [];
  var blogPostViews = Array.isArray(state.blogPostViews) ? state.blogPostViews : [];
  var documents = Array.isArray(state.documents) ? state.documents : [];
  var actions = Array.isArray(state.actions) ? state.actions : [];
  var tasks = Array.isArray(state.tasks) ? state.tasks : [];

  var sevenCutoff = now - SEVEN_DAYS_MS;
  var thirtyCutoff = now - THIRTY_DAYS_MS;

  // ── Views aggregated by slug ──
  var viewsBySlug = {};
  blogPostViews.forEach(function (v) {
    if (!v || !v.slug) return;
    var ts = Date.parse(v.timestamp || '');
    if (!Number.isFinite(ts)) return;
    if (!viewsBySlug[v.slug]) viewsBySlug[v.slug] = { views7d: 0, views30d: 0 };
    if (ts >= thirtyCutoff) viewsBySlug[v.slug].views30d += 1;
    if (ts >= sevenCutoff) viewsBySlug[v.slug].views7d += 1;
  });

  // ── Top blog posts (last 30d published, ranked by 30d views) ──
  var topBlogPosts = blogPosts
    .filter(function (p) {
      if (!p || !p.slug) return false;
      var pubTs = Date.parse(p.published_at || p.created_at || '');
      return Number.isFinite(pubTs) && pubTs >= thirtyCutoff;
    })
    .map(function (p) {
      var v = viewsBySlug[p.slug] || { views7d: 0, views30d: 0 };
      return {
        slug: p.slug,
        title: p.title || '(untitled)',
        author: p.created_by || 'unknown',
        heroAssetId: p.hero_image_asset_id || null,
        views7d: v.views7d,
        views30d: v.views30d,
        publishedAt: p.published_at || p.created_at || null
      };
    })
    .sort(function (a, b) { return b.views30d - a.views30d; })
    .slice(0, 10);

  // Median views for hero-vs-median comparison
  var viewsSorted = topBlogPosts.map(function (p) { return p.views7d; }).sort(function (a, b) { return a - b; });
  var medianViews7d = viewsSorted.length > 0
    ? (viewsSorted.length % 2 === 0
        ? (viewsSorted[viewsSorted.length / 2 - 1] + viewsSorted[viewsSorted.length / 2]) / 2
        : viewsSorted[Math.floor(viewsSorted.length / 2)])
    : 0;

  // ── Hero image performance (Pixel cares) ──
  var heroImagePerformance = topBlogPosts
    .filter(function (p) { return p.heroAssetId; })
    .map(function (p) {
      return {
        assetId: p.heroAssetId,
        postSlug: p.slug,
        postTitle: p.title,
        views7d: p.views7d,
        viewsVsMedian: medianViews7d > 0 ? +(p.views7d / medianViews7d).toFixed(2) : null
      };
    })
    .sort(function (a, b) { return b.views7d - a.views7d; });

  // ── Pipeline stats (Scribe cares) ──
  var scribeDrafts7d = documents.filter(function (d) {
    if (!d || d.created_by !== 'scribe') return false;
    var ts = Date.parse(d.created_at || '');
    return Number.isFinite(ts) && ts >= sevenCutoff;
  }).length;

  var quillReviews7d = 0;
  tasks.forEach(function (t) {
    if (!t || !Array.isArray(t.comments)) return;
    t.comments.forEach(function (c) {
      if (!c || c.author !== 'quill' || c.type !== 'review') return;
      var ts = Date.parse(c.createdAt || '');
      if (Number.isFinite(ts) && ts >= sevenCutoff) quillReviews7d += 1;
    });
  });

  // Publish-related actions (CEO approval rate)
  var publishActions7d = actions.filter(function (a) {
    if (!a || a.type !== 'publish_document') return false;
    var ts = Date.parse(a.created_at || a.timestamp || '');
    return Number.isFinite(ts) && ts >= sevenCutoff;
  });
  var publishApproved = publishActions7d.filter(function (a) {
    return a.approval && (a.approval.status === 'approved' || a.approval.decision === 'approve');
  }).length;
  var ceoApprovalRate7d = publishActions7d.length > 0 ? +(publishApproved / publishActions7d.length).toFixed(2) : null;

  // Avg days from document creation to publish (approximate)
  var durationSamples = [];
  blogPosts.forEach(function (p) {
    if (!p || !p.published_at) return;
    // Try to find the source document by slug/title match
    var srcDoc = documents.find(function (d) {
      return d && (d.slug === p.slug || (d.title && p.title && d.title === p.title));
    });
    if (srcDoc && srcDoc.created_at) {
      var dTs = Date.parse(srcDoc.created_at);
      var pTs = Date.parse(p.published_at);
      if (Number.isFinite(dTs) && Number.isFinite(pTs) && pTs > dTs && pTs >= thirtyCutoff) {
        durationSamples.push((pTs - dTs) / (24 * 60 * 60 * 1000));
      }
    }
  });
  var avgDaysToPublish = durationSamples.length > 0
    ? +(durationSamples.reduce(function (s, d) { return s + d; }, 0) / durationSamples.length).toFixed(1)
    : null;

  // ── Quill correction themes (regex bucket — CEO decision, no Gemini) ──
  var quillComments = [];
  tasks.forEach(function (t) {
    if (!t || !Array.isArray(t.comments)) return;
    t.comments.forEach(function (c) {
      if (!c || c.author !== 'quill' || c.type !== 'review') return;
      var ts = Date.parse(c.createdAt || '');
      if (Number.isFinite(ts) && ts >= sevenCutoff) {
        quillComments.push(c.text || c.feedback || '');
      }
    });
  });
  var quillCorrectionThemes = _bucketQuillComments(quillComments);

  // ── Top authors (for Scribe benchmarking — who's writing the highest-traffic posts) ──
  var authorAgg = {};
  topBlogPosts.forEach(function (p) {
    var a = p.author || 'unknown';
    if (!authorAgg[a]) authorAgg[a] = { author: a, posts30d: 0, totalViews30d: 0 };
    authorAgg[a].posts30d += 1;
    authorAgg[a].totalViews30d += p.views30d;
  });
  var topAuthors = Object.values(authorAgg)
    .map(function (a) {
      return {
        author: a.author,
        posts30d: a.posts30d,
        totalViews30d: a.totalViews30d,
        avgViewsPerPost: a.posts30d > 0 ? Math.round(a.totalViews30d / a.posts30d) : 0
      };
    })
    .sort(function (a, b) { return b.totalViews30d - a.totalViews30d; });

  return {
    asOfUtc: new Date(now).toISOString(),
    topBlogPosts: topBlogPosts,
    medianViews7d: medianViews7d,
    heroImagePerformance: heroImagePerformance,
    pipelineStats: {
      scribeDrafts7d: scribeDrafts7d,
      quillReviews7d: quillReviews7d,
      ceoApprovalRate7d: ceoApprovalRate7d,
      publishActions7d: publishActions7d.length,
      avgDaysToPublish: avgDaysToPublish
    },
    quillCorrectionThemes: quillCorrectionThemes,
    topAuthors: topAuthors
  };
}

function _buildContentPromptBlock(agent, digest) {
  if (!digest || !agent) return '';
  var agentId = (agent.id || agent.name || '').toLowerCase();
  if (['scribe', 'pixel', 'quill'].indexOf(agentId) === -1) return '';

  var lines = ['\n\nCONTENT INTELLIGENCE DASHBOARD (7d/30d windows):'];

  if (agentId === 'scribe') {
    // Scribe: top blog posts, pipeline funnel, Quill correction themes
    var topPosts = digest.topBlogPosts || [];
    if (topPosts.length > 0) {
      lines.push('\nTOP BLOG POSTS (last 30d, by 30d views):');
      topPosts.slice(0, 5).forEach(function (p) {
        var byYou = p.author === 'scribe' ? ' ← YOUR POST' : '';
        var vsMedian = digest.medianViews7d > 0
          ? ' (' + (p.views7d / digest.medianViews7d).toFixed(1) + 'x 7d median)'
          : '';
        lines.push('- "' + (p.title || '').substring(0, 60) + '" — ' + p.views30d + ' views 30d, ' + p.views7d + ' views 7d' + vsMedian + byYou);
      });
    } else {
      lines.push('\nTOP BLOG POSTS: no posts with attributable views in the last 30d.');
    }

    var ps = digest.pipelineStats || {};
    lines.push('\nDRAFT→PUBLISH PIPELINE (7d):');
    lines.push('- Your drafts: ' + (ps.scribeDrafts7d || 0) + ' | Quill reviews: ' + (ps.quillReviews7d || 0) + ' | Publishes attempted: ' + (ps.publishActions7d || 0));
    if (ps.ceoApprovalRate7d != null) {
      lines.push('- CEO approval rate on publish: ' + Math.round(ps.ceoApprovalRate7d * 100) + '%');
    }
    if (ps.avgDaysToPublish != null) {
      lines.push('- Avg draft→publish time: ' + ps.avgDaysToPublish + ' days');
    }

    var themes = digest.quillCorrectionThemes || [];
    if (themes.length > 0) {
      lines.push('\nRECURRING QUILL CORRECTIONS (7d — address these in your drafting):');
      themes.slice(0, 5).forEach(function (t) {
        lines.push('- ' + t.label + ' × ' + t.count);
      });
      lines.push('Bake these into your drafting habits — Quill flagging the same patterns weekly means the feedback isn\'t sticking.');
    }
  }

  if (agentId === 'pixel') {
    // Pixel: hero-image-to-traffic correlation, design gap hints
    var hero = digest.heroImagePerformance || [];
    if (hero.length > 0) {
      lines.push('\nHERO IMAGE PERFORMANCE (last 30d posts, ranked by 7d views):');
      hero.slice(0, 8).forEach(function (h) {
        var vsMedian = h.viewsVsMedian != null ? ' (' + h.viewsVsMedian + 'x median)' : '';
        lines.push('- asset `' + h.assetId + '` on "' + (h.postTitle || '').substring(0, 50) + '" — ' + h.views7d + ' views' + vsMedian);
      });
      // Group by asset to show which assets consistently perform
      var assetAgg = {};
      hero.forEach(function (h) {
        if (!assetAgg[h.assetId]) assetAgg[h.assetId] = { assetId: h.assetId, uses: 0, totalViews: 0 };
        assetAgg[h.assetId].uses += 1;
        assetAgg[h.assetId].totalViews += h.views7d;
      });
      var assetRanking = Object.values(assetAgg)
        .filter(function (a) { return a.uses >= 2; })
        .sort(function (a, b) { return (b.totalViews / b.uses) - (a.totalViews / a.uses); })
        .slice(0, 3);
      if (assetRanking.length > 0) {
        lines.push('\nBEST-PERFORMING HERO ASSETS (≥2 uses, by avg views):');
        assetRanking.forEach(function (a) {
          lines.push('- ' + a.assetId + ': ' + a.uses + ' uses, avg ' + Math.round(a.totalViews / a.uses) + ' views/post');
        });
        lines.push('Favor these presets when Scribe ships new posts in matching product lines.');
      }
    } else {
      lines.push('\nHERO IMAGE PERFORMANCE: no hero-tagged posts with view data in the last 30d.');
    }
  }

  if (agentId === 'quill') {
    // Quill: his OWN correction themes so he can decide whether to flag patterns
    // proactively vs review-by-review.
    var themes = digest.quillCorrectionThemes || [];
    if (themes.length > 0) {
      lines.push('\nYOUR RECURRING CORRECTIONS (7d):');
      themes.slice(0, 6).forEach(function (t) {
        lines.push('- ' + t.label + ' × ' + t.count + (t.examples.length > 0 ? ' — e.g. "' + t.examples[0] + '"' : ''));
      });
      if (themes[0] && themes[0].count >= 3) {
        lines.push('\nPattern flagged ≥3× this week: "' + themes[0].label + '". Consider raising this directly with Scribe as a drafting guideline rather than flagging instance-by-instance.');
      }
    } else {
      lines.push('\nNo review comments in the last 7d — either nothing to review or content quality is high.');
    }

    var ps = digest.pipelineStats || {};
    if ((ps.quillReviews7d || 0) > 0) {
      lines.push('\nYour throughput (7d): ' + ps.quillReviews7d + ' reviews across ' + (ps.scribeDrafts7d || 0) + ' Scribe drafts.');
    }
  }

  return lines.join('\n');
}

module.exports = {
  buildContentDigest: buildContentDigest,
  _buildContentPromptBlock: _buildContentPromptBlock,
  _bucketQuillComments: _bucketQuillComments,
  QUILL_PATTERN_BUCKETS: QUILL_PATTERN_BUCKETS
};
