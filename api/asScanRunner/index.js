// asScanRunner — every 10 min. Executes queued agent-requested AmbientScore
// scans (run-ambientscore-scan action → asScanQueue) out-of-band so a 20-60s
// scan never stretches a heartbeat cycle. Results land as a system comment on
// the originating task: score, grade, top findings, shareable report link.
//
// Cost control: max 2 scans per run, systemConfig.ambientScoreScans.dailyCap
// (default 8) per calendar day. In-process analyze() call — the public HTTP
// rate limit (5/hr/IP) does not apply here.

const crypto = require('crypto');
const storage = require('../_utils/companyStorage');

const DEFAULT_DAILY_CAP = 8;
const MAX_PER_RUN = 2;
const QUEUE_RETAIN = 100;

module.exports = async function (context) {
  try {
    const queue = (await storage.getState('asScanQueue')) || [];
    const pending = queue.filter(q => q && q.status === 'queued');
    if (pending.length === 0) return;

    const cfg = (await storage.getState('systemConfig')) || {};
    const dailyCap = (cfg.ambientScoreScans && Number(cfg.ambientScoreScans.dailyCap)) || DEFAULT_DAILY_CAP;
    const today = new Date().toISOString().substring(0, 10);
    const doneToday = queue.filter(q =>
      q && (q.status === 'done' || q.status === 'failed') &&
      q.finishedAt && q.finishedAt.substring(0, 10) === today
    ).length;
    const budget = Math.max(0, dailyCap - doneToday);
    if (budget === 0) {
      context.log('[asScanRunner] Daily cap reached (' + dailyCap + ') — ' + pending.length + ' scan(s) wait for tomorrow');
      return;
    }

    const batch = pending.slice(0, Math.min(MAX_PER_RUN, budget));
    context.log('[asScanRunner] Running ' + batch.length + ' scan(s), ' + (pending.length - batch.length) + ' remain queued');

    for (const job of batch) {
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      await storage.setState('asScanQueue', queue.slice(-QUEUE_RETAIN));

      try {
        const { analyze } = require('../_lib/ambientScore/analyzer');
        const reportId = 'ccr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
        const result = await analyze(job.url);
        result.fullReport.id = reportId;
        await storage.setState('cc_report_' + reportId, result.fullReport);

        // Mirror as-analyze's scan analytics so agent scans show in the funnel.
        try {
          const analytics = (await storage.getState('cc_analytics')) || [];
          analytics.push({
            reportId: reportId,
            url: job.url,
            tier: 'agent',
            requestedBy: job.requestedBy || null,
            score: result.score,
            timestamp: new Date().toISOString()
          });
          await storage.setState('cc_analytics', analytics.slice(-10000));
        } catch (aErr) { context.log.warn('[asScanRunner] Analytics log failed:', aErr.message); }

        job.status = 'done';
        job.finishedAt = new Date().toISOString();
        job.reportId = reportId;
        job.score = result.score;

        await _commentOnTask(job.taskId,
          '[SCAN RESULT] AmbientScore audit of ' + job.url + ': score ' + result.score + '/100, grade ' + result.grade + '. ' +
          'Top findings: ' + (result.teaserFindings || []).slice(0, 2).map(f => f.finding).join(' | ') + ' ' +
          'Shareable free report (score + top findings visible, rest paywalled): https://ambientpixels.ai/ambientscore/report.html?id=' + reportId + ' ' +
          'Use 1-2 specific findings in your reply or post — specifics earn the click, the report link earns the $29.'
        );
        context.log('[asScanRunner] Scan done:', job.url, 'score', result.score, 'report', reportId);
      } catch (err) {
        job.status = 'failed';
        job.finishedAt = new Date().toISOString();
        job.error = String((err && err.message) || err).substring(0, 200);
        await _commentOnTask(job.taskId,
          '[SCAN FAILED] AmbientScore audit of ' + job.url + ' failed: ' + job.error + '. ' +
          (job.error.indexOf('SITE_BLOCKED') !== -1
            ? 'The site blocks automated scans — write the reply without audit findings, or pick another prospect.'
            : 'You can re-request the scan next cycle if the site seemed reachable.')
        );
        context.log.warn('[asScanRunner] Scan failed:', job.url, job.error);
      }
      await storage.setState('asScanQueue', queue.slice(-QUEUE_RETAIN));
    }
  } catch (fatal) {
    context.log.error('[asScanRunner] Fatal:', fatal.message);
  }

  async function _commentOnTask(taskId, text) {
    if (!taskId) return;
    try {
      const tasks = (await storage.getState('tasks')) || [];
      const t = tasks.find(x => x && x.id === taskId);
      if (!t) { context.log.warn('[asScanRunner] Task not found for comment:', taskId); return; }
      t.comments = t.comments || [];
      t.comments.push({
        author: 'system',
        text: text,
        timestamp: new Date().toISOString()
      });
      await storage.setState('tasks', tasks);
    } catch (cErr) {
      context.log.warn('[asScanRunner] Task comment failed:', cErr.message);
    }
  }
};
