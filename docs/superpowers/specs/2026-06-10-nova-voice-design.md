# Nova Voice — Lab Experimental (Design Spec)

**Date:** 2026-06-10
**Status:** Approved design — REVISED during implementation (2026-06-11, see Revisions)
**Type:** Lab experimental (`/lab/nova-voice.html`)

## Revisions (2026-06-11, CEO-directed mid-implementation)

1. **Brain swapped: `novachat` → `agentchat`.** The CEO clarified this is **AmbientOS
   Nova** (Prime Operator, Tier 2 agent) — not the old public-site Nova persona.
   Client now calls `POST /api/agentchat` with `{ agentId:'nova', message, history:
   [{role:'user'|'agent', text}], mode:'voice' }` → `{ reply }`. The custom `'voice'`
   mode keeps the channel READ-ONLY: agentchat only enables action execution for modes
   `'chat'`/`'task'`. Nova answers grounded in live company context + intel digests.
2. **Mood system dropped.** Synth moods belong to old Nova; AmbientOS Nova has none.
   No mood fetch; the TTS function's `pickStyle` defaults to `friendly` when no mood is
   sent (module kept — harmless, future-proof). Orb aura is statically Nova's product
   color (`--pc-nova`). The status line shows real service telemetry instead of a mood.
3. **Voice channel shaping.** Operational Nova writes structured bullets; the client
   prefixes each message with a voice-channel instruction (conversational, <80 words,
   no markdown) and strips residual markdown before display/TTS.
4. **Voice actions enabled (2026-06-11, CEO-requested).** Client now sends
   `mode:'chat'`, which enables agentchat action execution (create-task,
   update/move/comment-task, create/update-doc, propose-campaign,
   propose-objective, pause/resume campaigns). Safeguards: (a) campaigns and
   objectives remain PROPOSALS routed to the CEO approval queue server-side —
   voice cannot mint them directly; (b) `execution_mode` and campaign gates apply
   unchanged; (c) the voice-channel instruction requires Nova to state the exact
   action and get an explicit confirmation in a follow-up turn before emitting it
   (prompt-gated, not server-enforced — the real boundary remains the server
   gates); (d) executed actions render as mono receipt lines in the transcript
   (`✓/✗ summary`).
5. **Restyled to the AmbientPixels DS (Monolith).** Old lab template replaced with
   `ap-nav`/`ap-sec`/`ap-foot` shell, Archivo + JetBrains Mono, rules-not-cards
   transcript, quiet ambient-pixel orb (breathing center dot, ripple ring on speak),
   bottom-border input, `ap-btn--primary` send.

## Revisions (2026-06-12, post-ship enhancement pass)

1. **Full AmbientOS crew.** All 8 agents (nova, cipher, echo, forge, pixel, scout,
   scribe, quill) selectable via a mono switcher row; `currentAgentId` drives the
   `agentchat` call, status line, and transcript speaker label. The same orb/transcript
   serves whoever is selected.
2. **Per-agent voices.** `buildSsml(text, mood, voice)` takes a voice param validated
   against a server-side `ALLOWED_VOICES` whitelist (8 `en-US-*Neural` voices, one per
   agent). Non-Aria voices skip the Aria-tuned `express-as` styles and speak with plain
   prosody. A non-whitelisted/injected voice string falls back to Aria (tested).
3. **Barge-in.** Tapping the orb (or Space) while Nova is speaking calls `stopSpeaking()`
   (`AudioBufferSourceNode.stop()` / element pause) and immediately starts listening —
   interruptible like a real assistant.
4. **Dead-air filler.** On send, a short clip ("One moment." / "Checking." …) in the
   agent's voice plays to cover the round-trip silence; cached per phrase+voice, only
   played if still `thinking` when it's ready, cut by `stopSpeaking()` when the real
   reply arrives.
5. **Proactive greeting.** At load, a read-only (`mode:'voice'`) sitrep is fetched,
   rendered as the first transcript line, and spoken on the first neutral gesture (never
   over the user's own first words; the orb/input are excluded). 25s `AbortController`
   bound because the nova+intel path cold-starts slow — best-effort, never blocks the
   orb, which is usable immediately.

## Summary

> **SUPERSEDED in part — see Revisions above.** Nova is now AmbientOS Nova (Prime
> Operator) grounded in live company data via `agentchat`; the mood system is dropped.

A push-to-talk voice conversation with Nova as a character — a "Jarvis-like" experimental
where you hold a mic orb, speak, and Nova answers aloud in a voice that reflects her
current mood. Persona-first, not a company copilot: she is grounded in her live mood and
light awareness context, not in operational company data.

## Decisions made during brainstorm

| Question | Decision |
|---|---|
| Core job | Nova persona chat (art piece, not copilot) |
| Voice production | Azure Neural TTS (already on Azure; expressive styles map to moods) |
| Interaction model | Push-to-talk via mic orb (no wake word, no always-on mic) |
| Grounding | Mood + light awareness (current mood JSON; persona prompt server-side) |
| Architecture | Hybrid: browser STT in, Azure TTS out, existing `novachat` brain |

## Architecture & data flow

> **SUPERSEDED in part — see Revisions above.** Steps 1 and 3-4 changed: no mood fetch;
> the brain is `POST /api/agentchat` (`agentId:'nova'`, `mode:'voice'`, read-only); TTS
> is called without a mood payload (server defaults to the `friendly` style).

1. **Open** `lab/nova-voice.html` → page generates a session mood via
   `POST /api/novachat` with `mode: 'mood'` (the same call NovaSoul uses; there is no
   static mood JSON file) → orb tints to `auraColorHex`, mood name displayed, mood object
   held for the session. Hardcoded default mood if generation fails.
2. **Listen:** user holds the orb → browser `SpeechRecognition`
   (`webkitSpeechRecognition`) starts → on release/final result, transcript captured.
3. **Think:** transcript + running conversation history → existing
   `POST /api/novachat` with `mode: 'chat'`. Persona system prompt, skills block, and
   company context are already server-side in that function. **No changes to novachat.**
4. **Speak:** reply text + session mood → new `POST /api/nova-voice-tts` → function maps
   mood numerics to Azure SSML (style, rate, pitch), calls Azure Speech REST API,
   returns `audio/mpeg`. Page plays the audio; orb ripples while speaking.
5. **Log:** conversation pairs render below the orb as a faint scrolling transcript.

Orb state machine: `idle → listening → thinking → speaking → idle`.

## Components (all new files; no high-blast-radius files touched)

| File | Purpose |
|---|---|
| `lab/nova-voice.html` | Page shell, follows existing lab conventions (nav header, mini-hero, neon-card) |
| `js/nova-voice.js` | Orb state machine, STT wiring, novachat + TTS calls, audio playback, transcript log |
| `css/nova-voice.css` | Orb styles + animations. All animations prefixed `nova-voice-*`. Colors via `--aura-*` / `--mood-*` tokens only — no raw hex. |
| `api/nova-voice-tts/index.js` + `function.json` | Azure Function: `{ text, mood }` → SSML → Azure Speech REST → MP3 |

App settings (new, on `ambientpixels-nova-api`): `SPEECH_KEY`, `SPEECH_REGION`.
The Speech key never reaches the client.

## Mood → voice mapping

Mood **names** are freeform creative strings ("tired but wired", "restless focus"), so
mapping keys off the **numeric** fields of the mood JSON, evaluated top-down (first match
wins):

| Condition | Azure style | Prosody |
|---|---|---|
| `glitchFactor > 0.6` | `whispering` | rate +10%, slight pitch shift |
| `selfWorth < 0.4` or `isStable === false` | `sad` | rate −10% |
| `intensity > 0.7` and `isStable` | `cheerful` | rate +5% |
| default | `friendly` | neutral |

Voice pinned to `en-US-AriaNeural` (supports all four styles above) so Nova always
sounds like the same character; swapping the voice later is a one-line change. Mapping lives in the
TTS function (server-side) so the client only passes the raw mood object.

## Error handling

- **No `SpeechRecognition` support** (Firefox/Safari): page degrades to type-to-talk — a
  text input appears under the orb; Nova still answers with voice.
- **Mic permission denied:** orb dims with explanatory copy; type-to-talk fallback shown.
- **novachat error:** existing glitch-line fallback text renders in the transcript.
- **TTS failure:** reply still renders as text with a "voice signal lost" note. Voice
  failure is never a dead end.
- **TTS function guards:** rejects empty payloads; caps input at ~600 chars per request
  (cost guard — Azure free tier is 500K chars/month); returns 502 with detail on Azure
  errors.

## Out of scope (explicitly deferred)

- Wake word / always-on listening
- Azure Speech SDK for STT (upgrade path if the experimental lands)
- Gemini Live API real-time pipeline (orb UX carries over if ever swapped)
- Session memory across visits
- Company-state grounding (copilot mode) and voice-triggered actions
- Rate limiting / auth beyond the TTS char cap (lab experimental; add throttling before
  any promotion out of lab). This deferral covers BOTH endpoints the page calls:
  `nova-voice-tts` (Azure Speech chars cost money) and the pre-existing anonymous
  `agentchat` (each voice message triggers blob reads + an LLM completion, and
  `mode:'voice'` ships Nova's live company context — task/campaign/doc titles, intel
  digests — to any visitor). Accepted for /lab/; revisit before promotion.

## Testing

- **Visual/interaction:** Playwright against Live Server — screenshot orb in all four
  states; verify type-to-talk fallback by stubbing out `SpeechRecognition`.
- **TTS function:** `curl` with sample `{ text, mood }` payloads covering each mapping
  row; verify MP3 response and the 600-char rejection.
- **Post-deploy:** load `/lab/nova-voice.html` on production, full voice round-trip,
  check Application Insights for TTS function errors.
