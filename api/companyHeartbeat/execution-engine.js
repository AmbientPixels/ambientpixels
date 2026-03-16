// execution-engine.js — extracted from companyHeartbeat/index.js (Phase 3 refactor)
// Execute/review tasks: workspace resolution, prompt building, Gemini calls

const { AGENT_ROLES } = require("./constants");
const { callGeminiExecute } = require("./gemini");
const { _resolveWorkspaceFiles } = require("./workspace-context");
const { _buildSiteIntelSection, _buildSocialIntelExecSection } = require("./site-intelligence");
const { buildSiteContextBlock } = require("./prompt-builders");
function _buildExecContextBlock(agent, task, ctx) {
  if (!ctx) return '';
  const parts = [];
  const MAX_CTX_CHARS = 3000; // total budget for all 5 sections
  let used = 0;

  // 1) CAMPAIGN / OBJECTIVE CONTEXT — if task is linked to a campaign or objective, show what it says
  const cmpId = task.campaign_id || null;
  const objId = task.objective_id || null;
  if (cmpId && Array.isArray(ctx.campaigns)) {
    const cmp = ctx.campaigns.find(c => c.id === cmpId);
    if (cmp) {
      const desc = (cmp.description || '').substring(0, 300);
      const line = '\n📋 CAMPAIGN CONTEXT (this task belongs to campaign "' + cmp.title + '", id: ' + cmp.id + (cmp.priority ? ', priority: ' + cmp.priority : '') + '):\n' + (desc || '(no description)');
      if (used + line.length < MAX_CTX_CHARS) { parts.push(line); used += line.length; }
    }
  }
  if (objId && Array.isArray(ctx.objectives)) {
    const obj = ctx.objectives.find(o => o.id === objId);
    if (obj) {
      const line = '🎯 GOAL: "' + obj.title + '" (progress: ' + (obj.progress || 0) + '%) — align your deliverable to advance this goal.';
      if (used + line.length < MAX_CTX_CHARS) { parts.push(line); used += line.length; }
    }
  }

  // 2) CEO SEED MEMORIES — curated instructions the CEO wrote for this agent
  if (ctx.seedMemories) {
    const globalSeed = (ctx.seedMemories._global || '').substring(0, 600);
    const agentSeed = (ctx.seedMemories[ctx.agentId] || '').substring(0, 400);
    if (globalSeed || agentSeed) {
      let seedBlock = '\n📝 CEO INSTRUCTIONS (follow these during execution):';
      if (globalSeed) seedBlock += '\n' + globalSeed;
      if (agentSeed) seedBlock += '\n--- Your specific instructions ---\n' + agentSeed;
      if (used + seedBlock.length < MAX_CTX_CHARS) { parts.push(seedBlock); used += seedBlock.length; }
    }
  }

  // 3) RESEARCH INTEL — Scout's findings, useful for content/strategy tasks
  if (Array.isArray(ctx.researchIntel) && ctx.researchIntel.length > 0) {
    const combined = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
    const wantsResearch = agent.name === 'Scout' || agent.name === 'Nova' || agent.name === 'Scribe' ||
      /research|market|competitor|trend|benchmark|strateg|analys|intel|brief/.test(combined);
    if (wantsResearch) {
      const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const recent = ctx.researchIntel
        .filter(r => !r.timestamp || new Date(r.timestamp).getTime() > cutoff)
        .slice(-3);
      if (recent.length > 0) {
        let rBlock = '\n🔍 RESEARCH INTEL (from Scout — real findings, cite these):';
        for (const ri of recent) {
          const entry = '\n- ' + (ri.title || 'Research') + ': ' + (ri.summary || '').substring(0, 200);
          if (used + rBlock.length + entry.length > MAX_CTX_CHARS) break;
          rBlock += entry;
          const findings = (ri.key_findings || []).slice(0, 3).map(f => '  • ' + f).join('\n');
          if (findings) rBlock += '\n' + findings;
          const sources = (ri.sources || []).slice(0, 2).join(', ');
          if (sources) rBlock += '\n  Sources: ' + sources;
        }
        parts.push(rBlock);
        used += rBlock.length;
      }
    }
  }

  // 4) SITE CONTEXT — page inventory, recent changes, build info
  try {
    const combined = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
    const wantsSite = agent.name === 'Scribe' || agent.name === 'Pixel' || agent.name === 'Forge' || agent.name === 'Scout' ||
      /site|page|content|blog|seo|design|audit|layout|navigation|url/.test(combined);
    if (wantsSite) {
      const siteBlock = buildSiteContextBlock();
      if (siteBlock && used + siteBlock.length < MAX_CTX_CHARS) {
        parts.push(siteBlock);
        used += siteBlock.length;
      }
    }
  } catch (e) { /* non-fatal */ }

  // 5) EXISTING DOCUMENTS — prevent duplicate creation, know what's published
  if (Array.isArray(ctx.documents) && ctx.documents.length > 0) {
    const combined = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
    const wantsDocs = agent.name === 'Scribe' || agent.name === 'Nova' || agent.name === 'Quill' ||
      /doc|blog|article|publish|draft|content|write|brief|spec/.test(combined);
    if (wantsDocs) {
      const docList = ctx.documents.slice(-8).map(d =>
        '- "' + d.title + '" [' + (d.status || 'draft') + '] (id: ' + d.id + (d.promote ? ', promote: YES' : '') + ')'
      ).join('\n');
      const dBlock = '\n📄 EXISTING DOCUMENTS (do NOT duplicate these):\n' + docList;
      if (used + dBlock.length < MAX_CTX_CHARS) { parts.push(dBlock); used += dBlock.length; }
    }
  }

  return parts.length > 0 ? parts.join('\n') + '\n' : '';
}

// ── Execute a task: agent produces actual work output ──
async function executeTask(context, agent, task, costIntel, siteIntel, socialIntel, execContext) {
  // Resolve workspace files for real code context
  let workspaceFiles = [];
  try {
    workspaceFiles = _resolveWorkspaceFiles(agent, task);
    if (workspaceFiles.length > 0) {
      context.log('[Heartbeat]', agent.name, 'workspace context injected:', workspaceFiles.length, 'file(s) for:', task.title);
    }
  } catch (wsErr) {
    context.log.warn('[Heartbeat]', agent.name, 'workspace file resolve failed (non-fatal):', wsErr.message);
  }
  const prompt = buildExecutePrompt(agent, task, workspaceFiles, costIntel, siteIntel, socialIntel, execContext);
  const output = await callGeminiExecute(prompt, agent.name.toLowerCase());
  if (!output) {
    context.log('[Heartbeat]', agent.name, 'execute-task returned empty for:', task.title);
    return null;
  }
  context.log('[Heartbeat]', agent.name, 'produced deliverable for:', task.title, '(' + output.length + ' chars)');
  return output;
}

function buildExecutePrompt(agent, task, workspaceFiles, costIntel, siteIntel, socialIntel, execContext) {
  workspaceFiles = workspaceFiles || [];
  costIntel = costIntel || null;
  siteIntel = siteIntel || {};
  socialIntel = socialIntel || null;
  execContext = execContext || {};
  // Gather existing comments for context
  const existingComments = (task.comments || [])
    .filter(c => c.text)
    .map(c => '- [' + (c.type || 'comment') + ' by ' + (c.author || 'unknown') + '] ' + c.text.substring(0, 200))
    .join('\n') || '(none)';

  // Revision-awareness: count prior deliverables and feedback to prevent re-draft loops
  const _deliverableComments = (task.comments || []).filter(c => c.type === 'deliverable');
  const _feedbackComments = (task.comments || []).filter(c =>
    c.type === 'review' || c.type === 'feedback' ||
    (c.text && /please\s+(incorporate|add|revise|update|fix|address|action)/i.test(c.text))
  );
  const _revisionCycle = _deliverableComments.length;
  let _revisionBlock = '';
  if (_revisionCycle >= 1 && _feedbackComments.length > 0) {
    const latestFeedback = _feedbackComments.slice(-3).map(c =>
      '- ' + (c.author || 'unknown') + ': ' + (c.text || '').substring(0, 300)
    ).join('\n');
    _revisionBlock = `
⚠️ REVISION MODE (cycle ${_revisionCycle + 1}) — This task already has ${_revisionCycle} prior deliverable(s) and ${_feedbackComments.length} feedback comment(s).
DO NOT write a new document from scratch. Instead:
1. Start from your most recent deliverable
2. Address EACH specific feedback point listed below
3. Mark addressed items with [ADDRESSED] in your revision notes
4. Only change sections that were flagged — preserve everything else

FEEDBACK TO ADDRESS:
${latestFeedback}

If you cannot address a feedback point, explain why in a brief note. Do NOT re-draft the entire document.`;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const eDW = agent._doctrineWeight != null ? agent._doctrineWeight : 0.4;
  const execDoctrine = (agent.doctrine && eDW > 0) ? `
OPERATING DOCTRINE (apply with weight: ${eDW} / ${Math.round(eDW * 100)}%):
- Strategic Bias: ${agent.doctrine.strategicBias}
- Risk Tolerance: ${agent.doctrine.riskTolerance}
- Core Question: "${agent.doctrine.coreQuestion}"
Apply your doctrine lens to your deliverable. Doctrine does NOT override governance or CEO authority.
` : '';
  return `You are ${agent.name}, ${agent.role} at AmbientPixels. Your focus: ${agent.focus}.
TODAY'S DATE: ${todayStr}
${execDoctrine}
You are executing a task and producing a deliverable. This is real work output — be thorough, specific, and actionable.

TASK: ${task.title}
DESCRIPTION: ${task.description || '(no description)'}
PRIORITY: ${task.priority}
STATUS: ${task.status}

EXISTING COMMENTS/HISTORY:
${existingComments}
${_revisionBlock}
${workspaceFiles.length > 0 ? '\nWORKSPACE FILES (actual source code from the AmbientPixels repo — review these, do NOT roleplay):\n' + workspaceFiles.map(f => '--- ' + f.path + ' ---\n' + f.content).join('\n\n') + '\n' : ''}${costIntel && costIntel.gemini && costIntel.gemini.totalCalls > 0 && agent.name === 'Cipher' ? '\n💰 REAL COST DATA (30-day window — use these numbers, do NOT fabricate financial data):\nGemini API — Total: $' + costIntel.gemini.totalCost.toFixed(4) + ' | Calls: ' + costIntel.gemini.totalCalls + ' | Tokens: ' + costIntel.gemini.totalTokens.toLocaleString() + '\nAvg daily: $' + (costIntel.gemini.totalCost / Math.max(Object.keys(costIntel.gemini.byDay || {}).length, 1)).toFixed(4) + '/day | Projected monthly: $' + ((costIntel.gemini.totalCost / Math.max(Object.keys(costIntel.gemini.byDay || {}).length, 1)) * 30).toFixed(2) + '\nBy Agent: ' + Object.entries(costIntel.gemini.byAgent || {}).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5).map(([n, d]) => n + ': $' + d.cost.toFixed(4) + ' (' + d.calls + ' calls)').join(', ') + '\nBy Service: ' + Object.entries(costIntel.gemini.byCaller || {}).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5).map(([n, d]) => n + ': $' + d.cost.toFixed(4)).join(', ') + '\n' : ''}${_buildSiteIntelSection(agent, task, siteIntel)}${_buildSocialIntelExecSection(agent, task, socialIntel)}${_buildExecContextBlock(agent, task, execContext)}
Based on your role as ${agent.role}, produce the appropriate deliverable for this task. Examples of what you should produce:
${agent.role === 'CEO' ? '- Strategic analysis, priority decisions, team directives, product direction memos' : ''}${agent.role === 'CFO' ? '- Budget reports, cost analyses, spending recommendations, ROI assessments' : ''}${agent.role === 'Design & QC' ? '- Design reviews, UI audit notes, accessibility recommendations, UX improvement plans' : ''}${agent.role === 'DevOps' ? '- Deployment plans, infrastructure audits, security checklists, performance reports' : ''}${agent.role === 'Marketing' ? '- Content drafts, social media copy, campaign briefs, brand messaging guides' : ''}${agent.name === 'Scribe' ? '- Longform drafts, product briefs, blog posts, documentation, social threads' : ''}${agent.name === 'Quill' ? '- Editing feedback, tone corrections, brand voice enforcement, CTA improvements' : ''}${agent.name === 'Scout' ? '- Market research briefs, competitive intelligence reports, trend analyses, strategic research, business benchmarks. Always include a ## Sources section with cited URLs.' : ''}

CRITICAL RULES — READ CAREFULLY:
- Write your deliverable directly — no JSON wrapping. Be specific to AmbientPixels.
- Use headers, bullet points, or sections as appropriate. This will be attached to the task as a deliverable comment.
- Use today's date (${todayStr}) for any dates in your deliverable. NEVER use dates from 2023 or 2024.
- Your deliverable must be COMPLETE and SELF-CONTAINED. Do NOT create placeholder sections like "Appendix A", "TBD", "To Be Populated", or reference external documents that do not exist.
- Do NOT reference or wait for information from external sources that have not been provided to you. Work with what you have.
- Do NOT invent fictional dependencies, missing documents, or pending inputs. If you need more context, note it briefly in a "Notes" section but still deliver complete, actionable output.
- NEVER loop on the same request across multiple heartbeats. If you already produced a deliverable, do not produce it again unless explicitly asked for a revision.`;
}

// ── Review a task: agent evaluates another agent's deliverable ──
async function reviewTask(context, agent, task, costIntel, siteIntel, socialIntel, execContext) {
  // Resolve workspace files for real code context during review
  let workspaceFiles = [];
  try {
    workspaceFiles = _resolveWorkspaceFiles(agent, task);
    if (workspaceFiles.length > 0) {
      context.log('[Heartbeat]', agent.name, 'review workspace context injected:', workspaceFiles.length, 'file(s) for:', task.title);
    }
  } catch (wsErr) {
    context.log.warn('[Heartbeat]', agent.name, 'review workspace file resolve failed (non-fatal):', wsErr.message);
  }
  const prompt = buildReviewPrompt(agent, task, workspaceFiles, costIntel, siteIntel, socialIntel, execContext);
  const response = await callGeminiExecute(prompt, agent.name.toLowerCase());
  if (!response) {
    context.log('[Heartbeat]', agent.name, 'review-task returned empty for:', task.title);
    return null;
  }

  // Parse verdict from response
  let verdict = 'approved';
  let feedback = response;

  // Check if the response contains structured verdict
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      verdict = parsed.verdict === 'changes-requested' ? 'changes-requested' : 'approved';
      feedback = parsed.feedback || response;
    }
  } catch (e) {
    // If no JSON, check for keywords
    const lower = response.toLowerCase();
    if (lower.includes('changes requested') || lower.includes('needs revision') || lower.includes('request changes') || lower.includes('not approved')) {
      verdict = 'changes-requested';
    }
  }

  context.log('[Heartbeat]', agent.name, 'reviewed:', task.title, '→', verdict);
  return { verdict, feedback };
}

function buildReviewPrompt(agent, task, workspaceFiles, costIntel, siteIntel, socialIntel, execContext) {
  workspaceFiles = workspaceFiles || [];
  costIntel = costIntel || null;
  siteIntel = siteIntel || {};
  socialIntel = socialIntel || null;
  execContext = execContext || {};
  // Find the deliverable comment(s)
  const deliverables = (task.comments || [])
    .filter(c => c.type === 'deliverable')
    .map(c => '--- Deliverable by ' + (c.author || 'unknown') + ' ---\n' + c.text)
    .join('\n\n') || '(no deliverable found)';

  // Find any previous reviews
  const previousReviews = (task.comments || [])
    .filter(c => c.type === 'review')
    .map(c => '--- Review by ' + (c.author || 'unknown') + ' [' + (c.verdict || '?') + '] ---\n' + c.text)
    .join('\n\n');

  const rDW = agent._doctrineWeight != null ? agent._doctrineWeight : 0.4;
  const reviewDoctrine = (agent.doctrine && rDW > 0) ? `
OPERATING DOCTRINE (apply with weight: ${rDW} / ${Math.round(rDW * 100)}%):
- Strategic Bias: ${agent.doctrine.strategicBias}
- Risk Tolerance: ${agent.doctrine.riskTolerance}
- Core Question: "${agent.doctrine.coreQuestion}"
Review through your doctrine lens. Doctrine does NOT override governance or CEO authority.
` : '';

  return `You are ${agent.name}, ${agent.role} at AmbientPixels. Your focus: ${agent.focus}.
${reviewDoctrine}
You are reviewing a deliverable from another team member. Evaluate the quality and completeness of their work.

TASK: ${task.title}
DESCRIPTION: ${task.description || '(no description)'}
ASSIGNED TO: ${task.assignee || 'unassigned'}
PRIORITY: ${task.priority}

DELIVERABLE(S):
${deliverables}
${previousReviews ? '\nPREVIOUS REVIEWS:\n' + previousReviews : ''}
${workspaceFiles.length > 0 ? '\nWORKSPACE FILES (actual source code — compare the deliverable against these real files, do NOT roleplay):\n' + workspaceFiles.map(f => '--- ' + f.path + ' ---\n' + f.content).join('\n\n') + '\n' : ''}${costIntel && costIntel.gemini && costIntel.gemini.totalCalls > 0 && agent.name === 'Cipher' ? '\n💰 REAL COST DATA for verification:\nGemini API Total: $' + costIntel.gemini.totalCost.toFixed(4) + ' | Calls: ' + costIntel.gemini.totalCalls + ' | Tokens: ' + costIntel.gemini.totalTokens.toLocaleString() + '\n' : ''}${_buildSiteIntelSection(agent, task, siteIntel)}${_buildSocialIntelExecSection(agent, task, socialIntel)}${_buildExecContextBlock(agent, task, execContext)}
Review this deliverable from your perspective as ${agent.role}. Then respond with ONLY valid JSON:
{
  "verdict": "approved" or "changes-requested",
  "feedback": "Your detailed review feedback — what's good, what needs improvement, specific suggestions. 2-4 sentences."
}

Guidelines:
- Approve if the work is solid and addresses the task
- Request changes if there are significant gaps, errors, or missing elements
- Be constructive — give specific, actionable feedback
- Consider quality from your role's perspective (${agent.focus})
- Do NOT request "Appendix A", external documents, or fictional dependencies that were not provided. Judge the deliverable based on what was actually produced.
- Do NOT loop — if the deliverable is reasonably complete, approve it. Perfection is not the goal; actionable output is.`;
}
module.exports = { _buildExecContextBlock, executeTask, buildExecutePrompt, reviewTask, buildReviewPrompt };
