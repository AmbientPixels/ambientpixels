# Nova Voice — Lab Experimental (Design Spec)

**Date:** 2026-06-10
**Status:** Approved design, pre-implementation
**Type:** Lab experimental (`/lab/nova-voice.html`)

## Summary

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

1. **Open** `lab/nova-voice.html` → page fetches `/data/nova-synth-mood.json` → orb tints
   to `auraColorHex`, mood name displayed, mood object held for the session.
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
- Rate limiting / auth on the TTS endpoint beyond the char cap (lab experimental; add
  throttling before any promotion out of lab)

## Testing

- **Visual/interaction:** Playwright against Live Server — screenshot orb in all four
  states; verify type-to-talk fallback by stubbing out `SpeechRecognition`.
- **TTS function:** `curl` with sample `{ text, mood }` payloads covering each mapping
  row; verify MP3 response and the 600-char rejection.
- **Post-deploy:** load `/lab/nova-voice.html` on production, full voice round-trip,
  check Application Insights for TTS function errors.
