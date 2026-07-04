// vale-state — CEO-only read/write for Vale's personal state, plus action-list ops.
// Auth: CEO email allowlist (valeAuth). Storage: isolated valeStorage (never company-state).
'use strict';

var { requireCeo } = require('../_utils/valeAuth');
var vs = require('../_utils/valeStorage');
var actions = require('../_utils/vale-actions');

var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ms-client-principal, x-ms-client-principal-id, x-user-id',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS, body: '' }; return; }

  var gate = requireCeo(req, context);
  if (!gate.ok) { context.res = { status: 403, headers: CORS, body: { error: 'CEO only.' } }; return; }

  try {
    if (req.method === 'GET') {
      var key = (req.query && req.query.key) || '';
      if (!vs.ALLOWED_KEYS[key]) { context.res = { status: 400, headers: CORS, body: { error: 'Invalid key.' } }; return; }
      var value = await vs.getVale(key);
      context.res = { status: 200, headers: CORS, body: { key: key, value: value } };
      return;
    }

    var body = req.body || {};
    var op = body.op || 'set';

    if (op === 'set') {
      if (!vs.ALLOWED_KEYS[body.key]) { context.res = { status: 400, headers: CORS, body: { error: 'Invalid key.' } }; return; }
      await vs.setVale(body.key, body.value);
      context.res = { status: 200, headers: CORS, body: { ok: true } };
      return;
    }

    if (op.indexOf('action.') === 0) {
      var list = (await vs.getVale('ceoActionList')) || [];
      if (op === 'action.add') list = actions.addAction(list, body.action || {}, Date.now());
      else if (op === 'action.complete') list = actions.completeAction(list, body.id);
      else if (op === 'action.update') list = actions.updateAction(list, body.id, body.patch || {});
      else if (op === 'action.remove') list = actions.removeAction(list, body.id);
      else { context.res = { status: 400, headers: CORS, body: { error: 'Unknown action op.' } }; return; }
      await vs.setVale('ceoActionList', list);
      context.res = { status: 200, headers: CORS, body: { ok: true, actionList: list } };
      return;
    }

    context.res = { status: 400, headers: CORS, body: { error: 'Unknown op.' } };
  } catch (e) {
    context.log.error('[vale-state] ' + (e && e.message));
    context.res = { status: 500, headers: CORS, body: { error: 'vale-state fault', details: e && e.message } };
  }
};
