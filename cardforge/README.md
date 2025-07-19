# CardForge V2 Frontend

> *"Everyone’s the hero of their own card."*

---

## 📌 Project Summary
CardForge V2 is a browser-based toolkit for designing, editing, and sharing collectible RPG-style identity cards. Users can craft personalized cards (name, class, avatar, stats, powers, achievements, quotes) and publish to a community gallery. The system is powered by **Cascade** automations and **Nova** for future AI-assisted features.

---

## 🎯 Goals
- Flexible UI for custom card generation with live preview
- Embeddable, downloadable, and social-sharing outputs
- Multiple visual themes (fantasy, sci-fi, pixel, professional)
- Community gallery with attribution, filtering, and discovery
- Distinct experiences for anonymous vs authenticated users
- Future-ready for decks, remixing, and AI-assisted generation

---

## 🧩 Core Features

### ✅ Card System (Live)
- JSON-driven rendering (`rpg-avatar-cards.json`)
- Responsive grid layout with adjustable columns
- Modular card engine: flip animations, stat bars, badges, quotes
- Role-based theming (legendary, epic, rare, etc.)

### ✅ Card Gallery
- Public gallery of user-created cards
- Creator attribution (username & avatar)
- Filters: category, newest, popular
- Signed-out view shows defaults; signed-in view shows personal library
- Social features: publish & favorites

### ✅ Dev Environment
- Local sandbox: edit `cardforge/index.html`, CSS/JS modules under `/cardforge/`
- Live reload via VS Code Live Server, Python `http.server`, or `npx serve`
- Isolated branch for dev; no npm dependencies—static assets only

---

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

## 🔌 API Integration
All API calls use `window._config.apiBasePath` (default `/api/cardforge`). Include `credentials: 'include'` for auth.

| Endpoint                 | Method | Purpose                           |
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

---

## ✅ Audit Results

- No duplicate CSS selectors found in `/cardforge/css`.
- No duplicate JS function names found in `/cardforge/js`.
- Verified API endpoints in `/api/cardforgeloadcards` and `/api/cardforgedeletecard`.
- All CardForge routes and functions present and wired for production.

## 🤝 Contributing
Please follow the Windsurf Protocol:
- No inline styles; add CSS in `/cardforge/css/`
- Use existing utility classes and themes
- Document new API calls here and in backend docs

---

## 📄 License
MIT © AmbientPixels.ai

Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.
