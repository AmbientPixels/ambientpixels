// performance-intel.js — AutoResearch-inspired agent performance scoring
// Mirrors social-intel.js pattern: digest builder + prompt block formatter
// Aggregates 14 signal sources into per-agent quality scores fed back into heartbeat prompts.

const { PERFORMANCE_INTEL_FRESHNESS_MS, PERFORMANCE_INTEL_WINDOW_DAYS, AGENT_IDS,
  MAX_PERFORMANCE_INSIGHTS_PER_DAY, MAX_EXPERIMENTS_PER_AGENT,
  EXPERIMENT_MIN_SAMPLES, EXPERIMENT_IMPROVEMENT_THRESHOLD } = require('./constants');

// ── Content Hook Classifier ──
// Classifies social post text into hook type for engagement correlation

var HOOK_PATTERNS = [
  { hook: 'question', re: /\?/ },
  { hook: 'statistic', re: /\d+%|\d+x|\d+\.\d+|\b\d{2,}\b.*(?:increase|decrease|growth|drop|rise|users|customers)/ },
  { hook: 'storytelling', re: /\b(?:story|journey|when I|once upon|imagine|picture this|here's what happened)\b/i },
  { hook: 'quote', re: /[""\u201C\u201D].{10,}[""\u201C\u201D]/ },
  { hook: 'listicle', re: /\b(?:\d+\s+(?:ways|tips|reasons|steps|things|lessons|mistakes))\b/i },
  { hook: 'cta', re: /\b(?:check out|try|sign up|join|download|learn more|get started|don't miss|register)\b/i },
  { hook: 'contrarian', re: /\b(?:unpopular opinion|hot take|controversial|actually|myth|wrong about|stop doing)\b/i },
  { hook: 'announcement', re: /\b(?:launching|announcing|introducing|just shipped|now available|new feature|released)\b/i }
];

function classifyHook(text) {
  if (!text || typeof text !== 'string') return 'general';
  for (var i = 0; i < HOOK_PATTERNS.length; i++) {
    if (HOOK_PATTERNS[i].re.test(text)) return HOOK_PATTERNS[i].hook;
  }
  return 'general';
}

// ── Performance Digest Builder ──

function buildPerformanceDigest(tasks, actions, engagementSnapshots, existingDigest, nowMs, opts) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();

  // Freshness check — reuse existing digest if recent enough
  var existingAsOf = existingDigest && existingDigest.asOfUtc ? Date.parse(existingDigest.asOfUtc) : NaN;
  if (existingDigest && Number.isFinite(existingAsOf) && (now - existingAsOf) < PERFORMANCE_INTEL_FRESHNESS_MS) {
    return existingDigest;
  }

  opts = opts || {};
  var heartbeatRuns = Array.isArray(opts.heartbeatRuns) ? opts.heartbeatRuns : [];
  var geminiUsage = Array.isArray(opts.geminiUsage) ? opts.geminiUsage : [];
  var governanceLog = Array.isArray(opts.governanceLog) ? opts.governanceLog : [];
  var blogPostViews = Array.isArray(opts.blogPostViews) ? opts.blogPostViews : [];

  var windowMs = PERFORMANCE_INTEL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  var cutoff = now - windowMs;
  var taskArr = Array.isArray(tasks) ? tasks : [];
  var actionArr = Array.isArray(actions) ? actions : [];
  var snapshots = Array.isArray(engagementSnapshots) ? engagementSnapshots : [];

  var agents = {};
  AGENT_IDS.forEach(function (id) {
    agents[id] = {
      // Original signals
      peerReviewsReceived: 0,
      peerReviewApproved: 0,
      peerReviewChangesRequested: 0,
      peerReviewApprovalRate: 0,
      ceoActionsSubmitted: 0,
      ceoApproved: 0,
      ceoRevisionRequested: 0,
      ceoRejected: 0,
      ceoApprovalRate: 0,
      ceoStarRatings: [],
      ceoAvgStarRating: 0,
      avgRevisionsBeforeApproval: 0,
      avgTaskDurationHours: 0,
      tasksCompleted: 0,
      socialPostsPublished: 0,
      avgLikesPerPost: 0,
      avgCommentsPerPost: 0,
      topPostLikes: 0,
      topPostPlatform: '',
      topPostSnippet: '',
      ceoRevisionNotes: [],

      // New signal 1: Action block rate
      actionsAttempted: 0,
      actionsBlocked: 0,
      blockRate: 0,

      // New signal 2: Task churn (comment count before done)
      avgCommentsBeforeDone: 0,
      _totalCommentsBeforeDone: 0,

      // New signal 3: Cross-agent handoff quality
      handoffsReceived: 0,
      handoffsPassedFirstReview: 0,
      handoffFirstPassRate: 0,

      // New signal 4: Governance violations
      governanceViolations: 0,

      // New signal 5: Approval queue aging (time CEO takes to decide)
      avgApprovalWaitHours: 0,
      _totalApprovalWaitMs: 0,
      _approvalWaitCount: 0,

      // New signal 6: Deliverable length stats
      avgDeliverableLength: 0,
      _totalDeliverableLength: 0,
      _deliverableCount: 0,

      // New signal 7: Content hook analysis (social posts)
      hookBreakdown: {},
      hookEngagement: {},

      // New signal 8: Token/cost efficiency
      totalTokens: 0,
      totalCost: 0,
      avgTokensPerTask: 0,

      // New signal 9: Time-of-day performance
      bestHour: null,
      _hourlyScores: {},

      // New signal 10: Research intel acceptance (Scout)
      researchSubmitted: 0,
      researchAccepted: 0,
      researchAcceptRate: 0,

      // New signal 11: Blog post views (Scribe)
      blogPostsPublished: 0,
      avgBlogViews: 0,

      // Composite
      qualityScore: 0,
      qualityTrend: 'stable',
      previousScore: 0,

      // Role-aware fields (populated for relevant role types)
      roleType: (id === 'nova' || id === 'cipher') ? 'orchestrator'
        : (id === 'quill') ? 'reviewer'
        : (id === 'scout') ? 'researcher'
        : (id === 'pixel') ? 'specialist_design'
        : (id === 'forge') ? 'specialist_ops'
        : 'producer',
      delegatedTasks: 0,
      delegatedTasksDone: 0,
      reviewsGiven: 0
    };
  });

  // ── Scan tasks for peer review, churn, handoff, deliverable length ──
  for (var i = 0; i < taskArr.length; i++) {
    var task = taskArr[i];
    if (!task) continue;
    var assignee = (task.assignee || '').toLowerCase();
    if (!agents[assignee]) continue;

    var createdTs = Date.parse(task.createdAt || '');
    var updatedTs = Date.parse(task.updatedAt || '');
    var taskTs = Number.isFinite(updatedTs) ? updatedTs : (Number.isFinite(createdTs) ? createdTs : 0);
    if (taskTs < cutoff) continue;

    var comments = task.comments || [];

    // Peer reviews on this agent's tasks
    for (var c = 0; c < comments.length; c++) {
      var cmt = comments[c];
      if (cmt.type === 'review' && cmt.verdict) {
        var cmtTs = Date.parse(cmt.createdAt || '');
        if (Number.isFinite(cmtTs) && cmtTs < cutoff) continue;
        agents[assignee].peerReviewsReceived += 1;
        if (cmt.verdict === 'approved') agents[assignee].peerReviewApproved += 1;
        else if (cmt.verdict === 'changes-requested') agents[assignee].peerReviewChangesRequested += 1;
      }
    }

    // Completed tasks: turnaround, churn, deliverable length
    if (task.status === 'done') {
      if (Number.isFinite(createdTs) && Number.isFinite(updatedTs)) {
        agents[assignee].tasksCompleted += 1;
        agents[assignee].avgTaskDurationHours += (updatedTs - createdTs) / (1000 * 60 * 60);
      }

      // Churn: total comments before task reached done
      agents[assignee]._totalCommentsBeforeDone += comments.length;

      // Deliverable length
      for (var dl = 0; dl < comments.length; dl++) {
        if (comments[dl].type === 'deliverable' && comments[dl].text) {
          agents[assignee]._totalDeliverableLength += comments[dl].text.length;
          agents[assignee]._deliverableCount += 1;
        }
      }
    }

    // Cross-agent handoff: task created by one agent, completed by another
    var createdBy = (task.created_by || '').toLowerCase();
    if (createdBy && createdBy !== assignee && agents[assignee] && task.status === 'done') {
      agents[assignee].handoffsReceived += 1;
      // Check if first review was approved (no changes-requested before first approved)
      var firstReviewApproved = false;
      for (var hr = 0; hr < comments.length; hr++) {
        if (comments[hr].type === 'review' && comments[hr].verdict) {
          firstReviewApproved = comments[hr].verdict === 'approved';
          break;
        }
      }
      if (firstReviewApproved) agents[assignee].handoffsPassedFirstReview += 1;
    }
  }

  // ── Scan actions for CEO approval signals + block rate + aging + star ratings ──
  for (var j = 0; j < actionArr.length; j++) {
    var action = actionArr[j];
    if (!action) continue;
    var actionTs = Date.parse(action.createdAt || action.timestamp || '');
    if (Number.isFinite(actionTs) && actionTs < cutoff) continue;
    var agentId = (action.created_by || action.origin_agent || '').toLowerCase();
    if (!agents[agentId]) continue;

    // Count all action attempts (for block rate calculation from heartbeat perAgent)
    agents[agentId].actionsAttempted += 1;

    if (action.approval) {
      var status = action.approval.status;
      if (status === 'approved' || status === 'revision_requested' || status === 'rejected' || status === 'pending') {
        agents[agentId].ceoActionsSubmitted += 1;
      }
      if (status === 'approved') {
        agents[agentId].ceoApproved += 1;
        agents[agentId].avgRevisionsBeforeApproval += (action.approval.revision_count || 0);

        // Approval wait time
        var approvedTs = Date.parse(action.approval.approved_at || '');
        if (Number.isFinite(approvedTs) && Number.isFinite(actionTs)) {
          agents[agentId]._totalApprovalWaitMs += (approvedTs - actionTs);
          agents[agentId]._approvalWaitCount += 1;
        }

        // Star rating (if CEO rated)
        if (Number.isFinite(action.approval.star_rating) && action.approval.star_rating >= 1 && action.approval.star_rating <= 5) {
          agents[agentId].ceoStarRatings.push(action.approval.star_rating);
        }
      } else if (status === 'revision_requested') {
        agents[agentId].ceoRevisionRequested += 1;
        var note = (action.approval.decision_note || '').trim();
        if (note) agents[agentId].ceoRevisionNotes.push(note);
      } else if (status === 'rejected') {
        agents[agentId].ceoRejected += 1;
        var rejNote = (action.approval.decision_note || '').trim();
        if (rejNote) agents[agentId].ceoRevisionNotes.push(rejNote);
      }

      // Research intel acceptance (Scout-specific)
      if (action.type === 'research_intel.approve') {
        var riAgent = (action._createdByAgent || action.created_by || '').toLowerCase();
        if (agents[riAgent]) {
          agents[riAgent].researchSubmitted += 1;
          if (status === 'approved') agents[riAgent].researchAccepted += 1;
        }
      }
    }

    // Content hook classification for social actions
    if (action.type === 'create-social-action' && action.payload) {
      var postText = action.payload.text || action.payload.content || '';
      var hook = classifyHook(postText);
      if (!agents[agentId].hookBreakdown[hook]) agents[agentId].hookBreakdown[hook] = 0;
      agents[agentId].hookBreakdown[hook] += 1;
    }
  }

  // ── Block rate from heartbeat runs (perAgent.actionsBlocked) ──
  for (var hb = 0; hb < heartbeatRuns.length; hb++) {
    var run = heartbeatRuns[hb];
    if (!run || !run.perAgent) continue;
    var runTs = Date.parse(run.startedAt || '');
    if (Number.isFinite(runTs) && runTs < cutoff) continue;
    var perAgent = run.perAgent;
    Object.keys(perAgent).forEach(function (aid) {
      if (!agents[aid]) return;
      var pa = perAgent[aid];
      agents[aid].actionsBlocked += (pa.actionsBlocked || 0);

      // Time-of-day: track which hour this agent performed in
      if (Number.isFinite(runTs)) {
        var hour = new Date(runTs).getUTCHours();
        if (!agents[aid]._hourlyScores[hour]) agents[aid]._hourlyScores[hour] = { runs: 0, executed: 0 };
        agents[aid]._hourlyScores[hour].runs += 1;
        agents[aid]._hourlyScores[hour].executed += (pa.actionsExecuted || 0);
      }
    });
  }

  // ── Governance violations per agent ──
  for (var gv = 0; gv < governanceLog.length; gv++) {
    var gEntry = governanceLog[gv];
    if (!gEntry) continue;
    var gTs = Date.parse(gEntry.timestamp || '');
    if (Number.isFinite(gTs) && gTs < cutoff) continue;
    var gAgent = (gEntry.data && gEntry.data.agent) || '';
    if (gAgent && agents[gAgent]) agents[gAgent].governanceViolations += 1;
  }

  // ── Token/cost efficiency from Gemini usage ──
  for (var gu = 0; gu < geminiUsage.length; gu++) {
    var usage = geminiUsage[gu];
    if (!usage) continue;
    var uTs = Date.parse(usage.timestamp || '');
    if (Number.isFinite(uTs) && uTs < cutoff) continue;
    var uAgent = (usage.agentId || '').toLowerCase();
    if (!uAgent || !agents[uAgent]) continue;
    agents[uAgent].totalTokens += (usage.totalTokens || 0);
    agents[uAgent].totalCost += (usage.totalCost || 0);
  }

  // ── Social engagement per agent + hook correlation ──
  var agentPostEngagement = {};
  for (var s = 0; s < snapshots.length; s++) {
    var snap = snapshots[s];
    if (!snap) continue;
    var snapTs = Date.parse(snap.captured_at || '');
    if (Number.isFinite(snapTs) && snapTs < cutoff) continue;
    var snapAgent = (snap.agent_id || '').toLowerCase();
    if (!snapAgent || !agents[snapAgent]) continue;
    var postKey = (snap.post_platform || '') + '|' + (snap.post_id || snap.action_id || '');
    if (!agentPostEngagement[snapAgent]) agentPostEngagement[snapAgent] = {};
    if (!agentPostEngagement[snapAgent][postKey]) {
      agentPostEngagement[snapAgent][postKey] = {
        likes: 0, comments: 0, reposts: 0,
        platform: snap.post_platform || '',
        snippet: '',
        hook: null
      };
    }
    var m = snap.metrics || {};
    agentPostEngagement[snapAgent][postKey].likes += (Number.isFinite(m.likes) ? m.likes : 0);
    agentPostEngagement[snapAgent][postKey].comments += (Number.isFinite(m.comments) ? m.comments : 0);
    agentPostEngagement[snapAgent][postKey].reposts += (Number.isFinite(m.reposts) ? m.reposts : 0);
  }

  // Match engagement to hook types via action cross-reference
  for (var aj = 0; aj < actionArr.length; aj++) {
    var act = actionArr[aj];
    if (!act || act.type !== 'create-social-action' || !act.payload) continue;
    var actAgent2 = (act.created_by || act.origin_agent || '').toLowerCase();
    if (!agentPostEngagement[actAgent2]) continue;
    var actKey = (act.payload.platform || '') + '|' + (act.id || '');
    if (agentPostEngagement[actAgent2][actKey]) {
      agentPostEngagement[actAgent2][actKey].hook = classifyHook(act.payload.text || act.payload.content || '');
    }
  }

  // Aggregate engagement per agent
  Object.keys(agentPostEngagement).forEach(function (aid) {
    var posts = agentPostEngagement[aid];
    var keys = Object.keys(posts);
    if (keys.length === 0) return;
    agents[aid].socialPostsPublished = keys.length;
    var totalLikes = 0, totalComments = 0, topLikes = 0, topPlatform = '', topSnippet = '';
    keys.forEach(function (k) {
      var p = posts[k];
      totalLikes += p.likes;
      totalComments += p.comments;
      if (p.likes > topLikes) {
        topLikes = p.likes;
        topPlatform = p.platform;
        topSnippet = p.snippet;
      }
      // Hook engagement correlation
      if (p.hook) {
        if (!agents[aid].hookEngagement[p.hook]) agents[aid].hookEngagement[p.hook] = { posts: 0, totalLikes: 0 };
        agents[aid].hookEngagement[p.hook].posts += 1;
        agents[aid].hookEngagement[p.hook].totalLikes += p.likes;
      }
    });
    agents[aid].avgLikesPerPost = Math.round(totalLikes / keys.length);
    agents[aid].avgCommentsPerPost = Math.round(totalComments / keys.length);
    agents[aid].topPostLikes = topLikes;
    agents[aid].topPostPlatform = topPlatform;
    agents[aid].topPostSnippet = topSnippet;
  });

  // ── Blog post views (Scribe) ──
  for (var bv = 0; bv < blogPostViews.length; bv++) {
    var view = blogPostViews[bv];
    if (!view) continue;
    var bvAgent = (view.created_by || '').toLowerCase();
    if (!bvAgent || !agents[bvAgent]) continue;
    agents[bvAgent].blogPostsPublished += 1;
    agents[bvAgent].avgBlogViews += (view.views || 0);
  }

  // ── Compute final metrics ──
  var previousDigest = (existingDigest && existingDigest.agents) || {};
  AGENT_IDS.forEach(function (id) {
    var a = agents[id];

    // Rates
    a.peerReviewApprovalRate = a.peerReviewsReceived > 0
      ? Number((a.peerReviewApproved / a.peerReviewsReceived).toFixed(2)) : 0;
    a.ceoApprovalRate = a.ceoActionsSubmitted > 0
      ? Number((a.ceoApproved / a.ceoActionsSubmitted).toFixed(2)) : 0;
    a.blockRate = a.actionsAttempted > 0
      ? Number((a.actionsBlocked / a.actionsAttempted).toFixed(2)) : 0;
    a.handoffFirstPassRate = a.handoffsReceived > 0
      ? Number((a.handoffsPassedFirstReview / a.handoffsReceived).toFixed(2)) : 0;
    a.researchAcceptRate = a.researchSubmitted > 0
      ? Number((a.researchAccepted / a.researchSubmitted).toFixed(2)) : 0;

    // Averages
    if (a.ceoApproved > 0) {
      a.avgRevisionsBeforeApproval = Number((a.avgRevisionsBeforeApproval / a.ceoApproved).toFixed(1));
    }
    if (a.tasksCompleted > 0) {
      a.avgTaskDurationHours = Number((a.avgTaskDurationHours / a.tasksCompleted).toFixed(1));
      a.avgCommentsBeforeDone = Number((a._totalCommentsBeforeDone / a.tasksCompleted).toFixed(1));
      a.avgTokensPerTask = a.totalTokens > 0 ? Math.round(a.totalTokens / a.tasksCompleted) : 0;
    }
    if (a._deliverableCount > 0) {
      a.avgDeliverableLength = Math.round(a._totalDeliverableLength / a._deliverableCount);
    }
    if (a._approvalWaitCount > 0) {
      a.avgApprovalWaitHours = Number((a._totalApprovalWaitMs / a._approvalWaitCount / (1000 * 60 * 60)).toFixed(1));
    }
    if (a.ceoStarRatings.length > 0) {
      a.ceoAvgStarRating = Number((a.ceoStarRatings.reduce(function (s, r) { return s + r; }, 0) / a.ceoStarRatings.length).toFixed(1));
    }
    if (a.blogPostsPublished > 0) {
      a.avgBlogViews = Math.round(a.avgBlogViews / a.blogPostsPublished);
    }

    // Best hour of day
    var bestHour = null, bestHourExec = 0;
    Object.keys(a._hourlyScores).forEach(function (h) {
      var hs = a._hourlyScores[h];
      var avgExec = hs.runs > 0 ? hs.executed / hs.runs : 0;
      if (avgExec > bestHourExec) { bestHourExec = avgExec; bestHour = parseInt(h); }
    });
    a.bestHour = bestHour;

    // Revision efficiency: 1.0 = no revisions needed, 0.0 = 3+ revisions avg
    var revisionEfficiency = Math.max(0, 1 - (a.avgRevisionsBeforeApproval / 3));

    // Engagement or turnaround
    var engagementOrTurnaround = 0;
    var isSocialAgent = (id === 'echo' || id === 'scribe' || id === 'quill');
    if (isSocialAgent && a.socialPostsPublished > 0) {
      engagementOrTurnaround = Math.min(1, a.avgLikesPerPost / 100);
    } else if (a.tasksCompleted > 0) {
      engagementOrTurnaround = Math.max(0, 1 - ((a.avgTaskDurationHours - 2) / 22));
    }

    // Block penalty: high block rate reduces score
    var blockPenalty = a.blockRate > 0.3 ? (a.blockRate - 0.3) * 10 : 0;

    // Star rating bonus (if CEO has rated)
    var starBonus = a.ceoAvgStarRating > 0 ? (a.ceoAvgStarRating - 3) * 3 : 0;

    // ── Role-aware scoring ──
    // Orchestrators (Nova, Cipher) delegate and triage — they don't produce deliverables.
    // Reviewers (Quill) primarily review others' work, not submit their own actions.
    // Researchers (Scout) are scored on research acceptance, not social engagement.
    // Producers (Echo, Scribe, Pixel, Forge) use the standard output-based formula.

    var isOrchestrator = (id === 'nova' || id === 'cipher');
    var isReviewer = (id === 'quill');
    var isResearcher = (id === 'scout');
    var isSpecialist = (id === 'pixel' || id === 'forge');

    // Orchestrator signals: tasks delegated (created_by this agent, assigned to others),
    // governance compliance, low block rate, team quality (avg downstream agent scores)
    var _tasksCreatedByAgent = 0, _tasksCreatedDone = 0;
    if (isOrchestrator) {
      for (var _tc = 0; _tc < taskArr.length; _tc++) {
        var _t = taskArr[_tc];
        if (!_t) continue;
        var _tCreatedBy = (_t.created_by || '').toLowerCase();
        var _tAssignee = (_t.assignee || '').toLowerCase();
        var _tTs = Date.parse(_t.createdAt || '');
        if (Number.isFinite(_tTs) && _tTs < cutoff) continue;
        if (_tCreatedBy === id && _tAssignee && _tAssignee !== id) {
          _tasksCreatedByAgent++;
          if (_t.status === 'done') _tasksCreatedDone++;
        }
      }
    }

    // Reviewer signals: reviews given (already tracked as peerReview on others' tasks),
    // so count reviews authored by this agent
    var _reviewsGiven = 0, _reviewsGivenApproved = 0;
    if (isReviewer) {
      for (var _rv = 0; _rv < taskArr.length; _rv++) {
        var _rvTask = taskArr[_rv];
        if (!_rvTask || !_rvTask.comments) continue;
        var _rvTs = Date.parse(_rvTask.updatedAt || _rvTask.createdAt || '');
        if (Number.isFinite(_rvTs) && _rvTs < cutoff) continue;
        for (var _rc = 0; _rc < _rvTask.comments.length; _rc++) {
          var _rvCmt = _rvTask.comments[_rc];
          if (_rvCmt.type === 'review' && (_rvCmt.author || '').toLowerCase() === id) {
            _reviewsGiven++;
            if (_rvCmt.verdict === 'approved') _reviewsGivenApproved++;
          }
        }
      }
    }

    // Compute role-aware quality score
    if (isOrchestrator) {
      // Orchestrator formula: delegation throughput + governance + block rate + CEO signals (if any)
      var delegationRate = _tasksCreatedByAgent > 0 ? Math.min(1, _tasksCreatedDone / _tasksCreatedByAgent) : 0;
      var delegationVolume = Math.min(1, _tasksCreatedByAgent / 20); // cap at 20 tasks in window
      var govCompliance = a.governanceViolations === 0 ? 1 : Math.max(0, 1 - (a.governanceViolations / 5));
      var orchCeoSignal = a.ceoActionsSubmitted > 0 ? a.ceoApprovalRate : 0.5; // neutral if no submissions
      a.qualityScore = Math.min(100, Math.max(0, Math.round(
        (delegationRate * 30) +
        (delegationVolume * 20) +
        (govCompliance * 20) +
        (orchCeoSignal * 15) +
        ((1 - a.blockRate) * 15) -
        blockPenalty +
        starBonus
      )));
      a.delegatedTasks = _tasksCreatedByAgent;
      a.delegatedTasksDone = _tasksCreatedDone;
    } else if (isReviewer) {
      // Reviewer formula: reviews given + review quality + own task quality + CEO signals
      var reviewVolume = Math.min(1, _reviewsGiven / 15); // cap at 15 reviews in window
      var ownTaskQuality = a.tasksCompleted > 0 ? engagementOrTurnaround : 0.5;
      var reviewerCeoSignal = a.ceoActionsSubmitted > 0 ? a.ceoApprovalRate : 0.5;
      a.qualityScore = Math.min(100, Math.max(0, Math.round(
        (reviewVolume * 25) +
        (a.peerReviewApprovalRate * 20) +
        (reviewerCeoSignal * 20) +
        (ownTaskQuality * 15) +
        (revisionEfficiency * 10) +
        ((1 - a.blockRate) * 10) -
        blockPenalty +
        starBonus
      )));
      a.reviewsGiven = _reviewsGiven;
    } else if (isResearcher) {
      // Researcher formula: research acceptance + CEO approval + task throughput + peer review
      var researchSignal = a.researchSubmitted > 0 ? a.researchAcceptRate : 0;
      a.qualityScore = Math.min(100, Math.max(0, Math.round(
        (a.ceoApprovalRate * 25) +
        (researchSignal * 25) +
        (a.peerReviewApprovalRate * 15) +
        (revisionEfficiency * 15) +
        ((1 - a.blockRate) * 10) +
        (a.handoffFirstPassRate * 10) -
        blockPenalty +
        starBonus
      )));
    } else if (isSpecialist) {
      // Specialist formula (Pixel=Design, Forge=DevOps) — low-volume agents that activate on demand.
      // Don't penalize for low volume; measure quality when they do act.
      // Peer review quality is weighted heavily since their work is domain-specific and reviewed by peers.
      var specHasActivity = (a.tasksCompleted > 0 || a.ceoActionsSubmitted > 0 || a.peerReviewsReceived > 0);
      if (!specHasActivity) {
        // No activity at all — neutral score, not penalized
        a.qualityScore = 50;
      } else {
        var specCeoSignal = a.ceoActionsSubmitted > 0 ? a.ceoApprovalRate : 0.5;
        var specPeerSignal = a.peerReviewsReceived > 0 ? a.peerReviewApprovalRate : 0.5;
        var specTaskSignal = a.tasksCompleted > 0 ? Math.min(1, a.tasksCompleted / 5) : 0; // cap at 5
        var specGovCompliance = a.governanceViolations === 0 ? 1 : Math.max(0, 1 - (a.governanceViolations / 5));
        a.qualityScore = Math.min(100, Math.max(0, Math.round(
          (specCeoSignal * 25) +
          (specPeerSignal * 25) +
          (revisionEfficiency * 15) +
          (specTaskSignal * 15) +
          (specGovCompliance * 10) +
          ((1 - a.blockRate) * 10) -
          blockPenalty +
          starBonus
        )));
      }
    } else {
      // Producer formula (Echo, Scribe) — original weights
      a.qualityScore = Math.min(100, Math.max(0, Math.round(
        (a.ceoApprovalRate * 30) +
        (a.peerReviewApprovalRate * 20) +
        (revisionEfficiency * 15) +
        (engagementOrTurnaround * 15) +
        ((1 - a.blockRate) * 10) +
        (a.handoffFirstPassRate * 10) -
        blockPenalty +
        starBonus
      )));
    }

    // Trend vs previous
    var prev = previousDigest[id];
    a.previousScore = (prev && Number.isFinite(prev.qualityScore)) ? prev.qualityScore : a.qualityScore;
    var delta = a.qualityScore - a.previousScore;
    a.qualityTrend = delta > 3 ? 'improving' : (delta < -3 ? 'declining' : 'stable');

    // Trim revision notes to top 5
    a.ceoRevisionNotes = a.ceoRevisionNotes.slice(0, 5);

    // Clean up internal accumulators
    delete a._totalCommentsBeforeDone;
    delete a._totalDeliverableLength;
    delete a._deliverableCount;
    delete a._totalApprovalWaitMs;
    delete a._approvalWaitCount;
    delete a._hourlyScores;
  });

  return {
    asOfUtc: new Date(now).toISOString(),
    windowDays: PERFORMANCE_INTEL_WINDOW_DAYS,
    agents: agents
  };
}

// ── Prompt Block Formatter ──

function _buildPerformancePromptBlock(agent, performanceDigest) {
  if (!performanceDigest || !performanceDigest.agents || !agent) return '';
  var agentId = (agent.name || '').toLowerCase();
  var data = performanceDigest.agents[agentId];
  if (!data) return '';

  if (data.tasksCompleted === 0 && data.ceoActionsSubmitted === 0 && data.peerReviewsReceived === 0) {
    return '';
  }

  var lines = [];
  lines.push('\n\nYOUR PERFORMANCE SCORECARD (' + performanceDigest.windowDays + '-day rolling window):');

  // Quality score + trend
  var trendArrow = data.qualityTrend === 'improving' ? ' (up from ' + data.previousScore + ')' :
    (data.qualityTrend === 'declining' ? ' (down from ' + data.previousScore + ')' : '');
  lines.push('- Quality Score: ' + data.qualityScore + '/100' + trendArrow + ' — ' + data.qualityTrend);

  // CEO star rating
  if (data.ceoAvgStarRating > 0) {
    lines.push('- CEO Quality Rating: ' + data.ceoAvgStarRating + '/5 (' + data.ceoStarRatings.length + ' ratings)');
  }

  // Peer review
  if (data.peerReviewsReceived > 0) {
    lines.push('- Peer Review: ' + data.peerReviewApproved + '/' + data.peerReviewsReceived +
      ' approved (' + Math.round(data.peerReviewApprovalRate * 100) + '%)' +
      (data.peerReviewChangesRequested > 0 ? ' — ' + data.peerReviewChangesRequested + ' changes-requested' : ''));
  }

  // CEO approval
  if (data.ceoActionsSubmitted > 0) {
    var ceoLine = '- CEO Approval: ' + data.ceoApproved + '/' + data.ceoActionsSubmitted +
      ' approved (' + Math.round(data.ceoApprovalRate * 100) + '%)';
    if (data.ceoRevisionRequested > 0) ceoLine += ' — ' + data.ceoRevisionRequested + ' revision requests';
    if (data.ceoRejected > 0) ceoLine += ', ' + data.ceoRejected + ' rejected';
    lines.push(ceoLine);
    if (data.avgRevisionsBeforeApproval > 0) {
      lines.push('- Avg revisions before approval: ' + data.avgRevisionsBeforeApproval);
    }
    if (data.avgApprovalWaitHours > 0) {
      lines.push('- Avg CEO decision time: ' + data.avgApprovalWaitHours + 'h (lower = CEO trusts your work more)');
    }
  }

  // Block rate
  if (data.actionsBlocked > 0) {
    lines.push('- Action block rate: ' + data.actionsBlocked + '/' + data.actionsAttempted + ' blocked (' + Math.round(data.blockRate * 100) + '%) — reduce invalid action attempts');
  }

  // Cross-agent handoff
  if (data.handoffsReceived > 0) {
    lines.push('- Handoff quality: ' + data.handoffsPassedFirstReview + '/' + data.handoffsReceived +
      ' passed first review (' + Math.round(data.handoffFirstPassRate * 100) + '%)');
  }

  // Social engagement
  if (data.socialPostsPublished > 0) {
    var socialLine = '- Social: ' + data.socialPostsPublished + ' posts, avg ' +
      data.avgLikesPerPost + ' likes';
    if (data.topPostLikes > 0) {
      socialLine += ', top: ' + data.topPostLikes + ' likes';
      if (data.topPostPlatform) socialLine += ' (' + data.topPostPlatform + ')';
    }
    lines.push(socialLine);

    // Hook analysis
    var hookKeys = Object.keys(data.hookEngagement);
    if (hookKeys.length > 1) {
      var hookLines = hookKeys.map(function (h) {
        var he = data.hookEngagement[h];
        return h + ': ' + (he.posts > 0 ? Math.round(he.totalLikes / he.posts) : 0) + ' avg likes (' + he.posts + ' posts)';
      }).sort().join(', ');
      lines.push('- Hook analysis: ' + hookLines);
    }
  }

  // Blog views
  if (data.blogPostsPublished > 0) {
    lines.push('- Blog: ' + data.blogPostsPublished + ' posts, avg ' + data.avgBlogViews + ' views');
  }

  // Research acceptance (Scout)
  if (data.researchSubmitted > 0) {
    lines.push('- Research intel: ' + data.researchAccepted + '/' + data.researchSubmitted + ' accepted (' + Math.round(data.researchAcceptRate * 100) + '%)');
  }

  // Tasks + turnaround + churn
  if (data.tasksCompleted > 0) {
    var taskLine = '- Tasks completed: ' + data.tasksCompleted;
    if (data.avgTaskDurationHours > 0) taskLine += ', avg turnaround: ' + data.avgTaskDurationHours + 'h';
    if (data.avgCommentsBeforeDone > 3) taskLine += ', avg ' + data.avgCommentsBeforeDone + ' comments/task (high churn)';
    lines.push(taskLine);
  }

  // Cost efficiency
  if (data.totalCost > 0) {
    lines.push('- Token cost: $' + data.totalCost.toFixed(3) + ' total' +
      (data.avgTokensPerTask > 0 ? ', ' + Math.round(data.avgTokensPerTask / 1000) + 'k tokens/task avg' : ''));
  }

  // Governance violations
  if (data.governanceViolations > 0) {
    lines.push('- Governance violations: ' + data.governanceViolations + ' (reduce policy-violating actions)');
  }

  // CEO revision note themes + pattern summary
  if (data.ceoRevisionNotes && data.ceoRevisionNotes.length > 0) {
    lines.push('- Recent CEO feedback:');
    data.ceoRevisionNotes.slice(0, 3).forEach(function (n) {
      lines.push('  - "' + n.slice(0, 100) + '"');
    });
    // Add theme clustering for agents with enough notes
    if (data.ceoRevisionNotes.length >= 2) {
      var _fbWordCounts = {};
      data.ceoRevisionNotes.forEach(function (note) {
        note.toLowerCase().split(/\s+/).forEach(function (w) {
          if (w.length > 4) _fbWordCounts[w] = (_fbWordCounts[w] || 0) + 1;
        });
      });
      var _fbThemes = Object.keys(_fbWordCounts)
        .filter(function (w) { return _fbWordCounts[w] >= 2; })
        .sort(function (a, b) { return _fbWordCounts[b] - _fbWordCounts[a]; })
        .slice(0, 3);
      if (_fbThemes.length > 0) {
        lines.push('- CEO feedback themes: ' + _fbThemes.map(function (w) { return '"' + w + '" (' + _fbWordCounts[w] + 'x)'; }).join(', ') + ' — address these patterns');
      }
    }
  }

  return lines.join('\n');
}

// ── Reflective Memory Generator ──

function generatePerformanceInsights(agentId, currentDigest, previousDigest) {
  if (!currentDigest || !currentDigest.agents) return [];
  var current = currentDigest.agents[agentId];
  if (!current) return [];
  var previous = (previousDigest && previousDigest.agents && previousDigest.agents[agentId]) || null;
  var insights = [];

  if (current.tasksCompleted < 3 && current.ceoActionsSubmitted < 3) return [];

  // Pattern 1: CEO rejection clustering
  if (current.ceoRevisionNotes && current.ceoRevisionNotes.length >= 2) {
    var wordCounts = {};
    current.ceoRevisionNotes.forEach(function (note) {
      note.toLowerCase().split(/\s+/).forEach(function (w) {
        if (w.length > 3) wordCounts[w] = (wordCounts[w] || 0) + 1;
      });
    });
    var topWord = null, topCount = 0;
    Object.keys(wordCounts).forEach(function (w) {
      if (wordCounts[w] > topCount && wordCounts[w] >= 2) { topWord = w; topCount = wordCounts[w]; }
    });
    if (topWord) {
      insights.push('CEO feedback pattern: "' + topWord + '" appears in ' + topCount + '/' + current.ceoRevisionNotes.length + ' revision notes.');
    }
  }

  // Pattern 2: Content hook performance (social agents)
  var hookKeys = Object.keys(current.hookEngagement || {});
  if (hookKeys.length >= 2) {
    var bestHook = null, bestAvg = 0, worstHook = null, worstAvg = Infinity;
    hookKeys.forEach(function (h) {
      var he = current.hookEngagement[h];
      if (he.posts < 2) return;
      var avg = he.totalLikes / he.posts;
      if (avg > bestAvg) { bestAvg = avg; bestHook = h; }
      if (avg < worstAvg) { worstAvg = avg; worstHook = h; }
    });
    if (bestHook && worstHook && bestHook !== worstHook && bestAvg > worstAvg * 1.5) {
      insights.push('"' + bestHook + '" hooks average ' + Math.round(bestAvg) + ' likes vs "' + worstHook + '" at ' + Math.round(worstAvg) + '. Favor ' + bestHook + ' hooks.');
    }
  }

  // Pattern 3: Approval rate trend
  if (previous && previous.ceoApprovalRate > 0 && current.ceoApprovalRate > 0) {
    var rateDelta = current.ceoApprovalRate - previous.ceoApprovalRate;
    if (rateDelta >= 0.15) {
      insights.push('CEO approval rate improved to ' + Math.round(current.ceoApprovalRate * 100) + '%. Current approach is working.');
    } else if (rateDelta <= -0.15) {
      insights.push('CEO approval rate dropped to ' + Math.round(current.ceoApprovalRate * 100) + '%. Review recent submissions for quality drift.');
    }
  }

  // Pattern 4: High block rate
  if (current.blockRate > 0.25) {
    insights.push(Math.round(current.blockRate * 100) + '% of actions are being blocked. Review allowed action types and reduce invalid attempts.');
  }

  // Pattern 5: High churn
  if (current.avgCommentsBeforeDone > 5) {
    insights.push('Tasks average ' + current.avgCommentsBeforeDone + ' comments before done (high churn). Aim for cleaner first deliverables.');
  }

  // Pattern 6: Revision count creep
  if (current.avgRevisionsBeforeApproval >= 2) {
    insights.push('Average ' + current.avgRevisionsBeforeApproval + ' revisions before CEO approval. Front-load quality checks.');
  }

  // Pattern 7: Handoff quality drop
  if (current.handoffsReceived >= 3 && current.handoffFirstPassRate < 0.5) {
    insights.push('Only ' + Math.round(current.handoffFirstPassRate * 100) + '% of handoff tasks pass first review. Clarify requirements upfront.');
  }

  // Pattern 8: Cost outlier
  if (previous && previous.totalCost > 0 && current.totalCost > previous.totalCost * 1.5) {
    insights.push('Token costs up ' + Math.round(((current.totalCost / previous.totalCost) - 1) * 100) + '% vs last period. Check for unnecessarily verbose outputs.');
  }

  return insights.slice(0, MAX_PERFORMANCE_INSIGHTS_PER_DAY);
}

// ── Experiment Evaluation ──

function evaluateExperiments(agentExperiments, performanceDigest, actions, nowMs) {
  if (!Array.isArray(agentExperiments) || !performanceDigest || !performanceDigest.agents) return agentExperiments;
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (var i = 0; i < agentExperiments.length; i++) {
    var exp = agentExperiments[i];
    if (!exp || exp.status !== 'active') continue;

    var startTs = Date.parse(exp.startedAt || '');
    if (Number.isFinite(startTs) && (now - startTs) > thirtyDaysMs && exp.sampleCount < exp.minSamples) {
      exp.status = 'discarded';
      exp.concludedAt = new Date(now).toISOString();
      exp.result = 'inconclusive';
      continue;
    }

    var samples = 0, totalApproved = 0, totalSubmitted = 0;
    for (var a = 0; a < actions.length; a++) {
      var act = actions[a];
      if (!act || !act.experiment_tag || act.experiment_tag !== exp.hypothesis) continue;
      var actAgent = (act.created_by || act.origin_agent || '').toLowerCase();
      if (actAgent !== exp.agentId) continue;
      samples++;
      if (act.approval) {
        totalSubmitted++;
        if (act.approval.status === 'approved') totalApproved++;
      }
    }
    exp.sampleCount = samples;

    if (samples >= (exp.minSamples || EXPERIMENT_MIN_SAMPLES)) {
      var baseline = exp.baselineMetric || {};
      var baselineRate = Number.isFinite(baseline.ceoApprovalRate) ? baseline.ceoApprovalRate : 0;
      var expRate = totalSubmitted > 0 ? totalApproved / totalSubmitted : 0;
      var improvement = baselineRate > 0 ? (expRate - baselineRate) / baselineRate : (expRate > 0 ? 1 : 0);

      exp.experimentMetric = { ceoApprovalRate: Number(expRate.toFixed(2)), samples: samples };

      if (improvement >= EXPERIMENT_IMPROVEMENT_THRESHOLD) { exp.status = 'concluded'; exp.result = 'keep'; }
      else if (improvement <= -EXPERIMENT_IMPROVEMENT_THRESHOLD) { exp.status = 'concluded'; exp.result = 'discard'; }
      else { exp.status = 'concluded'; exp.result = 'inconclusive'; }
      exp.concludedAt = new Date(now).toISOString();
    }
  }

  return agentExperiments;
}

function _buildExperimentPromptBlock(agentId, agentExperiments) {
  if (!Array.isArray(agentExperiments)) return '';
  var active = agentExperiments.filter(function (e) { return e && e.agentId === agentId && e.status === 'active'; });
  var recentConcluded = agentExperiments.filter(function (e) {
    return e && e.agentId === agentId && e.status === 'concluded' &&
      e.concludedAt && (Date.now() - Date.parse(e.concludedAt)) < 7 * 24 * 60 * 60 * 1000;
  }).slice(0, 3);

  if (active.length === 0 && recentConcluded.length === 0) return '';

  var lines = ['\n\nEXPERIMENTS:'];
  active.forEach(function (e) {
    lines.push('- ACTIVE: "' + e.hypothesis + '" — ' + (e.description || '') + ' (' + e.sampleCount + '/' + (e.minSamples || EXPERIMENT_MIN_SAMPLES) + ' samples)');
  });
  recentConcluded.forEach(function (e) {
    var label = e.result === 'keep' ? 'KEEP' : (e.result === 'discard' ? 'DISCARD' : 'INCONCLUSIVE');
    lines.push('- ' + label + ': "' + e.hypothesis + '"' + (e.experimentMetric ? ' — approval rate: ' + Math.round((e.experimentMetric.ceoApprovalRate || 0) * 100) + '%' : ''));
  });

  return lines.join('\n');
}

module.exports = {
  buildPerformanceDigest,
  _buildPerformancePromptBlock,
  generatePerformanceInsights,
  evaluateExperiments,
  _buildExperimentPromptBlock,
  classifyHook
};
