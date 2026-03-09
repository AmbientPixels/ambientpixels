# StoryForge Design Overhaul Plan

## Phase 1 — Color System, Typography & Glass Panels (COMPLETE)
- `--sf-*` design token system (30+ custom properties)
- Electric violet (#7C3AED) accent, rose (#F43F5E) CTA, emerald (#34D399) success
- Russo One (display) + Chakra Petch (body) typography
- Glass morphism panels with `backdrop-filter: blur()`
- Genre-adaptive theming via `[data-genre]` CSS overrides
- Gradient primary buttons, glow shadows, neon effects
- 13 files modified, deployed `7ace3475`

## Phase 2 — Narrative Drift Scene Art + Play Screen (IN PROGRESS)
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

### 2b: Play Screen Layout (PENDING)
- Immersive mode toggle (hide sidebar, full-width scene)
- Improved dice roll animation with genre-themed effects
- Scene transition animations between turns
- Narration panel refinements

## Phase 3 — Hub Redesign + Genre Theming (PENDING)
- Genre card hover previews with animated backgrounds
- Saved adventure cards with progress visualization
- Genre-specific ambient particles on hover
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

## Phase 5 — Gallery Overhaul + Social Features (PENDING)
- Masonry/Pinterest-style grid layout
- Adventure detail modal redesign
- Share cards with scene art preview
- Filtering and sort improvements

## Phase 6 — Mobile UX + Performance (PENDING)
- Touch gesture navigation (swipe for choices)
- Bottom sheet UI for mobile sidebar
- Lazy loading and image optimization
- `prefers-reduced-motion` support for all animations
- Performance audit and bundle optimization
