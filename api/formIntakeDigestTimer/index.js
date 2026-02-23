/**
 * CHANGE SUMMARY
 * - New file: Timer trigger for Form Intake Daily Digest v1.4
 * - Runs daily at 9:00 AM PT (17:00 UTC)
 * - Calls shared digest logic from formIntakeDigest
 * - Date = yesterday, force = false (idempotent, skips if already generated)
 */

const digest = require('../formIntakeDigest');

module.exports = async function (context) {
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var dateStr = yesterday.toISOString().substring(0, 10);

  context.log('[formIntakeDigestTimer] Timer fired — generating digest for:', dateStr);

  try {
    // Idempotency: skip if digest already exists for this date
    var existingTaskId = await digest._digestTaskExists(dateStr);
    if (existingTaskId) {
      context.log('[formIntakeDigestTimer] Digest already exists for', dateStr, '— taskId:', existingTaskId, '— skipping.');
      return;
    }

    // Read daily index
    var entries = await digest._readIndex(dateStr);

    // Build digest
    var digestResult = await digest._buildDigest(dateStr, entries);

    // Create Nova task
    var taskId = await digest._createDigestTask(digestResult);

    // Upsert L4 runtime memory
    var memKey = await digest._appendRuntimeMemory(digestResult);

    context.log('[formIntakeDigestTimer] Done — date:', dateStr,
      'total:', digestResult.stats.total,
      'taskId:', taskId || 'failed',
      'memKey:', memKey || 'failed');

  } catch (err) {
    context.log.error('[formIntakeDigestTimer] Error:', err.message, err.stack);
  }
};
