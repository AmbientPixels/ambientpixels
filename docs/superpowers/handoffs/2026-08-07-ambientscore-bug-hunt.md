# Handoff — hunt AmbientScore for silent-degradation bugs

**Written 2026-08-07 after two bugs in one day, both of which nearly reached a real client.**
**Goal: find the rest of them before a customer does.**

---

## Why this exists

AmbientScore is the product closest to taking money from strangers, and in a single day of ordinary use it produced two separate client-facing failures. Neither threw. Neither was visible. Both made the product **assert things that were not true**, confidently, in a document a customer pays for.

**Bug 1 — reports shipped with no rewrites.** Synthesis exceeded `max_tokens=3000`, the JSON truncated, the catch fell back to a hardcoded template with `headlineRewrites: []`. The product sells "full report with rewrites." Fixed: budget 8000, retry at 16000, `degraded: true`, viewer notice. See `2026-08-06-ambientscore-synthesis-failure.md`.

**Bug 2 — the audit called a healthy site broken.** The scraper has no JS runtime, so a stat block that animates `0 %` up to 95/90/98 was read as literal zeroes. That produced **four confidently wrong critical findings** across four dimensions, one calling it "the single most urgent technical fix on the page." Correcting it moved the score **28 → 54**. Fixed by hydrating counter values from `data-*` before text extraction.

**The shared shape, and what to hunt:**

> A stage fails or returns nothing. The code catches it, substitutes something plausible, and continues. The output is presented to a paying customer with full confidence and no indication that any of it is a guess.

Grep-level heuristic: every `catch` that does not rethrow, every `|| defaultValue` on a value that came from a model, every fallback constant. Ask of each one: *if this fires, does the customer find out?*

## Confirmed lead — start here

**Up to 55% of a score can be fabricated, disclosed only as an asterisk.**

`analyzer.js` runs two evaluation groups in parallel, 4 dimensions each. If **both** fail it throws (good). If **one** fails, it pushes to `errors[]` and carries on:

```js
} catch (err) {
  errors.push('Group ' + groupId + ' evaluation failed: ' + err.message);
  return { groupId, status: 'failed', error: err.message };
}
...
if (failedGroups >= 2) { throw ... }   // one failure is allowed through
```

`scorer.js:68` then fills every missing dimension with an invented number:

```js
if (!evalResult || !evalResult.scores) {
  // Missing evaluation — use default mid-range (raw 5 → 60 → D)
  dimensionResults[dimId] = { ..., score: 60, grade: 'D', partial: true };
  totalWeightedScore += 5 * weight;
```

Group A is the conversion funnel and carries **55% of the weight**. If it fails, more than half the customer's score is a constant, and the report reads as a completed audit. The only disclosure is a bare `*` appended to the dimension label in `report.js:439` — no legend, no tooltip, no explanation anywhere.

**What to do:** decide whether a half-fabricated report should ship at all. Options, roughly in order of honesty: refuse and refund/retry; ship with the same `degraded` treatment the synthesis fix now uses; or at minimum explain the asterisk. Also consider retrying a failed group once, as the synthesis fix does, since a single transient API error currently costs half the analysis.

## Other suspects, unverified

Worth probing, roughly in order of client-facing harm:

1. **More JS-blind extraction.** The counter fix handles `data-*` counters only. The same blindness applies to lazy-loaded images, tabbed and accordion content, testimonials in carousels, and anything behind `content-visibility`. Hanson's report already flagged testimonials as "may be invisible" for this reason. **Any finding that says an element is missing may just mean JS renders it.**
2. **Unlock does not verify the session belongs to the report.** `as-analyze/index.js:88` trusts `payment.metadata.reportId` without checking it matches what was requested. The codex flagged this in June and it appears unaddressed. Probe whether one paid session can unlock a different report.
3. **Refund and dispute handling does not exist** on any AmbientScore webhook. A charged-back customer keeps access.
4. **Failed webhook leaves a paid-but-locked report** with no retry queue. Someone pays and gets nothing, silently.
5. **Free-scan rate limiting is IP-only** (5/hour). Trivial to bypass; each scan costs real Claude spend.
6. **Classification failure is silent.** `analyzer.js:130` catches and falls back to `direct_response_saas`, which selects a whole different weight profile. An agency site scored on SaaS weights gets a materially different number, and nothing says so.
7. **`hydratedCounters`** is returned by the scraper but arrives `undefined` on the assembled report — analyzer does not pass it through. Cosmetic, but it means one signal is being dropped in transit; check whether other scraper fields vanish the same way.

## How to investigate

**Read stored reports directly.** `cc_report_*` is not a `company-state` VALID_KEY, so use blob:

```js
// az functionapp config appsettings list --name ambientpixels-nova-api \
//   --resource-group ambientpixelsV2 --query "[?name=='AZURE_STORAGE_CONNECTION_STRING'].value" -o tsv
const { BlobServiceClient } = require('@azure/storage-blob');
const c = BlobServiceClient.fromConnectionString(CS).getContainerClient('company-state');
const r = JSON.parse((await c.getBlockBlobClient('cc_report_<id>.json').downloadToBuffer()).toString());
```

**Survey the whole corpus — this is the highest-yield move.** List every `cc_report_*` blob and count: how many have a non-empty `errors[]`, how many have any dimension with `partial: true`, how many have empty rewrite arrays, how many carry a `jsRenderedWarning`. That converts "are there more bugs" from a guess into a measurement, and tells you how many real customers were affected.

**Run the analyzer locally** rather than through the endpoint — faster, and you see the unwrapped result:

```js
process.env.ANTHROPIC_API_KEY = '<from app settings>';
const { analyze } = require('./api/_lib/ambientScore/analyzer.js');
const wrapped = await analyze('https://example.com/');
const report = wrapped.fullReport;   // NOTE: analyze() returns a WRAPPER
```

That wrapper caught me twice. Top level has `{score, grade, teaserFindings, totalFindings, fullReport}`; findings, dimensions and synthesis live inside `fullReport`.

**Test against sites that break assumptions**, not just clean ones: a heavy SPA, a site whose content is entirely in a carousel, a one-page site with almost no text, a non-English site, a site behind Cloudflare, a very long page. The two bugs found so far both came from a real site behaving normally.

**Always open the page yourself before believing a low score.** That single habit would have caught bug 2 immediately.

## Do not break

- **SSRF protections in `scraper.js`** (private IPs, localhost, cloud metadata). Do not relax these to make a test pass.
- **The paywall.** `as-report` returns teaser-only unless `unlocked`, allowlisted sample, or comped. Do not widen `isFullyViewable`.
- **The comped allowlist** in `api/as-report/sampleReports.js` holds a live prospect's report. Leave it.
- `reportRenderer.js` appears to be dead code (nothing requires it). Confirm before investing effort there.

## Kickoff prompt

> Read `docs/superpowers/handoffs/2026-08-07-ambientscore-bug-hunt.md`. AmbientScore produced two silent client-facing failures in one day, both of the same shape: a stage fails, something plausible is substituted, and the customer is never told. Hunt for the rest. Start with the confirmed lead (one failed evaluation group fabricates 4 dimensions at score 60 and discloses it as a bare asterisk), then survey every stored report for `errors[]`, `partial: true`, empty rewrites and JS warnings to measure how widespread this is. Verify each bug against a real page before claiming it, and do not weaken SSRF or the paywall.
