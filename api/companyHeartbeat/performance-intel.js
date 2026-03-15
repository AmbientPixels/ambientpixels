// performance-intel.js — AutoResearch-inspired agent performance scoring
// Mirrors social-intel.js pattern: digest builder + prompt block formatter
// Aggregates peer review rates, CEO approval rates, engagement, and turnaround
// into per-agent quality scores fed back into heartbeat prompts.

const { PERFORMANCE_INTEL_FRESHNESS_MS, PERFORMANCE_INTEL_WINDOW_DAYS, AGENT_IDS,
  MAX_PERFORMANCE_INSIGHTS_PER_DAY, MAX_EXPERIMENTS_PER_AGENT,
  EXPERIMENT_MIN_SAMPLES, EXPERIMENT_IMPROVEMENT_THRESHOLD } = require('./constants');

// ── Performance Digest Builder ──

function buildPerformanceDigest(tasks, actions, engagementSnapshots, existingDigest, nowMs) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();

  // Freshness check — reuse existing digest if recent enough
  var existingAsOf = existingDigest && existingDigest.asOfUtc ? Date.parse(existingDigest.asOfUtc) : NaN;
  if (existingDigest && Number.isFinite(existingAsOf) && (now - existingAsOf) < PERFORMANCE_INTEL_FRESHNESS_MS) {
    return existingDigest;
  }

  var windowMs = PERFORMANCE_INTEL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  var cutoff = now - windowMs;
  var taskArr = Array.isArray(tasks) ? tasks : [];
  var actionArr = Array.isArray(actions) ? actions : [];
  var snapshots = Array.isArray(engagementSnapshots) ? engagementSnapshots : [];

  var agents = {};
  AGENT_IDS.forEach(function (id) {
    agents[id] = {
      peerReviewsReceived: 0,
      peerReviewApproved: 0,
      peerReviewChangesRequested: 0,
      peerReviewApprovalRate: 0,
      ceoActionsSubmitted: 0,
      ceoApproved: 0,
      ceoRevisionRequested: 0,
      ceoRejected: 0,
      ceoApprovalRate: 0,
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
      qualityScore: 0,
      qualityTrend: 'stable',
      previousScore: 0
    };
  });

  // ── Scan tasks for peer review signals ──
  for (var i = 0; i < taskArr.length; i++) {
    var task = taskArr[i];
    if (!task || !task.comments) continue;
    var assignee = (task.assignee || '').toLowerCase();
    if (!agents[assignee]) continue;

    var createdTs = Date.parse(task.createdAt || '');
    var updatedTs = Date.parse(task.updatedAt || '');
    var taskTs = Number.isFinite(updatedTs) ? updatedTs : (Number.isFinite(createdTs) ? createdTs : 0);
    if (taskTs < cutoff) continue;

    // Count peer reviews on this agent's tasks
    var comments = task.comments;
    for (var c = 0; c < comments.length; c++) {
      var cmt = comments[c];
      if (cmt.type !== 'review' || !cmt.verdict) continue;
      var cmtTs = Date.parse(cmt.createdAt || '');
      if (Number.isFinite(cmtTs) && cmtTs < cutoff) continue;
      agents[assignee].peerReviewsReceived += 1;
      if (cmt.verdict === 'approved') {
        agents[assignee].peerReviewApproved += 1;
      } else if (cmt.verdict === 'changes-requested') {
        agents[assignee].peerReviewChangesRequested += 1;
      }
    }

    // Count completed tasks + turnaround
    if (task.status === 'done' && Number.isFinite(createdTs) && Number.isFinite(updatedTs)) {
      agents[assignee].tasksCompleted += 1;
      var durationMs = updatedTs - createdTs;
      agents[assignee].avgTaskDurationHours += durationMs / (1000 * 60 * 60);
    }
  }

  // ── Scan actions for CEO approval signals ──
  for (var j = 0; j < actionArr.length; j++) {
    var action = actionArr[j];
    if (!action || !action.approval) continue;
    var actionTs = Date.parse(action.createdAt || action.timestamp || '');
    if (Number.isFinite(actionTs) && actionTs < cutoff) continue;
    var agentId = (action.created_by || action.origin_agent || '').toLowerCase();
    if (!agents[agentId]) continue;

    var status = action.approval.status;
    if (status === 'approved' || status === 'revision_requested' || status === 'rejected' || status === 'pending') {
      agents[agentId].ceoActionsSubmitted += 1;
    }
    if (status === 'approved') {
      agents[agentId].ceoApproved += 1;
      agents[agentId].avgRevisionsBeforeApproval += (action.approval.revision_count || 0);
    } else if (status === 'revision_requested') {
      agents[agentId].ceoRevisionRequested += 1;
      // Capture revision note for pattern detection
      var note = (action.approval.decision_note || '').trim();
      if (note) agents[agentId].ceoRevisionNotes.push(note);
    } else if (status === 'rejected') {
      agents[agentId].ceoRejected += 1;
      var rejNote = (action.approval.decision_note || '').trim();
      if (rejNote) agents[agentId].ceoRevisionNotes.push(rejNote);
    }
  }

  // ── Scan engagement snapshots for social performance (keyed by agent) ──
  var agentPostEngagement = {}; // agentId -> { postKey -> { likes, comments, reposts, platform, snippet } }
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
        snippet: ''
      };
    }
    var m = snap.metrics || {};
    agentPostEngagement[snapAgent][postKey].likes += (Number.isFinite(m.likes) ? m.likes : 0);
    agentPostEngagement[snapAgent][postKey].comments += (Number.isFinite(m.comments) ? m.comments : 0);
    agentPostEngagement[snapAgent][postKey].reposts += (Number.isFinite(m.reposts) ? m.reposts : 0);
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
    });
    agents[aid].avgLikesPerPost = Math.round(totalLikes / keys.length);
    agents[aid].avgCommentsPerPost = Math.round(totalComments / keys.length);
    agents[aid].topPostLikes = topLikes;
    agents[aid].topPostPlatform = topPlatform;
    agents[aid].topPostSnippet = topSnippet;
  });

  // ── Compute final metrics ──
  var previousDigest = (existingDigest && existingDigest.agents) || {};
  AGENT_IDS.forEach(function (id) {
    var a = agents[id];

    // Rates
    a.peerReviewApprovalRate = a.peerReviewsReceived > 0
      ? Number((a.peerReviewApproved / a.peerReviewsReceived).toFixed(2)) : 0;
    a.ceoApprovalRate = a.ceoActionsSubmitted > 0
      ? Number((a.ceoApproved / a.ceoActionsSubmitted).toFixed(2)) : 0;

    // Averages
    if (a.ceoApproved > 0) {
      a.avgRevisionsBeforeApproval = Number((a.avgRevisionsBeforeApproval / a.ceoApproved).toFixed(1));
    }
    if (a.tasksCompleted > 0) {
      a.avgTaskDurationHours = Number((a.avgTaskDurationHours / a.tasksCompleted).toFixed(1));
    }

    // Revision efficiency: 1.0 = no revisions needed, 0.0 = 3+ revisions avg
    var revisionEfficiency = Math.max(0, 1 - (a.avgRevisionsBeforeApproval / 3));

    // Engagement percentile (for social agents) or turnaround score (for non-social)
    var engagementOrTurnaround = 0;
    var isSocialAgent = (id === 'echo' || id === 'scribe' || id === 'quill');
    if (isSocialAgent && a.socialPostsPublished > 0) {
      // Normalize: 100+ avg likes = 1.0
      engagementOrTurnaround = Math.min(1, a.avgLikesPerPost / 100);
    } else if (a.tasksCompleted > 0) {
      // Turnaround score: < 2h = 1.0, > 24h = 0.0
      engagementOrTurnaround = Math.max(0, 1 - ((a.avgTaskDurationHours - 2) / 22));
    }

    // Composite quality score (0-100)
    a.qualityScore = Math.round(
      (a.ceoApprovalRate * 35) +
      (a.peerReviewApprovalRate * 25) +
      (revisionEfficiency * 20) +
      (engagementOrTurnaround * 20)
    );

    // Trend vs previous
    var prev = previousDigest[id];
    a.previousScore = (prev && Number.isFinite(prev.qualityScore)) ? prev.qualityScore : a.qualityScore;
    var delta = a.qualityScore - a.previousScore;
    a.qualityTrend = delta > 3 ? 'improving' : (delta < -3 ? 'declining' : 'stable');

    // Trim revision notes to top 5
    a.ceoRevisionNotes = a.ceoRevisionNotes.slice(0, 5);
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

  // Skip if no data at all (agent hasn't done anything in the window)
  if (data.tasksCompleted === 0 && data.ceoActionsSubmitted === 0 && data.peerReviewsReceived === 0) {
    return '';
  }

  var lines = [];
  lines.push('\n\nYOUR PERFORMANCE SCORECARD (' + performanceDigest.windowDays + '-day rolling window):');

  // Quality score + trend
  var trendArrow = data.qualityTrend === 'improving' ? ' (up from ' + data.previousScore + ')' :
    (data.qualityTrend === 'declining' ? ' (down from ' + data.previousScore + ')' : '');
  lines.push('- Quality Score: ' + data.qualityScore + '/100' + trendArrow + ' — ' + data.qualityTrend);

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
  }

  // Social engagement (for social-facing agents)
  if (data.socialPostsPublished > 0) {
    var socialLine = '- Social: ' + data.socialPostsPublished + ' posts, avg ' +
      data.avgLikesPerPost + ' likes';
    if (data.topPostLikes > 0) {
      socialLine += ', top: ' + data.topPostLikes + ' likes';
      if (data.topPostPlatform) socialLine += ' (' + data.topPostPlatform + ')';
    }
    lines.push(socialLine);
  }

  // Tasks + turnaround
  if (data.tasksCompleted > 0) {
    lines.push('- Tasks completed: ' + data.tasksCompleted +
      (data.avgTaskDurationHours > 0 ? ', avg turnaround: ' + data.avgTaskDurationHours + 'h' : ''));
  }

  // CEO revision note themes (top 3, truncated)
  if (data.ceoRevisionNotes && data.ceoRevisionNotes.length > 0) {
    lines.push('- Recent CEO feedback themes:');
    data.ceoRevisionNotes.slice(0, 3).forEach(function (note) {
      lines.push('  - "' + note.slice(0, 100) + '"');
    });
  }

  return lines.join('\n');
}

// ── Phase 2: Reflective Memory Generator ──

function generatePerformanceInsights(agentId, currentDigest, previousDigest) {
  if (!currentDigest || !currentDigest.agents) return [];
  var current = currentDigest.agents[agentId];
  if (!current) return [];
  var previous = (previousDigest && previousDigest.agents && previousDigest.agents[agentId]) || null;
  var insights = [];

  // Skip agents with insufficient data
  if (current.tasksCompleted < 3 && current.ceoActionsSubmitted < 3) return [];

  // Pattern 1: CEO rejection clustering
  if (current.ceoRevisionNotes && current.ceoRevisionNotes.length >= 2) {
    var wordCounts = {};
    current.ceoRevisionNotes.forEach(function (note) {
      var words = note.toLowerCase().split(/\s+/);
      words.forEach(function (w) {
        if (w.length > 3) wordCounts[w] = (wordCounts[w] || 0) + 1;
      });
    });
    var topWord = null, topCount = 0;
    Object.keys(wordCounts).forEach(function (w) {
      if (wordCounts[w] > topCount && wordCounts[w] >= 2) {
        topWord = w; topCount = wordCounts[w];
      }
    });
    if (topWord) {
      insights.push('CEO feedback pattern: "' + topWord + '" appears in ' + topCount + '/' +
        current.ceoRevisionNotes.length + ' revision notes. Review and adjust approach accordingly.');
    }
  }

  // Pattern 2: Platform engagement disparity (social agents only)
  // (Would need per-platform breakdown in digest — skipped for now, covered by social intel)

  // Pattern 3: Approval rate trend
  if (previous && previous.ceoApprovalRate > 0 && current.ceoApprovalRate > 0) {
    var rateDelta = current.ceoApprovalRate - previous.ceoApprovalRate;
    if (rateDelta >= 0.15) {
      insights.push('CEO approval rate improved from ' + Math.round(previous.ceoApprovalRate * 100) +
        '% to ' + Math.round(current.ceoApprovalRate * 100) + '%. Current approach is working well.');
    } else if (rateDelta <= -0.15) {
      insights.push('CEO approval rate dropped from ' + Math.round(previous.ceoApprovalRate * 100) +
        '% to ' + Math.round(current.ceoApprovalRate * 100) + '%. Review recent submissions for quality drift.');
    }
  }

  // Pattern 4: Revision count creep
  if (current.avgRevisionsBeforeApproval >= 2) {
    insights.push('Average ' + current.avgRevisionsBeforeApproval + ' revisions before CEO approval. Consider front-loading quality checks before submission.');
  }

  // Pattern 5: Quality score trend
  if (current.qualityTrend === 'declining' && current.qualityScore < 50) {
    insights.push('Quality score declining (' + current.qualityScore + '/100). Prioritize accuracy and alignment with CEO expectations over throughput.');
  }

  // Cap insights per call
  return insights.slice(0, MAX_PERFORMANCE_INSIGHTS_PER_DAY);
}

// ── Phase 3: Experiment Evaluation ──

function evaluateExperiments(agentExperiments, performanceDigest, actions, nowMs) {
  if (!Array.isArray(agentExperiments) || !performanceDigest || !performanceDigest.agents) return agentExperiments;
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (var i = 0; i < agentExperiments.length; i++) {
    var exp = agentExperiments[i];
    if (!exp || exp.status !== 'active') continue;

    // Auto-discard experiments older than 30 days with no progress
    var startTs = Date.parse(exp.startedAt || '');
    if (Number.isFinite(startTs) && (now - startTs) > thirtyDaysMs && exp.sampleCount < exp.minSamples) {
      exp.status = 'discarded';
      exp.concludedAt = new Date(now).toISOString();
      exp.result = 'inconclusive';
      continue;
    }

    // Count samples: actions with matching experiment_tag from this agent
    var samples = 0;
    var totalLikes = 0;
    var totalApproved = 0;
    var totalSubmitted = 0;
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

    // Evaluate if enough samples
    if (samples >= (exp.minSamples || EXPERIMENT_MIN_SAMPLES)) {
      var baseline = exp.baselineMetric || {};
      var baselineApprovalRate = Number.isFinite(baseline.ceoApprovalRate) ? baseline.ceoApprovalRate : 0;
      var expApprovalRate = totalSubmitted > 0 ? totalApproved / totalSubmitted : 0;

      var improvement = baselineApprovalRate > 0
        ? (expApprovalRate - baselineApprovalRate) / baselineApprovalRate
        : (expApprovalRate > 0 ? 1 : 0);

      exp.experimentMetric = {
        ceoApprovalRate: Number(expApprovalRate.toFixed(2)),
        samples: samples
      };

      if (improvement >= EXPERIMENT_IMPROVEMENT_THRESHOLD) {
        exp.status = 'concluded';
        exp.result = 'keep';
      } else if (improvement <= -EXPERIMENT_IMPROVEMENT_THRESHOLD) {
        exp.status = 'concluded';
        exp.result = 'discard';
      } else {
        exp.status = 'concluded';
        exp.result = 'inconclusive';
      }
      exp.concludedAt = new Date(now).toISOString();
    }
  }

  return agentExperiments;
}

function _buildExperimentPromptBlock(agentId, agentExperiments) {
  if (!Array.isArray(agentExperiments)) return '';
  var active = agentExperiments.filter(function (e) {
    return e && e.agentId === agentId && e.status === 'active';
  });
  var recentConcluded = agentExperiments.filter(function (e) {
    return e && e.agentId === agentId && e.status === 'concluded' &&
      e.concludedAt && (Date.now() - Date.parse(e.concludedAt)) < 7 * 24 * 60 * 60 * 1000;
  }).slice(0, 3);

  if (active.length === 0 && recentConcluded.length === 0) return '';

  var lines = ['\n\nEXPERIMENTS:'];
  active.forEach(function (e) {
    lines.push('- ACTIVE: "' + e.hypothesis + '" — ' + (e.description || '') +
      ' (' + e.sampleCount + '/' + (e.minSamples || EXPERIMENT_MIN_SAMPLES) + ' samples)');
  });
  recentConcluded.forEach(function (e) {
    var resultLabel = e.result === 'keep' ? 'KEEP' : (e.result === 'discard' ? 'DISCARD' : 'INCONCLUSIVE');
    lines.push('- ' + resultLabel + ': "' + e.hypothesis + '"' +
      (e.experimentMetric ? ' — approval rate: ' + Math.round((e.experimentMetric.ceoApprovalRate || 0) * 100) + '%' : ''));
  });

  return lines.join('\n');
}

module.exports = {
  buildPerformanceDigest,
  _buildPerformancePromptBlock,
  generatePerformanceInsights,
  evaluateExperiments,
  _buildExperimentPromptBlock
};
