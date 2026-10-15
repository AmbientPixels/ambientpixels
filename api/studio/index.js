// studio — the cloud half of AmbientPixels Studio, the front end for the AI video pipeline.
// Plan: C:\Dev\ai-video-pipeline\docs\plans\2026-10-12-studio-harness-plan.md
//
// The pipeline only runs on Chad's PC. A worker there scans the project folders, uploads a manifest and
// the review media into the PRIVATE `studio` container, and the /studio/ pages read them back through here.
// Media never streams through this function: it hands out a 15-minute SAS link for one blob at a time.
//
//   operator (x-studio-key)            GET  projects | manifest?project= | media?project=&path= | text?project=&path=
//                                           events?project=
//                                      POST event        (a note, pick, answer or decision → the project's inbox)
//                                      GET  jobs?project=     POST job | job-cancel
//   worker   (x-studio-worker-token)   POST heartbeat | manifest | upload-url | ack
//                                      GET  files?project= | inbox?project= | job-next     POST job-update
//   either                             GET  desk | desk-releases   POST desk-release-status   (Video department)
//   worker                             GET  desk-sync              POST desk-comment          (desk-routes.js)
//
// The inbox is how decisions reach the PC: one small JSON blob per event, collected by the worker, written into
// the project's feedback/ files, then acked (deleted here).
//
// Only projects named in STUDIO_PROJECTS exist here. Local-only projects (Xbox) are refused at the door.
const { BlobSASPermissions } = require('@azure/storage-blob');
const L = require('./lib');
const { getContainer, readJson, writeJson, mutateJson } = require('./blob');
const desk = require('./desk-routes');

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-studio-key, x-studio-worker-token'
};
const MAX_MANIFEST = 4 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;
const LINK_MINUTES = 15;
function link(blob, perms) {
  const now = Date.now();
  return blob.generateSasUrl({
    permissions: BlobSASPermissions.parse(perms),
    startsOn: new Date(now - 5 * 60 * 1000),
    expiresOn: new Date(now + LINK_MINUTES * 60 * 1000)
  });
}

const reply = (context, status, body) => { context.res = { status, headers: HEADERS, body }; };

// The project and path every file action needs, checked against the allowlist and the path rules.
function fileTarget(context, project, path) {
  if (!L.hostedProjects().includes(project)) { reply(context, 404, { error: 'unknown project' }); return null; }
  if (!L.validFilePath(project, path)) { reply(context, 400, { error: 'invalid path' }); return null; }
  return L.blobKey(project, path);
}

const operator = {
  async projects(context) {
    const ids = L.hostedProjects();
    const projects = [];
    for (const id of ids) {
      const m = await readJson(`projects/${id}/manifest.json`);
      projects.push(m
        ? { id, name: m.name, scannedAt: m.scannedAt, videos: (m.videos || []).length, drafts: (m.videos || []).reduce((n, v) => n + (v.drafts || []).length, 0) }
        : { id, name: id, scannedAt: null, videos: 0, drafts: 0 });
    }
    reply(context, 200, { projects, worker: await readJson('worker/heartbeat.json') });
  },
  async manifest(context, req) {
    const id = req.query.project;
    if (!L.hostedProjects().includes(id)) return reply(context, 404, { error: 'unknown project' });
    const m = await readJson(`projects/${id}/manifest.json`);
    m ? reply(context, 200, m) : reply(context, 404, { error: 'no manifest yet' });
  },
  async media(context, req) {
    const key = fileTarget(context, req.query.project, req.query.path);
    if (!key) return;
    const blob = (await getContainer()).getBlockBlobClient(key);
    if (!(await blob.exists())) return reply(context, 404, { error: 'not uploaded' });
    reply(context, 200, { url: await link(blob, 'r'), expiresInMinutes: LINK_MINUTES });
  },
  async event(context, req) {
    const id = (req.body || {}).project;
    if (!L.hostedProjects().includes(id)) return reply(context, 404, { error: 'unknown project' });
    const e = L.cleanEvent(id, req.body);
    if (typeof e === 'string') return reply(context, 400, { error: e });
    e.id = e.at.replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 8);
    await writeJson(`projects/${id}/inbox/${e.id}.json`, e);
    reply(context, 200, { ok: true, event: e });
  },
  async events(context, req) {
    const id = req.query.project;
    if (!L.hostedProjects().includes(id)) return reply(context, 404, { error: 'unknown project' });
    reply(context, 200, { events: await readInbox(id) });
  },
  async job(context, req) {
    const id = (req.body || {}).project;
    if (!L.hostedProjects().includes(id)) return reply(context, 404, { error: 'unknown project' });
    const j = L.cleanJob(id, req.body);
    if (typeof j === 'string') return reply(context, 400, { error: j });
    j.id = j.createdAt.replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 8);
    await writeJson(`projects/${id}/jobs/${j.id}.json`, j);
    reply(context, 200, { ok: true, job: j });
  },
  async jobs(context, req) {
    const id = req.query.project;
    if (!L.hostedProjects().includes(id)) return reply(context, 404, { error: 'unknown project' });
    reply(context, 200, { jobs: (await readJobs(id)).reverse().slice(0, 30) });
  },
  async 'job-cancel'(context, req) {
    const b = req.body || {};
    if (!L.hostedProjects().includes(b.project) || !JOB_ID.test(b.id || '')) return reply(context, 404, { error: 'unknown job' });
    const j = await mutateJson(`projects/${b.project}/jobs/${b.id}.json`, (x) => {
      if (x.status === 'queued') x.status = 'cancelled';
      else if (x.status === 'running') x.cancelRequested = true;
      else return false;
    });
    if (!j) return reply(context, 404, { error: 'unknown job' });
    reply(context, 200, { ok: true, job: j });
  },
  async text(context, req) {
    const key = fileTarget(context, req.query.project, req.query.path);
    if (!key) return;
    const blob = (await getContainer()).getBlockBlobClient(key);
    try {
      const props = await blob.getProperties();
      if (props.contentLength > MAX_TEXT) return reply(context, 413, { error: 'too large for text' });
      context.res = { status: 200, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }, body: (await blob.downloadToBuffer()).toString('utf8') };
    } catch (e) {
      if (e.statusCode === 404) return reply(context, 404, { error: 'not uploaded' });
      throw e;
    }
  }
};

const worker = {
  async heartbeat(context, req) {
    const b = req.body || {};
    await writeJson('worker/heartbeat.json', {
      host: String(b.host || '').slice(0, 80),
      version: String(b.version || '').slice(0, 40),
      status: String(b.status || '').slice(0, 200),
      at: new Date().toISOString()
    });
    reply(context, 200, { ok: true });
  },
  async manifest(context, req) {
    const b = req.body || {};
    if (!L.hostedProjects().includes(b.project)) return reply(context, 404, { error: 'unknown project' });
    if (!b.manifest || typeof b.manifest !== 'object' || b.manifest.id !== b.project) return reply(context, 400, { error: 'manifest must be an object for this project' });
    if (Buffer.byteLength(JSON.stringify(b.manifest)) > MAX_MANIFEST) return reply(context, 413, { error: 'manifest too large' });
    await writeJson(`projects/${b.project}/manifest.json`, b.manifest);
    reply(context, 200, { ok: true });
  },
  async 'upload-url'(context, req) {
    const b = req.body || {};
    const key = fileTarget(context, b.project, b.path);
    if (!key) return;
    reply(context, 200, { url: await link((await getContainer()).getBlockBlobClient(key), 'cw'), expiresInMinutes: LINK_MINUTES });
  },
  async files(context, req) {
    const id = req.query.project;
    if (!L.hostedProjects().includes(id)) return reply(context, 404, { error: 'unknown project' });
    const prefix = `projects/${id}/files/`;
    const files = [];
    for await (const item of (await getContainer()).listBlobsFlat({ prefix })) {
      files.push({ path: item.name.slice(prefix.length), size: item.properties.contentLength });
    }
    reply(context, 200, { files });
  },
  async inbox(context, req) {
    const id = req.query.project;
    if (!L.hostedProjects().includes(id)) return reply(context, 404, { error: 'unknown project' });
    reply(context, 200, { events: await readInbox(id) });
  },
  async 'job-next'(context) {
    for (const id of L.hostedProjects()) {
      const next = (await readJobs(id)).find((j) => j.status === 'queued');
      if (next) return reply(context, 200, { job: next });
    }
    reply(context, 200, { job: null });
  },
  async 'job-update'(context, req) {
    const b = req.body || {};
    if (!L.hostedProjects().includes(b.project) || !JOB_ID.test(b.id || '')) return reply(context, 404, { error: 'unknown job' });
    const STATUSES = ['queued', 'running', 'done', 'done-with-warnings', 'failed', 'cancelled'];
    const j = await mutateJson(`projects/${b.project}/jobs/${b.id}.json`, (x) => {
      // Cancelled while still queued: neither the worker's "running" nor its "waiting" (queued) report may revive it;
      // tell the worker to stop instead. (Review 2026-10-13: "queued" used to overwrite "cancelled".)
      if (x.status === 'cancelled' && (b.status === 'running' || b.status === 'queued')) { x.cancelRequested = true; return; }
      if (STATUSES.includes(b.status)) x.status = b.status;
      x.step = String(b.step || '').slice(0, 60);
      x.log = String(b.log || '').slice(-16000);
      x.outputs = Array.isArray(b.outputs) ? b.outputs.filter((p) => L.validFilePath(b.project, p)).slice(0, 20) : [];
      x.updatedAt = new Date().toISOString();
      if (x.status === 'running' && !x.startedAt) x.startedAt = x.updatedAt;
    });
    if (!j) return reply(context, 404, { error: 'unknown job' });
    reply(context, 200, { ok: true, cancelRequested: !!j.cancelRequested });
  },
  async 'job-status'(context, req) {
    const q = req.query || {};
    if (!L.hostedProjects().includes(q.project) || !JOB_ID.test(q.id || '')) return reply(context, 404, { error: 'unknown job' });
    const j = await readJson(`projects/${q.project}/jobs/${q.id}.json`);
    if (!j) return reply(context, 404, { error: 'unknown job' });
    reply(context, 200, { status: j.status, cancelRequested: !!j.cancelRequested || j.status === 'cancelled' });
  },
  async ack(context, req) {
    const b = req.body || {};
    if (!L.hostedProjects().includes(b.project)) return reply(context, 404, { error: 'unknown project' });
    const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(x)) : [];
    const c = await getContainer();
    for (const x of ids) await c.getBlockBlobClient(`projects/${b.project}/inbox/${x}.json`).deleteIfExists();
    reply(context, 200, { ok: true, acked: ids.length });
  }
};

const JOB_ID = /^[A-Za-z0-9-]{1,80}$/;
// Only recent jobs are read: over 14 days old they're skipped, over 30 they're deleted. Before, every job ever
// written was downloaded every few seconds (code review 2026-10-12, finding 11).
const DAY = 24 * 3600 * 1000;
async function readJobs(id) {
  const c = await getContainer();
  const jobs = [];
  for await (const item of c.listBlobsFlat({ prefix: `projects/${id}/jobs/` })) {
    const age = Date.now() - new Date(item.properties.lastModified).getTime();
    if (age > 30 * DAY) { await c.getBlockBlobClient(item.name).deleteIfExists(); continue; }
    if (age > 14 * DAY) continue;
    const j = await readJson(item.name);
    if (j) jobs.push(j);
  }
  return jobs.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

async function readInbox(id) {
  const c = await getContainer();
  const events = [];
  for await (const item of c.listBlobsFlat({ prefix: `projects/${id}/inbox/` })) {
    const e = await readJson(item.name);
    if (e) events.push(e);
  }
  return events.sort((a, b) => (a.at < b.at ? -1 : 1));
}

// Who may call what. Anything not listed is a 404.
const ROUTES = {
  'GET projects': ['op', operator.projects], 'GET manifest': ['op', operator.manifest],
  'GET media': ['op', operator.media], 'GET text': ['op', operator.text],
  'GET events': ['op', operator.events], 'POST event': ['op', operator.event],
  'GET jobs': ['op', operator.jobs], 'POST job': ['op', operator.job], 'POST job-cancel': ['op', operator['job-cancel']],
  'GET job-next': ['worker', worker['job-next']], 'POST job-update': ['worker', worker['job-update']],
  'GET job-status': ['worker', worker['job-status']],
  'POST heartbeat': ['worker', worker.heartbeat], 'POST manifest': ['worker', worker.manifest],
  'POST upload-url': ['worker', worker['upload-url']], 'POST ack': ['worker', worker.ack],
  'GET files': ['worker', worker.files], 'GET inbox': ['worker', worker.inbox],
  // Video department: requests are company tasks; Chad decides on the company board. The website (Chad's key) and
  // the PC read them; only the PC (the department) comments on them.
  'GET desk': ['either', desk.list], 'GET desk-releases': ['either', desk.releases],
  'POST desk-release-status': ['either', desk.releaseStatus],
  'GET desk-sync': ['worker', desk.sync], 'POST desk-comment': ['worker', desk.comment]
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: HEADERS, body: '' }; return; }
  const action = context.bindingData.action;
  const key = req.method + ' ' + action;
  const route = Object.prototype.hasOwnProperty.call(ROUTES, key) ? ROUTES[key] : null;
  if (!route) return reply(context, 404, { error: 'unknown action' });
  const [role, handler] = route;

  const allowed = role === 'worker' ? L.isWorker(req) : role === 'either' ? (L.isOperator(req) || L.isWorker(req)) : L.isOperator(req);
  req.studioRole = L.isWorker(req) ? 'worker' : 'op';
  if (!allowed) return reply(context, 403, { error: 'studio access required' });

  try { await handler(context, req, reply); }
  catch (err) {
    context.log.error('[studio] ' + action + ': ' + err.message);
    reply(context, err.message === 'storage not configured' ? 503 : 500, { error: 'internal error' });
  }
};
