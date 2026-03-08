// task-mutations.js — extracted from companyHeartbeat/index.js (Phase 3 refactor)
// Central mutation dispatcher: create, execute, review, comment, update, move, set-research-intel

const { CFO_THRESHOLD, AGENT_IDS, VALID_TASK_STATUSES } = require("./constants");
const { stripTaskPrefixes } = require("./helpers");
// ── Apply task mutation ──
function applyTaskUpdate(tasks, update, _pendingEscalations, _creatingAgentId) {
  if (update.action === 'create') {
    var riskLevel = update.task.risk_level || 'low';
    const budgetImpact = update.task.budget_impact || 0;
    var brandImpact = update.task.brand_impact || 'low';

    // Social tasks are brand-impacting — override defaults
    const _SOCIAL_TASK_TYPES = ['social_x', 'social_linkedin', 'social_bluesky', 'social_post'];
    if (_SOCIAL_TASK_TYPES.indexOf(update.task.taskType) !== -1) {
      if (brandImpact === 'low') brandImpact = 'medium';
      if (riskLevel === 'low') riskLevel = 'medium';
    }

    // Auto-classify
    let classification = update.task.classification || 'autonomous';
    if (riskLevel === 'high' || brandImpact === 'high') classification = 'executive_required';
    else if (budgetImpact > CFO_THRESHOLD) classification = 'executive_required';
    else if (riskLevel === 'medium' || brandImpact === 'medium') classification = 'advisory';

    const requiresApproval = classification === 'executive_required' || classification === 'advisory';

    // Validate and normalize dueDate — Gemini may send partial dates or weird formats
    const rawDue = update.task.dueDate;
    const parsedDue = rawDue ? new Date(rawDue) : null;
    const validDueDate = (parsedDue && !isNaN(parsedDue.getTime()))
      ? parsedDue.toISOString()
      : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(); // fallback: 3 days out

    // Validate assignee — must be a known agent ID
    const rawAssignee = (update.task.assignee || '').toLowerCase();
    const validAssignee = AGENT_IDS.indexOf(rawAssignee) !== -1 ? rawAssignee : 'nova';

    const task = {
      id: 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      title: update.task.title,
      description: update.task.description || '',
      taskType: update.task.taskType || 'general',
      status: (update.task.status && VALID_TASK_STATUSES.indexOf(update.task.status) !== -1) ? update.task.status : 'todo',
      priority: update.task.priority || 'medium',
      assignee: validAssignee,
      division: update.task.division || null,
      tags: [],
      dueDate: validDueDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      comments: [],
      source: 'heartbeat',
      created_by: _creatingAgentId || 'system',
      parent_task_id: update.task.parent_task_id || null,
      // Governance fields
      requires_ceo_approval: requiresApproval,
      risk_level: riskLevel,
      budget_impact: budgetImpact,
      brand_impact: brandImpact,
      escalated: requiresApproval,
      classification: classification,
      campaign_id: update.task.campaign_id || null,
      objective_id: update.task.objective_id || null
    };
    tasks.push(task);
    if (tasks.length > 500) tasks.splice(0, tasks.length - 500);

    // Auto-escalate to approval queue if needed
    if (requiresApproval) {
      _pendingEscalations.push({
        taskId: task.id,
        taskTitle: task.title,
        classification: classification,
        riskLevel: riskLevel,
        budgetImpact: budgetImpact,
        brandImpact: brandImpact,
        originAgent: update.task.assignee || 'nova'
      });
    }
    return task;
  }

  if (update.action === 'execute') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        // Add deliverable as a comment
        if (!tasks[i].comments) tasks[i].comments = [];
        tasks[i].comments.push({
          id: 'cmt-' + Date.now(),
          author: update.agentId,
          text: update.deliverable,
          type: 'deliverable',
          createdAt: new Date().toISOString()
        });
        // Move to review
        tasks[i].status = 'review';
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }

  if (update.action === 'review') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        // MANDATORY PEER REVIEW: block self-review — reviewer must be different from assignee
        const taskAssignee = (tasks[i].assignee || '').toLowerCase();
        const reviewerId = (update.agentId || '').toLowerCase();
        if (taskAssignee && reviewerId && taskAssignee === reviewerId) {
          // Self-review blocked — log and skip
          if (!tasks[i].comments) tasks[i].comments = [];
          tasks[i].comments.push({
            id: 'cmt-' + Date.now(),
            author: 'system',
            text: 'Self-review blocked: ' + update.agentId + ' cannot review their own deliverable. A different agent must review this task.',
            type: 'system',
            createdAt: new Date().toISOString()
          });
          tasks[i].updatedAt = new Date().toISOString();
          return tasks[i];
        }
        // Add review as a comment
        if (!tasks[i].comments) tasks[i].comments = [];
        tasks[i].comments.push({
          id: 'cmt-' + Date.now(),
          author: update.agentId,
          text: update.review.feedback,
          type: 'review',
          verdict: update.review.verdict,
          createdAt: new Date().toISOString()
        });
        // Move based on verdict
        if (update.review.verdict === 'approved') {
          // DELIVERABLE GATE: tasks with deliverables require CEO approval before moving to done
          const _hasDeliverable = (tasks[i].comments || []).some(c => c.type === 'deliverable');

          // ── COPY PROPAGATION (special case — auto-completes, feeds into social pipeline) ──
          const _tags = tasks[i].tags || [];
          const _isSocialCopy = _tags.indexOf('social-copy') !== -1;
          if (_isSocialCopy) {
            // Social-copy tasks auto-complete: the parent social post has its own approval gate
            tasks[i].status = 'done';
            tasks[i].completedAt = new Date().toISOString();
            const _parentTag = _tags.find(t => t.startsWith('social-copy-for-'));
            const _parentSocialTaskId = _parentTag ? _parentTag.replace('social-copy-for-', '') : null;
            if (_parentSocialTaskId) {
              const _parentSocialTask = tasks.find(t => t.id === _parentSocialTaskId);
              if (_parentSocialTask) {
                const _deliverables = (tasks[i].comments || []).filter(c => c.type === 'deliverable');
                const _copyText = _deliverables.length > 0 ? _deliverables[_deliverables.length - 1].text : '';
                if (_copyText) {
                  _parentSocialTask.reviewed_copy = _copyText;
                  _parentSocialTask.awaiting_copy_review = false;
                  _parentSocialTask.updatedAt = new Date().toISOString();
                  if (!_parentSocialTask.comments) _parentSocialTask.comments = [];
                  _parentSocialTask.comments.push({
                    id: 'cmt-copyready-' + Date.now(),
                    author: 'system',
                    text: 'Reviewed copy ready from Scribe (approved by ' + update.agentId + '). Echo can now create the social post using this copy.',
                    type: 'system',
                    createdAt: new Date().toISOString()
                  });
                  _parentSocialTask._social_action_pending = true;
                  console.log('[Heartbeat] COPY PROPAGATED: reviewed_copy set on parent task:', _parentSocialTaskId, '(' + _copyText.length + ' chars), _social_action_pending=true');
                }
              }
            }
          } else if (_hasDeliverable) {
            // ── HERO IMAGE AUTO-COMPLETE: hero tasks skip CEO approval — publish_document is the gate ──
            const _isHeroTask = _tags.indexOf('hero-image') !== -1;
            if (_isHeroTask) {
              tasks[i].status = 'done';
              tasks[i].completedAt = new Date().toISOString();
              tasks[i].comments.push({
                id: 'cmt-heroclose-' + Date.now(),
                author: 'system',
                text: 'Hero image task auto-completed after peer review approval. The publish_document action is the CEO gate for the final article + image.',
                type: 'system',
                createdAt: new Date().toISOString()
              });
              console.log('[Heartbeat] HERO AUTO-COMPLETE: task', tasks[i].id, 'auto-completed — publish_document is the CEO gate');
              // Notify parent blog task that hero image is ready for submit-for-publish
              if (tasks[i].parent_task_id) {
                const _parentBlogTask = tasks.find(t => t.id === tasks[i].parent_task_id);
                if (_parentBlogTask) {
                  if (!_parentBlogTask.comments) _parentBlogTask.comments = [];
                  _parentBlogTask.comments.push({
                    id: 'cmt-heroready-' + Date.now(),
                    author: 'system',
                    text: 'Hero image approved and attached. Document is ready for submit-for-publish. Scribe, use submit-for-publish to send the article + hero image for CEO approval.',
                    type: 'system',
                    createdAt: new Date().toISOString()
                  });
                  _parentBlogTask.updatedAt = new Date().toISOString();
                }
              }
            } else {
            // ── SOCIAL TASK AUTO-COMPLETE: social tasks skip CEO approval on the task —
            // the create-social-action itself goes through CEO approval (that's the real gate) ──
            const _socialText = ((tasks[i].title || '') + ' ' + (tasks[i].description || '')).toLowerCase();
            const _isSocialTask = /^social_/.test(tasks[i].taskType || '') ||
              (tasks[i].campaign_id && /linkedin|twitter|x\.com|social\s*media|social\s*post|bluesky|tweet/.test(_socialText));
            if (_isSocialTask) {
              // Social tasks auto-complete to done after peer review.
              // Do NOT set reviewed_copy from Echo's deliverable — Echo writes strategy briefs, not copy.
              // The copy review gate (in agent-runner.js) will trigger Scribe to write actual copy
              // and Quill to review it. reviewed_copy is set from Scribe's approved copy.
              tasks[i].status = 'done';
              tasks[i].completedAt = new Date().toISOString();
              if (!tasks[i].comments) tasks[i].comments = [];
              tasks[i].comments.push({
                id: 'cmt-socialauto-' + Date.now(),
                author: 'system',
                text: 'Social task peer-reviewed and auto-completed. Echo will now attempt to post — if no reviewed_copy exists, the Scribe copy pipeline activates (Scribe writes copy → Quill reviews → reviewed_copy set).',
                type: 'system',
                createdAt: new Date().toISOString()
              });
              console.log('[Heartbeat] SOCIAL AUTO-COMPLETE: task', tasks[i].id, 'auto-completed — Scribe copy pipeline will activate if no reviewed_copy');
            } else {
            // Non-hero, non-social deliverable tasks stay in review — CEO must approve before done
            tasks[i].status = 'review';
            if (!update._ceoApprovalAction) {
              update._ceoApprovalAction = {
                taskId: tasks[i].id,
                taskTitle: tasks[i].title,
                assignee: tasks[i].assignee,
                reviewerId: update.agentId,
                reviewFeedback: update.review.feedback,
                deliverable: (tasks[i].comments || []).filter(c => c.type === 'deliverable').map(c => c.text).join('\n').substring(0, 2000)
              };
            }
            }
            }
          } else {
            // No deliverable — auto-complete (simple status transitions, etc.)
            tasks[i].status = 'done';
            tasks[i].completedAt = new Date().toISOString();
          }
        } else {
          // Request changes — back to in-progress
          tasks[i].status = 'in-progress';
          tasks[i].completedAt = null;
          // Clear awaiting_copy_review on parent if this is a social-copy rejection
          const _rejTags = tasks[i].tags || [];
          if (_rejTags.indexOf('social-copy') !== -1) {
            const _rejParentTag = _rejTags.find(t => t.startsWith('social-copy-for-'));
            const _rejParentId = _rejParentTag ? _rejParentTag.replace('social-copy-for-', '') : null;
            if (_rejParentId) {
              const _rejParent = tasks.find(t => t.id === _rejParentId);
              if (_rejParent) {
                _rejParent.awaiting_copy_review = false;
                _rejParent.updatedAt = new Date().toISOString();
              }
            }
          }
        }
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }

  if (update.action === 'set-research-intel') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        tasks[i].research_intel = update.research_intel;
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }

  if (update.action === 'comment') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        if (!tasks[i].comments) tasks[i].comments = [];
        // Support rich comment objects (from tool-call deliverables) or plain strings
        if (update.comment && typeof update.comment === 'object') {
          tasks[i].comments.push({
            id: 'cmt-' + Date.now(),
            author: update.comment.author || update.agentId || 'unknown',
            text: update.comment.text || '',
            type: update.comment.type || 'comment',
            sources: update.comment.sources || undefined,
            createdAt: update.comment.timestamp || new Date().toISOString()
          });
        } else {
          tasks[i].comments.push({
            id: 'cmt-' + Date.now(),
            author: update.agentId || 'unknown',
            text: update.comment || '',
            type: 'comment',
            createdAt: new Date().toISOString()
          });
        }
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }

  if (update.action === 'update' || update.action === 'move') {
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].id === update.taskId) {
        if (update.updates) {
          // CEO task protection: agents cannot rewrite title/description of CEO-created tasks
          // Assignee is always protected — agents cannot reassign tasks
          const isCeoTask = tasks[i].source !== 'heartbeat';
          const PROTECTED_FIELDS = ['title', 'description'];
          // Only Nova can assign unassigned tasks; no agent can reassign an already-assigned task
          const ALWAYS_PROTECTED = [];
          const isAssigneeUpdate = update.updates && update.updates.assignee;
          const isUnassigned = !tasks[i].assignee;
          const isNova = _creatingAgentId === 'nova';
          if (isAssigneeUpdate && !(isNova && isUnassigned)) {
            ALWAYS_PROTECTED.push('assignee');
          }
          Object.keys(update.updates).forEach(k => {
            if (k !== 'id' && k !== 'createdAt' && k !== 'comments') {
              if (ALWAYS_PROTECTED.indexOf(k) !== -1) return; // skip — assignee cannot be changed by agents
              if (isCeoTask && PROTECTED_FIELDS.indexOf(k) !== -1) return; // skip — CEO intent is immutable
              if (k === 'status' && VALID_TASK_STATUSES.indexOf(update.updates[k]) === -1) {
                console.log('[applyTaskUpdate] BLOCKED invalid status in updates:', update.updates[k], 'for task:', tasks[i].id);
                return; // skip invalid status
              }
              tasks[i][k] = update.updates[k];
            }
          });
        }
        if (update.newStatus) {
          if (VALID_TASK_STATUSES.indexOf(update.newStatus) === -1) {
            console.log('[applyTaskUpdate] BLOCKED invalid status:', update.newStatus, 'for task:', tasks[i].id);
            tasks[i].updatedAt = new Date().toISOString();
            return tasks[i];
          }
          const oldStatus = tasks[i].status;
          tasks[i].status = update.newStatus;
          if (update.newStatus === 'done' && oldStatus !== 'done') {
            tasks[i].completedAt = new Date().toISOString();
          } else if (update.newStatus !== 'done') {
            tasks[i].completedAt = null;
          }
        }
        tasks[i].updatedAt = new Date().toISOString();
        return tasks[i];
      }
    }
  }
  return null;
}
module.exports = { applyTaskUpdate };
