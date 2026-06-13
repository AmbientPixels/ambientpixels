// test-quality-gate-leaks.cjs — deterministic regression tests for the social-copy
// deliverable-scaffold leak (act_1781321373557_d2qwsh, 2026-06-13).
//
// A blog-promo Scribe deliverable wrapped its post in "# DELIVERABLE: X SOCIAL COPY /
// **Status:** Ready for Quill review / ## PUBLISH-READY COPY / ## COPY SPEC" scaffolding.
// The copy-propagation step set reviewed_copy to the WHOLE wrapper, auto-post used it
// verbatim, and the QG meta-leak detector returned metaLeak:false — so a malformed post
// reached the approval queue (and would have grace-published in autonomous mode).
//
// Three layers, each tested here (all pure functions, no API key):
//   L1  helpers.extractPublishReadyCopy      — propagate only the publishable copy
//   L2  QG.detectContentLeaks(...).metaLeak  — flag the scaffold at the gate
//   L3  QG.looksLikeDocScaffold              — structural backstop for grace auto-publish
//
// Run: node scripts/test-quality-gate-leaks.cjs   (exit 0 = all pass)

const path = require('path');
const QG = require(path.join(__dirname, '..', 'api', 'companyHeartbeat', 'quality-gate.js'));
const HELPERS = require(path.join(__dirname, '..', 'api', 'companyHeartbeat', 'helpers.js'));

// ── fixtures ────────────────────────────────────────────────────────────────
// The clean copy Scribe actually wrote (buried under ## PUBLISH-READY COPY).
const CLEAN_COPY =
  "one human, eight ai agents, infinite possibilities. how ambientos orchestrates a " +
  "whole company in 60 minutes. read what's actually happening under the hood: " +
  "https://ambientpixels.ai/blog/an-hour-inside-ambientos-how-eight-ai-agents-run-a-one-human-company";

// The full deliverable comment as Scribe wrote it (what reviewed_copy was set to).
const SCAFFOLD_DELIVERABLE = [
  "# DELIVERABLE: X SOCIAL COPY",
  "**Task:** Social media post for blog \"An Hour Inside AmbientOS\"  ",
  "**Platform:** X  ",
  "**Status:** Ready for Quill review  ",
  "**Date:** 2026-06-13",
  "",
  "---",
  "",
  "## PUBLISH-READY COPY",
  "",
  CLEAN_COPY,
  "",
  "---",
  "",
  "## COPY SPEC",
  "",
  "**Character count:** 278 / 280  ",
  "**Brand voice:** Lowercase casual, founder authentic, no hype  ",
  "",
  "## NOTES",
  "",
  "- URL included as required  ",
  "- Ready to pass to Quill for brand voice review  "
].join("\n");

// The flattened text that actually became the action payload (auto-post collapsed it).
const SCAFFOLD_ACTION_TEXT = [
  "# DELIVERABLE: X SOCIAL COPY",
  "Task: Social media post for blog \"An Hour Inside AmbientOS\" Platform: X Status: Ready for Quill review",
  "https://ambientpixels.ai/blog/an-hour-inside-ambientos-how-eight-ai-agents-run-a-one-human-company?utm_source=x&utm_content=act_1781321373557_d2qwsh"
].join("\n");

// A normal clean tweet — must NOT trip any guard (false-positive control).
const CONTROL_TWEET =
  "shipped a thing today. blindspot now drops you into a fight with a stranger the " +
  "second you load in. no menus, no tutorial. https://ambientpixels.ai/blindspot";

// ── tiny assert harness ───────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, fn) {
  let ok = false, detail = '';
  try { const r = fn(); ok = r === true; if (!ok) detail = String(r); }
  catch (e) { ok = false; detail = 'threw: ' + (e && e.message ? e.message : e); }
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}

console.log('\n== social-copy scaffold leak regression ==');

// L2 — the gate flags the scaffold (both the full deliverable and the flattened post text)
check('L2 detectContentLeaks flags metaLeak on flattened action text', () =>
  QG.detectContentLeaks(SCAFFOLD_ACTION_TEXT, 'x').metaLeak === true);
check('L2 detectContentLeaks flags metaLeak on full deliverable', () =>
  QG.detectContentLeaks(SCAFFOLD_DELIVERABLE, 'x').metaLeak === true);
check('L2 control tweet is NOT flagged metaLeak', () =>
  QG.detectContentLeaks(CONTROL_TWEET, 'x').metaLeak === false);

// L3 — structural backstop independent of the pattern list
check('L3 looksLikeDocScaffold true for scaffold action text', () =>
  QG.looksLikeDocScaffold(SCAFFOLD_ACTION_TEXT) === true);
check('L3 looksLikeDocScaffold false for clean copy', () =>
  QG.looksLikeDocScaffold(CLEAN_COPY) === false);
check('L3 looksLikeDocScaffold false for control tweet', () =>
  QG.looksLikeDocScaffold(CONTROL_TWEET) === false);

// L1 — extraction propagates ONLY the publishable copy
check('L1 extractPublishReadyCopy pulls the clean line out of the scaffold', () =>
  HELPERS.extractPublishReadyCopy(SCAFFOLD_DELIVERABLE) === CLEAN_COPY);
check('L1 extractPublishReadyCopy leaves an already-clean tweet unchanged', () =>
  HELPERS.extractPublishReadyCopy(CONTROL_TWEET) === CONTROL_TWEET);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail === 0 ? 0 : 1);
