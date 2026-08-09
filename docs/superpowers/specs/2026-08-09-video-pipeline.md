# Video pipeline — what exists, what it cost to learn, what it would take to automate

**Status:** local generation SHIPPED (`scripts/generate-brand-video.js`). Agent-pipeline
integration NOT built — blocked on decisions in the last section.
**Date:** 2026-08-09

---

## What exists today

`scripts/generate-brand-video.js` generates vertical clips for Reels. Standalone: writes
mp4s to disk, touches no blob, no actions array, no pipeline. Nothing posts until a human
has watched it.

```
node scripts/generate-brand-video.js                  # first brief only — video costs real money
node scripts/generate-brand-video.js roast-character  # one by slug
node scripts/generate-brand-video.js all
```

Two clip types:

**Brand clips** — abstract Veo background, hook text overlaid, audio stripped.
**Character clips** — an existing agent portrait animated and speaking, audio kept.

Outputs land in `c:/tmp/brand-video` (override with `BRAND_VIDEO_OUT`). Generated
backgrounds cache in `work/`, so re-running to fix an overlay costs nothing — delete the
`bg-*.mp4` to force regeneration.

---

## Findings that are not in any documentation

**Resolution is not a tier feature.** `veo-3.1-lite` and `veo-3.1-fast` both return
720x1280. Measured, identical. Paying for a higher tier buys no pixels. Reels-native
1080x1920 comes from an undocumented **`resolution: '1080p'`** parameter in `parameters`,
and it works on the cheapest tier. `GET /v1beta/models/veo-3.1-lite-generate-preview`
returns no parameter list at all, so there was nothing to read — sending it and seeing what
came back was the only way to find out.

**Veo is `:predictLongRunning`, not `:generateContent`.** Submit returns an operation name;
poll it every ~10s for 40–100s; the finished response carries a signed URL you then download
with the API key appended. This is why video does NOT belong in `imageEngine.js`, which is
built around a synchronous call returning inline base64.

**The response path moves between revisions.** Walk the response object for the first
https URL that looks like a video rather than hard-coding `generatedSamples[0].video.uri`.

**Veo attaches a silent audio track even when told not to.** Measured mean −63 dB on brand
clips. Strip it with `-an` so Reels doesn't offer a sound affordance for nothing. Character
clips are the exception: real speech measures around −19 dB, and that's the point.

**Padding a square portrait into 9:16 is a trap.** Veo faithfully animates the padding
along with the subject, leaving ~44% of the Reel dead. Cover-crop instead: it costs the
outer edges of the frame and gains standard head-and-shoulders framing, which is what
vertical video wants anyway. `brief.focusX` shifts the crop window for off-centre subjects.

**Let the browser re-wrap overlay text and you lose the author's line breaks.** A
deliberate 3-line hook became 5 visual lines with two words stranded alone. `.line` is
`white-space: nowrap` and the renderer shrinks type until the author's breaks fit.

**8 seconds is about 20–25 words of natural speech.** Longer gets rushed or truncated.

---

## Character clips and the face rule

Character clips condition Veo on an agent portrait from `pixel-agents/img/`, so the face in
the ad is the face on the product page.

`imageEngine`'s default prompt bans human faces. The `ap-arcane` preset relaxes that for
**invented** characters only, and the agent portraits are exactly that — generated, not real
people. **That distinction is the entire reason this is acceptable. Never point the
conditioning image at a photograph of a real person.**

The prompt describes performance and dialogue only. Restating the visual style fights the
conditioning image and drifts the face.

---

## Why this is not in the agent pipeline yet

### Blocker 1: the Function App cannot composite video

`api/package.json` dependencies are `@azure/*`, `@resvg/resvg-js`, `axios`, `cheerio`,
`node-fetch`, `satori`, `sharp`. **No ffmpeg. No Playwright.** Azure Functions on Linux
Consumption has no ffmpeg binary and no browser.

So the split is:

| Clip type | Server-side? | Why |
|---|---|---|
| Character clips | **Yes** | Veo returns a finished mp4 with speech. Nothing to composite. |
| Textless brand clips | **Yes** | Same, minus the overlay. |
| Brand clips with hook text | **No** | Overlay + audio strip needs ffmpeg. |

`satori` + `@resvg/resvg-js` can render text to PNG without a browser, so an overlay *image*
is reachable server-side. Burning it into video is not.

Asking Veo to render the text itself is not a substitute — it garbles letters, and every
prompt here explicitly forbids text in frame for that reason.

### Blocker 2: cost, and an autonomous agent holding the trigger

Images cost ~$0.039 each and `imageEngine` prices that in `IMAGE_COST_PER_IMAGE`. Video is a
different order of magnitude — dollars per clip, not cents. Actual Veo 3.1 pricing has not
been verified; check Google AI Studio billing before scaling.

Company burn is ~$90/mo against a ~57-day runway. An agent that can generate video on its own
judgement is a budget risk of a kind the image engine never was. Any integration needs, at
minimum:

- a hard daily cap enforced **before** submit, not after
- a pending-approval gate, per the money-actions rule that already governs paid actions
- spend mirrored into `geminiUsage` so Cipher and the Cost Center can see it — note that
  `callImageGeneration` used directly (as the local script does) is **invisible** to those
  surfaces

### Blocker 3: generation takes 40–100 seconds

Azure kills HTTP at 230s. A single clip fits, but polling burns execution time inside a
heartbeat that already has plenty to do. The right shape is submit-then-store-operation-id,
and poll on a later cycle — an async job, not an inline call.

---

## If it gets built

Mirror the image path: agents emit `generate-image` today, handled in `agent-runner.js`
around the forced-hero-image block. Video would be `generate-video` with a `video: {}`
payload and a new `api/_lib/contentEngine/videoEngine.js` — a sibling of `imageEngine`, not
an outputType inside it, because of the async shape.

Minimum viable server-side scope is **character clips only**: they need no compositing, they
are the most differentiated asset, and they have a natural per-agent brief. Brand clips with
text stay a local step until there is a reason to solve ffmpeg-in-Azure.

Related: [[project_facebook_page_and_graph_api]], `reference_local_gemini_image_gen`.
