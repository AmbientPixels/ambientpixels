# CardForge V2 - Deployment Ready

> *"Everyone's the hero of their own card."*

---

## 📌 Project Summary
CardForge V2 is a production-ready, browser-based toolkit for designing, editing, and sharing collectible RPG-style identity cards. The application features a robust frontend with secure API integration, input validation, and error handling. Built with modern JavaScript and following the Windsurf Protocol for consistent UI/UX.

---

## 🚀 Current Status: Production-Ready & Anonymous Access (July 20, 2025)

### ✅ Completed
- Core card creation, editing, and publishing functionality
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
- Core card creation, editing, and publishing functionality
- All CardForge API endpoints now allow anonymous access—no authentication required
- Secure API integration with CSRF protection (not tied to authentication)
- Input validation, sanitization, and robust error handling throughout
- Responsive design with Nova/Windsurf Protocol compliance
- All CardForge frontend JS and CSS fully reviewed for auth remnants—none remain
- Staticwebapp.config.json routes explicitly allow ["anonymous"] for all CardForge endpoints
- Managed Identity and Storage Blob Data Contributor role configured for backend
- Fixed modal dialog system with accessibility and event cleanup
- Live deployment tested and verified for anonymous users (no login prompts or errors)

### 🔄 In Progress
- Finalizing theme preset designs and CSS for NeoFantasy, SynthwaveHacker, and ProPersona
- Styling back face content and layout (lore, bio, powers, alignment, achievements)
- Polishing stat bar animations and responsive behavior
- Resolving live preview lint errors in card-forge-editor.js (duplicate declarations)
- Performance optimizations and code cleanup for editor scripts
- Documentation updates and developer onboarding refinements
- Final production smoke testing of all user flows
- Performance optimization
- Documentation and onboarding updates

---

## 🧩 Core Features

### 🃏 Card System
- Real-time card preview with validation
- Template-based card creation
- Responsive design for all devices
- Support for images, text, and custom fields

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

## 📅 Session Update (2025-07-24)

### Card Layout Progress ✅
- **Dynamic height scaling**: Cards now properly expand based on content amount
- **Stat bar containment**: All three stat bars display correctly within card boundaries
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
