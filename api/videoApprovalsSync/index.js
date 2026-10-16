// videoApprovalsSync — Timer Trigger (every 15 minutes). Keeps the CEO approvals queue in line with the video
// requests on the company board: a waiting request or an open script/cut checkpoint gets one pending item; an
// item decided on the board instead is resolved; an item a queue cap dropped comes back. Reads `tasks`, writes only
// `approvalQueue` (conditional write, so it is safe beside the heartbeat). Core: _lib/videoApprovals.js.

const storage = require('../_utils/companyStorage');
const demoGuard = require('../_utils/demoGuard');
const { syncQueue } = require('../_lib/videoApprovals');

module.exports = async function (context) {
  if (demoGuard.timerSkip(context)) return;
  try {
    const tasksRead = await storage.getStateWithMeta('tasks');
    if (tasksRead.failed || !Array.isArray(tasksRead.value)) {
      context.log('[videoApprovalsSync] the task board could not be read; nothing changed');
      return;
    }
    const now = new Date().toISOString();
    const cfg = (await storage.getState('systemConfig')) || {};
    const autoPublish = !!(cfg.youtube && cfg.youtube.audited === true);
    let changed = false;
    await storage.mutateState('approvalQueue', function (fresh) {
      const res = syncQueue(Array.isArray(fresh) ? fresh : [], tasksRead.value, now, { autoPublish: autoPublish });
      changed = res.changed;
      return res.changed ? res.queue : undefined;
    });
    context.log('[videoApprovalsSync]', changed ? 'queue updated' : 'in line');
  } catch (err) {
    context.log.error('[videoApprovalsSync] failed:', (err && err.message) || err);
  }
};
