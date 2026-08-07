# Handoff — fix AmbientScore, in this order

**Written 2026-08-07 from a measured corpus survey, not guesswork. Every claim below was verified against the shipped code, real pages, or all 214 stored reports.**
**Read `project_ambientscore_bug_hunt_2026_08_07.md` (memory) for the evidence behind each number.**

---

## The situation in one paragraph

Of 214 stored reports, **68 (32%) recorded an error** and **43 (20%) shipped with four of eight dimensions fabricated** — filled with a constant score of 60 because one evaluation group failed. Median error against a correct re-score is 8 points, worst case 34, and the direction is unpredictable, so you cannot even claim the scores are conservative. Nobody outside the company has been harmed: **all 20 unlocked reports are CEO self-purchases.** The exposure is entirely forward-looking, which is the only reason this is a fix list rather than a refund exercise. Fix it before the first real customer, not after.

## Order of work

Ordered by expected harm divided by effort. Do them in this order; each is independently shippable.

---

### 1. Give group evals the retry that synthesis already has — DO THIS FIRST

**Why now:** this is the root cause of the 20%. It is the same failure that was fixed in synthesis on 08-06, in the stage with **twice the blast radius**, and it was not given the same treatment. Production is already running at **87% of the cap** (largest observed group-eval output: 6,998 tokens against 8,000, on 2026-08-06; 14 of 222 calls exceeded 75%). This is not a latent risk.

**Where:** `api/_lib/ambientScore/analyzer.js`, the `evalPromises` map (~line 136). Today it is a bare try/catch with no retry:

```js
const raw = await callClaude(prompt, {
  temperature: 0.1, maxOutputTokens: 8000, caller: 'as-eval-group-' + groupId
});
return { groupId, status: 'ok', result: parseJsonResponse(raw) };
} catch (err) {
  errors.push('Group ' + groupId + ' evaluation failed: ' + err.message);
  return { groupId, status: 'failed', error: err.message };
}
```

**Do:** mirror the synthesis pattern immediately below it (~line 190) — one retry at a **raised** ceiling (16000), caller `as-eval-group-<id>-retry`, and only push to `errors[]` if both attempts fail. Truncation is deterministic at a fixed budget, so a retry at the same ceiling is worthless; the ceiling must change.

**Verify:** re-run a site that produced a partial report and confirm `errors[]` is empty and no dimension carries `partial: true`. Then confirm the healthy path is unchanged (`lab/oakroute.html`). Watch `claudeUsage` afterwards to see whether retries actually fire.

---

### 2. Show the disclaimer before the money, not after

**Why:** `scorer.js` always sets `disclaimer`, and the full report renders it. But the two surfaces where someone decides to pay never show it — so a fabricated score is disclosed **only after purchase**. That is the finding with real commercial weight.

**Where:**
- **Free scan:** `api/as-analyze/index.js` (~lines 261-275) returns score, grade, teaser and `jsRenderedWarning` but **omits `disclaimer` entirely**. Add it to the response.
- **Paywall:** `as-report` already sends `disclaimer` and `jsRenderedWarning`; `renderPaywall` in `ambientscore/js/report.js` reads neither. Render both.

**Do:** treat this as the same job the 08-06 fix did for `degraded` — if the number is partly invented, say so wherever the number appears.

---

### 3. Stop the report contradicting itself

**Where:** `ambientscore/js/report.js:383` prints **`8 dimensions evaluated`** unconditionally, while the disclaimer ~60 lines below says *"4 of 8 dimensions used estimated scores."* Both render in the same document.

**Do:** make the count conditional on how many dimensions were actually evaluated, exactly as the 08-06 fix made the neighbouring "Rewrites included" check conditional. This one was missed in that pass.

---

### 4. Check the HTTP status, and catch soft 404s

**Why:** `scraper.js:460` assigns `statusCode` and **nothing ever reads it** (one occurrence in the codebase, the assignment). `validateStatus: s < 500` lets 404 through as content. Verified live: `stripe.com/nonexistent-page-xyz123` produced a full 22/100 report that rewrote *"Page not found"* into *"Let's get you back on track."*

**The nastier half:** on SWA and SPA sites a mistyped path returns **HTTP 200 with the homepage** (`ambientpixels.ai/no-such-page-x9` does exactly this). The report then audits a different page than the URL printed on it, and neither the model nor the reader can tell.

**Do:** refuse to analyse a non-2xx response with a clear message. For soft 404s, a cheap heuristic goes a long way: compare the fetched content against the site root, and if a deep path returns byte-identical or near-identical content to `/`, flag it rather than silently auditing the homepage.

---

### 5. Decide what an unreadable page should get — this one is yours, not the engineer's

19 reports have under 200 characters of body text. Median score **24/100**, floor **7/100** — bsky, gumroad, support.xbox, seattletimes, all JS-rendered. `promptBuilder.js:129` instructs the model to score absent criteria as 3, which collapses the total. The page may be excellent; we simply could not read it.

**This is a product decision.** Roughly:

- **Refuse and say so** ("we could not read this page well enough to score it"). Most honest, costs a scan.
- **Score it but withhold the grade**, showing only what was observable.
- **Keep scoring** but make the warning proportionate — the current *"may be partial"* is far too soft for a 10/100 verdict, and `renderPaywall` does not show it at all.

Pick one deliberately. Whatever is chosen, the warning must reach the paywall.

---

### 6. Revoke access on refund

`as-webhook:220-223` **does** handle `charge.refunded` and `charge.dispute.created`, but only through `recordRefundFromEvent`, which touches revenue accounting and never `cc_report_*`. Accounting is correct; access is simply never withdrawn. Fix the revoke, not the handler.

---

### 7. Backfill, and decide what to tell nobody

43 reports carry fabricated dimensions and 26 carry no rewrites. All are self-purchases, so there is no one to notify. Regenerating them is optional and mainly hygiene — but **`ccr_1786049018467_22a38d5a` has already been regenerated** and belongs to a live prospect, so leave that one alone.

---

## Lower priority, confirmed

- `hydratedCounters` never reaches the assembled report (cosmetic; `jsRenderedWarning` carries the signal).
- Classification fallback is silent but has fired **0 times in 214 reports** — deprioritize. Its live cousin is `siteTypeConfidence: 'low'` (12 reports), which is stored and never surfaced.
- Rate limiting is IP-only **and** a read-modify-write race. The email-my-scorecard path spends a free scan.
- `as-analyze:228` runs analysis as fire-and-forget after responding — orphaned on a Consumption-plan freeze would mean paid-but-no-report. Currently unreachable from the UI since both buy paths send a `reportId`.
- **SSRF redirect re-validation is untested.** axios follows up to 5 redirects and `validateUrl` only runs on the initial URL. Suspicion, not a finding. Worth a deliberate test. **Do not weaken any SSRF check to make something pass.**

## Do not re-chase these — they were investigated and are not bugs

- **"Unlock does not verify the session belongs to the report."** Not real. `as-analyze:88` reads `payment.metadata.reportId` from the Stripe session itself and ignores any caller-supplied id. A paid session can only unlock what it paid for. The June codex flagged this; it does not reproduce.
- **"No refund/dispute handling."** Half wrong — the events are handled, they just don't revoke access. See item 6.

## Standing rule this whole episode teaches

Three bugs in two days, one shape: **a stage fails, something plausible is substituted, the customer is never told.** When adding any fallback, answer one question in the code review: *if this fires, does the person reading the output find out?* If the answer is no, that is the bug, regardless of how good the fallback is.

## Kickoff prompt

> Read `docs/superpowers/handoffs/2026-08-07-ambientscore-fix-plan.md` and the memory note `project_ambientscore_bug_hunt_2026_08_07.md`. Work the numbered list in order. Item 1 is urgent: group evals have no retry while synthesis does, and production already peaks at 87% of the token cap, which is why 20% of stored reports shipped with half the score fabricated. Verify each fix against a real page and confirm the healthy path still works before moving on. Items 5 is a product decision — surface it rather than choosing alone. Do not weaken SSRF or the paywall.
