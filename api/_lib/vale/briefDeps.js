// briefDeps.js — the real dependencies for a brief run, shared by the 06:30 timer
// (valeMorningBrief) and the CEO's "send me a test brief" button (vale-connect).
'use strict';

function fetchImpl() { return (typeof fetch === 'function') ? fetch : require('node-fetch'); }

async function notifyDiscord(text) {
  var url = process.env.DISCORD_VALE_WEBHOOK;
  if (!url) return false;
  var r = await fetchImpl()(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Vale — Office of the CEO', content: String(text).slice(0, 500) }) });
  return r.ok || r.status === 204;
}

function briefConfig() {
  var { valeConfig } = require('../../_utils/valeAuth');
  var connect = require('../../vale-connect/index');
  return Object.assign({}, connect.connectConfig(), valeConfig(), {
    ceoAddress: process.env.VALE_CEO_UPN || 'chad@ambientpixels.ai',
    senderAddress: process.env.VALE_SENDER || 'vale@ambientpixels.ai'
  });
}

function briefDeps(cfg) {
  var vs = require('../../_utils/valeStorage');
  var { callModel } = require('../llm');
  var mailer = require('./mailer');
  var f = fetchImpl();
  return {
    cfg: cfg,
    now: Date.now,
    store: { getWithMeta: vs.getValeWithMeta, mutate: vs.mutateVale, set: vs.setVale },
    fetch: f,
    callModel: callModel,
    sendBrief: function (msg) { return mailer.sendBrief({ cfg: cfg, fetch: f }, msg); },
    seedRules: require('../../_data/vale-mail-rules.seed.json'),
    notify: notifyDiscord
  };
}

module.exports = { briefConfig: briefConfig, briefDeps: briefDeps };
