// agenticMeetingCron — daily timer. Runs ONLY when the autonomy switch is on
// (systemConfig.agenticMeetings.enabled). Convenes on the weekly council day (Monday),
// or on any day a signal fires (deduped). Respects maxPerWeek.
const storage = require('../_utils/companyStorage');
const { runAgenticMeeting, detectMeetingSignals } = require('../companyMeeting/meeting-core');

function _meetingsThisWeek(list, nowMs) {
  const weekAgo = nowMs - 7 * 86400000;
  return (list || []).filter(function (m) { return m.convened && (Date.parse(m.createdAt || '') || 0) >= weekAgo; }).length;
}

module.exports = async function (context) {
  const demoGuard = require('../_utils/demoGuard');
  if (demoGuard.timerSkip(context)) return;
  try {
    const cfg = (await storage.getState('systemConfig')) || {};
    const am = cfg.agenticMeetings || {};
    if (!am.enabled) { context.log('[agenticMeetingCron] disabled — skipping'); return; }

    const nowMs = Date.now();
    const meetings = (await storage.getState('agenticMeetings')) || [];
    const cap = Number.isFinite(am.maxPerWeek) ? am.maxPerWeek : 2;
    if (_meetingsThisWeek(meetings, nowMs) >= cap) { context.log('[agenticMeetingCron] weekly cap reached — skipping'); return; }

    const isCouncilDay = new Date(nowMs).getUTCDay() === 1; // Monday
    let trigger = null;
    if (isCouncilDay) {
      trigger = 'cron-weekly';
    } else if (am.signalsEnabled !== false) {
      const objectives = (await storage.getState('objectives')) || [];
      const activeCount = objectives.filter(function (o) { return o.status === 'active'; }).length;
      const finishedRecently = objectives.some(function (o) {
        return (o.status === 'complete' || o.status === 'archived') && (Date.parse(o.archivedAt || o.completedAt || '') || 0) >= (nowMs - 7 * 86400000);
      });
      const signals = detectMeetingSignals({ activeObjectiveCount: activeCount, finishedRecently: finishedRecently, researchSignalCount: 0 }, nowMs, meetings);
      if (signals.length) trigger = 'signal:' + signals[0].type;
    }

    if (!trigger) { context.log('[agenticMeetingCron] nothing to convene today'); return; }
    const rec = await runAgenticMeeting({ storage: storage, nowMs: nowMs, trigger: trigger, log: function () { context.log.apply(context, arguments); } });
    context.log('[agenticMeetingCron] complete:', JSON.stringify({ trigger: trigger, convened: rec.convened, id: rec.id }));
  } catch (err) {
    context.log.error && context.log.error('[agenticMeetingCron] failed:', err && err.message);
  }
};
