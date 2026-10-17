// vale-connect — connects Vale to the CEO's Microsoft 365 mailbox (read-only scopes).
//   GET  /api/vale-connect/status      bearer   connection summary + last brief + recent runs
//   GET  /api/vale-connect/start       bearer   returns the Microsoft sign-in URL (PKCE)
//   GET  /api/vale-connect/callback    none     Microsoft redirects here; authenticated by the
//                                               single-use state, the PKCE verifier and the oid check
//   POST /api/vale-connect/disconnect  bearer   deletes the stored refresh token
//   POST /api/vale-connect/forget      bearer   wipes derived mail data and the audit
//   POST /api/vale-connect/test-brief  bearer   runs the morning brief now as "[Test]" (3-min cooldown)
// 503 until the app settings exist. Gated on configuration + bearer only, never on the
// VALE_STRICT_AUTH / VALE_MAIL_ENABLED flags, so Connect can happen before mail is on.
'use strict';

var oauth = require('../_lib/vale/oauth');
var tokenStore = require('../_lib/vale/tokenStore');
var tokenCrypto = require('../_lib/vale/tokenCrypto');
var audit = require('../_lib/vale/audit');

var PENDING_KEY = 'valeConnectPending';
var PENDING_TTL_MS = 10 * 60 * 1000;

var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

function connectConfig(env) {
  env = env || process.env;
  return {
    tenantId: env.VALE_TENANT_ID || '',
    clientId: env.VALE_CLIENT_ID || '',
    clientSecret: env.VALE_CLIENT_SECRET || '',
    ceoOid: env.VALE_CEO_OID || '',
    tokenKey: env.VALE_TOKEN_KEY || '',
    loginHint: env.VALE_CEO_UPN || 'chad@ambientpixels.ai',
    redirectUri: env.VALE_REDIRECT_URI || 'https://ambientpixels-nova-api.azurewebsites.net/api/vale-connect/callback',
    // A public return page: arriving cross-site from the API, the site's login cookie isn't sent, so
    // redirecting straight to the protected Office page would 401. The page forwards to the Office.
    officeUrl: env.VALE_OFFICE_URL || 'https://ambientpixels.ai/pages/vale-auth.html'
  };
}

function isConfigured(cfg) {
  return !!(cfg.tenantId && cfg.clientId && cfg.clientSecret && cfg.ceoOid && tokenCrypto.isValidKey(cfg.tokenKey));
}

function json(context, status, body) { context.res = { status: status, headers: CORS, body: body }; }

function redirect(context, cfg, result, reason) {
  var url = cfg.officeUrl + '?vale=1&connect=' + encodeURIComponent(result) + (reason ? '&reason=' + encodeURIComponent(reason) : '');
  context.res = { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' }, body: '' };
}

async function handleCallback(context, req, deps) {
  var cfg = deps.cfg;
  var q = req.query || {};
  if (q.error) return redirect(context, cfg, 'error', 'microsoft_' + String(q.error).slice(0, 40));

  var meta = await deps.store.getWithMeta(PENDING_KEY);
  if (meta.failed) return redirect(context, cfg, 'error', 'store_unavailable');
  var pending = meta.value;
  // Single use: clear whatever was pending before judging it.
  await deps.store.set(PENDING_KEY, null);

  var now = deps.now();
  if (!pending || !q.state || pending.state !== q.state || !q.code) return redirect(context, cfg, 'error', 'bad_state');
  if (now - Date.parse(pending.createdAt) > PENDING_TTL_MS) return redirect(context, cfg, 'error', 'expired');

  var res = await oauth.tokenRequest(deps.fetch, cfg, {
    grant_type: 'authorization_code', code: q.code, redirect_uri: cfg.redirectUri,
    code_verifier: pending.verifier, scope: oauth.SCOPES
  });
  if (!res.body.refresh_token || !res.body.id_token) return redirect(context, cfg, 'error', 'exchange_failed');

  var claims = oauth.idTokenClaims(res.body.id_token);
  if (!claims || claims.tid !== cfg.tenantId || claims.oid !== cfg.ceoOid) {
    await audit.appendAudit(deps.store, { run: 'connect', ok: false, error: 'wrong_account' });
    return redirect(context, cfg, 'error', 'wrong_account');
  }

  var nowIso = new Date(now).toISOString();
  await deps.store.set(tokenStore.TOKEN_KEY, tokenStore.connectionRecord(res.body, claims, cfg.tokenKey, nowIso));
  await audit.appendAudit(deps.store, { run: 'connect', ok: true });
  return redirect(context, cfg, 'ok');
}

async function handle(context, req, deps) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS, body: '' }; return; }
  var cfg = deps.cfg;
  var op = (req.params && req.params.op) || (req.query && req.query.op) || 'status';

  if (!isConfigured(cfg)) {
    if (op === 'callback') return redirect(context, cfg, 'error', 'not_configured');
    return json(context, 503, { error: 'Vale mail is not configured yet.', configured: false });
  }

  try {
    if (op === 'callback' && req.method === 'GET') return await handleCallback(context, req, deps);

    var gate = await deps.auth(req, context, { bearerOnly: true });
    if (!gate.ok) return json(context, 401, { error: 'Sign in with Microsoft first.', reason: gate.reason });
    // Connecting/disconnecting the mailbox is the Vale app's job only — a token minted for
    // another allowed client (Vale Mail) is refused here even though it is otherwise valid.
    if (!gate.claims || gate.claims.azp !== cfg.clientId) return json(context, 403, { error: 'Use the Vale Office page to connect mail.', reason: 'wrong_client' });

    if (op === 'status' && req.method === 'GET') {
      var tok = await deps.store.getWithMeta(tokenStore.TOKEN_KEY);
      if (tok.failed) return json(context, 503, { error: 'Could not read the connection — try again.' });
      var log = await deps.store.getWithMeta('valeBriefLog');
      var aud = await deps.store.getWithMeta(audit.AUDIT_KEY);
      return json(context, 200, {
        configured: true,
        connection: tokenStore.statusOf(tok.value),
        lastBrief: (log.value && log.value.lastSent) || null,
        recentRuns: Array.isArray(aud.value) ? aud.value.slice(-10).reverse() : []
      });
    }

    if (op === 'start' && req.method === 'GET') {
      var pkce = oauth.makePkce();
      var state = oauth.makeState();
      await deps.store.set(PENDING_KEY, { state: state, verifier: pkce.verifier, createdAt: new Date(deps.now()).toISOString() });
      return json(context, 200, { url: oauth.authorizeUrl(cfg, state, pkce.challenge) });
    }

    if (op === 'disconnect' && req.method === 'POST') {
      await deps.store.set(tokenStore.TOKEN_KEY, null);
      await audit.appendAudit(deps.store, { run: 'disconnect', ok: true });
      return json(context, 200, { ok: true, connection: { connected: false } });
    }

    if (op === 'test-brief' && req.method === 'POST') {
      var r = await deps.runTest();
      if (r.reason === 'disabled') return json(context, 409, { error: 'Mail is switched off.' });
      if (r.reason === 'too_soon') return json(context, 429, { error: 'One test brief every 3 minutes.' });
      if (!r.ran) return json(context, 503, { error: 'Could not start the test (' + r.reason + ').' });
      if (!r.sent) return json(context, 502, { ok: false, error: String(r.error || 'send failed').slice(0, 200) });
      return json(context, 200, { ok: true, subject: r.subject });
    }

    if (op === 'forget' && req.method === 'POST') {
      await deps.store.set('valeMailState', null);
      await deps.store.set('valeMailBriefs', null);
      await deps.store.set(audit.AUDIT_KEY, null);
      return json(context, 200, { ok: true });
    }

    return json(context, 404, { error: 'Unknown operation.' });
  } catch (e) {
    if (context.log && context.log.error) context.log.error('[vale-connect] ' + (e && e.message));
    return json(context, 500, { error: 'vale-connect fault' });
  }
}

function defaultDeps() {
  var vs = require('../_utils/valeStorage');
  var { requireCeoAsync } = require('../_utils/valeAuth');
  return {
    cfg: connectConfig(),
    auth: requireCeoAsync,
    store: { getWithMeta: vs.getValeWithMeta, mutate: vs.mutateVale, set: vs.setVale },
    fetch: (typeof fetch === 'function') ? fetch : require('node-fetch'),
    now: Date.now,
    // The CEO's "send me a test brief": the real run, outside the window, flagged as a test.
    runTest: function () {
      var bd = require('../_lib/vale/briefDeps');
      var d = bd.briefDeps(bd.briefConfig());
      d.test = true;
      return require('../_lib/vale/briefRun').runBrief(d);
    }
  };
}

module.exports = async function (context, req) { return handle(context, req, defaultDeps()); };
module.exports.handle = handle;
module.exports.connectConfig = connectConfig;
module.exports.isConfigured = isConfigured;
