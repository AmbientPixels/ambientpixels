// engagementReplyDraft — draft a reply to ONE harvested comment, on demand.
// POST /api/engagement-reply-draft { id }
//
// WHY THIS EXISTS
//
// companyHeartbeat/engagement-reply.js already drafts replies automatically: it
// harvests comments on our Bluesky posts, filters them, and creates a Scribe
// `bluesky_reply` task that rides the normal chain (drafter → quality gate →
// CEO approval → executor). That works.
//
// What it cannot do is come back later. A comment older than maxAgeHours (72 by
// default) is dropped permanently, so `status: 'new'` is not a queue — it is the
// terminal state for anything the automation passed on. The Engagement Inbox was
// labelling those rows "needs a reply", which was true for the human and false
// about the machine: nothing was ever going to pick them up.
//
// This is the human override. The CEO looks at a conversation the bot let go and
// says draft it anyway.
//
// WHAT IT OVERRIDES. The AGE gate, and the per-thread reply limit from 1 to 2 —
// a real conversation has a second turn, and the automation deliberately does
// not take one. Everything else still blocks, and says so:
//   - a THIRD reply to the same person in the same thread
//   - 14-day per-author cooldown across all threads
//   - minimum text length (nothing to answer)
//   - the daily draft budget
// Those exist so an agent cannot pester a stranger, and a button is not a good
// reason to lose them. Whichever fires is named in the response so the answer is
// never a silent no.
//
// Rules are not reimplemented here. filterCandidates() from engagement-reply.js
// is called with an overridden config, against a store containing only this
// candidate — same engine, no second copy to drift.

const storage = require('../_utils/companyStorage');
const engagement = require('../companyHeartbeat/engagement-reply');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal, X-AmbientOS-Key',
  'Content-Type': 'application/json'
};

// THE override, in one place. engagementInbox imports this to decide whether to
// show the button, and if the two ever disagree the button appears exactly where
// it will refuse — so there is one definition, not two.
//
// maxAgeHours: NOT Infinity. filterCandidates guards its config with
// Number.isFinite(), and Number.isFinite(Infinity) is false, so passing Infinity
// silently restores the 72h DEFAULT and the override quietly does nothing.
// ~114 years, finite, and nothing in this store outlives it.
//
// maxRepliesPerThread 2 against a default of 1: the automation says its piece
// once and stops, which is what keeps an agent from monologuing at a stranger.
// A real conversation has a second turn, so a human can buy exactly one — and
// no more. Everything else (per-author cooldown, minimum length, daily budget)
// is inherited from the live config untouched.
const OVERRIDE_CONFIG = {
  maxAgeHours: 1e6,
  maxRepliesPerThread: 2
};

// Human sentences for each rule filterCandidates can drop on. too_old is absent
// on purpose: this endpoint exists precisely to ignore it.
const DROP_REASONS = {
  too_short: 'There is nothing substantive to answer — the comment is too short.',
  author_thread_done: 'We have already replied to this person twice in this thread. Two exchanges is the limit.',
  author_cooldown: 'We replied to this person within the last 14 days. The cooldown is what stops us pestering someone.',
  daily_budget: 'The daily reply-draft budget is already spent. Try again tomorrow.'
};

function badRequest(context, status, body) {
  context.res = { status: status, headers: CORS, body: body };
}

// Exported so engagementInbox decides "can this be drafted?" with the EXACT
// config this endpoint will use, rather than a second copy of it.
module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS, body: '' };
    return;
  }
  if (req.method !== 'POST') {
    return badRequest(context, 405, { error: 'Method not allowed' });
  }

  if (process.env.DEMO_MODE !== 'true') {
    const secret = (req.headers && req.headers['x-company-secret']) || '';
    const principal = (req.headers && req.headers['x-ms-client-principal']) || '';
    if (!storage.validateSecret(secret) && !principal) {
      return badRequest(context, 403, { error: 'Unauthorized' });
    }
  }

  try {
    const id = String((req.body && req.body.id) || '').trim();
    if (!id) return badRequest(context, 400, { error: 'Missing id' });

    // The kill switch has to mean stop, including for a button. Every other mode
    // is allowed: this is the CEO acting, not an agent acting on its own.
    const execMode = String((await storage.getState('execution_mode')) || 'active').trim().toLowerCase();
    if (execMode === 'frozen') {
      return badRequest(context, 409, {
        error: 'Execution mode is frozen',
        message: 'The fleet kill switch is on. Nothing drafts until execution_mode leaves frozen.'
      });
    }

    const systemConfig = (await storage.getState('systemConfig')) || {};
    const cfg = engagement.loadConfig(systemConfig);
    if (cfg.enabled === false) {
      return badRequest(context, 409, {
        error: 'Engagement replies disabled',
        message: 'systemConfig.engagementReply.enabled is false.'
      });
    }

    const store = (await storage.getState('engagementReplies')) || [];
    if (!Array.isArray(store)) return badRequest(context, 500, { error: 'Reply store is not an array' });

    const entry = store.find((e) => e && e.id === id);
    if (!entry) return badRequest(context, 404, { error: 'No such reply', id: id });

    const tasksNow = (await storage.getState('tasks')) || [];
    const actionsNow = (await storage.getState('actions')) || [];
    const taskById = {};
    (Array.isArray(tasksNow) ? tasksNow : []).forEach((t) => { if (t && t.id) taskById[t.id] = t; });
    const replyByTask = {};
    (Array.isArray(actionsNow) ? actionsNow : []).forEach((a) => {
      if (a && a.type === 'social_post.reply' && a._parentTaskId) replyByTask[a._parentTaskId] = a;
    });

    // Already answered is final — never re-open a conversation we finished.
    if (entry.status === 'answered') {
      return badRequest(context, 200, {
        ok: false, already: true, status: 'answered', taskId: entry.taskId || null,
        message: 'This conversation has already been answered.'
      });
    }

    // A live draft is a real one: idempotent for the impatient second click, and
    // for a row the cron drafted a second before the click landed.
    if (entry.status === 'task_created') {
      const action = replyByTask[entry.taskId];
      const task = taskById[entry.taskId];
      const taskDead = !task || ['canceled', 'cancelled', 'archived', 'done']
        .indexOf(String((task && task.status) || '').toLowerCase()) !== -1;
      if (action || !taskDead) {
        return badRequest(context, 200, {
          ok: true, already: true, status: 'task_created', taskId: entry.taskId || null,
          message: action
            ? 'A draft already exists and is waiting on your approval.'
            : 'Scribe is already drafting this one.'
        });
      }
      // Otherwise the task is dead and produced nothing, so this conversation is
      // unanswered no matter what the entry says. Fall through and re-draft.
      // Three live rows sat in exactly this state after a bulk cancel on
      // 2026-08-08, reported as "waiting on your approval" and unreachable.
      context.log('[engagementReplyDraft] re-drafting ' + id + ' — prior task ' + entry.taskId + ' is dead');
    }

    const nowMs = Date.now();

    // Same rule engine as the cron, config overridden. The subset is every OTHER
    // settled entry — the history that per-author cooldown, the per-thread limit
    // and today's budget are computed from — plus this one candidate, presented
    // as 'new' because filterCandidates only ever considers that status. Coercing
    // it also removes the target from its own history, which matters when
    // re-drafting a dead 'task_created': otherwise it would count as a reply we
    // never actually sent and spend the allowance it is asking for.
    const subset = store
      .filter((e) => e && e.id !== id && e.status !== 'new')
      .concat([Object.assign({}, entry, { status: 'new' })]);
    const verdict = engagement.filterCandidates(
      subset,
      Object.assign({}, cfg, OVERRIDE_CONFIG),
      nowMs
    );

    if (!verdict.survivors.some((s) => s && s.id === id)) {
      const fired = Object.keys(verdict.drops).filter((k) => verdict.drops[k] > 0);
      const reason = fired[0] || 'unknown';
      return badRequest(context, 409, {
        error: 'Blocked',
        reason: reason,
        message: DROP_REASONS[reason] || 'A guard blocked this draft.',
        // The guards this endpoint deliberately keeps, so a "no" is never mute.
        drops: verdict.drops
      });
    }

    const scanCmt = engagement.asksProductQuestion(entry.text)
      ? engagement.findScanComment(entry, actionsNow, tasksNow)
      : null;
    const task = engagement.buildEngagementReplyTask(entry, scanCmt, nowMs);
    task.tags = (task.tags || []).concat(['manual-draft']);

    // Surgical append. The cron still saves the whole tasks array, and its own
    // reconcile() documents tasks vanishing under exactly that race — no reason
    // to add another wholesale writer to the same blob.
    await storage.mutateState('tasks', (current) => {
      const next = Array.isArray(current) ? current.slice() : [];
      if (next.some((t) => t && t.id === task.id)) return undefined; // already there
      next.push(task);
      return next;
    });

    // Flip the entry by id inside the mutator, off FRESH state — the cron writes
    // this same blob and holds it across network calls.
    let flipped = false;
    await storage.mutateState('engagementReplies', (current) => {
      const next = Array.isArray(current) ? current.slice() : [];
      const idx = next.findIndex((e) => e && e.id === id);
      if (idx === -1) return undefined;
      // Only refuse if the cron won the race on a genuinely NEW row. A dead
      // 'task_created' is what we are deliberately replacing.
      if (next[idx].status !== 'new' && next[idx].taskId !== entry.taskId) return undefined;
      next[idx] = Object.assign({}, next[idx], {
        status: 'task_created',
        taskId: task.id,
        taskCreatedAt: new Date(nowMs).toISOString(),
        // Audit: this one skipped the age gate because a human said so.
        manualDraft: true,
        manualDraftReason: 'ceo_override_age_gate'
      });
      flipped = true;
      return next;
    });

    if (!flipped) {
      // The task exists but the entry did not flip, so the inbox would offer the
      // button again and a second task would follow. Say so loudly rather than
      // reporting a clean success.
      context.log.error('[engagementReplyDraft] task ' + task.id + ' created but entry ' + id + ' did not flip');
      return badRequest(context, 409, {
        error: 'Race',
        taskId: task.id,
        message: 'A draft task was created but the conversation had already moved on. Check the task board before drafting again.'
      });
    }

    try {
      const gl = (await storage.getState('governanceLog')) || [];
      gl.push({
        id: 'gov_' + nowMs + '_engdraft',
        type: 'engagement-reply-drafted',
        actor: 'ceo',
        summary: 'Manual engagement reply drafted for @' + entry.author + ' (age gate overridden)',
        data: {
          taskId: task.id,
          author: entry.author,
          replyUri: entry.replyUri,
          groundedWithScan: !!scanCmt,
          manual: true,
          ageHours: Math.round((nowMs - Date.parse(entry.indexedAt || entry.discoveredAt || nowMs)) / 3600000)
        },
        createdAt: new Date(nowMs).toISOString()
      });
      await storage.setState('governanceLog', gl.slice(-500));
    } catch (glErr) {
      context.log.warn('[engagementReplyDraft] governance log failed (non-fatal):', glErr.message);
    }

    context.res = {
      status: 200,
      headers: CORS,
      body: {
        ok: true,
        taskId: task.id,
        assignee: 'scribe',
        groundedWithScan: !!scanCmt,
        executionMode: execMode,
        message: execMode === 'active'
          ? 'Scribe will draft it on the next heartbeat. It reaches you on the Actions page for approval before anything posts.'
          : 'Task created, but execution_mode is "' + execMode + '" so agents are not acting on tasks right now.'
      }
    };
  } catch (err) {
    context.log.error('[engagementReplyDraft] error:', (err && err.message) || err);
    badRequest(context, 500, { error: 'Draft failed', details: (err && err.message) || String(err) });
  }
};

module.exports.OVERRIDE_CONFIG = OVERRIDE_CONFIG;
