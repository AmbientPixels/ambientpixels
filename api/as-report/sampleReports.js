// Sample report allowlist. Ids listed here bypass the paywall and render fully.
// Refresh procedure: re-scan the demo page (lab/oakroute.html), then replace
// the id below AND the id baked into ambientscore/index.html's hero mini-card.
// See docs/superpowers/specs/2026-07-10-ambientscore-sample-audit-design.md
const SAMPLE_REPORT_IDS = new Set([
  'ccr_1783742989787_e4366317'
]);

// Comped reports: given away deliberately (a prospect, a partner, a favour).
// Separate from samples on purpose — a sample renders a "Sample audit" banner
// and a "scan your own site" CTA, which is exactly wrong on a report handed to
// the person whose site it is. Comped reports unlock silently and read as a
// normal paid report.
const COMP_REPORT_IDS = new Set([
  'ccr_1786049018467_22a38d5a'
]);

function isSample(id) {
  return SAMPLE_REPORT_IDS.has(id);
}

function isComped(id) {
  return COMP_REPORT_IDS.has(id);
}

// A report is fully viewable if it was paid for, is an allowlisted sample, or
// has been comped.
function isFullyViewable(report, id) {
  return !!(report && report.unlocked) || isSample(id) || isComped(id);
}

// Builds the response body. Samples get unlocked + isSample so the viewer can
// badge them; comped reports get unlocked only, so they read as a normal report.
// Never mutates input.
function buildFullBody(report, id) {
  if (isSample(id)) return Object.assign({}, report, { unlocked: true, isSample: true });
  if (isComped(id)) return Object.assign({}, report, { unlocked: true });
  return report;
}

module.exports = { SAMPLE_REPORT_IDS, COMP_REPORT_IDS, isSample, isComped, isFullyViewable, buildFullBody };
