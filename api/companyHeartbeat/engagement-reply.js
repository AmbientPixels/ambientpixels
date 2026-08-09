// engagement-reply.js — Engagement Reply Loop (2026-07-28)
//
// Inbound conversation continuation: people reply to OUR Bluesky posts
// (including prospect outreach replies) and this module turns those comments
// into CEO-gated bluesky_reply draft tasks for Scribe, riding the exact rails
// the prospect pipeline hardened (drafter → composeQualityVerdict → approval
// queue REPLY panel → social_post.reply executor).
//
// Pure cores + IO shell, house pattern (prospect-pipeline.js / rewards-engine.js).
// Called by api/outcomeRefresh (daily cron) after the snapshot refresh loop.
// Plan: docs/superpowers/plans/2026-07-28-engagement-reply-loop.md
//
// Store: `engagementReplies` — companyStorage-direct key (NOT a company-state
// VALID_KEY, same class as pingLog/governanceLogArchive). Array, cap 500 FIFO.
// Entry: { id, replyUri, replyCid, rootUri, rootCid, author, authorDid,
//   text, ourPostActionId, ourPostAtUri, ourPostText, indexedAt, discoveredAt,
//   status: 'new'|'task_created'|'answered'|'skipped', taskId, taskCreatedAt,
//   answeredAt, actionId, skipReason }

'use strict';

var DEFAULTS = {
  enabled: true,
  maxPerDay: 3,             // drafts per UTC day
  maxAgeHours: 72,          // ignore replies older than this
  // How many times WE may reply to one person inside one thread. 1 keeps the
  // automation exactly where it has always been: it says its piece once and
  // then stops, which is what stops an agent monologuing at a stranger it cold
  // approached. The manual draft button raises this to 2 (see
  // api/engagementReplyDraft), so a real back-and-forth is possible but a human
  // decides to have it. Was a hard-coded boolean before 2026-08-09.
  maxRepliesPerThread: 1,
  perAuthorCooldownDays: 14,// one touch per author across ALL threads inside this window
  minTextLength: 15,        // chars after emoji/whitespace strip (no bare "nice"/emoji)
  maxThreadFetchesPerRun: 25,
  storeCap: 500
};

// systemConfig.engagementReply overrides per-key (MERGE semantics — same
// contract as systemConfig.asProspecting in prospect-pipeline._loadConfig).
function loadConfig(systemConfig) {
  var cfg = Object.assign({}, DEFAULTS);
  var over = (systemConfig && systemConfig.engagementReply) || {};
  Object.keys(over).forEach(function (k) { cfg[k] = over[k]; });
  return cfg;
}

// outcomeSnapshots map → snapshots worth a thread look: bluesky, has an
// at:// URI, and ANY captured sample saw comments > 0. (Snapshots cover both
// our original posts and our posted replies — verified fact #2 in the plan.)
function eligibleSnapshots(snapshots) {
  var out = [];
  Object.keys(snapshots || {}).forEach(function (k) {
    var s = snapshots[k];
    if (!s || String(s.platform || '').toLowerCase() !== 'bluesky') return;
    if (!s.atUri) return;
    var maxComments = 0;
    (s.samples || []).forEach(function (smp) {
      if (smp && Number.isFinite(Number(smp.comments))) {
        maxComments = Math.max(maxComments, Number(smp.comments));
      }
    });
    if (maxComments <= 0) return;
    out.push({ actionId: s.actionId || k, atUri: s.atUri, snapshot: s });
  });
  return out;
}

// getPostThread depth=1 thread → candidate entries. The thread's own post
// author IS us (snapshots only cover our posts), so self-exclusion is a
// per-thread DID comparison — no env/config identity needed.
// Root resolution: a reply's record.reply.root carries the TRUE thread root
// (for comments on our prospect replies that's the PROSPECT's original post,
// not ours). Executor payload root must be the true root or bsky.app renders
// the reply detached instead of nested under their comment.
function harvestFromThread(snapshot, thread, nowMs) {
  var out = { candidates: [], selfExcluded: 0, malformed: 0 };
  if (!thread || !thread.post || !thread.post.author) return out;
  var ourDid = thread.post.author.did || '';
  var ourUri = thread.post.uri || snapshot.atUri;
  var ourCid = thread.post.cid || '';
  var ourText = String((thread.post.record && thread.post.record.text) || '').substring(0, 300);

  (Array.isArray(thread.replies) ? thread.replies : []).forEach(function (node) {
    var p = node && node.post;
    if (!p || !p.uri || !p.cid || !p.author || !p.author.did || !p.author.handle) {
      out.malformed++;
      return;
    }
    if (p.author.did === ourDid) { out.selfExcluded++; return; }
    var rec = p.record || {};
    var root = (rec.reply && rec.reply.root && rec.reply.root.uri && rec.reply.root.cid)
      ? rec.reply.root
      : { uri: ourUri, cid: ourCid };
    out.candidates.push({
      replyUri: p.uri,
      replyCid: p.cid,
      rootUri: root.uri,
      rootCid: root.cid,
      author: p.author.handle,
      authorDid: p.author.did,
      text: String(rec.text || '').substring(0, 500),
      indexedAt: p.indexedAt || new Date(nowMs).toISOString(),
      ourPostActionId: snapshot.actionId,
      ourPostAtUri: snapshot.atUri,
      ourPostText: ourText
    });
  });
  return out;
}

// Append candidates the store has never seen (dedup on replyUri, ANY status),
// then enforce the FIFO cap. Mutates store in place (house pattern).
function mergeCandidates(store, candidates, nowMs) {
  var seen = {};
  store.forEach(function (e) { if (e && e.replyUri) seen[e.replyUri] = true; });
  var added = 0;
  (candidates || []).forEach(function (c) {
    if (!c || !c.replyUri || seen[c.replyUri]) return;
    seen[c.replyUri] = true;
    store.push(Object.assign({
      id: 'er_' + nowMs + '_' + Math.random().toString(36).substring(2, 7),
      discoveredAt: new Date(nowMs).toISOString(),
      status: 'new',
      taskId: null,
      taskCreatedAt: null,
      answeredAt: null,
      actionId: null,
      skipReason: null
    }, c));
    added++;
  });
  var cap = DEFAULTS.storeCap;
  if (store.length > cap) store.splice(0, store.length - cap);
  return { added: added };
}

var _EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

function _strippedLength(text) {
  return String(text || '').replace(_EMOJI_RE, '').replace(/\s+/g, ' ').trim().length;
}

function _dayKey(iso) { return String(iso || '').substring(0, 10); }

// 'new' entries → survivors after ALL locked rules, with per-rule drop counts
// (observability — no silent caps). Selections feed the author sets so two
// comments by the same person in one run can't both pass. Oldest reply first
// (fairness: longest-waiting conversation gets the slot).
// Platforms this loop can actually ANSWER. Harvesting and replying are separate
// capabilities and the store now holds both kinds: socialEngagementPull writes
// Facebook comments into the same `engagementReplies` blob so the inbox can show
// them, but buildEngagementReplyTask below hardcodes taskType 'bluesky_reply' and
// puts entry.replyUri into threadContext.uri, where the executor expects an
// at:// URI. A Facebook comment id reaching that path would draft a Bluesky reply
// aimed at an id Bluesky has never heard of.
//
// The guard lives HERE rather than in the cron because all three drafting paths
// funnel through filterCandidates — the automatic loop, the inbox's can_draft
// annotation, and the CEO's manual draft button. One definition, so the button
// cannot appear exactly where it will refuse.
//
// Facebook replies are deliberately human-only anyway (no fabrication guard on
// the reply lane), so this is not a temporary gap: replyToComment stays unwired.
var REPLYABLE_PLATFORMS = ['bluesky'];

function filterCandidates(store, cfg, nowMs) {
  // unsupported_platform is FIRST on purpose. Callers report the first drop with
  // a non-zero count as THE reason, and for a Facebook row every later guard is
  // beside the point — "aged out" would be a confident wrong answer about a
  // conversation that was never drafted for an entirely different reason.
  var drops = { unsupported_platform: 0, too_old: 0, too_short: 0, author_thread_done: 0, author_cooldown: 0, daily_budget: 0 };
  var maxAgeMs = (Number.isFinite(cfg.maxAgeHours) ? cfg.maxAgeHours : 72) * 3600e3;
  var minLen = Number.isFinite(cfg.minTextLength) ? cfg.minTextLength : 15;
  var cooldownMs = (Number.isFinite(cfg.perAuthorCooldownDays) ? cfg.perAuthorCooldownDays : 14) * 86400e3;
  var maxPerDay = Number.isFinite(cfg.maxPerDay) ? cfg.maxPerDay : 3;
  // Non-finite falls back to the default rather than "no limit" — the same trap
  // that made an Infinity age gate silently restore 72h.
  var maxPerThread = Number.isFinite(cfg.maxRepliesPerThread) ? cfg.maxRepliesPerThread : 1;

  // Author history from entries that represent a draft or a shipped reply.
  // 'skipped' does NOT block: a CEO decline must not silence a person forever.
  var threadCount = {};  // authorKey + '|' + rootUri → how many times WE replied
  // authorKey → [{ts, hk}]. Per-touch, not a single max, because the cooldown is
  // about approaching someone AGAIN — and answering inside a thread they are
  // already talking in is not a new approach, it is the same conversation. A
  // flat per-author max made the two rules redundant and the cooldown always
  // won: a second exchange was unreachable at any per-thread limit.
  //
  // Inert for the automation, which allows one reply per thread — the per-thread
  // gate below fires first in exactly the cases this distinction would matter.
  // It only takes effect when maxRepliesPerThread > 1, i.e. the manual override.
  var touches = {};
  var today = _dayKey(new Date(nowMs).toISOString());
  var createdToday = 0;
  store.forEach(function (e) {
    if (!e || (e.status !== 'task_created' && e.status !== 'answered')) return;
    var a = String(e.author || '').toLowerCase();
    var hk = a + '|' + (e.rootUri || '');
    threadCount[hk] = (threadCount[hk] || 0) + 1;
    var t = Date.parse(e.answeredAt || e.taskCreatedAt || e.discoveredAt || 0);
    if (Number.isFinite(t)) (touches[a] = touches[a] || []).push({ ts: t, hk: hk });
    if (e.taskCreatedAt && _dayKey(e.taskCreatedAt) === today) createdToday++;
  });
  var budget = Math.max(0, maxPerDay - createdToday);

  var fresh = store.filter(function (e) { return e && e.status === 'new'; });
  fresh.sort(function (x, y) {
    return (Date.parse(x.indexedAt || x.discoveredAt || 0) || 0) - (Date.parse(y.indexedAt || y.discoveredAt || 0) || 0);
  });

  var survivors = [];
  fresh.forEach(function (e) {
    // Absent platform means Bluesky: every entry written before 2026-08-09 predates
    // the field, and defaulting those to 'unknown' would silence the whole backlog.
    if (REPLYABLE_PLATFORMS.indexOf(e.platform || 'bluesky') === -1) { drops.unsupported_platform++; return; }
    var age = nowMs - Date.parse(e.indexedAt || e.discoveredAt || 0);
    if (!Number.isFinite(age) || age > maxAgeMs) { drops.too_old++; return; }
    if (_strippedLength(e.text) < minLen) { drops.too_short++; return; }
    var a = String(e.author || '').toLowerCase();
    var hk = a + '|' + (e.rootUri || '');
    if ((threadCount[hk] || 0) >= maxPerThread) { drops.author_thread_done++; return; }
    // Most recent touch of this author in some OTHER thread. Touches inside this
    // one are the conversation itself and are governed by maxRepliesPerThread.
    var lastOther = 0;
    var prior = touches[a] || [];
    for (var pi = 0; pi < prior.length; pi++) {
      if (prior[pi].hk === hk) continue;
      if (prior[pi].ts > lastOther) lastOther = prior[pi].ts;
    }
    if (lastOther && nowMs - lastOther < cooldownMs) { drops.author_cooldown++; return; }
    if (budget <= 0) { drops.daily_budget++; return; }
    budget--;
    threadCount[hk] = (threadCount[hk] || 0) + 1;
    // Registering the selection keeps two comments by the same person in
    // different threads from both passing in one run.
    (touches[a] = touches[a] || []).push({ ts: nowMs, hk: hk });
    survivors.push(e);
  });
  return { survivors: survivors, drops: drops };
}

// "They explicitly asked a product/report question" — the deterministic gate
// for copying the [SCAN RESULT] comment onto the task. Two-factor: a question
// mark (any script) AND a report-topic word (EN + ES — the live Spanish case).
// Deliberately strict: a false negative just means an ungrounded-but-safe
// generic answer; a false positive would let repairReplyLink FORCE a report
// link into a casual reply (breaking the no-pitch rule).
var _QUESTION_RE = /[?¿？]/;
var _TOPIC_RE = /(report|score|audit|scan|headline|title|rewrite|rework|example|suggest|improv|convert|conversion|landing|homepage|website|copy|cta|button|informe|puntuaci|auditor|titular|reescrit|ejemplo|sugerenc|mejor|convers|p[aá]gina|sitio|web)/i;

function asksProductQuestion(text) {
  var t = String(text || '');
  return _QUESTION_RE.test(t) && _TOPIC_RE.test(t);
}

// entry.ourPostActionId → reply action → its parent prospect task → the
// [SCAN RESULT] comment. Null when any link is missing (CEO-curated posts,
// archived parents) — callers treat null as "no grounding available".
function findScanComment(entry, actions, tasks) {
  if (!entry || !entry.ourPostActionId) return null;
  var action = (Array.isArray(actions) ? actions : []).find(function (a) {
    return a && a.id === entry.ourPostActionId;
  });
  var parentTaskId = action && action._parentTaskId;
  if (!parentTaskId) return null;
  var task = (Array.isArray(tasks) ? tasks : []).find(function (t) {
    return t && t.id === parentTaskId;
  });
  if (!task) return null;
  var cmt = (task.comments || []).find(function (c) {
    return c && String(c.text || '').indexOf('[SCAN RESULT]') === 0;
  });
  return (cmt && cmt.text) || null;
}

// Task shaped like prospect-pipeline.buildReplyTask so it rides the entire
// existing chain unchanged (drafter → QG → REPLY panel → executor). Extras:
// threadContext.root (TRUE thread root for the executor payload — agent-runner
// falls back to root=parent when absent) and 'engagement-reply' tag.
// Conversation context lives in the DESCRIPTION (full budget) — task comments
// are capped at 200 chars in the execute prompt except [SCAN RESULT]/qgbrief.
function buildEngagementReplyTask(entry, scanCommentText, nowMs) {
  var iso = new Date(nowMs).toISOString();
  var rules = [
    '- Answer their question or thank them genuinely. Continue the conversation naturally.',
    '- Reply in the SAME LANGUAGE they used.',
    '- You are replying AS the AmbientPixels founder account.'
  ];
  if (scanCommentText) {
    rules.push('- They asked about the audit: cite ONLY facts from the [SCAN RESULT] comment on this task. If a link belongs in the reply, copy the report link EXACTLY from that comment. Invented or prettified URLs are auto-rejected.');
    rules.push('- ONLY IF they ask about paid help, deeper analysis, or having the work done for them: you may mention the $199 Conversion Teardown (done for you, five conversion killers with rewrites, delivered within 48 hours) at ambientpixels.ai/ambientscore/#teardown. Never volunteer it otherwise.');
  } else {
    rules.push('- NO links and NO pitch. Do not mention pricing, discounts, or the product unless they asked.');
  }
  rules.push('- Founder voice: under 280 chars, no em dashes, no hype, 5th grade reading level.');
  rules.push('- If the comment is spam or there is nothing genuine to add, output an empty deliverable to decline.');

  var task = {
    id: 'task_' + nowMs + '_engage_' + Math.random().toString(36).substring(2, 6),
    title: 'Reply to @' + entry.author + ' (engagement — they replied to our post)',
    description:
      'ENGAGEMENT REPLY — they commented on OUR post; continue the conversation.\n'
      + '- Our post (verbatim): "' + (entry.ourPostText || '') + '"\n'
      + '- Their comment (verbatim): "' + (entry.text || '') + '"\n'
      + '- Author: @' + entry.author + '\n\n'
      + 'RULES:\n' + rules.join('\n') + '\n\n'
      + 'Output ONLY the reply text itself. No title, no "Reply:" label, no preamble.',
    taskType: 'bluesky_reply',
    category: 'maintenance',
    status: 'todo',
    priority: 'medium',
    assignee: 'scribe',
    source: 'engagementReply',
    created_by: 'engagementReply',
    objective_id: 'obj-first-customer',
    createdAt: iso,
    updatedAt: iso,
    dueDate: new Date(nowMs + 2 * 86400e3).toISOString(),
    tags: ['bluesky-reply', 'engagement-reply'],
    threadContext: {
      uri: entry.replyUri,          // parent for the executor = THEIR comment
      cid: entry.replyCid,
      root: { uri: entry.rootUri, cid: entry.rootCid },  // TRUE thread root
      author: entry.author,
      authorDid: entry.authorDid,
      originalText: entry.text,     // REPLY panel quotes what we are answering
      indexedAt: entry.indexedAt
    },
    comments: []
  };
  if (scanCommentText) {
    task.comments.push({
      id: 'cmt-scanresult-copy-' + nowMs,
      author: 'system',
      type: 'system',
      text: scanCommentText,        // verbatim — must keep [SCAN RESULT] at char 0
      createdAt: iso
    });
  }
  return task;
}

var _VANISHED_GRACE_MS = 24 * 3600e3;

// Task states from which no reply can ever come. Only 'done' was listed here
// before, so a CANCELLED draft task left its entry at 'task_created' forever:
// the dashboard reported "draft queued, waiting on your approval" for something
// that would never be drafted, AND the dead entry kept counting as a touch, so
// the per-thread and cooldown guards blocked any retry. Three live
// conversations sat like that from 2026-08-08, when a bulk cancel closed their
// tasks in the same second.
//
// Anything NOT listed here is treated as in flight and left alone, which is the
// safe direction: a state we do not recognise stalls rather than resurrects.
var _TERMINAL_TASK_STATUS = {
  done: 'closed_without_action',
  canceled: 'task_canceled',
  cancelled: 'task_canceled',
  archived: 'task_archived'
};

// Terminal-outcome stamping for 'task_created' entries. Action state wins over
// task state (actions outlive tasks through archive-then-trim). A task that
// VANISHED young is a concurrent-writer clobber (wholesale tasks saves race
// this cron) → reset to 'new' so the next filter pass re-creates it; vanished
// old → skipped, no zombie re-drafts. Makes the per-author cooldown real.
function reconcileEngagement(store, tasks, actions, nowMs) {
  var out = { answered: 0, skipped: 0, reset: 0 };
  var taskById = {};
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) { if (t && t.id) taskById[t.id] = t; });
  var replyByTask = {};
  (Array.isArray(actions) ? actions : []).forEach(function (a) {
    if (a && a.type === 'social_post.reply' && a._parentTaskId) replyByTask[a._parentTaskId] = a;
  });

  store.forEach(function (e) {
    if (!e || e.status !== 'task_created' || !e.taskId) return;
    var reply = replyByTask[e.taskId];
    if (reply) {
      var shipped = (reply.approval && reply.approval.status === 'approved')
        || (reply.execution && reply.execution.status === 'success')
        || reply.execution_status === 'success';
      if (shipped) {
        e.status = 'answered';
        e.actionId = reply.id;
        e.answeredAt = e.answeredAt || new Date(nowMs).toISOString();
        out.answered++;
        return;
      }
      var rejected = reply.approval &&
        (reply.approval.status === 'rejected' || reply.approval.status === 'cancelled');
      if (rejected) {
        e.status = 'skipped';
        e.skipReason = 'ceo_rejected';
        out.skipped++;
        return;
      }
      return; // pending — a later run re-checks
    }
    var t = taskById[e.taskId];
    if (t) {
      var term = _TERMINAL_TASK_STATUS[String(t.status || '').toLowerCase()];
      if (term) {
        e.status = 'skipped';
        e.skipReason = term;
        out.skipped++;
      }
      return; // in flight — leave alone
    }
    var age = nowMs - Date.parse(e.taskCreatedAt || e.discoveredAt || 0);
    if (Number.isFinite(age) && age < _VANISHED_GRACE_MS) {
      e.status = 'new';
      e.taskId = null;
      e.taskCreatedAt = null;
      out.reset++;
    } else {
      e.status = 'skipped';
      e.skipReason = 'task_vanished';
      out.skipped++;
    }
  });
  return out;
}

// IO shell. Caller (api/outcomeRefresh) passes the already-loaded snapshots
// map, a threadCache of depth=1 threads the metric loop fetched this run, and
// an injectable fetchThread(atUri) for anything eligible but not yet fetched.
// Order matters for the race window: network fetches happen BEFORE the
// tasks load, so the tasks read-modify-write spans milliseconds, not seconds.
async function runEngagementReplyLoop(opts) {
  var storage = opts.storage;
  var log = opts.log || function () {};
  var nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  var snapshots = opts.snapshots || {};
  var threadCache = opts.threadCache || {};
  var fetchThread = opts.fetchThread;

  var systemConfig = (await storage.getState('systemConfig')) || {};
  var cfg = loadConfig(systemConfig);
  if (cfg.enabled === false) {
    log('[engagement] disabled via systemConfig.engagementReply.enabled');
    return { skipped: 'disabled' };
  }

  var store = (await storage.getState('engagementReplies')) || [];
  if (!Array.isArray(store)) store = [];

  // ── Harvest (network first, state writes later) ──
  var eligible = eligibleSnapshots(snapshots);
  var candidates = [];
  var harvested = { selfExcluded: 0, malformed: 0 };
  var fetches = 0, fetchErrors = 0, fetchCapped = 0;
  var maxFetches = Number.isFinite(cfg.maxThreadFetchesPerRun) ? cfg.maxThreadFetchesPerRun : 25;
  for (var i = 0; i < eligible.length; i++) {
    var el = eligible[i];
    var thread = threadCache[el.actionId];
    if (!thread) {
      if (fetches >= maxFetches) { fetchCapped++; continue; } // logged below — no silent caps
      try {
        fetches++;
        thread = await fetchThread(el.atUri);
      } catch (fErr) {
        fetchErrors++;
        log('[engagement] thread fetch failed (non-fatal) for ' + el.actionId + ': ' + String(fErr && fErr.message || fErr).substring(0, 150));
        continue;
      }
    }
    try {
      var h = harvestFromThread(el.snapshot, thread, nowMs);
      candidates = candidates.concat(h.candidates);
      harvested.selfExcluded += h.selfExcluded;
      harvested.malformed += h.malformed;
    } catch (hErr) {
      log('[engagement] harvest failed (non-fatal) for ' + el.actionId + ': ' + String(hErr && hErr.message || hErr).substring(0, 150));
    }
  }
  if (fetchCapped > 0) {
    log('[engagement] thread-fetch cap hit — ' + fetchCapped + ' eligible snapshot(s) deferred to the next run (maxThreadFetchesPerRun=' + maxFetches + ')');
  }

  // ── State reads (fresh, tight window) ──
  var execModeRaw = String((await storage.getState('execution_mode')) || 'active').trim().toLowerCase();
  var execMode = ['active', 'observe', 'manual', 'frozen'].indexOf(execModeRaw) !== -1 ? execModeRaw : 'active';
  var tasks = (await storage.getState('tasks')) || [];
  if (!Array.isArray(tasks)) tasks = [];
  var actions = (await storage.getState('actions')) || [];
  if (!Array.isArray(actions)) actions = [];

  var rec = reconcileEngagement(store, tasks, actions, nowMs);
  var merged = mergeCandidates(store, candidates, nowMs);

  // ── Draft-task creation (only when automation is fully on; observe/manual/
  // frozen keep harvesting so nothing is lost, but never mutate tasks) ──
  var created = 0;
  var tasksDirty = false;
  var govEvents = [];
  var drops = null;
  if (execMode === 'active') {
    var f = filterCandidates(store, cfg, nowMs);
    drops = f.drops;
    f.survivors.forEach(function (entry) {
      var scanCmt = asksProductQuestion(entry.text) ? findScanComment(entry, actions, tasks) : null;
      var task = buildEngagementReplyTask(entry, scanCmt, nowMs);
      tasks.push(task);
      tasksDirty = true;
      entry.status = 'task_created';
      entry.taskId = task.id;
      entry.taskCreatedAt = new Date(nowMs).toISOString();
      created++;
      govEvents.push({
        type: 'engagement-reply-drafted',
        summary: 'Engagement reply task drafted for @' + entry.author,
        data: { taskId: task.id, author: entry.author, replyUri: entry.replyUri, groundedWithScan: !!scanCmt }
      });
      log('[engagement] task ' + task.id + ' → @' + entry.author + (scanCmt ? ' (scan-grounded)' : ''));
    });
  } else {
    log('[engagement] execution_mode=' + execMode + ' — harvest-only, no task creation');
  }

  // ── Persist (store always; tasks only when mutated) ──
  await storage.setState('engagementReplies', store);
  if (tasksDirty) await storage.setState('tasks', tasks);

  var summary = {
    mode: execMode,
    eligible: eligible.length,
    fetched: fetches,
    fetchErrors: fetchErrors,
    harvested: candidates.length,
    selfExcluded: harvested.selfExcluded,
    added: merged.added,
    created: created,
    drops: drops,
    reconciled: rec
  };

  // Batched gov write AFTER the state the events describe has landed
  // (prospect-pipeline pattern). Aggregate once per run; per-task drafted
  // events are bounded by maxPerDay so the 500-entry FIFO is safe.
  if (created > 0 || merged.added > 0 || rec.answered > 0 || rec.skipped > 0 || rec.reset > 0) {
    govEvents.push({
      type: 'engagement-reply-run',
      summary: 'Engagement loop: ' + candidates.length + ' harvested, ' + merged.added + ' new, ' + created + ' drafted',
      data: summary
    });
    try {
      var gov = (await storage.getState('governanceLog')) || [];
      govEvents.forEach(function (e) {
        gov.push({
          id: 'gov-' + nowMs + '-' + Math.random().toString(36).substring(2, 6),
          type: e.type, summary: e.summary, data: e.data,
          timestamp: new Date(nowMs).toISOString()
        });
      });
      await storage.setState('governanceLog', gov.slice(-500));
    } catch (_e) { /* non-fatal */ }
  }

  log('[engagement] run complete: ' + JSON.stringify(summary));
  return summary;
}

module.exports = {
  loadConfig: loadConfig,
  eligibleSnapshots: eligibleSnapshots,
  harvestFromThread: harvestFromThread,
  mergeCandidates: mergeCandidates,
  filterCandidates: filterCandidates,
  asksProductQuestion: asksProductQuestion,
  findScanComment: findScanComment,
  buildEngagementReplyTask: buildEngagementReplyTask,
  reconcileEngagement: reconcileEngagement,
  runEngagementReplyLoop: runEngagementReplyLoop,
  REPLYABLE_PLATFORMS: REPLYABLE_PLATFORMS
};
