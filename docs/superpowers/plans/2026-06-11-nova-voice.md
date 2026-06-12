# Nova Voice Lab Experimental Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push-to-talk voice chat with Nova at `/lab/nova-voice.html` — browser speech-to-text in, mood-mapped Azure Neural TTS out, existing `novachat` brain.

**Architecture:** All-new files; zero changes to existing code. Client: orb state machine (`idle → listening → thinking → speaking`) in plain non-module JS, browser `SpeechRecognition` for input, conversation via existing `POST /api/novachat`. Server: one new Azure Function `api/nova-voice-tts` that converts `{ text, mood }` to SSML (mood numerics → Azure expressive style) and proxies Azure Speech REST, returning MP3.

**Tech Stack:** Azure Functions Node v3 model (`module.exports = async function (context, req)`, global `fetch`), Azure Speech REST API (`en-US-AriaNeural`), Web Speech API (`webkitSpeechRecognition`), hand-written CSS with `--aura-*` tokens.

**Spec:** `docs/superpowers/specs/2026-06-10-nova-voice-design.md`

**Critical context for workers:**
- Repo root for all paths below: `c:\Dev\Ambientpixels\ambientpixels\` (the real `.git` lives here, NOT the parent folder).
- Deploy is CI/CD via `git push origin master`. There is no local Functions runtime assumed — server code is unit-tested with plain `node`, then verified on production after push.
- DO NOT touch: `local.settings.json`, `staticwebapp.config.json`, `api/companyHeartbeat/*`, `api/company-state/*`, `package-lock.json`.
- `novachat` API contract (read `api/novachat/index.js` if unsure, but do not modify it):
  - Chat: `POST /api/novachat` `{ message, history: [{role:'user'|'nova', text}], voiceMode:'friendly' }` → `{ reply, mode:'chat' }`
  - Mood: `POST /api/novachat` `{ message: '<context>', mode:'mood' }` → `{ reply, mode:'mood', mood?: { mood, aura, auraColorHex, emoji, quote, selfWorth, glitchFactor, memoryClutter, awareness, internalState, observation, isStable, intensity } }` — `mood` is ABSENT when JSON parsing fails server-side; client must default.
- API base URL pattern (copy from `js/nova-ai.js`): production hostname contains `ambientpixels.ai` → `https://ambientpixels-nova-api.azurewebsites.net/api`, otherwise relative `/api`.

---

### Task 1: SSML builder module (pure logic, TDD)

**Files:**
- Create: `api/nova-voice-tts/ssml.js`
- Test: `api/nova-voice-tts/ssml.test.js` (plain node script — repo has no test framework)

- [ ] **Step 1: Write the failing test**

Create `api/nova-voice-tts/ssml.test.js`:

```js
// Run with: node api/nova-voice-tts/ssml.test.js
const assert = require('assert');
const { pickStyle, buildSsml } = require('./ssml');

// --- pickStyle: first match wins, per spec table ---
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.7, selfWorth: 0.2, isStable: false, intensity: 0.9 }),
  { style: 'whispering', rate: '+10%', pitch: '+5%' },
  'glitch beats everything'
);
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.1, selfWorth: 0.3, isStable: true, intensity: 0.9 }),
  { style: 'sad', rate: '-10%', pitch: '+0%' },
  'low selfWorth -> sad'
);
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.1, selfWorth: 0.8, isStable: false, intensity: 0.2 }),
  { style: 'sad', rate: '-10%', pitch: '+0%' },
  'unstable -> sad'
);
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.1, selfWorth: 0.8, isStable: true, intensity: 0.8 }),
  { style: 'cheerful', rate: '+5%', pitch: '+0%' },
  'high stable intensity -> cheerful'
);
assert.deepStrictEqual(
  pickStyle({ glitchFactor: 0.1, selfWorth: 0.8, isStable: true, intensity: 0.5 }),
  { style: 'friendly', rate: '+0%', pitch: '+0%' },
  'default -> friendly'
);
assert.deepStrictEqual(
  pickStyle({}),
  { style: 'friendly', rate: '+0%', pitch: '+0%' },
  'missing fields -> safe default'
);
assert.deepStrictEqual(
  pickStyle(null),
  { style: 'friendly', rate: '+0%', pitch: '+0%' },
  'null mood -> safe default'
);

// --- buildSsml: structure + XML escaping ---
const ssml = buildSsml('Hello <world> & "friends"', { intensity: 0.8, isStable: true, glitchFactor: 0, selfWorth: 0.8 });
assert.ok(ssml.includes('en-US-AriaNeural'), 'pinned voice');
assert.ok(ssml.includes('mstts:express-as style="cheerful"'), 'style applied');
assert.ok(ssml.includes('rate="+5%"'), 'prosody rate applied');
assert.ok(ssml.includes('Hello &lt;world&gt; &amp; &quot;friends&quot;'), 'XML escaped');
assert.ok(!ssml.includes('<world>'), 'no raw angle brackets from input');

console.log('ssml.test.js: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root `ambientpixels/`): `node api/nova-voice-tts/ssml.test.js`
Expected: FAIL with `Cannot find module './ssml'`

- [ ] **Step 3: Write the implementation**

Create `api/nova-voice-tts/ssml.js`:

```js
// File: api/nova-voice-tts/ssml.js
// Maps Nova's mood numerics to an Azure Neural TTS expressive style and builds SSML.
// Voice pinned to en-US-AriaNeural (supports whispering/sad/cheerful/friendly).

const VOICE = 'en-US-AriaNeural';

// First match wins — order matters (spec: mood -> voice mapping table)
function pickStyle(mood) {
  const m = mood || {};
  const glitch = Number(m.glitchFactor) || 0;
  const worth = (m.selfWorth === undefined || m.selfWorth === null) ? 1 : Number(m.selfWorth);
  const stable = m.isStable !== false; // missing -> treat as stable
  const intensity = Number(m.intensity) || 0;

  if (glitch > 0.6) return { style: 'whispering', rate: '+10%', pitch: '+5%' };
  if (worth < 0.4 || !stable) return { style: 'sad', rate: '-10%', pitch: '+0%' };
  if (intensity > 0.7 && stable) return { style: 'cheerful', rate: '+5%', pitch: '+0%' };
  return { style: 'friendly', rate: '+0%', pitch: '+0%' };
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSsml(text, mood) {
  const { style, rate, pitch } = pickStyle(mood);
  return [
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">',
    `<voice name="${VOICE}">`,
    `<mstts:express-as style="${style}">`,
    `<prosody rate="${rate}" pitch="${pitch}">${escapeXml(text)}</prosody>`,
    '</mstts:express-as>',
    '</voice>',
    '</speak>'
  ].join('');
}

module.exports = { pickStyle, buildSsml, VOICE };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/nova-voice-tts/ssml.test.js`
Expected: `ssml.test.js: all assertions passed`

- [ ] **Step 5: Commit**

```bash
git add api/nova-voice-tts/ssml.js api/nova-voice-tts/ssml.test.js
git commit -m "feat(nova-voice): SSML builder with mood-to-style mapping"
```

---

### Task 2: TTS Azure Function

**Files:**
- Create: `api/nova-voice-tts/index.js`
- Create: `api/nova-voice-tts/function.json`

- [ ] **Step 1: Create function.json**

Create `api/nova-voice-tts/function.json` (same shape as `api/novachat/function.json`):

```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post", "options"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

- [ ] **Step 2: Create index.js**

Create `api/nova-voice-tts/index.js`:

```js
// File: api/nova-voice-tts/index.js
// Nova Voice TTS — converts { text, mood } to mood-styled speech via Azure Speech REST.
// Spec: docs/superpowers/specs/2026-06-10-nova-voice-design.md

const { buildSsml } = require('./ssml');

const MAX_CHARS = 600; // cost guard — Azure free tier is 500K chars/month

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders };
    return;
  }

  const key = process.env.SPEECH_KEY;
  const region = process.env.SPEECH_REGION;
  if (!key || !region) {
    context.log.error('[NovaVoiceTTS] SPEECH_KEY/SPEECH_REGION not configured');
    context.res = { status: 500, headers: corsHeaders, body: { error: 'Voice not configured.' } };
    return;
  }

  const body = req.body || {};
  const text = (body.text || '').toString().trim();
  if (!text) {
    context.res = { status: 400, headers: corsHeaders, body: { error: 'No text provided.' } };
    return;
  }
  if (text.length > MAX_CHARS) {
    context.res = { status: 400, headers: corsHeaders, body: { error: `Text exceeds ${MAX_CHARS} character cap.` } };
    return;
  }

  const ssml = buildSsml(text, body.mood);

  try {
    const ttsRes = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'ambientpixels-nova-voice'
      },
      body: ssml
    });

    if (!ttsRes.ok) {
      const detail = await ttsRes.text();
      context.log.error('[NovaVoiceTTS] Azure Speech error:', ttsRes.status, detail.substring(0, 300));
      context.res = { status: 502, headers: corsHeaders, body: { error: 'Voice synthesis failed.', status: ttsRes.status } };
      return;
    }

    const audio = Buffer.from(await ttsRes.arrayBuffer());
    context.log('[NovaVoiceTTS] OK —', text.length, 'chars ->', audio.length, 'bytes');
    context.res = {
      status: 200,
      headers: Object.assign({ 'Content-Type': 'audio/mpeg' }, corsHeaders),
      body: audio,
      isRaw: true
    };
  } catch (err) {
    context.log.error('[NovaVoiceTTS] Internal error:', err.message);
    context.res = { status: 500, headers: corsHeaders, body: { error: 'Voice synthesis fault.', details: err.message } };
  }
};
```

- [ ] **Step 3: Syntax-check both files**

Run: `node -e "require('./api/nova-voice-tts/index.js'); console.log('loads OK')"`
Expected: `loads OK` (the module loads; it only reads env at request time)

- [ ] **Step 4: Commit**

```bash
git add api/nova-voice-tts/index.js api/nova-voice-tts/function.json
git commit -m "feat(nova-voice): Azure Speech TTS function with mood-styled SSML"
```

---

### Task 3: Provision Azure Speech + app settings

**Files:** none (Azure CLI only). **Requires user-visible cost decision: F0 tier is free; confirm with user before creating the resource if anything is unclear.**

- [ ] **Step 1: Check the function app's region (co-locate Speech with it)**

```bash
MSYS_NO_PATHCONV=1 az functionapp show --name ambientpixels-nova-api --resource-group ambientpixelsV2 --query location -o tsv
```
Expected: a region string (e.g. `West US 2`). Use its compact form (e.g. `westus2`) as `<REGION>` below.

- [ ] **Step 2: Create the Speech resource (F0 free tier)**

```bash
MSYS_NO_PATHCONV=1 az cognitiveservices account create --name ambientpixels-speech --resource-group ambientpixelsV2 --kind SpeechServices --sku F0 --location <REGION> --yes
```
Expected: JSON with `"provisioningState": "Succeeded"`. If F0 is unavailable in that region, STOP and ask the user before choosing S0 (paid).

- [ ] **Step 3: Get the key**

```bash
MSYS_NO_PATHCONV=1 az cognitiveservices account keys list --name ambientpixels-speech --resource-group ambientpixelsV2 --query key1 -o tsv
```

- [ ] **Step 4: Set app settings on the function app**

```bash
MSYS_NO_PATHCONV=1 az functionapp config appsettings set --name ambientpixels-nova-api --resource-group ambientpixelsV2 --settings SPEECH_KEY=<KEY_FROM_STEP_3> SPEECH_REGION=<REGION>
```
Expected: settings list JSON including `SPEECH_KEY` and `SPEECH_REGION`. Do NOT add these to `local.settings.json` (do-not-touch file).

---

### Task 4: Orb CSS

**Files:**
- Create: `css/nova-voice.css`

Conventions (from MEMORY/css rules): kebab-case with `nova-voice-` prefix, `--` modifiers, all animations prefixed `nova-voice-*`, theme tokens (`--aura-glow`) not raw hex — the live aura color arrives at runtime as `--nova-voice-aura` set from Nova's mood JSON.

- [ ] **Step 1: Create the stylesheet**

Create `css/nova-voice.css`:

```css
/* File: /css/nova-voice.css — Nova Voice lab experimental (orb + transcript) */
/* States are driven by [data-state] on .nova-voice-orb: idle | listening | thinking | speaking */

.nova-voice-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 2rem 1rem;
}

.nova-voice-orb {
  --nova-voice-aura: var(--aura-glow);
  width: 140px;
  height: 140px;
  border-radius: 50%;
  border: 2px solid var(--nova-voice-aura);
  background: radial-gradient(circle at 35% 35%, var(--nova-voice-aura), transparent 70%);
  box-shadow: 0 0 24px var(--nova-voice-aura);
  cursor: pointer;
  user-select: none;
  touch-action: none;
  transition: transform 0.2s ease, box-shadow 0.3s ease, opacity 0.3s ease;
  animation: nova-voice-breathe 5s ease-in-out infinite;
}

.nova-voice-orb[data-state="listening"] {
  transform: scale(1.12);
  animation: nova-voice-pulse 0.9s ease-in-out infinite;
}

.nova-voice-orb[data-state="thinking"] {
  animation: nova-voice-think 1.4s linear infinite;
}

.nova-voice-orb[data-state="speaking"] {
  animation: nova-voice-ripple 1.1s ease-out infinite;
}

.nova-voice-orb--disabled {
  opacity: 0.35;
  cursor: not-allowed;
  animation: none;
}

@keyframes nova-voice-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}

@keyframes nova-voice-pulse {
  0%, 100% { box-shadow: 0 0 24px var(--nova-voice-aura); }
  50% { box-shadow: 0 0 56px var(--nova-voice-aura); }
}

@keyframes nova-voice-think {
  0% { filter: hue-rotate(0deg) brightness(1); }
  50% { filter: hue-rotate(25deg) brightness(1.25); }
  100% { filter: hue-rotate(0deg) brightness(1); }
}

@keyframes nova-voice-ripple {
  0% { box-shadow: 0 0 0 0 var(--nova-voice-aura), 0 0 24px var(--nova-voice-aura); }
  100% { box-shadow: 0 0 0 28px transparent, 0 0 24px var(--nova-voice-aura); }
}

.nova-voice-mood {
  font-size: 0.95rem;
  opacity: 0.8;
  text-align: center;
  min-height: 1.4em;
}

.nova-voice-hint {
  font-size: 0.85rem;
  opacity: 0.55;
  text-align: center;
}

.nova-voice-log {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-height: 320px;
  overflow-y: auto;
}

.nova-voice-log-entry {
  padding: 0.5rem 0.9rem;
  border-radius: 10px;
  line-height: 1.45;
  opacity: 0.9;
}

.nova-voice-log-entry--user {
  align-self: flex-end;
  border: 1px solid var(--nova-voice-aura, var(--aura-glow));
}

.nova-voice-log-entry--nova {
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.05);
}

.nova-voice-log-entry--note {
  align-self: center;
  font-size: 0.8rem;
  opacity: 0.5;
  font-style: italic;
}

.nova-voice-fallback {
  display: none;
  width: 100%;
  max-width: 640px;
  gap: 0.5rem;
}

.nova-voice-fallback--visible {
  display: flex;
}

.nova-voice-fallback input {
  flex: 1;
  padding: 0.6rem 0.9rem;
  border-radius: 8px;
  border: 1px solid var(--nova-voice-aura, var(--aura-glow));
  background: transparent;
  color: inherit;
  font: inherit;
}

@media (max-width: 600px) {
  .nova-voice-orb { width: 110px; height: 110px; }
  .nova-voice-log { max-height: 240px; }
}
```

- [ ] **Step 2: Commit**

```bash
git add css/nova-voice.css
git commit -m "feat(nova-voice): orb and transcript styles"
```

---

### Task 5: Lab page shell

**Files:**
- Create: `lab/nova-voice.html`

- [ ] **Step 1: Create the page**

Follows `lab/nova-ai-test.html` conventions (same head CSS set, banner, `#nav-header`, mini-hero, `#footer-container`), trimmed script list. Create `lab/nova-voice.html`:

```html
<!-- File: /lab/nova-voice.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Nova Voice — push-to-talk conversation with Nova" />
  <link rel="icon" href="/images/favicon.ico" type="image/x-icon" />
  <title>Nova Voice — Lab</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/base.css" />
  <link rel="stylesheet" href="/css/grid.css" />
  <link rel="stylesheet" href="/css/nav.css" />
  <link rel="stylesheet" href="/css/components.css" />
  <link rel="stylesheet" href="/css/hero.css" />
  <link rel="stylesheet" href="/css/theme.css" />
  <link rel="stylesheet" href="/css/banner.css" />
  <link rel="stylesheet" href="/css/nova-voice.css" />
</head>
<body data-theme="dark">
  <div class="banner-container" id="banner-container">
    <div class="banner">
      <i class="fas fa-flask banner-icon"></i>
      <span>Lab Experimental — Nova Voice. Push to talk.</span>
      <button class="banner-close" aria-label="Close Banner">×</button>
    </div>
  </div>

  <header id="nav-header"></header>

  <section class="mini-hero">
    <img src="/images/hero-23.jpg" alt="Mini Hero" class="mini-hero-img" loading="lazy">
    <h1>Nova Voice</h1>
  </section>

  <main class="grid-container">
    <section class="grid-col-12 content-section neon-card">
      <div class="nova-voice-stage">
        <div class="nova-voice-orb" id="nova-voice-orb" data-state="idle" role="button" tabindex="0" aria-label="Hold to talk to Nova"></div>
        <div class="nova-voice-mood" id="nova-voice-mood">tuning in…</div>
        <div class="nova-voice-hint" id="nova-voice-hint">Hold the orb and speak. Release to send.</div>
        <div class="nova-voice-fallback" id="nova-voice-fallback">
          <input type="text" id="nova-voice-input" placeholder="Type to Nova — she still answers aloud" aria-label="Message Nova" />
          <button class="btn" id="nova-voice-send" type="button">Send</button>
        </div>
        <div class="nova-voice-log" id="nova-voice-log" aria-live="polite"></div>
      </div>
    </section>
  </main>

  <footer id="footer-container"></footer>

  <script src="/js/init-header-footer.js" defer></script>
  <script src="/js/nav.js" defer></script>
  <script src="/js/main.js" defer></script>
  <script src="/js/theme.js" defer></script>
  <script src="/js/nova-voice.js" defer></script>
</body>
</html>
```

- [ ] **Step 2: Verify the `.btn` class exists in components.css (reuse, don't invent)**

Run: `grep -n "^\.btn" css/components.css | head -5`
Expected: a `.btn` rule. If the site's button class is named differently (e.g. `.button` or `.neon-btn`), use that name in the HTML above instead — search before creating.

- [ ] **Step 3: Commit**

```bash
git add lab/nova-voice.html
git commit -m "feat(nova-voice): lab page shell"
```

---

### Task 6: Client logic — orb state machine, STT, chat, TTS playback

**Files:**
- Create: `js/nova-voice.js`

- [ ] **Step 1: Create the script**

Create `js/nova-voice.js` (non-module IIFE — site convention, see `js/nova-ai.js`):

```js
// File: /js/nova-voice.js
// Nova Voice lab experimental — push-to-talk persona chat.
// Orb states: idle -> listening -> thinking -> speaking -> idle
// Spec: docs/superpowers/specs/2026-06-10-nova-voice-design.md

(function () {
  'use strict';

  var API_BASE = window.location.hostname.includes('ambientpixels.ai')
    ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
    : '/api';

  var MAX_TTS_CHARS = 600;   // mirror of server cap
  var MAX_HISTORY_TURNS = 12;

  var DEFAULT_MOOD = {
    mood: 'calm',
    auraColorHex: '#8884ff',
    emoji: '🌙',
    selfWorth: 0.7, glitchFactor: 0.1, memoryClutter: 0.3,
    awareness: 0.6, isStable: true, intensity: 0.5
  };

  var orb, moodEl, hintEl, logEl, fallbackEl, inputEl, sendBtn;
  var sessionMood = DEFAULT_MOOD;
  var history = [];          // [{role:'user'|'nova', text}]
  var state = 'idle';
  var recognition = null;
  var currentAudio = null;
  var pendingTranscript = '';

  function setState(next) {
    state = next;
    if (orb) orb.setAttribute('data-state', next);
  }

  function addLog(role, text) {
    var div = document.createElement('div');
    div.className = 'nova-voice-log-entry nova-voice-log-entry--' + role;
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // --- Mood (session-scoped, generated once via novachat mood mode) ---
  function timeLabel() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 21) return 'evening';
    return 'late night';
  }

  function applyMood(mood) {
    sessionMood = mood;
    if (/^#[0-9a-fA-F]{6}$/.test(mood.auraColorHex || '')) {
      orb.style.setProperty('--nova-voice-aura', mood.auraColorHex);
    }
    moodEl.textContent = (mood.emoji ? mood.emoji + ' ' : '') + (mood.mood || 'calm');
  }

  function fetchMood() {
    return fetch(API_BASE + '/novachat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'mood',
        message: 'Time: ' + timeLabel() + '. A visitor just opened the Nova Voice lab to speak with Nova.'
      })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) { applyMood(data && data.mood ? data.mood : DEFAULT_MOOD); })
      .catch(function () { applyMood(DEFAULT_MOOD); });
  }

  // --- Conversation round-trip ---
  function send(text) {
    if (!text || state === 'thinking' || state === 'speaking') return;
    addLog('user', text);
    setState('thinking');

    fetch(API_BASE + '/novachat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: history.slice(-MAX_HISTORY_TURNS),
        voiceMode: 'friendly'
      })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var reply = (data && data.reply) ? data.reply.trim() : 'Nova encountered a glitch in the signal...';
        history.push({ role: 'user', text: text });
        history.push({ role: 'nova', text: reply });
        addLog('nova', reply);
        return speak(reply);
      })
      .catch(function () {
        addLog('nova', 'Nova could not connect. The signal fades...');
        setState('idle');
      });
  }

  // --- TTS playback ---
  function speak(text) {
    var clipped = text.length > MAX_TTS_CHARS ? text.slice(0, MAX_TTS_CHARS - 1) + '…' : text;
    return fetch(API_BASE + '/nova-voice-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clipped, mood: sessionMood })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('tts ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        return new Promise(function (resolve) {
          var url = URL.createObjectURL(blob);
          currentAudio = new Audio(url);
          setState('speaking');
          currentAudio.onended = currentAudio.onerror = function () {
            URL.revokeObjectURL(url);
            currentAudio = null;
            setState('idle');
            resolve();
          };
          currentAudio.play().catch(function () {
            URL.revokeObjectURL(url);
            setState('idle');
            resolve();
          });
        });
      })
      .catch(function () {
        addLog('note', 'voice signal lost — text only');
        setState('idle');
      });
  }

  // --- Speech recognition (push-to-talk) ---
  function setupRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;

    recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = function (event) {
      var text = '';
      for (var i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      pendingTranscript = text.trim();
      hintEl.textContent = pendingTranscript || 'Listening…';
    };

    recognition.onerror = function (event) {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        showFallback('Microphone blocked — type instead.');
        orb.classList.add('nova-voice-orb--disabled');
      }
      setState('idle');
    };

    return true;
  }

  function startListening() {
    if (!recognition || state !== 'idle') return;
    pendingTranscript = '';
    hintEl.textContent = 'Listening…';
    setState('listening');
    try { recognition.start(); } catch (e) { /* already started */ }
  }

  function stopListening() {
    if (!recognition || state !== 'listening') return;
    recognition.stop();
    hintEl.textContent = 'Hold the orb and speak. Release to send.';
    // onresult fires before stop completes; give it a beat
    setTimeout(function () {
      var text = pendingTranscript;
      pendingTranscript = '';
      if (text) { send(text); } else { setState('idle'); }
    }, 350);
  }

  function showFallback(reason) {
    fallbackEl.classList.add('nova-voice-fallback--visible');
    if (reason) hintEl.textContent = reason;
  }

  // --- Init ---
  function init() {
    orb = document.getElementById('nova-voice-orb');
    moodEl = document.getElementById('nova-voice-mood');
    hintEl = document.getElementById('nova-voice-hint');
    logEl = document.getElementById('nova-voice-log');
    fallbackEl = document.getElementById('nova-voice-fallback');
    inputEl = document.getElementById('nova-voice-input');
    sendBtn = document.getElementById('nova-voice-send');
    if (!orb) return;

    fetchMood();

    if (setupRecognition()) {
      orb.addEventListener('pointerdown', function (e) { e.preventDefault(); startListening(); });
      orb.addEventListener('pointerup', stopListening);
      orb.addEventListener('pointerleave', stopListening);
      orb.addEventListener('keydown', function (e) {
        if (e.code === 'Space' && state === 'idle') { e.preventDefault(); startListening(); }
      });
      orb.addEventListener('keyup', function (e) {
        if (e.code === 'Space') { e.preventDefault(); stopListening(); }
      });
    } else {
      showFallback('Voice input not supported in this browser — type instead. Nova still answers aloud.');
      orb.classList.add('nova-voice-orb--disabled');
    }

    // Type-to-talk fallback (always wired; shown when needed)
    function sendTyped() {
      var text = (inputEl.value || '').trim();
      if (!text) return;
      inputEl.value = '';
      send(text);
    }
    sendBtn.addEventListener('click', sendTyped);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendTyped();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

- [ ] **Step 2: Syntax-check**

Run: `node --check js/nova-voice.js`
Expected: no output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add js/nova-voice.js
git commit -m "feat(nova-voice): push-to-talk client with orb state machine"
```

---

### Task 7: Local visual verification (Playwright)

**Files:** none committed (throwaway script in `c:\tmp`)

Per project rule: visual fixes are verified with Node Playwright against a local server — don't claim done from code alone.

- [ ] **Step 1: Start the static site locally**

From repo root: `npx serve . -l 5500` (or the user's Live Server on 5500 if already running; any static server works — API calls will fail locally, which is expected and exercises the fallback paths).

- [ ] **Step 2: Write and run the verification script**

Create `c:\tmp\nova-voice-verify.js`:

```js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', m => console.log('[console]', m.type(), m.text()));

  await page.goto('http://localhost:5500/lab/nova-voice.html');
  await page.waitForTimeout(2500);

  // Orb exists and is in a known state
  const stateAttr = await page.getAttribute('#nova-voice-orb', 'data-state');
  console.log('orb state:', stateAttr);

  // Screenshot idle
  await page.screenshot({ path: 'c:/tmp/nova-voice-idle.png' });

  // Force each visual state and screenshot
  for (const s of ['listening', 'thinking', 'speaking']) {
    await page.evaluate(st => document.getElementById('nova-voice-orb').setAttribute('data-state', st), s);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `c:/tmp/nova-voice-${s}.png` });
  }

  // Fallback path: stub out SpeechRecognition and reload
  await page.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  await page.reload();
  await page.waitForTimeout(1500);
  const fallbackVisible = await page.evaluate(() =>
    document.getElementById('nova-voice-fallback').classList.contains('nova-voice-fallback--visible'));
  console.log('fallback visible without SR:', fallbackVisible);
  await page.screenshot({ path: 'c:/tmp/nova-voice-fallback.png' });

  await browser.close();
})();
```

Run: `node c:\tmp\nova-voice-verify.js`
Expected: `orb state: idle`, `fallback visible without SR: true`, five screenshots in `c:\tmp`.

- [ ] **Step 3: Look at the screenshots**

Open each PNG with the Read tool. Verify: orb renders as a glowing circle (not a broken box), each state looks visually distinct, fallback input is visible in the last shot. Fix CSS and re-run until right — do not skip the look.

---

### Task 8: Deploy + production verification

- [ ] **Step 1: Run the full local check suite once more**

```bash
node api/nova-voice-tts/ssml.test.js && node --check js/nova-voice.js
```
Expected: `ssml.test.js: all assertions passed` and clean parse.

- [ ] **Step 2: Push to deploy (CI/CD)**

```bash
git push origin master
```
Then watch GitHub Actions workflow `azure-static-web-apps-calm-sky-05cc8e110.yml` until green (`gh run watch` or the Actions tab).

- [ ] **Step 3: curl-test the TTS function on production (one row per mapping style)**

```bash
curl -s -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/nova-voice-tts" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello. I am Nova. This is my voice.","mood":{"glitchFactor":0.1,"selfWorth":0.8,"isStable":true,"intensity":0.5}}' \
  -o /tmp/nova-friendly.mp3 -w "%{http_code} %{content_type} %{size_download}\n"
```
Expected: `200 audio/mpeg <nonzero bytes>`. Repeat with `"glitchFactor":0.8` (whispering), `"selfWorth":0.2` (sad), `"intensity":0.9,"isStable":true` (cheerful) — all should return 200 with audio. Also verify guards:

```bash
curl -s -X POST "https://ambientpixels-nova-api.azurewebsites.net/api/nova-voice-tts" -H "Content-Type: application/json" -d '{"text":""}' -w "%{http_code}\n"
```
Expected: `400`.

- [ ] **Step 4: Full round-trip on production**

Load `https://ambientpixels.ai/lab/nova-voice.html` (user does the actual mic test — Claude verifies page load, mood label populating, and no console errors via Playwright against the production URL). Check Application Insights for `nova-voice-tts` errors.

- [ ] **Step 5: Final commit of any fixes + update memory**

If fixes were needed, commit them individually. Update memory file `project_nova_voice_experimental.md` status to shipped/soaking.

---

## Self-review notes

- **Spec coverage:** architecture flow (Tasks 5-6), components table (Tasks 1-6), mood mapping (Task 1), error handling — no-SR fallback, mic-denied, novachat error, TTS failure, char cap (Tasks 2 & 6), testing (Tasks 1, 7, 8). Spec line about mood source was corrected to live `mode:'mood'` generation before planning.
- **Order matters:** mapping table in spec lists glitch row first; `pickStyle` implements first-match-wins in that order.
- **`.btn` class:** Task 5 Step 2 verifies the real button class name before relying on it (search-before-create rule).
- **No high-blast-radius files touched.** `novachat` is consumed, never modified.
