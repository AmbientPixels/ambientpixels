// valeMorningBrief — Vale's 06:30 Pacific email brief. Fires at 13:30, 14:30 and 15:30 UTC;
// briefRun decides (DST-correct, once per Pacific date, catch-up until 09:00). Dormant until
// VALE_STRICT_AUTH=1 and VALE_MAIL_ENABLED=1 — runBrief returns before any I/O otherwise.
'use strict';

var { runBrief } = require('../_lib/vale/briefRun');
var { valeConfig } = require('../_utils/valeAuth');
var connect = require('../vale-connect/index');

async function notifyDiscord(text) {
  var url = process.env.DISCORD_VALE_WEBHOOK;
  if (!url) return false;
  var f = (typeof fetch === 'function') ? fetch : require('node-fetch');
  var r = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Vale — Office of the CEO', content: String(text).slice(0, 500) }) });
  return r.ok || r.status === 204;
}

module.exports = async function (context) {
  var cfg = Object.assign({}, connect.connectConfig(), valeConfig(), {
    ceoAddress: process.env.VALE_CEO_UPN || 'chad@ambientpixels.ai',
    senderAddress: process.env.VALE_SENDER || 'vale@ambientpixels.ai'
  });
  if (!cfg.strict || !cfg.mailEnabled) return; // dormant: no storage, no network

  var vs = require('../_utils/valeStorage');
  var { callModel } = require('../_lib/llm');
  var mailer = require('../_lib/vale/mailer');
  var fetchImpl = (typeof fetch === 'function') ? fetch : require('node-fetch');
  try {
    var result = await runBrief({
      cfg: cfg,
      now: Date.now,
      store: { getWithMeta: vs.getValeWithMeta, mutate: vs.mutateVale, set: vs.setVale },
      fetch: fetchImpl,
      callModel: callModel,
      sendBrief: function (msg) { return mailer.sendBrief({ cfg: cfg, fetch: fetchImpl }, msg); },
      seedRules: require('../_data/vale-mail-rules.seed.json'),
      notify: notifyDiscord
    });
    context.log('[valeMorningBrief] ' + JSON.stringify(result));
  } catch (e) {
    context.log.error('[valeMorningBrief] ' + (e && e.message));
  }
};
