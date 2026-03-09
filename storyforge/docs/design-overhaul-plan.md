# StoryForge Design Overhaul Plan

## Phase 1 — Color System, Typography & Glass Panels (COMPLETE)
- `--sf-*` design token system (30+ custom properties)
- Electric violet (#7C3AED) accent, rose (#F43F5E) CTA, emerald (#34D399) success
- Russo One (display) + Chakra Petch (body) typography
- Glass morphism panels with `backdrop-filter: blur()`
- Genre-adaptive theming via `[data-genre]` CSS overrides
- Gradient primary buttons, glow shadows, neon effects
- 13 files modified, deployed `7ace3475`

## Phase 2 — Narrative Drift Scene Art + Play Screen (COMPLETE)
### 2a: Narrative Drift — Interactive Loading Art (COMPLETE)
- p5.js algorithmic art in the scene image placeholder while AI images generate
- Genre-adaptive particle physics: each genre has unique field dynamics
  - Fantasy: spiraling vortices in violet
  - Horror: jagged, erratic fragments in red
  - Sci-fi: clean orbital paths in cyan
  - Detective: methodical grid convergence in amber
  - Post-apocalyptic: gravitational decay scatter in green
  - Pirate: sweeping wave arcs in orange
- Interactive: mouse/touch acts as narrative attractor (inverse-square force)
- Dissolve animation when scene image arrives
- Files: `adventure-scene-art.js` (new), `adventure-engine.js` (modified), `play.html` (p5.js CDN), `adventure-play.css` (placeholder z-index)
- Philosophy doc: `docs/narrative-drift-philosophy.md`

### 2b: Play Screen Layout (COMPLETE)
- Immersive mode toggle (hide sidebar, full-width scene)
- Improved dice roll animation with genre-themed effects
- Scene transition animations between turns
- Narration panel refinements

## Phase 3 — Hub Redesign + Procedural Audio (COMPLETE)
- Genre card hover previews with animated backgrounds
- Saved adventure cards with progress visualization
- Procedural audio system (Web Audio API)
- Quick-start flow improvements

## Phase 4 — Character Creation Wizard + Progression (COMPLETE)
- 3-step wizard: Genre → Appearance & Portrait → Stats & Archetype
- Animated step transitions with slide/fade between panels
- Step indicator bar with numbered dots, progress lines, done/active states
- Portrait frame with animated conic-gradient glow ring (genre-colored, spins)
- Archetype cards: visual cards with icon, name, stat summary (replaces plain buttons)
- Stat radar chart: canvas-drawn spider/polygon chart updates live as sliders move
- XP/Level progression system: XP bar in sidebar, 6 levels, awards for choices/checks/items/companions
- Level-up toast notification with SFX and badge animation
- Level + XP displayed on ending screen
- Responsive: stats layout stacks on tablets, step labels hide on mobile

## Phase 5 — Gallery Overhaul + Social Features (COMPLETE)
- Masonry/Pinterest-style layout with CSS columns (3→2→1 responsive)
- Staggered card entrance animations with genre-colored overlay badges
- Gallery stats bar: total adventures, victories, defeats, genre count
- Search bar with debounced filtering across player name, character, genre, ending text
- Sort dropdown: newest, oldest, most/fewest turns, highest level
- Client-side filtering + sorting with server-side pagination
- Enhanced cards: thumbnail zoom on hover, character info, level badge, share button, date
- Redesigned detail modal: hero image with gradient overlay, slide-up animation, backdrop blur
- Character info section in detail view
- Color-coded stat values (HP=red, gold=amber, rep=blue, level=accent)
- Ending text styled as blockquote with accent border
- Event timeline section with labeled event chips
- Body scroll lock when modal is open
- Share button on individual cards (clipboard copy)
- Mobile: bottom-sheet modal style, horizontal-scroll filters, stacked controls

## Phase 6 — Mobile UX + Performance (COMPLETE)
- Touch swipe gesture navigation: horizontal swipe on choices container cycles highlighted choice with visual glow ring
- Bottom sheet sidebar: on mobile (≤900px), sidebar becomes a fixed bottom panel with drag handle, mini HP/turn/gold summary, swipe or tap to expand/collapse (max 70vh)
- Lazy loading: `loading="lazy"` on all images (hub hero, genre cards, gallery cards, saved thumbnails, scene images), IntersectionObserver on gallery "Load More" for automatic infinite scroll
- `prefers-reduced-motion` support: CSS kills all animations/transitions, particles hidden; JS skips typewriter (instant text), dice roll animation (instant result), scene exit transitions
- Performance: all scripts use `defer`, `preconnect` to Google Fonts + gstatic, reduced DOM thrashing in sidebar updates
