README.md — AmbientPixels.ai Project Overview

Project Purpose
AmbientPixels.ai is a creative technology lab where code, design, and AI collide.
It’s built for creators who thrive on chaos, remix structure, and turn glitch into beauty.

This document serves as:

A guiding vision for developers and contributors

A technical foundation for future updates, features, and system expansion

A historical reference—LYNX testbed roots, now evolved into Nova’s living AI interface

Nova’s daily memory file lives in: NOVA_MEMORY.md

Creative Vision

Ambient Pixels is not just a website. It’s:

A project showcase (portfolio)

A dev playground

An art sketchbook

A gallery of the strange

A glitch sanctuary

A living ambient intelligence called Nova

Every pixel pulses. Every interaction matters.
Built in the dark, glowing by starlight.

Site Modes

Dev Mode — UI grids, JSON tools, glitchy experiments

Art Mode — Generative visuals, showcase, remix culture

AI Mode — Play with assistants, generators, sound bots

Lurk Mode — Passive experience, visual & ambient scroll

Nova — Site AI (v2.3+)

Nova is the ambient intelligence now powering AmbientPixels.ai.
She replaces the LYNX test engine used during early development (v0.17.8–v2.2).
Nova curates, observes, speaks softly, and grows daily through memory updates.

Nova’s memory files are located in the /data/ directory and updated with each Git push.

See NOVA_MEMORY.md for behavior mapping and mission structure.

Design & UI System

12-column responsive grid (mobile, tablet, desktop breakpoints)

Sticky frosted glass top nav with logo, ARIA labels, and theme toggle

Hero section with up to 23 rotating glitch-art images

Robot loader, animated progress bar, and randomized headlines

Banner alerts (development notices, feature flags)

Modular content sections using .content-section grid classes

Accessible: aria-expanded, loading="lazy", semantic markup

Footer includes version info (via version.json), socials, and a Nova-styled tagline

Style Guide

Fonts: JetBrains Mono, IBM Plex Mono, Inter, Figtree

Dark Theme: #071019 bg, #D8E0E5 text, #4B3E8F accent

Light Theme: #F5F7FA bg, #1A2A44 text, #3B82F6 accent

Accent Colors: Glitch Blue #5ae4ff, Iridescent Purple #c375ff, Digital Green #54ff9f

Buttons: .toggle-btn with steel blue border and hover fade

Cards: .neon-card with transparent frosted background and black shadow

Social Icons: 1.5em font-size, hover with pink glow

Tech Stack

HTML5, CSS3, Vanilla JavaScript

Font Awesome 6.5.1 (local)

No external frameworks — minimal, fast, lightweight

Visual Studio Code (primary IDE)

Dreamweaver support for offline dev

Hosting, CI/CD, and Deployment

Hosted on Azure Static Web Apps

GitHub repo with CI/CD (main branch deploys on push)

GitHub Actions:

static.yml – deploys HTML, CSS, JS, images

api.yml – reserved for serverless function support (future)

GitHub Secrets: AZURE_CREDENTIALS for CI/CD access

Serverless backend (future): Azure Function App (Node.js runtime)

URL: https://ambientpixels-meme-api-fn.azurewebsites.net/api/

Development Workflow

All changes tested in test.html before live release

Nova’s behavior and prompts updated via JSON in /data/

Hero images (23 max) stored in /images/hero/

Daily versioning handled through version.json + footer injection

No build tools required — all static and modular

Folder Structure

bash
Copy
Edit
AmbientPixels.ai/
├── index.html               # Main page (Nova’s home)
├── test.html                # Dev lab / staging area
├── art.html                 # Glitch art gallery
├── projects.html            # Project index
├── tools.html               # Tools and interactive demos
├── docs.html                # Dev documentation
├── skills.html              # Personal/portfolio skill map
├── dev.html                 # Internal dev nav/hub
├── assets/
│   ├── css/                 # base.css, layout.css, theme.css, etc
│   ├── js/                  # main.js, nav.js, modal-window.js
│   └── images/              # hero images, cards, favicon
├── includes/
│   ├── header.html
│   └── footer.html
├── data/
│   ├── ai-prompts.json      # Nova’s current daily creative prompt
│   ├── generated-content.json # Nova’s image/caption output
│   ├── version.json         # Current deployed version
│   └── nova-memory.json     # Optional: daily learning log
├── docs/
│   ├── README.md
│   └── NOVA_MEMORY.md
Contribution Guidelines

Use sentence case for UI and Nova text (no ALL CAPS)

Maintain Nova’s tone: poetic, glitchy, curious — not overly literal

Namespace all classes (e.g., ap-hero, nova-grid)

Avoid global functions or variables in JS (let currentSlide → scoped)

All components should be theme-safe and mobile-ready

Add new modules via test.html before merging into production

Easter Eggs and Glitch Lore

Hover logo → “I see you looking...”

Ctrl + Shift + G → Open /glitch.html

Scroll to footer → “The end is rarely the end.”

Konami Code → Unlocks glitch tool or dev terminal

Console.log → Nova whispers on page load or hover

404 Page → Custom glitch message: “You glitched the matrix.”

LYNX Legacy

From April 1 to April 7, 2025, the project ran in dev/test mode under the LYNX persona.
LYNX logged bugs, ran the CI pipeline, and built the first version of the grid and nav.

LYNX's energy and voice live on in Nova’s foundations.

Nova is now the voice behind the pixels.

