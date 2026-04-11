// companyContextFormatters.js — Pure formatting functions for company state context
// Takes state from companyContextLoader.js and produces prompt text blocks.
// Separated from loader for testability and to avoid a god-module.
// Used by: standup, novachat, mood engine, morning report, agent chat.

var storage = require('./companyStorage');

// Intel digest builders — confirmed clean imports (only depend on ./constants + ./helpers)
var socialIntel = require('../companyHeartbeat/social-intel');
var opsIntel = require('../companyHeartbeat/ops-intel');
var financeIntel = require('../companyHeartbeat/finance-intel');
var researchIntel = require('../companyHeartbeat/research-intel');
var performanceIntel = require('../companyHeartbeat/performance-intel');

// ────────────────────────────────────────────
// formatCoreContext — minimum viable context (~1000-1500 tokens)
// Used by: novachat, mood (via formatMoodTelemetry)
// ────────────────────────────────────────────
function formatCoreContext(state, agentId) {
  var lines = ['\n\nCOMPANY CONTEXT (live system state):'];
  var tasks = state.tasks || [];
  var campaigns = state.campaigns || [];
  var objectives = state.objectives || [];

  // Agent's own tasks (with descriptions + last 2 comments)
  var agentTasks = agentId
    ? tasks.filter(function (t) { return t.assignee === agentId && t.status !== 'done'; })
    : [];
  if (agentTasks.length > 0) {
    lines.push('\nYour assigned tasks:');
    agentTasks.forEach(function (t) {
      var line = '- [' + t.status + '] ' + t.title + ' (priority: ' + t.priority + ', id: ' + t.id;
      if (t.campaign_id) line += ', campaign: ' + t.campaign_id;
      if (t.dueDate) line += ', due: ' + t.dueDate.substring(0, 10);
      line += ')';
      if (t.description) line += '\n  ' + t.description.substring(0, 200);
      var comments = (t.comments || []).slice(-2);
      comments.forEach(function (c) {
        line += '\n  > ' + (c.author || 'system') + ': ' + (c.text || c.comment || '').substring(0, 120);
      });
      lines.push(line);
    });
  } else if (agentId) {
    lines.push('\nYour assigned tasks: (none active)');
  }

  // All active tasks (top 25)
  var activeTasks = tasks.filter(function (t) {
    return t.status !== 'done' && t.status !== 'backlog';
  }).slice(0, 25);
  if (activeTasks.length > 0) {
    lines.push('\nAll active tasks (' + activeTasks.length + '):');
    activeTasks.forEach(function (t) {
      lines.push('- [' + t.status + '] ' + (t.title || 'untitled') + ' → ' +
        (t.assignee || 'unassigned') + ' (due: ' + (t.dueDate ? t.dueDate.substring(0, 10) : '?') + ')');
    });
  }

  // Active campaigns WITH descriptions and linked task counts
  var activeCampaigns = campaigns.filter(function (c) {
    return String(c.status || '').toLowerCase() === 'active' && !c.deletedAt;
  });
  if (activeCampaigns.length > 0) {
    lines.push('\nActive campaigns (' + activeCampaigns.length + '):');
    activeCampaigns.forEach(function (c) {
      var taskCount = tasks.filter(function (t) { return t.campaign_id === c.id && t.status !== 'done'; }).length;
      var doneCount = tasks.filter(function (t) { return t.campaign_id === c.id && t.status === 'done'; }).length;
      var line = '- ' + (c.title || c.id) + ' (priority: ' + (c.priority || 'medium') +
        ', tasks: ' + taskCount + ' active / ' + doneCount + ' done';
      if (c.endDate) line += ', ends: ' + c.endDate.substring(0, 10);
      line += ')';
      if (c.description) line += '\n  Brief: ' + c.description.substring(0, 200);
      lines.push(line);
    });
  }

  // Also show completed/archived campaigns summary
  var completedCampaigns = campaigns.filter(function (c) {
    var s = String(c.status || '').toLowerCase();
    return (s === 'completed' || s === 'complete' || s === 'archived') && !c.deletedAt;
  });
  if (completedCampaigns.length > 0) {
    lines.push('\nCompleted/archived campaigns: ' + completedCampaigns.length +
      ' (' + completedCampaigns.slice(0, 5).map(function (c) { return c.title; }).join(', ') +
      (completedCampaigns.length > 5 ? '...' : '') + ')');
  }

  // Active objectives
  var activeObjectives = objectives.filter(function (o) {
    var s = String(o.status || '').toLowerCase();
    return s === 'active' || s === 'on_track' || !o.status;
  });
  if (activeObjectives.length > 0) {
    lines.push('\nActive objectives (' + activeObjectives.length + '):');
    activeObjectives.forEach(function (o) {
      lines.push('- ' + (o.title || o.id) + ' (progress: ' + (o.progress || 0) + '%, status: ' + (o.status || 'active') + ')');
    });
  }

  // RECENT ACCOMPLISHMENTS — the #1 hallucination killer
  // When agents see real completions they can't pretend it's Day 1
  var cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  var recentDone = tasks.filter(function (t) {
    return t.status === 'done' && (t.completedAt || t.updatedAt || '') > cutoff48h;
  });
  if (recentDone.length > 0) {
    lines.push('\nRecent accomplishments (last 48h): ' + recentDone.length + ' tasks completed');
    recentDone.slice(0, 10).forEach(function (t) {
      lines.push('- ' + (t.assignee || '?') + ': ' + (t.title || 'untitled'));
    });
    if (recentDone.length > 10) lines.push('  ...and ' + (recentDone.length - 10) + ' more');
  }

  // Cipher-specific: cost intelligence
  if (agentId === 'cipher') {
    lines.push(_buildCipherCostBlock(state));
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────
// formatRichContext — core + documents, memories, product facts, site (~2000-2500 tokens)
// Used by: standup
// ────────────────────────────────────────────
function formatRichContext(state, agentId) {
  var lines = [formatCoreContext(state, agentId)];

  // Documents (recent 8)
  var docs = state.documents || [];
  if (docs.length > 0) {
    var recentDocs = docs.slice(-8);
    lines.push('\nRecent documents (' + docs.length + ' total, showing last 8):');
    recentDocs.forEach(function (d) {
      lines.push('- ' + (d.title || 'untitled') + ' (kind: ' + (d.kind || '?') + ', status: ' + (d.status || '?') +
        ', by: ' + (d.author || '?') + ')');
    });
  }

  // Agent memories (last 5 for this agent)
  if (state.agentMemories && agentId) {
    var agentMems = state.agentMemories[agentId];
    if (Array.isArray(agentMems) && agentMems.length > 0) {
      var recent = agentMems.slice(-5);
      lines.push('\nYour recent memories (' + agentMems.length + ' total, last 5):');
      recent.forEach(function (m) {
        var text = (m.content || m.text || m.memory || '').substring(0, 150);
        lines.push('- ' + text);
      });
    }
  }

  // Seed memories (global + agent-specific)
  if (state.agentSeedMemories) {
    var seeds = state.agentSeedMemories;
    var globalSeeds = Array.isArray(seeds.global) ? seeds.global : [];
    var agentSeeds = agentId && Array.isArray(seeds[agentId]) ? seeds[agentId] : [];
    var allSeeds = globalSeeds.concat(agentSeeds);
    if (allSeeds.length > 0) {
      lines.push('\nCEO directives (' + allSeeds.length + '):');
      allSeeds.slice(0, 5).forEach(function (s) {
        var text = typeof s === 'string' ? s : (s.content || s.text || '');
        lines.push('- ' + text.substring(0, 150));
      });
    }
  }

  // Product facts summary — grounds agents in what actually exists
  if (state.productFacts && state.productFacts.products) {
    var products = state.productFacts.products;
    var names = Object.keys(products);
    lines.push('\nProduct portfolio (' + names.length + ' products):');
    names.forEach(function (name) {
      var p = products[name];
      lines.push('- ' + name + ': ' + (p.description || '').substring(0, 120));
    });
  }

  // Workspace memory (last 5)
  if (state.workspaceMemory) {
    var wsMem = Array.isArray(state.workspaceMemory) ? state.workspaceMemory : [];
    if (wsMem.length > 0) {
      lines.push('\nWorkspace notes (last 5):');
      wsMem.slice(-5).forEach(function (m) {
        var text = typeof m === 'string' ? m : (m.content || m.text || '');
        lines.push('- ' + text.substring(0, 120));
      });
    }
  }

  // Upcoming dates
  if (state.dates) {
    var dates = Array.isArray(state.dates) ? state.dates : [];
    var upcoming = dates.filter(function (d) {
      return (d.date || '') >= new Date().toISOString().substring(0, 10);
    }).slice(0, 5);
    if (upcoming.length > 0) {
      lines.push('\nUpcoming dates:');
      upcoming.forEach(function (d) {
        lines.push('- ' + d.date + ': ' + (d.title || d.description || ''));
      });
    }
  }

  // Full skill content — every agent needs product knowledge (matches heartbeat behavior)
  var skillsBlock = formatSkillsBlock(state, agentId);
  if (skillsBlock) lines.push(skillsBlock);

  return lines.join('\n');
}

// ────────────────────────────────────────────
// formatIntelDigests — all 5 intel digests via existing builders (~1500-2000 tokens)
// Used by: agentchat (strategic agents only)
// ────────────────────────────────────────────
function formatIntelDigests(state) {
  var blocks = [];
  var tasks = state.tasks || [];
  var campaigns = state.campaigns || [];

  try {
    // Social intel
    var socialDigest = socialIntel._socialIntelBuildDigest(
      state.runtimeMemory, state.socialMetricsEvents, state.socialEngagementSnapshots,
      state.socialEngagementMeta, Date.now(), state.socialAccountStats,
      state.socialWeeklySnapshots, state.blogPostViews
    );
    var socialBlock = socialIntel._buildSocialIntelPromptBlock(socialDigest);
    if (socialBlock) blocks.push(socialBlock);
  } catch (e) { /* social intel unavailable */ }

  try {
    // Ops intel
    var opsDigest = opsIntel.buildForgeOpsDigest(
      state.heartbeatRuns, state.geminiUsage, state.governanceLog, null, Date.now()
    );
    var opsBlock = opsIntel._buildForgeOpsPromptBlock({ id: 'forge', name: 'Forge' }, opsDigest);
    if (opsBlock) blocks.push(opsBlock);
  } catch (e) { /* ops intel unavailable */ }

  try {
    // Finance intel
    var costSummary = null;
    var geminiUsage = state.geminiUsage || [];
    if (geminiUsage.length > 0) {
      // Build cost summary inline (same structure as storage.getGeminiCostSummary)
      var byDay = {}, byAgent = {};
      geminiUsage.forEach(function (u) {
        var day = (u.timestamp || '').substring(0, 10);
        if (!byDay[day]) byDay[day] = { cost: 0 };
        byDay[day].cost += (u.totalCost || 0);
        var aid = u.agentId || 'unknown';
        if (!byAgent[aid]) byAgent[aid] = { cost: 0, calls: 0 };
        byAgent[aid].cost += (u.totalCost || 0);
        byAgent[aid].calls++;
      });
      costSummary = { byDay: byDay, byAgent: byAgent };
    }
    var financeDigest = financeIntel.buildFinanceDigest(
      geminiUsage, state.heartbeatRuns, campaigns, tasks, null, costSummary, Date.now()
    );
    var financeBlock = financeIntel._buildFinancePromptBlock({ id: 'cipher', name: 'Cipher' }, financeDigest);
    if (financeBlock) blocks.push(financeBlock);
  } catch (e) { /* finance intel unavailable */ }

  try {
    // Performance intel
    var perfDigest = performanceIntel.buildPerformanceDigest(
      tasks, state.actions, state.socialEngagementSnapshots, null, Date.now(), {}
    );
    var perfBlock = performanceIntel._buildPerformancePromptBlock(perfDigest);
    if (perfBlock) blocks.push(perfBlock);
  } catch (e) { /* performance intel unavailable */ }

  return blocks.join('\n');
}

// ────────────────────────────────────────────
// formatMoodTelemetry — real data for Nova mood engine (~200-400 tokens)
// Used by: synthesizeNovaMood
// NOTE: does a targeted storage.getState('heartbeatRuns') internally
// to avoid requiring includeIntelData (expensive) for a lightweight endpoint.
// ────────────────────────────────────────────
async function formatMoodTelemetry(state) {
  var tasks = state.tasks || [];
  var campaigns = state.campaigns || [];

  var activeTasks = tasks.filter(function (t) { return t.status !== 'done' && t.status !== 'backlog'; }).length;
  var cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  var completedToday = tasks.filter(function (t) {
    return t.status === 'done' && (t.completedAt || t.updatedAt || '') > cutoff24h;
  }).length;
  var overdue = tasks.filter(function (t) {
    return t.status !== 'done' && t.dueDate && t.dueDate < new Date().toISOString();
  }).length;
  var blocked = tasks.filter(function (t) { return t.blocked; }).length;
  var activeCampaigns = campaigns.filter(function (c) {
    return String(c.status || '').toLowerCase() === 'active' && !c.deletedAt;
  }).length;

  // Targeted load for heartbeat health
  var runs = [];
  try { runs = (await storage.getState('heartbeatRuns')) || []; } catch (e) { /* unavailable */ }
  if (!Array.isArray(runs)) runs = [];
  var last5 = runs.slice(-5);
  var okCount = last5.filter(function (r) { return r.status === 'ok'; }).length;

  var hour = new Date().getUTCHours();

  return 'Nova system pulse (real data):\n' +
    '- Active tasks: ' + activeTasks + '\n' +
    '- Completed (24h): ' + completedToday + '\n' +
    '- Overdue: ' + overdue + '\n' +
    '- Blocked: ' + blocked + '\n' +
    '- Active campaigns: ' + activeCampaigns + '\n' +
    '- Heartbeat health: ' + okCount + '/' + last5.length + ' OK (last 5 runs)\n' +
    '- Time: ' + hour + ':00 UTC\n' +
    'Base your mood on these real operational signals, not imagination.';
}

// ────────────────────────────────────────────
// formatMorningBrief — CEO-oriented context (~2000-2500 tokens)
// Used by: companyMorningReport
// NOTE: calls formatCoreContext internally (implicit dependency).
// ────────────────────────────────────────────
function formatMorningBrief(state) {
  var lines = [formatCoreContext(state, 'nova')];

  // Campaign descriptions (up to 400 chars each)
  var campaigns = state.campaigns || [];
  var active = campaigns.filter(function (c) {
    return String(c.status || '').toLowerCase() === 'active' && !c.deletedAt;
  });
  if (active.length > 0) {
    lines.push('\nCampaign details:');
    active.forEach(function (c) {
      if (c.description) {
        lines.push('- ' + c.title + ': ' + c.description.substring(0, 400));
      }
    });
  }

  // Product facts summary
  if (state.productFacts && state.productFacts.products) {
    var names = Object.keys(state.productFacts.products);
    lines.push('\nProduct portfolio: ' + names.join(', '));
  }

  // Documents summary
  var docs = state.documents || [];
  if (docs.length > 0) {
    var published = docs.filter(function (d) { return d.status === 'published' || d.status === 'approved'; }).length;
    var drafts = docs.filter(function (d) { return d.status === 'draft'; }).length;
    lines.push('\nDocuments: ' + docs.length + ' total (' + published + ' published, ' + drafts + ' drafts)');
  }

  // Full skill content for the morning brief context as well
  var mbSkillsBlock = formatSkillsBlock(state, 'nova');
  if (mbSkillsBlock) lines.push(mbSkillsBlock);

  return lines.join('\n');
}

// ────────────────────────────────────────────
// Internal: Cipher cost block
// ────────────────────────────────────────────
function _buildCipherCostBlock(state) {
  // Use inline calculation from geminiUsage if available in state (from includeIntelData)
  // Otherwise do a synchronous summary from what we have
  var usage = state.geminiUsage || [];
  if (usage.length === 0) return '';

  var cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  var recent = usage.filter(function (u) { return (u.timestamp || '') >= cutoff; });
  if (recent.length === 0) return '';

  var totalCost = 0, totalCalls = recent.length, totalTokens = 0;
  var byAgent = {};
  recent.forEach(function (u) {
    totalCost += (u.totalCost || 0);
    totalTokens += (u.promptTokens || 0) + (u.completionTokens || 0);
    var aid = u.agentId || 'unknown';
    if (!byAgent[aid]) byAgent[aid] = { cost: 0 };
    byAgent[aid].cost += (u.totalCost || 0);
  });

  var topAgents = Object.keys(byAgent).sort(function (a, b) { return byAgent[b].cost - byAgent[a].cost; }).slice(0, 3);
  var avgDaily = totalCost / 30;

  return '\n\nREAL COST DATA (use ONLY these numbers — never estimate or guess):' +
    '\nAI API (30d): $' + totalCost.toFixed(4) + ' | ' + totalCalls + ' calls | ' + totalTokens.toLocaleString() + ' tokens' +
    '\nAvg daily: $' + avgDaily.toFixed(4) + ' | Projected monthly: $' + (avgDaily * 30).toFixed(2) +
    '\nTop agents: ' + topAgents.map(function (a) { return a + ' $' + byAgent[a].cost.toFixed(4); }).join(', ') +
    '\nNEVER make up cost numbers. Only report what is shown above.';
}

// ────────────────────────────────────────────
// formatSkillsBlock — injects full skill content for chat/standup/morning report endpoints
// Matches the shape used by prompt-builders.js skillsBlock for the heartbeat.
// Every agent gets every skill — agents need product knowledge to answer product questions.
// Used by: agentchat, novachat, standup, morning report
// ────────────────────────────────────────────
function formatSkillsBlock(state, agentId) {
  if (!state || !state.skillsData || !Array.isArray(state.skillsData.skills) || state.skillsData.skills.length === 0) {
    return '';
  }
  var skills = state.skillsData.skills;
  if (skills.length === 0) return '';

  var skillParts = skills.map(function (s, idx) {
    return '═══════════════════════════════════════════════════════════════\n' +
      '📘 SKILL ' + (idx + 1) + '/' + skills.length + ': ' + s.name + ' (' + s.url + ')\n' +
      '═══════════════════════════════════════════════════════════════\n\n' +
      (s.content || '').trim();
  });

  return '\n\n🗂️  SKILL REFERENCES (canonical source — each skill below is its own reference doc. Read Recent Changes at the top of each skill first, then use the content below when you need product/system facts):\n\n' +
    skillParts.join('\n\n') +
    '\n\n═══════════════════════════════════════════════════════════════\n' +
    '📘 END SKILL REFERENCES\n' +
    '═══════════════════════════════════════════════════════════════\n';
}

module.exports = {
  formatCoreContext: formatCoreContext,
  formatRichContext: formatRichContext,
  formatIntelDigests: formatIntelDigests,
  formatMoodTelemetry: formatMoodTelemetry,
  formatMorningBrief: formatMorningBrief,
  formatSkillsBlock: formatSkillsBlock
};
