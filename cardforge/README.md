# CardForge V2 - Deployment Ready

> *"Everyone's the hero of their own card."*

---

## 📌 Project Summary
CardForge V2 is a production-ready, browser-based toolkit for designing, editing, and sharing collectible RPG-style identity cards. The application features a robust frontend with secure API integration, input validation, and error handling. Built with modern JavaScript and following the Windsurf Protocol for consistent UI/UX.

---


New phoase 7/27
🃏 CardForge Design Hierarchy — Refined Definitions
🔷 Theme = Layout Structure
The visual structure and composition of the card.

Examples:

Left-Aligned

Centered Bio

Image-Bottom

Reverse Layout (Back-first reveal)

Grid (compact stat cluster)

Stacked Portrait

Cinematic Split (image + quote overlay)

🔧 This defines where and how elements like avatar, text, stats, and badges are positioned.

🌈 Variant = Color Palette & Style
The mood + color system layered on top of the theme.

Examples:

Light

Dark

Neon

Pastel

Nova (AI-based dynamic aura)

Retro Print (faded ink look)

Frosted Cyber

🔧 This alters borders, backgrounds, gradients, type color, etc.—but keeps the layout intact.

✅ Rename: This could be labeled Color Style or Visual Skin to clarify it's a color modifier, not a structural change.

🖼 Image Style = Frame & Format Type
Defines how the avatar or main art is framed.

Examples:

Masked (circle, square, hexagon)

Full-bleed (fills top/bottom, edge-to-edge)

Hero (takes up top 1/3)

Mini Icon (compact inline thumbnail)

🔧 This modifies the shape, borders, and placement of the image field—not the layout around it.

🎨 Image Variant = Presentation Treatment
Adds visual filters or design flourishes to the image within its style.

Examples:

Glow Aura

Vintage Filter

Pixel Mask

Ink Sketch Overlay

Motion Blur (for animated cards)

Monochrome (class-locked palette)

🔧 Think of this as the FX layer: does not change shape or size, just presentation.

🧠 Suggested Label Updates (for clarity)
Current Label	Suggested Label	Notes
Theme	Layout Theme	To clarify it's structure/layout
Variant	Color Variant or Visual Skin	Clarifies it's about palette
Image Style	✅ Keep	Clear and appropriate
Image Variant	✅ Keep or rename to Image Treatment	Optional rename if needed for clarity

🧭 Bonus: Future Flexibility
Each of these layers can be extended independently:

Add a new Layout Theme = introduces a new structural experience

Add a new Color Variant = fresh palette without affecting layout

Add new Image Styles/Variants = lets users remix existing cards without recreating from scratch

Would you like a Figma-ready breakdown of this hierarchy for your design system? Or a prompt to hand off to Windsurf to restructure the schema logic?






You said:
ok next lets brainsorm how the UI presents these items. For exampel now its just text dropdowns. but I want a more visual and compact experience. for example when you click the color variant it displays teh actual color pallette. Or when you click the Theme its shows a demo or a very small rener of the card to show an example. then the same for teh otehr dropdowns. ideas here?


ChatGPT said:
Yes — this is the perfect moment to move from form-based selection to a more visual, immersive UI model. Let's evolve these dropdowns into interactive mini-preview pickers, without overwhelming the layout.

✨ UI Concept Upgrade – CardForge Design Pickers
1. 🔷 Theme (Layout Style) → Mini Card Thumbnails Grid
Show a series of miniature card previews, each demonstrating the structure.

UI Ideas:

Display 4–6 card mockups at ~120x70px

Hover: shows name + brief description ("Left-Aligned", "Stacked Portrait")

On click: selects, highlights with glow/border

Optional: include animated transitions between themes

🧠 Bonus: Use real user data (name, image, stats) in these previews to show their card in that layout.

2. 🌈 Color Variant → Live Palette Swatches
Replace dropdown with a row/grid of colored buttons.

UI Ideas:

Each button shows the core color triad (bg, text, accent)

Hover: expand to show more of the palette

Click = live preview applied instantly to the main card

Group by mood? (e.g., Warm, Cool, Glitchy)

🎨 You could even generate these dynamically using the Cascade theme tokens.

3. 🖼 Image Style → Shape Selector with Previews
Visual selector that previews mask shapes or formats.

UI Ideas:

Show the avatar in each mask shape (circle, hex, square, edge-to-edge)

Use soft borders or shadows to show masked area

Add labels like “Masked (Circle)”, “Full Bleed”, “Hero Top”

💡 You can use SVG clips or CSS mask to generate these dynamically.

4. 🎨 Image Variant → Effect Filters Preview Strip
Small effect previews showing visual treatments.

UI Ideas:

Horizontal scrollable strip of image thumbnails with filters applied

Label each (e.g., “Glow”, “Sketch”, “Pixel”, “Muted”)

Optional: hover for before/after toggle

⚡ Tip: Apply these with CSS filters or canvas overlays in preview mode.

🧱 Suggested Layout Pattern
Here's how you might arrange this visually in the "Card Design" section:

scss
Copy
Edit
[ Card Design ]

[ Theme ]
[🟪 left-align] [🟨 centered] [🟥 stacked] [⬜ grid]  ← mini cards

[ Color Style ]
[🟡🟣🟢] [⚪⚫🟣] [🟥🟨🟦]  ← palette blocks

[ Image Style ]
(o) Circle   [□] Square   [⬜↕] Hero   [▭] Full

[ Image Effect ]
[Glow] [Pixel] [Vintage] [Ink Sketch]  ← image thumbnails
🧬 Mood-Responsive Bonus
If Nova’s mood or user-selected aura is active:

Slightly bias default selections to match

Add subtle highlights around themes that “match the vibe”

Would you like a Figma wireframe or prompt to give to Windsurf to build these into the UI layer? Or do we mock this up next in code?






You said:
lets also add in a back image. also the ability to add a border and border color. also the ability to add a background effect ike a backgound particle effect and otehr effects. 


ChatGPT said:
Perfect — let’s expand the Card Design system to support those aesthetic depth layers. These additions will help users craft truly unique cards that feel dimensional and ambient. Here's how we can structure and visualize the expanded options:

🔮 New Design Options for CardForge
🂠 Back Image
Add a second image (or stylized graphic) shown on the back side of the card when flipped.

UI Ideas:

New section: Back of Card

Use same artwork gallery + custom URL input

Optional toggle: “Use same image as front”

Live preview when card is flipped

📌 You could allow different styles for the back (e.g., sigils, sigil + quote, pure art).

⬜ Border & Border Color
Enable frame control to create elegant, minimal, or vibrant card borders.

UI Options:

Toggle border on/off

Choose style: None, Thin, Bold, Double, Etched

Pick color: system palette or custom HEX

🧠 Borders can also be mood-bound (e.g. glow on hover, animated pulse).

✨ Background Effect
Bring the canvas to life with subtle or ambient background visuals.

Effect Examples:

Particles (floating dust, glimmers)

Nebula Drift (slow-moving cloudy gradient)

Noise Texture (film grain, CRT shimmer)

Flux Lines (subtle animated grid)

Reactive Mood Flow (changes with theme or stats)

UI Ideas:

Toggle background FX on/off

Dropdown or visual picker of 4–6 effect styles

Opacity slider: None → Subtle → Bold

Optional: attach effect to aura/mood

🧱 Suggested Updated UI Layout (Compact & Modular)
Here’s how the Card Design tab could now be structured:

📐 Layout + Style
Layout Theme → Mini card previews

Color Variant → Color swatch buttons

Border Style → Dropdown (None, Thin, Bold)

Border Color → Palette selector + HEX

Background FX → Dropdown or visual strip

🖼 Artwork
Image Style → Mask shape/placement selector

Image Variant → Filter/effect preview strip

🂠 Back of Card
Back Image → Gallery + URL input

Mirror front image? → Toggle

Back FX Variant → Optional (sepia, scroll effect, card flip trail?)

🧪 Optional Advanced Panel (Toggle Open)
To avoid cluttering the basic UI, you could hide some of these behind a button like:

🎛️ Advanced Visual Settings ▼

Inside:

Border tweaks

FX tuning

Mood-reactive options

Experimental: AI style remix

Would you like a design prompt for Windsurf to begin wiring this into the form editor, or should we prototype a UI layout first? I can help draft the card JSON schema changes too.






You said:
we also need to add toggles for all components basically the ability to turn off and etire section. for example a toggle for class or rarity or quote. Name is required. a toggle for stats,soci, badges can all be controlled with teh add and remove features. maybe a an all up toggle for these? Name and bio shoudl be required so no need to adjust these . also im seeing that wen I dont have much content on the back of teh card and have more content on teh front the two front and back are different sizes. Can we have it work to where the card will still dynamically be sized in hight with ammont of cotent the contnt as it works now. but whih ever cad has teh most content the other sid adopts this size? Make sense? 


ChatGPT said:
Yes — all of this makes perfect sense, and you're articulating exactly the kind of modular, flexible UX that CardForge needs to feel truly customizable without breaking the visual integrity.

Let’s break it down and design both the feature controls and the dynamic sizing behavior cleanly:

✅ 1. Toggle Controls for Card Sections
🧩 Component Visibility Toggles
You want users to be able to hide or show entire sections, except for required ones like Name and Bio.

Section	Toggleable?	Notes
Name	❌ Required	Always visible
Bio / Quote	❌ Required	Wrap to multi-line if long
Class	✅ Yes	Toggle visibility
Rarity	✅ Yes	Toggle visibility
Stats	✅ Yes	Controlled via “Add Stat” list
Social	✅ Yes	Controlled via “Add/Remove” links
Badges	✅ Yes	Controlled via badge builder UI
Attributes	✅ Yes	Same as stats (schema-based)

🧠 Suggested UI Implementation
Add a “Show/Hide Sections” button or tab

Opens a checklist-style toggle menu

Sections toggle live (card preview updates immediately)

Add hover tooltips for guidance (e.g. “Turn off rarity if not relevant to your character”)

Optional: Global toggles for "Gameplay Info" / "Social Info" / "Cosmetic Info" bundles

🪞 2. Back/Front Height Syncing
🪜 Current Behavior:
Cards auto-size to content height, which is ideal

But: if front = tall, back = short → results in height flicker on flip

🔧 Fix / Enhancement:
Whichever side is taller, that height becomes the baseline for both.

📐 Implementation Suggestion (CSS + JS):
On card render or flip:

Measure height of .card-front and .card-back

Set container to max(front.height, back.height)

Allow this value to update if content dynamically changes

JS Pseudocode:

js
Copy
Edit
const frontHeight = frontEl.offsetHeight;
const backHeight = backEl.offsetHeight;
const maxHeight = Math.max(frontHeight, backHeight);
cardContainer.style.height = `${maxHeight}px`;
Bonus: Animate height changes smoothly to reduce visual jank

css
Copy
Edit
.card-container {
  transition: height 0.3s ease-in-out;
}
🧬 Summary of Additions to Implement
✅ New Features
Toggle controls for card sections

All-up visibility settings panel

Height-sync logic across front/back views

⚙️ Settings Architecture Suggestion
Update card JSON schema:

json
Copy
Edit
{
  "show": {
    "class": true,
    "rarity": true,
    "stats": true,
    "social": true,
    "badges": false
  },
  "required": {
    "name": true,
    "bio": true
  }
}
Do you want me to prep a Windsurf design + implementation prompt to tackle all of this in the UI layer? Or wireframe the new “Section Toggles” modal in Figma logic?






You said:
ok lets put all of the results of teh braibstorm for an large update and a major sub version release.  


ChatGPT said:
Absolutely — here’s a structured summary of everything we’ve brainstormed for a major CardForge update, suitable for a v2.5 milestone or even a v3.0 release candidate. It includes all UI/UX improvements, system architecture changes, and visual upgrades we've discussed.

🃏 CardForge v2.5 – Modular Expression Update
"Every card a signature. Every detail a choice."

🌟 Major Features & Enhancements
1. Visual Design Selectors (New UI)
Replace basic dropdowns with interactive, compact pickers.

✅ Theme (Layout)
Shows live mini-card thumbnails

Previews structural changes (left-aligned, stacked, image-bottom, grid)

✅ Color Variant (Palette)
Replaces text list with color swatches

Hover to preview palette, click to apply

✅ Image Style
Preview of masked shapes (circle, square, hex, hero)

Click to select frame type

✅ Image Variant
Shows effect overlays (glow, pixel, sketch, blur)

Real-time previews on image

2. Back of Card Customization
Upload/select a separate back image

Toggle: “Use same image as front”

Future: visual layout differences (sigil-only mode, lore style, etc.)

3. Card FX Layer
Add ambient background effects:

Particles

Glimmer/film grain

Mood drift (aura-based)

CRT static

Adjustable intensity (None, Subtle, Bold)

4. Border Customization
Toggle border visibility

Choose from styles: Thin, Bold, Etched, Glow

Select border color (palette + custom HEX)

5. Section Toggles & Visibility Controls
New toggle system for fine control of what displays on the card.

✅ Toggleable Sections:
Class

Rarity

Stats

Social

Badges

Attributes

❌ Non-Toggleable (Always Required):
Name

Bio/Quote

UI:
“Show/Hide Sections” button

Checklist-style toggles

Live preview updates

6. Smart Card Resizing (Front ↔ Back Parity)
No more flicker on flip.

On render/flip: measure front and back height

Set shared height = max(front, back)

Animate height transitions smoothly

7. Updated Card JSON Schema
Introduce structure for modular control and future theming:

json
Copy
Edit
{
  "design": {
    "theme": "left-align",
    "colorVariant": "nova",
    "imageStyle": "masked",
    "imageVariant": "glow",
    "backImage": "url_or_id",
    "fx": {
      "background": "particles",
      "intensity": "subtle"
    },
    "border": {
      "enabled": true,
      "style": "etched",
      "color": "#9dff5c"
    }
  },
  "sections": {
    "class": true,
    "rarity": true,
    "stats": false,
    "social": true,
    "badges": false,
    "attributes": true
  }
}
🔧 Developer/Editor Notes
Ensure preview renderer handles dynamic height sync

Theme/token system should expose FX and border options as CSS vars

Toggle system should hide DOM elements cleanly, not just visually

Back-of-card layout system should support independent themes (future-proofing)

🧠 Optional Add-Ons (Post v2.5)
User-defined custom themes

Save/preset favorite layouts

Responsive preview resizing for mobile formats

AI-powered “remix” for themes, color, or layout


## 🚀 Current Status: Production-Ready & Anonymous Access (July 25, 2025)

### ✅ Completed
- Core card creation, editing, and publishing functionality
- New Card Design tab created as first tab — combines Theme, Variant, and Artwork tools into a unified layout
- Renamed former "Artwork" tab and repositioned it to improve UX flow
- Grouped visual controls (style variant, image picker, custom image URL) under Card Design for consistency
- Improved real-time card preview response to visual changes
- Structured tab flow to begin with card appearance, followed by Basics, Stats, Social, Badges, and Attributes
- All CardForge API endpoints now allow anonymous access—no authentication required
- Secure API integration with CSRF protection (not tied to authentication)
- Input validation, sanitization, and robust error handling throughout
- Responsive design with Nova/Windsurf Protocol compliance
- Live Preview: real-time front/back flip with toggle button (CSS 3D flip effect)
- Extended attributes: rarity, bio, superpower, alignment, origin, faction, badge, and JSON-based stats
- Visual stat bars: progress-based bars for stats objects, animated on update
- Theme selector: NeoFantasy, SynthwaveHacker, ProPersona wired to preview via theme classes
- Removed legacy preview & delete buttons; clean editor and sidebar UI
- All CardForge frontend JS and CSS fully reviewed for auth remnants—none remain
- Staticwebapp.config.json routes explicitly allow ["anonymous"] for all CardForge endpoints
- Managed Identity and Storage Blob Data Contributor role configured for backend
- Fixed modal dialog system with accessibility and event cleanup
- Live deployment tested and verified for anonymous users (no login prompts or errors)

### 🔄 In Progress
- Finalizing theme preset designs and CSS for NeoFantasy, SynthwaveHacker, and ProPersona
- Styling back face content and layout (lore, bio, powers, alignment, achievements)
- Polishing stat bar animations and responsive behavior
- Performance optimizations and code cleanup for editor scripts
- Documentation updates and developer onboarding refinements
- Final production smoke testing of all user flows
- Performance optimization and bundle size reduction
- Documentation and onboarding updates

---
## 🔮 Next Phase: CardForge v2.5 – Modular Expression Update

"Every card a signature. Every detail a choice."

### 🌟 Major Features & Enhancements

1. **Visual Design Selectors (UI Upgrade)**
   - **Theme (Layout)**: Mini-card thumbnail grid for layout previews (Left-Aligned, Stacked Portrait, Grid, etc.)
   - **Color Variant (Palette)**: Live swatch selectors showing core palettes; hover to expand, click to apply.
   - **Image Style**: Masked shape preview selector (Circle, Hexagon, Blob, Full Bleed, Hero).
   - **Image Variant**: Effect filter strip with live thumbnails (Glow Aura, Vintage Filter, Pixel Mask, Sketch Overlay).

2. **Back of Card Customization**
   - Upload or select a separate back image with live flip preview.
   - Toggle option: "Use same image as front" for mirrored designs.

3. **Border Customization**
   - Toggle border on/off with style options (None, Thin, Bold, Etched, Glow).
   - Choose border color from system palette or enter custom HEX.

4. **Background Effects (FX Layer)**
   - Ambient background effects: Particles, Nebula Drift, Noise Texture, Flux Lines.
   - Adjustable intensity: None, Subtle, Bold.

5. **Section Toggle Controls**
   - Show/Hide toggles for Class, Rarity, Stats, Social, Badges, Attributes.
   - Name and Bio/Quote remain required and always visible.
   - Live checklist panel for modular visibility controls.

6. **Smart Height Sync**
   - Measure front/back content heights and set container to the greater height.
   - Smooth CSS transition (`transition: height 0.3s ease-in-out`) to avoid flicker on flip.

7. **Updated Card JSON Schema**
```json
{
  "design": {
    "theme": "left-align",
    "colorVariant": "nova",
    "imageStyle": "masked",
    "imageVariant": "glow",
    "backImage": "<url_or_id>",
    "fx": { "background": "particles", "intensity": "subtle" },
    "border": { "enabled": true, "style": "etched", "color": "#9dff5c" }
  },
  "sections": {
    "class": true,
    "rarity": true,
    "stats": false,
    "social": true,
    "badges": false,
    "attributes": true
  }
}
```

These enhancements lay the foundation for a truly modular, expressive CardForge experience in v2.5.
---
## 🎨 Core Features

### Card System
- **Card Design Tab**: Unified interface for visual customization including theme, variant, and artwork selection
- **Gallery Integration**: Browse and select from a paginated image gallery or use custom URLs
- **Visual Customization**: Choose from multiple image styles (Masked, Hero, Full Bleed) with variant options
- **Theme System**: Multiple visual themes (NeoFantasy, SynthwaveHacker, ProPersona) with consistent styling
- **Responsive Design**: Fully responsive layout that works across desktop and mobile devices
- **Live Preview**: Real-time preview updates as you modify card properties
- **Export Options**: Save as image or JSON for integration with other tools
- **Modular Visual System**: Foundation for future enhancements like foil effects, filters, and 3D variants

### 🔒 Security Features
- CSRF protection (active for all POST requests, not tied to login)
- Input validation and sanitization
- Secure API communication (HTTPS enforced)
- No authentication required for CardForge APIs; rest of site remains protected as configured

### 🛠 Developer Tools
- Comprehensive error logging
- Debug utilities
- Mock API responses
- Environment-aware configuration
- Enhanced modal dialog utilities with keyboard navigation
- Event cleanup and memory management

### ✅ Dev Environment
- Local sandbox: edit `cardforge/index.html`, CSS/JS modules under `/cardforge/`
- Live reload via VS Code Live Server, Python `http.server`, or `npx serve`
- Isolated branch for dev; no npm dependencies—static assets only

---

## 🎨 Design System

### Theme System
CardForge V3 features a flexible theming system built with CSS custom properties for consistent styling and easy customization.

#### Base Theme Variables
```css
:root {
  --card-bg: rgba(18, 22, 34, 0.85);
  --card-border: rgba(255, 255, 255, 0.15);
  --card-text: #e1faff;
  --card-name-color: #e1faff;
  --card-class-color: rgba(225, 250, 255, 0.7);
  --card-glow: linear-gradient(135deg, #35f5ff, #9dff5c);
  --card-glow-opacity: 0.6;
  --card-hover-shadow: 0 16px 32px rgba(79, 248, 255, 0.3);
}
```

#### Light Theme Variants
- **NeoFantasy Light**: Soft purple gradient with dark text
- **SynthwaveHacker Light**: Bright theme with pink accents
- **ProPersona Light**: Clean, professional look with blue accents

### Image Styles & Variants

#### 1. Masked Style
- **Circle**: Classic circular crop
- **Hex**: Hexagonal mask for fantasy themes
- **Blob**: Organic, fluid shape
- **Tear Drop**: Unique teardrop shape

#### 2. Hero Style
- **Large**: Cinematic 3:1 aspect ratio (shifts to 2:1 on mobile)
- **Small**: Compact 2:1 aspect ratio (shifts to 3:2 on mobile)

#### 3. Full Bleed
- **Ambient**: Art-first with text overlaid directly on image
- **Overlay Safe**: UI-first with semi-transparent container for readability

### Card Components

#### Badges & Rarity
- Customizable badges with icon support
- Rarity indicators with visual distinction
- Theme-aware styling for light/dark modes

#### Stats Bars
- Animated progress bars
- Responsive layout
- Theme-consistent colors

### Responsive Design
- Mobile-first approach
- Adaptive layouts for all screen sizes
- Touch-friendly controls

### JavaScript Integration
```javascript
// Apply theme
document.querySelector('.card-preview-canvas').classList.add('theme-neofantasy', 'variant-light');

// Update image style
document.querySelector('.card-preview-canvas').classList.add('image-style-hero', 'image-hero-large');
```

For detailed CSS implementation and customization options, refer to `css/cardforge-card.css`.

---

## endpoints

https://ambientpixels-nova-api.azurewebsites.net/api/cardforgedeletecard?

https://ambientpixels-nova-api.azurewebsites.net/api/cardforgeloadcards?

https://ambientpixels-nova-api.azurewebsites.net/api/cardforgepublish?

https://ambientpixels-nova-api.azurewebsites.net/api/cardforgesavecards?

https://ambientpixels-nova-api.azurewebsites.net/api/cardforgetemplate?

https://ambientpixels-nova-api.azurewebsites.net/api/getCardTemplate?


## 🚀 Quickstart

### Prerequisites
- Local CardForge directory at `C:\ambientpixels\EchoGrid\cardforge`
- A running backend API (`/api/cardforge/…` functions) via Azure Static Web Apps or `func start`
- Browser for testing network calls and console logs

### Running Locally
1. Serve static files:
   ```bash
   cd C:\ambientpixels\EchoGrid\cardforge
   npx http-server . -p 8080
   ```
2. Open `http://localhost:8080/index.html` in your browser.
3. (Optional) Live reload:
   ```bash
   live-server --port=8080 .
   ```

### Testing
- Run automated front-end tests in console:
  ```js
  CardForgeTests.runAll();
  ```
- Targeted tests:
  ```js
  CardForgeTests.testLoadGallery();
  CardForgeTests.testLoadPersonalLibrary();
  ```

---

## 🏁 Developer Onboarding
To get up and running:

1. Clone the repo to `C:\ambientpixels\EchoGrid\cardforge`.
2. Review key files:
   - `index.html` (entry point)
   - `/js/card-forge.js` (main app logic)
   - `/js/cardforge-template-loader.js` (template loading)
   - `/js/cardforge-editor.js` (form handling)
   - `/mock/` (offline JSON fallback data)
   - `/api/` (Azure Functions endpoints)
3. Serve static files locally (see Quickstart).
4. Start backend API (Azure Static Web Apps CLI or `func start`).
5. Understand auth flow in `initAuth()` and `loadCards()` (DOMContentLoaded bootstrap).
6. Run tests via `CardForgeTests.runAll()` and targeted tests.
7. Follow Windsurf Protocol: no inline CSS; use existing CSS under `/cardforge/css/`.
8. Consult this README and `docs/logs/project-card-forge.md` for architecture details.

---

## 🔌 API Integration

All API endpoints are versioned and secured. The application uses `window.buildApiPath()` for consistent endpoint construction.

### Authentication
- CSRF tokens required for all mutating operations
- JWT-based authentication for protected routes
- Role-based access control

### Endpoints
| Endpoint                 | Method | Auth Required | Description                    |
|--------------------------|--------|---------------|--------------------------------|
|--------------------------|--------|-----------------------------------|
| `/loadcards`             | GET    | Load defaults, userCards, gallery |
| `/savecards`             | POST   | Save user cards                   |
| `/cardpublish`           | POST   | Publish card to gallery           |
| `/gallery`               | GET    | Fetch public gallery cards        |
| `/cardforge/template`    | GET    | Retrieve a template by type       |
| `/debug`                 | GET    | Diagnostic endpoint               |

Use `X-CSRF-Token` header from `window.csrfProtection.getToken()` on all POST requests.

---

## 🐛 Known Issues & Debugging
- 401 Unauthorized when publishing: verify credentials and `X-User-ID` header
- CORS errors between domains: inspect network requests for misconfigured headers
- Unsaved edits lost on sign-out: warn users or auto-save drafts
- Use `/debug` to validate environment variables and storage connectivity
- Styling needed for micro badges in editor and preview
- Dynamic add/remove for multiple micro badges not fully implemented
- Save feature currently broken: localStorage and API save behavior failing
- Publish feature broken: publishing integration and UI feedback issues

---

## 📝 Recent Updates (2025-07-21)

- Implemented front/back flip view with CSS 3D transform and Flip Card button
- Added theme selection dropdown and wired preview to theme-{name} classes
- Extended preview to render new character fields and visual stat bars
- Updated index.html form to include rarity, bio, superpower, alignment, origin, faction, badge, and stats JSON textarea
- Added CSS for front face styling, stat bars, and flip container
- Began cleanup of legacy preview code; live preview now fails on lint but will be addressed
- Added Micro Badges editor section: category, icon dropdown, and description with live preview on back face
- Enforced max 6 micro badges and prefilled defaults per theme
- Added Social Links editor with input fields and live preview of icons and clickable links
- Consolidated icon rendering to SimpleIcons CDN using <img> tags and slug normalization (spaces→dashes)
- Enhanced accessibility: aria-labels on selects, alt and title attributes on icon images
- Removed duplicate icon loops and fixed updatePreview syntax errors



### API & Backend
- Standardized API endpoint naming convention
- Enhanced error handling and logging
- Added request validation middleware
- Improved CORS configuration

### Frontend
- Implemented form validation
- Added loading states and error handling
- Improved user feedback
- Optimized asset loading

### Security
- CSRF protection for all forms
- Input sanitization
- Secure cookie handling
- Rate limiting on sensitive endpoints

## 🤝 Contributing
Please follow the Windsurf Protocol:
- No inline styles; add CSS in `/cardforge/css/`
- Use existing utility classes and themes
- Document new API calls here and in backend docs

---

## 📄 License
MIT © AmbientPixels.ai

Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.

## 🛌 End of Day (2025-07-23)

Development paused for the night. Tomorrow's priorities:

- ✅ Verify back-face hover glitch is fully resolved
- ✅ Test dynamic container sizing with varied content lengths
- Address remaining lint warnings and finalize CSS ordering
- Validate all theme/variant combinations visually

## 📅 Session Updates

### UX Refactor: Card Design Tab Introduced (2025-07-25)
- Introduced new `Card Design` tab as first in flow
- Migrated Theme + Variant controls into design tab alongside artwork tools
- Updated tab navigation to follow creation narrative: Visual → Identity → Stats → Social
- Improved card preview responsiveness to visual selections
- Laid foundation for future visual FX tools (foil, filters, layout variants)

### Card Layout Progress (2025-07-24) ✅
- **Dynamic height scaling**: Cards now properly expand based on content amount
- **Stat bar containment**: All three stat bars display correctly within card boundaries
- **Badges tab stability**: Fixed width inconsistency in badges tab when adding multiple badges
- **Form consistency**: Standardized input and select elements across all form sections
- **Theme consistency**: Layout maintains integrity across all theme variations
- **Overflow prevention**: Implemented robust containment system using CSS containment and proper overflow handling

### Current Status
- **Layout**: ✅ Working as expected with dynamic sizing
- **Content accommodation**: ✅ Ready for variable text inputs and content lengths
- **Next focus**: 🎨 **Color system refinement** - themes and visual polish

### Remaining Work
- Fine-tune color schemes and theme variations
- Enhance visual consistency across all theme modes
- Optimize color contrast and accessibility
- Polish theme transition animations
- Commit final changes and update documentation
