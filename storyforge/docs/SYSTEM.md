# StoryForge — System Documentation

AI-powered interactive fiction game. Players choose a genre, create a character, allocate stats, then play through a branching narrative with skill checks, inventory, companions, and AI-generated scene art + narration.

## Architecture

**Platform**: Azure Static Web Apps (static files + Azure Functions API)
**Frontend**: Vanilla HTML/CSS/JS — no framework, no build step
**AI**: Gemini API (story generation + scene images via Imagen)
**Auth**: Azure AD B2C (`.auth/me`, `.auth/login/aad`)
**Payments**: Stripe (checkout + billing webhook)
**Storage**: Azure Blob via API endpoints

## Pages

| Page | File | Purpose |
|------|------|---------|
| Hub | `index.html` | Landing page, genre showcase, saved game resume |
| Play | `play.html` | Character creation wizard + active gameplay |
| Gallery | `gallery.html` | Browse/share completed adventures |

## JavaScript Modules (~5,900 lines total)

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `adventure-engine.js` | 2,787 | Core game loop: wizard flow, turn processing, scene rendering, choices, dice rolls, bottom sheet sidebar, save/load coordination |
| `adventure-ai.js` | 815 | Gemini API calls: story generation, scene image generation, portrait generation, TTS narration |
| `adventure-gallery.js` | 530 | Gallery page: load shared adventures, card rendering, filters |
| `adventure-rpg.js` | 407 | RPG mechanics: stat checks, XP/leveling, inventory, companions, combat |
| `adventure-audio.js` | 320 | Ambient music + SFX playback, genre-matched playlists, volume controls |
| `adventure-app.js` | 239 | Hub page: genre cards, saved game cards, continue flow |
| `adventure-entitlements.js` | 204 | Pro/free tier logic, daily usage limits, Stripe integration |
| `adventure-ui.js` | 189 | Shared UI utilities: `$()`, `escapeHtml()`, toast notifications, modal helpers |
| `adventure-tutorial.js` | 185 | First-time tutorial overlay system |
| `adventure-storage.js` | 166 | LocalStorage + server save/load abstraction |
| `adventure-share.js` | 59 | Share/export adventure (URL + clipboard) |

### Module dependency order (play.html)
Scripts load with `defer` in this order:
1. `adventure-audio.js` — no deps
2. `adventure-ui.js` — no deps (exposes `UI` global)
3. `adventure-rpg.js` — uses `UI`
4. `adventure-storage.js` — no deps
5. `adventure-share.js` — no deps
6. `adventure-ai.js` — uses `UI` (exposes `AI` global)
7. `adventure-entitlements.js` — uses auth (exposes `Ent` global)
8. `adventure-engine.js` — uses all above (main orchestrator)
9. `adventure-tutorial.js` — uses `UI`, engine events

## CSS Architecture (~6,800 lines total)

| File | Lines | Scope |
|------|-------|-------|
| `adventure-base.css` | 417 | Design tokens (`--sf-*`), layout, header, buttons, panels, typography |
| `adventure-play.css` | 2,757 | Play screen: scene panel, choices, sidebar, dice, ending, immersive mode |
| `adventure-particles.css` | 1,616 | Genre-specific particle animations on scene images |
| `adventure-gallery.css` | 787 | Gallery card grid, filters, detail modal |
| `adventure-hub.css` | 512 | Hub landing: hero, genre showcase, saved games |
| `adventure-effects.css` | 205 | Shared effects: glows, transitions, shimmer, fadeIn |
| `adventure-responsive.css` | 471 | Mobile breakpoints (900px, 768px, 600px, 480px) |

### Design tokens (defined in adventure-base.css `:root`)
- Backgrounds: `--sf-bg-deep`, `--sf-bg-surface`, `--sf-bg-elevated`
- Accent: `--sf-accent` (#7C3AED), `--sf-accent-rgb`, `--sf-cta` (#F43F5E)
- Text: `--sf-text`, `--sf-text-muted`, `--sf-text-dim`
- Semantic: `--sf-success`, `--sf-danger`, `--sf-warning`, `--sf-info`
- Fonts: `--sf-font-display` (Russo One), `--sf-font-body` (Chakra Petch)
- Glass: `--sf-glass-blur`, `--sf-glass-border`

### Responsive breakpoints
- **900px**: Play layout stacks vertical, sidebar becomes bottom sheet
- **768px**: Wizard stats stack vertical
- **600px**: Genre grid 2-col, smaller fonts, hide wizard step labels
- **480px**: Header compact (hide logo text), turn bar wraps audio controls, choice keys hidden

### Mobile bottom sheet (sidebar on <900px)
- Sidebar becomes `position: fixed; bottom: 0` with `max-height: 110px` collapsed
- JS (`initBottomSheet()` in engine.js:2737) injects drag handle + mini summary bar
- Handle CSS: shown on mobile via `@media(max-width:900px)`, hidden on desktop via `@media(min-width:901px)`
- Tap handle or swipe to expand to 70vh showing all stat panels
- Mini bar shows HP, Turn, Gold summary when collapsed

## API Endpoints (Azure Functions)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/storyforgesave` | POST | Save game state to Azure Blob |
| `/api/storyforgeload` | GET | Load saved game from Azure Blob |
| `/api/storyforgegallery` | GET/POST | List/submit shared adventures |
| `/api/storyforgeshare` | GET | Get shareable adventure data |
| `/api/storyforge-entitlements` | GET | Check user's pro/free tier |
| `/api/storyforge-checkout` | POST | Create Stripe checkout session |
| `/api/storyforge-billing-webhook` | POST | Stripe webhook for payment events |

## Game Flow

### Character Creation (3-step wizard)
1. **Genre Select** — pick from 7 genres (fantasy, horror, scifi, detective, postapoc, pirate, superhero) + optional character name
2. **Appearance** — gender, race/archetype, build, hair + portrait generation (Imagen)
3. **Stats** — archetype presets or manual allocation (40-point budget), difficulty, ironman toggle, narrator toggle

### Gameplay Loop
1. AI generates opening scene (text + image)
2. Player picks from 3-4 choices (some require skill checks)
3. Skill checks roll d20 + stat modifier vs DC
4. Choices affect HP, XP, inventory, companions, reputation
5. After max turns (default 25), AI generates ending
6. Ending screen: stats summary, star rating, share, play again

### Genres (defined in `data/genres.json`)
Each genre configures: starting stats, inventory, image style hints, stat hints, archetype presets, character options (gender, race, build, hair, attire), ambient music tracks, and a detailed narrative prompt.

**Available**: fantasy, horror, scifi, detective, postapoc, pirate, superhero

## Audio System
- **Ambient music**: Genre-matched MP3 playlists in `audio/ambient/` (3-4 tracks per genre)
- **SFX**: UI sounds in `audio/sfx/` (dice rolls, combat hits, level up, item pickup, etc.)
- **TTS Narration**: AI-generated voice narration per scene (toggle on/off)
- Two volume sliders: narration + ambient (visible in turn bar)

## Entitlements (Free vs Pro)
- **Free**: 3 adventures/day, basic genres, no cloud saves
- **Pro**: Unlimited adventures, all genres, cloud saves, priority generation
- Managed via `adventure-entitlements.js` + `/api/storyforge-entitlements`

## Asset Cache Busting
All CSS and JS references in HTML use `?v=YYYYMMDD[letter]` query params to bust Azure SWA's 7-day CDN cache (`Cache-Control: public, max-age=604800, immutable`). **Bump the version when changing any CSS or JS file.**

Current version: `?v=20260310c`

## Key Conventions
- BEM-ish CSS naming: `.adv-{block}__{element}--{modifier}`
- All CSS custom properties prefixed `--sf-*`
- No CSS framework — all hand-written
- Desktop-first responsive (max-width breakpoints)
- No build step — files served as-is
- Game state stored in `gameState` object inside engine.js IIFE
- Globals: `UI`, `AI`, `Ent`, `RPG`, `Audio`, `Storage`, `Share`

## Files with high blast radius
- `adventure-engine.js` — 2,787 lines, orchestrates everything
- `adventure-play.css` — 2,757 lines, all play screen styles
- `adventure-responsive.css` — all mobile breakpoints
- `data/genres.json` — genre config affects AI prompts, stats, character options
- `adventure-ai.js` — all AI API calls
