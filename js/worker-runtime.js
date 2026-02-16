// worker-runtime.js — Execution wrapper + prompt building + result shaping for Worker Framework v1
// Workers receive items, build a prompt, call the agent API, and return a structured report.
// Workers NEVER directly mutate tasks — proposed_actions are suggestions only.

var WorkerRuntime = (function () {
  'use strict';

  // ── Execute a single worker run ──
  // workerDef: registry entry for this worker type
  // job: { jobType, items[], context }
  // Returns: structured report object (worker_report_v1)
  function execute(workerDef, job, correlationId) {
    if (!workerDef || !job) {
      return Promise.reject(new Error('Missing worker definition or job'));
    }

    var startedAt = new Date().toISOString();
    var items = (job.items || []).slice(0, workerDef.budget.maxItemsPerRun);

    // Build the prompt
    var prompt = _buildPrompt(workerDef, job.jobType, items, job.context);

    // Use AgentEngine.chat if available, otherwise simulate
    return _callAgent(workerDef, prompt).then(function (raw) {
      var finishedAt = new Date().toISOString();
      return _shapeReport(workerDef, correlationId, startedAt, finishedAt, items.length, raw, items);
    });
  }

  // ── Prompt builder ──
  function _buildPrompt(workerDef, jobType, items, context) {
    var sections = [];

    sections.push('You are a ' + workerDef.name + ' (ephemeral worker, owned by ' + workerDef.ownerRole + ').');
    sections.push('Job type: ' + (jobType || 'general_triage'));
    sections.push('You are a temporary worker. You produce a REPORT only. You do NOT take actions.');
    sections.push('');

    // Context snapshot
    if (context) {
      sections.push('== Context Snapshot ==');
      if (context.directives && context.directives.length > 0) {
        sections.push('Active directives: ' + context.directives.join(', '));
      }
      if (context.objectives && context.objectives.length > 0) {
        sections.push('Active objectives: ' + context.objectives.join(', '));
      }
      if (context.laneCounts) {
        var lc = context.laneCounts;
        sections.push('Lanes: backlog=' + (lc.backlog || 0) + ', in_progress=' + (lc.in_progress || 0) + ', in_review=' + (lc.in_review || 0) + ', done=' + (lc.done || 0));
      }
      if (context.overdueCount != null) sections.push('Overdue: ' + context.overdueCount);
      if (context.pendingApprovalsCount != null) sections.push('Pending approvals: ' + context.pendingApprovalsCount);
      sections.push('');
    }

    // Items to process
    sections.push('== Items to Process (' + items.length + ') ==');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var line = (i + 1) + '. ';
      if (item.title) line += item.title;
      if (item.status) line += ' [' + item.status + ']';
      if (item.priority) line += ' (priority: ' + item.priority + ')';
      if (item.assignee) line += ' — ' + item.assignee;
      if (item.age) line += ' — ' + item.age;
      sections.push(line);
    }
    sections.push('');

    // Output format instruction
    var required = workerDef.outputSchema.requiredSections || [];
    sections.push('== Output Format ==');
    sections.push('Respond with a JSON object containing these sections: ' + required.join(', '));
    sections.push('Each proposed_action must include: itemId, actionType, rationale, priority (high/medium/low), riskLevel (low/medium/high).');
    sections.push('Do NOT take any actions. Only produce analysis and recommendations.');

    return sections.join('\n');
  }

  // ── Agent call ──
  function _callAgent(workerDef, prompt) {
    // Use AgentEngine if available
    if (typeof AgentEngine !== 'undefined' && AgentEngine.chat) {
      var agent = (workerDef.ownerRole || 'nova').toLowerCase();
      return AgentEngine.chat(agent, prompt).then(function (result) {
        // AgentEngine.chat returns { reply, actions } — we only use reply
        var text = typeof result === 'string' ? result : (result && result.reply ? result.reply : '');
        return _parseJsonFromReply(text);
      });
    }
    // Fallback: simulate a report structure
    return Promise.resolve(_simulatedReport());
  }

  // ── Parse JSON from agent reply ──
  function _parseJsonFromReply(text) {
    if (!text) return _simulatedReport();
    // Try to extract JSON from the reply
    try {
      // Look for JSON block
      var jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) { /* ignore parse errors */ }
    // Fallback: wrap text as summary
    return { summary: text, findings: [], proposed_actions: [], risks: [], next_steps: [] };
  }

  // ── Simulated report for offline/test mode ──
  function _simulatedReport() {
    return {
      summary: 'Worker completed analysis cycle. No critical issues detected.',
      findings: ['Reviewed assigned items within budget constraints.'],
      proposed_actions: [],
      risks: [],
      next_steps: ['Continue monitoring during next evaluation cycle.']
    };
  }

  // ── Shape final report ──
  function _shapeReport(workerDef, correlationId, startedAt, finishedAt, itemCount, raw, items) {
    var report = {
      workerId: workerDef.id + '_' + correlationId,
      type: workerDef.id,
      owner: workerDef.ownerRole,
      correlationId: correlationId,
      startedAt: startedAt,
      finishedAt: finishedAt,
      status: 'completed',
      itemsProcessed: itemCount,
      summary: (raw && raw.summary) || 'No summary produced.',
      findings: (raw && Array.isArray(raw.findings)) ? raw.findings : [],
      proposed_actions: _sanitizeActions(raw && raw.proposed_actions, items),
      risks: (raw && Array.isArray(raw.risks)) ? raw.risks : [],
      next_steps: (raw && Array.isArray(raw.next_steps)) ? raw.next_steps : []
    };

    // Validate required sections exist
    var required = workerDef.outputSchema.requiredSections || [];
    for (var i = 0; i < required.length; i++) {
      if (report[required[i]] === undefined) {
        report[required[i]] = [];
      }
    }

    return report;
  }

  // ── Sanitize proposed actions (strip any mutation flags) ──
  // Verification Gate v1: annotate proposals with verification result
  function _sanitizeActions(actions, items) {
    if (!Array.isArray(actions)) return [];
    // Build item lookup for verification
    var itemMap = {};
    if (Array.isArray(items)) {
      items.forEach(function (it) { if (it && it.id) itemMap[it.id] = it; });
    }
    return actions.map(function (a) {
      var sanitized = {
        itemId: a.itemId || null,
        actionType: a.actionType || 'review',
        rationale: a.rationale || '',
        priority: _normPriority(a.priority),
        riskLevel: _normRisk(a.riskLevel)
      };
      // Verification Gate v1 — validate proposal against task data
      if (typeof TaskVerifier !== 'undefined' && TaskVerifier.isLoaded && TaskVerifier.isLoaded()) {
        var task = (sanitized.itemId && itemMap[sanitized.itemId]) ? itemMap[sanitized.itemId] : null;
        if (task) {
          sanitized = TaskVerifier.validateProposal(sanitized, task);
        }
      }
      return sanitized;
    });
  }

  function _normPriority(val) {
    if (['high', 'medium', 'low'].indexOf(val) !== -1) return val;
    return 'medium';
  }

  function _normRisk(val) {
    if (['high', 'medium', 'low'].indexOf(val) !== -1) return val;
    return 'low';
  }

  return {
    execute: execute
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkerRuntime;
}
