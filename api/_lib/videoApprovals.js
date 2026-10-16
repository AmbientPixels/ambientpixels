// videoApprovals.js — video decisions in the CEO approvals queue (Chad, 2026-10-16: "should they drop in the
// approvals queue for me to approve?"). Pure functions; callers do the I/O with storage.mutateState.
//
// Three kinds of item, all backed by the company task (the one record, spec §10):
//   video_request     a request waiting for Chad          approve → task in-progress; decline → canceled + reason
//   video_checkpoint  script ready / final cut ready      approve → "[ceo:approved <kind>]"; send back → "[ceo:sent
//                     (studio/desk.js checkpoint markers)  back <kind>] <reason>" — the PC worker moves the Board
// The board stays a valid place to decide: syncQueue() resolves an item once the task shows the decision was made
// elsewhere, and re-adds a pending item the queue's 100-entry caps dropped (ids are deterministic).
'use strict';

const desk = require('../studio/desk');

const SITE = 'https://www.ambientpixels.ai';
const TYPES = ['video_request', 'video_checkpoint'];
const KIND_LABEL = { script: 'Script ready', cut: 'Final cut ready', publish: 'Ready for YouTube' };

const requestItemId = (taskId) => 'aq-video-' + taskId;
const checkpointItemId = (taskId, kind, round) => 'aq-videocp-' + taskId + '-' + kind + '-' + round;
const isVideoItem = (q) => !!q && TYPES.indexOf(q.type) !== -1;
const isPending = (q) => !!q && q.status === 'pending';

// Pixel's latest triage comment on the task ("RECOMMEND: accept|decline. …"), or null.
function recommendation(task) {
  const cs = desk.commentsOf(task).filter((c) => c.who === 'pixel' && /^RECOMMEND:/i.test(c.text));
  return cs.length ? cs[cs.length - 1].text.slice(0, 400) : null;
}

function studioLink(r, kind) {
  if (!r.project || !r.video) return null;
  return SITE + '/studio/#/p/' + encodeURIComponent(r.project) + '/v/' + encodeURIComponent(r.video) + '/' + (kind === 'script' ? 'script' : 'review');
}

function publishSummary(r) {
  const p = r.youtubePackage;
  if (!p) return 'The master is ready to publish.';
  const first = String(p.description || '').split('\n').filter(Boolean)[0] || '';
  return '"' + p.title + '"' + (first ? ' · ' + first.slice(0, 140) : '') + (p.files && p.files.captions ? ' · captions' : '') + (p.files && p.files.thumbnail ? ' · thumbnail' : '');
}

function requestItem(task, r, nowIso) {
  return {
    id: requestItemId(task.id), type: 'video_request', taskId: task.id,
    title: r.title, taskTitle: task.title,
    summary: [r.product, r.format, r.seconds ? '~' + r.seconds + ' s' : null, r.goal ? 'goal: ' + r.goal : null].filter(Boolean).join(' · '),
    originAgent: r.from, recommendation: recommendation(task),
    payload: { product: r.product, format: r.format, mood: r.mood, seconds: r.seconds, trigger: r.trigger, goal: r.goal },
    status: 'pending', createdAt: nowIso, submittedAt: nowIso,
  };
}

function checkpointItem(task, r, kind, cp, nowIso) {
  return {
    id: checkpointItemId(task.id, kind, cp.round), type: 'video_checkpoint', checkpoint: kind, round: cp.round,
    taskId: task.id, video: r.video, project: r.project,
    title: KIND_LABEL[kind] + ': ' + r.title, taskTitle: task.title,
    summary: kind === 'publish' ? publishSummary(r) : (cp.note || (kind === 'script' ? 'The script is ready for your approval.' : 'A draft is ready for your review.')),
    package: kind === 'publish' ? r.youtubePackage : undefined,
    link: studioLink(r, kind), originAgent: 'studio',
    status: 'pending', createdAt: nowIso, submittedAt: nowIso,
  };
}

// What a decided item's status becomes when the decision happened outside the queue.
function boardOutcome(r) {
  if (r.status === 'waiting') return null;
  return r.status === 'declined' ? 'rejected' : 'approved';
}

// Bring the queue in line with the board. Mutates and returns { queue, changed }.
// opts.onlyTaskId: look at one task only (the Studio's own checkpoint write).
// opts.autoPublish: systemConfig.youtube.audited — a "Ready for YouTube" item offers Publish now (else paste a link).
function syncQueue(queue, tasks, nowIso, opts) {
  opts = opts || {};
  const q = Array.isArray(queue) ? queue : [];
  let changed = false;
  const byId = new Map(q.filter(Boolean).map((x) => [x.id, x]));
  const resolve = (item, status) => {
    Object.assign(item, { status, decidedAt: nowIso, resolvedBy: 'board' });
    changed = true;
  };
  const seen = new Set();

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!desk.isRequestTask(task) || task._archived) continue;
    if (opts.onlyTaskId && task.id !== opts.onlyTaskId) continue;
    const r = desk.parseRequest(task);
    if (!r) continue;
    seen.add(task.id);

    // The request itself.
    const rid = requestItemId(task.id);
    const ri = byId.get(rid);
    if (r.status === 'waiting') {
      if (!ri) { const it = requestItem(task, r, nowIso); q.push(it); byId.set(rid, it); changed = true; }
      else if (isPending(ri)) {
        const rec = recommendation(task);
        if (rec !== ri.recommendation) { ri.recommendation = rec; changed = true; }
      }
    } else if (isPending(ri)) {
      resolve(ri, boardOutcome(r));
    }

    // Its checkpoints: one pending item for the open round; older rounds and decided ones resolve.
    const cps = r.checkpoints || {};
    const live = new Set();
    const over = r.status === 'declined' || r.status === 'released';
    for (const kind of desk.CHECKPOINTS) {
      const cp = cps[kind];
      if (!cp || cp.status !== 'pending' || over) continue;
      const cid = checkpointItemId(task.id, kind, cp.round);
      live.add(cid);
      if (!byId.has(cid)) { const it = checkpointItem(task, r, kind, cp, nowIso); q.push(it); byId.set(cid, it); changed = true; }
      const it = byId.get(cid);
      if (kind === 'publish' && isPending(it) && it.autoPublish !== !!opts.autoPublish) { it.autoPublish = !!opts.autoPublish; changed = true; }
    }
    for (const it of q) {
      if (!it || it.type !== 'video_checkpoint' || it.taskId !== task.id || !isPending(it) || live.has(it.id)) continue;
      const cp = cps[it.checkpoint];
      const same = cp && cp.round === it.round;
      // Decided on the Board/task → that decision; replaced by a newer round or the request ended → just closed.
      resolve(it, same && cp.status === 'approved' ? 'approved' : same && cp.status === 'sent_back' ? 'rejected' : 'resolved');
    }
  }

  // A pending video item whose task is gone (deleted or archived) can never be decided.
  if (!opts.onlyTaskId) {
    for (const it of q) {
      if (isVideoItem(it) && isPending(it) && !seen.has(it.taskId)) {
        Object.assign(it, { status: 'resolved', decidedAt: nowIso, resolvedBy: 'board', note: 'the request task is gone' });
        changed = true;
      }
    }
  }
  return { queue: q, changed };
}

// Apply Chad's decision on an item to its task (in a fresh `tasks` array). → { ok, task } or { ok: false, error, code }.
function decide(item, decision, note, tasks, nowIso, opts) {
  opts = opts || {};
  if (!isVideoItem(item)) return { ok: false, code: 400, error: 'not a video item' };
  if (decision !== 'approved' && decision !== 'rejected') return { ok: false, code: 400, error: 'decision must be approved or rejected' };
  const reason = String(note || '').trim().slice(0, 500);
  if (decision === 'rejected' && !reason) return { ok: false, code: 400, error: 'a reason is required: it is what the agent or the Studio learns from' };
  const task = (Array.isArray(tasks) ? tasks : []).find((t) => t && t.id === item.taskId);
  if (!task || !desk.isRequestTask(task)) return { ok: false, code: 404, error: 'the request task is gone' };
  const r = desk.parseRequest(task);
  if (!r) return { ok: false, code: 409, error: 'the request on the task cannot be read' };
  const comment = (text) => {
    if (!Array.isArray(task.comments)) task.comments = [];
    task.comments.push({ id: 'cmt-ceo-' + Date.parse(nowIso) + '-' + Math.random().toString(36).slice(2, 6), author: 'ceo', text, type: 'comment', createdAt: nowIso });
  };

  if (item.type === 'video_request') {
    if (r.status !== 'waiting') return { ok: false, code: 409, error: 'already decided on the board (' + r.status + ')' };
    if (decision === 'approved') task.status = 'in-progress';
    else { task.status = 'canceled'; comment(reason); }
  } else {
    const cp = (r.checkpoints || {})[item.checkpoint];
    if (!cp || cp.status !== 'pending' || cp.round !== item.round) return { ok: false, code: 409, error: 'this checkpoint is no longer open' };
    if (item.checkpoint === 'publish' && decision === 'approved') {
      // Approve = "it is on YouTube at <link>" (uploaded by hand) or, once the audit passed, "publish it now".
      if (reason && !desk.YT_URL.test(reason)) return { ok: false, code: 400, error: 'that is not a YouTube video link' };
      if (!reason && !opts.autoPublish) return { ok: false, code: 400, error: 'Upload it in YouTube Studio and paste the link: direct publishing turns on after the YouTube API audit passes.' };
    }
    comment(desk.ceoMark(decision, item.checkpoint) + (reason ? ' ' + reason : ''));
  }
  task.updatedAt = nowIso;
  return { ok: true, task };
}

module.exports = { TYPES, requestItemId, checkpointItemId, isVideoItem, recommendation, studioLink, syncQueue, decide };
