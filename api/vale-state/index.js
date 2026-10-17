// vale-state — CEO-only read/write for Vale's personal state, plus action-list and mail
// rules ops. Auth: requireCeoAsync (verified Microsoft bearer token; the legacy principal
// only for 'gate' keys while VALE_STRICT_AUTH is off). Storage: isolated valeStorage
// (never company-state). What each key exposes is decided by valeStorage.accessFor.
'use strict';

var { requireCeoAsync } = require('../_utils/valeAuth');
var vs = require('../_utils/valeStorage');
var actions = require('../_utils/vale-actions');

var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ms-client-principal, x-ms-client-principal-id, x-user-id',
  'Content-Type': 'application/json'
};

var RULE_LISTS = ['vips', 'muted', 'receipts', 'rulesOnlyDomains'];
var MAX_LIST = 200;
var MAX_STR = 200;

function _strList(v) {
  if (!Array.isArray(v) || v.length > MAX_LIST) return null;
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'string') return null;
    var s = v[i].trim().toLowerCase();
    if (!s || s.length > MAX_STR) return null;
    if (out.indexOf(s) === -1) out.push(s);
  }
  return out;
}

// Validates a CEO-submitted rules object. Returns the clean object or null.
function cleanRules(r) {
  if (!r || typeof r !== 'object') return null;
  var out = {};
  for (var i = 0; i < RULE_LISTS.length; i++) {
    var name = RULE_LISTS[i];
    var list = _strList(r[name] || []);
    if (!list) return null;
    out[name] = list;
  }
  var projects = r.projects || {};
  if (typeof projects !== 'object' || Array.isArray(projects)) return null;
  out.projects = {};
  var names = Object.keys(projects);
  if (names.length > 20) return null;
  for (var j = 0; j < names.length; j++) {
    var p = projects[names[j]] || {};
    var domains = _strList(p.domains || []);
    var keywords = _strList(p.keywords || []);
    if (!domains || !keywords || names[j].length > 40) return null;
    out.projects[names[j]] = { domains: domains, keywords: keywords };
  }
  return out;
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') { context.res = { status: 204, headers: CORS, body: '' }; return; }

  var gate = await requireCeoAsync(req, context);
  if (!gate.ok) { context.res = { status: 403, headers: CORS, body: { error: 'CEO only.', reason: gate.reason } }; return; }

  try {
    if (req.method === 'GET') {
      var key = (req.query && req.query.key) || '';
      if (vs.accessFor(key, 'read', gate.via) !== 'allow') { context.res = { status: 400, headers: CORS, body: { error: 'Invalid key.' } }; return; }
      var value = await vs.getVale(key);
      context.res = { status: 200, headers: CORS, body: { key: key, value: value } };
      return;
    }

    var body = req.body || {};
    var op = body.op || 'set';

    if (op === 'set') {
      if (vs.accessFor(body.key, 'write', gate.via) !== 'allow') { context.res = { status: 400, headers: CORS, body: { error: 'Invalid key.' } }; return; }
      await vs.setVale(body.key, body.value);
      context.res = { status: 200, headers: CORS, body: { ok: true } };
      return;
    }

    if (op === 'rules.get' || op === 'rules.set') {
      if (gate.via !== 'bearer') { context.res = { status: 403, headers: CORS, body: { error: 'Sign in with Microsoft to manage mail rules.' } }; return; }
      if (op === 'rules.get') {
        var meta = await vs.getValeWithMeta('valeMailRules');
        if (meta.failed) { context.res = { status: 503, headers: CORS, body: { error: 'Could not read rules — try again.' } }; return; }
        context.res = { status: 200, headers: CORS, body: { rules: meta.value || null } };
        return;
      }
      var clean = cleanRules(body.rules);
      if (!clean) { context.res = { status: 400, headers: CORS, body: { error: 'Invalid rules.' } }; return; }
      await vs.setVale('valeMailRules', Object.assign(clean, { updatedAt: new Date().toISOString(), updatedBy: 'ceo' }));
      context.res = { status: 200, headers: CORS, body: { ok: true, rules: clean } };
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

module.exports.cleanRules = cleanRules;
