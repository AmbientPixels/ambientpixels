// emergenceCheckCron — Daily 16:00 UTC emergence monitoring run (System 15).
//
// Pure observation layer. Loads upstream state + previous digest, computes new
// digest via buildEmergenceDigest, persists to state, appends NEW signals (not
// repeats) to governanceLog.
//
// Never mutates: agentRegistry, tasks, capitalAllocation, approvalQueue,
// runtimeMemory. Only writes emergenceDigest + governanceLog.
//
// Failure mode: if cron errors out, next day's cron runs cleanly — nothing in
// the main heartbeat depends on cron success. Stale digest (>26h) is gracefully
// ignored by the heartbeat's runtime cache check.

const storage = require('../_utils/companyStorage');
const { buildEmergenceDigest } = require('../companyHeartbeat/emergence-intel');

const MAX_GOVERNANCE_LOG = 500;

function _signalKey(s) {
  return (s.signalType || '') + '|' + (s.subject || '') + '|' + (s.level || '');
}

module.exports = async function (context, timer) {
  const startMs = Date.now();
  context.log('[emergenceCheckCron] Starting daily emergence scan');

  try {
    const [approvalQueue, governanceLog, capitalAllocation, agentRegistry, heartbeatRuns, prevDigest] = await Promise.all([
      storage.getState('approvalQueue').then(v => v || []),
      storage.getState('governanceLog').then(v => v || []),
      storage.getState('capitalAllocation').then(v => v || {}),
      storage.getState('agentRegistry').then(v => v || { agents: [] }),
      storage.getState('heartbeatRuns').then(v => v || []),
      storage.getState('emergenceDigest').then(v => v || null)
    ]);

    const digest = buildEmergenceDigest({
      approvalQueue: approvalQueue,
      governanceLog: governanceLog,
      capitalAllocation: capitalAllocation,
      agentRegistry: agentRegistry,
      heartbeatRuns: heartbeatRuns,
      prevDigest: prevDigest
    }, startMs);

    // Persist digest
    await storage.setState('emergenceDigest', digest);

    // Append NEW signals to governance log (dedup by signalType + subject + level).
    // Same signal repeating day-over-day = no new log entry. YELLOW→RED upgrade IS new.
    const prevSignalKeys = new Set(
      (prevDigest && Array.isArray(prevDigest.signals) ? prevDigest.signals : [])
        .map(_signalKey)
    );
    const newSignals = digest.signals.filter(s => !prevSignalKeys.has(_signalKey(s)));

    if (newSignals.length > 0) {
      const gov = Array.isArray(governanceLog) ? governanceLog.slice() : [];
      newSignals.forEach(s => {
        gov.push({
          at: s.at,
          type: 'emergence-signal',
          level: s.level,
          signalType: s.signalType,
          subject: s.subject,
          signal: s.signal,
          recommendation: s.recommendation,
          digestRunAt: digest.generatedAt
        });
      });
      const trimmed = gov.slice(-MAX_GOVERNANCE_LOG);
      await storage.setState('governanceLog', trimmed);
      context.log('[emergenceCheckCron] Appended', newSignals.length, 'new emergence-signal events to governanceLog');
    }

    const durationMs = Date.now() - startMs;
    context.log('[emergenceCheckCron] Complete. Signals:', digest.signals.length, '| New:', newSignals.length, '| Duration:', durationMs, 'ms');
    return { ok: true, signalCount: digest.signals.length, newSignalCount: newSignals.length, durationMs: durationMs };
  } catch (err) {
    context.log.error && context.log.error('[emergenceCheckCron] Fatal:', err.message, err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : '');
    return { ok: false, error: err.message };
  }
};
