// valeMorningBrief — Vale's 06:30 Pacific email brief. Fires at 13:30, 14:30 and 15:30 UTC;
// briefRun decides (DST-correct, once per Pacific date, catch-up until 09:00). Dormant until
// VALE_STRICT_AUTH=1 and VALE_MAIL_ENABLED=1 — runBrief returns before any I/O otherwise.
'use strict';

var { runBrief } = require('../_lib/vale/briefRun');
var { briefConfig, briefDeps } = require('../_lib/vale/briefDeps');

module.exports = async function (context) {
  var cfg = briefConfig();
  if (!cfg.strict || !cfg.mailEnabled) return; // dormant: no storage, no network
  try {
    var result = await runBrief(briefDeps(cfg));
    context.log('[valeMorningBrief] ' + JSON.stringify(result));
  } catch (e) {
    context.log.error('[valeMorningBrief] ' + (e && e.message));
  }
};
