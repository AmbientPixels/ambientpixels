/* ═══════════════════════════════════════════════════════════
   Trends Radar — Data Layer
   Fetches trend data from Gemini via geminiproxy.
   Scoring engine, stage classifier, opportunity generator.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var GEMINI_ENDPOINT = '/api/geminiproxy';
  var TIMEOUT_MS = 45000;

  /* ── Constants ── */
  var CATEGORIES = [
    { id: 'ai_ml',           label: 'AI / ML' },
    { id: 'devtools',        label: 'Dev Tools' },
    { id: 'design',          label: 'Design' },
    { id: 'marketing',       label: 'Marketing' },
    { id: 'infrastructure',  label: 'Infrastructure' },
    { id: 'product',         label: 'Product' }
  ];

  var STAGES = [
    { id: 'early_signal', label: 'Early Signal', color: '#60a5fa', min: 0,  max: 30 },
    { id: 'emerging',     label: 'Emerging',     color: '#34d399', min: 30, max: 60 },
    { id: 'growing',      label: 'Growing',      color: '#fbbf24', min: 60, max: 85 },
    { id: 'exploding',    label: 'Exploding',    color: '#f87171', min: 85, max: 100 }
  ];

  var WEIGHTS = { searchGrowth: 0.4, socialVelocity: 0.4, devActivity: 0.2 };

  var CATEGORY_IDS = CATEGORIES.map(function (c) { return c.id; });

  /* ── Scoring Engine ── */
  function computeScore(t) {
    return Math.round(
      t.searchGrowth * WEIGHTS.searchGrowth +
      t.socialVelocity * WEIGHTS.socialVelocity +
      t.devActivity * WEIGHTS.devActivity
    );
  }

  function classifyStage(score) {
    for (var i = STAGES.length - 1; i >= 0; i--) {
      if (score >= STAGES[i].min) return STAGES[i];
    }
    return STAGES[0];
  }

  /* ── Clamp helper ── */
  function clamp(v, lo, hi) {
    v = parseInt(v, 10);
    if (isNaN(v)) return lo;
    return Math.max(lo, Math.min(hi, v));
  }

  /* ── Gemini Prompt ── */
  var TREND_PROMPT = [
    'You are a technology trend analyst. Return exactly 12 current, real technology trends as a JSON array.',
    'Each trend object must have these fields:',
    '  name (string) — short trend name, 2-5 words',
    '  category (string) — one of: ai_ml, devtools, design, marketing, infrastructure, product',
    '  description (string) — 1-2 sentence explanation of what this trend is',
    '  searchGrowth (integer 0-100) — estimated search interest growth rate',
    '  socialVelocity (integer 0-100) — estimated social media buzz level',
    '  devActivity (integer 0-100) — estimated developer/builder activity level',
    '  history (array of 6 integers 0-100) — estimated momentum over 6 periods, ending near searchGrowth',
    '  relevance (string) — 1 sentence on why this matters for an AI-powered marketing/ops platform',
    '  signals (array of 3 strings) — specific recent events, launches, or data points driving this trend',
    '',
    'Requirements:',
    '- Use REAL current trends, not made-up ones. Ground in actual technology movements.',
    '- Spread across all 6 categories. At least 1 trend per category.',
    '- Include a mix of stages: some early (scores 10-30), some emerging (30-60), some growing (60-85), some exploding (85+).',
    '- Signals should reference real companies, products, or events.',
    '- history array should show realistic growth trajectory ending at or near searchGrowth value.',
    '',
    'Return ONLY the JSON array, no markdown fences, no explanation.'
  ].join('\n');

  /* ── Parse Gemini Response ── */
  function parseGeminiResponse(data) {
    var text = '';
    try {
      text = data.candidates[0].content.parts[0].text;
    } catch (e) {
      throw new Error('Unexpected Gemini response structure');
    }

    // Strip markdown fences if present
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // Try to extract JSON array from response
      var match = text.match(/\[[\s\S]*\]/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse trend data from Gemini response');
      }
    }

    if (!Array.isArray(parsed) || !parsed.length) {
      throw new Error('Gemini returned empty or non-array data');
    }

    // Normalize and validate each trend
    return parsed.map(function (t, i) {
      var cat = CATEGORY_IDS.indexOf(t.category) !== -1 ? t.category : 'ai_ml';
      var sg = clamp(t.searchGrowth, 0, 100);
      var sv = clamp(t.socialVelocity, 0, 100);
      var da = clamp(t.devActivity, 0, 100);

      var history = Array.isArray(t.history) && t.history.length >= 3
        ? t.history.slice(0, 6).map(function (v) { return clamp(v, 0, 100); })
        : [0, Math.round(sg * 0.2), Math.round(sg * 0.4), Math.round(sg * 0.6), Math.round(sg * 0.8), sg];

      var signals = Array.isArray(t.signals) ? t.signals.slice(0, 3) : [];
      while (signals.length < 3) signals.push('Emerging signal');

      return {
        id: 'tr-' + String(i + 1).padStart(3, '0'),
        name: String(t.name || 'Unnamed Trend').slice(0, 80),
        category: cat,
        description: String(t.description || '').slice(0, 300),
        searchGrowth: sg,
        socialVelocity: sv,
        devActivity: da,
        history: history,
        relevance: String(t.relevance || '').slice(0, 200),
        signals: signals.map(function (s) { return String(s).slice(0, 100); })
      };
    });
  }

  /* ── Fetch Trends from Gemini ── */
  function fetchTrends() {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    return fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: TREND_PROMPT }),
      signal: controller.signal
    })
    .then(function (res) {
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('Gemini request failed (' + res.status + ')');
      return res.json();
    })
    .then(function (data) {
      var trends = parseGeminiResponse(data);

      // Compute scores and stages
      trends.forEach(function (t) {
        t.score = computeScore(t);
        t.stage = classifyStage(t.score);
      });

      // Store in module
      TRENDS = trends;
      window.TrendsData.trends = trends;

      return trends;
    })
    .catch(function (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error('Trend analysis timed out — please try again');
      throw err;
    });
  }

  /* ── Opportunity Generator ── */
  var OPP_TEMPLATES = {
    blog_post:       { icon: 'fa-pen-fancy',   effort: 'Medium', impact: 'High' },
    social_post:     { icon: 'fa-share-nodes',  effort: 'Low',    impact: 'Medium' },
    video_topic:     { icon: 'fa-video',        effort: 'High',   impact: 'High' },
    campaign_angle:  { icon: 'fa-bullhorn',     effort: 'Medium', impact: 'High' }
  };

  function generateOpportunities(trend) {
    return [
      {
        type: 'blog_post',
        title: 'The Rise of ' + trend.name,
        description: 'Deep-dive into how ' + trend.name.toLowerCase() + ' is reshaping the industry and what it means for AI-native companies.',
        effort: OPP_TEMPLATES.blog_post.effort,
        impact: OPP_TEMPLATES.blog_post.impact,
        icon: OPP_TEMPLATES.blog_post.icon
      },
      {
        type: 'social_post',
        title: trend.name + ' is moving fast',
        description: 'Key signals: ' + trend.signals.slice(0, 2).join(', ') + '. Share perspective on LinkedIn with a hot take.',
        effort: OPP_TEMPLATES.social_post.effort,
        impact: OPP_TEMPLATES.social_post.impact,
        icon: OPP_TEMPLATES.social_post.icon
      },
      {
        type: 'video_topic',
        title: 'We Tested ' + trend.name + ' \u2014 Here\'s What Happened',
        description: 'Hands-on exploration comparing top tools in the ' + trend.name.toLowerCase() + ' space.',
        effort: OPP_TEMPLATES.video_topic.effort,
        impact: OPP_TEMPLATES.video_topic.impact,
        icon: OPP_TEMPLATES.video_topic.icon
      },
      {
        type: 'campaign_angle',
        title: 'Position AmbientOS as ' + trend.name + ' Leader',
        description: trend.relevance + ' Build a campaign around this angle to capture search and social interest.',
        effort: OPP_TEMPLATES.campaign_angle.effort,
        impact: OPP_TEMPLATES.campaign_angle.impact,
        icon: OPP_TEMPLATES.campaign_angle.icon
      }
    ];
  }

  /* ── Public API ── */
  var TRENDS = [];

  window.TrendsData = {
    CATEGORIES: CATEGORIES,
    STAGES: STAGES,
    WEIGHTS: WEIGHTS,
    trends: TRENDS,
    computeScore: computeScore,
    classifyStage: classifyStage,
    generateOpportunities: generateOpportunities,
    fetchTrends: fetchTrends,

    getByCategory: function (cat) {
      return window.TrendsData.trends.filter(function (t) { return t.category === cat; });
    },
    getByStage: function (stage) {
      return window.TrendsData.trends.filter(function (t) { return t.stage.id === stage; });
    },
    getSorted: function (field) {
      field = field || 'score';
      return window.TrendsData.trends.slice().sort(function (a, b) { return (b[field] || 0) - (a[field] || 0); });
    },
    getCategoryLabel: function (id) {
      var c = CATEGORIES.find(function (cat) { return cat.id === id; });
      return c ? c.label : id;
    }
  };
})();
