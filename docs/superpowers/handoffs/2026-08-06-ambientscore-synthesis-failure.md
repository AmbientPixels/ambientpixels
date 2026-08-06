# Handoff — AmbientScore ships reports with no rewrites when a site scores badly

**Written 2026-08-06 after diagnosing a live report. Root cause is confirmed, not suspected.**
**Severity: paying customers do not get what the product sells them.**

---

## The bug in one paragraph

AmbientScore sells "$29 full report **with rewrites**." On a site with a lot wrong with it, the report arrives with **no rewrites at all**, a template executive summary, and one filler strategic opportunity. The synthesis LLM call exceeds its output-token ceiling, the truncated JSON fails to parse, and the analyzer silently falls back to a hardcoded template. The customer is never told.

**It is worst exactly where it matters most.** Synthesis output scales with how much is wrong. A healthy site produces a short synthesis and succeeds; a struggling site produces a long one and fails. The customers with the most to fix are the ones who get the least.

## Evidence

Two real reports, same pipeline:

| Report | Score | Findings | headlineRewrites | ctaRewrites | errors |
|---|---|---|---|---|---|
| Public sample `ccr_1783742989787_e4366317` | 75 (C) | fewer | 1 | 1 | none |
| `ccr_1786049018467_22a38d5a` (agency site) | 28 (F) | 31 | **0** | **0** | see below |

The failing report's own stored `errors` array says it plainly:

```
"Synthesis failed: Claude truncated output at max_tokens=3000 (caller: as-synthesis)"
```

That report also recorded `claudeCalls: 5`, `totalTimeMs: 227442` — the pipeline ran fully and only the last stage failed.

## Exactly where it breaks

**`api/_lib/ambientScore/analyzer.js:180`** — the synthesis call is capped at 3000 output tokens:

```js
const rawSynthesis = await callClaude(synthPrompt, {
  temperature: 0.5,
  maxOutputTokens: 3000,
  caller: 'as-synthesis'
});
synthesis = parseJsonResponse(rawSynthesis);
```

**`analyzer.js:58`** — the wrapper correctly detects truncation and throws:

```js
if (data?.stop_reason === 'max_tokens') {
  throw new Error('Claude truncated output at max_tokens=' + ... );
}
```

**`analyzer.js:186-189`** — the catch swallows it into a fallback:

```js
} catch (err) {
  errors.push('Synthesis failed: ' + err.message);
  synthesis = buildFallbackSynthesis(scoreResult);
```

**`analyzer.js:234-272`** — `buildFallbackSynthesis` returns, hardcoded:

```js
headlineRewrites: [],
ctaRewrites: [],
strategicOpportunities: ['Address the critical findings listed above ...']
```

The prompt at `promptBuilder.js:305-320` does ask for both rewrite arrays, so the prompt is fine. Only the budget is wrong.

## Fixing it

Do these in order; the first alone resolves the reported symptom.

1. **Raise the synthesis ceiling.** 3000 tokens is too tight for a strict-JSON synthesis carrying two rewrite arrays plus priorities. Raise it substantially (8000+ is not expensive at Haiku/Sonnet synthesis volume) and re-run against the failing report id to confirm rewrites appear.
2. **Retry once on truncation before falling back.** A single retry at a higher ceiling, or with the finding list trimmed to the top N, converts most failures into successes. Truncation is deterministic given the same input, so retry with *changed* parameters, not the same ones.
3. **Cap synthesis input.** Pass only the top ~10 findings into the synthesis prompt rather than all 31. The rewrites only ever concern the headline and primary CTA, so the long tail adds tokens without adding value. This attacks the cause rather than the ceiling.
4. **Stop shipping a degraded report silently.** If the fallback is used, the report should say so. Right now `errors` is populated and stored but the viewer never surfaces it. Either show a plain note ("the rewrite section could not be generated for this report") or, better, do not present the report as complete.
5. **Backfill.** Find stored reports where `errors` is non-empty or both rewrite arrays are empty, and regenerate their synthesis. Any paid ones are the priority — those customers paid for rewrites and did not get them.

## Verification

- Re-run analysis for `https://hansonconsultgroup.com/` and confirm `synthesis.headlineRewrites.length > 0`, `synthesis.ctaRewrites.length > 0`, and `errors` empty.
- Confirm the public sample still succeeds (regression check on the healthy path).
- Deliberately analyse a very poor page and confirm it succeeds too — that is the case that fails today.

## Related, do not confuse

- **The comped-report allowlist** (`api/as-report/sampleReports.js`, commit `e376cb03`) is a *separate* change from the same day, already committed. It lets a report be given away without the "Sample audit" banner. It was written but **had not deployed** because GitHub Actions was in a critical outage on 2026-08-06 (webhook triggers throttled, push events not creating runs). Check it actually deployed before assuming it is broken.
- The report at the centre of this diagnosis belongs to a real prospective client. Its findings are sound and the analysis pipeline itself worked correctly. **Only the final synthesis stage failed.** Do not re-scan and assume a low score is a scraper problem: `jsRenderedWarning` was null and the extraction was accurate.

## Reading the stored report directly

Handy while debugging, since `cc_report_*` is not a `company-state` VALID_KEY and cannot be fetched through the public state API:

```js
// connection string: az functionapp config appsettings list --name ambientpixels-nova-api \
//   --resource-group ambientpixelsV2 --query "[?name=='AZURE_STORAGE_CONNECTION_STRING'].value" -o tsv
const { BlobServiceClient } = require('@azure/storage-blob');
const svc = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const buf = await svc.getContainerClient('company-state')
  .getBlockBlobClient('cc_report_<reportId>.json').downloadToBuffer();
const report = JSON.parse(buf.toString());
console.log(report.errors, report.synthesis);
```

## Kickoff prompt

> Read `docs/superpowers/handoffs/2026-08-06-ambientscore-synthesis-failure.md`. AmbientScore falls back to a hardcoded synthesis with empty headlineRewrites and ctaRewrites whenever the synthesis call exceeds max_tokens=3000, which happens on exactly the sites that need rewrites most. Root cause and line numbers are in the doc. Fix it, verify against `https://hansonconsultgroup.com/`, confirm the healthy path still works, and surface the degradation instead of hiding it.
