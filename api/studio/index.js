// studio — the cloud half of AmbientPixels Studio, the front end for the AI video pipeline.
// Plan: C:\Dev\ai-video-pipeline\docs\plans\2026-10-12-studio-harness-plan.md
//
// The pipeline only runs on Chad's PC. A worker there scans the project folders, uploads a manifest and
// the review media into the PRIVATE `studio` container, and the /studio/ pages read them back through here.
// Media never streams through this function: it hands out a 15-minute SAS link for one blob at a time.
//
//   operator (x-studio-key)            GET  projects | manifest?project= | media?project=&path= | text?project=&path=
//   worker   (x-studio-worker-token)   POST heartbeat | manifest | upload-url      GET files?project=
//
// Only projects named in STUDIO_PROJECTS exist here. Local-only projects (Xbox) are refused at the door.
const { BlobServiceClient, BlobSASPermissions } = require('@azure/storage-blob');
const L = require('./lib');

const CONTAINER = 'studio';
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

let container = null;
async function getContainer() {
  if (container) return container;
  if (!process.env.AZURE_STORAGE_CONNECTION_STRING) throw new Error('storage not configured');
  const c = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING).getContainerClient(CONTAINER);
  await c.createIfNotExists(); // no access option = private
  container = c;
  return c;
}

async function readJson(name) {
  const blob = (await getContainer()).getBlockBlobClient(name);
  try { return JSON.parse((await blob.downloadToBuffer()).toString('utf8')); }
  catch (e) { if (e.statusCode === 404) return null; throw e; }
}
async function writeJson(name, value) {
  const body = JSON.stringify(value);
  await (await getContainer()).getBlockBlobClient(name).upload(body, Buffer.byteLength(body), {
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
}
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
  }
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: HEADERS, body: '' }; return; }
  const action = context.bindingData.action;
  const table = req.method === 'GET' ? { ...operator, files: worker.files } : worker;
  const handler = Object.prototype.hasOwnProperty.call(table, action) ? table[action] : null;
  if (!handler) return reply(context, 404, { error: 'unknown action' });

  const isWorkerAction = handler === worker[action];
  const allowed = isWorkerAction ? L.isWorker(req) : L.isOperator(req);
  if (!allowed) return reply(context, 403, { error: 'studio access required' });

  try { await handler(context, req); }
  catch (err) {
    context.log.error('[studio] ' + action + ': ' + err.message);
    reply(context, err.message === 'storage not configured' ? 503 : 500, { error: 'internal error' });
  }
};
