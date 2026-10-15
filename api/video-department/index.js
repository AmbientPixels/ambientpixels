// video-department — GET /api/video-department (company secret). The Video department as the HQ Fleet page shows
// it, beside the agents: its crew (the Studio's roles, from the video catalogue), its requests (video_request tasks
// on the company board, assigned to 'studio'), what shipped (the release log), and the demand ledger.
// Read-only. Decisions happen on the task board; the department's work happens in the Studio.
// Spec: docs/superpowers/specs/2026-10-14-video-desk-design.md §8–9.

const storage = require('../_utils/companyStorage');
const D = require('../studio/desk');
const W = require('../_lib/releaseWatch/watcher');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: corsHeaders, body: '' }; return; }
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) { context.res = { status: 403, headers: corsHeaders, body: { error: 'Invalid secret' } }; return; }
  try {
    const [tasksRead, relRead] = await Promise.all([storage.getStateWithMeta('tasks'), storage.getStateWithMeta(W.STATE_KEY)]);
    if (tasksRead.failed) { context.res = { status: 503, headers: corsHeaders, body: { error: 'the task board could not be read' } }; return; }
    const requests = D.requestsFrom(tasksRead.value || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const rel = Object.assign(W.emptyState(), (!relRead.failed && relRead.value) || {});
    context.res = {
      status: 200, headers: corsHeaders, body: {
        crew: D.CATALOG.crew || [],
        formats: D.CATALOG.formats.map((f) => ({ id: f.id, name: f.name, status: f.status })),
        requests: requests.slice(0, 20).map((r) => ({
          taskId: r.taskId, title: r.title, from: r.from, product: r.product, format: r.format, mood: r.mood, status: r.status,
          video: r.video, releaseUrl: r.releaseUrl, reason: r.reason, trigger: r.trigger, createdAt: r.createdAt, updatedAt: r.updatedAt,
          last: (r.comments || []).slice(-1)[0] || null,
        })),
        open: D.fleetLoad(requests).open,
        releases: rel.entries.filter((e) => e.status !== 'hidden').slice(-10).reverse(),
        releaseLogUnavailable: !!relRead.failed,
        lastRun: rel.runs.slice(-1)[0] || null,
        demand: D.demand(requests),
      }
    };
  } catch (err) {
    context.res = { status: 500, headers: corsHeaders, body: { error: String(err && err.message || err).substring(0, 300) } };
  }
};
