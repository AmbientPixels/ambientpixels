// release-watch — the release log over HTTP (Video Desk spec §3a). Write secret required.
//
//   GET  /api/release-watch?limit=50            the log, newest first, plus the last runs
//   POST /api/release-watch?action=run[&dryRun=1][&base=<sha>]
//                                                run the watcher now (dryRun writes nothing)
//   POST /api/release-watch?action=add           body {product, title, summary?, kind?, significance?, url?, source?}
//                                                "Log a release" by hand; confirmed on arrival
//   POST /api/release-watch?action=status        body {id, status: unreviewed|confirmed|hidden}
//                                                a hidden entry stops being a video trigger

const storage = require('../_utils/companyStorage');
const W = require('../_lib/releaseWatch/watcher');
const { callWithModel } = require('../companyHeartbeat/gemini');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret',
  'Content-Type': 'application/json'
};

function reply(context, status, body) {
  context.res = { status: status, headers: corsHeaders, body: body };
}

// Read → change → conditional write, retried on a concurrent write (the cron may be mid-run).
async function edit(change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const read = await storage.getStateWithMeta(W.STATE_KEY);
    if (read.failed) return { error: 'releaseLog read failed', status: 503 };
    const state = Object.assign(W.emptyState(), read.value || {});
    const result = change(state);
    if (result.error) return Object.assign({ status: 400 }, result);
    try {
      await storage.setState(W.STATE_KEY, state, read.etag ? { ifMatch: read.etag } : (read.exists ? {} : { ifNoneMatch: '*' }));
      return result;
    } catch (err) {
      if (!err || err.name !== 'ConcurrencyError') throw err;
    }
  }
  return { error: 'releaseLog kept changing, try again', status: 409 };
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') return reply(context, 204, '');
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  if (!storage.validateSecret(secret)) return reply(context, 403, { error: 'Invalid write secret' });

  const q = req.query || {};
  try {
    if (req.method === 'GET') {
      const read = await storage.getStateWithMeta(W.STATE_KEY);
      if (read.failed) return reply(context, 503, { error: 'releaseLog read failed' });
      const state = Object.assign(W.emptyState(), read.value || {});
      const limit = Math.max(1, Math.min(300, parseInt(q.limit, 10) || 50));
      return reply(context, 200, {
        watermark: state.watermark,
        watermarkAt: state.watermarkAt,
        entries: state.entries.slice(-limit).reverse(),
        runs: state.runs.slice(-5).reverse()
      });
    }

    const action = String(q.action || 'run');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (action === 'run') {
      const base = /^[0-9a-f]{7,40}$/.test(String(q.base || '')) ? String(q.base) : undefined;
      const r = await W.runReleaseWatch({
        storage: storage,
        fetch: fetch,
        llm: function (prompt) { return callWithModel(prompt, 'release-watcher', 'claude-haiku'); },
        token: process.env.RELEASE_WATCH_GITHUB_TOKEN || null,
        dryRun: String(q.dryRun || '') === '1',
        base: base,
        log: function () { context.log.apply(context, arguments); }
      });
      return reply(context, 200, { status: 'ok', summary: r.summary, entries: r.entries });
    }
    if (action === 'add') {
      const r = await edit((state) => W.addManualEntry(state, body, Date.now(), body.by || 'ceo'));
      return r.error ? reply(context, r.status, { error: r.error }) : reply(context, 200, { status: 'ok', entry: r.entry });
    }
    if (action === 'status') {
      const r = await edit((state) => W.setEntryStatus(state, String(body.id || ''), String(body.status || ''), body.by || 'ceo', Date.now()));
      return r.error ? reply(context, r.status, { error: r.error }) : reply(context, 200, { status: 'ok', entry: r.entry });
    }
    return reply(context, 400, { error: 'unknown action ' + action });
  } catch (err) {
    return reply(context, 500, { error: String(err && err.message || err).substring(0, 300) });
  }
};
