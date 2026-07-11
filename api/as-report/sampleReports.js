// Sample report allowlist. Ids listed here bypass the paywall and render fully.
// Refresh procedure: re-scan the demo page (lab/oakroute.html), then replace
// the id below AND the id baked into ambientscore/index.html's hero mini-card.
// See docs/superpowers/specs/2026-07-10-ambientscore-sample-audit-design.md
const SAMPLE_REPORT_IDS = new Set([
  'ccr_1783739908752_0ead8aed'
]);

function isSample(id) {
  return SAMPLE_REPORT_IDS.has(id);
}

// A report is fully viewable if it was unlocked (paid) or it is an allowlisted sample.
function isFullyViewable(report, id) {
  return !!(report && report.unlocked) || isSample(id);
}

module.exports = { SAMPLE_REPORT_IDS, isSample, isFullyViewable };
