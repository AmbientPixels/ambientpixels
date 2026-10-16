// video-department — GET /api/video-department (company secret). The Design department as the HQ Fleet page shows
// it: Pixel as head (from the agent registry), its divisions, and the Video division in full — the crew (the Studio's
// roles, from the video catalogue), the Studio's presence (the PC worker's last check-in), its requests
// (video_request tasks on the company board, assigned to 'studio'), what shipped (the release log), and demand.
// Read-only. Decisions happen on the task board; the department's work happens in the Studio.
// Spec: docs/superpowers/specs/2026-10-14-video-desk-design.md §8–9.

const storage = require('../_utils/companyStorage');
const D = require('../studio/desk');
const W = require('../_lib/releaseWatch/watcher');
const { readJson } = require('../studio/blob');

// The worker checks in every 30 s while the Studio is open; past this, HQ says the Studio is offline.
const STUDIO_OFFLINE_MS = 15 * 60 * 1000;

// Design = Pixel's department (agent registry). Video joins it as a division (2026-10-15, Chad).
function designDepartment(registry) {
  const pixel = ((registry && registry.agents) || []).find((a) => a.id === 'pixel') || null;
  const divisions = ((pixel && pixel.divisions) || []).filter((d) => d.id !== 'video').map((d) => ({ id: d.id, name: d.name, description: d.description }));
  return {
    name: 'Design',
    head: pixel ? { id: 'pixel', name: pixel.name || 'Pixel', role: pixel.role || pixel.title || 'Design Director', status: pixel.status || 'unknown' } : null,
    divisions: [{ id: 'video', name: 'Video', description: 'Narrated, captioned videos, made by the Studio crew on Chad\'s PC' }].concat(divisions),
  };
}

function studioPresence(beat) {
  if (!beat || !beat.at) return { online: false, lastSeen: null };
  return { online: Date.now() - Date.parse(beat.at) < STUDIO_OFFLINE_MS, lastSeen: beat.at, status: beat.status || '' };
}

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
    const [tasksRead, relRead, regRead, beat] = await Promise.all([
      storage.getStateWithMeta('tasks'), storage.getStateWithMeta(W.STATE_KEY), storage.getStateWithMeta('agentRegistry'),
      readJson('worker/heartbeat.json').catch(() => undefined),
    ]);
    if (tasksRead.failed) { context.res = { status: 503, headers: corsHeaders, body: { error: 'the task board could not be read' } }; return; }
    const requests = D.requestsFrom(tasksRead.value || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const rel = Object.assign(W.emptyState(), (!relRead.failed && relRead.value) || {});
    context.res = {
      status: 200, headers: corsHeaders, body: {
        department: regRead.failed ? null : designDepartment(regRead.value),
        studio: beat === undefined ? null : studioPresence(beat),
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
