// routing.js — who does what NOW. Work is assigned by ROLE, resolved against the agents that actually run.
//
// Why (2026-10-16): Pixel and Cipher went dormant on 10-06 but work kept being routed to them by name. Blog hero
// images were created for Pixel, drafts waited forever for a hero image, the 5-draft cap filled, and Scribe's
// whole blog pipeline jammed for a week with nothing surfacing it. Every place that assigns work by role goes
// through here, so a dormant agent's role falls through to the next agent that can do it.
//
// "Running" = in AGENT_IDS, which constants._applyRegistry() narrows to the registry's ACTIVE agents at heartbeat
// start (outside the heartbeat, pass `running` from loadRunning()). NON_AGENT_ASSIGNEES ('studio') take tasks
// without running.
'use strict';

const C = require('./constants');

// Role → agents that can do it, in order of preference. Design falls back to Echo, then Scribe: both may
// generate-image (agent-runner IMG_ALLOWED_AGENTS).
const ROLES = {
  orchestration: ['nova'],
  content: ['scribe', 'nova'],
  editing: ['quill', 'scribe'],
  social: ['echo', 'nova'],
  design: ['pixel', 'echo', 'scribe'],
  research: ['scout', 'nova'],
  ops: ['forge', 'nova'],
  finance: ['cipher', 'nova'],
  video: ['studio'],
};

const TASK_TYPE_ROLE = {
  general: 'orchestration',
  blog_post: 'content', article: 'content', newsletter: 'content', internal_doc: 'content', bluesky_reply: 'content', social_copy: 'content',
  editorial: 'editing',
  social_x: 'social', social_linkedin: 'social', social_bluesky: 'social', social_facebook: 'social', social_instagram: 'social', social_reddit: 'social', social_post: 'social',
  design_asset: 'design',
  research: 'research', bluesky_discovery: 'research',
  ops: 'ops', bug_fix: 'ops', intake: 'ops', support: 'ops',
  finance: 'finance', financial: 'finance',
  video_request: 'video',
};

// The agent each id stands in for when its owner doesn't run (an agent assigned work by NAME).
const AGENT_ROLE = { nova: 'orchestration', scribe: 'content', quill: 'editing', echo: 'social', pixel: 'design', scout: 'research', forge: 'ops', cipher: 'finance', studio: 'video' };

const runningNow = () => C.AGENT_IDS.slice();

// People, not agents: their tasks are never routed anywhere.
const HUMANS = ['ceo', 'chad', 'pixelpusher'];
const isHuman = (assignee) => HUMANS.indexOf(String(assignee || '').toLowerCase()) !== -1;

function isRunnable(assignee, running) {
  const r = running || runningNow();
  const a = String(assignee || '').toLowerCase();
  return r.indexOf(a) !== -1 || (C.NON_AGENT_ASSIGNEES || []).indexOf(a) !== -1;
}

// The first agent in a role that can take work now, or null (nobody — a routing gap).
function resolveRole(role, running) {
  const list = ROLES[role] || [];
  for (const a of list) if (isRunnable(a, running)) return a;
  return null;
}

function roleForTask(task) {
  const tt = String((task && task.taskType) || '').toLowerCase();
  if (TASK_TYPE_ROLE[tt]) return TASK_TYPE_ROLE[tt];
  const a = String((task && task.assignee) || '').toLowerCase();
  return AGENT_ROLE[a] || 'orchestration';
}

// Who should own this task: its assignee if they run, else whoever holds the task's role now. null = nobody.
function routeTask(task, running) {
  if (task && task.assignee && isRunnable(task.assignee, running)) return String(task.assignee).toLowerCase();
  return resolveRole(roleForTask(task), running);
}

const routeTaskType = (taskType, running) => resolveRole(TASK_TYPE_ROLE[String(taskType || '').toLowerCase()] || 'orchestration', running);

// "WHO DOES WHAT NOW", for Nova's delegation: generated from the live roster, never hardcoded.
function whoDoesWhat(running) {
  const label = { content: 'Content/blog', editing: 'Copy editing', social: 'Social posts', design: 'Design & images', research: 'Research', ops: 'Infrastructure/ops', finance: 'Budget/cost', video: 'Video' };
  return Object.keys(label).map((role) => {
    const who = resolveRole(role, running);
    const first = ROLES[role][0];
    const note = who && who !== first ? ' (' + first + ' is not running)' : '';
    return label[role] + ' → ' + (who || 'NOBODY (routing gap: tell the CEO)') + note;
  }).join(' · ');
}

// Load the running roster outside the heartbeat (e.g. an HTTP function): the registry's active agents.
async function loadRunning(storage) {
  try {
    const reg = await storage.getState('agentRegistry');
    if (reg && Array.isArray(reg.agents)) return reg.agents.filter((a) => a && a.status === 'active').map((a) => a.id);
  } catch (_) { /* fall through */ }
  return runningNow();
}

// ── Capacity-based due dates ──────────────────────────────────────────────
// A due date says when the assignee can realistically get to the task: its open queue divided by what it has
// actually finished per day over the last 7 days (floor 0.5/day), never earlier than the date asked for.
const DAY = 86400000;
function capacityDueDate(tasks, assignee, requestedIso, nowMs) {
  const now = nowMs || Date.now();
  const a = String(assignee || '').toLowerCase();
  const all = Array.isArray(tasks) ? tasks : [];
  const open = all.filter((t) => t && !t._archived && String(t.assignee || '').toLowerCase() === a &&
    ['done', 'canceled', 'cancelled', 'archived'].indexOf(String(t.status || '').toLowerCase()) === -1).length;
  const doneWeek = all.filter((t) => t && String(t.assignee || '').toLowerCase() === a && t.status === 'done' &&
    now - Date.parse(t.completedAt || t.updatedAt || 0) <= 7 * DAY).length;
  const perDay = Math.max(0.5, doneWeek / 7);
  const days = Math.min(30, Math.ceil((open + 1) / perDay));
  const capacity = now + days * DAY;
  const asked = Date.parse(requestedIso || '');
  return new Date(Number.isFinite(asked) ? Math.max(asked, capacity) : capacity).toISOString();
}

module.exports = { HUMANS, isHuman, ROLES, TASK_TYPE_ROLE, AGENT_ROLE, isRunnable, resolveRole, roleForTask, routeTask, routeTaskType, whoDoesWhat, loadRunning, capacityDueDate };
