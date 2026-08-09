const storage = require('../_utils/companyStorage');
const { AUTO_PUBLISH } = require('../_shared/socialPlatforms');

// The question this list answers: "did an executor publish this, so is there an
// execution outcome worth recording?" That is AUTO_PUBLISH by definition — the
// platforms an adapter can actually post to. Reddit is correctly absent: it is a
// manual outbox the CEO posts by hand, so no execution event exists to emit.
//
// This was a hand-written copy of the same five names until 2026-08-09. It happened
// to be correct, which is exactly why it was worth removing: the two silent channel
// drops that produced _shared/socialPlatforms.js were both a list that looked fine
// until a platform was added and one copy was missed. A stale copy HERE is the
// quietest failure of the set — the post publishes, the receipt is written, and only
// the funnel goes dark, so nothing looks broken while the numbers are wrong.
const SOCIAL_PLATFORMS = AUTO_PUBLISH;
const MAX_EVENTS = 10000;

function isSocialAction(action) {
  if (!action || typeof action !== 'object') return false;
  const type = action.type || action.action_type || '';
  if (type.indexOf('social_post') !== 0) return false;
  const platform = String(action.platform || '').toLowerCase();
  return SOCIAL_PLATFORMS.indexOf(platform) !== -1;
}

function _id() {
  return 'sm_evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function _statusFromError(err) {
  if (!err || typeof err !== 'object') return null;
  const raw = err.status || err.statusCode || err.httpStatus || null;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  const codeNum = Number(err.code);
  return Number.isFinite(codeNum) ? codeNum : null;
}

function mapErrorToTelemetry(err) {
  const status = _statusFromError(err);
  const code = err && err.code !== undefined && err.code !== null ? String(err.code) : (status ? String(status) : 'UNKNOWN_ERROR');
  const message = err && err.message ? String(err.message) : String(err || 'Unknown error');
  const lmsg = message.toLowerCase();
  const lcode = code.toLowerCase();

  let errorClass = 'UNKNOWN';

  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid\s*token|token\s*expired|auth/.test(lmsg) || /unauthorized|forbidden|auth/.test(lcode)) {
    errorClass = 'AUTH';
  } else if (status === 429 || /rate\s*limit|too\s*many\s*requests|throttle/.test(lmsg) || /rate|429/.test(lcode)) {
    errorClass = 'RATE_LIMIT';
  } else if (/media|image|video|upload|blob|mime|format|size|attachment/.test(lmsg) || /media|upload|blob/.test(lcode)) {
    errorClass = 'MEDIA';
  } else if (status === 400 || status === 422 || /validation|invalid|missing|required|too\s*long|bad\s*request|payload|malformed/.test(lmsg)) {
    errorClass = 'PAYLOAD';
  } else if (/timeout|timed\s*out|dns|network|socket|econn|enotfound|connection\s*reset/.test(lmsg) || /timeout|network|econn|enotfound/.test(lcode)) {
    errorClass = 'NETWORK';
  }

  return {
    error_class: errorClass,
    error_code: code,
    error_message: message
  };
}

function buildSocialTelemetryEvent(action, partial) {
  const nowIso = new Date().toISOString();
  const telemetry = action.telemetry || {};
  const event = {
    id: partial.id || _id(),
    action_id: action.id,
    trace_id: partial.trace_id || telemetry.trace_id || '',
    attempt: Number.isFinite(partial.attempt) ? partial.attempt : (Number.isFinite(telemetry.attempt) ? telemetry.attempt : 1),
    platform: String(action.platform || '').toLowerCase(),
    event_type: partial.event_type,
    result: partial.result || 'success',
    error_class: partial.error_class || 'UNKNOWN',
    error_code: partial.error_code || '',
    error_message: partial.error_message || '',
    created_at: partial.created_at || nowIso,
    executed_at: partial.executed_at || null,
    latency_ms: Number.isFinite(partial.latency_ms) ? partial.latency_ms : null,
    post_url: partial.post_url || '',
    agent_id: partial.agent_id || action.created_by || '',
    campaign_id: partial.campaign_id || action.campaign_id || action.campaignId || (action.payload && action.payload.campaign_id) || null,
    source_type: partial.source_type || action.source_type || (action.source && action.source.type) || null,
    source_id: partial.source_id || action.source_id || (action.source && action.source.id) || null
  };

  return event;
}

async function appendSocialMetricEvent(event) {
  const current = (await storage.getState('socialMetricsEvents')) || [];
  current.push(event);
  const trimmed = current.length > MAX_EVENTS ? current.slice(-MAX_EVENTS) : current;
  await storage.setState('socialMetricsEvents', trimmed);
}

module.exports = {
  isSocialAction,
  mapErrorToTelemetry,
  buildSocialTelemetryEvent,
  appendSocialMetricEvent
};
