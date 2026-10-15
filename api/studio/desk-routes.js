// studio/desk-routes.js — the Video department's handlers inside /api/studio (dispatch and auth live in index.js).
// Each handler is (context, req, reply). req.studioRole is 'op' (the website, Chad's key) or 'worker' (the PC).
//
// The department has no store of its own: requests are company tasks (taskType video_request, assignee 'studio'),
// read from the `tasks` state key; the department speaks by commenting on them. Chad decides on the company board.
'use strict';

const D = require('./desk');
const storage = require('../_utils/companyStorage');
const W = require('../_lib/releaseWatch/watcher');

const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const TASK_ID = /^task-[A-Za-z0-9-]{4,60}$/;

// The heartbeat reads `tasks` at :00 and writes it back a few minutes later (00/06/12/18 UTC); a comment written in
// between would be overwritten. The worker simply retries after the window.
function inHeartbeatWindow(nowMs) {
  const d = new Date(nowMs);
  return d.getUTCHours() % 6 === 0 && d.getUTCMinutes() < 12;
}

async function readRequests() {
  const read = await storage.getStateWithMeta('tasks');
  if (read.failed) return null;
  return D.requestsFrom(read.value || []);
}

const catalog = () => ({
  formats: D.CATALOG.formats.map((f) => ({ id: f.id, name: f.name, status: f.status, seconds: f.seconds })),
  moods: D.CATALOG.moods.map((m) => ({ id: m.id, feel: m.feel })),
  styles: D.CATALOG.styles.map((s) => ({ id: s.id, name: s.name, status: s.status })),
});

module.exports = {
  // GET desk (worker) — every video request on the company board (newest first), the catalogue labels, and the demand
  // ledger (the PC writes DEMAND.md from it).
  async list(context, req, reply) {
    const requests = await readRequests();
    if (!requests) return reply(context, 503, { error: 'the task board could not be read' });
    requests.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    reply(context, 200, { requests, catalog: catalog(), load: { open: D.fleetLoad(requests).open }, demand: D.demand(requests) });
  },

  // GET desk-sync (worker) — the accepted requests the department is working on.
  async sync(context, req, reply) {
    const requests = await readRequests();
    if (!requests) return reply(context, 503, { error: 'the task board could not be read' });
    reply(context, 200, { requests: requests.filter((r) => ['accepted', 'scripting', 'in_production', 'review'].indexOf(r.status) !== -1) });
  },

  // POST desk-comment (worker) {taskId, text, stage?, video?, project?, released?} — the department speaks on a
  // request: progress ("[studio:<stage> video=…]"), @mentions to the fleet, or the release (with its link), which
  // also marks the task done. Only video requests can be touched from here.
  async comment(context, req, reply) {
    const b = body(req);
    const now = Date.now();
    if (!TASK_ID.test(String(b.taskId || ''))) return reply(context, 400, { error: 'invalid taskId' });
    const text = String(b.text || '').replace(/\s+$/, '').slice(0, 1800);
    const stage = b.stage ? String(b.stage) : null;
    if (stage && D.STAGES.indexOf(stage) === -1) return reply(context, 400, { error: 'stage must be one of ' + D.STAGES.join(', ') });
    if (!text && !stage) return reply(context, 400, { error: 'nothing to say' });
    const video = b.video && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(b.video) ? b.video : null;
    const project = b.project && /^[a-z0-9][a-z0-9-]{0,62}$/.test(b.project) ? b.project : null;
    if (inHeartbeatWindow(now)) return reply(context, 409, { error: 'the heartbeat is writing the board; retry after :12' });
    let refused = null, saved = null;
    await storage.mutateState('tasks', (tasks) => {
      const list = Array.isArray(tasks) ? tasks : [];
      const t = list.find((x) => x && x.id === b.taskId);
      if (!t) { refused = [404, 'unknown task']; return undefined; }
      if (!D.isRequestTask(t)) { refused = [403, 'not a video request']; return undefined; }
      if (!Array.isArray(t.comments)) t.comments = [];
      const at = new Date(now).toISOString();
      t.comments.push({ id: 'cmt-' + now, author: D.INBOX, text: (stage ? D.studioMark(stage, video, project) + ' ' : '') + text, type: 'comment', createdAt: at });
      t.updatedAt = at;
      if (stage === 'released') { t.status = 'done'; t.completedAt = at; }
      saved = t;
      return list;
    });
    if (refused) return reply(context, refused[0], { error: refused[1] });
    const request = D.parseRequest(saved);
    // A released video goes in the release log as a minor content release (a video never triggers another video).
    let release = null;
    if (stage === 'released' && request) {
      const r = await W.editReleaseLog(storage, (state) => W.addManualEntry(state, {
        product: request.product, title: 'New video: ' + request.title, summary: request.goal, kind: 'content', significance: 'minor',
        url: request.releaseUrl || undefined, source: 'video',
      }, now, 'studio'));
      release = r.error ? { error: r.error } : r.entry;
    }
    reply(context, 200, { ok: true, request, release });
  },
};
